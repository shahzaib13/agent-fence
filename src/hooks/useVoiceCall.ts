import { useCallback, useEffect, useRef, useState } from 'react'
import { connectRetellCall } from '../services/retellCall'
import {
  createVoiceCall,
  fetchVoiceSession,
  freshVoiceTurns,
  lastVoiceTurnN,
  VoiceCallError,
  type VoiceCallContext,
  type VoiceSession,
} from '../services/voice'
import { getVoiceLiveLines, setVoiceLiveLines } from '../utils/voiceLiveStore'
import {
  applyLiveTranscriptUpdate,
  dropLinesBefore,
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
  const greetingCommittedRef = useRef(false)
  /** Last turn `n` the overlay has already cleared for — same freshness gate as message merge. */
  const overlayClearedTurnNRef = useRef(-1)
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
    greetingCommittedRef.current = false
    overlayClearedTurnNRef.current = -1
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

  const applySessionToLiveBuffer = useCallback((session: VoiceSession, issuedAt: number) => {
    if (!session.found) return

    if (!greetingCommittedRef.current && session.turns.some((turn) => turn.n === 0)) {
      greetingCommittedRef.current = true
    }

    /* Only clear when this sync advanced committed turns — same fresh.length gate as the
       message merge. Safe because runVoiceTurn writes the session document *before* it
       returns speakText to Retell: "no new n" means the turn genuinely has not happened
       yet (filler stop, tool still running), not that we raced a write. Clearing then
       would wipe live lines into a void with nothing to replace them. */
    const lastSeen = overlayClearedTurnNRef.current
    const fresh = freshVoiceTurns(session.turns, lastSeen)
    if (!fresh.length) return

    overlayClearedTurnNRef.current = lastVoiceTurnN(session.turns, lastSeen)

    /* Drop by request issue time, not content. Each committed turn carries both said and
       spoke, so everything spoken before this sync is already on the committed side.
       Lines that arrived while the request was in flight stay — next turn's preview. */
    setVoiceLiveLines(dropLinesBefore(getVoiceLiveLines(), issuedAt))
  }, [])

  const scheduleSessionSync = useCallback(() => {
    clearSyncTimer()
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      const voiceSessionId = sessionIdRef.current
      if (!voiceSessionId) return
      const issuedAt = Date.now()
      void fetchVoiceSession(voiceSessionId)
        .then((session) => {
          optsRef.current.onSessionSync?.(session)
          applySessionToLiveBuffer(session, issuedAt)
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
          // After a gated clear the buffer is empty because those lines were committed.
          // Retell still repeats the last agent row until the caller speaks — do not put
          // that committed line back. Only sound once the clear itself is gated on fresh
          // turns; an ungated clear left the buffer empty while the real answer was still
          // streaming, and this guard then blocked it from reappearing.
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
