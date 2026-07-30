export function EstimateSidebar() {
  return (
    <aside className="hidden h-fit flex-col gap-8 lg:flex">
      <div className="flex flex-col gap-7 rounded-4xl bg-[#F1F4F3] p-9">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-[#062D27] uppercase">In-Progress Estimate</p>
          <span className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Analysing...
          </span>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-gray-500">Materials (Approx)</p>
          <p className="text-2xl font-bold text-[#062D27]">$4,200.00</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-gray-500">Labour (Est. 4 days)</p>
          <p className="text-2xl font-bold text-[#062D27]">$3,850.00</p>
        </div>

        <div className="border-t border-gray-300/60" />

        <div className="flex items-end justify-between">
          <p className="text-xl font-bold text-[#062D27]">Project Total</p>
          <div className="text-right">
            <p className="text-4xl font-bold text-[#062D27]">$8,050.00*</p>
            <p className="text-xs font-bold tracking-wide text-orange-600 uppercase">Awaiting Site Details</p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-2xl bg-white p-5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[11px] font-bold text-white">
            i
          </span>
          <p className="text-sm leading-relaxed text-gray-700">
            The current total excludes footing depth. Rock soil may increase labour costs by ~15% due to excavation
            difficulty.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <p className="text-sm font-bold text-[#062D27] uppercase">Project Scope</p>
        <ul className="flex flex-col gap-5">
          <li className="flex items-center gap-3 text-gray-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5} className="h-5 w-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Standard Timber Deck (24m²)
          </li>
          <li className="flex items-center gap-3 text-gray-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5} className="h-5 w-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Merbau Finish
          </li>
          <li className="flex items-center gap-3 text-gray-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 shrink-0">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
            </svg>
            Footings (Pending selection)
          </li>
        </ul>
      </div>
    </aside>
  )
}
