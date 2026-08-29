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
    expect(getVoiceLiveLines()).toEqual([{ role: 'assistant', text: 'Hi, I can help with your fence.' }])

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
      { role: 'assistant', text: 'Hi, I can help with your fence. Which suburb?' },
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
      { role: 'assistant', text: 'Hi, I can help with your fence. Which suburb?' },
      { role: 'user', text: 'Berwick' },
    ])

    act(() => {
      listeners.onAgentTalking?.(true)
    })
    expect(result.current.status).toBe('speaking')

    unmount()
    expect(stop).toHaveBeenCalled()
    expect(getVoiceLiveLines()).toEqual([])
  })

  it('drops the live pair when the session turn count grows', async () => {
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
    expect(getVoiceLiveLines()).toEqual([
      { role: 'assistant', text: 'Hi, I can help with your fence.' },
      { role: 'user', text: 'Berwick' },
      { role: 'assistant', text: 'How long is the fence?' },
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
