import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import {
  FENCING_CHAT_FALLBACK_MESSAGE,
  FencingChatError,
  serialiseKnownChecklist,
  sendFencingChatMessage,
} from './fencingChat'

vi.mock('./api', () => ({
  api: { post: vi.fn() },
}))

const mockedPost = vi.mocked(api.post)

beforeEach(() => {
  vi.stubEnv('VITE_FENCING_CHAT_URL', 'https://api.example.test/api/v1/client/fencing-chat')
})

const ok = {
  sessionId: 's1',
  type: 'message' as const,
  message: 'hi',
  options: [],
  results: [],
  avgRatePerMeter: null,
}

function axiosErrorWithBody(status: number, data: unknown) {
  return new axios.AxiosError(
    'Request failed',
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    {
      status,
      data,
      statusText: 'Error',
      headers: {},
      config: { headers: new axios.AxiosHeaders() },
    },
  )
}

describe('sendFencingChatMessage', () => {
  it('returns the response when it matches the expected shape', async () => {
    mockedPost.mockResolvedValueOnce({ data: ok })
    await expect(sendFencingChatMessage('hello', 's1')).resolves.toEqual(ok)
  })

  it('throws when the API returns an empty or malformed body', async () => {
    mockedPost.mockResolvedValueOnce({ data: '' })
    await expect(sendFencingChatMessage('hello', 's1')).rejects.toThrow(/unexpected response shape/i)
  })

  it('throws FencingChatError when a non-2xx body is chat-shaped', async () => {
    mockedPost.mockRejectedValueOnce(
      axiosErrorWithBody(503, {
        type: 'error',
        code: 'upstream_busy',
        message: "We're a bit busy right now — give that another go in a moment.",
        retryable: true,
        sessionId: 's1',
        checklist: { suburb: 'Berwick' },
        options: [],
        results: [],
        checklistComplete: false,
      }),
    )

    const error = await sendFencingChatMessage('hello', 's1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FencingChatError)
    expect(error).toMatchObject({
      code: 'upstream_busy',
      retryable: true,
      status: 503,
      sessionId: 's1',
      checklist: { suburb: 'Berwick' },
      checklistComplete: false,
      message: "We're a bit busy right now — give that another go in a moment.",
    })
  })

  it('marks non-retryable API errors so the UI can hide Try again', async () => {
    mockedPost.mockRejectedValueOnce(
      axiosErrorWithBody(429, {
        type: 'error',
        code: 'too_fast',
        message: 'Slow down a touch — that came through twice.',
        retryable: false,
        sessionId: 's1',
        checklist: { suburb: 'Berwick', material: 'Colorbond' },
        options: [],
        results: [],
        checklistComplete: false,
      }),
    )

    await expect(sendFencingChatMessage('hello', 's1')).rejects.toMatchObject({
      code: 'too_fast',
      retryable: false,
      status: 429,
    })
  })

  it('falls back to a retryable customer message when Axios fails without a chat body', async () => {
    mockedPost.mockRejectedValueOnce(axiosErrorWithBody(502, { ok: false }))

    await expect(sendFencingChatMessage('hello', 's1')).rejects.toMatchObject({
      code: 'network',
      retryable: true,
      status: 502,
      message: FENCING_CHAT_FALLBACK_MESSAGE,
    })
  })

  it('always sends the four string fields, with empty strings when nothing is known yet', async () => {
    mockedPost.mockResolvedValue({ data: ok })

    await sendFencingChatMessage('hello', 's1')
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1', place: '', knownChecklist: '' },
      expect.anything(),
    )
  })

  it('round-trips the full checklist, including _ui and null fields', async () => {
    mockedPost.mockResolvedValue({ data: ok })
    const checklist = {
      suburb: 'Pakenham',
      material: null,
      lengthMeters: 20,
      _ui: { step: 'material', page: 1 },
    }

    await sendFencingChatMessage('hello', 's1', null, { knownChecklist: checklist })

    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      {
        message: 'hello',
        sessionId: 's1',
        place: '',
        knownChecklist: JSON.stringify(checklist),
      },
      expect.anything(),
    )
  })

  it('serialiseKnownChecklist preserves the checklist verbatim', () => {
    const checklist = { suburb: null, material: 'colorbond', _ui: { page: 2 } }
    expect(serialiseKnownChecklist(checklist)).toBe(JSON.stringify(checklist))
    expect(serialiseKnownChecklist(null)).toBe('')
    expect(serialiseKnownChecklist(undefined)).toBe('')
  })

  it('stringifies place when the customer has picked one', async () => {
    mockedPost.mockResolvedValue({ data: ok })
    const place = {
      suburb: 'Berwick',
      state: 'VIC',
      stateFullName: 'Victoria',
      postcode: '3806',
      country: 'AU',
      countryName: 'Australia',
      displayLabel: 'Berwick, VIC 3806',
      formattedAddress: 'Berwick VIC 3806',
      latitude: -38.03,
      longitude: 145.34,
      placeId: 'ChIJ',
      placeTypes: ['locality'],
      name: 'Berwick',
    }

    await sendFencingChatMessage('Berwick', 's1', null, { place })

    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      {
        message: 'Berwick',
        sessionId: 's1',
        place: JSON.stringify(place),
        knownChecklist: '',
      },
      expect.anything(),
    )
  })

  it('appends attachments under the files field', async () => {
    mockedPost.mockResolvedValue({ data: ok })
    const file = new File(['x'], 'q.pdf', { type: 'application/pdf' })

    await sendFencingChatMessage('hello', 's1', [file], {
      knownChecklist: { suburb: 'Berwick', _ui: { page: 0 } },
    })

    const sent = mockedPost.mock.lastCall?.[1] as FormData
    expect(sent).toBeInstanceOf(FormData)
    expect(sent.get('message')).toBe('hello')
    expect(sent.get('sessionId')).toBe('s1')
    expect(sent.get('place')).toBe('')
    expect(sent.get('knownChecklist')).toBe(JSON.stringify({ suburb: 'Berwick', _ui: { page: 0 } }))
    expect(sent.getAll('files')).toHaveLength(1)
    expect(sent.get('quoteFile')).toBeNull()
  })

  it('never hands back a blank message for the thread to render', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { ...ok, message: '   ' },
    })

    const response = await sendFencingChatMessage('hello', 's1')

    expect(response.message.trim()).not.toBe('')
    expect(response.type).toBe('message')
  })
})
