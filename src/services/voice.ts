import { api } from './api'
import { quoteMyApiBase, serialiseKnownChecklist, type ChecklistData } from './fencingChat'
import type { SuburbPlace } from './places'

export interface VoiceCallCredentials {
  sessionId: string
  accessToken: string
}

function voiceCallUrl(): string {
  const explicit = (import.meta.env.VITE_VOICE_CREATE_CALL_URL as string | undefined)?.trim()
  if (explicit) return explicit

  const base = quoteMyApiBase()
  if (base) return `${base}/api/v1/voice/create-call`

  throw new Error(
    'Voice call API URL is not configured. Set VITE_QUOTEMY_API_BASE_URL or VITE_VOICE_CREATE_CALL_URL.',
  )
}

function accessTokenFrom(data: Record<string, unknown>): string | undefined {
  if (typeof data.accessToken === 'string' && data.accessToken) return data.accessToken
  if (typeof data.access_token === 'string' && data.access_token) return data.access_token
  return undefined
}

export async function createVoiceCall(params: {
  sessionId: string
  place?: SuburbPlace | null
  knownChecklist?: ChecklistData | null
  message?: string
}): Promise<VoiceCallCredentials> {
  const { data } = await api.post<Record<string, unknown>>(
    voiceCallUrl(),
    {
      sessionId: params.sessionId,
      place: params.place ? JSON.stringify(params.place) : '',
      knownChecklist: serialiseKnownChecklist(params.knownChecklist),
      ...(params.message ? { message: params.message } : {}),
    },
    { timeout: 30_000 },
  )

  const sessionId = typeof data?.sessionId === 'string' && data.sessionId ? data.sessionId : params.sessionId
  const accessToken = data ? accessTokenFrom(data) : undefined
  if (!accessToken) {
    throw new Error('Voice call API did not return an access token.')
  }
  return { sessionId, accessToken }
}

export function isVoiceCallConfigured() {
  try {
    voiceCallUrl()
    return true
  } catch {
    return false
  }
}
