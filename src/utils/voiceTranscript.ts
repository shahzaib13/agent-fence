export interface LiveTranscriptLine {
  role: 'user' | 'assistant'
  text: string
}

function mapRole(role: unknown): LiveTranscriptLine['role'] {
  return role === 'agent' ? 'assistant' : 'user'
}

/** Last row of a Retell `update.transcript` — a sliding window, not the full call. */
export function lastLiveTranscriptEntry(update: unknown): LiveTranscriptLine | null {
  if (!update || typeof update !== 'object') return null
  const transcript = (update as { transcript?: unknown }).transcript
  if (!Array.isArray(transcript) || transcript.length === 0) return null

  const entry = transcript[transcript.length - 1]
  if (!entry || typeof entry !== 'object') return null
  const row = entry as { role?: unknown; content?: unknown }
  const text = typeof row.content === 'string' ? row.content : ''
  if (!text.trim()) return null

  return { role: mapRole(row.role), text }
}

/**
 * Own live buffer: look only at the last window entry.
 * Same role → replace content (Retell sends the full grown string, never a delta).
 */
export function applyLiveTranscriptUpdate(
  buffer: LiveTranscriptLine[],
  update: unknown,
): LiveTranscriptLine[] {
  const last = lastLiveTranscriptEntry(update)
  if (!last) return buffer

  const tail = buffer[buffer.length - 1]
  if (tail && tail.role === last.role) {
    return [...buffer.slice(0, -1), last]
  }
  return [...buffer, last]
}

export function seedLiveGreeting(greeting: string): LiveTranscriptLine[] {
  const text = greeting.trim()
  return text ? [{ role: 'assistant', text }] : []
}

/** Turn 0 greeting has no user line — drop the leading agent once it is committed. */
export function dropLeadingAssistant(buffer: LiveTranscriptLine[]): LiveTranscriptLine[] {
  if (buffer[0]?.role !== 'assistant') return buffer
  return buffer.slice(1)
}

/**
 * One spoken turn has landed in the session. Remove its user + agent from the buffer
 * wherever they sit, so a long call never keys off the 5-utterance window.
 */
export function dropCommittedLivePair(buffer: LiveTranscriptLine[]): LiveTranscriptLine[] {
  let removedUser = false
  let removedAgent = false
  const next: LiveTranscriptLine[] = []
  for (const line of buffer) {
    if (!removedUser && line.role === 'user') {
      removedUser = true
      continue
    }
    if (!removedAgent && line.role === 'assistant') {
      removedAgent = true
      continue
    }
    next.push(line)
  }
  return next
}
