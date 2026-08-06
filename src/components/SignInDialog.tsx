import { useEffect, useRef, useState, type FormEvent } from 'react'
import { OTP_LENGTH, RECAPTCHA_CONTAINER_ID, releaseVerifier, sendOtp, verifyOtp, type OtpSession } from '../services/otp'
import { claimLocalQuotes } from '../services/quotes'
import { DEFAULT_COUNTRY_CODE, isValidPhone, normalisePhone } from '../utils/phone'
import { OtpInput } from './OtpInput'

// Signing in is the same phone verification the Instant Quote flow ends with — there is no
// second kind of account. The only difference is that nothing is written afterwards: the point
// is just to have a session, so past quotes can be found again.
const RESEND_COOLDOWN_SECONDS = 30

export function SignInDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [phone, setPhone] = useState('')
  const [session, setSession] = useState<OtpSession | null>(null)
  const [digits, setDigits] = useState<string[]>(() => Array<string>(OTP_LENGTH).fill(''))
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    dialogRef.current?.showModal()
    return releaseVerifier
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const dismiss = () => {
    dialogRef.current?.close()
    onClose()
  }

  async function requestCode(phoneE164: string) {
    setIsBusy(true)
    setError(null)
    try {
      setSession(await sendOtp(phoneE164))
      setDigits(Array<string>(OTP_LENGTH).fill(''))
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't send a code to that number.")
    } finally {
      setIsBusy(false)
    }
  }

  function handlePhoneSubmit(event: FormEvent) {
    event.preventDefault()
    const normalised = normalisePhone(phone)
    if (!isValidPhone(normalised)) {
      setError(`Enter a phone number with its country code, like ${DEFAULT_COUNTRY_CODE} 302 944 7610.`)
      return
    }
    setPhone(normalised)
    void requestCode(normalised)
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    setIsBusy(true)
    setError(null)
    try {
      const uid = await verifyOtp(session, digits.join(''))
      // Whatever they were quoting as a guest becomes theirs the moment they have an account.
      await claimLocalQuotes({ uid, phone: session.phoneE164.replace(/\D/g, '') })
      dismiss()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code didn't match. Try again.")
    } finally {
      setIsBusy(false)
    }
  }

  const codeComplete = digits.every((digit) => digit !== '')

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="sign-in-title"
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
      className="m-auto w-full max-w-md rounded-3xl p-0 backdrop:bg-[#062D27]/40 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-gray-100 px-5 py-4 sm:px-7">
          <button
            type="button"
            aria-label={session ? 'Back to phone number' : 'Close sign in'}
            onClick={() => (session ? setSession(null) : dismiss())}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#062D27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4.5 w-4.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 id="sign-in-title" className="text-base font-semibold text-[#062D27] sm:text-lg">
              {session ? 'Enter your code' : 'Sign in'}
            </h2>
            <p className="truncate text-xs text-[#6B7280]">
              {session ? `Sent to ${session.phoneE164}` : 'Your number is your account — no password to remember'}
            </p>
          </div>
        </header>

        {session ? (
          <form onSubmit={handleVerify} className="flex flex-1 flex-col gap-5 px-5 py-6 sm:px-7">
            <OtpInput digits={digits} onChange={setDigits} hasError={!!error} autoFocus />
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={!codeComplete || isBusy}
              className="rounded-full bg-[#062D27] px-6 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#0a3f37] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              {isBusy ? 'Checking…' : 'Verify'}
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || isBusy}
              onClick={() => void requestCode(session.phoneE164)}
              className="self-center text-sm font-medium text-[#6B7280] underline-offset-4 hover:text-[#062D27] hover:underline disabled:no-underline disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePhoneSubmit} className="flex flex-1 flex-col gap-5 px-5 py-6 sm:px-7">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sign-in-phone" className="text-sm font-medium text-[#062D27]">
                Phone number
              </label>
              <input
                id="sign-in-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder={`${DEFAULT_COUNTRY_CODE} 302 944 7610`}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                onBlur={() => {
                  const normalised = normalisePhone(phone)
                  if (isValidPhone(normalised)) setPhone(normalised)
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'sign-in-phone-error' : undefined}
                className={`rounded-2xl border bg-white px-4 py-3 text-base text-[#062D27] placeholder:text-gray-300 focus:outline-none focus-visible:border-[#062D27] focus-visible:ring-2 focus-visible:ring-[#062D27]/15 ${
                  error ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
                }`}
              />
              {error && (
                <p id="sign-in-phone-error" role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={isBusy}
              className="rounded-full bg-[#062D27] px-6 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#0a3f37] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              {isBusy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {/* Firebase's invisible reCAPTCHA needs a container in the DOM before the code is asked for. */}
        <div id={RECAPTCHA_CONTAINER_ID} />
      </div>
    </dialog>
  )
}
