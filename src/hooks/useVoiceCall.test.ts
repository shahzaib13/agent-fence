import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceCall } from './useVoiceCall'
import { VoiceCallError, VOICE_RATE_LIMIT_MESSAGE } from '../services/voice'
import { getVoiceLiveLines, setVoiceLiveLines } from '../utils/voiceLiveStore'

const { createVoiceCall, fetchVoiceSession, connectRetellCall } = vi.hoisted(() => ({
  createVoiceCall: vi.fn(),
  fetchVoiceSession: vi.fn(),
  connectRetellCall: vi.fn(),
}))

vi.mock('../services/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/voice')>()
  return {
    ...actual,
    createVoiceCall,
    fetchVoiceSession,
  }
})
vi.mock('../services/retellCall', () => ({
  connectRetellCall,
}))

describe('useVoiceCall', () => {
  beforeEach(() => {
    createVoiceCall.mockReset()
    fetchVoiceSession.mockReset()
    connectRetellCall.mockReset()
    setVoiceLiveLines([])
  })

  it('starts a call, tracks speaking, grows live text by replace, and stops on unmount', async () => {
    const stop = vi.fn()
    let listeners: {
      onStarted?: () => void
      onEnded?: () => void
      onAgentTalking?: (talking: boolean) => void
      onUpdate?: (update: unknown) => void
    } = {}
    createVoiceCall.mockResolvedValue({
      sessionId: 'server-s1',
      accessToken: 'tok',
      configured: true,
      greeting: 'Hi, I can help with your fence.',
    })
    fetchVoiceSession.mockResolvedValue({
      found: true,
      turns: [{ said: 'Hi', wrote: 'Which suburb?' }],
      checklist: { suburb: null },
      options: [],
    })
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop }
    })

    const onSessionStarted = vi.fn()
    const onCallEnding = vi.fn()
    const onHandover = vi.fn()
    const { result, unmount } = renderHook(() =>
      useVoiceCall({
        onSessionStarted,
        onCallEnding,
        onHandover,
      }),
    )

    await act(async () => {
      await result.current.start({
        checklist: { suburb: 'Berwick' },
        place: null,
        options: [{ label: 'Yes', value: 'yes' }],
        message: 'Which suburb?',
        checklistDisplay: null,
        checklistAnswered: [{ key: 'suburb', title: 'Suburb', value: 'Berwick' }],
      })
    })
    expect(createVoiceCall).toHaveBeenCalledWith({
      checklist: { suburb: 'Berwick' },
      place: null,
      options: [{ label: 'Yes', value: 'yes' }],
      message: 'Which suburb?',
      checklistDisplay: null,
      checklistAnswered: [{ key: 'suburb', title: 'Suburb', value: 'Berwick' }],
    })
    expect(onSessionStarted).toHaveBeenCalledWith('server-s1')
    expect(result.current.status).toBe('connecting')
    expect(getVoiceLiveLines()).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Hi, I can help with your fence.' }),
    ])

    act(() => {
      listeners.onStarted?.()
    })
    expect(result.current.status).toBe('listening')

    act(() => {
      listeners.onUpdate?.({
        transcript: [{ role: 'agent', content: 'Hi, I can help with your fence. Which suburb?' }],
      })
    })
    expect(getVoiceLiveLines()).toEqual([
      expect.objectContaining({
        role: 'assistant',
        text: 'Hi, I can help with your fence. Which suburb?',
      }),
    ])

    act(() => {
      listeners.onUpdate?.({
        transcript: [
          { role: 'agent', content: 'Hi, I can help with your fence. Which suburb?' },
          { role: 'user', content: 'Berwick' },
        ],
      })
    })
    expect(getVoiceLiveLines()).toEqual([
      expect.objectContaining({
        role: 'assistant',
        text: 'Hi, I can help with your fence. Which suburb?',
      }),
      expect.objectContaining({ role: 'user', text: 'Berwick' }),
    ])

    act(() => {
      listeners.onAgentTalking?.(true)
    })
    expect(result.current.status).toBe('speaking')

    unmount()
    expect(stop).toHaveBeenCalled()
    expect(getVoiceLiveLines()).toEqual([])
  })

  it('drops live lines received before the sync request, keeps one line per role', async () => {
    vi.useFakeTimers()
    let listeners: {
      onUpdate?: (update: unknown) => void
      onAgentStoppedTalking?: () => void
    } = {}
    createVoiceCall.mockResolvedValue({ sessionId: 'server-s1', accessToken: 'tok', configured: true })
    fetchVoiceSession.mockResolvedValue({
      found: true,
      turns: [
        { n: 0, spoke: 'Hi, I can help with your fence.' },
        { n: 1, said: 'Berwick', spoke: 'How long is the fence?' },
      ],
    })
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop: vi.fn() }
    })

    const onSessionSync = vi.fn()
    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
        onSessionSync,
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    act(() => {
      listeners.onUpdate?.({ transcript: [{ role: 'agent', content: 'Hi, I can help with your fence.' }] })
      listeners.onUpdate?.({
        transcript: [
          { role: 'agent', content: 'Hi, I can help with your fence.' },
          { role: 'user', content: 'Berwick' },
        ],
      })
      listeners.onUpdate?.({
        transcript: [
          { role: 'user', content: 'Berwick' },
          { role: 'agent', content: 'How long is the fence?' },
        ],
      })
    })
    // One slot per role — the later agent line revises the greeting slot, not a third bubble.
    expect(getVoiceLiveLines()).toEqual([
      expect.objectContaining({ role: 'user', text: 'Berwick' }),
      expect.objectContaining({ role: 'assistant', text: 'How long is the fence?' }),
    ])

    act(() => {
      listeners.onAgentStoppedTalking?.()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(onSessionSync).toHaveBeenCalled()
    expect(getVoiceLiveLines()).toEqual([])

    act(() => {
      listeners.onUpdate?.({
        transcript: [{ role: 'agent', content: 'How long is the fence?' }],
      })
    })
    expect(getVoiceLiveLines()).toEqual([])

    vi.useRealTimers()
  })

  it('keeps live lines that arrived while the sync request was in flight', async () => {
    vi.useFakeTimers()
    let listeners: {
      onUpdate?: (update: unknown) => void
      onAgentStoppedTalking?: () => void
    } = {}
    let resolveFetch: ((value: unknown) => void) | undefined
    createVoiceCall.mockResolvedValue({ sessionId: 'server-s1', accessToken: 'tok', configured: true })
    fetchVoiceSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop: vi.fn() }
    })

    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    act(() => {
      listeners.onUpdate?.({ transcript: [{ role: 'agent', content: 'How long is the fence?' }] })
      listeners.onAgentStoppedTalking?.()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    // Sync issued; caller starts the next answer while the request is still open.
    act(() => {
      listeners.onUpdate?.({
        transcript: [
          { role: 'agent', content: 'How long is the fence?' },
          { role: 'user', content: 'Twenty metres' },
        ],
      })
    })
    expect(getVoiceLiveLines()).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'How long is the fence?' }),
      expect.objectContaining({ role: 'user', text: 'Twenty metres' }),
    ])

    await act(async () => {
      resolveFetch?.({
        found: true,
        turns: [{ n: 1, said: 'Berwick', spoke: 'How long is the fence?' }],
      })
      await Promise.resolve()
    })

    expect(getVoiceLiveLines()).toEqual([
      expect.objectContaining({ role: 'user', text: 'Twenty metres' }),
    ])

    vi.useRealTimers()
  })

  it('does not clear the overlay when a sync returns no new turns (filler stop)', async () => {
    vi.useFakeTimers()
    let listeners: {
      onUpdate?: (update: unknown) => void
      onAgentStoppedTalking?: () => void
    } = {}
    createVoiceCall.mockResolvedValue({ sessionId: 'server-s1', accessToken: 'tok', configured: true })
    // First sync: greeting only. Second: still no new turn (tool still running).
    fetchVoiceSession
      .mockResolvedValueOnce({
        found: true,
        turns: [{ n: 0, spoke: 'Hi, I can help with your fence.' }],
      })
      .mockResolvedValueOnce({
        found: true,
        turns: [{ n: 0, spoke: 'Hi, I can help with your fence.' }],
      })
      .mockResolvedValueOnce({
        found: true,
        turns: [
          { n: 0, spoke: 'Hi, I can help with your fence.' },
          {
            n: 1,
            said: 'is colorbond good on a slope',
            spoke: 'Colorbond holds up well on a slope if the posts are set right.',
          },
        ],
      })
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop: vi.fn() }
    })

    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    // Greeting lands and commits.
    act(() => {
      listeners.onUpdate?.({ transcript: [{ role: 'agent', content: 'Hi, I can help with your fence.' }] })
      listeners.onAgentStoppedTalking?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(getVoiceLiveLines()).toEqual([])

    // Caller asks; filler plays while the tool runs.
    act(() => {
      listeners.onUpdate?.({
        transcript: [
          { role: 'agent', content: 'Hi, I can help with your fence.' },
          { role: 'user', content: 'is colorbond good on a slope' },
        ],
      })
      listeners.onUpdate?.({
        transcript: [
          { role: 'user', content: 'is colorbond good on a slope' },
          { role: 'agent', content: 'Let me check that for you.' },
        ],
      })
      listeners.onAgentStoppedTalking?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    // No new turn yet — overlay must stay (filler is better than a blank chat).
    expect(getVoiceLiveLines()).toEqual([
      expect.objectContaining({ role: 'user', text: 'is colorbond good on a slope' }),
      expect.objectContaining({ role: 'assistant', text: 'Let me check that for you.' }),
    ])

    // Real answer revises the same assistant slot.
    act(() => {
      listeners.onUpdate?.({
        transcript: [
          { role: 'user', content: 'is colorbond good on a slope' },
          { role: 'agent', content: 'Colorbond holds up well on a slope if the posts are set right.' },
        ],
      })
      listeners.onAgentStoppedTalking?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    // Turn committed — overlay clears; empty-buffer guard blocks the stale agent repeat.
    expect(getVoiceLiveLines()).toEqual([])
    act(() => {
      listeners.onUpdate?.({
        transcript: [
          {
            role: 'agent',
            content: 'Colorbond holds up well on a slope if the posts are set right.',
          },
        ],
      })
    })
    expect(getVoiceLiveLines()).toEqual([])

    vi.useRealTimers()
  })

  it('hands over when the call ends after showing thinking', async () => {
    let listeners: { onEnded?: () => void } = {}
    createVoiceCall.mockResolvedValue({ sessionId: 'server-s1', accessToken: 'tok', configured: true })
    fetchVoiceSession.mockResolvedValue({
      found: true,
      turns: [{ said: 'Hi', wrote: 'Which suburb?' }],
      checklist: { suburb: null },
      options: [{ label: 'Yes', value: 'yes' }],
      type: 'confirmation',
    })
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop: vi.fn() }
    })

    const onCallEnding = vi.fn()
    const onHandover = vi.fn()
    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding,
        onHandover,
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    await act(async () => {
      listeners.onEnded?.()
      await Promise.resolve()
    })

    expect(onCallEnding).toHaveBeenCalled()
    expect(getVoiceLiveLines()).toEqual([])
    expect(onHandover).toHaveBeenCalledWith(
      expect.objectContaining({
        found: true,
        turns: [{ said: 'Hi', wrote: 'Which suburb?' }],
        type: 'confirmation',
      }),
      'server-s1',
    )
    expect(result.current.status).toBe('idle')
  })

  it('syncs the session after the agent stops talking', async () => {
    vi.useFakeTimers()
    let listeners: {
      onAgentStoppedTalking?: () => void
    } = {}
    createVoiceCall.mockResolvedValue({ sessionId: 'server-s1', accessToken: 'tok', configured: true })
    fetchVoiceSession.mockResolvedValue({
      found: true,
      turns: [{ wrote: 'Which suburb?' }],
      checklistDisplay: { suburb: { title: 'Suburb', value: '' } },
      checklistPending: [{ key: 'suburb', title: 'Suburb' }],
      options: [{ label: 'Berwick', value: 'berwick' }],
    })
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop: vi.fn() }
    })

    const onSessionSync = vi.fn()
    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
        onSessionSync,
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    act(() => {
      listeners.onAgentStoppedTalking?.()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(fetchVoiceSession).toHaveBeenCalledWith('server-s1')
    expect(onSessionSync).toHaveBeenCalledWith(
      expect.objectContaining({
        checklistPending: [{ key: 'suburb', title: 'Suburb' }],
      }),
    )
    expect(getVoiceLiveLines()).toEqual([])

    vi.useRealTimers()
  })

  it('returns to idle on SDK error so the mic can be used again', async () => {
    let listeners: { onError?: () => void } = {}
    createVoiceCall.mockResolvedValue({ sessionId: 'server-s1', accessToken: 'tok', configured: true })
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop: vi.fn() }
    })

    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    act(() => {
      listeners.onError?.()
    })

    expect(result.current.status).toBe('idle')
    expect(getVoiceLiveLines()).toEqual([])
  })

  it('returns to idle and notifies on rate limit', async () => {
    createVoiceCall.mockRejectedValue(
      new VoiceCallError(VOICE_RATE_LIMIT_MESSAGE, { status: 429, rateLimited: true }),
    )
    const onRateLimited = vi.fn()
    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
        onRateLimited,
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    expect(onRateLimited).toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(connectRetellCall).not.toHaveBeenCalled()
  })

  it('returns to idle on 502 so the mic can be used again', async () => {
    createVoiceCall.mockRejectedValue(
      new VoiceCallError('Voice call could not start. Please try again.', { status: 502 }),
    )
    const onStartFailed = vi.fn()
    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
        onStartFailed,
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    expect(onStartFailed).toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.isActive).toBe(false)
  })

  it('hides voice when the server reports configured:false', async () => {
    createVoiceCall.mockResolvedValue({ sessionId: '', accessToken: '', configured: false })
    const onConfigureUnavailable = vi.fn()
    const { result } = renderHook(() =>
      useVoiceCall({
        onSessionStarted: vi.fn(),
        onCallEnding: vi.fn(),
        onHandover: vi.fn(),
        onConfigureUnavailable,
      }),
    )

    await act(async () => {
      await result.current.start()
    })

    expect(onConfigureUnavailable).toHaveBeenCalled()
    expect(connectRetellCall).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
})
