import { describe, expect, it } from 'vitest'
import { checklistAnsweredFromDisplay, checklistDisplayFromAnswered } from './checklistAnswered'

describe('checklistDisplayFromAnswered', () => {
  it('rebuilds a display map so create-call can greet with the brief', () => {
    expect(
      checklistDisplayFromAnswered([
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'fenceType', title: 'Fence type', value: 'Colorbond' },
      ]),
    ).toEqual({
      suburb: { title: 'Suburb', value: 'Berwick' },
      fenceType: { title: 'Fence type', value: 'Colorbond' },
    })
  })

  it('returns null when there is nothing answered', () => {
    expect(checklistDisplayFromAnswered([])).toBeNull()
    expect(checklistDisplayFromAnswered(undefined)).toBeNull()
  })
})

describe('checklistAnsweredFromDisplay', () => {
  it('drops empty values and hidden keys', () => {
    expect(
      checklistAnsweredFromDisplay({
        suburb: { title: 'Suburb', value: 'Berwick' },
        fenceType: { title: 'Fence type', value: '  ' },
        _ui: { title: 'UI', value: '1' },
      }),
    ).toEqual([{ key: 'suburb', title: 'Suburb', value: 'Berwick' }])
  })
})
