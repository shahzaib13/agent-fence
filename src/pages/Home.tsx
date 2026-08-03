import { useState } from 'react'
import { AIRecommendationPanel } from '../components/AIRecommendationPanel'
import { ChecklistPanel } from '../components/ChecklistPanel'
import { ComingSoonScreen } from '../components/ComingSoonScreen'
import { ConfirmationCard } from '../components/ConfirmationCard'
import { Header } from '../components/Header'
import { HeroInputScreen } from '../components/HeroInputScreen'
import { OutOfScopeScreen } from '../components/OutOfScopeScreen'
import { QuizCard } from '../components/QuizCard'
import { QuoteComparisonPage } from '../components/QuoteComparisonPage'
import { ResultsPanel } from '../components/ResultsPanel'
import { ThinkingScreen } from '../components/ThinkingScreen'
import {
  sendFencingChatMessage,
  type ChatOption,
  type ChecklistData,
  type ComparisonSummary,
  type WorkerMatch,
} from '../services/fencingChat'
import { generateId } from '../utils/id'

type Stage = 'hero' | 'coming-soon' | 'out-of-scope' | 'quiz'

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
  const [currentMessage, setCurrentMessage] = useState('')
  const [currentOptions, setCurrentOptions] = useState<ChatOption[] | null>(null)
  const [currentType, setCurrentType] = useState<string | null>(null)
  const [currentIntent, setCurrentIntent] = useState<'new_quote' | 'compare_quote' | undefined>(undefined)
  const [hasError, setHasError] = useState(false)
  const [lastFailedText, setLastFailedText] = useState<string | null>(null)
  const [lastFailedFiles, setLastFailedFiles] = useState<File[] | null>(null)
  const [results, setResults] = useState<WorkerMatch[] | null>(null)
  const [avgRatePerMeter, setAvgRatePerMeter] = useState<number | null>(null)
  const [comparison, setComparison] = useState<ComparisonSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [awaitingResult, setAwaitingResult] = useState(false)
  const [questionNumber, setQuestionNumber] = useState(0)
  const [checklist, setChecklist] = useState<ChecklistData | null>(null)
  const [checklistComplete, setChecklistComplete] = useState(false)

  async function sendMessage(apiText: string, quoteFiles?: File[] | null) {
    setIsLoading(true)
    setHasError(false)
    try {
      const response = await sendFencingChatMessage(apiText, sessionId, quoteFiles)
      setCurrentMessage(response.message)
      setCurrentType(response.type)
      setCurrentIntent(response.intent)
      setCurrentOptions(response.type === 'question' || response.type === 'confirmation' ? response.options : null)
      setChecklist(response.checklist ?? null)
      setChecklistComplete(response.checklistComplete ?? false)
      // Page routing (comparison vs. new-quote flow) depends only on `intent`. `type`
      // never decides which page shows — it just describes the payload (result/message/
      // question/etc.) within whichever flow `intent` has already picked. Guarded by
      // `response.comparison` actually being present: if n8n tags a response
      // `intent: 'compare_quote'` without a comparison object (a malformed/inconsistent
      // payload), there's nothing to show on that page — fall back to reading `type`
      // instead of leaving the UI stuck on stale state.
      if (response.intent === 'compare_quote' && response.comparison) {
        setComparison(response.comparison)
      } else if (response.type === 'result') {
        setResults(response.results)
        setAvgRatePerMeter(response.avgRatePerMeter)
      } else if (response.type !== 'confirmation') {
        setQuestionNumber((n) => n + 1)
      }
    } catch (error) {
      console.error('Fencing chat webhook request failed:', error)
      setHasError(true)
      setLastFailedText(apiText)
      setLastFailedFiles(quoteFiles ?? null)
      setCurrentMessage('Sorry, something went wrong on my end — mind trying that again in a moment?')
      setCurrentOptions(null)
    } finally {
      setIsLoading(false)
      setAwaitingResult(false)
    }
  }

  const handleConfirmationSelect = (option: ChatOption) => {
    // Flagged *before* the request goes out so the ThinkingScreen shows the "finalising" card
    // for this specific wait, instead of falling back to "confirming your details" (which is
    // what the last-known checklist/checklistComplete state would otherwise imply).
    if (String(option.value) === 'yes') setAwaitingResult(true)
    void sendMessage(String(option.value))
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
    setStage('quiz')
    void sendMessage(description, quoteFiles)
  }

  const handleRestart = () => {
    setSessionId(generateId())
    setCurrentMessage('')
    setCurrentOptions(null)
    setCurrentType(null)
    setCurrentIntent(undefined)
    setHasError(false)
    setLastFailedText(null)
    setLastFailedFiles(null)
    setResults(null)
    setAvgRatePerMeter(null)
    setComparison(null)
    setDescription('')
    setSelectedType(null)
    setQuestionNumber(0)
    setChecklist(null)
    setChecklistComplete(false)
    setAwaitingResult(false)
    setStage('hero')
  }

  // n8n's compare_quote branch produces a fully separate results page (Figma: "Quote Direct
  // Comparison") rather than reusing the quiz-stage grid layout below.
  if (comparison) {
    return <QuoteComparisonPage comparison={comparison} onBack={handleRestart} />
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
      <Header dimmed={isLoading} />

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

      {stage === 'out-of-scope' && <OutOfScopeScreen onBack={handleRestart} />}

      {stage === 'quiz' && isLoading && !results && (
        <ThinkingScreen
          description={description}
          checklist={checklist}
          checklistComplete={checklistComplete}
          awaitingResult={awaitingResult}
          intent={currentIntent}
        />
      )}

      {stage === 'quiz' && (!isLoading || results) && (
        <div className="flex flex-1 flex-col items-center px-4 pt-16 pb-24 animate-[fade-in-up_0.4s_ease-out]">
          <div className="mb-10 flex max-w-2xl flex-col items-center gap-2 text-center">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight text-[#062D27]">
              {results ? 'Matching your project with local specialists.' : "Let's find your perfect match."}
            </h1>
            <p className="text-lg text-gray-500">
              {results
                ? "Based on your answers, we've identified the best-fit fencing businesses in your area."
                : "Answer a few quick questions and we'll match you with the right local fencing business."}
            </p>
          </div>

          <div className="grid w-full max-w-6xl grid-cols-1 gap-8 lg:grid-cols-[1fr_400px]">
            {results ? (
              <ResultsPanel results={results} avgRatePerMeter={avgRatePerMeter} onRestart={handleRestart} />
            ) : currentType === 'confirmation' && checklist ? (
              <ConfirmationCard
                message={currentMessage}
                checklist={checklist}
                options={currentOptions ?? []}
                onSelectOption={handleConfirmationSelect}
              />
            ) : (
              <QuizCard
                questionNumber={questionNumber}
                message={currentMessage}
                options={currentOptions}
                checklist={checklist}
                hasError={hasError}
                onSend={sendMessage}
                onSelectOption={(option) => sendMessage(String(option.value))}
                onRetry={() => lastFailedText && sendMessage(lastFailedText, lastFailedFiles)}
                onBack={handleRestart}
              />
            )}
            {results ? <AIRecommendationPanel onModify={handleRestart} /> : <ChecklistPanel checklist={checklist} />}
          </div>
        </div>
      )}

      <footer className={`flex justify-center py-8 transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
        <p className="text-xs text-gray-400">
          Photos, PDFs and video walkthroughs are analysed privately. Nothing is shared without your consent.
        </p>
      </footer>
    </div>
  )
}
