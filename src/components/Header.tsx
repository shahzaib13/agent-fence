import { useState } from 'react'
import { Link } from 'react-router'
import { signOutUser, useAuth } from '../hooks/useAuth'
import { SignInDialog } from './SignInDialog'

export function Header({
  dimmed,
  onNewProject,
  onHome,
}: {
  dimmed?: boolean
  onNewProject?: () => void
  /** Home already being the current route, the router has nothing to navigate to and the page
   *  keeps whatever it was showing — so the pages that live at "/" clear themselves down here
   *  instead. Elsewhere the Link alone is the whole answer. */
  onHome?: () => void
}) {
  const { user, isLoading } = useAuth()
  const [isSigningIn, setIsSigningIn] = useState(false)

  return (
    <header
      className={`flex h-22 w-full items-center justify-between gap-4 px-6 transition-opacity ${dimmed ? 'pointer-events-none opacity-40' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-10">
        <Link
          to="/"
          onClick={onHome}
          className="flex shrink-0 items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#062D27]"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[#062D27]" />
          <span className="text-xl font-bold tracking-tight whitespace-nowrap text-[#062D27]">Aura</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {/* Quotes is a real destination now; the rest are still placeholders. */}
          <Link
            to="/quotes"
            className="rounded text-sm font-medium whitespace-nowrap text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#062D27]"
          >
            Quotes
          </Link>
          {['Projects', 'Standards', 'Pricing'].map((link) => (
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
      <div className="flex shrink-0 items-center gap-4 sm:gap-6">
        {/* Nothing is rendered while Firebase is still restoring the session — showing "Sign in"
            for a moment to somebody who is already signed in reads as having been logged out. */}
        {isLoading ? null : user ? (
          <>
            <span className="hidden text-sm font-medium text-gray-500 sm:inline">{user.phoneE164}</span>
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="rounded text-sm font-medium whitespace-nowrap text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#062D27]"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setIsSigningIn(true)}
            className="rounded text-sm font-medium whitespace-nowrap text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#062D27]"
          >
            Sign in
          </button>
        )}
        <button
          type="button"
          onClick={onNewProject}
          className="rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-medium whitespace-nowrap text-white transition-transform duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
        >
          New project
        </button>
      </div>

      {isSigningIn && <SignInDialog onClose={() => setIsSigningIn(false)} />}
    </header>
  )
}
