import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The workflow's Code nodes hold the business logic that decides who gets quoted and for how
// much, and n8n itself has no way to test them — they are strings inside a JSON export. This
// runs them the way n8n does (stubbed `$` / `$input`) against Firestore-shaped fixtures.
// Read from the project root: Vitest runs there, and `import.meta.url` under Vite's module
// runner isn't a file:// URL.
const wf = JSON.parse(readFileSync('n8n/fencing-workflow-updated.json', 'utf8'))
const src = (name) => {
  const node = wf.nodes.find((n) => n.name === name)
  if (!node) throw new Error(`node not found: ${name}`)
  return node.parameters.jsCode
}

function run(nodeName, { nodes = {}, input = [] }) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`no stub for ${name}`)
    const items = Array.isArray(nodes[name]) ? nodes[name] : [{ json: nodes[name] }]
    return { first: () => items[0], all: () => items }
  }
  const $input = { first: () => input[0], all: () => input }
  return new Function('$', '$input', src(nodeName))($, $input)
}
const runOne = (nodeName, args) => run(nodeName, args)[0].json

/* -------------------------------------------------------------------- fixtures */
// Pakenham, as Google Places returns it and as the businesses store their service area — the
// placeId is the same string on both sides, which is what the suburb gate matches on.
const PAKENHAM_ID = 'ChIJxUv0xoYb1moRsOCMIXVWBAU'
const PAKENHAM = {
  displayLabel: 'Pakenham, VIC 3810',
  suburb: 'Pakenham',
  placeId: PAKENHAM_ID,
  latitude: -38.0776708,
  longitude: 145.4818724,
}
const DARWIN = { name: 'Darwin', id: 'ChIJ-darwin', latitude: -12.4634, longitude: 130.8456 }

const business = (overrides = {}) => ({
  uid: 'uid-1',
  businessName: 'Modi Fencing',
  rating: 3.9,
  reviewCount: 54,
  isAutoAcceptEnabled: true,
  services_provided: ['fencing', 'retaining-wall', 'decking'],
  serviceArea: {
    name: 'Pakenham',
    id: PAKENHAM_ID,
    latitude: PAKENHAM.latitude,
    longitude: PAKENHAM.longitude,
    radiusMeters: 25000,
  },
  ...overrides,
})

const pricing = (overrides = {}) => ({
  trade: 'fencing',
  currency: 'AUD',
  isComplete: true,
  gstInclusive: true,
  minimumCharge: 1500,
  enabledTypes: ['timber'],
  rates: { timber: { 1.2: 20, 1.5: 60, 1.8: 100, 2.1: 140 } },
  removal: { offered: true, easy: 25, difficult: 50 },
  ...overrides,
})

const BRIEF = {
  suburb: 'Pakenham, VIC 3810',
  fenceType: 'Timber',
  lengthMeters: 20,
  heightMm: 1800,
  removeOldFence: false,
  siteAccess: null,
}

const gateJson = (checklist = BRIEF, place = PAKENHAM, extra = {}) => ({
  sessionId: 's',
  intent: checklist.existingPrice != null ? 'compare_quote' : 'new_quote',
  checklist,
  place,
  ...extra,
})

const filter = (businesses, checklist = BRIEF, place = PAKENHAM) =>
  run('Filter Businesses by Service Area', {
    nodes: { 'Format New-Quote Result1': gateJson(checklist, place) },
    input: businesses.map((json) => ({ json })),
  })

// Prices whatever survived the filter. `pairs` is [business, pricingDoc] in filter order.
const rank = (pairs, checklist = BRIEF) => {
  const covering = filter(
    pairs.map(([b]) => b),
    checklist,
  )
  // The pricing read runs once per surviving business, in the order the filter emitted them.
  const byUid = new Map(pairs.map(([b, p]) => [b.uid, p]))
  return runOne('Price & Rank Businesses', {
    nodes: { 'Format New-Quote Result1': gateJson(checklist), 'Filter Businesses by Service Area': covering },
    input: covering.map((item) => ({ json: byUid.get(item.json.uid) })),
  })
}

/* ------------------------------------------------------------ service area match */
describe('service area matching', () => {
  it('keeps a business registered in the suburb the customer asked for', () => {
    const [match] = filter([business()])

    expect(match.json).toMatchObject({ uid: 'uid-1', businessName: 'Modi Fencing', distanceKm: 0 })
  })

  it('never leaves the suburb, however far the business claims to travel', () => {
    // The whole point: three cards are not worth showing somebody a business in Darwin
    const darwin = business({ uid: 'darwin', serviceArea: { ...DARWIN, radiusMeters: 5000000 } })

    expect(filter([darwin])[0].json).toMatchObject({ noMatch: true, noMatchReason: 'suburb' })
  })

  it('matches on placeId, so spelling never decides it', () => {
    const oddSpelling = business({ serviceArea: { ...business().serviceArea, name: 'PAKENHAM  ' } })
    expect(filter([oddSpelling])[0].json.uid).toBe('uid-1')

    // A record saved before placeIds were kept still matches on a normalised name
    const legacy = business({ uid: 'legacy', serviceArea: { ...business().serviceArea, id: '', name: 'pakenham' } })
    expect(filter([legacy])[0].json.uid).toBe('legacy')

    // ...but a different suburb with no id does not
    const berwick = business({ uid: 'berwick', serviceArea: { ...business().serviceArea, id: '', name: 'Berwick' } })
    expect(filter([berwick])[0].json.noMatch).toBe(true)
  })

  it('still honours the radius inside the right suburb', () => {
    // Registered in Pakenham but only travels 500 m, and the customer is 5 km across it
    const homebody = business({
      uid: 'homebody',
      serviceArea: { ...business().serviceArea, latitude: -38.12, radiusMeters: 500 },
    })

    expect(filter([homebody])[0].json).toMatchObject({ noMatch: true, noMatchReason: 'radius' })
  })

  it('drops a business that does not do fencing at all', () => {
    expect(filter([business({ services_provided: ['decking'] })])[0].json.noMatch).toBe(true)
  })

  it('separates "no coordinates" from "nobody in that suburb"', () => {
    expect(filter([business()], BRIEF, null)[0].json).toMatchObject({ noMatch: true, noMatchReason: 'place' })
    expect(filter([business({ services_provided: [] })])[0].json).toMatchObject({ noMatch: true, noMatchReason: 'suburb' })
  })

  it('orders the survivors nearest first', () => {
    const near = business({ uid: 'near' })
    const far = business({
      uid: 'far',
      serviceArea: { ...business().serviceArea, latitude: -38.15, radiusMeters: 25000 },
    })

    expect(filter([far, near]).map((item) => item.json.uid)).toEqual(['near', 'far'])
  })
})

/* --------------------------------------------------------------------- pricing */
describe('pricing', () => {
  it('prices off the rate published for that type at that height', () => {
    const { comparison } = rank([[business(), pricing()]])

    // 1800mm reads the "1.8" rate: 100/m over an exact 20m, and that is the whole answer
    expect(comparison.quotes[0]).toMatchObject({ ratePerMeter: 100, projectTotalMin: 2000, projectTotalMax: 2000 })
  })

  it('adds removal per metre, and only when there is something to remove', () => {
    const withRemoval = { ...BRIEF, removeOldFence: true, siteAccess: 'difficult' }
    const { comparison } = rank([[business(), pricing()]], withRemoval)

    // (100 + 50) × 20 = 3000
    expect(comparison.quotes[0].projectTotalMin).toBe(3000)
    expect(rank([[business(), pricing()]]).comparison.quotes[0].projectTotalMin).toBe(2000)
  })

  it('never quotes under the business minimum charge', () => {
    const tinyJob = { ...BRIEF, lengthMeters: 5, heightMm: 1200 }
    // 20/m × 5m = 100, well under the 1500 floor
    expect(rank([[business(), pricing()]], tinyJob).comparison.quotes[0].projectTotalMin).toBe(1500)
  })

  it('quotes one figure, because the length and the rate are both exact', () => {
    const quote = rank([[business(), pricing()]], { ...BRIEF, lengthMeters: 33 }).comparison.quotes[0]

    expect(quote).toMatchObject({ projectTotalMin: 3300, projectTotalMax: 3300 })
  })

  it('matches the fence type however either side spells it', () => {
    // A type nobody offers has no comparison at all, hence the fallback rather than `.quotes`
    const typed = (fenceType, enabledTypes, rates) =>
      (rank([[business(), pricing({ enabledTypes, rates })]], { ...BRIEF, fenceType }).comparison?.quotes ?? []).length

    expect(typed('Timber', ['timber'], { timber: { 1.8: 100 } })).toBe(1)
    expect(typed('Pool Fencing', ['pool-fencing'], { 'pool-fencing': { 1.8: 100 } })).toBe(1)
    expect(typed('Security/Chainmesh', ['security-chainmesh'], { 'security-chainmesh': { 1.8: 100 } })).toBe(1)
    expect(typed('Colorbond', ['timber'], { timber: { 1.8: 100 } })).toBe(0)
  })

  it('drops a business that publishes no rate at the height asked, rather than inventing one', () => {
    const noTallRate = pricing({ rates: { timber: { 1.2: 20, 1.5: 60 } } })
    const result = rank([[business(), noTallRate]])

    expect(result.results).toEqual([])
    expect(result.noMatchReason).toBe('height')
    expect(result.message).toMatch(/height/i)
  })

  it('says which wall an empty result hit', () => {
    expect(rank([[business(), pricing({ enabledTypes: ['colorbond'] })]]).noMatchReason).toBe('fenceType')
    expect(rank([[business(), pricing({ isComplete: false })]]).noMatchReason).toBe('pricing')
  })
})

/* --------------------------------------------------------------------- ranking */
describe('ranking', () => {
  const cheap = [business({ uid: 'cheap', businessName: 'Cheap Fences' }), pricing({ rates: { timber: { 1.8: 80 } } })]
  const dear = [business({ uid: 'dear', businessName: 'Dear Fences' }), pricing({ rates: { timber: { 1.8: 150 } } })]
  const mid = [business({ uid: 'mid', businessName: 'Mid Fences' }), pricing({ rates: { timber: { 1.8: 110 } } })]

  it('ranks cheapest first and tags it as the best value', () => {
    const { comparison } = rank([dear, cheap, mid])

    expect(comparison.quotes.map((q) => q.businessName)).toEqual(['Cheap Fences', 'Mid Fences', 'Dear Fences'])
    expect(comparison.quotes.map((q) => q.tag)).toEqual(['BEST_VALUE', null, null])
  })

  it('shows at most three, but screens every business that covers the customer', () => {
    const fourth = [business({ uid: 'fourth' }), pricing({ rates: { timber: { 1.8: 200 } } })]
    const { comparison } = rank([dear, cheap, mid, fourth])

    expect(comparison.quotes).toHaveLength(3)
    expect(comparison.totalQuotesScreened).toBe(4)
  })

  it('measures savings against the customer\'s own quote when they gave one', () => {
    const withQuote = { ...BRIEF, existingPrice: 5000 }
    const { comparison, intent } = rank([cheap, dear], withQuote)

    expect(comparison.userExistingPrice).toBe(5000)
    // cheapest is 80/m × 20m = 1600
    expect(comparison.potentialSavings).toBe(5000 - 1600)
    expect(intent).toBe('compare_quote')
  })

  it('falls back to the local average when they did not', () => {
    const { comparison, intent } = rank([cheap, dear])

    expect(comparison.userExistingPrice).toBeNull()
    expect(comparison.marketAverage).toBe(Math.round((1600 + 3000) / 2))
    expect(intent).toBe('new_quote')
  })

  it('labels every card with whose GST it is, so a cheaper number is never just a missing 10%', () => {
    const exclusive = [business({ uid: 'ex' }), pricing({ gstInclusive: false })]
    const { comparison } = rank([exclusive])

    expect(comparison.quotes[0].badges).toContain('excl. GST')
    expect(rank([[business(), pricing()]]).comparison.quotes[0].badges).toContain('incl. GST')
  })

  it('carries the signals a customer would actually choose on', () => {
    const { comparison, results } = rank([[business(), pricing()]], { ...BRIEF, removeOldFence: true, siteAccess: 'easy' })

    expect(comparison.quotes[0].badges).toEqual(
      expect.arrayContaining(['3.9★ (54)', 'Removal included', 'Instant accept', 'In your suburb']),
    )
    // The client's existing result shape still renders these without a change
    expect(results[0]).toMatchObject({ businessName: 'Modi Fencing', suburb: 'Pakenham, VIC 3810', ratePerMeter: 100 })
  })
})

/* ---------------------------------------------------------------- no-match turn */
describe('no match', () => {
  const noMatch = (reason) =>
    runOne('Format No-Match Response', {
      nodes: { 'Format New-Quote Result1': gateJson() },
      input: [{ json: { noMatch: true, noMatchReason: reason } }],
    })

  it('explains which gate they hit rather than showing an empty results page', () => {
    expect(noMatch('suburb')).toMatchObject({ type: 'result', results: [], noMatchReason: 'suburb' })
    expect(noMatch('suburb').message).toMatch(/registered that suburb/i)
    expect(noMatch('radius').message).toMatch(/travel far enough/i)
  })

  it('asks for the suburb again when the place never resolved', () => {
    expect(noMatch('place').message).toMatch(/pick it from the suggestions/i)
  })
})

/* ------------------------------------------------------------- the checklist gate */
const formatTurn = (output, { knownChecklist = '', place = '' } = {}) =>
  runOne('Format New-Quote Result1', {
    nodes: { 'Normalize Input1': { sessionId: 's', knownChecklist, place } },
    input: [{ json: { output } }],
  })

const FULL_BRIEF = { ...BRIEF, suburb: 'Pakenham', removeOldFence: false, siteAccess: null }
const HALF_BRIEF = { ...FULL_BRIEF, heightMm: null, removeOldFence: null }

describe('one checklist for both kinds of request', () => {
  it('completes without siteAccess when there is nothing to remove', () => {
    const done = formatTurn({ type: 'message', message: 'done', options: [], checklistComplete: true, checklist: FULL_BRIEF })

    expect(done.checklist.siteAccess).toBeNull()
    expect(done.checklistComplete).toBe(true)
  })

  it('still asks about access when a removal has to be priced', () => {
    const asked = formatTurn({
      type: 'message',
      message: '',
      options: [],
      checklist: { ...FULL_BRIEF, removeOldFence: true, siteAccess: null },
    })

    expect(asked.message).toMatch(/access along the fence line/i)
    expect(asked.checklistComplete).toBe(false)
  })

  it('treats existingPrice as a field, not a flow — it never blocks the ranking', () => {
    const done = formatTurn({
      type: 'message',
      message: 'done',
      options: [],
      checklistComplete: true,
      checklist: { ...FULL_BRIEF, existingPrice: 4000 },
    })

    expect(done.checklistComplete).toBe(true)
    expect(done.intent).toBe('compare_quote')
    expect(formatTurn({ type: 'message', message: 'done', options: [], checklistComplete: true, checklist: FULL_BRIEF }).intent).toBe('new_quote')
  })

  it('remembers a price the customer mentioned turns ago', () => {
    const turn = formatTurn(
      { type: 'question', message: 'What height?', options: [], checklist: { ...HALF_BRIEF, existingPrice: null } },
      { knownChecklist: JSON.stringify({ existingPrice: 4000 }) },
    )

    expect(turn.checklist.existingPrice).toBe(4000)
  })

  it('offers only the heights businesses actually publish a rate for', () => {
    const asked = formatTurn({ type: 'message', message: '', options: [], checklist: { ...FULL_BRIEF, heightMm: null } })

    expect(asked.options.map((o) => o.value)).toEqual([1200, 1500, 1800, 2100])
  })

  it('asks for the length as a number rather than offering buckets to pick from', () => {
    const asked = formatTurn({ type: 'message', message: '', options: [], checklist: { ...FULL_BRIEF, lengthMeters: null } })

    expect(asked.options).toEqual([])
    expect(asked.message).toMatch(/how long is the fence, in metres/i)
  })

  it('hands the picked place through to the ranking step', () => {
    const turn = formatTurn(
      { type: 'message', message: 'done', options: [], checklistComplete: true, checklist: FULL_BRIEF },
      { place: JSON.stringify(PAKENHAM) },
    )

    expect(turn.place).toMatchObject({ latitude: PAKENHAM.latitude })
    // Junk in that field must not take the whole turn down
    expect(formatTurn({ type: 'message', message: 'x', options: [], checklist: FULL_BRIEF }, { place: 'not json' }).place).toBeNull()
  })
})

describe('unit conversion', () => {
  const height = (value) =>
    formatTurn({ type: 'question', message: 'x', options: [], checklist: { ...FULL_BRIEF, heightMm: value } }).checklist.heightMm

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
    [1200, 1200],
    [1800, 1800],
  ])('leaves %imm alone', (given, want) => expect(height(given)).toBe(want))
})

describe('checklist gate', () => {
  it('rewrites a premature confirmation into the question that was actually due', () => {
    const out = formatTurn({
      type: 'confirmation',
      message: 'All correct?',
      options: [{ label: 'Yes', value: 'yes' }],
      checklist: HALF_BRIEF,
    })

    expect(out.type).toBe('question')
    expect(out.message).toBe('What height are you after?')
  })

  it('never lets the ranking step run on a half-filled brief', () => {
    const half = formatTurn({ type: 'message', message: 'done', options: [], checklistComplete: true, checklist: HALF_BRIEF })

    expect(half.checklistComplete).toBe(false)
  })

  it('falls back to the due question when the agent returns a blank one', () => {
    expect(formatTurn({ type: 'message', message: '   ', options: [], checklist: HALF_BRIEF }).message).toBe(
      'What height are you after?',
    )
  })

  it('falls back to an apology when the brief is finished and there is nothing to ask', () => {
    expect(formatTurn({ type: 'message', message: '', options: [], checklist: FULL_BRIEF }).message).toMatch(
      /something went wrong/i,
    )
  })
})

describe('known-checklist merge', () => {
  const droppedSuburb = { type: 'question', message: 'Which suburb?', options: [], checklist: { ...FULL_BRIEF, suburb: null } }

  it('restores a value the agent dropped, so it is not asked for twice', () => {
    expect(formatTurn(droppedSuburb, { knownChecklist: JSON.stringify({ suburb: 'Pakenham' }) }).checklist.suburb).toBe(
      'Pakenham',
    )
  })

  it('invents nothing when the client knows nothing yet', () => {
    expect(formatTurn(droppedSuburb).checklist.suburb).toBeNull()
  })
})

describe('suburb picker signal', () => {
  const askingSuburb = { type: 'question', message: 'Which suburb is the fence going in?', options: [], checklist: { ...FULL_BRIEF, suburb: null } }

  it('tells the client to collect the suburb as a place, not as text', () => {
    expect(formatTurn(askingSuburb).expects).toBe('suburb')
  })

  it('leaves the opening greeting alone — nothing has been asked yet', () => {
    const greeting = formatTurn({
      type: 'message',
      message: 'Got it — can you answer a few quick questions?',
      options: [],
      checklist: { ...FULL_BRIEF, suburb: null },
    })

    expect('expects' in greeting).toBe(false)
  })

  it('stops asking for a place once the suburb is known', () => {
    expect('expects' in formatTurn(askingSuburb, { knownChecklist: JSON.stringify({ suburb: 'Pakenham' }) })).toBe(false)
  })

  it('leaves a turn that is asking something else alone', () => {
    const asked = formatTurn({
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      checklist: { ...FULL_BRIEF, suburb: null },
    })

    expect('expects' in asked).toBe(false)
  })
})
