import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceCall } from './useVoiceCall'

const { createVoiceCall, connectRetellCall } = vi.hoisted(() => ({
  createVoiceCall: vi.fn(),
  connectRetellCall: vi.fn(),
}))

vi.mock('../services/voice', () => ({
  createVoiceCall,
}))
vi.mock('../services/retellCall', () => ({
  connectRetellCall,
}))

describe('useVoiceCall', () => {
  beforeEach(() => {
    createVoiceCall.mockReset()
    connectRetellCall.mockReset()
  })

  it('starts a call, tracks speaking, and stops on unmount', async () => {
    const stop = vi.fn()
    let listeners: {
      onStarted?: () => void
      onEnded?: () => void
      onAgentTalking?: (talking: boolean) => void
      onMetadata?: (data: unknown) => void
    } = {}
    createVoiceCall.mockResolvedValue({ sessionId: 's1', accessToken: 'tok' })
    connectRetellCall.mockImplementation(async (_token: string, next: typeof listeners) => {
      listeners = next
      return { stop }
    })

    const onUiUpdate = vi.fn()
    const onEnded = vi.fn()
    const { result, unmount } = renderHook(() =>
      useVoiceCall({
        sessionId: 's1',
        place: null,
        knownChecklist: null,
        onUiUpdate,
        onEnded,
      }),
    )

    await act(async () => {
      await result.current.start('hello')
    })
    expect(createVoiceCall).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', message: 'hello' }))
    expect(result.current.status).toBe('connecting')

    act(() => {
      listeners.onStarted?.()
    })
    expect(result.current.status).toBe('listening')

    act(() => {
      listeners.onAgentTalking?.(true)
    })
    expect(result.current.status).toBe('speaking')

    act(() => {
      listeners.onMetadata?.({
        type: 'question',
        message: 'Pick a suburb on the screen.',
        options: [],
        results: [],
        avgRatePerMeter: null,
        expects: 'suburb',
        sessionId: 's1',
      })
    })
    expect(onUiUpdate).toHaveBeenCalledWith(expect.objectContaining({ expects: 'suburb' }))

    unmount()
    expect(stop).toHaveBeenCalled()
  })
})
