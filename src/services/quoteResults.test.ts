import { describe, expect, it, vi } from 'vitest'
import { isQuoteResultReady, listenQuoteResult } from './quoteResults'

const onSnapshot = vi.fn()

vi.mock('./firebase', () => ({ getDb: async () => ({ db: true }) }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  onSnapshot: (...args: unknown[]) => onSnapshot(...args),
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
})
