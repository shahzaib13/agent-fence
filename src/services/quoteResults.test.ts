import { describe, expect, it, vi } from 'vitest'
import { fetchQuoteResult, isQuoteResultReady, listenQuoteResult } from './quoteResults'

const onSnapshot = vi.fn()
const getDoc = vi.fn()

vi.mock('./firebase', () => ({ getDb: async () => ({ db: true }) }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  onSnapshot: (...args: unknown[]) => onSnapshot(...args),
  getDoc: (...args: unknown[]) => getDoc(...args),
}))

describe('quoteResults', () => {
  it('treats displayState ready as the render signal', () => {
    expect(isQuoteResultReady({ displayState: 'ready' })).toBe(true)
    expect(isQuoteResultReady({ displayState: 'pending' })).toBe(false)
  })

  it('listens on quoteResults/{resultId}', async () => {
    onSnapshot.mockReturnValue(() => {})
    const unsub = await listenQuoteResult('res-1', () => {})
    expect(onSnapshot).toHaveBeenCalledWith({ path: 'quoteResults/res-1' }, expect.any(Function))
    expect(typeof unsub).toBe('function')
  })

  it('fetches a result document once', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ displayState: 'ready', message: 'Done' }),
    })
    await expect(fetchQuoteResult('res-1')).resolves.toEqual({ displayState: 'ready', message: 'Done' })
    expect(getDoc).toHaveBeenCalledWith({ path: 'quoteResults/res-1' })
  })
})
