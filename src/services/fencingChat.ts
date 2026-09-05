import axios from 'axios'
import { api } from './api'
import type { SuburbPlace } from './places'

/** Shown when the API fails without a customer-facing body (network drop, empty 5xx, etc.). */
export const FENCING_CHAT_FALLBACK_MESSAGE =
  'Sorry, something went wrong on my end — mind trying that again in a moment?'

/** Chat-shaped API error — `message` is written for the customer; `code` is for logs only. */
export class FencingChatError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number | undefined
  readonly sessionId: string | undefined
  readonly checklist: ChecklistData | null | undefined
  readonly checklistComplete: boolean | undefined
  readonly checklistDisplay?: ChecklistDisplay | null
  readonly checklistPending?: import('./voice').ChecklistPendingItem[]
  readonly checklistAnswered?: import('./voice').ChecklistAnsweredItem[]

  constructor(opts: {
    message: string
    code: string
    retryable: boolean
    status?: number
    sessionId?: string
    checklist?: ChecklistData | null
    checklistComplete?: boolean
    checklistDisplay?: ChecklistDisplay | null
    checklistPending?: import('./voice').ChecklistPendingItem[]
    checklistAnswered?: import('./voice').ChecklistAnsweredItem[]
  }) {
    super(opts.message)
    this.name = 'FencingChatError'
    this.code = opts.code
    this.retryable = opts.retryable
    this.status = opts.status
    this.sessionId = opts.sessionId
    this.checklist = opts.checklist
    this.checklistComplete = opts.checklistComplete
    this.checklistDisplay = opts.checklistDisplay
    this.checklistPending = opts.checklistPending
    this.checklistAnswered = opts.checklistAnswered
  }
}

interface FencingChatErrorBody {
  type: 'error'
  message: string
  code?: string
  retryable?: boolean
  sessionId?: string
  checklist?: ChecklistData | null
  checklistComplete?: boolean
  checklistDisplay?: ChecklistDisplay | null
  checklistPending?: import('./voice').ChecklistPendingItem[]
  checklistAnswered?: import('./voice').ChecklistAnsweredItem[]
}

function isErrorBody(data: unknown): data is FencingChatErrorBody {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'error' &&
    typeof (data as { message?: unknown }).message === 'string'
  )
}

function fencingChatErrorFromBody(data: FencingChatErrorBody, status?: number): FencingChatError {
  return new FencingChatError({
    message: data.message.trim() || FENCING_CHAT_FALLBACK_MESSAGE,
    code: typeof data.code === 'string' && data.code ? data.code : 'unknown',
    // Only true when the API says so — retrying a non-retryable code won't help.
    retryable: data.retryable === true,
    status,
    sessionId: data.sessionId,
    checklist: data.checklist,
    checklistComplete: data.checklistComplete,
    checklistDisplay: data.checklistDisplay,
    checklistPending: data.checklistPending,
    checklistAnswered: data.checklistAnswered,
  })
}

/**
 * The option that means "none of these". The workflow offers it wherever a tile row cannot
 * cover every real answer — a fence is whatever length it is — and the client answers it with a
 * text box instead of sending this value anywhere.
 */
export const OTHER_OPTION_VALUE = '__other__'

export interface ChatOption {
  label: string
  // Values are strings and numbers only on the Node API; booleans remain for older saved threads.
  value: string | number | boolean
}

/** A photo the assistant found on someone else's site — never our own work. */
export interface AnswerImage {
  url: string
  thumbUrl: string
  sourceName: string
  width: number
  height: number
}

/** A published per-metre figure. `budgetValue` is what a chip sends back as the turn's message. */
export interface AnswerSource {
  name: string
  figure: string
  perMetreMin?: number
  perMetreMax?: number
  budgetValue: string | null
  url?: string | null
}

/**
 * Optional payload on a turn that answered something of the customer's own.
 * `text` is already prefixed into `message` — do not render it a second time.
 * Presence of `images` / non-null `budgetValue` on a source is the signal, not `kind`.
 */
export interface ChatAnswer {
  text?: string
  kind?: string
  images?: AnswerImage[]
  sources?: AnswerSource[]
}

export function parseAnswerImages(raw: unknown): AnswerImage[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const images: AnswerImage[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const thumbUrl = typeof row.thumbUrl === 'string' ? row.thumbUrl.trim() : ''
    const sourceName = typeof row.sourceName === 'string' ? row.sourceName.trim() : ''
    if (!thumbUrl || !sourceName) continue
    const url = typeof row.url === 'string' ? row.url.trim() : ''
    const width = typeof row.width === 'number' && Number.isFinite(row.width) && row.width > 0 ? row.width : 4
    const height = typeof row.height === 'number' && Number.isFinite(row.height) && row.height > 0 ? row.height : 3
    images.push({ url, thumbUrl, sourceName, width, height })
    if (images.length === 6) break
  }
  return images.length ? images : undefined
}

export function parseAnswerSources(raw: unknown): AnswerSource[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const sources: AnswerSource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const figure = typeof row.figure === 'string' ? row.figure.trim() : ''
    if (!name || !figure) continue
    const budgetValue =
      typeof row.budgetValue === 'string' && row.budgetValue.trim() ? row.budgetValue.trim() : null
    const perMetreMin = typeof row.perMetreMin === 'number' && Number.isFinite(row.perMetreMin) ? row.perMetreMin : undefined
    const perMetreMax = typeof row.perMetreMax === 'number' && Number.isFinite(row.perMetreMax) ? row.perMetreMax : undefined
    const url = typeof row.url === 'string' ? row.url : row.url === null ? null : undefined
    sources.push({ name, figure, budgetValue, perMetreMin, perMetreMax, url })
  }
  return sources.length ? sources : undefined
}

/** Sources a budget chip can send — `budgetValue` is null on advice turns and on figure-less rows. */
export function budgetSources(sources: AnswerSource[] | undefined): Array<AnswerSource & { budgetValue: string }> {
  if (!sources) return []
  return sources.filter((source): source is AnswerSource & { budgetValue: string } => !!source.budgetValue)
}

// Field keys are whatever the checklist object currently has. Fencing also carries a `_ui`
// object for option paging — never display it, always round-trip it verbatim.
export type ChecklistValue = string | number | boolean | null | string[] | Record<string, unknown>
export type ChecklistData = Record<string, ChecklistValue>

export interface WorkerMatch {
  // Firestore uid of the business. Optional only so an older payload degrades to a
  // results page you can look at but not hand your details to.
  businessId?: string
  autoAcceptsAi?: boolean
  businessName: string
  // The customer's own suburb, spelled the way the business's service-area record does.
  suburb?: string
  ratePerMeter: number
  estimatedTotal: number
  notes: string
}

export interface ComparisonQuote {
  /** Firestore uid — what `matchedBusinessIds` on the job document is made of. */
  businessId?: string
  /** Whether this business takes leads from the assistant without reviewing them first. */
  autoAcceptsAi?: boolean
  businessName: string
  ratePerMeter: number
  projectTotalMin: number
  projectTotalMax: number
  leadTimeWeeksMin?: number
  leadTimeWeeksMax?: number
  badges: string[]
  tag: string | null
  savingsFromAverage: number | null
  /** Optional workmanship warranty line from the backend. */
  warranty?: string | null
}

export interface ComparisonSummary {
  potentialSavings: number | null
  marketAverage: number | null
  totalQuotesScreened: number
  userExistingPrice: number | null
  quotes: ComparisonQuote[]
}

export interface ChecklistDisplayRow {
  title: string
  value: string
}

/** Backend-authored brief rows, keyed by field — not an array. */
export type ChecklistDisplay = Record<string, ChecklistDisplayRow>

export interface AlternativeOffer {
  material: string
  materialLabel: string
  heightKey: string
  businessName: string
  estimatedTotal: number
  value: string
}

export interface FencingChatResponse {
  sessionId: string
  // `comparison_result` kept so older saved threads / fixtures still type-check; the Node API
  // only emits message | question | confirmation | result.
  type: 'message' | 'question' | 'confirmation' | 'result' | 'comparison_result'
  message: string
  options: ChatOption[]
  results: WorkerMatch[]
  avgRatePerMeter: number | null
  comparison?: ComparisonSummary | null
  intent?: 'new_quote' | 'compare_quote'
  expects?: 'suburb'
  suggestedSuburb?: string
  checklist?: ChecklistData | null
  /** Ready-made brief rows — prefer over formatting slugs yourself when present. */
  checklistDisplay?: ChecklistDisplay
  checklistAnswered?: import('./voice').ChecklistAnsweredItem[]
  checklistPending?: import('./voice').ChecklistPendingItem[]
  checklistComplete?: boolean
  trade?: string
  place?: SuburbPlace | null
  noMatchReason?: string
  alternatives?: AlternativeOffer[]
  /** Present on the last turn — listen to `quoteResults/{resultId}` for refresh-safe results. */
  resultId?: string
  /** Optional — photos and rate sources. `message` still holds the words; do not also draw `answer.text`. */
  answer?: ChatAnswer
}

/**
 * QuoteMy fencing chat. Prefer `VITE_FENCING_CHAT_URL` (full endpoint), otherwise
 * `{VITE_QUOTEMY_API_BASE_URL}/api/v1/client/fencing-chat`. `VITE_FENCING_CHAT_WEBHOOK_URL`
 * is still accepted as an alias so existing env files keep working.
 */
function fencingChatUrl(): string {
  const explicit =
    (import.meta.env.VITE_FENCING_CHAT_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_FENCING_CHAT_WEBHOOK_URL as string | undefined)?.trim()
  if (explicit) return explicit

  const base = quoteMyApiBase()
  if (base) return `${base}/api/v1/client/fencing-chat`

  throw new Error(
    'Fencing chat API URL is not configured. Set VITE_QUOTEMY_API_BASE_URL or VITE_FENCING_CHAT_URL.',
  )
}

const VALID_TYPES = ['message', 'question', 'confirmation', 'result', 'comparison_result']

/** QuoteMy host, with no trailing slash. Shared with the voice create-call path. */
export function quoteMyApiBase(): string | undefined {
  const explicit =
    (import.meta.env.VITE_FENCING_CHAT_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_FENCING_CHAT_WEBHOOK_URL as string | undefined)?.trim()
  if (explicit) {
    const trimmed = explicit.replace(/\/$/, '')
    const stripped = trimmed.replace(/\/api\/v1\/client\/fencing-chat$/, '')
    return stripped || undefined
  }
  const base = (import.meta.env.VITE_QUOTEMY_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '')
  return base || undefined
}

export function isFencingChatResponse(data: unknown): data is FencingChatResponse {
  if (!data || typeof data !== 'object') return false
  const body = data as { type?: unknown; message?: unknown }
  return typeof body.message === 'string' && typeof body.type === 'string' && VALID_TYPES.includes(body.type)
}

/** Retell metadata may wrap the chat payload, or be the payload itself. */
export function fencingChatFromMetadata(data: unknown): FencingChatResponse | null {
  if (isFencingChatResponse(data)) return data
  if (!data || typeof data !== 'object') return null
  const body = data as { metadata?: unknown; payload?: unknown; data?: unknown }
  if (isFencingChatResponse(body.metadata)) return body.metadata
  if (isFencingChatResponse(body.payload)) return body.payload
  if (isFencingChatResponse(body.data)) return body.data
  return null
}

export function resultIdFromMetadata(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const body = data as { resultId?: unknown; metadata?: { resultId?: unknown } }
  if (typeof body.resultId === 'string' && body.resultId) return body.resultId
  if (typeof body.metadata?.resultId === 'string' && body.metadata.resultId) return body.metadata.resultId
  const nested = fencingChatFromMetadata(data)
  return nested?.resultId
}

/** Carried across turns — only `knownChecklist` and `place` are sent to the API. */
export interface SessionContext {
  knownChecklist?: ChecklistData | null
  place?: SuburbPlace | null
}

/** How `knownChecklist` is encoded — always the last response's checklist, `_ui` and all. */
export function serialiseKnownChecklist(checklist: ChecklistData | null | undefined) {
  if (!checklist) return ''
  return JSON.stringify(checklist)
}

export async function sendFencingChatMessage(
  message: string,
  sessionId: string,
  quoteFiles?: File[] | null,
  session?: SessionContext,
): Promise<FencingChatResponse> {
  const knownChecklist = serialiseKnownChecklist(session?.knownChecklist)
  const place = session?.place ? JSON.stringify(session.place) : ''
  const fields = {
    message,
    sessionId,
    place,
    knownChecklist,
  }

  let payload: FormData | typeof fields
  if (quoteFiles && quoteFiles.length > 0) {
    payload = new FormData()
    for (const [key, value] of Object.entries(fields)) payload.append(key, value)
    for (const file of quoteFiles) {
      payload.append('files', file)
    }
  } else {
    payload = fields
  }

  // Attachments add upload + extraction; the results turn runs a business search.
  const timeout = quoteFiles && quoteFiles.length > 0 ? 180_000 : 90_000
  try {
    const { data } = await api.post<FencingChatResponse>(fencingChatUrl(), payload, { timeout })
    // Errors are chat-shaped too (and may arrive on a 2xx in older proxies). Prefer the body.
    if (isErrorBody(data)) throw fencingChatErrorFromBody(data)
    if (!data || typeof data.message !== 'string' || !VALID_TYPES.includes(data.type)) {
      throw new Error(`Fencing chat API returned an unexpected response shape: ${JSON.stringify(data)}`)
    }
    // An empty string is a valid string, so the shape check above lets it through — and the thread
    // then renders a bubble with nothing in it, which reads as the assistant having died.
    return data.message.trim() ? data : { ...data, message: 'Sorry — could you say that again?' }
  } catch (error) {
    if (error instanceof FencingChatError) throw error
    // Non-2xx: body is still chat-shaped (`type: "error"`). Surface that, not Axios noise.
    if (axios.isAxiosError(error) && isErrorBody(error.response?.data)) {
      throw fencingChatErrorFromBody(error.response.data, error.response.status)
    }
    if (axios.isAxiosError(error)) {
      throw new FencingChatError({
        message: FENCING_CHAT_FALLBACK_MESSAGE,
        code: 'network',
        retryable: true,
        status: error.response?.status,
      })
    }
    throw error
  }
}
