import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { createVoiceCall, isVoiceCallConfigured } from './voice'

vi.mock('./api', () => ({
  api: { post: vi.fn() },
}))

const mockedPost = vi.mocked(api.post)

describe('createVoiceCall', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_VOICE_CREATE_CALL_URL', 'https://api.example.test/api/v1/voice/create-call')
    vi.stubEnv('VITE_FENCING_CHAT_URL', '')
    vi.stubEnv('VITE_QUOTEMY_API_BASE_URL', 'https://api.example.test')
  })

  it('posts sessionId and stringified place/checklist, and reads camelCase accessToken', async () => {
    mockedPost.mockResolvedValueOnce({ data: { sessionId: 's1', accessToken: 'tok' } })

    await expect(
      createVoiceCall({
        sessionId: 's1',
        knownChecklist: { suburb: 'Berwick', _ui: { page: 0 } },
        message: 'colorbond',
      }),
    ).resolves.toEqual({ sessionId: 's1', accessToken: 'tok' })

    expect(mockedPost).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/voice/create-call',
      {
        sessionId: 's1',
        place: '',
        knownChecklist: JSON.stringify({ suburb: 'Berwick', _ui: { page: 0 } }),
        message: 'colorbond',
      },
      expect.anything(),
    )
  })

  it('accepts access_token as well', async () => {
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'snake' } })
    await expect(createVoiceCall({ sessionId: 's1' })).resolves.toEqual({
      sessionId: 's1',
      accessToken: 'snake',
    })
  })

  it('is configured when a QuoteMy base URL is set', () => {
    expect(isVoiceCallConfigured()).toBe(true)
  })
})
