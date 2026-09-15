import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import {
  FENCING_CHAT_FALLBACK_MESSAGE,
  FencingChatError,
  alternativeOfferLabel,
  budgetSources,
  clientTradeChipLabel,
  fetchClientTrades,
  labelForClientTrade,
  PUBLISHED_CLIENT_TRADES,
  fencingChatFromMetadata,
  parseAnswerImages,
  parseAnswerSources,
  parseRateUnit,
  rateUnitSuffix,
  formatQuoteRate,
  resultIdFromMetadata,
  serialiseKnownChecklist,
  sendFencingChatMessage,
} from './fencingChat'

vi.mock('./api', () => ({
  api: { post: vi.fn(), get: vi.fn() },
}))

const mockedPost = vi.mocked(api.post)
const mockedGet = vi.mocked(api.get)

beforeEach(() => {
  vi.stubEnv('VITE_FENCING_CHAT_URL', 'https://api.example.test/api/v1/client/fencing-chat')
  mockedGet.mockReset()
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

  it('posts to /api/v1/client/chat when only the API base is set', async () => {
    vi.stubEnv('VITE_FENCING_CHAT_URL', '')
    vi.stubEnv('VITE_FENCING_CHAT_WEBHOOK_URL', '')
    vi.stubEnv('VITE_QUOTEMY_API_BASE_URL', 'https://api.example.test')
    mockedPost.mockResolvedValueOnce({ data: ok })

    await sendFencingChatMessage('hello', 's1')

    expect(mockedPost).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/client/chat',
      expect.anything(),
      expect.anything(),
    )
  })

  it('sends trade only when the conversation has locked one', async () => {
    mockedPost.mockResolvedValue({ data: ok })

    await sendFencingChatMessage('hello', 's1', null, { trade: 'tiling' })
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1', place: '', knownChecklist: '', trade: 'tiling' },
      expect.anything(),
    )

    await sendFencingChatMessage('hello', 's1', null, { trade: null })
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.any(String),
      { message: 'hello', sessionId: 's1', place: '', knownChecklist: '' },
      expect.anything(),
    )
  })

  it('accepts a turn whose trade is null', async () => {
    const picker = {
      ...ok,
      type: 'question' as const,
      trade: null,
      message: 'Are you looking for Fencing or Tiling services?',
      options: [
        { label: 'Fencing', value: 'fencing' },
        { label: 'Tiling', value: 'tiling' },
      ],
    }
    mockedPost.mockResolvedValueOnce({ data: picker })
    await expect(sendFencingChatMessage('hi, I need a quote', 's1')).resolves.toEqual(picker)
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

describe('PUBLISHED_CLIENT_TRADES', () => {
  it('lists the six live trades the homepage chips render', () => {
    expect(PUBLISHED_CLIENT_TRADES.map((item) => item.trade)).toEqual([
      'fencing',
      'tiling',
      'kitchen',
      'retaining_wall',
      'decking',
      'home_renovation',
    ])
  })
})

describe('fetchClientTrades', () => {
  const published = [
    { trade: 'fencing', label: 'fencing' },
    { trade: 'tiling', label: 'tiling' },
    { trade: 'kitchen', label: 'kitchen fitting' },
    { trade: 'retaining_wall', label: 'retaining wall' },
    { trade: 'decking', label: 'decking' },
    { trade: 'home_renovation', label: 'home renovation' },
  ]

  it('reads the published list from GET /client/trades', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ok: true, data: published } })

    await expect(fetchClientTrades()).resolves.toEqual(published)
    expect(mockedGet).toHaveBeenCalledWith('https://api.example.test/api/v1/client/trades')
  })

  it('keeps the retaining_wall slug exactly, underscore and all', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ok: true, data: published } })
    const trades = await fetchClientTrades()
    expect(trades.map((item) => item.trade)).toEqual([
      'fencing',
      'tiling',
      'kitchen',
      'retaining_wall',
      'decking',
      'home_renovation',
    ])
    expect(trades.some((item) => item.trade === 'retaining-wall' || item.trade === 'retainingWall')).toBe(false)
  })

  it('returns an empty list when the endpoint is down', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network'))
    await expect(fetchClientTrades()).resolves.toEqual([])
  })
})

describe('clientTradeChipLabel', () => {
  it('title-cases the wire label for the picker', () => {
    expect(clientTradeChipLabel('fencing')).toBe('Fencing')
    expect(clientTradeChipLabel('kitchen fitting')).toBe('Kitchen Fitting')
    expect(clientTradeChipLabel('retaining wall')).toBe('Retaining Wall')
    expect(clientTradeChipLabel('decking')).toBe('Decking')
    expect(clientTradeChipLabel('home renovation')).toBe('Home Renovation')
  })
})

describe('labelForClientTrade', () => {
  const published = [
    { trade: 'fencing', label: 'fencing' },
    { trade: 'tiling', label: 'tiling' },
    { trade: 'kitchen', label: 'kitchen fitting' },
    { trade: 'retaining_wall', label: 'retaining wall' },
    { trade: 'decking', label: 'decking' },
    { trade: 'home_renovation', label: 'home renovation' },
  ]

  it('returns the published chip label, never a local kitchen→Kitchen map', () => {
    expect(labelForClientTrade('kitchen', published)).toBe('Kitchen Fitting')
    expect(labelForClientTrade('fencing', published)).toBe('Fencing')
    expect(labelForClientTrade('retaining_wall', published)).toBe('Retaining Wall')
    expect(labelForClientTrade('home_renovation', published)).toBe('Home Renovation')
  })

  it('resolves the older hyphen slug to the published retaining_wall label', () => {
    expect(labelForClientTrade('retaining-wall', published)).toBe('Retaining Wall')
  })

  it('returns nothing for a slug the list does not carry, so callers cannot invent words', () => {
    expect(labelForClientTrade('solar', published)).toBeUndefined()
    expect(labelForClientTrade('kitchen', [])).toBeUndefined()
  })
})

describe('voice metadata helpers', () => {
  it('unwraps a fencing-chat payload from Retell metadata', () => {
    const payload = { ...ok, type: 'question' as const, expects: 'suburb' as const }
    expect(fencingChatFromMetadata({ metadata: payload })).toEqual(payload)
    expect(fencingChatFromMetadata(payload)).toEqual(payload)
  })

  it('reads resultId from a wrapper or the payload itself', () => {
    expect(resultIdFromMetadata({ resultId: 'r1' })).toBe('r1')
    expect(resultIdFromMetadata({ ...ok, resultId: 'r2' })).toBe('r2')
    expect(resultIdFromMetadata({ metadata: { resultId: 'r3' } })).toBe('r3')
  })
})

describe('parseAnswerImages', () => {
  it('keeps a complete photo and drops rows without a thumbnail or source', () => {
    expect(
      parseAnswerImages([
        {
          url: 'https://bunnings.com.au/fence.jpg',
          thumbUrl: 'https://encrypted-tbn0.gstatic.com/images?q=1',
          sourceName: 'Bunnings',
          width: 3900,
          height: 2194,
        },
        { url: 'https://example.com/x.jpg', sourceName: 'Missing thumb', width: 1, height: 1 },
        { thumbUrl: 'https://encrypted-tbn0.gstatic.com/images?q=2', sourceName: '  ' },
      ]),
    ).toEqual([
      {
        url: 'https://bunnings.com.au/fence.jpg',
        thumbUrl: 'https://encrypted-tbn0.gstatic.com/images?q=1',
        sourceName: 'Bunnings',
        width: 3900,
        height: 2194,
      },
    ])
  })

  it('caps the strip at six', () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      url: `https://example.com/${index}.jpg`,
      thumbUrl: `https://encrypted-tbn0.gstatic.com/images?q=${index}`,
      sourceName: `Source ${index}`,
      width: 4,
      height: 3,
    }))
    expect(parseAnswerImages(rows)).toHaveLength(6)
  })
})

describe('parseAnswerSources', () => {
  it('keeps a rates row and treats a missing budgetValue as null', () => {
    expect(
      parseAnswerSources([
        {
          name: 'hipages',
          figure: '$85 to $100 a metre installed',
          perMetreMin: 85,
          perMetreMax: 100,
          budgetValue: 'budget:85-100:hipages',
          url: null,
        },
        { name: 'Airtasker', figure: 'no figure given', budgetValue: null },
      ]),
    ).toEqual([
      {
        name: 'hipages',
        figure: '$85 to $100 a metre installed',
        perMetreMin: 85,
        perMetreMax: 100,
        budgetValue: 'budget:85-100:hipages',
        url: null,
      },
      {
        name: 'Airtasker',
        figure: 'no figure given',
        perMetreMin: undefined,
        perMetreMax: undefined,
        budgetValue: null,
        url: undefined,
      },
    ])
  })
})

describe('budgetSources', () => {
  it('skips rows whose budgetValue is null', () => {
    expect(
      budgetSources([
        { name: 'hipages', figure: '$85 to $100 a metre installed', budgetValue: 'budget:85-100:hipages' },
        { name: 'advice', figure: 'it depends', budgetValue: null },
      ]).map((source) => source.budgetValue),
    ).toEqual(['budget:85-100:hipages'])
  })
})

describe('rateUnitSuffix', () => {
  it('prints only from the server unit, never from a trade slug', () => {
    expect(rateUnitSuffix('m2')).toBe('/m²')
    expect(rateUnitSuffix('m')).toBe('/m')
    expect(rateUnitSuffix('item')).toBe('')
    expect(rateUnitSuffix(null)).toBe('')
    expect(rateUnitSuffix(undefined)).toBe('')
    expect(rateUnitSuffix('tiling')).toBe('')
  })

  it('accepts only m, m2, and item as units', () => {
    expect(parseRateUnit('m')).toBe('m')
    expect(parseRateUnit('m2')).toBe('m2')
    expect(parseRateUnit('item')).toBe('item')
    expect(parseRateUnit(null)).toBeUndefined()
    expect(parseRateUnit('tiling')).toBeUndefined()
  })

  it('omits the rate line for a whole-job price', () => {
    expect(formatQuoteRate({ ratePerMeter: 15470, unit: 'item' })).toBeNull()
    expect(formatQuoteRate({ ratePerMeter: 72, unit: 'm2' })).toBe('$72/m²')
    expect(formatQuoteRate({ ratePerMeter: 152, unit: 'm' })).toBe('$152/m')
    expect(formatQuoteRate({ ratePerMeter: 520, unit: 'm' })).toBe('$520/m')
    expect(formatQuoteRate({ ratePerMeter: 520, unit: 'm2' })).toBe('$520/m²')
    expect(formatQuoteRate({ ratePerMeter: 625, unit: 'm2' })).toBe('$625/m²')
    expect(formatQuoteRate({ ratePerMeter: 152 })).toBeNull()
  })
})

describe('alternativeOfferLabel', () => {
  it('prefers an explicit label, then the fencing display fields', () => {
    expect(
      alternativeOfferLabel({
        label: 'Porcelain, 12m²',
        businessName: 'Paky Tiles',
        estimatedTotal: 1440,
        value: 'alt:1',
      }),
    ).toBe('Porcelain, 12m²')
    expect(
      alternativeOfferLabel({
        material: 'colorbond',
        materialLabel: 'Colorbond',
        heightKey: '1.8m',
        businessName: 'Southeast Fencing',
        estimatedTotal: 2200,
        value: 'alt:2',
      }),
    ).toBe('Colorbond, 1.8m')
  })
})
