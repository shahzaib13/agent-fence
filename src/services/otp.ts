// Phone verification, on Firebase phone auth. Two functions are the entire surface the UI
// touches: send a code to a number, then check the code that comes back.
// `import type` only — the SDK itself is pulled in at call time so it stays out of the initial
// bundle (see the note in ./firebase).
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth'
import { getAuthClient } from './firebase'

/** Where the invisible reCAPTCHA mounts. The dialog renders an empty div with this id. */
export const RECAPTCHA_CONTAINER_ID = 'recaptcha-container'

export const OTP_LENGTH = 6

/** What the UI holds between the two calls. Kept plain so it can live in React state. */
export interface OtpSession {
  verificationId: string
  phoneE164: string
}

// Firebase's ConfirmationResult is a live SDK handle, not data — it stays here rather than in
// component state, keyed by the id the session carries.
const confirmations = new Map<string, ConfirmationResult>()

// One verifier per page: constructing a second against the same container throws. It renders
// nothing (invisible size) but the container must already be in the DOM when it's built.
let verifier: RecaptchaVerifier | null = null

async function getVerifier() {
  if (!verifier) {
    const [{ RecaptchaVerifier }, auth] = await Promise.all([import('firebase/auth'), getAuthClient()])
    verifier = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, { size: 'invisible' })
  }
  return verifier
}

/**
 * Throws away the reCAPTCHA. Whoever renders the container must call this when it unmounts:
 * the verifier holds on to that element, so a dialog closed mid-flow would leave it bound to a
 * node that no longer exists, and every later attempt would fail for no visible reason.
 */
export function releaseVerifier() {
  resetVerifier()
}

function resetVerifier() {
  // A challenge that has been spent can't be replayed, so a failed send has to start over with
  // a fresh one — otherwise every retry fails the same way as the first.
  verifier?.clear()
  verifier = null
}

// Firebase's own strings are for developers ("auth/invalid-verification-code"), so each one the
// customer can actually hit gets a line that says what to do about it.
const MESSAGES: Record<string, string> = {
  'auth/invalid-verification-code': "That code didn't match. Check the digits and try again.",
  'auth/code-expired': 'That code has expired. Send a new one.',
  'auth/invalid-phone-number': "That number isn't a valid mobile. Check the country code and try again.",
  'auth/missing-phone-number': 'Enter a phone number to send the code to.',
  'auth/too-many-requests': 'Too many attempts from this device. Wait a few minutes, then try again.',
  'auth/quota-exceeded': "Verification is unavailable right now. Try again in a little while.",
  'auth/captcha-check-failed': "Couldn't confirm this browser. Reload the page and try again.",
}

function readable(error: unknown, fallback: string) {
  const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined
  return new Error((code && MESSAGES[code]) || fallback)
}

export async function sendOtp(phoneE164: string): Promise<OtpSession> {
  try {
    const [{ signInWithPhoneNumber }, auth, recaptcha] = await Promise.all([
      import('firebase/auth'),
      getAuthClient(),
      getVerifier(),
    ])
    const confirmation = await signInWithPhoneNumber(auth, phoneE164, recaptcha)
    confirmations.set(confirmation.verificationId, confirmation)
    return { verificationId: confirmation.verificationId, phoneE164 }
  } catch (error) {
    resetVerifier()
    throw readable(error, "Couldn't send a code to that number. Check it and try again.")
  }
}

/** Resolves to the signed-in Firebase uid — what the job and user documents record as `uid`. */
export async function verifyOtp(session: OtpSession, code: string): Promise<string> {
  // Checked here as well as in the UI: `confirm()` bills a round trip, and an incomplete code
  // can never pass it.
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
    throw new Error('That code looks incomplete. Enter all six digits.')
  }

  const confirmation = confirmations.get(session.verificationId)
  if (!confirmation) throw new Error('That code has expired. Send a new one.')

  let uid: string
  try {
    uid = (await confirmation.confirm(code)).user.uid
  } catch (error) {
    throw readable(error, "That code didn't match. Try again.")
  }
  // Single use: the same code must not verify a second time.
  confirmations.delete(session.verificationId)
  resetVerifier()
  return uid
}
