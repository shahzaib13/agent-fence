import type { ChatMessage } from '../components/ChatWindow'
import { assistantTextFromTurn, type VoiceTurn } from '../services/voice'

export function voiceTurnUserId(voiceSessionId: string, turn: VoiceTurn): string {
  return `v-${voiceSessionId}-${turn.n ?? 0}-u`
}

export function voiceTurnAiId(voiceSessionId: string, turn: VoiceTurn): string {
  return `v-${voiceSessionId}-${turn.n ?? 0}-a`
}

export function isVoiceMessageId(id: string): boolean {
  return /^v-.+-\d+-[ua]$/.test(id)
}

export function isVoiceDividerId(id: string): boolean {
  return /^v-.+-divider-(on|off)$/.test(id)
}

function turnCreatedAt(turn: VoiceTurn, fallbackMs: number): number {
  if (turn.at) {
    const parsed = Date.parse(turn.at)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallbackMs
}

function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id)
  if (index === -1) return [...messages, message]
  const next = [...messages]
  next[index] = { ...next[index], ...message }
  return next
}

export function voiceModeOnDivider(voiceSessionId: string, createdAt = Date.now()): ChatMessage {
  return {
    id: `v-${voiceSessionId}-divider-on`,
    role: 'divider',
    text: 'Voice mode on',
    createdAt,
  }
}

export function voiceModeOffDivider(voiceSessionId: string, createdAt = Date.now()): ChatMessage {
  return {
    id: `v-${voiceSessionId}-divider-off`,
    role: 'divider',
    text: 'Voice mode off',
    createdAt,
  }
}

/** Settled voice turns become chat bubbles — `spoke` only, no MCQ pills. */
export function messagesFromVoiceTurns(turns: VoiceTurn[], voiceSessionId: string): ChatMessage[] {
  return mergeVoiceTurns([], turns, voiceSessionId)
}

/** Append new voice turns without wiping prior calls — IDs include sessionId. */
export function mergeVoiceTurns(
  existing: ChatMessage[],
  turns: VoiceTurn[],
  voiceSessionId: string,
  fallbackMs = Date.now(),
): ChatMessage[] {
  if (!voiceSessionId) return existing

  let messages = [...existing]
  const sorted = [...turns].sort((left, right) => (left.n ?? 0) - (right.n ?? 0))

  for (const turn of sorted) {
    const atMs = turnCreatedAt(turn, fallbackMs)

    if (turn.said?.trim()) {
      messages = upsertMessage(messages, {
        id: voiceTurnUserId(voiceSessionId, turn),
        role: 'user',
        text: turn.said.trim(),
        createdAt: atMs,
        isVoice: true,
      })
    }

    const assistantText = assistantTextFromTurn(turn)
    if (assistantText) {
      messages = upsertMessage(messages, {
        id: voiceTurnAiId(voiceSessionId, turn),
        role: 'ai',
        text: assistantText,
        createdAt: atMs + 1,
        isVoice: true,
      })
    }
  }

  return messages
}
