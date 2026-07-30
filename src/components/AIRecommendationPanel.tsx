export function AIRecommendationPanel({ onModify }: { onModify: () => void }) {
  return (
    <aside className="hidden h-fit flex-col gap-5 rounded-4xl border border-gray-100 bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] lg:flex">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold tracking-widest text-gray-700 uppercase">AI Recommendation</p>
        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-600">
          ⚡ Optimized
        </span>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-bold tracking-widest text-gray-400 uppercase">Structural Requirements</p>
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-sm font-semibold text-[#062D27]">Structural Timber & Sandy Soil Footings</p>
          <p className="mt-1 text-xs text-gray-500">H4 Treated Pine posts with 600mm depth as per AS 2870:2011.</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-bold tracking-widest text-gray-400 uppercase">Matching Strategy</p>
        <ul className="flex flex-col gap-2">
          {['Verified AS Standards compliance', 'Proximity to your suburb (under 10km)', 'Specialists in your fence type'].map(
            (line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-gray-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5} className="mt-0.5 h-3.5 w-3.5 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {line}
              </li>
            ),
          )}
        </ul>
      </div>

      <button
        type="button"
        onClick={onModify}
        className="flex items-center gap-1 self-start text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Modify Project Details
      </button>
    </aside>
  )
}
