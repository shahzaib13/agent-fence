import { useRef, useState } from 'react'
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

function buildPrefill(type: string) {
  return `I need a ${type.toLowerCase()} — `
}

export function Home() {
  const [stage, setStage] = useState<Stage>('hero')
  const [description, setDescription] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState(() => generateId())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [intent, setIntent] = useState<'new_quote' | 'compare_quote' | undefined>(undefined)
  const [lastFailedText, setLastFailedText] = useState<string | null>(null)
  const [lastFailedFiles, setLastFailedFiles] = useState<File[] | null>(null)
  const [comparison, setComparison] = useState<ComparisonSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [checklist, setChecklist] = useState<ChecklistData | null>(null)
  const [checklistComplete, setChecklistComplete] = useState(false)
  // The message whose option row just collapsed, waiting to be told which checklist field it filled.
  const pendingAnswerId = useRef<string | null>(null)

  async function sendMessage(apiText: string, quoteFiles?: File[] | null, isFinalConfirm = false) {
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
        knownChecklist: previousChecklist,
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
        return
      }

      setMessages((previous) => [
        ...labelAnswer(previous),
        {
          id: generateId(),
          role: 'ai',
          text: response.message,
          options: response.options,
          checklist: response.checklist ?? previousChecklist,
          isConfirmation: response.type === 'confirmation',
        },
      ])
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

  const handleSend = (text: string) => {
    setMessages((previous) => [...previous, { id: generateId(), role: 'user', text }])
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
    pendingAnswerId.current = null
    setStage('hero')
  }

  // Where every finished conversation lands, whichever intent it ran under (Figma: "Quote
  // Direct Comparison").
  if (comparison) {
    return <QuoteComparisonPage comparison={comparison} intent={intent} onBack={handleRestart} />
  }

  // The thread owns the viewport: the page itself never scrolls, the message list and the
  // brief sidebar each scroll on their own so the composer stays put.
  if (stage === 'chat') {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[#FCFDFD]">
        <Header onNewProject={handleRestart} />
        <div className="grid min-h-0 flex-1 border-t border-gray-200 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <ChatWindow
            messages={messages}
            isLoading={isLoading}
            onSend={handleSend}
            onSelectOption={handleSelectOption}
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
