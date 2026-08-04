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

  it('sends the locked intent so the workflow stops re-classifying the flow every turn', async () => {
    const payload = { sessionId: 's1', type: 'message' as const, message: 'hi', options: [], results: [], avgRatePerMeter: null }
    mockedPost.mockResolvedValue({ data: payload })

    await sendFencingChatMessage('hello', 's1', null, { intent: 'compare_quote' })
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1', intent: 'compare_quote' },
      expect.anything(),
    )

    // first turn has nothing to lock in yet, and must not send an empty one
    await sendFencingChatMessage('hello', 's1')
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1' },
      expect.anything(),
    )
  })

  it('sends only the checklist fields that are actually known', async () => {
    const payload = { sessionId: 's1', type: 'message' as const, message: 'hi', options: [], results: [], avgRatePerMeter: null }
    mockedPost.mockResolvedValue({ data: payload })

    await sendFencingChatMessage('hello', 's1', null, {
      knownChecklist: { suburb: 'Pakenham', fenceType: null, lengthMeters: 20, heightMm: null },
    })

    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1', knownChecklist: '{"suburb":"Pakenham","lengthMeters":20}' },
      expect.anything(),
    )
  })

  it('omits knownChecklist entirely when nothing is known yet', async () => {
    const payload = { sessionId: 's1', type: 'message' as const, message: 'hi', options: [], results: [], avgRatePerMeter: null }
    mockedPost.mockResolvedValue({ data: payload })

    await sendFencingChatMessage('hello', 's1', null, { knownChecklist: { suburb: null, fenceType: null } })

    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1' },
      expect.anything(),
    )
  })
})
