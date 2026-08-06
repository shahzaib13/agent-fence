// Phone numbers go out to the backend in E.164 (`+<country><subscriber>`), but people type
// them however they're used to writing them locally — with a leading 0, with spaces, with
// brackets. Everything here is about getting from what they typed to E.164 without making
// them retype it.

// Pakistan for now; switch this one line to '+61' when the flow goes live in Australia —
// the leading-zero rule is the same for both (0302… -> +92302…, 0412… -> +61412…).
export const DEFAULT_COUNTRY_CODE = '+92'

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
