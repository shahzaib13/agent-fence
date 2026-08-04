import { describe, expect, it } from 'vitest'
import { checklistFieldLabel, diffFilledField, formatChecklistValue, getActiveCardIndex } from './checklist'

describe('diffFilledField', () => {
  it('names the field that went from unknown to known', () => {
    expect(
      diffFilledField({ suburb: 'Berwick', fenceType: null }, { suburb: 'Berwick', fenceType: 'Colorbond' }),
    ).toBe('fenceType')
  })

  it('treats a field the previous checklist never had as newly filled', () => {
    expect(diffFilledField(null, { suburb: 'Berwick', fenceType: null })).toBe('suburb')
  })

  it('returns undefined when nothing new was filled in', () => {
    expect(diffFilledField({ suburb: 'Berwick' }, { suburb: 'Berwick' })).toBeUndefined()
    expect(diffFilledField({ suburb: 'Berwick' }, null)).toBeUndefined()
  })
})

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
    // a bucket answer reads back as the range the customer picked, not a number from inside it
    expect(formatChecklistValue('lengthMeters', '20-40')).toBe('20-40m')
    expect(formatChecklistValue('lengthMeters', '40+')).toBe('40m+')
    expect(formatChecklistValue('heightMm', 1800)).toBe('1800mm')
    expect(formatChecklistValue('existingPrice', 2400)).toBe('$2400')
  })

  it('returns an empty string for null', () => {
    expect(formatChecklistValue('suburb', null)).toBe('')
  })
})

describe('getActiveCardIndex', () => {
  it('rests on card 0 before any checklist is known', () => {
    expect(getActiveCardIndex(null, false, false)).toBe(0)
  })

  it('rests on card 1 while any field is still missing', () => {
    expect(getActiveCardIndex({ suburb: 'Berwick', fenceType: null }, false, false)).toBe(1)
  })

  it('rests on card 2 once every field is known but not yet confirmed', () => {
    expect(getActiveCardIndex({ suburb: 'Berwick', fenceType: 'Timber' }, false, false)).toBe(2)
  })

  it('jumps straight to card 3 while awaiting the final result, regardless of checklist state', () => {
    expect(getActiveCardIndex(null, false, true)).toBe(3)
  })

  it('rests on card 3 once checklistComplete is true', () => {
    expect(getActiveCardIndex({ suburb: 'Berwick', fenceType: 'Timber' }, true, false)).toBe(3)
  })
})
