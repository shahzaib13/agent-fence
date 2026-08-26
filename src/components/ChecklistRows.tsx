import type { ReactNode } from 'react'
import type { ChecklistData, ChecklistDisplay } from '../services/fencingChat'
import { BRIEF_HIDDEN_KEYS, checklistFieldLabel, formatChecklistValue, showsInBrief } from '../utils/checklist'

function BriefRow({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {done ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#059669"
            strokeWidth={2.5}
            className="h-5 w-5 animate-[pop-in_0.35s_ease-out]"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
        )}
      </span>
      <span className={done ? 'font-medium text-[#062D27]' : 'text-gray-400'}>{children}</span>
    </li>
  )
}

/** Backend-authored titles and values. `_ui` is skipped if it ever appears here. */
export function ChecklistDisplayRows({ display }: { display: ChecklistDisplay }) {
  return (
    <ul className="flex flex-col gap-4">
      {Object.entries(display)
        .filter(([key]) => !BRIEF_HIDDEN_KEYS.has(key))
        .map(([key, row]) => (
          <BriefRow key={key} done={row.value.trim().length > 0}>
            {row.value.trim() ? `${row.title}: ${row.value}` : row.title}
          </BriefRow>
        ))}
    </ul>
  )
}

export function ChecklistRows({ checklist }: { checklist: ChecklistData }) {
  return (
    <ul className="flex flex-col gap-4">
      {Object.entries(checklist)
        .filter(([key]) => showsInBrief(key, checklist))
        .map(([key, value]) => {
          const done = value !== null
          return (
            <BriefRow key={key} done={done}>
              {checklistFieldLabel(key)}
              {done ? `: ${formatChecklistValue(key, value)}` : ''}
            </BriefRow>
          )
        })}
    </ul>
  )
}
