import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimLocalQuotes,
  clearLocalQuotes,
  listQuotes,
  loadLocalQuote,
  loadLocalQuotes,
  loadQuote,
  quoteTitle,
  saveQuote,
  type QuoteSession,
} from './quotes'

const setDoc = vi.fn(async () => {})
const remoteDocs = vi.fn(() => [] as { data: () => QuoteSession }[])

vi.mock('./firebase', () => ({ getDb: async () => ({ db: true }) }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: (...args: unknown[]) => setDoc(...(args as [])),
  getDoc: async () => ({ exists: () => false }),
  getDocs: async () => ({ docs: remoteDocs() }),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
}))

const session = (overrides: Partial<QuoteSession> = {}): QuoteSession => ({
  sessionId: 'sess-1',
  status: 'in_progress',
  createdAt: 1000,
  updatedAt: 1000,
  messages: [{ id: 'm1', role: 'user', text: 'I need a fence' }],
  checklist: null,
  place: null,
  comparison: null,
  ...overrides,
})

const owner = { uid: 'uid-1', phone: '923029447610' }

describe('quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    remoteDocs.mockReturnValue([])
  })

  afterEach(() => localStorage.clear())

  describe('saving', () => {
    it('keeps a guest conversation without any account to attach it to', () => {
      saveQuote(session())

      expect(loadLocalQuotes()).toHaveLength(1)
      expect(setDoc).not.toHaveBeenCalled()
    })

    it('writes both homes once someone is signed in', async () => {
      saveQuote(session(), owner)

      const [stored] = loadLocalQuotes()
      expect(stored).toMatchObject({ uid: 'uid-1', phone: '923029447610' })
      // The remote write is deliberately not awaited — the next chat turn must not wait on it
      await vi.waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    })

    it('does not fail the conversation when the remote write does', async () => {
      setDoc.mockRejectedValueOnce(new Error('offline'))

      expect(() => saveQuote(session(), owner)).not.toThrow()
      await Promise.resolve()
      expect(loadLocalQuotes()).toHaveLength(1)
    })

    it('stamps every save so the newest is the one shown first', () => {
      const saved = saveQuote(session({ updatedAt: 1000 }))

      expect(saved.updatedAt).toBeGreaterThan(1000)
    })

    it('keeps only the twenty most recent conversations', () => {
      for (let index = 0; index < 25; index += 1) {
        saveQuote(session({ sessionId: `sess-${index}`, updatedAt: index }))
      }

      const stored = loadLocalQuotes()
      expect(stored).toHaveLength(20)
      // The oldest fell off, not the newest
      expect(stored.some((s) => s.sessionId === 'sess-24')).toBe(true)
      expect(stored.some((s) => s.sessionId === 'sess-0')).toBe(false)
    })

    it('survives storage that is unreadable rather than losing the turn', () => {
      localStorage.setItem('agent-fence.quotes', 'not json')

      expect(loadLocalQuotes()).toEqual([])
      expect(() => saveQuote(session())).not.toThrow()
      expect(loadLocalQuotes()).toHaveLength(1)
    })
  })

  describe('listing', () => {
    it('merges what Firestore has with what is still only local', async () => {
      saveQuote(session({ sessionId: 'local-only' }))
      remoteDocs.mockReturnValue([{ data: () => session({ sessionId: 'remote-only', updatedAt: 5000 }) }])

      const all = await listQuotes('uid-1')

      expect(all.map((s) => s.sessionId).sort()).toEqual(['local-only', 'remote-only'])
    })

    it('prefers whichever copy was written last', async () => {
      saveQuote(session({ sessionId: 'both', messages: [{ id: 'm1', role: 'user', text: 'newer' }] }))
      remoteDocs.mockReturnValue([
        { data: () => session({ sessionId: 'both', updatedAt: 1, messages: [{ id: 'm1', role: 'user', text: 'older' }] }) },
      ])

      const [merged] = await listQuotes('uid-1')
      expect(merged.messages[0].text).toBe('newer')
    })

    it('still lists the local ones when Firestore cannot be reached', async () => {
      remoteDocs.mockImplementation(() => {
        throw new Error('offline')
      })
      saveQuote(session())

      expect(await listQuotes('uid-1')).toHaveLength(1)
    })

    it('sorts newest first', async () => {
      // Every save stamps Date.now(), so the clock has to actually move between them
      vi.useFakeTimers()
      saveQuote(session({ sessionId: 'older' }))
      vi.advanceTimersByTime(1000)
      saveQuote(session({ sessionId: 'newer' }))
      vi.useRealTimers()

      const all = await listQuotes('uid-1')
      expect(all[0].sessionId).toBe('newer')
    })
  })

  describe('claiming a guest session at sign-in', () => {
    it('hands unowned conversations to the customer who just signed in', async () => {
      saveQuote(session({ sessionId: 'guest' }))

      expect(await claimLocalQuotes(owner)).toBe(1)
      expect(loadLocalQuotes()[0]).toMatchObject({ uid: 'uid-1', phone: '923029447610' })
      expect(setDoc).toHaveBeenCalledTimes(1)
    })

    it("leaves somebody else's quotes alone on a shared browser", async () => {
      saveQuote(session({ sessionId: 'theirs' }), { uid: 'someone-else', phone: '61400000000' })
      await Promise.resolve()
      vi.clearAllMocks()

      expect(await claimLocalQuotes(owner)).toBe(0)
      expect(loadLocalQuotes()[0].uid).toBe('someone-else')
      expect(setDoc).not.toHaveBeenCalled()
    })
  })

  describe('loading one', () => {
    it('reads the local copy without touching the network', async () => {
      saveQuote(session({ sessionId: 'sess-9' }))

      expect((await loadQuote('sess-9'))?.sessionId).toBe('sess-9')
    })

    it('returns nothing for a session this browser has never seen and no account to look under', async () => {
      expect(await loadQuote('unknown')).toBeNull()
    })
  })

  // One browser, more than one customer — a family laptop, an office machine, a phone handed
  // over at a job site. Nothing cached from the last person may reach the next one.
  describe('ownership on a shared browser', () => {
    const someoneElse = { uid: 'someone-else', phone: '61400000000' }

    it("does not list the previous customer's conversations", async () => {
      saveQuote(session({ sessionId: 'theirs' }), someoneElse)
      saveQuote(session({ sessionId: 'mine' }), owner)
      saveQuote(session({ sessionId: 'guest' }))
      await Promise.resolve()

      const listed = await listQuotes('uid-1')

      expect(listed.map((s) => s.sessionId).sort()).toEqual(['guest', 'mine'])
    })

    it("refuses to open somebody else's quote from a direct URL", async () => {
      saveQuote(session({ sessionId: 'theirs' }), someoneElse)
      await Promise.resolve()

      expect(await loadQuote('theirs', 'uid-1')).toBeNull()
    })

    it('never launders an owned quote back into an unowned one', async () => {
      saveQuote(session({ sessionId: 'sess-1' }), owner)
      await Promise.resolve()

      // Exactly what Home does the moment somebody signs out: it rebuilds the session from
      // component state — which carries no uid — and saves it with no owner. Without sticky
      // ownership that write would mark the quote as a guest's, and the next person to sign in
      // on this browser would claim it.
      saveQuote(session({ sessionId: 'sess-1' }))

      expect(loadLocalQuote('sess-1')).toMatchObject({ uid: 'uid-1' })
      expect(await claimLocalQuotes({ uid: 'attacker', phone: '61411111111' })).toBe(0)
    })

    it('leaves nothing behind once the customer signs out', () => {
      saveQuote(session(), owner)

      clearLocalQuotes()

      expect(loadLocalQuotes()).toEqual([])
    })
  })

  describe('quoteTitle', () => {
    it('names a quote by what it is for', () => {
      expect(quoteTitle(session({ checklist: { fenceType: 'Colorbond', suburb: 'Pakenham, VIC 3810' } }))).toBe(
        'Colorbond fence, Pakenham, VIC 3810',
      )
      expect(quoteTitle(session({ checklist: { suburb: 'Pakenham' } }))).toBe('Fence in Pakenham')
    })

    it('falls back to what the customer first asked for, then to a placeholder', () => {
      expect(quoteTitle(session())).toBe('I need a fence')
      expect(quoteTitle(session({ messages: [] }))).toBe('New quote')
    })
  })
})
