import { useCallback, useEffect, useRef, useState } from 'react'
import { fencingChatFromMetadata, resultIdFromMetadata, type ChecklistData, type FencingChatResponse } from '../services/fencingChat'
import { connectRetellCall } from '../services/retellCall'
import { createVoiceCall } from '../services/voice'
import type { SuburbPlace } from '../services/places'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

export function useVoiceCall(opts: {
  sessionId: string
  place: SuburbPlace | null
  knownChecklist: ChecklistData | null
  onUiUpdate: (response: FencingChatResponse) => void
  onEnded: (resultId?: string) => void
}) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const inFlight = useRef(false)
  const handleRef = useRef<{ stop: () => void } | null>(null)
  const resultIdRef = useRef<string | undefined>(undefined)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const stop = useCallback(() => {
    handleRef.current?.stop()
    handleRef.current = null
    inFlight.current = false
    setStatus('idle')
  }, [])

  useEffect(() => () => stop(), [stop])

  const start = useCallback(async (message?: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setStatus('connecting')
    resultIdRef.current = undefined
    try {
      const { accessToken } = await createVoiceCall({
        sessionId: optsRef.current.sessionId,
        place: optsRef.current.place,
        knownChecklist: optsRef.current.knownChecklist,
        message,
      })
      const handle = await connectRetellCall(accessToken, {
        onStarted: () => setStatus('listening'),
        onAgentTalking: (talking) => setStatus(talking ? 'speaking' : 'listening'),
        onMetadata: (data) => {
          const resultId = resultIdFromMetadata(data)
          if (resultId) resultIdRef.current = resultId
          const response = fencingChatFromMetadata(data)
          if (response) optsRef.current.onUiUpdate(response)
        },
        onEnded: () => {
          handleRef.current = null
          inFlight.current = false
          setStatus('idle')
          optsRef.current.onEnded(resultIdRef.current)
        },
        onError: () => {
          handleRef.current = null
          inFlight.current = false
          setStatus('error')
        },
      })
      handleRef.current = handle
    } catch {
      handleRef.current = null
      inFlight.current = false
      setStatus('error')
    }
  }, [])

  return { status, start, stop, isActive: status === 'connecting' || status === 'listening' || status === 'speaking' }
}
