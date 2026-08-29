import { useSyncExternalStore } from 'react'
import type { LiveTranscriptLine } from './voiceTranscript'

let lines: LiveTranscriptLine[] = []
const listeners = new Set<() => void>()

export function getVoiceLiveLines(): LiveTranscriptLine[] {
  return lines
}

export function setVoiceLiveLines(next: LiveTranscriptLine[]): void {
  lines = next
  listeners.forEach((listener) => listener())
}

export function subscribeVoiceLiveLines(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Only the overlay should subscribe — keeps the message list off the 100–200ms path. */
export function useVoiceLiveLines(): LiveTranscriptLine[] {
  return useSyncExternalStore(subscribeVoiceLiveLines, getVoiceLiveLines, getVoiceLiveLines)
}
