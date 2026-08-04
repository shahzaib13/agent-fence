export function Header({ dimmed, onNewProject }: { dimmed?: boolean; onNewProject?: () => void }) {
  return (
    <header
      className={`flex h-22 w-full items-center justify-between gap-4 px-6 transition-opacity ${dimmed ? 'pointer-events-none opacity-40' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-10">
        <span className="flex shrink-0 items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#062D27]" />
          <span className="text-xl font-bold tracking-tight whitespace-nowrap text-[#062D27]">Aura</span>
        </span>
        <nav className="hidden items-center gap-8 md:flex">
          {['Quote', 'Projects', 'Standards', 'Pricing'].map((link) => (
            <a
              key={link}
              href="#"
              className="rounded text-sm font-medium whitespace-nowrap text-gray-500 transition-colors hover:text-gray-700"
            >
              {link}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-6">
        <a href="#" className="text-sm font-medium whitespace-nowrap text-gray-500 hover:text-gray-700">
          Sign in
        </a>
        <button
          type="button"
          onClick={onNewProject}
          className="rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-medium whitespace-nowrap text-white transition-transform duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
        >
          New project
        </button>
      </div>
    </header>
  )
}
