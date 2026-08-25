import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Header } from '../components/Header'
import { useAuth } from '../hooks/useAuth'
import { listQuotes, loadLocalQuotes, quoteTitle, type QuoteSession } from '../services/quotes'

const relativeDay = (timestamp: number) => {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function Quotes() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<QuoteSession[] | null>(null)

  useEffect(() => {
    if (isAuthLoading) return
    // A guest still has a history — it just lives in this browser rather than in an account.
    if (!user) {
      setSessions(loadLocalQuotes())
      return
    }
    let current = true
    void listQuotes(user.uid).then((found) => {
      if (current) setSessions(found)
    })
    return () => {
      current = false
    }
  }, [user, isAuthLoading])

  return (
    <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
      <Header onNewProject={() => void navigate('/')} />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-10 pb-24 sm:pt-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl leading-tight font-semibold tracking-tight text-[#062D27] sm:text-4xl">Your quotes</h1>
            <p className="mt-2 text-base text-[#6B7280]">
              {user ? 'Every quote on this number.' : 'Saved in this browser. Sign in to keep them on every device.'}
            </p>
          </div>
          <Link
            to="/"
            className="rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-medium whitespace-nowrap text-white transition-transform duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Start a new quote
          </Link>
        </div>

        {sessions === null ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-24 rounded-3xl border border-[#F3F4F6] bg-white" />
            ))}
            <span className="sr-only">Loading your quotes</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-3xl border border-[#F3F4F6] bg-white p-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <p className="text-base text-[#062D27]">No quotes yet.</p>
            <p className="mt-1 text-sm text-[#6B7280]">
              Describe a fencing job and the ones you start will show up here — finished or not.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {sessions.map((session) => {
              const isComplete = session.status === 'complete'
              return (
                <li
                  key={session.sessionId}
                  className="flex flex-col gap-4 rounded-3xl border border-[#F3F4F6] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow duration-150 hover:shadow-[0_8px_24px_rgba(6,45,39,0.07)] sm:p-6"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-lg font-semibold text-[#062D27]">{quoteTitle(session)}</h2>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase ${
                          isComplete ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#F1F4F3] text-[#6B7280]'
                        }`}
                      >
                        {isComplete ? 'Quoted' : 'In progress'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#6B7280]">
                      <span>{relativeDay(session.updatedAt)}</span>
                      <span>
                        {session.messages.length} message{session.messages.length === 1 ? '' : 's'}
                      </span>
                      {isComplete && session.comparison?.quotes[0] && (
                        <span>
                          {session.comparison.quotes.length} business
                          {session.comparison.quotes.length === 1 ? '' : 'es'} from $
                          {session.comparison.quotes[0].projectTotalMin.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Two ways in, because a finished quote is two things: the numbers, and the
                      conversation that produced them — which can still be carried on. */}
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to={`/quotes/${session.sessionId}/chat`}
                      className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-semibold text-[#062D27] transition-colors hover:border-[#062D27]/40 hover:bg-[#F1F4F3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
                    >
                      {isComplete ? 'View chat' : 'Continue chat'}
                    </Link>
                    {isComplete && (
                      <Link
                        to={`/quotes/${session.sessionId}`}
                        className="rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
                      >
                        View results
                      </Link>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}

