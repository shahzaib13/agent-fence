import { describe, expect, it } from 'vitest'
import { buildTranscriptPdf } from './transcript'
import type { QuoteSession } from './quotes'

const session = (overrides: Partial<QuoteSession> = {}): QuoteSession => ({
  sessionId: 'sess-1',
  status: 'complete',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  messages: [{ id: 'm1', role: 'user', text: 'Quote please' }],
  checklist: { suburb: 'Berwick', kitchenSize: 'medium', wallType: 'timber_sleeper' },
  place: null,
  comparison: null,
  ...overrides,
})

async function pdfText(blob: Blob | null) {
  expect(blob).not.toBeNull()
  return Buffer.from(await blob!.arrayBuffer()).toString('latin1')
}

describe('buildTranscriptPdf', () => {
  it('prints a kitchen brief from checklistAnswered, never raw keys', async () => {
    const text = await pdfText(
      await buildTranscriptPdf(
        session({
          trade: 'kitchen',
          checklistAnswered: [
            { key: 'suburb', title: 'Suburb', value: 'Berwick, VIC 3806' },
            { key: 'kitchenSize', title: 'Kitchen size', value: 'Medium' },
          ],
        }),
      ),
    )

    expect(text).toContain('Kitchen size')
    expect(text).toContain('Medium')
    expect(text).not.toContain('kitchenSize')
  })

  it('prints a retaining wall brief from checklistDisplay when answered rows are absent', async () => {
    const text = await pdfText(
      await buildTranscriptPdf(
        session({
          trade: 'retaining_wall',
          checklist: { suburb: 'Berwick', wallType: 'timber_sleeper', lengthMeters: 15 },
          checklistDisplay: {
            suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
            wallType: { title: 'Wall type', value: 'Timber sleepers' },
            lengthMeters: { title: 'Length', value: '15m' },
          },
        }),
      ),
    )

    expect(text).toContain('Wall type')
    expect(text).toContain('Timber sleepers')
    expect(text).toContain('15m')
    expect(text).not.toContain('wallType')
    expect(text).not.toContain('15m²')
  })
})
