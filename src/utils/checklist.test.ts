import { describe, expect, it } from 'vitest'
import { checklistFieldLabel, formatChecklistValue } from './checklist'

describe('checklistFieldLabel', () => {
  it('maps a known key to its human label', () => {
    expect(checklistFieldLabel('fenceType')).toBe('Fence type')
  })

  it('falls back to the raw key when unrecognised', () => {
    expect(checklistFieldLabel('futureField')).toBe('futureField')
  })
})

describe('formatChecklistValue', () => {
  it('formats booleans as Yes/No', () => {
    expect(formatChecklistValue('removeOldFence', true)).toBe('Yes')
    expect(formatChecklistValue('removeOldFence', false)).toBe('No')
  })

  it('appends units for length/height/price', () => {
    expect(formatChecklistValue('lengthMeters', 20)).toBe('20m')
    expect(formatChecklistValue('heightMm', 1800)).toBe('1800mm')
    expect(formatChecklistValue('existingPrice', 2400)).toBe('$2400')
  })

  it('returns an empty string for null', () => {
    expect(formatChecklistValue('suburb', null)).toBe('')
  })
})
