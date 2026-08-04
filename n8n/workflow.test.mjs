import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The workflow's Code nodes hold the business logic that decides who gets quoted and for how
// much, and n8n itself has no way to test them — they are strings inside a JSON export. This
// runs them the way n8n does (stubbed `$` / `$input`) against the real bundled dataset.
// Read from the project root: Vitest runs there, and `import.meta.url` under Vite's module
// runner isn't a file:// URL.
const wf = JSON.parse(readFileSync('n8n/fencing-workflow-updated.json', 'utf8'))
const src = (name) => {
  const node = wf.nodes.find((n) => n.name === name)
  if (!node) throw new Error(`node not found: ${name}`)
  return node.parameters.jsCode
}

const workers = new Function(src('Dummy Firebase Workers Data1'))()

function run(nodeName, { nodes = {}, input = [] }) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`no stub for ${name}`)
    return { first: () => ({ json: nodes[name] }) }
  }
  const $input = { first: () => input[0], all: () => input }
  return new Function('$', '$input', src(nodeName))($, $input)[0].json
}

const FULL_BRIEF = {
  suburb: 'Pakenham',
  fenceType: 'Colorbond',
  lengthMeters: 20,
  heightMm: 1800,
  removeOldFence: false,
  siteAccess: 'easy',
}
const HALF_BRIEF = { ...FULL_BRIEF, heightMm: null, removeOldFence: null, siteAccess: null }

const rank = (checklist) =>
  run('Rank and Format Top ', { nodes: { 'Format New-Quote Result1': { checklist } }, input: workers })

const rankComparison = (checklist) =>
  run('Rank & Format Comparison Response', {
    nodes: { 'Format Comparison Result': { checklist, message: 'ok', sessionId: 's', intent: 'compare_quote' } },
    input: workers,
  })

const formatNewQuote = (output, knownChecklist = '') =>
  run('Format New-Quote Result1', {
    nodes: {
      'Normalize Input1': { sessionId: 's', knownChecklist },
      'Format Comparison Result': { intent: 'new_quote' },
    },
    input: [{ json: { output } }],
  })

const formatComparison = (output, lockedIntent = '') =>
  run('Format Comparison Result', {
    nodes: {
      'Normalize Input1': { sessionId: 's', message: 'hi', lockedIntent, knownChecklist: '' },
      'Normalize Extracted Text': { extractedText: '' },
    },
    input: [{ json: { output } }],
  })

const servicesSuburb = (businessName, suburb) =>
  workers.find((w) => w.json.businessName === businessName).json.serviceSuburbs.includes(suburb)

describe('suburb matching', () => {
  it('only ranks businesses that actually service the customer suburb', () => {
    const { matchCount, results } = rank(FULL_BRIEF)

    expect(matchCount).toBeGreaterThan(0)
    expect(results.every((r) => servicesSuburb(r.businessName, 'Pakenham'))).toBe(true)
  })

  it('echoes the customer suburb on every result, never one of the business\'s others', () => {
    expect([...new Set(rank(FULL_BRIEF).results.map((r) => r.suburb))]).toEqual(['Pakenham'])
  })

  it('normalises case, state and postcode onto the same suburb', () => {
    expect(rank({ ...FULL_BRIEF, suburb: 'pakenham vic 3810' }).results.map((r) => r.businessName)).toEqual(
      rank(FULL_BRIEF).results.map((r) => r.businessName),
    )
  })

  it('matches exactly — a near miss finds nobody rather than somebody nearby', () => {
    expect(rank({ ...FULL_BRIEF, suburb: 'Pakenha' }).matchCount).toBe(0)
  })

  it('cannot rank at all without a suburb', () => {
    expect(rank({ ...FULL_BRIEF, suburb: null }).matchCount).toBe(0)
  })

  it('separates "nobody covers this suburb" from "nobody here does this fence type"', () => {
    expect(rank({ ...FULL_BRIEF, suburb: 'Gotham City' })).toMatchObject({ matchCount: 0, noMatchReason: 'suburb' })
    expect(rank({ ...FULL_BRIEF, suburb: 'Port Fairy', fenceType: 'Bamboo' })).toMatchObject({
      matchCount: 0,
      noMatchReason: 'fenceType',
    })
  })

  it('applies the same filter to the quote-comparison flow', () => {
    const { comparison } = rankComparison({ suburb: 'Pakenham', fenceType: 'Colorbond', lengthMeters: 20, existingPrice: 4000 })

    expect(comparison.quotes.length).toBeGreaterThan(0)
    expect(comparison.quotes.every((q) => servicesSuburb(q.businessName, 'Pakenham'))).toBe(true)
    expect([...new Set(comparison.quotes.map((q) => q.suburb))]).toEqual(['Pakenham'])
    expect(rankComparison({ suburb: 'Gotham City', fenceType: 'Colorbond', lengthMeters: 20 }).comparison.quotes).toEqual([])
  })
})

describe('unit conversion', () => {
  const height = (value) => formatNewQuote({ type: 'question', message: 'x', options: [], checklist: { ...FULL_BRIEF, heightMm: value } }).checklist.heightMm

  it.each([
    [1.5, 1500],
    [1.8, 1800],
    [2.1, 2100],
  ])('reads %s as metres -> %imm', (given, want) => expect(height(given)).toBe(want))

  it.each([
    [150, 1500],
    [180, 1800],
    [240, 2400],
  ])('reads %i as centimetres -> %imm', (given, want) => expect(height(given)).toBe(want))

  it.each([
    [600, 600],
    [1500, 1500],
    [1800, 1800],
  ])('leaves %imm alone', (given, want) => expect(height(given)).toBe(want))
})

describe('checklist gate', () => {
  it('rewrites a premature confirmation into the question that was actually due', () => {
    const out = formatNewQuote({
      type: 'confirmation',
      message: 'All correct?',
      options: [{ label: 'Yes', value: 'yes' }],
      checklist: HALF_BRIEF,
    })

    expect(out.type).toBe('question')
    expect(out.message).toBe('What height are you after?')
    expect(out.options.map((o) => o.value)).toEqual([1500, 1800])
  })

  it('never lets the ranking step run on a half-filled brief', () => {
    const half = formatNewQuote({ type: 'message', message: 'done', options: [], checklistComplete: true, checklist: HALF_BRIEF })
    const complete = formatNewQuote({ type: 'message', message: 'done', options: [], checklistComplete: true, checklist: FULL_BRIEF })

    expect(half.checklistComplete).toBe(false)
    expect(complete.checklistComplete).toBe(true)
  })
})

describe('never emits an empty message', () => {
  it('falls back to the due question when the agent returns a blank one', () => {
    expect(formatNewQuote({ type: 'message', message: '   ', options: [], checklist: HALF_BRIEF }).message).toBe(
      'What height are you after?',
    )
  })

  it('falls back to an apology when the brief is finished and there is nothing to ask', () => {
    expect(formatNewQuote({ type: 'message', message: '', options: [], checklist: FULL_BRIEF }).message).toMatch(/something went wrong/i)
  })

  it('substitutes a line on the compare branch but keeps the silent new_quote hand-off', () => {
    expect(formatComparison({ intent: 'compare_quote', type: 'message', message: '' }).message).not.toBe('')
    // this one is by design: the intent agent stays quiet and Fencing AI Agent1 does the talking
    expect(formatComparison({ intent: 'new_quote', type: 'message', message: '' }).message).toBe('')
  })
})

describe('intent lock', () => {
  it('keeps the client-locked flow when the classifier flips mid-conversation', () => {
    expect(formatComparison({ intent: 'compare_quote', type: 'message', message: 'x' }, 'new_quote').intent).toBe('new_quote')
  })

  it('lets the classifier decide while nothing is locked, and ignores a junk lock', () => {
    expect(formatComparison({ intent: 'compare_quote', type: 'message', message: 'x' }, '').intent).toBe('compare_quote')
    expect(formatComparison({ intent: 'compare_quote', type: 'message', message: 'x' }, 'nonsense').intent).toBe('compare_quote')
  })
})

describe('known-checklist merge', () => {
  const droppedSuburb = { type: 'question', message: 'Which suburb?', options: [], checklist: { ...FULL_BRIEF, suburb: null } }

  it('restores a value the agent dropped, so it is not asked for twice', () => {
    expect(formatNewQuote(droppedSuburb, JSON.stringify({ suburb: 'Pakenham' })).checklist.suburb).toBe('Pakenham')
  })

  it('invents nothing when the client knows nothing yet', () => {
    expect(formatNewQuote(droppedSuburb, '').checklist.suburb).toBeNull()
  })
})
