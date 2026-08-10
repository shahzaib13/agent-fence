import { Link } from 'react-router'
import { Header } from '../components/Header'

// `vercel.json` rewrites every path to index.html, so a mistyped URL, a stale link and a crawler
// probing /wp-admin all arrive here rather than at a server 404. Without this route they matched
// nothing and React rendered an empty document — no header, no way back, nothing to read.
export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
      <Header />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center gap-4 px-4 pt-24 text-center">
        <p className="text-sm font-bold tracking-[0.6px] text-[#6B7280] uppercase">404</p>
        <h1 className="text-2xl font-semibold text-[#062D27]">This page doesn't exist</h1>
        <p className="text-base text-[#6B7280]">
          The link may be out of date, or the address mistyped. Your saved quotes are still where you left them.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-medium text-white transition-transform duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Start a new quote
          </Link>
          <Link
            to="/quotes"
            className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-semibold text-[#062D27] transition-colors hover:border-[#062D27]/40 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Your quotes
          </Link>
        </div>
      </main>
    </div>
  )
}
