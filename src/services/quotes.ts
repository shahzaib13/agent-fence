// Saved quote conversations. Every session is one document, not one per message: a quote runs
// to a dozen or so turns, and a write per turn would cost a dozen times as much to store the
// same thing.
//
// Two homes, because a quote starts before anyone has signed in. localStorage always holds it,
// so a refresh mid-conversation loses nothing; Firestore holds it as well once there is a user
// to attach it to, which is what makes it show up on their other devices. Signing in uploads
// whatever was collected while they were still a guest.
import type { ChatOption, ChecklistData, ComparisonSummary } from './fencingChat'
import type { SuburbPlace } from './places'
import { getDb } from './firebase'

const COLLECTION = 'quotes'
const STORAGE_KEY = 'agent-fence.quotes'
/** Enough to be a history, few enough that localStorage never becomes the problem. */
const LOCAL_LIMIT = 20

/** A chat turn, stripped to what it takes to render the thread again. */
export interface StoredMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  options?: ChatOption[]
  answered?: ChatOption
  answeredField?: string
  isConfirmation?: boolean
  checklist?: ChecklistData | null
  expects?: 'suburb'
}

export interface QuoteSession {
  sessionId: string
  /** 'complete' the moment a comparison comes back; until then the chat can be picked up again. */
  status: 'in_progress' | 'complete'
  /** Epoch milliseconds — the one representation both homes agree on without conversion. */
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
  checklist: ChecklistData | null
  place: SuburbPlace | null
  comparison: ComparisonSummary | null
  intent?: 'new_quote' | 'compare_quote'
  /** Backend trade lock (`fencing`, `tiling`, …). Null until a chip or the backend sets one. */
  trade?: string | null
  /** Set once the session has an owner; absent means it is still a guest's. */
  uid?: string
  phone?: string
}

/** What the list shows for a session, without opening it. */
export function quoteTitle(session: QuoteSession) {
  const { fenceType, suburb } = session.checklist ?? {}
  if (fenceType && suburb) return `${fenceType} fence, ${suburb}`
  if (suburb) return `Fence in ${suburb}`
  const firstAsk = session.messages.find((message) => message.role === 'user')?.text
  return firstAsk?.slice(0, 60) || 'New quote'
}

/* ------------------------------------------------------------------ local half */

function readLocal(): Record<string, QuoteSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, QuoteSession>) : {}
  } catch {
    // Corrupt or unavailable storage is not worth failing a quote over.
    return {}
  }
}

function writeLocal(sessions: Record<string, QuoteSession>) {
  // Oldest go first when the cap is hit — the newest conversation is the one being had.
  const kept = Object.values(sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, LOCAL_LIMIT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept.map((s) => [s.sessionId, s]))))
  } catch {
    // Private mode, or a full quota. The conversation itself carries on regardless.
  }
}

export function loadLocalQuotes(): QuoteSession[] {
  return Object.values(readLocal()).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadLocalQuote(sessionId: string): QuoteSession | null {
  return readLocal()[sessionId] ?? null
}

/**
 * Wipes this browser's copy. Called on sign-out: the Firebase session is only half of what
 * identifies somebody here, and on a shared machine the next person must not be able to read
 * — or claim — the last one's conversations.
 */
export function clearLocalQuotes() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Same as writeLocal: storage being unavailable is not worth failing a sign-out over.
  }
}

/** Whose quote this is, from the caller's point of view. Unowned quotes belong to whoever is here. */
const isReadableBy = (session: QuoteSession, uid?: string) => !session.uid || session.uid === uid

/* ----------------------------------------------------------------- both halves */

/**
 * Records the session. Always locally; also in Firestore when someone is signed in — and
 * deliberately without awaiting that half, since a slow write must never hold up the next chat
 * turn. A failed remote write leaves the local copy to be uploaded at the next sign-in.
 */
export function saveQuote(session: QuoteSession, owner?: { uid: string; phone: string } | null) {
  const stored = readLocal()
  const previous = stored[session.sessionId]
  const owned: QuoteSession = {
    ...session,
    updatedAt: Date.now(),
    // Ownership is sticky. Home rebuilds the session out of component state, which carries no
    // `uid` — so without this, one save from a signed-out screen would launder an owned quote
    // back into an unowned one, and the next person to sign in on this browser would claim it.
    ...(previous?.uid ? { uid: previous.uid, phone: previous.phone } : {}),
    ...(owner ? { uid: owner.uid, phone: owner.phone } : {}),
  }
  writeLocal({ ...stored, [owned.sessionId]: owned })
  if (owner) void saveRemote(owned).catch(() => {})
  return owned
}

async function saveRemote(session: QuoteSession) {
  const [{ doc, setDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()])
  await setDoc(doc(db, COLLECTION, session.sessionId), session, { merge: true })
}

/** Every quote this customer has, newest first — theirs from Firestore plus any still local. */
export async function listQuotes(uid: string): Promise<QuoteSession[]> {
  // Theirs, plus anything still unclaimed from before they signed in. Everything else cached in
  // this browser belongs to whoever used it last, and a shared machine must not hand it over.
  const local = loadLocalQuotes().filter((session) => isReadableBy(session, uid))
  let remote: QuoteSession[] = []
  try {
    const [{ collection, getDocs, query, where }, db] = await Promise.all([import('firebase/firestore'), getDb()])
    const snapshot = await getDocs(query(collection(db, COLLECTION), where('uid', '==', uid)))
    remote = snapshot.docs.map((entry) => entry.data() as QuoteSession)
  } catch {
    // Offline, or rules said no. The local copies are still worth showing.
  }

  // Same session in both places: whichever was written last is the real one.
  const byId = new Map<string, QuoteSession>()
  for (const session of [...remote, ...local]) {
    const existing = byId.get(session.sessionId)
    if (!existing || session.updatedAt > existing.updatedAt) byId.set(session.sessionId, session)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadQuote(sessionId: string, uid?: string): Promise<QuoteSession | null> {
  const local = loadLocalQuote(sessionId)
  if (local) {
    // Cached here, but owned by whoever signed in last — not this customer's to open, however
    // they arrived at the URL. The remote copy carries the same owner, so there is nothing to
    // fall through to either.
    return isReadableBy(local, uid) ? local : null
  }
  if (!uid) return null
  try {
    const [{ doc, getDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()])
    const snapshot = await getDoc(doc(db, COLLECTION, sessionId))
    if (!snapshot.exists()) return null
    const remote = snapshot.data() as QuoteSession
    // Belt and braces. The Firestore rules are what must really enforce this, but a client that
    // happily renders somebody else's quote when the rules turn out to be loose is a bug of its own.
    return isReadableBy(remote, uid) ? remote : null
  } catch {
    return null
  }
}

/**
 * Hands every guest session to the customer who just signed in. Only sessions with no owner are
 * touched — somebody else's quotes on a shared browser stay theirs.
 */
export async function claimLocalQuotes(owner: { uid: string; phone: string }) {
  const unowned = loadLocalQuotes().filter((session) => !session.uid)
  if (unowned.length === 0) return 0

  const stored = readLocal()
  for (const session of unowned) {
    const claimed = { ...session, uid: owner.uid, phone: owner.phone }
    stored[session.sessionId] = claimed
    try {
      await saveRemote(claimed)
    } catch {
      // Left unowned locally would re-upload next time; it is already marked, so it simply
      // waits for the next successful write instead.
    }
  }
  writeLocal(stored)
  return unowned.length
}
