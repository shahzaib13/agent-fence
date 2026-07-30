import { api } from './api'

export interface ChatOption {
  label: string
  value: string
}

export interface WorkerMatch {
  businessName: string
  ratePerMeter: number
  estimatedTotal: number
  notes: string
}

// One row of the compare_quote flow's "beat my existing quote" results — shape comes from
// the n8n "Rank & Format Comparison Response" node (n8n/fencing-workflow-updated.json).
export interface ComparisonQuote {
  businessName: string
  ratePerMeter: number
  projectTotalMin: number
  projectTotalMax: number
  leadTimeWeeksMin: number
  leadTimeWeeksMax: number
  badges: string[]
  tag: string | null
  savingsFromAverage: number | null
}

export interface ComparisonSummary {
  potentialSavings: number | null
  marketAverage: number | null
  totalQuotesScreened: number
  userExistingPrice: number | null
  quotes: ComparisonQuote[]
}

export interface FencingChatResponse {
  sessionId: string
  type: 'message' | 'question' | 'result' | 'comparison_result'
  message: string
  options: ChatOption[]
  results: WorkerMatch[]
  avgRatePerMeter: number | null
  comparison?: ComparisonSummary | null
  // Present once n8n's intent-router adds it to its final response nodes. Kept optional
  // since older/other branches may still omit it — routing falls back to `type` when absent.
  intent?: 'new_quote' | 'compare_quote'
}

const FENCING_CHAT_WEBHOOK_URL =
  import.meta.env.VITE_FENCING_CHAT_WEBHOOK_URL ?? 'https://n8n.srv1506542.hstgr.cloud/webhook/fencing-chat-api'

const VALID_TYPES = ['message', 'question', 'result', 'comparison_result']

export async function sendFencingChatMessage(
  message: string,
  sessionId: string,
  quoteFiles?: File[] | null,
): Promise<FencingChatResponse> {
  let payload: FormData | { message: string; sessionId: string }
  if (quoteFiles && quoteFiles.length > 0) {
    payload = new FormData()
    payload.append('message', message)
    payload.append('sessionId', sessionId)
    // All files go under the same field name in ONE request — n8n's webhook parses
    // repeated multipart fields into indexed binary keys (quoteFile0, quoteFile1, ...)
    // and its "Split Attachments by Binary Key" node processes them together in a
    // single execution, which is what lets it combine results across files.
    for (const file of quoteFiles) {
      payload.append('quoteFile', file)
    }
  } else {
    payload = { message, sessionId }
  }

  const { data } = await api.post<FencingChatResponse>(FENCING_CHAT_WEBHOOK_URL, payload, { timeout: 30_000 })
  if (!data || typeof data.message !== 'string' || !VALID_TYPES.includes(data.type)) {
    throw new Error(`Fencing chat webhook returned an unexpected response shape: ${JSON.stringify(data)}`)
  }
  return data
}
