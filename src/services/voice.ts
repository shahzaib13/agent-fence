import axios from 'axios'
import { api } from './api'
import type { AnswerImage, ChatOption, ChecklistData, ChecklistDisplay, FencingChatResponse } from './fencingChat'
import { parseAnswerImages, quoteMyApiBase, serialiseKnownChecklist } from './fencingChat'
import type { SuburbPlace } from './places'

export interface VoiceCallCredentials {
  sessionId: string
  accessToken: string
  configured: boolean
  greeting?: string
}

export interface VoiceTurn {
  /** Turn number within this call — stable across backend slice(-60) trimming. */
  n?: number
  /** ISO timestamp — interleaves voice bubbles with typed messages chronologically. */
  at?: string
  said?: string
  /** What the assistant said — the only field rendered in the UI. */
  wrote?: string
  /** Audio script — never render; kept for debugging only. */
  spoke?: string
  /** MCQ option the caller picked — answers the *previous* turn's `offered` row, not this turn's question. */
  chose?: string
  /** Options this turn offered — attach to this turn's AI bubble; `chose` on turn n+1 highlights one of these. */
  offered?: ChatOption[]
  /** Example photos for this turn — same strip as typed chat; not MCQ pills. */
  images?: AnswerImage[]
}

export class VoiceCallError extends Error {
  readonly status: number | undefined
  readonly rateLimited: boolean

  constructor(message: string, opts: { status?: number; rateLimited?: boolean } = {}) {
    super(message)
    this.name = 'VoiceCallError'
    this.status = opts.status
    this.rateLimited = opts.rateLimited ?? false
  }
}

export const VOICE_RATE_LIMIT_MESSAGE =
  'Abhi bohat calls ho chuki hain — thodi der baad koshish karein'

/** Committed agent bubble — full spoken words, never the shorter `wrote` summary. */
export function assistantTextFromTurn(turn: VoiceTurn): string | undefined {
  const text = turn.spoke?.trim()
  return text || undefined
}

/** Non-greeting turns only — `n: 0` is the opener and must not count toward live dedup. */
export function committedVoiceTurnCount(turns: VoiceTurn[]): number {
  return turns.filter((turn) => turn.n !== 0 && turn.n !== undefined).length
}

/** Turns not yet merged into the chat — keyed by `n`, not array index. */
export function freshVoiceTurns(turns: VoiceTurn[], lastSeenN: number): VoiceTurn[] {
  return turns.filter((turn) => typeof turn.n === 'number' && turn.n > lastSeenN)
}

export function lastVoiceTurnN(turns: VoiceTurn[], lastSeenN: number): number {
  const last = turns.at(-1)?.n
  return typeof last === 'number' ? last : lastSeenN
}

export interface ChecklistPendingItem {
  key: string
  title: string
}

export interface ChecklistAnsweredItem {
  key: string
  title: string
  value: string
}

export interface VoiceSession {
  found: boolean
  turns: VoiceTurn[]
  checklist?: ChecklistData | null
  checklistDisplay?: ChecklistDisplay | null
  checklistAnswered?: ChecklistAnsweredItem[]
  checklistPending?: ChecklistPendingItem[]
  place?: SuburbPlace | null
  options?: ChatOption[]
  type?: FencingChatResponse['type']
  resultId?: string
  updatedAt?: string
}

/** Optional context so a follow-up call continues the same brief instead of restarting. */
export interface VoiceCallContext {
  checklist?: ChecklistData | null
  place?: SuburbPlace | null
  options?: ChatOption[] | null
  /** Last assistant message in the thread — drives the greeting on mid-conversation calls. */
  message?: string
  checklistDisplay?: ChecklistDisplay | null
  /** Current brief answers — omit and the call reorders the panel on connect. */
  checklistAnswered?: ChecklistAnsweredItem[] | null
}

function voiceApiBase(): string {
  const explicit = (import.meta.env.VITE_VOICE_CREATE_CALL_URL as string | undefined)?.trim()
  if (explicit) {
    const trimmed = explicit.replace(/\/$/, '')
    return trimmed.replace(/\/api\/v1\/voice\/create-call$/, '')
  }

  const base = quoteMyApiBase()
  if (base) return base

  throw new Error(
    'Voice call API URL is not configured. Set VITE_QUOTEMY_API_BASE_URL or VITE_VOICE_CREATE_CALL_URL.',
  )
}

function voiceCreateCallUrl(): string {
  const explicit = (import.meta.env.VITE_VOICE_CREATE_CALL_URL as string | undefined)?.trim()
  if (explicit) return explicit
  return `${voiceApiBase()}/api/v1/voice/create-call`
}

function voiceSessionUrl(sessionId: string): string {
  return `${voiceApiBase()}/api/v1/voice/session?sessionId=${encodeURIComponent(sessionId)}`
}

function accessTokenFrom(data: Record<string, unknown>): string | undefined {
  if (typeof data.accessToken === 'string' && data.accessToken) return data.accessToken
  if (typeof data.access_token === 'string' && data.access_token) return data.access_token
  return undefined
}

function jsonField(value: unknown): string {
  return value === undefined || value === null ? 'null' : JSON.stringify(value)
}

function voiceCreateCallBody(context?: VoiceCallContext): Record<string, string> | undefined {
  if (!context) return undefined

  // Every field is a JSON text value the backend parses once. `message` is already a string —
  // JSON.stringify it like the objects, but never stringify an empty string: that becomes the
  // two-character payload `""`, which is not "no message".
  const message = context.message?.trim() ? context.message.trim() : null
  const checklist = serialiseKnownChecklist(context.checklist)
  const display =
    context.checklistDisplay && Object.keys(context.checklistDisplay).length > 0
      ? context.checklistDisplay
      : null

  return {
    checklist: checklist || 'null',
    place: context.place ? JSON.stringify(context.place) : 'null',
    options: context.options?.length ? JSON.stringify(context.options) : 'null',
    message: jsonField(message),
    checklistDisplay: display ? JSON.stringify(display) : 'null',
    checklistAnswered: JSON.stringify(context.checklistAnswered ?? []),
  }
}

function parseOffered(raw: unknown): ChatOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const items = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const row = entry as { label?: unknown; value?: unknown }
      const label = typeof row.label === 'string' ? row.label.trim() : ''
      if (!label) return null
      const value =
        typeof row.value === 'string' || typeof row.value === 'number' || typeof row.value === 'boolean'
          ? row.value
          : label
      return { label, value }
    })
    .filter((item): item is ChatOption => item !== null)
  return items.length ? items : undefined
}

function parseVoiceTurn(raw: unknown): VoiceTurn | null {
  if (!raw || typeof raw !== 'object') return null
  const turn = raw as Record<string, unknown>
  return {
    n: typeof turn.n === 'number' ? turn.n : undefined,
    at: typeof turn.at === 'string' ? turn.at : undefined,
    said: typeof turn.said === 'string' ? turn.said : undefined,
    wrote: typeof turn.wrote === 'string' ? turn.wrote : undefined,
    spoke: typeof turn.spoke === 'string' ? turn.spoke : undefined,
    chose: typeof turn.chose === 'string' ? turn.chose : undefined,
    offered: parseOffered(turn.offered),
    images: parseAnswerImages(turn.images),
  }
}

/** Starts a Retell call. The server owns sessionId; send context when continuing a brief. */
export async function createVoiceCall(context?: VoiceCallContext): Promise<VoiceCallCredentials> {
  try {
    const { data } = await api.post<Record<string, unknown>>(voiceCreateCallUrl(), voiceCreateCallBody(context), {
      timeout: 30_000,
    })

    const body = data ?? {}
    const configured = body.configured !== false
    const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : ''
    const accessToken = accessTokenFrom(body) ?? ''
    const greeting = typeof body.greeting === 'string' && body.greeting.trim() ? body.greeting.trim() : undefined

    return greeting
      ? { sessionId, accessToken, configured, greeting }
      : { sessionId, accessToken, configured }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      throw new VoiceCallError(VOICE_RATE_LIMIT_MESSAGE, { status: 429, rateLimited: true })
    }
    if (axios.isAxiosError(error)) {
      throw new VoiceCallError('Voice call could not start. Please try again.', { status: error.response?.status })
    }
    throw error
  }
}

function parseChecklistDisplay(raw: unknown): ChecklistDisplay | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'object') return undefined
  return raw as ChecklistDisplay
}

function parseChecklistPending(raw: unknown): ChecklistPendingItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const items = raw.filter(
    (item): item is ChecklistPendingItem =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as ChecklistPendingItem).key === 'string' &&
      typeof (item as ChecklistPendingItem).title === 'string',
  )
  return items.length ? items : undefined
}

function parseChecklistAnswered(raw: unknown): ChecklistAnsweredItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const items = raw.filter(
    (item): item is ChecklistAnsweredItem =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as ChecklistAnsweredItem).key === 'string' &&
      typeof (item as ChecklistAnsweredItem).title === 'string' &&
      typeof (item as ChecklistAnsweredItem).value === 'string',
  )
  return items.length ? items : undefined
}

/** Handover payload after the call ends — turns become chat bubbles. */
export async function fetchVoiceSession(sessionId: string): Promise<VoiceSession> {
  const { data } = await api.get<Record<string, unknown>>(voiceSessionUrl(sessionId), {
    timeout: 30_000,
  })

  const body = data ?? {}
  const turns = Array.isArray(body.turns)
    ? body.turns.map(parseVoiceTurn).filter((turn): turn is VoiceTurn => turn !== null)
    : []

  const type = typeof body.type === 'string' ? (body.type as FencingChatResponse['type']) : undefined
  const resultId = typeof body.resultId === 'string' && body.resultId ? body.resultId : undefined

  return {
    found: body.found === true,
    turns,
    checklist: (body.checklist as ChecklistData | null | undefined) ?? null,
    checklistDisplay: parseChecklistDisplay(body.checklistDisplay),
    checklistAnswered: parseChecklistAnswered(body.checklistAnswered),
    checklistPending: parseChecklistPending(body.checklistPending),
    place: (body.place as SuburbPlace | null | undefined) ?? null,
    options: Array.isArray(body.options) ? (body.options as ChatOption[]) : undefined,
    type,
    resultId,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : undefined,
  }
}

export function isVoiceCallConfigured() {
  try {
    voiceApiBase()
    return true
  } catch {
    return false
  }
}
