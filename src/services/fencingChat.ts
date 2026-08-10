import { api } from './api'
import type { SuburbPlace } from './places'

/**
 * The option that means "none of these". The workflow offers it wherever a tile row cannot
 * cover every real answer — a fence is whatever length it is — and the client answers it with a
 * text box instead of sending this value anywhere.
 */
export const OTHER_OPTION_VALUE = '__other__'

export interface ChatOption {
  label: string
  // The real workflow sends non-string values for most MCQ answers (e.g. `heightMm: 1800`,
  // `removeOldFence: true`) — only `suburb` is ever free text. n8n's own "Set" node coerces
  // whatever we echo back in `message` to a string, so this only needs to be accurate here,
  // not converted before sending.
  value: string | number | boolean
}

// Field keys are whatever the workflow's checklist object currently has — new-quote flow
// sends { suburb, fenceType, lengthMeters, heightMm, removeOldFence, siteAccess }, compare-quote
// flow sends { suburb, fenceType, lengthMeters, existingPrice }. Kept generic instead of a fixed
// union so a field being added/renamed on the workflow side doesn't require a frontend type change.
export type ChecklistData = Record<string, string | number | boolean | null>

export interface WorkerMatch {
  // Firestore uid of the business. Optional only so an older workflow export degrades to a
  // results page you can look at but not hand your details to.
  businessId?: string
  autoAcceptsAi?: boolean
  businessName: string
  // The customer's own suburb, spelled the way the business's service-area record does.
  // Optional only so a deployment running an older workflow export degrades to hiding the
  // line rather than showing a wrong one.
  suburb?: string
  ratePerMeter: number
  estimatedTotal: number
  notes: string
}

// One row of the compare_quote flow's "beat my existing quote" results — shape comes from
// the n8n "Rank & Format Comparison Response" node (n8n/fencing-workflow-updated.json).
export interface ComparisonQuote {
  /** Firestore uid — what `matchedBusinessIds` on the job document is made of. */
  businessId?: string
  /** Whether this business takes leads from the assistant without reviewing them first. */
  autoAcceptsAi?: boolean
  businessName: string
  ratePerMeter: number
  projectTotalMin: number
  projectTotalMax: number
  // Still sent by the workflow, but nothing renders it any more — optional so the client-side
  // new-quote mapping isn't forced to invent a lead time it has no data for.
  leadTimeWeeksMin?: number
  leadTimeWeeksMax?: number
  badges: string[]
  tag: string | null
  savingsFromAverage: number | null
}

export interface ComparisonSummary {
  potentialSavings: number | null
  marketAverage: number | null
  totalQuotesScreened: number
  userExistingPrice: number | null
  quotes: ComparisonQuote[]
}

export interface FencingChatResponse {
  sessionId: string
  type: 'message' | 'question' | 'confirmation' | 'result' | 'comparison_result'
  message: string
  options: ChatOption[]
  results: WorkerMatch[]
  avgRatePerMeter: number | null
  comparison?: ComparisonSummary | null
  // Present once n8n's intent-router adds it to its final response nodes. Kept optional
  // since older/other branches may still omit it — routing falls back to `type` when absent.
  intent?: 'new_quote' | 'compare_quote'
  // Which field this turn is asking for, when the answer needs more than free text. Only
  // `suburb` today: it swaps the reply box for a Google-backed suburb picker, because a
  // mistyped suburb doesn't fail loudly — it silently matches zero businesses. Optional, so a
  // workflow export that doesn't send it yet just falls back to plain typing.
  expects?: 'suburb'
  // What the customer said, or what an attached quote document showed, when that turn is asking
  // for the suburb. Never an answer — the picker searches it and still makes them confirm.
  suggestedSuburb?: string
  // Running checklist of collected project fields, echoed back on every message/question turn
  // (null once a `result`/`comparison_result` fires). Absent entirely on very old workflow
  // versions, hence optional.
  checklist?: ChecklistData | null
  checklistComplete?: boolean
}

// The production n8n webhook everywhere, local dev included — the test webhook only answers
// while someone has the n8n canvas open in "listen" mode, so pointing dev at it meant local
// runs failed unless the workflow was being watched. `VITE_FENCING_CHAT_WEBHOOK_URL` overrides
// it (set it to the `/webhook-test/` URL when you *do* want to step through the canvas).
const DEFAULT_FENCING_CHAT_WEBHOOK_URL = 'https://n8n.srv1506542.hstgr.cloud/webhook/fencing-chat-api'

const FENCING_CHAT_WEBHOOK_URL = import.meta.env.VITE_FENCING_CHAT_WEBHOOK_URL ?? DEFAULT_FENCING_CHAT_WEBHOOK_URL

const VALID_TYPES = ['message', 'question', 'confirmation', 'result', 'comparison_result']

// What the client already knows about this conversation, sent back on every turn. The
// workflow's agents have no state of their own beyond a rolling chat-memory window, so
// anything not restated here they have to re-derive from that window — and when they
// fail to, they ask for it a second time.
export interface SessionContext {
  // The flow this session was locked into on its first turn, so the workflow stops
  // re-classifying new_quote vs compare_quote from scratch every turn — a mid-conversation
  // flip hands the brief to the other agent, which keeps a different checklist and so
  // recaps early and then re-asks whatever it never collected.
  intent?: 'new_quote' | 'compare_quote'
  /**
   * How many turns are already in the thread. `0` means this is the opening description, which
   * is the one turn that must not be answered with a checklist question — the workflow asks
   * permission first instead.
   *
   * The workflow cannot work this out for itself: an empty `knownChecklist` looks identical on
   * turn 0 and on turn 1 when the description established nothing, which is exactly the case
   * that would ask for consent twice. The client is the only side that knows.
   */
  turn?: number
  // Every checklist field already established, so the agent is told outright what not to
  // ask about instead of having to remember it.
  knownChecklist?: ChecklistData | null
  // The confirmed Google place behind `checklist.suburb`. The agent doesn't read it — it's
  // carried so postcode/state/coordinates/placeId reach the workflow (and later the lead
  // record) instead of being thrown away the moment the label is sent as text.
  place?: SuburbPlace | null
}

function serialiseKnownChecklist(checklist: ChecklistData | null | undefined) {
  if (!checklist) return null
  const known = Object.entries(checklist).filter(([, value]) => value !== null && value !== undefined)
  return known.length > 0 ? JSON.stringify(Object.fromEntries(known)) : null
}

export async function sendFencingChatMessage(
  message: string,
  sessionId: string,
  quoteFiles?: File[] | null,
  session?: SessionContext,
): Promise<FencingChatResponse> {
  const knownChecklist = serialiseKnownChecklist(session?.knownChecklist)
  const place = session?.place ? JSON.stringify(session.place) : null
  // Sent even when it is 0 — 0 is the value that means something. A truthiness check here would
  // drop exactly the turn the workflow needs to recognise.
  const turn = session?.turn ?? null
  let payload:
    | FormData
    | { message: string; sessionId: string; intent?: string; knownChecklist?: string; place?: string; turn?: number }
  if (quoteFiles && quoteFiles.length > 0) {
    payload = new FormData()
    payload.append('message', message)
    payload.append('sessionId', sessionId)
    if (session?.intent) payload.append('intent', session.intent)
    if (knownChecklist) payload.append('knownChecklist', knownChecklist)
    if (place) payload.append('place', place)
    if (turn !== null) payload.append('turn', String(turn))
    // All files go under the same field name in ONE request — n8n's webhook parses
    // repeated multipart fields into indexed binary keys (quoteFile0, quoteFile1, ...)
    // and its "Split Attachments by Binary Key" node processes them together in a
    // single execution, which is what lets it combine results across files.
    for (const file of quoteFiles) {
      payload.append('quoteFile', file)
    }
  } else {
    payload = {
      message,
      sessionId,
      ...(session?.intent ? { intent: session.intent } : {}),
      ...(knownChecklist ? { knownChecklist } : {}),
      ...(place ? { place } : {}),
      ...(turn !== null ? { turn } : {}),
    }
  }

  const { data } = await api.post<FencingChatResponse>(FENCING_CHAT_WEBHOOK_URL, payload, { timeout: 30_000 })
  if (!data || typeof data.message !== 'string' || !VALID_TYPES.includes(data.type)) {
    throw new Error(`Fencing chat webhook returned an unexpected response shape: ${JSON.stringify(data)}`)
  }
  // An empty string is a valid string, so the shape check above lets it through — and the thread
  // then renders a bubble with nothing in it, which reads as the assistant having died. The
  // workflow is meant to guarantee a message and mostly does; this is the belt to that braces,
  // because a blank turn is the one failure the customer cannot interpret or recover from.
  return data.message.trim() ? data : { ...data, message: 'Sorry — could you say that again?' }
}
