export function ComingSoonScreen({ projectType, onBack }: { projectType: string; onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24 text-center">
      <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#EFF6F5] text-3xl">🚧</span>
      <h1 className="mb-3 text-4xl leading-tight font-semibold tracking-tight text-[#062D27]">
        {projectType} quotes are in development
      </h1>
      <p className="mb-8 max-w-md text-lg text-gray-500">
        We're currently only matching fencing jobs with real local businesses. {projectType} support is coming soon —
        check back shortly.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-full bg-[#062D27] px-6 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
      >
        Get a fencing quote instead
      </button>
    </div>
  )
}
