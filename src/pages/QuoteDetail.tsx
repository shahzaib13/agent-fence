import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Header } from '../components/Header'
import { useAuth } from '../hooks/useAuth'
import { loadQuote, type QuoteSession } from '../services/quotes'
import { Home } from './Home'

// Opening a saved quote hands it back to the same screen that produced it. Which screen is the
// caller's choice: /quotes/:id shows the result, /quotes/:id/chat shows the conversation — and
// that conversation is live, not a transcript, so it can be carried on. Home already knows how
// to render both, so this page only has to find the session and hand it over.
export function QuoteDetail({ view = 'result' }: { view?: 'chat' | 'result' }) {
  const { sessionId = '' } = useParams()
  const { user, isLoading: isAuthLoading } = useAuth()
  const [session, setSession] = useState<QuoteSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (isAuthLoading) return
    let current = true
    void loadQuote(sessionId, user?.uid).then((found) => {
      if (!current) return
      setSession(found)
      setIsLoading(false)
    })
    return () => {
      current = false
    }
  }, [sessionId, user, isAuthLoading])

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
        <Header dimmed />
        <p role="status" className="mx-auto px-4 py-24 text-sm text-[#6B7280]">
          Opening your quote…
        </p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
        <Header />
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center gap-4 px-4 pt-24 text-center">
          <h1 className="text-2xl font-semibold text-[#062D27]">That quote isn't here</h1>
          <p className="text-base text-[#6B7280]">
            It may have been started in another browser. Sign in with the number you used, or start a new one.
          </p>
          <Link
            to="/quotes"
            className="rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-medium text-white transition-transform duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Back to your quotes
          </Link>
        </main>
      </div>
    )
  }

  // Keyed so switching between two saved quotes remounts rather than mixing their threads.
  return <Home key={session.sessionId} initialSession={session} initialView={view} />
}
