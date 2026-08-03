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
export function getActiveCardIndex(checklist: ChecklistData | null, checklistComplete: boolean, awaitingResult: boolean) {
  if (awaitingResult) return 3
  if (!checklist) return 0
  if (Object.values(checklist).some((value) => value === null)) return 1
  if (!checklistComplete) return 2
  return 3
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
  if (key === 'lengthMeters') return `${value}m`
  if (key === 'heightMm') return `${value}mm`
  if (key === 'existingPrice') return `$${value}`
  return String(value)
}
