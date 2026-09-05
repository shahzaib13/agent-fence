export interface LiveTranscriptLine {
  role: 'user' | 'assistant'
  text: string
  /** When this line last landed in the overlay — sync drops anything older than its request. */
  receivedAt: number
}

function mapRole(role: unknown): LiveTranscriptLine['role'] {
  return role === 'agent' ? 'assistant' : 'user'
}

/** Last row of a Retell `update.transcript` — a sliding window, not the full call. */
export function lastLiveTranscriptEntry(update: unknown): Omit<LiveTranscriptLine, 'receivedAt'> | null {
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
 *
 * At most one line per role. Retell revises the same utterance as the window grows, and the caller's
 * mic hearing the agent can flip the last-row role mid-sentence — appending on every flip turned
 * "One gate." into three bubbles. Revising the existing line for that role keeps the overlay to
 * one user + one assistant, with the latest role at the tail.
 */
export function applyLiveTranscriptUpdate(
  buffer: LiveTranscriptLine[],
  update: unknown,
  now = Date.now(),
): LiveTranscriptLine[] {
  const last = lastLiveTranscriptEntry(update)
  if (!last) return buffer

  const line: LiveTranscriptLine = { ...last, receivedAt: now }
  const others = buffer.filter((entry) => entry.role !== last.role)
  return [...others, line]
}

export function seedLiveGreeting(greeting: string, now = Date.now()): LiveTranscriptLine[] {
  const text = greeting.trim()
  return text ? [{ role: 'assistant', text, receivedAt: now }] : []
}

/**
 * Drop every live line that arrived before the sync request was issued.
 *
 * Issue time, not response time: anything spoken while the request was in flight stays on screen.
 * No text matching — `spoke` and streamed wording diverge on purpose.
 */
export function dropLinesBefore(buffer: LiveTranscriptLine[], issuedAt: number): LiveTranscriptLine[] {
  return buffer.filter((line) => line.receivedAt >= issuedAt)
}
