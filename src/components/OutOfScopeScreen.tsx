export function OutOfScopeScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24 text-center">
      <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-3xl">⚠️</span>
      <h1 className="mb-3 text-4xl leading-tight font-semibold tracking-tight text-[#062D27]">
        Oops, that's out of scope
      </h1>
      <p className="mb-8 max-w-md text-lg text-gray-500">
        We only handle construction projects — things like fencing, decking, pergolas, driveways and similar building
        work. Try describing your project again, or pick a category below.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-full bg-[#062D27] px-6 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
      >
        Start over
      </button>
    </div>
  )
}
