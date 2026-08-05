// Phone verification seam. Firebase isn't wired yet — these two functions are the entire
// surface the UI touches, so switching to real Firebase phone auth is a change to this file
// and nothing else:
//
//   const verifier = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, { size: 'invisible' })
//   const result = await signInWithPhoneNumber(auth, phoneE164, verifier)   -> sendOtp
//   await result.confirm(code)                                             -> verifyOtp
//
// Until then they fake a network round trip so the loading/error states are real and testable.

/** Where the invisible reCAPTCHA mounts. The OTP step renders an empty div with this id. */
export const RECAPTCHA_CONTAINER_ID = 'recaptcha-container'

export const OTP_LENGTH = 6

export interface OtpSession {
  /** Firebase's ConfirmationResult.verificationId once this is real. */
  verificationId: string
  phoneE164: string
}

export async function sendOtp(phoneE164: string): Promise<OtpSession> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  return { verificationId: `stub-${Date.now()}`, phoneE164 }
}

export async function verifyOtp(session: OtpSession, code: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  if (!session.verificationId) throw new Error('That code has expired. Send a new one.')
  // The stub accepts any full-length numeric code. Firebase does the real check later, but the
  // UI still needs a rejection path to render, so a short/blank code fails here too.
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
    throw new Error('That code looks incomplete. Enter all six digits.')
  }
}
