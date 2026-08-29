import { describe, expect, it } from 'vitest'
import { mergeChecklistData, mergeChecklistDisplay } from './checklistMerge'

describe('mergeChecklistData', () => {
  it('ignores empty objects so a fresh voice session does not wipe the brief', () => {
    expect(mergeChecklistData({ suburb: 'Berwick' }, {})).toEqual({ suburb: 'Berwick' })
  })

  it('merges non-empty keys onto the previous brief', () => {
    expect(mergeChecklistData({ suburb: 'Berwick', fenceType: null }, { fenceType: 'Colorbond' })).toEqual({
      suburb: 'Berwick',
      fenceType: 'Colorbond',
    })
  })

  it('keeps the previous brief when next is null or undefined', () => {
    expect(mergeChecklistData({ suburb: 'Berwick' }, null)).toEqual({ suburb: 'Berwick' })
    expect(mergeChecklistData({ suburb: 'Berwick' }, undefined)).toEqual({ suburb: 'Berwick' })
  })
})

describe('mergeChecklistDisplay', () => {
  it('ignores empty objects so a fresh voice session does not wipe the panel', () => {
    expect(mergeChecklistDisplay({ suburb: { title: 'Suburb', value: 'Berwick' } }, {})).toEqual({
      suburb: { title: 'Suburb', value: 'Berwick' },
    })
  })

  it('keeps the previous display when next is null', () => {
    expect(mergeChecklistDisplay({ suburb: { title: 'Suburb', value: 'Berwick' } }, null)).toEqual({
      suburb: { title: 'Suburb', value: 'Berwick' },
    })
  })
})
