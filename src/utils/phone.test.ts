import { describe, expect, it } from 'vitest'
import { isValidPhone, normalisePhone } from './phone'

describe('normalisePhone', () => {
  it('leaves an already-correct E.164 number alone', () => {
    expect(normalisePhone('+923029447610')).toBe('+923029447610')
  })

  it('converts a local number with a trunk 0 to the default country code', () => {
    expect(normalisePhone('03029447610')).toBe('+923029447610')
  })

  it('strips typed formatting — spaces, dashes, brackets', () => {
    expect(normalisePhone('+92 302 944 7610')).toBe('+923029447610')
    expect(normalisePhone('0302-944-7610')).toBe('+923029447610')
    expect(normalisePhone('(0302) 944 7610')).toBe('+923029447610')
  })

  it('treats a 00 prefix as +', () => {
    expect(normalisePhone('0092 302 944 7610')).toBe('+923029447610')
  })

  it('prepends the country code to a bare subscriber number', () => {
    expect(normalisePhone('3029447610')).toBe('+923029447610')
  })

  it('assumes a bare number opening with the country-code digits already includes it', () => {
    expect(normalisePhone('923029447610')).toBe('+923029447610')
  })

  it('honours an explicit country code, so Australia is a one-argument change', () => {
    expect(normalisePhone('0412345678', '+61')).toBe('+61412345678')
    expect(normalisePhone('+61412345678', '+61')).toBe('+61412345678')
  })

  it('returns an empty string for input with nothing dialable in it', () => {
    expect(normalisePhone('')).toBe('')
    expect(normalisePhone('   ')).toBe('')
    expect(normalisePhone('not a phone')).toBe('')
  })
})

describe('isValidPhone', () => {
  it('accepts normalised numbers of a plausible length', () => {
    expect(isValidPhone('+923029447610')).toBe(true)
    expect(isValidPhone('+61412345678')).toBe(true)
  })

  it('rejects anything that is not E.164', () => {
    expect(isValidPhone('')).toBe(false)
    expect(isValidPhone('03029447610')).toBe(false)
    expect(isValidPhone('+92302')).toBe(false)
    expect(isValidPhone('+9230294476101234')).toBe(false)
    expect(isValidPhone('+0302944761')).toBe(false)
  })
})
