import type {
  ChecklistData,
  ChecklistDisplay,
  ComparisonSummary,
  WorkerMatch,
} from './fencingChat'
import type { SuburbPlace } from './places'
import { getDb } from './firebase'

export interface QuoteResultDoc {
  displayState?: string
  resultId?: string
  type?: string
  message?: string
  results?: WorkerMatch[]
  comparison?: ComparisonSummary | null
  noMatchReason?: string
  place?: SuburbPlace | null
  checklist?: ChecklistData | null
  checklistDisplay?: ChecklistDisplay
  checklistComplete?: boolean
  intent?: 'new_quote' | 'compare_quote'
}

export function isQuoteResultReady(doc: QuoteResultDoc) {
  return doc.displayState === 'ready'
}

/** One-shot read — used to mark a quote complete before the user leaves the results page. */
export async function fetchQuoteResult(resultId: string): Promise<QuoteResultDoc | null> {
  const [{ doc, getDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()])
  const snapshot = await getDoc(doc(db, 'quoteResults', resultId))
  if (!snapshot.exists()) return null
  return snapshot.data() as QuoteResultDoc
}

/**
 * Live results for a finished quote. The HTTP body already carries the same payload; this
 * listener is what makes a refresh (and the end of a voice call) land on the same page.
 */
export async function listenQuoteResult(
  resultId: string,
  onChange: (doc: QuoteResultDoc) => void,
): Promise<() => void> {
  const [{ doc, onSnapshot }, db] = await Promise.all([import('firebase/firestore'), getDb()])
  return onSnapshot(doc(db, 'quoteResults', resultId), (snapshot) => {
    if (!snapshot.exists()) return
    onChange(snapshot.data() as QuoteResultDoc)
  })
}
