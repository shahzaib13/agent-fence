import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRetellCall } from './retellCall'

const { startCall, stopCall } = vi.hoisted(() => ({
  startCall: vi.fn(),
  stopCall: vi.fn(),
}))

vi.mock('retell-client-js-sdk', () => ({
  RetellWebClient: class {
    on = vi.fn()
    startCall = startCall
    stopCall = stopCall
  },
}))

describe('connectRetellCall', () => {
  beforeEach(() => {
    startCall.mockReset()
    stopCall.mockReset()
    startCall.mockResolvedValue(undefined)
  })

  it('stops the SDK client if startCall throws so a later mic tap is not blocked', async () => {
    startCall.mockRejectedValueOnce(new Error('502'))
    await expect(connectRetellCall('tok', {})).rejects.toThrow('502')
    expect(stopCall).toHaveBeenCalled()
  })
})
