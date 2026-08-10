// Phone numbers go out to the backend in E.164 (`+<country><subscriber>`), but people type
// them however they're used to writing them locally — with a leading 0, with spaces, with
// brackets. Everything here is about getting from what they typed to E.164 without making
// them retype it.

// Which country a local number belongs to. Set `VITE_DEFAULT_COUNTRY_CODE` and nothing here has
// to change — that is the point: going live in Australia is an environment change, not a code
// change, so it can happen on Vercel without a pull request.
//
// The fallback stays '+92' because that is where testing happens today. The leading-zero rule is
// the same either way (0302… -> +92302…, 0412… -> +61412…), so switching is genuinely one value.
//
// Read at module load rather than per call: Vite inlines `import.meta.env` at build time, so
// there is nothing dynamic to wait for, and every caller wants the same answer.
const configured = (import.meta.env.VITE_DEFAULT_COUNTRY_CODE as string | undefined)?.trim()

// A malformed value is worse than no value — it would silently prefix every number with garbage
// and every OTP would fail with no clue why. Anything that isn't `+` followed by 1–3 digits is
// ignored in favour of the fallback.
export const DEFAULT_COUNTRY_CODE = configured && /^\+\d{1,3}$/.test(configured) ? configured : '+92'

/**
 * Normalises a typed phone number to E.164. Returns '' for empty input; returns whatever it
 * could make of the input otherwise — validity is `isValidPhone`'s job, not this one's.
 */
export function normalisePhone(input: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  // Anything that isn't a digit or a leading + is formatting noise: spaces, dashes, dots,
  // brackets, and the odd unicode dash pasted out of a contacts app.
  const cleaned = input.replace(/[^\d+]/g, '').slice(0, 20)
  if (!cleaned) return ''

  const digits = cleaned.replace(/\+/g, '')
  if (!digits) return ''

  // 00 is the other way half the world writes +.
  if (cleaned.startsWith('00')) return `+${digits.slice(2)}`
  if (cleaned.startsWith('+')) return `+${digits}`
  // The common local form: drop the trunk 0, prepend the country code.
  if (digits.startsWith('0')) return `${countryCode}${digits.slice(1)}`
  // ponytail: a bare number that already opens with the country-code digits is assumed to
  // include the country code (923029447610 -> +923029447610). Misreads the rare local number
  // that genuinely starts with those digits and no trunk 0; swap in libphonenumber-js if that
  // ever shows up in real submissions.
  if (digits.startsWith(countryCode.slice(1))) return `+${digits}`
  return `${countryCode}${digits}`
}

/** E.164: a +, a non-zero country digit, then 8–15 digits total. */
export function isValidPhone(e164: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(e164)
}
