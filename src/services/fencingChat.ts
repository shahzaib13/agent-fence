import { api } from './api'

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
  businessName: string
  ratePerMeter: number
  projectTotalMin: number
  projectTotalMax: number
  leadTimeWeeksMin: number
  leadTimeWeeksMax: number
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
  // Running checklist of collected project fields, echoed back on every message/question turn
  // (null once a `result`/`comparison_result` fires). Absent entirely on very old workflow
  // versions, hence optional.
  checklist?: ChecklistData | null
  checklistComplete?: boolean
}

// Vite's built-in DEV/PROD flags (true for `npm run dev`, false for a production build like
// Vercel's) pick the right n8n endpoint automatically — the test webhook locally, the real one
// once deployed. `VITE_FENCING_CHAT_WEBHOOK_URL` still overrides either if ever needed.
const DEFAULT_FENCING_CHAT_WEBHOOK_URL = import.meta.env.DEV
  ? 'https://n8n.srv1506542.hstgr.cloud/webhook-test/fencing-chat-api'
  : 'https://n8n.srv1506542.hstgr.cloud/webhook/fencing-chat-api'

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
  // Every checklist field already established, so the agent is told outright what not to
  // ask about instead of having to remember it.
  knownChecklist?: ChecklistData | null
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
  let payload: FormData | { message: string; sessionId: string; intent?: string; knownChecklist?: string }
  if (quoteFiles && quoteFiles.length > 0) {
    payload = new FormData()
    payload.append('message', message)
    payload.append('sessionId', sessionId)
    if (session?.intent) payload.append('intent', session.intent)
    if (knownChecklist) payload.append('knownChecklist', knownChecklist)
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
    }
  }

  const { data } = await api.post<FencingChatResponse>(FENCING_CHAT_WEBHOOK_URL, payload, { timeout: 30_000 })
  if (!data || typeof data.message !== 'string' || !VALID_TYPES.includes(data.type)) {
    throw new Error(`Fencing chat webhook returned an unexpected response shape: ${JSON.stringify(data)}`)
  }
  return data
}
