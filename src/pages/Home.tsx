import { useEffect, useRef, useState } from 'react'
import { ChatWindow, type ChatMessage } from '../components/ChatWindow'
import { ChecklistPanel } from '../components/ChecklistPanel'
import { ComingSoonScreen } from '../components/ComingSoonScreen'
import { Header } from '../components/Header'
import { HeroInputScreen } from '../components/HeroInputScreen'
import { QuoteComparisonPage } from '../components/QuoteComparisonPage'
import { ThinkingScreen } from '../components/ThinkingScreen'
import {
  sendFencingChatMessage,
  type ChatOption,
  type ChecklistData,
  type ComparisonSummary,
} from '../services/fencingChat'
import { isPlacesConfigured, newSessionToken, searchSuburbs, suburbSearchQuery, type SuburbPlace } from '../services/places'
import { saveQuote, type QuoteSession } from '../services/quotes'
import { useAuth } from '../hooks/useAuth'
import { diffFilledField } from '../utils/checklist'
import { workerMatchesToComparison } from '../utils/comparison'
import { generateId } from '../utils/id'

// The whole conversation now happens in the chat thread — `thinking` only plays once, after the
// user has confirmed their brief and the workflow goes off to rank businesses. There is no
// `results` stage: both flows finish on the comparison page, which renders off `comparison`
// state rather than off a stage.
type Stage = 'hero' | 'coming-soon' | 'chat' | 'thinking'

// Only Fence is wired to a real backend today — every other type gets the "coming soon" screen.
const LIVE_PROJECT_TYPE = 'Fence'

// A turn that is asking where the job is. The workflow says so with `expects`, but the client
// does not depend on it getting that right: a suburb typed as free text silently matches zero
// businesses, so the wording is checked here too.
const ASKS_FOR_SUBURB = /suburbs?|post ?code|whereabouts/i

function buildPrefill(type: string) {
  return `I need a ${type.toLowerCase()} — `
}

// A conversation being reopened from the Quotes tab, or nothing for a fresh one.
export function Home({
  initialSession,
  initialView = 'result',
}: {
  initialSession?: QuoteSession | null
  /** Which face of a reopened quote to show first — its result, or its conversation. */
  initialView?: 'chat' | 'result'
}) {
  const { user } = useAuth()
  const [stage, setStage] = useState<Stage>(initialSession ? 'chat' : 'hero')
  const [description, setDescription] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState(() => initialSession?.sessionId ?? generateId())
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialSession?.messages ?? [])
  const [intent, setIntent] = useState<'new_quote' | 'compare_quote' | undefined>(initialSession?.intent)
  const [lastFailedText, setLastFailedText] = useState<string | null>(null)
  const [lastFailedFiles, setLastFailedFiles] = useState<File[] | null>(null)
  const [comparison, setComparison] = useState<ComparisonSummary | null>(initialSession?.comparison ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [checklist, setChecklist] = useState<ChecklistData | null>(initialSession?.checklist ?? null)
  const [checklistComplete, setChecklistComplete] = useState(false)
  // Stays put across every save, so reopening a quote doesn't keep resetting when it began.
  const startedAt = useRef(initialSession?.createdAt ?? Date.now())
  // A finished quote has two faces and the customer picks which one they are looking at. The
  // conversation is not a transcript: answering again from there re-runs the quote.
  const [view, setView] = useState<'chat' | 'result'>(initialView)
  // The Google place behind the suburb the customer picked. Kept for the whole session so
  // postcode/state/coordinates ride along on every later turn, not just the one that set it.
  const [place, setPlace] = useState<SuburbPlace | null>(initialSession?.place ?? null)
  // The message whose option row just collapsed, waiting to be told which checklist field it filled.
  const pendingAnswerId = useRef<string | null>(null)

  // The whole conversation is one record, rewritten whenever it changes — a dozen turns is a
  // small document, and a write per message would cost a dozen times as much to store the same
  // thing. Nothing is saved until the customer has actually said something.
  useEffect(() => {
    if (messages.length === 0) return
    saveQuote(
      {
        sessionId,
        status: comparison ? 'complete' : 'in_progress',
        createdAt: startedAt.current,
        updatedAt: Date.now(),
        messages: messages.map(({ id, role, text, options, answered, answeredField, isConfirmation, checklist: turnChecklist, expects }) => ({
          id,
          role,
          text,
          options,
          answered,
          answeredField,
          isConfirmation,
          checklist: turnChecklist,
          expects,
        })),
        checklist,
        place,
        comparison,
        intent,
      },
      user,
    )
  }, [messages, checklist, place, comparison, intent, sessionId, user])

  async function sendMessage(
    apiText: string,
    quoteFiles?: File[] | null,
    isFinalConfirm = false,
    // Passed explicitly by the turn that just confirmed a suburb — `place` state hasn't
    // re-rendered yet at that point.
    confirmedPlace?: SuburbPlace | null,
  ) {
    setIsLoading(true)
    // Captured before the request so the response can be diffed against it — that diff is what
    // labels the answer chip the user just collapsed.
    const previousChecklist = checklist
    const answeredId = pendingAnswerId.current
    pendingAnswerId.current = null
    if (isFinalConfirm) setStage('thinking')

    try {
      const response = await sendFencingChatMessage(apiText, sessionId, quoteFiles, {
        intent,
        // A suburb with no place behind it is not established, however confident the agent was
        // when it wrote it down. Withholding it is what makes the agent ask again instead of
        // building a whole brief on a name that was never on the map.
        knownChecklist:
          (confirmedPlace ?? place) || !previousChecklist
            ? previousChecklist
            : { ...previousChecklist, suburb: null },
        place: confirmedPlace ?? place,
      })
      // Locked on the first turn that declares one, never overwritten afterwards. The workflow
      // re-runs its new_quote/compare_quote classifier on every single turn, and a flip
      // mid-conversation hands the brief to the other agent — which keeps its own, shorter
      // checklist, so it recaps early and then re-asks whatever it never collected.
      if (response.intent && !intent) setIntent(response.intent)
      // Only overwrite when this turn actually carries a checklist — a "what should I fix?"
      // acknowledgement or similar aside may legitimately omit it. Keeping the last-known
      // checklist means the sidebar never blanks out mid-conversation.
      if (response.checklist) setChecklist(response.checklist)
      setChecklistComplete(response.checklistComplete ?? false)

      const filledField = diffFilledField(previousChecklist, response.checklist)
      const labelAnswer = (previous: ChatMessage[]) =>
        answeredId && filledField
          ? previous.map((m) => (m.id === answeredId ? { ...m, answeredField: filledField } : m))
          : previous

      // Page routing (comparison vs. new-quote flow) depends only on `intent`. `type`
      // never decides which page shows — it just describes the payload (result/message/
      // question/etc.) within whichever flow `intent` has already picked. Guarded by
      // `response.comparison` actually being present: if n8n tags a response
      // `intent: 'compare_quote'` without a comparison object (a malformed/inconsistent
      // payload), there's nothing to show on that page — fall back to reading `type`
      // instead of leaving the UI stuck on stale state.
      if (response.intent === 'compare_quote' && response.comparison) {
        setComparison(response.comparison)
        setView('result')
        return
      }
      // A `result` with nothing in it is the workflow explaining why — no business covers their
      // suburb, or none of the ones that do offer that fence type. That belongs back in the
      // thread, where they can correct the suburb or fence type in one line, not on an empty
      // results page where the explanation would never be shown at all.
      // Matches from the new-quote flow are folded into the same comparison shape, so both
      // intents finish on one page instead of two layouts that have to be kept in step.
      if (response.type === 'result' && response.results.length > 0) {
        setComparison(workerMatchesToComparison(response.results))
        setView('result')
        return
      }

      // Any turn that asks about the suburb gets the picker — including "what's the correct
      // suburb?" halfway through, when one has already been confirmed and is being changed. A
      // place picked from Google is the only thing that counts as an answer here, so the client
      // decides this rather than waiting for the workflow to remember `expects`.
      const expectsSuburb =
        isPlacesConfigured() && (response.expects === 'suburb' || ASKS_FOR_SUBURB.test(response.message))
      const turnId = generateId()

      setMessages((previous) => [
        ...labelAnswer(previous),
        {
          id: turnId,
          role: 'ai',
          text: response.message,
          options: response.options,
          checklist: response.checklist ?? previousChecklist,
          isConfirmation: response.type === 'confirmation',
          expects: expectsSuburb ? 'suburb' : undefined,
        },
      ])
      // A place the customer already named — in passing, or on the quote document they
      // attached — becomes the picker's opening search, so confirming it is one tap instead of
      // typing it out a second time. It is still only a head start: nothing counts until they
      // pick from Google's list.
      if (expectsSuburb && response.suggestedSuburb) void prefillSuburb(turnId, response.suggestedSuburb)
      // A non-result reply to the final "yes" (n8n asking one more thing) drops back into the
      // thread rather than leaving the thinking screen spinning on nothing.
      setStage('chat')
    } catch (error) {
      console.error('Fencing chat webhook request failed:', error)
      setLastFailedText(apiText)
      setLastFailedFiles(quoteFiles ?? null)
      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'ai',
          text: 'Sorry, something went wrong on my end — mind trying that again in a moment?',
          isError: true,
        },
      ])
      setStage('chat')
    } finally {
      setIsLoading(false)
    }
  }

  // An MCQ pick is its own record in the thread — the tile row collapses to the chosen answer,
  // so it deliberately does *not* also push a user bubble echoing the same thing back.
  const handleSelectOption = (messageId: string, option: ChatOption) => {
    if (isLoading) return
    const target = messages.find((m) => m.id === messageId)
    pendingAnswerId.current = messageId
    setMessages((previous) => previous.map((m) => (m.id === messageId ? { ...m, answered: option } : m)))
    void sendMessage(String(option.value), undefined, !!target?.isConfirmation && String(option.value) === 'yes')
  }

  // A suburb the customer picked from Google, rather than one they typed. `answeredField` is
  // set outright instead of being diffed out of the next checklist — this turn is the suburb
  // by definition, so the chip never has to wait a round trip to know what it filled in.
  const handleSelectPlace = (messageId: string, selected: SuburbPlace) => {
    if (isLoading) return
    setPlace(selected)
    setMessages((previous) =>
      previous.map((m) =>
        m.id === messageId
          ? { ...m, answered: { label: selected.displayLabel, value: selected.displayLabel }, answeredField: 'suburb' }
          : m,
      ),
    )
    void sendMessage(selected.displayLabel, undefined, false, selected)
  }

  // While a suburb is outstanding the composer stops being a straight line to the workflow:
  // whatever gets typed is looked up against Google first, and only a place the customer then
  // confirms is sent on. A typo that would have quietly matched zero businesses gets caught
  // here, without spending a workflow turn on it.
  /** Fills the picker on an existing turn with what Google makes of a place already named. */
  async function prefillSuburb(messageId: string, text: string) {
    const sessionToken = newSessionToken()
    try {
      const suggestions = await searchSuburbs(suburbSearchQuery(text), sessionToken)
      if (suggestions.length === 0) return
      setMessages((previous) =>
        previous.map((message) =>
          message.id === messageId ? { ...message, suggestions, query: text, sessionToken } : message,
        ),
      )
    } catch {
      // The picker still works by typing — a failed head start is not worth an error message.
    }
  }

  async function resolveTypedSuburb(text: string) {
    setIsLoading(true)
    const sessionToken = newSessionToken()
    try {
      // A quote document carries a whole street address, which a region search matches nothing
      // against — so the searchable part is pulled out first, and the raw text is only tried
      // again if that finds nothing.
      const query = suburbSearchQuery(text)
      let suggestions = await searchSuburbs(query, sessionToken)
      if (suggestions.length === 0 && query !== text) suggestions = await searchSuburbs(text, sessionToken)
      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'ai',
          text: suggestions.length
            ? "Here's what I found in Australia — which one is yours?"
            : `I couldn't find "${text}" as an Australian suburb. Try the suburb name on its own, or its postcode.`,
          expects: 'suburb',
          suggestions,
          query: text,
          sessionToken,
        },
      ])
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'ai',
          text: "Suburb search isn't responding right now. Type your suburb again in a moment.",
          expects: 'suburb',
          query: text,
          sessionToken,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = (text: string) => {
    setMessages((previous) => [...previous, { id: generateId(), role: 'user', text }])
    const lastAi = messages.findLast((m) => m.role === 'ai')
    // Typed into the composer instead of the picker: look it up rather than sending it on. The
    // suburb only ever reaches the workflow as a place the customer confirmed from Google's
    // suggestions — that is the whole point of asking for it this way.
    const isSuburbTurn = lastAi?.expects === 'suburb' || (!!lastAi && ASKS_FOR_SUBURB.test(lastAi.text))
    if (isPlacesConfigured() && isSuburbTurn && !lastAi?.answered) {
      void resolveTypedSuburb(text)
      return
    }
    void sendMessage(text)
  }

  const handleRetry = () => {
    if (!lastFailedText) return
    setMessages((previous) => previous.filter((m) => !m.isError))
    void sendMessage(lastFailedText, lastFailedFiles)
  }

  const handleHeroSubmit = (quoteFiles: File[]) => {
    // Only an explicit chip click routes to "coming soon" now — free-typed descriptions
    // always go straight to the real fencing flow. n8n's own agent enforces the
    // fencing-only scope (and declines/redirects conversationally) instead of a
    // client-side keyword guess.
    const effectiveType = selectedType ?? LIVE_PROJECT_TYPE

    if (effectiveType !== LIVE_PROJECT_TYPE) {
      setSelectedType(effectiveType)
      setStage('coming-soon')
      return
    }
    setStage('chat')
    setMessages([{ id: generateId(), role: 'user', text: description }])
    void sendMessage(description, quoteFiles)
  }

  const handleRestart = () => {
    setSessionId(generateId())
    setMessages([])
    setIntent(undefined)
    setLastFailedText(null)
    setLastFailedFiles(null)
    setComparison(null)
    setDescription('')
    setSelectedType(null)
    setChecklist(null)
    setChecklistComplete(false)
    setPlace(null)
    pendingAnswerId.current = null
    startedAt.current = Date.now()
    setStage('hero')
  }

  // Where every finished conversation lands, whichever intent it ran under (Figma: "Quote
  // Direct Comparison").
  if (comparison && view === 'result') {
    return (
      <QuoteComparisonPage
        comparison={comparison}
        intent={intent}
        place={place}
        onBack={handleRestart}
        onViewChat={() => setView('chat')}
      />
    )
  }

  // The thread owns the viewport: the page itself never scrolls, the message list and the
  // brief sidebar each scroll on their own so the composer stays put.
  if (stage === 'chat') {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[#FCFDFD]">
        <Header onNewProject={handleRestart} />
        {/* Only once a quote exists: the way back to it, and a reminder that carrying the
            conversation on will produce a new one. */}
        {comparison && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#D1FAE5] bg-[#ECFDF5] px-6 py-3 sm:px-10">
            <p className="text-sm text-[#047857]">
              This quote is ready. Keep chatting to change it, or go back to your results.
            </p>
            <button
              type="button"
              onClick={() => setView('result')}
              className="rounded-full bg-[#059669] px-4 py-2 text-sm font-semibold whitespace-nowrap text-white transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#047857]"
            >
              View results
            </button>
          </div>
        )}
        <div className="grid min-h-0 flex-1 border-t border-gray-200 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <ChatWindow
            messages={messages}
            isLoading={isLoading}
            onSend={handleSend}
            onSelectOption={handleSelectOption}
            onSelectPlace={handleSelectPlace}
            onRetry={handleRetry}
          />
          <ChecklistPanel checklist={checklist} />
        </div>
      </div>
    )
  }

  if (stage === 'thinking') {
    return (
      <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
        <Header dimmed />
        <ThinkingScreen
          description={description}
          checklist={checklist}
          checklistComplete={checklistComplete}
          awaitingResult
          intent={intent}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
      <Header onNewProject={handleRestart} />

      {stage === 'hero' && (
        <HeroInputScreen
          description={description}
          onDescriptionChange={setDescription}
          selectedType={selectedType}
          onSelectType={(type) => {
            setDescription((d) => {
              const isEmpty = !d.trim()
              const matchesPriorPrefill = selectedType !== null && d === buildPrefill(selectedType)
              return isEmpty || matchesPriorPrefill ? buildPrefill(type) : d
            })
            setSelectedType(type)
          }}
          onSubmit={handleHeroSubmit}
        />
      )}

      {stage === 'coming-soon' && (
        <ComingSoonScreen projectType={selectedType ?? 'This'} onBack={handleRestart} />
      )}

      <footer className="flex justify-center py-8">
        <p className="text-xs text-gray-400">
          Photos, PDFs and video walkthroughs are analysed privately. Nothing is shared without your consent.
        </p>
      </footer>
    </div>
  )
}
