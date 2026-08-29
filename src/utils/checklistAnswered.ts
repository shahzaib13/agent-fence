import type { ChecklistDisplay } from '../services/fencingChat'
import type { ChecklistAnsweredItem } from '../services/voice'
import { BRIEF_HIDDEN_KEYS } from './checklist'

/** Fallback when the API has not deployed `checklistAnswered` yet. */
export function checklistAnsweredFromDisplay(display: ChecklistDisplay | null | undefined): ChecklistAnsweredItem[] {
  if (!display) return []
  return Object.entries(display)
    .filter(([key, row]) => !BRIEF_HIDDEN_KEYS.has(key) && row.value.trim().length > 0)
    .map(([key, row]) => ({ key, title: row.title, value: row.value }))
}
