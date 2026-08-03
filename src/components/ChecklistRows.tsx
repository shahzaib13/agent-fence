import type { ChecklistData } from '../services/fencingChat'
import { checklistFieldLabel, formatChecklistValue } from '../utils/checklist'

export function ChecklistRows({ checklist }: { checklist: ChecklistData }) {
  return (
    <ul className="flex flex-col gap-4">
      {Object.entries(checklist).map(([key, value]) => {
        const done = value !== null
        return (
          <li key={key} className="flex items-center gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {done ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
              )}
            </span>
            <span className={done ? 'font-medium text-[#062D27]' : 'text-gray-400'}>
              {checklistFieldLabel(key)}
              {done ? `: ${formatChecklistValue(key, value)}` : ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
