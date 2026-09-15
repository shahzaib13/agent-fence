import { describe, expect, it } from 'vitest'
import { BRIEF_HIDDEN_KEYS, collapsedChipTitle, diffFilledField, formatChecklistValue, getActiveCardIndex, showsInBrief } from './checklist'

describe('diffFilledField', () => {
  it('names the field that went from unknown to known', () => {
    expect(
      diffFilledField({ suburb: 'Berwick', fenceType: null }, { suburb: 'Berwick', fenceType: 'Colorbond' }),
    ).toBe('fenceType')
  })

  it('ignores _ui when diffing', () => {
    expect(
      diffFilledField(
        { suburb: 'Berwick', _ui: { page: 0 } },
        { suburb: 'Berwick', material: 'colorbond', _ui: { page: 1 } },
      ),
    ).toBe('material')
  })

  it('treats a field the previous checklist never had as newly filled', () => {
    expect(diffFilledField(null, { suburb: 'Berwick', fenceType: null })).toBe('suburb')
  })

  it('returns undefined when nothing new was filled in', () => {
    expect(diffFilledField({ suburb: 'Berwick' }, { suburb: 'Berwick' })).toBeUndefined()
    expect(diffFilledField({ suburb: 'Berwick' }, null)).toBeUndefined()
  })
})

describe('collapsedChipTitle', () => {
  it('prefers the server title over anything the client might invent', () => {
    expect(
      collapsedChipTitle('kitchenSize', [{ key: 'kitchenSize', title: 'Kitchen size', value: 'Medium' }]),
    ).toBe('Kitchen size')
  })

  it('never prints a raw slug when the server title is missing', () => {
    expect(collapsedChipTitle('kitchenSize')).toBeUndefined()
    expect(collapsedChipTitle('benchtop')).toBeUndefined()
    expect(collapsedChipTitle('fenceType')).toBeUndefined()
    expect(collapsedChipTitle('wallType')).toBeUndefined()
  })
})

describe('formatChecklistValue', () => {
  it('formats booleans as Yes/No', () => {
    expect(formatChecklistValue('removeOldFence', true)).toBe('Yes')
    expect(formatChecklistValue('removeOldFence', false)).toBe('No')
  })

  it('does not invent a unit from the field name', () => {
    expect(formatChecklistValue('lengthMeters', 20)).toBe('20')
    expect(formatChecklistValue('areaSqm', 20)).toBe('20')
    expect(formatChecklistValue('heightMm', 1800)).toBe('1800')
    expect(formatChecklistValue('heightKey', '1.8m')).toBe('1.8m')
  })

  it('uses the response unit when a fallback must format a bare number', () => {
    expect(formatChecklistValue('lengthMeters', 20, 'm')).toBe('20m')
    expect(formatChecklistValue('areaSqm', 20, 'm2')).toBe('20m²')
    expect(formatChecklistValue('kitchenSize', 1, 'item')).toBe('1')
  })

  it('formats condition slugs and existing prices without appending metres', () => {
    expect(formatChecklistValue('conditions', ['rock', 'sloped'])).toBe('Rocky ground, Sloped ground')
    expect(formatChecklistValue('existingPrice', 2400)).toBe('$2400')
  })

  it('returns an empty string for null', () => {
    expect(formatChecklistValue('suburb', null)).toBe('')
  })

  it('formats the removal yes/no values and title-cases a named type from free text', () => {
    expect(formatChecklistValue('removal', 'any')).toBe('Yes')
    expect(formatChecklistValue('removal', 'none')).toBe('None')
    expect(formatChecklistValue('removal', 'timber')).toBe('Timber')
    expect(formatChecklistValue('removal', 'ceramic')).toBe('Ceramic')
  })
})

describe('showsInBrief', () => {
  it('never surfaces _ui', () => {
    expect(showsInBrief('_ui', { _ui: { page: 1 }, suburb: null })).toBe(false)
    expect(BRIEF_HIDDEN_KEYS.has('_ui')).toBe(true)
  })

  it('hides gateQty when there is no gate type', () => {
    expect(showsInBrief('gateQty', { gateType: 'none', gateQty: null })).toBe(false)
  })

  it('hides decking follow-ups until those extras are chosen', () => {
    expect(showsInBrief('balustradeLm', { balustrade: 'none', balustradeLm: null })).toBe(false)
    expect(showsInBrief('stairFlights', { stairs: 'none', stairFlights: null })).toBe(false)
    expect(showsInBrief('balustradeLm', { balustrade: 'glass', balustradeLm: null })).toBe(true)
    expect(showsInBrief('stairFlights', { stairs: 'yes', stairFlights: null })).toBe(true)
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
