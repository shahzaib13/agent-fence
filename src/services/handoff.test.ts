import { beforeEach, describe, expect, it, vi } from 'vitest'
import { partnerSiteUrl } from './handoff'

const getIdToken = vi.fn()
vi.mock('./firebase', () => ({
  getAuthClient: vi.fn(async () => ({
    currentUser: { getIdToken },
  })),
}))

describe('partnerSiteUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    getIdToken.mockReset()
    getIdToken.mockResolvedValue('id-token-abc')
  })

  it('returns the partner URL with #t= custom token from createHandoff', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: 'custom.jwt.token' }), { status: 200 }),
    )

    await expect(partnerSiteUrl()).resolves.toBe(
      'https://quotemy-ai.web.app/app#t=custom.jwt.token',
    )
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/createHandoff/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ idToken: 'id-token-abc' }),
      }),
    )
  })

  it('encodes the token in the hash and never uses a query string', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: 'a+b/c=' }), { status: 200 }),
    )

    const url = await partnerSiteUrl()
    expect(url).toContain('#t=')
    expect(url).not.toContain('?t=')
    expect(url).toBe(`https://quotemy-ai.web.app/app#t=${encodeURIComponent('a+b/c=')}`)
  })

  it('throws when there is no signed-in user — never returns bare /app', async () => {
    getIdToken.mockResolvedValue(undefined)
    const { getAuthClient } = await import('./firebase')
    vi.mocked(getAuthClient).mockResolvedValueOnce({ currentUser: null } as never)

    await expect(partnerSiteUrl()).rejects.toThrow(/sign-in expired/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws when the handoff endpoint fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 401 }))

    await expect(partnerSiteUrl()).rejects.toThrow(/couldn't open your quotemy session/i)
  })

  it('throws when the handoff endpoint returns no token', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

    await expect(partnerSiteUrl()).rejects.toThrow(/no sign-in token/i)
  })
})
