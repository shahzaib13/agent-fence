import { describe, expect, it } from 'vitest'
import { buildAiSummary } from './aiSummary'
import type { QuoteSession } from './quotes'

const session = (overrides: Partial<QuoteSession> = {}): QuoteSession => ({
  sessionId: 'sess-1',
  status: 'complete',
  createdAt: 1000,
  updatedAt: 1000,
  messages: [{ id: 'm1', role: 'user', text: 'New kitchen, medium size' }],
  checklist: { suburb: 'Berwick', kitchenSize: 'medium', wallType: 'timber_sleeper' },
  place: null,
  comparison: null,
  ...overrides,
})

describe('buildAiSummary', () => {
  it('builds a kitchen brief from checklistAnswered, never raw keys', () => {
    const summary = buildAiSummary(
      session({
        trade: 'kitchen',
        checklistAnswered: [
          { key: 'suburb', title: 'Suburb', value: 'Berwick, VIC 3806' },
          { key: 'kitchenSize', title: 'Kitchen size', value: 'Medium' },
        ],
      }),
    )

    expect(summary.brief).toEqual([
      { label: 'Suburb', value: 'Berwick, VIC 3806' },
      { label: 'Kitchen size', value: 'Medium' },
    ])
    expect(JSON.stringify(summary.brief)).not.toMatch(/kitchenSize/)
  })

  it('builds a retaining wall brief from checklistDisplay when answered rows are absent', () => {
    const summary = buildAiSummary(
      session({
        trade: 'retaining_wall',
        checklist: { suburb: 'Berwick', wallType: 'timber_sleeper', lengthMeters: 15 },
        checklistDisplay: {
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
          wallType: { title: 'Wall type', value: 'Timber sleepers' },
          lengthMeters: { title: 'Length', value: '15m' },
        },
      }),
    )

    expect(summary.brief).toEqual([
      { label: 'Suburb', value: 'Berwick, VIC 3806' },
      { label: 'Wall type', value: 'Timber sleepers' },
      { label: 'Length', value: '15m' },
    ])
    expect(JSON.stringify(summary.brief)).not.toMatch(/wallType/)
    expect(JSON.stringify(summary.brief)).not.toMatch(/15m²/)
  })

  it('does not invent a brief from field names when display and answered are absent', () => {
    const summary = buildAiSummary(session({ trade: 'kitchen' }))
    expect(summary.brief).toEqual([])
    expect(JSON.stringify(summary)).not.toMatch(/kitchenSize/)
    expect(JSON.stringify(summary)).not.toMatch(/wallType/)
  })
})
