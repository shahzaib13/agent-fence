import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import {
  createVoiceCall,
  fetchVoiceSession,
  isVoiceCallConfigured,
  VOICE_RATE_LIMIT_MESSAGE,
} from './voice'

vi.mock('./api', () => ({
  api: { post: vi.fn(), get: vi.fn() },
}))

const mockedPost = vi.mocked(api.post)
const mockedGet = vi.mocked(api.get)

describe('createVoiceCall', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_VOICE_CREATE_CALL_URL', 'https://api.example.test/api/v1/voice/create-call')
    vi.stubEnv('VITE_FENCING_CHAT_URL', '')
    vi.stubEnv('VITE_QUOTEMY_API_BASE_URL', 'https://api.example.test')
    mockedPost.mockReset()
    mockedGet.mockReset()
  })

  it('posts with no body when there is no context', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { sessionId: 'server-s1', accessToken: 'tok', configured: true },
    })

    await expect(createVoiceCall()).resolves.toEqual({
      sessionId: 'server-s1',
      accessToken: 'tok',
      configured: true,
    })

    expect(mockedPost).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/voice/create-call',
      undefined,
      expect.objectContaining({ timeout: 30_000 }),
    )
  })

  it('stringifies context fields including checklistAnswered when continuing a brief', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { sessionId: 'server-s2', accessToken: 'tok', configured: true },
    })

    await createVoiceCall({
      checklist: { suburb: 'Berwick', _ui: { page: 1 } },
      place: { suburb: 'Berwick', displayLabel: 'Berwick, VIC 3806' } as never,
      options: [{ label: 'Yes', value: 'yes' }],
      message: 'Which suburb is the job in?',
      checklistDisplay: { suburb: { title: 'Suburb', value: 'Berwick' } },
      checklistAnswered: [{ key: 'suburb', title: 'Suburb', value: 'Berwick' }],
    })

    expect(mockedPost).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/voice/create-call',
      {
        checklist: JSON.stringify({ suburb: 'Berwick', _ui: { page: 1 } }),
        place: JSON.stringify({ suburb: 'Berwick', displayLabel: 'Berwick, VIC 3806' }),
        options: JSON.stringify([{ label: 'Yes', value: 'yes' }]),
        message: JSON.stringify('Which suburb is the job in?'),
        checklistDisplay: JSON.stringify({ suburb: { title: 'Suburb', value: 'Berwick' } }),
        checklistAnswered: JSON.stringify([{ key: 'suburb', title: 'Suburb', value: 'Berwick' }]),
      },
      expect.objectContaining({ timeout: 30_000 }),
    )
  })

  it('returns greeting from create-call so the opener can land before /voice/session', async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        sessionId: 'server-s1',
        accessToken: 'tok',
        configured: true,
        greeting: 'Hi, I can help with your fence.',
      },
    })
    await expect(createVoiceCall()).resolves.toEqual({
      sessionId: 'server-s1',
      accessToken: 'tok',
      configured: true,
      greeting: 'Hi, I can help with your fence.',
    })
  })

  it('accepts access_token and treats configured:false as unavailable', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { sessionId: 'server-s1', access_token: 'snake', configured: false },
    })
    await expect(createVoiceCall()).resolves.toEqual({
      sessionId: 'server-s1',
      accessToken: 'snake',
      configured: false,
    })
  })

  it('throws a rate-limit error on 429', async () => {
    mockedPost.mockRejectedValueOnce(
      new AxiosError('Too Many Requests', '429', undefined, undefined, {
        status: 429,
        statusText: 'Too Many Requests',
        data: {},
        headers: {},
        config: {} as never,
      }),
    )

    await expect(createVoiceCall()).rejects.toMatchObject({
      name: 'VoiceCallError',
      rateLimited: true,
      message: VOICE_RATE_LIMIT_MESSAGE,
    })
  })
})

describe('fetchVoiceSession', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_QUOTEMY_API_BASE_URL', 'https://api.example.test')
    mockedGet.mockReset()
  })

  it('parses offered options on each turn', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        found: true,
        turns: [
          {
            n: 4,
            wrote: 'What type of fence are you after?',
            offered: [{ label: 'Colorbond' }, { label: 'Timber' }],
          },
          { n: 5, chose: 'Colorbond', wrote: 'How long?' },
        ],
        checklist: null,
        options: [],
      },
    })

    await expect(fetchVoiceSession('server-s1')).resolves.toMatchObject({
      found: true,
      turns: [
        {
          n: 4,
          wrote: 'What type of fence are you after?',
          offered: [
            { label: 'Colorbond', value: 'Colorbond' },
            { label: 'Timber', value: 'Timber' },
          ],
        },
        { n: 5, chose: 'Colorbond', wrote: 'How long?' },
      ],
    })
  })

  it('loads the handover payload for a session', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        found: true,
        turns: [{ n: 1, said: 'Colorbond', wrote: 'How long is the fence?', chose: 'Colorbond' }],
        checklist: { suburb: 'Berwick', _ui: { page: 1 } },
        checklistDisplay: { suburb: { title: 'Suburb', value: 'Berwick' } },
        checklistPending: [{ key: 'length', title: 'Fence length' }],
        options: [{ label: 'Yes', value: 'yes' }],
        type: 'confirmation',
        resultId: 'res-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    await expect(fetchVoiceSession('server-s1')).resolves.toEqual({
      found: true,
      turns: [{ n: 1, said: 'Colorbond', wrote: 'How long is the fence?', chose: 'Colorbond' }],
      checklist: { suburb: 'Berwick', _ui: { page: 1 } },
      checklistDisplay: { suburb: { title: 'Suburb', value: 'Berwick' } },
      checklistPending: [{ key: 'length', title: 'Fence length' }],
      place: null,
      options: [{ label: 'Yes', value: 'yes' }],
      type: 'confirmation',
      resultId: 'res-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(mockedGet).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/voice/session?sessionId=server-s1',
      expect.objectContaining({ timeout: 30_000 }),
    )
  })
})

describe('isVoiceCallConfigured', () => {
  it('is true when a QuoteMy base URL is set', () => {
    vi.stubEnv('VITE_QUOTEMY_API_BASE_URL', 'https://api.example.test')
    expect(isVoiceCallConfigured()).toBe(true)
  })
})
