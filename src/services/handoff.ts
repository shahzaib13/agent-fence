// Sending a verified customer on to the partner site already signed in.
//
// The two sites share a Firebase project but not an origin, and Firebase keeps its session in
// per-origin storage — so the session does not travel by itself. A custom token does, minted by
// the `createHandoff` function against the customer's own ID token.
//
// Every failure here degrades to a plain redirect rather than trapping anybody on our success
// screen: worst case they sign in over there, which is what happens today anyway.
import { getAuthClient } from './firebase'

const PARTNER_SITE = import.meta.env.VITE_PARTNER_SITE_URL ?? 'https://decking.web.app/app'
const HANDOFF_ENDPOINT = import.meta.env.VITE_HANDOFF_URL as string | undefined
const REQUEST_TIMEOUT_MS = 8000

/**
 * Where to send the customer next. Carries a one-time sign-in token in the URL fragment when it
 * can get one — a fragment is never sent to a server, so it stays out of access logs and out of
 * the `Referer` header on the way.
 */
export async function partnerSiteUrl(): Promise<string> {
  if (!HANDOFF_ENDPOINT) return PARTNER_SITE

  try {
    const auth = await getAuthClient()
    const idToken = await auth.currentUser?.getIdToken()
    if (!idToken) return PARTNER_SITE

    const response = await fetch(HANDOFF_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`handoff returned ${response.status}`)

    const { token } = (await response.json()) as { token?: string }
    if (!token) throw new Error('handoff returned no token')

    const url = new URL(PARTNER_SITE)
    url.hash = `t=${encodeURIComponent(token)}`
    return url.toString()
  } catch (error) {
    // Not worth stopping for. They arrive signed out and sign in there, as they would have
    // before any of this existed.
    console.error('Could not hand the session over, sending them across signed out:', error)
    return PARTNER_SITE
  }
}
