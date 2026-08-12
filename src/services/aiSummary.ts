import type { ComparisonQuote, ComparisonSummary } from './fencingChat'
import type { QuoteSession } from './quotes'
import { checklistFieldLabel, formatChecklistValue } from '../utils/checklist'

export interface AiSummaryBriefRow {
  label: string
  value: string
}

export interface AiSummaryTurn {
  role: 'customer' | 'assistant'
  text: string
  picked?: string
}

export interface AiSummaryQuote {
  businessName: string
  rate?: string
  projectTotal: string
  savings?: string
  marketAverage?: string
  isBestValue?: boolean
  badges?: string[]
}

export interface AiSummary {
  generatedAt: number
  messageCount: number
  brief: AiSummaryBriefRow[]
  transcript: AiSummaryTurn[]
  quote?: AiSummaryQuote
}

/** Realtime Database rejects undefined (and we drop null the same way). Walks the tree in place of JSON round-tripping. */
function withoutNullish<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => withoutNullish(entry)) as T
  }
  if (value !== null && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || entry === null) continue
      next[key] = withoutNullish(entry)
    }
    return next as T
  }
  return value
}

export function buildAiSummary(session: QuoteSession): Omit<AiSummary, 'quote'> {
  const brief: AiSummaryBriefRow[] = []
  for (const [field, value] of Object.entries(session.checklist ?? {})) {
    if (value === null || value === undefined || value === '') continue
    brief.push({
      label: checklistFieldLabel(field),
      value: String(formatChecklistValue(field, value)),
    })
  }

  return withoutNullish({
    generatedAt: session.createdAt,
    messageCount: session.messages.length,
    brief,
    transcript: session.messages.map((message) => ({
      role: message.role === 'user' ? ('customer' as const) : ('assistant' as const),
      text: message.text,
      ...(message.answered ? { picked: message.answered.label } : {}),
    })),
  })
}

export function buildAiSummaryQuote(
  quote: ComparisonQuote,
  comparison: ComparisonSummary | null,
): AiSummaryQuote {
  const projectTotal =
    quote.projectTotalMin === quote.projectTotalMax
      ? `$${quote.projectTotalMin.toLocaleString()}`
      : `$${quote.projectTotalMin.toLocaleString()} - $${quote.projectTotalMax.toLocaleString()}`

  return withoutNullish({
    businessName: quote.businessName,
    rate: `$${quote.ratePerMeter}/m`,
    projectTotal,
    ...(quote.savingsFromAverage != null && quote.savingsFromAverage > 0
      ? { savings: `$${quote.savingsFromAverage.toLocaleString()}` }
      : {}),
    ...(comparison?.marketAverage != null ? { marketAverage: `$${comparison.marketAverage.toLocaleString()}` } : {}),
    ...(quote.tag === 'BEST_VALUE' ? { isBestValue: true } : {}),
    badges: quote.badges,
  })
}

/** Final pass before the RTDB push — assembled `{ ...summary, quote? }` included. */
export function compactAiSummary(summary: AiSummary): AiSummary {
  return withoutNullish(summary)
}
