import { useCallback, useEffect, useRef, useState } from 'react'
import { connectRetellCall } from '../services/retellCall'
import {
  committedVoiceTurnCount,
  createVoiceCall,
  fetchVoiceSession,
  VoiceCallError,
  type VoiceCallContext,
  type VoiceSession,
} from '../services/voice'
import { getVoiceLiveLines, setVoiceLiveLines } from '../utils/voiceLiveStore'
import {
  applyLiveTranscriptUpdate,
  dropCommittedLivePair,
  dropLeadingAssistant,
  lastLiveTranscriptEntry,
  seedLiveGreeting,
} from '../utils/voiceTranscript'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

const SESSION_SYNC_DEBOUNCE_MS = 1_000

export function useVoiceCall(opts: {
  onSessionStarted: (sessionId: string) => void
  onCallStarted?: () => void
  onCallEnding: () => void
  onHandover: (session: VoiceSession | null, sessionId: string) => void
  onSessionSync?: (session: VoiceSession) => void
  onConfigureUnavailable?: () => void
  onRateLimited?: () => void
  onStartFailed?: (message: string) => void
}) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const inFlight = useRef(false)
  const handleRef = useRef<{ stop: () => void } | null>(null)
  const sessionIdRef = useRef<string | undefined>(undefined)
  const committedTurnCountRef = useRef(0)
  const greetingCommittedRef = useRef(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
  }, [])

  const resetLiveOverlay = useCallback(() => {
    setVoiceLiveLines([])
    committedTurnCountRef.current = 0
    greetingCommittedRef.current = false
  }, [])

  const stop = useCallback(() => {
    clearSyncTimer()
    handleRef.current?.stop()
    handleRef.current = null
    inFlight.current = false
    setStatus('idle')
    resetLiveOverlay()
  }, [clearSyncTimer, resetLiveOverlay])

  useEffect(() => () => stop(), [stop])

  const applySessionToLiveBuffer = useCallback((session: VoiceSession) => {
    if (!session.found) return

    let next = getVoiceLiveLines()
    if (!greetingCommittedRef.current && session.turns.some((turn) => turn.n === 0)) {
      greetingCommittedRef.current = true
      next = dropLeadingAssistant(next)
    }

    const spoken = committedVoiceTurnCount(session.turns)
    const grew = Math.max(0, spoken - committedTurnCountRef.current)
    for (let i = 0; i < grew; i += 1) next = dropCommittedLivePair(next)
    committedTurnCountRef.current = spoken
    setVoiceLiveLines(next)
  }, [])

  const scheduleSessionSync = useCallback(() => {
    clearSyncTimer()
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      const voiceSessionId = sessionIdRef.current
      if (!voiceSessionId) return
      void fetchVoiceSession(voiceSessionId)
        .then((session) => {
          optsRef.current.onSessionSync?.(session)
          applySessionToLiveBuffer(session)
        })
        .catch(() => {})
    }, SESSION_SYNC_DEBOUNCE_MS)
  }, [applySessionToLiveBuffer, clearSyncTimer])

  const start = useCallback(async (context?: VoiceCallContext) => {
    if (inFlight.current) return
    inFlight.current = true
    setStatus('connecting')
    resetLiveOverlay()
    sessionIdRef.current = undefined
    clearSyncTimer()
    try {
      const { sessionId, accessToken, configured, greeting } = await createVoiceCall(context)
      if (!configured) {
        inFlight.current = false
        setStatus('idle')
        optsRef.current.onConfigureUnavailable?.()
        return
      }
      if (!sessionId || !accessToken) {
        throw new Error('Voice call API did not return session credentials.')
      }

      sessionIdRef.current = sessionId
      if (greeting) setVoiceLiveLines(seedLiveGreeting(greeting))
      optsRef.current.onSessionStarted(sessionId)

      const handle = await connectRetellCall(accessToken, {
        onStarted: () => {
          setStatus('listening')
          optsRef.current.onCallStarted?.()
        },
        onAgentTalking: (talking) => setStatus(talking ? 'speaking' : 'listening'),
        onAgentStoppedTalking: scheduleSessionSync,
        onUpdate: (update) => {
          const buffer = getVoiceLiveLines()
          const last = lastLiveTranscriptEntry(update)
          // After a turn commits the buffer is empty; Retell still repeats the last agent
          // row until the caller speaks. Do not put that committed line back in the overlay.
          if (buffer.length === 0 && last?.role === 'assistant' && greetingCommittedRef.current) {
            return
          }
          setVoiceLiveLines(applyLiveTranscriptUpdate(buffer, update))
        },
        onEnded: () => {
          clearSyncTimer()
          handleRef.current = null
          inFlight.current = false
          setStatus('idle')
          resetLiveOverlay()
          optsRef.current.onCallEnding()

          const voiceSessionId = sessionIdRef.current
          if (!voiceSessionId) {
            optsRef.current.onHandover(null, '')
            return
          }
          void fetchVoiceSession(voiceSessionId)
            .then((session) => optsRef.current.onHandover(session, voiceSessionId))
            .catch(() => optsRef.current.onHandover(null, voiceSessionId))
        },
        onError: () => {
          clearSyncTimer()
          handleRef.current?.stop()
          handleRef.current = null
          inFlight.current = false
          setStatus('idle')
          resetLiveOverlay()
        },
      })
      handleRef.current = handle
    } catch (error) {
      clearSyncTimer()
      handleRef.current?.stop()
      handleRef.current = null
      inFlight.current = false
      resetLiveOverlay()

      if (error instanceof VoiceCallError && error.rateLimited) {
        setStatus('idle')
        optsRef.current.onRateLimited?.()
        return
      }
      if (error instanceof VoiceCallError) {
        setStatus('idle')
        optsRef.current.onStartFailed?.(error.message)
        return
      }

      setStatus('idle')
      optsRef.current.onStartFailed?.('Voice call could not start. Please try again.')
    }
  }, [clearSyncTimer, resetLiveOverlay, scheduleSessionSync])

  return {
    status,
    start,
    stop,
    isActive: status === 'connecting' || status === 'listening' || status === 'speaking',
  }
}
