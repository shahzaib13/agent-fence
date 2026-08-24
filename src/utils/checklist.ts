import type { ChecklistData, ChecklistValue } from '../services/fencingChat'

// How long each ThinkingScreen card holds the spotlight before the reveal steps to the next one —
// shared with Home.tsx so it can hold the loading state open long enough for the whole replay to
// actually finish playing before swapping to the next screen.
export const CARD_STEP_MS = 450

/** Backend-only keys that must never appear in the brief sidebar or PDF. */
export const BRIEF_HIDDEN_KEYS = new Set(['_ui'])

/**
 * Whether a field still belongs on the "building your brief" list.
 *
 * Two of them are in the checklist without being things the brief is waiting on:
 * `existingPrice` is never asked for — it exists only when the customer turned up with a quote
 * of their own. Legacy `siteAccess` prices removal, so with nothing to remove there is nothing
 * to ask. New fencing uses `gateQty` only when a gate type is chosen.
 */
export function showsInBrief(key: string, checklist: ChecklistData): boolean {
  if (BRIEF_HIDDEN_KEYS.has(key)) return false
  if (checklist[key] !== null && checklist[key] !== undefined) return true
  if (key === 'existingPrice') return false
  if (key === 'siteAccess' && checklist.removeOldFence === false) return false
  if (key === 'gateQty' && (checklist.gateType === 'none' || checklist.gateType === null || checklist.gateType === undefined)) {
    return false
  }
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

// Which checklist field an answer just filled in — the only way to label a collapsed answer
// chip ("Fence type: Colorbond"), since the workflow's `options` carry no field name of their
// own. Comparing the checklist before and after the turn is what actually identifies it.
export function diffFilledField(prev: ChecklistData | null, next: ChecklistData | null | undefined) {
  if (!next) return undefined
  return Object.keys(next).find((key) => {
    if (BRIEF_HIDDEN_KEYS.has(key)) return false
    return next[key] !== null && (prev?.[key] ?? null) === null
  })
}

const FIELD_LABELS: Record<string, string> = {
  suburb: 'Suburb',
  fenceType: 'Fence type',
  material: 'Material',
  lengthMeters: 'Length',
  heightMm: 'Height',
  heightKey: 'Height',
  removeOldFence: 'Remove old fence',
  removal: 'Old fence',
  siteAccess: 'Site access',
  conditions: 'Site conditions',
  gateType: 'Gate',
  gateQty: 'Gate count',
  existingPrice: 'Existing quote',
}

export function checklistFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

const REMOVAL_LABELS: Record<string, string> = {
  timber: 'Timber',
  metal: 'Metal',
  none: 'None',
}

const CONDITION_LABELS: Record<string, string> = {
  sloped: 'Sloped ground',
  rock: 'Rocky ground',
  restricted_access: 'Restricted access',
  hand_dig: 'Hand dig required',
}

export function formatChecklistValue(key: string, value: ChecklistValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    return value.map((entry) => CONDITION_LABELS[String(entry)] ?? String(entry)).join(', ')
  }
  if (typeof value === 'object') return ''
  if (key === 'lengthMeters') {
    return typeof value === 'string' && value.endsWith('+') ? `${value.slice(0, -1)}m+` : `${value}m`
  }
  if (key === 'heightMm') return `${value}mm`
  if (key === 'heightKey') return String(value)
  if (key === 'removal') return REMOVAL_LABELS[String(value)] ?? String(value)
  if (key === 'existingPrice') return `$${value}`
  return String(value)
}
