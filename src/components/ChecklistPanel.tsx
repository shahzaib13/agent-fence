import type { ChecklistData } from '../services/fencingChat'
import { ChecklistRows } from './ChecklistRows'

export function ChecklistPanel({ checklist }: { checklist: ChecklistData | null }) {
  return (
    <aside className="hidden h-fit flex-col gap-7 rounded-4xl bg-[#F1F4F3] p-9 lg:flex">
      <p className="text-sm font-bold text-[#062D27] uppercase">Building your brief</p>
      {checklist ? (
        <ChecklistRows checklist={checklist} />
      ) : (
        <p className="text-sm text-gray-500">We'll track your project details here as you answer.</p>
      )}
    </aside>
  )
}
