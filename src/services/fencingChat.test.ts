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

  it('sends turn 0, because 0 is the value that means something', async () => {
    const payload = { sessionId: 's1', type: 'message' as const, message: 'hi', options: [], results: [], avgRatePerMeter: null }
    mockedPost.mockResolvedValue({ data: payload })

    // The opening description. A truthiness check would drop exactly this turn, and the
    // workflow would ask a checklist question instead of asking permission first.
    await sendFencingChatMessage('hello', 's1', null, { turn: 0 })
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1', turn: 0 },
      expect.anything(),
    )

    await sendFencingChatMessage('hello', 's1', null, { turn: 4 })
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1', turn: 4 },
      expect.anything(),
    )

    // Not knowing is different from turn 0 — an older caller must not read as the opener.
    await sendFencingChatMessage('hello', 's1')
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1' },
      expect.anything(),
    )
  })

  it('sends turn alongside the files when there are attachments', async () => {
    const payload = { sessionId: 's1', type: 'message' as const, message: 'hi', options: [], results: [], avgRatePerMeter: null }
    mockedPost.mockResolvedValue({ data: payload })

    await sendFencingChatMessage('hello', 's1', [new File(['x'], 'q.pdf', { type: 'application/pdf' })], { turn: 0 })

    const sent = mockedPost.mock.lastCall?.[1] as FormData
    expect(sent).toBeInstanceOf(FormData)
    expect(sent.get('turn')).toBe('0')
  })

  it('never hands back a blank message for the thread to render', async () => {
    // An empty string passes the shape check — it is a string — and then renders as an assistant
    // bubble with nothing in it, which reads as the app having died mid-sentence. The workflow
    // is supposed to guarantee a message; this is what happens on the day it does not.
    mockedPost.mockResolvedValueOnce({
      data: { sessionId: 's1', type: 'message', message: '   ', options: [], results: [], avgRatePerMeter: null },
    })

    const response = await sendFencingChatMessage('hello', 's1')

    expect(response.message.trim()).not.toBe('')
    expect(response.type).toBe('message')
  })
})
