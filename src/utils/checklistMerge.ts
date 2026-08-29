import type { ChecklistData, ChecklistDisplay } from '../services/fencingChat'

/** Merge voice/session checklist into the brief. Empty `{}` means "nothing yet" — keep prior. */
export function mergeChecklistData(
  previous: ChecklistData | null,
  next: ChecklistData | null | undefined,
): ChecklistData | null {
  if (next === undefined || next === null) return previous
  if (Object.keys(next).length === 0) return previous
  return { ...(previous ?? {}), ...next }
}

/** Same rule for the display map — a fresh session's empty/null display must not wipe the panel. */
export function mergeChecklistDisplay(
  previous: ChecklistDisplay | null,
  next: ChecklistDisplay | null | undefined,
): ChecklistDisplay | null {
  if (next === undefined || next === null) return previous
  if (Object.keys(next).length === 0) return previous
  return { ...(previous ?? {}), ...next }
}
