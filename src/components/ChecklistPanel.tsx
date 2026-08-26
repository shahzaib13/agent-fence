import type { ChecklistData, ChecklistDisplay } from '../services/fencingChat'
import { ChecklistDisplayRows, ChecklistRows } from './ChecklistRows'

export function ChecklistPanel({
  checklist,
  checklistDisplay,
}: {
  checklist: ChecklistData | null
  checklistDisplay?: ChecklistDisplay | null
}) {
  const hasDisplay = !!checklistDisplay && Object.keys(checklistDisplay).length > 0

  return (
    <aside className="hidden flex-col gap-7 overflow-y-auto border-l border-gray-200 bg-[#EFF4F2] px-8 py-10 lg:flex">
      <p className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">Building your brief</p>
      {hasDisplay ? (
        <ChecklistDisplayRows display={checklistDisplay} />
      ) : checklist ? (
        <ChecklistRows checklist={checklist} />
      ) : (
        <p className="text-sm text-gray-500">We'll track your project details here as you answer.</p>
      )}
      {/* Anchors the panel's bottom edge so it doesn't read as a half-empty column, and puts the
          privacy line back on screen — the page footer that used to carry it is gone in chat. */}
      <p className="mt-auto border-t border-gray-300/60 pt-6 text-xs leading-relaxed text-gray-500">
        Photos, PDFs and video walkthroughs are analysed privately. Nothing is shared without your consent.
      </p>
    </aside>
  )
}
