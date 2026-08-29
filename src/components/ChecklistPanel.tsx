import type { ReactNode } from 'react'
import type { ChecklistAnsweredItem, ChecklistPendingItem } from '../services/voice'
import { ChecklistAnsweredRows } from './ChecklistRows'

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

export function ChecklistPanel({
  checklistAnswered,
  checklistPending,
}: {
  checklistAnswered?: ChecklistAnsweredItem[]
  checklistPending?: ChecklistPendingItem[]
}) {
  const hasAnswered = !!checklistAnswered?.length
  const hasPending = !!checklistPending?.length

  return (
    <aside className="hidden flex-col gap-7 overflow-y-auto border-l border-gray-200 bg-[#EFF4F2] px-8 py-10 lg:flex">
      <p className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">Building your brief</p>
      {hasAnswered && <ChecklistAnsweredRows answered={checklistAnswered} />}
      {hasPending && (
        <ul className="flex flex-col gap-4">
          {checklistPending.map((item) => (
            <BriefRow key={item.key} done={false}>
              {item.title}
            </BriefRow>
          ))}
        </ul>
      )}
      {!hasAnswered && !hasPending && (
        <p className="text-sm text-gray-500">We'll track your project details here as you answer.</p>
      )}
      <p className="mt-auto border-t border-gray-300/60 pt-6 text-xs leading-relaxed text-gray-500">
        Photos, PDFs and video walkthroughs are analysed privately. Nothing is shared without your consent.
      </p>
    </aside>
  )
}
