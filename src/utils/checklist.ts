import type { ChecklistData } from '../services/fencingChat'

// How long each ThinkingScreen card holds the spotlight before the reveal steps to the next one —
// shared with Home.tsx so it can hold the loading state open long enough for the whole replay to
// actually finish playing before swapping to the next screen.
export const CARD_STEP_MS = 450

// Which of the 4 thinking-screen cards we should be resting on right now — derived entirely from
// data the workflow already sends on every turn (checklist / checklistComplete), not a fake timer.
// There's no streaming endpoint (single request/response), so this can only reflect what the LAST
// response told us — it can't know about sub-steps mid-request, only where we land once a response
// arrives.
/**
 * Whether a field still belongs on the "building your brief" list.
 *
 * Two of them are in the checklist without being things the brief is waiting on:
 * `existingPrice` is never asked for — it exists only when the customer turned up with a quote
 * of their own, and it is what makes the results a direct comparison. `siteAccess` prices the
 * removal, so with nothing to remove there is nothing to ask. Listing either as an unticked row
 * promises a question that is never coming, and leaves the brief looking permanently unfinished.
 */
export function showsInBrief(key: string, checklist: ChecklistData): boolean {
  if (checklist[key] !== null && checklist[key] !== undefined) return true
  if (key === 'existingPrice') return false
  if (key === 'siteAccess' && checklist.removeOldFence === false) return false
  return true
}

export function getActiveCardIndex(checklist: ChecklistData | null, checklistComplete: boolean, awaitingResult: boolean) {
  if (awaitingResult) return 3
  if (!checklist) return 0
  // Only fields that are actually still coming count as outstanding — otherwise a job with no
  // old fence to remove leaves the reveal stuck on "collecting" forever.
  if (Object.keys(checklist).some((key) => checklist[key] === null && showsInBrief(key, checklist))) return 1
  if (!checklistComplete) return 2
  return 3
}

// Which checklist field an answer just filled in — the only way to label a collapsed answer
// chip ("Fence type: Colorbond"), since the workflow's `options` carry no field name of their
// own. Comparing the checklist before and after the turn is what actually identifies it.
export function diffFilledField(prev: ChecklistData | null, next: ChecklistData | null | undefined) {
  if (!next) return undefined
  return Object.keys(next).find((key) => next[key] !== null && (prev?.[key] ?? null) === null)
}

const FIELD_LABELS: Record<string, string> = {
  suburb: 'Suburb',
  fenceType: 'Fence type',
  lengthMeters: 'Length',
  heightMm: 'Height',
  removeOldFence: 'Remove old fence',
  siteAccess: 'Site access',
  existingPrice: 'Existing quote',
}

export function checklistFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

export function formatChecklistValue(key: string, value: string | number | boolean | null): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  // A bucket answer arrives as the range the customer picked ("20-40", "40+") rather than a
  // number from inside it, so the brief reads back what they actually chose.
  if (key === 'lengthMeters') {
    return typeof value === 'string' && value.endsWith('+') ? `${value.slice(0, -1)}m+` : `${value}m`
  }
  if (key === 'heightMm') return `${value}mm`
  if (key === 'existingPrice') return `$${value}`
  return String(value)
}
