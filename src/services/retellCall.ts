export interface RetellCallListeners {
  onStarted?: () => void
  onEnded?: () => void
  onAgentTalking?: (talking: boolean) => void
  onMetadata?: (data: unknown) => void
  onError?: (error: unknown) => void
}

export interface RetellCallHandle {
  stop: () => void
}

/**
 * Thin wrapper around the Retell SDK so the rest of the app never imports it directly —
 * tests mock this module, and a failed dynamic import cannot take the chat page down.
 */
export async function connectRetellCall(
  accessToken: string,
  listeners: RetellCallListeners,
): Promise<RetellCallHandle> {
  const { RetellWebClient } = await import('retell-client-js-sdk')
  const client = new RetellWebClient()

  client.on('call_started', () => listeners.onStarted?.())
  client.on('call_ended', () => listeners.onEnded?.())
  client.on('agent_start_talking', () => listeners.onAgentTalking?.(true))
  client.on('agent_stop_talking', () => listeners.onAgentTalking?.(false))
  client.on('metadata', (data: unknown) => listeners.onMetadata?.(data))
  client.on('error', (error: unknown) => {
    listeners.onError?.(error)
    client.stopCall()
  })

  await client.startCall({ accessToken })
  return { stop: () => client.stopCall() }
}
