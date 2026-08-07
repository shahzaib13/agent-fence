import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import type { ComparisonQuote } from '../services/fencingChat'
import { submitJob } from '../services/jobs'
import type { QuoteSession } from '../services/quotes'
import { partnerSiteUrl } from '../services/handoff'
import { shareTranscriptInChats } from '../services/chat'
import { buildTranscriptPdf, storeTranscriptForJob } from '../services/transcript'
import { OTP_LENGTH, RECAPTCHA_CONTAINER_ID, releaseVerifier, sendOtp, verifyOtp, type OtpSession } from '../services/otp'
import type { SuburbPlace } from '../services/places'
import { DEFAULT_COUNTRY_CODE, isValidPhone, normalisePhone } from '../utils/phone'
import { OtpInput } from './OtpInput'
import { QuoteCard } from './QuoteCard'

// Choose who to contact -> hand over contact details -> verify the phone number. One dialog
// the whole way: the results page stays mounted behind it, so cancelling at any point is an
// unmount and nothing else — no refetch, no loading state, no lost comparison.
type Step = 'select' | 'details' | 'otp'

const FORM_STEPS: Step[] = ['select', 'details', 'otp']
const RESEND_COOLDOWN_SECONDS = 30
// Deliberately permissive: enough to catch a typo'd address, not enough to reject a valid
// one. The verification email is what actually proves an address works.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Strips control/format characters, collapses whitespace, trims, and caps the length. */
function sanitise(value: string, maxLength: number) {
  return value.replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

const PANEL_LABEL: Record<Step, { title: string; caption: string }> = {
  select: { title: 'Choose who to contact', caption: 'Pick one, two, or all three' },
  details: { title: 'Where should they reach you?', caption: 'Shared only with the businesses you picked' },
  otp: { title: 'Verify your number', caption: 'So only real leads reach these businesses' },
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4.5 w-4.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function TextField({
  id,
  label,
  error,
  hint,
  ...input
}: {
  id: string
  label: string
  error?: string
  hint?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[#062D27]">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`rounded-2xl border bg-white px-4 py-3 text-base text-[#062D27] transition-colors placeholder:text-gray-300 focus:outline-none focus-visible:border-[#062D27] focus-visible:ring-2 focus-visible:ring-[#062D27]/15 ${
          error ? 'border-red-300 bg-red-50/40' : 'border-gray-200 hover:border-gray-300'
        }`}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-[#6B7280]">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export function InstantQuoteFlow({
  quotes,
  place,
  quoteSession,
  onClose,
}: {
  quotes: ComparisonQuote[]
  /** The suburb the customer picked — every field of `locationData` on the saved job. */
  place: SuburbPlace | null
  /** The conversation this quote came from — it becomes the PDF attached to the job. */
  quoteSession: QuoteSession
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<Step>('select')
  const [selected, setSelected] = useState<string[]>([])
  const selectedQuotes = quotes.filter((quote) => selected.includes(quote.businessName))

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; phone?: string }>({})
  const [isSending, setIsSending] = useState(false)

  const [session, setSession] = useState<OtpSession | null>(null)
  const [digits, setDigits] = useState<string[]>(() => Array<string>(OTP_LENGTH).fill(''))
  const [otpError, setOtpError] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifiedUid, setVerifiedUid] = useState<string | null>(null)
  const [isLeaving, setIsLeaving] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // Native <dialog> so focus trapping, Esc, and the inert background come from the platform
  // rather than from us reimplementing them.
  useEffect(() => {
    dialogRef.current?.showModal()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      releaseVerifier()
    }
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // Closing is driven from here rather than from the dialog's own `close` event: React doesn't
  // reliably deliver that one (it doesn't bubble), which left the dialog closed but still
  // mounted, so it could never be reopened.
  const dismiss = () => {
    dialogRef.current?.close()
    onClose()
  }

  // The cross always means "one step back", which on the first step is leaving altogether.
  const backTarget: Record<Step, Step | null> = { select: null, details: 'select', otp: 'details' }
  const goBack = () => {
    const target = backTarget[step]
    if (target) setStep(target)
    else dismiss()
  }

  const toggle = (businessName: string) =>
    setSelected((current) =>
      current.includes(businessName) ? current.filter((name) => name !== businessName) : [...current, businessName],
    )

  async function requestCode(phoneE164: string) {
    setIsSending(true)
    setOtpError(null)
    try {
      setSession(await sendOtp(phoneE164))
      setDigits(Array<string>(OTP_LENGTH).fill(''))
      setCooldown(RESEND_COOLDOWN_SECONDS)
      setStep('otp')
    } catch {
      setErrors((current) => ({ ...current, phone: "That number didn't accept a code. Check it and try again." }))
      setStep('details')
    } finally {
      setIsSending(false)
    }
  }

  function handleDetailsSubmit(event: FormEvent) {
    event.preventDefault()
    const cleanName = sanitise(fullName, 100)
    const cleanEmail = sanitise(email, 254).toLowerCase()
    const cleanPhone = normalisePhone(phone)

    const nextErrors: typeof errors = {}
    if (cleanName.length < 2) nextErrors.fullName = 'Enter your full name.'
    if (!EMAIL_PATTERN.test(cleanEmail)) nextErrors.email = 'Enter an email address we can reach you at.'
    if (!isValidPhone(cleanPhone)) {
      nextErrors.phone = `Enter a phone number with its country code, like ${DEFAULT_COUNTRY_CODE} 302 944 7610.`
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setFullName(cleanName)
    setEmail(cleanEmail)
    setPhone(cleanPhone)
    // The lead itself (cleanName/cleanEmail/cleanPhone + `selected`) posts to the backend once
    // verification is real — nothing to send it to yet.
    void requestCode(cleanPhone)
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    setIsVerifying(true)
    setOtpError(null)
    try {
      // A code is single use, so a verification that succeeded is remembered: if the write that
      // follows fails, pressing the button again retries only the write. Otherwise a lost lead
      // would be unrecoverable — their number is verified and the code is already spent.
      const uid = verifiedUid ?? (await verifyOtp(session, digits.join('')))
      setVerifiedUid(uid)

      // Rendered once and used twice: filed against the job, and posted into each business's
      // chat. All of it is optional — every step resolves to null or does nothing on failure,
      // and the lead still goes in. A job without its transcript beats no job at all.
      const pdf = await buildTranscriptPdf(quoteSession)
      const aiChatPdfUrl = pdf ? await storeTranscriptForJob(quoteSession, pdf) : null

      await submitJob({
        fullName,
        email,
        phoneE164: session.phoneE164,
        uid,
        sessionId: quoteSession.sessionId,
        aiChatPdfUrl,
        place,
        businesses: selectedQuotes.flatMap((quote) =>
          quote.businessId ? [{ id: quote.businessId, autoAcceptsAi: quote.autoAcceptsAi === true }] : [],
        ),
      })

      // After the lead is safe, never before: the chat is where the customer picks the
      // conversation up on the other site, and it is the one part they will actually read.
      if (pdf) {
        await shareTranscriptInChats({
          customerUid: uid,
          businesses: selectedQuotes.flatMap((quote) =>
            quote.businessId ? [{ id: quote.businessId, name: quote.businessName }] : [],
          ),
          pdf,
        })
      }
      // No success screen: the businesses they picked are waiting on the other site, and a page
      // telling them so is one more click between them and the conversation. The session travels
      // with them, so they land signed in.
      setIsLeaving(true)
      window.location.assign(await partnerSiteUrl())
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "That code didn't match. Try again.")
    } finally {
      setIsVerifying(false)
    }
  }

  const stepIndex = FORM_STEPS.indexOf(step)
  const { title, caption } = PANEL_LABEL[step]

  const primaryButton =
    'rounded-2xl bg-[#062D27] px-5 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#0a3f37] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#062D27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]'
  const secondaryButton =
    'rounded-2xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]'
  const textButton =
    'rounded-lg px-2 py-1 text-sm font-semibold text-[#047857] transition-colors hover:text-[#065F46] disabled:cursor-not-allowed disabled:text-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]'

  return (
    <dialog
      ref={dialogRef}
      // Esc is handled here too, for the same reason — and so it always exits through the
      // one close path rather than the browser's.
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        dismiss()
      }}
      aria-labelledby="instant-quote-title"
      // `m-auto` is what centres a modal dialog — Tailwind's preflight zeroes the margin the
      // browser sets for that, so it has to be asked for explicitly.
      className="m-auto w-full max-w-2xl overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-[0_25px_50px_-12px_rgba(6,45,39,0.35)] backdrop:bg-[#062D27]/45 backdrop:backdrop-blur-[2px] max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
    >
      <div className="flex max-h-[85vh] flex-col max-sm:h-full max-sm:max-h-none">
        <div className="flex items-start gap-3 px-5 pt-5 sm:px-8 sm:pt-6">
          <button
            type="button"
            onClick={goBack}
            aria-label={backTarget[step] ? 'Go back a step' : 'Close instant quote'}
            className="mt-0.5 shrink-0 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            <CloseIcon />
          </button>
          <div className="min-w-0 flex-1">
            <h2 id="instant-quote-title" className="text-lg font-semibold tracking-tight text-[#062D27] sm:text-xl">
              {title}
            </h2>
            <p className="text-sm text-[#6B7280]">
              {stepIndex >= 0 && (
                <span className="font-medium text-[#062D27]">
                  Step {stepIndex + 1} of {FORM_STEPS.length} ·{' '}
                </span>
              )}
              {caption}
            </p>
          </div>
        </div>

        {stepIndex >= 0 && (
          <div aria-hidden="true" className="flex gap-1.5 px-5 pt-4 sm:px-8">
            {FORM_STEPS.map((formStep, index) => (
              <span
                key={formStep}
                className={`h-0.75 flex-1 rounded-full transition-colors duration-300 ${
                  index <= stepIndex ? 'bg-[#062D27]' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          {step === 'select' && (
            <div className="flex flex-col gap-3 pt-3">
              {quotes.map((quote, index) => {
                const isSelected = selected.includes(quote.businessName)
                return (
                  <label
                    key={quote.businessName}
                    className={`flex cursor-pointer items-start gap-3 rounded-[26px] p-1.5 transition-colors has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[#062D27] sm:gap-4 ${
                      isSelected ? 'bg-[#EFF6F5]' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={isSelected}
                      onChange={() => toggle(quote.businessName)}
                    />
                    <span
                      aria-hidden="true"
                      className={`mt-6 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-all duration-150 sm:mt-8 ${
                        isSelected ? 'border-[#062D27] bg-[#062D27]' : 'border-gray-300 bg-white'
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth={3.5}
                        className={`h-3.5 w-3.5 transition-transform duration-150 ${isSelected ? 'scale-100' : 'scale-0'}`}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <QuoteCard quote={quote} revealName revealDelayMs={index * 110} />
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {step === 'details' && (
            <form id="instant-quote-details" noValidate onSubmit={handleDetailsSubmit} className="flex flex-col gap-5">
              <TextField
                id="lead-name"
                label="Full name"
                autoComplete="name"
                maxLength={100}
                placeholder="Ayesha Khan"
                value={fullName}
                error={errors.fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
              <TextField
                id="lead-email"
                label="Email"
                type="email"
                autoComplete="email"
                maxLength={254}
                placeholder="you@example.com"
                value={email}
                error={errors.email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <TextField
                id="lead-phone"
                label="Phone number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                placeholder={`${DEFAULT_COUNTRY_CODE} 302 944 7610`}
                value={phone}
                error={errors.phone}
                hint={`Local numbers are fine — 0302… becomes ${DEFAULT_COUNTRY_CODE}302…`}
                onChange={(event) => setPhone(event.target.value)}
                // Normalising on blur shows people the number that will actually be dialled,
                // instead of silently rewriting it after they've submitted.
                onBlur={(event) => {
                  const normalised = normalisePhone(event.target.value)
                  if (isValidPhone(normalised)) {
                    setPhone(normalised)
                    setErrors((current) => ({ ...current, phone: undefined }))
                  }
                }}
              />
              <p className="text-sm text-[#6B7280]">
                {selected.length === 1
                  ? '1 business will receive this.'
                  : `${selected.length} businesses will receive this.`}
              </p>
            </form>
          )}

          {step === 'otp' && (
            <form id="instant-quote-otp" onSubmit={handleVerify} className="flex flex-col gap-5">
              <p className="text-base text-[#6B7280]">
                Enter the {OTP_LENGTH}-digit code sent to <span className="font-semibold text-[#062D27]">{phone}</span>
              </p>

              <OtpInput
                digits={digits}
                onChange={(next) => {
                  setDigits(next)
                  setOtpError(null)
                }}
                hasError={!!otpError}
                autoFocus={step === 'otp'}
              />

              {otpError && (
                <p role="alert" className="text-sm text-red-600">
                  {otpError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button type="button" className={textButton} onClick={() => setStep('details')}>
                  Change number
                </button>
                <span aria-hidden="true" className="text-gray-300">
                  ·
                </span>
                <button
                  type="button"
                  className={textButton}
                  disabled={cooldown > 0 || isSending}
                  onClick={() => void requestCode(phone)}
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </button>
              </div>

            </form>
          )}

        </div>

        {/* Firebase's invisible reCAPTCHA mounts here. Outside the step branches on purpose:
            the code is requested from the details step, and the verifier can only be built
            against a container that is already in the DOM. */}
        <div id={RECAPTCHA_CONTAINER_ID} />

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4 sm:px-8">
          {step === 'select' && (
            <>
              <button type="button" onClick={dismiss} className={`${secondaryButton} max-sm:flex-1`}>
                Cancel
              </button>
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => setStep('details')}
                className={`${primaryButton} max-sm:flex-1`}
              >
                Continue{selected.length > 0 ? ` (${selected.length})` : ''}
              </button>
            </>
          )}

          {step === 'details' && (
            <>
              <button type="button" onClick={dismiss} className={`${secondaryButton} max-sm:flex-1`}>
                Cancel
              </button>
              <button
                type="submit"
                form="instant-quote-details"
                disabled={isSending}
                className={`${primaryButton} max-sm:flex-1`}
              >
                {isSending ? 'Sending code…' : 'Continue'}
              </button>
            </>
          )}

          {step === 'otp' && (
            <>
              <button type="button" onClick={dismiss} className={`${secondaryButton} max-sm:flex-1`}>
                Cancel
              </button>
              <button
                type="submit"
                form="instant-quote-otp"
                disabled={isVerifying || isLeaving || digits.join('').length < OTP_LENGTH}
                className={`${primaryButton} max-sm:flex-1`}
              >
                {isLeaving ? 'Taking you there…' : isVerifying ? 'Verifying…' : 'Verify'}
              </button>
            </>
          )}

        </div>
      </div>
    </dialog>
  )
}
