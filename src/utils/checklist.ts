import type { ChecklistData, ChecklistDisplay, ChecklistValue } from '../services/fencingChat'
import type { ChecklistAnsweredItem } from '../services/voice'

// How long each ThinkingScreen card holds the spotlight before the reveal steps to the next one —
// shared with Home.tsx so it can hold the loading state open long enough for the whole replay to
// actually finish playing before swapping to the next screen.
export const CARD_STEP_MS = 450

/** Backend-only keys that must never appear in the brief sidebar or PDF. */
export const BRIEF_HIDDEN_KEYS = new Set(['_ui'])

function isSkippedFollowUp(value: ChecklistValue | undefined) {
  return value === null || value === undefined || value === false || value === 'none' || value === 'no'
}

/**
 * Whether a field still belongs on the "building your brief" list.
 *
 * Two of them are in the checklist without being things the brief is waiting on:
 * `existingPrice` is never asked for — it exists only when the customer turned up with a quote
 * of their own. Legacy `siteAccess` prices removal, so with nothing to remove there is nothing
 * to ask. New fencing uses `gateQty` only when a gate type is chosen. Decking only asks
 * `balustradeLm` / `stairFlights` after those extras were chosen.
 */
export function showsInBrief(key: string, checklist: ChecklistData): boolean {
  if (BRIEF_HIDDEN_KEYS.has(key)) return false
  if (checklist[key] !== null && checklist[key] !== undefined) return true
  if (key === 'existingPrice') return false
  if (key === 'siteAccess' && checklist.removeOldFence === false) return false
  if (key === 'gateQty' && isSkippedFollowUp(checklist.gateType)) return false
  if (key === 'balustradeLm' && isSkippedFollowUp(checklist.balustrade)) return false
  if (key === 'stairFlights' && isSkippedFollowUp(checklist.stairs)) return false
  // An empty conditions array means nothing tricky — don't show a pending row for it.
  if (key === 'conditions' && Array.isArray(checklist.conditions) && checklist.conditions.length === 0) return false
  return true
}

export function getActiveCardIndex(checklist: ChecklistData | null, checklistComplete: boolean, awaitingResult: boolean) {
  if (awaitingResult) return 3
  if (!checklist) return 0
  if (Object.keys(checklist).some((key) => checklist[key] === null && showsInBrief(key, checklist))) return 1
  if (!checklistComplete) return 2
  return 3
}

// Which checklist field an answer just filled in. The collapsed chip's *title* comes from
// `checklistAnswered` / `checklistDisplay` on that response — this key only finds the row.
export function diffFilledField(prev: ChecklistData | null, next: ChecklistData | null | undefined) {
  if (!next) return undefined
  return Object.keys(next).find((key) => {
    if (BRIEF_HIDDEN_KEYS.has(key)) return false
    return next[key] !== null && (prev?.[key] ?? null) === null
  })
}

/** Human title for a collapsed chip. Never the raw slug — kitchenSize must not print as kitchenSize. */
export function collapsedChipTitle(
  key: string | undefined,
  answered?: ChecklistAnsweredItem[] | null,
  display?: ChecklistDisplay | null,
): string | undefined {
  if (!key) return undefined
  const fromAnswered = answered?.find((item) => item.key === key)?.title.trim()
  if (fromAnswered) return fromAnswered
  const fromDisplay = display?.[key]?.title.trim()
  if (fromDisplay) return fromDisplay
  return undefined
}

// Brief display of values the server stored — not the chat chips. Units belong on
// `checklistDisplay[field].value`; this path must not invent them from the field name.
const REMOVAL_LABELS: Record<string, string> = {
  any: 'Yes',
  none: 'None',
}

const CONDITION_LABELS: Record<string, string> = {
  sloped: 'Sloped ground',
  rock: 'Rocky ground',
  restricted_access: 'Restricted access',
  hand_dig: 'Hand dig required',
}

export function formatChecklistValue(key: string, value: ChecklistValue, unit?: string | null): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    return value.map((entry) => CONDITION_LABELS[String(entry)] ?? String(entry)).join(', ')
  }
  if (typeof value === 'object') return ''
  if (key === 'removal') {
    const raw = String(value)
    return REMOVAL_LABELS[raw] ?? (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw)
  }
  if (key === 'existingPrice') return `$${value}`
  if (typeof value === 'number' && unit) {
    if (unit === 'm2') return `${value}m²`
    if (unit === 'm') return `${value}m`
  }
  return String(value)
}
