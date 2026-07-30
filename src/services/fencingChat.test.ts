import { describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { sendFencingChatMessage } from './fencingChat'

vi.mock('./api', () => ({
  api: { post: vi.fn() },
}))

const mockedPost = vi.mocked(api.post)

describe('sendFencingChatMessage', () => {
  it('returns the response when it matches the expected shape', async () => {
    const payload = {
      sessionId: 's1',
      type: 'message' as const,
      message: 'hi',
      options: [],
      results: [],
      avgRatePerMeter: null,
    }
    mockedPost.mockResolvedValueOnce({ data: payload })

    await expect(sendFencingChatMessage('hello', 's1')).resolves.toEqual(payload)
  })

  it('throws when the webhook returns an empty or malformed body', async () => {
    mockedPost.mockResolvedValueOnce({ data: '' })

    await expect(sendFencingChatMessage('hello', 's1')).rejects.toThrow(/unexpected response shape/i)
  })
})
