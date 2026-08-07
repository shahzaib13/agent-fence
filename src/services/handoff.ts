// Sending a verified customer on to the partner site already signed in.
//
// The two sites share a Firebase project but not an origin, and Firebase keeps its session in
// per-origin storage — so the session does not travel by itself. A custom token does, minted by
// the `createHandoff` function against the customer's own ID token.
//
// The partner app reads `#t=<customToken>` on load, signs in with it, then clears the hash.
// Landing on `/app` without that fragment always ends on their login page — so this helper
// refuses to return a bare URL. Callers surface the error and let the customer retry.
import { getAuthClient } from './firebase'

const DEFAULT_PARTNER_SITE = 'https://quotemy-ai.web.app/app'
const DEFAULT_HANDOFF_ENDPOINT =
  'https://us-central1-quotemy-ai.cloudfunctions.net/createHandoff'

const PARTNER_SITE =
  (import.meta.env.VITE_PARTNER_SITE_URL as string | undefined)?.trim() || DEFAULT_PARTNER_SITE
const HANDOFF_ENDPOINT =
  (import.meta.env.VITE_HANDOFF_URL as string | undefined)?.trim() || DEFAULT_HANDOFF_ENDPOINT
const REQUEST_TIMEOUT_MS = 8000

/**
 * Partner URL with a one-time Firebase custom token in the fragment (`#t=…`).
 * A fragment never hits a server, so it stays out of access logs and `Referer`.
 *
 * Throws when the session cannot be minted — never returns `/app` without `#t=`.
 */
export async function partnerSiteUrl(): Promise<string> {
  const auth = await getAuthClient()
  const idToken = await auth.currentUser?.getIdToken()
  if (!idToken) {
    throw new Error('Sign-in expired before handoff. Verify your number again.')
  }

  let response: Response
  try {
    response = await fetch(HANDOFF_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    console.error('Could not reach the handoff endpoint:', error)
    throw new Error("Couldn't reach QuoteMy to finish sign-in. Check your connection and try again.")
  }

  if (!response.ok) {
    console.error('Handoff refused:', response.status)
    throw new Error("Couldn't open your QuoteMy session. Try again in a moment.")
  }

  const { token } = (await response.json()) as { token?: string }
  if (!token) {
    throw new Error('QuoteMy handoff returned no sign-in token. Try again.')
  }

  // Hash only — the decking app does not read `?t=`.
  return `${PARTNER_SITE}#t=${encodeURIComponent(token)}`
}
