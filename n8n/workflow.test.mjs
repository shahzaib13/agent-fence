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

  it('puts every price on one basis, so a cheaper number is never just a missing 10%', () => {
    const exclusive = rank([[business({ uid: 'ex' }), pricing({ gstInclusive: false })]]).comparison.quotes[0]
    const inclusive = rank([[business(), pricing()]]).comparison.quotes[0]

    // 100/m × 20m, then the 10% the business had not added
    expect(inclusive.projectTotalMin).toBe(2000)
    expect(exclusive.projectTotalMin).toBe(2200)
    // The label says what happened to the number, not just what the business publishes
    expect(exclusive.badges).toContain('incl. GST (added)')
    expect(inclusive.badges).toContain('incl. GST')
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
// A confirmed place by default: almost every test here is about some other field, and without
// one the gate rightly treats the suburb as still missing and asks for it instead.
// `turn` defaults to 2 — mid-conversation. Turn 0 is the opener, which is deliberately not a
// checklist question at all, and almost every case here is about some other field.
const formatTurn = (
  output,
  { knownChecklist = '', place = JSON.stringify(PAKENHAM), turn = 2, message = '', extracted, lockedIntent = '' } = {},
) =>
  runOne('Format New-Quote Result1', {
    nodes: {
      'Normalize Input1': { sessionId: 's', knownChecklist, place, turn, message, lockedIntent },
      ...(extracted ? { 'Normalize Extracted Text': extracted } : {}),
    },
    input: [{ json: { output } }],
  })

const FULL_BRIEF = { ...BRIEF, suburb: 'Pakenham', removeOldFence: false, siteAccess: null }
const HALF_BRIEF = { ...FULL_BRIEF, heightMm: null, removeOldFence: null }

/* --------------------------------------------------- consent, and who picks the question */
// The model used to choose which field to ask about, and it chose badly: fields it had already
// been told, a later field while an earlier one sat empty, and a checklist question fired at
// somebody who had not agreed to answer any. The gate decides now; the model only writes prose.
describe('the opener asks permission, not a checklist question', () => {
  it('asks to proceed on the first turn, with a way to say no', () => {
    const opener = formatTurn({
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      checklist: { ...HALF_BRIEF, suburb: null },
    }, { turn: 0, place: '' })

    expect(opener.message).toMatch(/happy to answer a few quick questions/i)
    expect(opener.options.map((o) => o.value)).toEqual(['yes', 'no'])
  })

  it('still records what their description already gave away', () => {
    const opener = formatTurn(
      { type: 'question', message: 'x', options: [], checklist: { ...HALF_BRIEF, fenceType: 'Colorbond' } },
      { turn: 0, place: '' },
    )

    expect(opener.checklist.fenceType).toBe('Colorbond')
    expect(opener.checklistComplete).toBe(false)
  })

  // They can tap the button or type the answer, and typing is not limited to the two words on
  // the buttons — matching those exactly meant "nope" fell through and answered nothing.
  it.each(['no', 'Not right now', 'nope', 'not now', 'later'])('takes %s for an answer instead of asking anyway', (said) => {
    const declined = formatTurn(
      { type: 'question', message: 'What height?', options: [], checklist: HALF_BRIEF },
      { turn: 1, message: said },
    )

    expect(declined.message).toMatch(/whenever you're ready/i)
    expect(declined.options).toEqual([])
  })

  it.each(['yes', 'Yes, go ahead', 'yes ask me', 'sure'])('gets straight on with it when they say %s', (said) => {
    const accepted = formatTurn(
      { type: 'question', message: 'Anything else?', options: [], checklist: { ...FULL_BRIEF, heightMm: null } },
      { turn: 1, message: said },
    )

    expect(accepted.message).toMatch(/height/i)
    expect(accepted.options.map((o) => o.value)).toEqual([1300, 1500, 1800, 2100])
  })

  it('never lets the picker land on the opener', () => {
    // The opener has no suburb either, so before the gate owned the wording this was
    // indistinguishable from a suburb turn and put a Google picker on the greeting.
    expect(formatTurn({ type: 'question', message: 'x', options: [], checklist: null }, { turn: 0, place: '' }).expects)
      .toBeUndefined()
  })
})

/* ------------------------------------------- the request → code-node field contract */
// `turn` was read by the gate but never mapped out of `body` by Normalize Input1, so it was
// always undefined — and undefined read as 0, which pinned the conversation on the consent
// question and made it unanswerable. Nothing caught it, because the tests stub Normalize
// Input1 by hand and so were happy to supply a field the real node never produced.
describe('every field the code nodes read is actually mapped out of the request', () => {
  const mapped = new Set(
    wf.nodes.find((n) => n.name === 'Normalize Input1').parameters.assignments.assignments.map((a) => a.name),
  )
  const READS = /(?:\bsource|\$\('Normalize Input1'\)\.first\(\)\.json)\.([A-Za-z_$][\w$]*)/g

  it.each(['Format New-Quote Result1', 'Fallback Response'])('%s asks for nothing that is not provided', (name) => {
    const read = [...wf.nodes.find((n) => n.name === name).parameters.jsCode.matchAll(READS)].map((m) => m[1])

    expect([...new Set(read)].filter((field) => !mapped.has(field))).toEqual([])
  })

  it('maps turn, and keeps it distinguishable from a missing one', () => {
    const turn = wf.nodes
      .find((n) => n.name === 'Normalize Input1')
      .parameters.assignments.assignments.find((a) => a.name === 'turn')

    expect(turn).toBeDefined()
    // Falling back to 0 would make "we were not told" indistinguishable from "this is the
    // opening turn" — which is exactly how the consent question became an infinite loop.
    expect(turn.value).not.toMatch(/\|\|\s*0/)
  })
})

describe('an unknown turn fails open rather than locking the chat', () => {
  it('does not gate when the client never sent a turn', () => {
    const asked = formatTurn(
      { type: 'question', message: 'x', options: [], checklist: { ...FULL_BRIEF, heightMm: null } },
      { turn: '' },
    )

    expect(asked.message).toMatch(/height/i)
    expect(asked.message).not.toMatch(/happy to answer/i)
  })

  it('still gates on a turn that really is 0', () => {
    expect(formatTurn({ type: 'question', message: 'x', options: [], checklist: null }, { turn: 0, place: '' }).message)
      .toMatch(/happy to answer/i)
  })
})

/* -------------------------------------- an unconfirmed suburb must not block the brief */
// The regression this exists for: once the gate started choosing the question, `nextField` was
// `missing[0]` and `suburb` is first in FIELDS — so while no place had come back, the suburb
// question was the answer to "what next?" on every single turn. The customer was asked the same
// thing over and over and could never reach any other field.
describe('an unconfirmed suburb does not stall the conversation', () => {
  const noPlace = { place: '' }
  const EMPTY = { suburb: null, fenceType: null, lengthMeters: null, heightMm: null, removeOldFence: null, siteAccess: null }

  it('still opens on the suburb — it is the natural first question', () => {
    const first = formatTurn({ type: 'question', message: '', options: [], checklist: EMPTY }, { ...noPlace, turn: 1 })

    expect(first.message).toMatch(/which suburb/i)
    expect(first.expects).toBe('suburb')
  })

  it('moves on to the rest of the brief once it has been asked', () => {
    const next = formatTurn(
      { type: 'question', message: '', options: [], checklist: { ...FULL_BRIEF, suburb: null, heightMm: null } },
      { ...noPlace, turn: 2 },
    )

    expect(next.message).toMatch(/height/i)
    expect(next.message).not.toMatch(/suburb/i)
  })

  it('comes back to it at the end, and says what the list is for', () => {
    const last = formatTurn(
      { type: 'question', message: '', options: [], checklist: { ...FULL_BRIEF, suburb: null } },
      { ...noPlace, turn: 5 },
    )

    expect(last.expects).toBe('suburb')
    expect(last.message).toMatch(/pick it from the list/i)
  })

  it('still refuses to rank on a suburb nobody confirmed', () => {
    const done = formatTurn(
      { type: 'message', message: 'done', options: [], checklistComplete: true, checklist: FULL_BRIEF },
      { ...noPlace, turn: 6 },
    )

    expect(done.checklistComplete).toBe(false)
  })

  it('gets through the whole brief without asking the same thing twice', () => {
    const order = ['fenceType', 'lengthMeters', 'heightMm', 'removeOldFence']
    const values = { fenceType: 'Timber', lengthMeters: 25, heightMm: 1800, removeOldFence: false }
    const checklist = { ...EMPTY }
    const asked = []

    for (let i = 0; i < order.length; i += 1) {
      asked.push(
        formatTurn({ type: 'question', message: '', options: [], checklist: { ...checklist } }, { ...noPlace, turn: i + 2 })
          .message,
      )
      checklist[order[i]] = values[order[i]]
    }

    expect(new Set(asked).size).toBe(asked.length)
    expect(asked.some((m) => /suburb/i.test(m))).toBe(false)
  })
})

/* ------------------------------------------------------ new quote, or beat the one they have */
// The ask is what decides this — "can you do better than my quote" — not whether a number has
// turned up yet. Deriving it from existingPrice alone was wrong both ways: somebody can want a
// quote beaten before they say the figure, and a figure can appear in a document without them
// asking for anything to be beaten.
/* ------------------------------------------------------- a zero is not a quote to beat */
// The regression: the model was shown `existingPrice` in a prompt example and started writing 0
// on plain new-quote conversations. Every `!== null` check read that as a real quote, so the
// ranking filtered for businesses cheaper than $0 — nothing is — and a customer who had never
// mentioned a price was told nobody could beat it and shown no results at all.
describe('a price of zero is not a quote to beat', () => {
  it('drops it from the brief instead of treating it as a $0 quote', () => {
    const turn = formatTurn({
      type: 'question',
      message: 'x',
      options: [],
      checklist: { ...FULL_BRIEF, existingPrice: 0 },
    })

    expect(turn.checklist.existingPrice).toBeNull()
    expect(turn.intent).toBe('new_quote')
  })

  it('still shows the businesses that cover the job', () => {
    const ranked = rank([[business(), pricing()]], { ...BRIEF, existingPrice: 0 })

    expect(ranked.results.length).toBeGreaterThan(0)
    expect(ranked.message).not.toMatch(/came in under/i)
    expect(ranked.comparison.userExistingPrice).toBeNull()
  })

  it('still beats a real quote when there is one', () => {
    const ranked = rank([[business(), pricing()]], { ...BRIEF, existingPrice: 5000 })

    expect(ranked.comparison.userExistingPrice).toBe(5000)
    expect(ranked.comparison.potentialSavings).toBeGreaterThan(0)
  })
})

/* ------------------------------------------ nothing is priced until they have said yes */
// This was the last decision still left to the model, so a turn where it forgot to recap went
// straight to the ranking and the customer never got the chance to correct anything — and that
// was as true of "beat my quote" as of a fresh one.
describe('the brief is read back and confirmed before anything is priced', () => {
  const finished = (extra = {}) => ({
    type: 'message',
    message: 'Off we go then.',
    options: [],
    checklistComplete: true,
    checklist: { ...FULL_BRIEF, ...extra },
  })

  it('recaps and asks, even when the model tried to skip straight to the result', () => {
    const turn = formatTurn(finished())

    expect(turn.type).toBe('confirmation')
    expect(turn.message).toMatch(/all correct/i)
    expect(turn.options.map((o) => o.value)).toEqual(['yes', 'no'])
    expect(turn.checklistComplete).toBe(false)
  })

  it('does the same on a compare, and puts their own quote in the recap', () => {
    const turn = formatTurn(finished({ existingPrice: 4000 }))

    expect(turn.type).toBe('confirmation')
    expect(turn.message).toMatch(/beating \$4,000/i)
    expect(turn.checklistComplete).toBe(false)
  })

  it('reads back everything that is in the brief, and nothing that is not', () => {
    const turn = formatTurn(finished({ removeOldFence: true, siteAccess: 'difficult' }))

    expect(turn.message).toContain('Pakenham, VIC 3810')
    expect(turn.message).toContain('Timber')
    expect(turn.message).toContain('20m')
    expect(turn.message).toContain('removing the old fence')
    expect(turn.message).toContain('difficult access')
    expect(turn.message).not.toMatch(/beating/i)
  })

  it('only prices it once they actually say yes', () => {
    expect(formatTurn(finished(), { message: 'yes' }).checklistComplete).toBe(true)
    expect(formatTurn(finished(), { message: "yep that's right" }).checklistComplete).toBe(true)
    expect(formatTurn(finished(), { message: 'no' }).checklistComplete).toBe(false)
  })

  it('lets the model ask what to fix instead of recapping again', () => {
    const wrong = formatTurn(
      { type: 'message', message: 'No worries — what should I fix?', options: [], checklist: FULL_BRIEF },
      { message: 'no' },
    )

    expect(wrong.type).toBe('message')
    expect(wrong.message).toMatch(/what should I fix/i)
    expect(wrong.options).toEqual([])
  })
})

/* ------------------------------------------------- several attachments stay several quotes */
describe('more than one attached document', () => {
  const extract = (combined) =>
    runOne('Normalize Extracted Text', {
      nodes: { 'Normalize Input1': { message: 'here are my quotes', sessionId: 's' } },
      input: [{ json: { combinedExtractedText: combined } }],
    })

  it('keeps them apart so figures cannot be blended across quotes', () => {
    // A length off the first and a total off the third describes a job nobody quoted.
    const out = extract(['Quote A: 25m timber', 'Quote B: 40m colorbond', 'Quote C: Total $9,000'])

    expect(out.extractedText).toContain('--- Document 1 of 3 ---')
    expect(out.extractedText).toContain('--- Document 3 of 3 ---')
    expect(out.extractionFailed).toBe(false)
  })

  it('leaves a single document alone', () => {
    expect(extract(['Total $3,309.90']).extractedText).toBe('Total $3,309.90')
  })

  it('still reports a set of attachments that produced nothing', () => {
    expect(extract(['', '']).extractionFailed).toBe(true)
  })
})

describe('which kind of request this is', () => {
  const turnWith = (extra, opts) =>
    formatTurn({ type: 'question', message: 'x', options: [], checklist: FULL_BRIEF, ...extra }, opts)

  it('takes the model\'s reading of the ask, before any price exists', () => {
    expect(turnWith({ intent: 'compare_quote' }).intent).toBe('compare_quote')
  })

  it('defaults to a new quote when nothing says otherwise', () => {
    expect(turnWith({}).intent).toBe('new_quote')
  })

  it('will not let the model change its mind halfway through', () => {
    // Re-classifying every turn is what used to hand the brief to a different checklist.
    expect(turnWith({ intent: 'new_quote' }, { lockedIntent: 'compare_quote' }).intent).toBe('compare_quote')
    expect(turnWith({ intent: 'compare_quote' }, { lockedIntent: 'new_quote' }).intent).toBe('new_quote')
  })

  it('upgrades to a comparison when a quote to beat finally turns up', () => {
    // The one move that is allowed, because it is new information rather than a reclassification
    // — and it only goes one way, so it cannot oscillate.
    const upgraded = turnWith(
      { checklist: { ...FULL_BRIEF, existingPrice: 4000 } },
      { lockedIntent: 'new_quote' },
    )

    expect(upgraded.intent).toBe('compare_quote')
  })

  it('reads a price out of an attached document and upgrades on that alone', () => {
    const fromDocument = turnWith({ checklist: { ...FULL_BRIEF, existingPrice: '$3,309.90' } })

    expect(fromDocument.checklist.existingPrice).toBe(3309.9)
    expect(fromDocument.intent).toBe('compare_quote')
  })
})

describe('the gate picks the question, not the model', () => {
  it('replaces a question about a field that is already answered', () => {
    const turn = formatTurn({
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      // fenceType is known; height is not. The model asked the wrong one.
      checklist: { ...FULL_BRIEF, heightMm: null },
    })

    expect(turn.message).toMatch(/height/i)
    expect(turn.options.map((o) => o.value)).toEqual([1300, 1500, 1800, 2100])
  })

  it('asks the earliest missing field, not the one the model fancied', () => {
    // The customer answered height first. Fence type is still empty and comes earlier, so that
    // is what is due — whatever the model decided to write.
    const turn = formatTurn({
      type: 'question',
      message: 'And the height again?',
      options: [],
      checklist: { ...FULL_BRIEF, fenceType: null, heightMm: null },
    })

    expect(turn.message).toMatch(/type of fence/i)
    expect(turn.message).not.toMatch(/height/i)
  })

  it('keeps the acknowledgement the model wrote', () => {
    const turn = formatTurn({
      type: 'question',
      message: 'Nice, 25 metres. What height are you after?',
      options: [],
      checklist: { ...FULL_BRIEF, heightMm: null },
    })

    expect(turn.message).toBe('Nice, 25 metres. What height are you after?')
  })

  it('drops an acknowledgement that is itself a question, so two never stack up', () => {
    const turn = formatTurn({
      type: 'question',
      message: 'What type of fence? Or tell me the height?',
      options: [],
      checklist: { ...FULL_BRIEF, heightMm: null },
    })

    expect(turn.message).toBe('What height are you after?')
  })

  it('leaves a finished brief alone so it can reach the confirmation', () => {
    const done = formatTurn({
      type: 'confirmation',
      message: 'Pakenham, Colorbond, 25m, no removal. All correct?',
      options: [{ label: "Yes, that's all correct", value: 'yes' }],
      checklist: FULL_BRIEF,
    })

    expect(done.type).toBe('confirmation')
    expect(done.message).toMatch(/all correct/i)
  })
})

describe('a file that could not be read', () => {
  it('says so rather than ignoring the attachment in silence', () => {
    const turn = formatTurn(
      { type: 'question', message: 'What height?', options: [], checklist: { ...FULL_BRIEF, heightMm: null } },
      { extracted: { extractionFailed: true, extractedText: '' } },
    )

    expect(turn.message).toMatch(/couldn't read that file/i)
    // and still asks the question that was due
    expect(turn.message).toMatch(/height/i)
  })

  it('stays quiet when the file read fine', () => {
    const turn = formatTurn(
      { type: 'question', message: 'What height?', options: [], checklist: { ...FULL_BRIEF, heightMm: null } },
      { extracted: { extractionFailed: false, extractedText: 'Total $3,309.90' } },
    )

    expect(turn.message).not.toMatch(/couldn't read/i)
  })
})

describe('one checklist for both kinds of request', () => {
  it('completes without siteAccess when there is nothing to remove', () => {
    const done = formatTurn(
      { type: 'message', message: 'done', options: [], checklistComplete: true, checklist: FULL_BRIEF },
      { message: 'yes' },
    )

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
    const done = formatTurn(
      { type: 'message', message: 'done', options: [], checklistComplete: true, checklist: { ...FULL_BRIEF, existingPrice: 4000 } },
      { message: 'yes' },
    )

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

    expect(asked.options.map((o) => o.value)).toEqual([1300, 1500, 1800, 2100])
  })

  it('asks for the length as a number rather than offering buckets to pick from', () => {
    const asked = formatTurn({ type: 'message', message: '', options: [], checklist: { ...FULL_BRIEF, lengthMeters: null } })

    expect(asked.options.map((o) => o.value)).toEqual([10, 20, 30, 40, '__other__'])
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

  it('recaps a finished brief rather than apologising, even on a blank turn', () => {
    // A complete brief has nothing left to ask, so the empty-message fallback used to reach for
    // an apology. There is something to say: read it back and get it confirmed.
    const recap = formatTurn({ type: 'message', message: '', options: [], checklist: FULL_BRIEF })

    expect(recap.type).toBe('confirmation')
    expect(recap.message).toMatch(/all correct/i)
  })
})

describe('known-checklist merge', () => {
  const droppedSuburb = { type: 'question', message: 'Which suburb?', options: [], checklist: { ...FULL_BRIEF, suburb: null } }

  it('restores a value the agent dropped, so it is not asked for twice', () => {
    const restored = formatTurn(
      { type: 'question', message: 'What height?', options: [], checklist: { ...FULL_BRIEF, fenceType: null } },
      { knownChecklist: JSON.stringify({ fenceType: 'Timber' }) },
    )

    expect(restored.checklist.fenceType).toBe('Timber')
  })

  it('invents nothing when the client knows nothing yet', () => {
    expect(formatTurn(droppedSuburb, { place: '' }).checklist.suburb).toBeNull()
  })

  it('takes the suburb from the confirmed place rather than waiting for the model to write it', () => {
    // The model is told never to write this field, so nothing was writing it: the place could
    // only reach the checklist through the checklist. The picker answer is authoritative — use it.
    expect(formatTurn(droppedSuburb).checklist.suburb).toBe('Pakenham, VIC 3810')
  })
})

describe('suburb picker signal', () => {
  const askingSuburb = { type: 'question', message: 'Which suburb is the fence going in?', options: [], checklist: { ...FULL_BRIEF, suburb: null } }

  it('tells the client to collect the suburb as a place, not as text', () => {
    expect(formatTurn(askingSuburb, { place: '', turn: 1 }).expects).toBe('suburb')
  })

  it('stops asking the moment a real place arrives', () => {
    expect('expects' in formatTurn(askingSuburb)).toBe(false)
  })

  it('leaves the opening greeting alone — nothing has been asked yet', () => {
    // The greeting used to be told apart by its wording, which meant the client and the workflow
    // had to keep two regexes in agreement, and a greeting that happened to say "suburb" put a
    // Google picker on the hello. It is told apart by its Yes/No options now.
    const greeting = formatTurn(
      { type: 'message', message: 'Got it — can you answer a few quick questions?', options: [], checklist: null },
      { turn: 0, place: '' },
    )

    expect(greeting.options.map((o) => o.value)).toEqual(['yes', 'no'])
    expect('expects' in greeting).toBe(false)
  })

  it('stops asking for a place once the suburb is known', () => {
    expect('expects' in formatTurn(askingSuburb, { knownChecklist: JSON.stringify({ suburb: 'Pakenham' }) })).toBe(false)
  })

  it('asks for the suburb anyway when the model wanted to ask something else', () => {
    // Previously the model could wander off to another field while the suburb sat unconfirmed,
    // and the picker never appeared — so the one field that cannot be typed never got collected.
    const asked = formatTurn(
      {
        type: 'question',
        message: 'What type of fence are you after?',
        options: [{ label: 'Timber', value: 'Timber' }],
        checklist: { ...FULL_BRIEF, suburb: null },
      },
      { place: '', turn: 1 },
    )

    expect(asked.expects).toBe('suburb')
    expect(asked.message).toMatch(/which suburb/i)
    // No options, because this is the one field answered by the picker rather than by tapping.
    expect(asked.options).toEqual([])
  })

  it('keeps the picker off a turn that is genuinely asking something else', () => {
    const asked = formatTurn({
      type: 'question',
      message: 'What height?',
      options: [],
      checklist: { ...FULL_BRIEF, heightMm: null },
    })

    expect('expects' in asked).toBe(false)
  })
})

describe('a suburb is only real once Google has confirmed it', () => {
  const withSuburb = { ...FULL_BRIEF, suburb: 'Pakenham' }

  it('treats a suburb with no place behind it as still missing', () => {
    // How the compare flow used to slip through: the agent read the suburb off an attached
    // quote document, never asked about it, and the brief looked complete
    const turn = formatTurn(
      { type: 'message', message: 'Got it, all set.', options: [], checklistComplete: true, checklist: withSuburb },
      { place: '' },
    )

    expect(turn.checklistComplete).toBe(false)
    expect(turn.expects).toBe('suburb')
    expect(turn.message).toMatch(/which suburb/i)
  })

  it('accepts it the moment a picked place arrives with it', () => {
    const turn = formatTurn(
      { type: 'message', message: 'Got it, all set.', options: [], checklistComplete: true, checklist: withSuburb },
      { place: JSON.stringify(PAKENHAM), message: 'yes' },
    )

    expect(turn.checklistComplete).toBe(true)
    expect('expects' in turn).toBe(false)
  })

  it('never lets the ranking run on a name alone', () => {
    const asked = formatTurn(
      { type: 'question', message: 'What height?', options: [], checklist: withSuburb },
      { place: '' },
    )

    // The question that is actually due is the suburb, whatever the agent wanted to ask
    expect(asked.message).toMatch(/which suburb/i)
  })
})

describe('values mined from a quote document', () => {
  // Straight off the customer's real PDF: "Install 25m of 1.8H standard timber fence paling
  // fence", "Disposal of 25m of old fence", "Total $3,309.90".
  const fromDocument = (overrides) =>
    formatTurn({
      type: 'message',
      message: 'Got it, that all came through.',
      options: [],
      checklist: { ...FULL_BRIEF, ...overrides },
    }).checklist

  it('reads a price the way a document writes it', () => {
    expect(fromDocument({ existingPrice: '$3,309.90' }).existingPrice).toBe(3309.9)
    expect(fromDocument({ existingPrice: '3309.90' }).existingPrice).toBe(3309.9)
    expect(fromDocument({ existingPrice: 3309.9 }).existingPrice).toBe(3309.9)
  })

  it('reads a length and a height with their units still attached', () => {
    expect(fromDocument({ lengthMeters: '25m' }).lengthMeters).toBe(25)
    expect(fromDocument({ heightMm: '1800mm' }).heightMm).toBe(1800)
    // "1.8H" on the page is 1.8 metres, and the existing unit guard turns that into millimetres
    expect(fromDocument({ heightMm: '1.8H' }).heightMm).toBe(1800)
  })

  it('drops a value that holds no number rather than pricing off it', () => {
    // Left as-is it reads as answered and quotes nobody, with nothing to explain why
    expect(fromDocument({ existingPrice: 'see attached' }).existingPrice).toBeNull()
    expect(fromDocument({ lengthMeters: 'TBC' }).lengthMeters).toBeNull()
  })

  it('snaps a fence described in trade words onto an option businesses actually publish', () => {
    const typed = (value) => fromDocument({ fenceType: value }).fenceType

    expect(typed('standard timber fence paling')).toBe('Timber')
    expect(typed('treated pine palings')).toBe('Timber')
    expect(typed('Colourbond infill')).toBe('Colorbond')
    expect(typed('glass pool fence')).toBe('Pool Fencing')
    expect(typed('chain wire')).toBe('Security/Chainmesh')
    expect(typed('aluminium slat')).toBe('Aluminium')
    expect(typed('post and wire')).toBe('Rural')
  })

  it('leaves an exact answer exactly as it is', () => {
    expect(fromDocument({ fenceType: 'Colorbond' }).fenceType).toBe('Colorbond')
    expect(fromDocument({ fenceType: 'timber' }).fenceType).toBe('Timber')
  })

  it('leaves words it cannot place alone rather than guessing a fence type', () => {
    // Ranking will find nobody and say so — better than quoting the wrong kind of fence
    expect(fromDocument({ fenceType: 'bamboo screening' }).fenceType).toBe('bamboo screening')
  })

  it('does not touch the suburb — that still only comes from the map', () => {
    const turn = formatTurn(
      { type: 'message', message: 'x', options: [], checklist: { ...FULL_BRIEF, suburb: '12 Smith St, Pakenham VIC' } },
      { place: '' },
    )

    expect(turn.expects).toBe('suburb')
    expect(turn.checklistComplete).toBe(false)
  })
})

describe('beating a quote the customer already has', () => {
  const cheap = [business({ uid: 'cheap', businessName: 'Cheap Fences' }), pricing({ rates: { timber: { 1.8: 80 } } })]
  const mid = [business({ uid: 'mid', businessName: 'Mid Fences' }), pricing({ rates: { timber: { 1.8: 110 } } })]
  const dear = [business({ uid: 'dear', businessName: 'Dear Fences' }), pricing({ rates: { timber: { 1.8: 150 } } })]
  // 20m at those rates: 1600, 2200, 3000
  const beating = (existingPrice) => rank([cheap, mid, dear], { ...BRIEF, existingPrice })

  it('shows only what actually beats their price', () => {
    const { comparison } = beating(2500)

    expect(comparison.quotes.map((quote) => quote.projectTotalMin)).toEqual([1600, 2200])
  })

  it('shows one when only one beats it, rather than padding the row', () => {
    expect(beating(2000).comparison.quotes.map((q) => q.businessName)).toEqual(['Cheap Fences'])
  })

  it('never shows a quote at or above their price — that is the whole feature backwards', () => {
    for (const price of [1700, 2500, 3500]) {
      const shown = beating(price).comparison.quotes.map((quote) => quote.projectTotalMin)
      expect(shown.every((total) => total < price)).toBe(true)
    }
  })

  it('says nothing beat it, and what the closest was', () => {
    const result = beating(1500)

    expect(result.comparison).toBeNull()
    expect(result.results).toEqual([])
    expect(result.noMatchReason).toBe('notCheaper')
    expect(result.message).toMatch(/under \$1,500/)
    expect(result.message).toMatch(/closest was \$1,600/)
  })

  it('measures the market over everyone who could quote, not just the ones that beat it', () => {
    // (1600 + 2200 + 3000) / 3 — averaging only the survivors would flatter the result
    expect(beating(2500).comparison.marketAverage).toBe(2267)
    expect(beating(2500).comparison.totalQuotesScreened).toBe(3)
  })

  it('leaves a fresh quote alone — nothing to beat, so nothing is hidden', () => {
    const { comparison } = rank([cheap, mid, dear])

    expect(comparison.quotes).toHaveLength(3)
    expect(comparison.userExistingPrice).toBeNull()
  })
})

/* ------------------------------------------------- the document is read in code, not guessed */
// The complaint this exists for: the same PDF gave five fields on one run and two on the next,
// and the customer was asked for a height they had already attached. Nothing here goes near the
// model, so the same document produces the same fields every time.
describe('what a quote document says outright', () => {
  const read = (text) =>
    runOne('Normalize Extracted Text', {
      nodes: { 'Normalize Input1': { message: 'here is my quote', sessionId: 's' } },
      input: [{ json: { combinedExtractedText: [text] } }],
    }).docFacts

  // Verbatim off the customer's real PDF, headings and bank details and all.
  const REAL_QUOTE = `EMAIL ip0uo@gmail.com
Qty Job Description Unit Price Total
1 Install 25m of 1.8H standard timber fence paling fence with
concrete to be used as the base for the Hardwood post and
treated pine plinth, rails and palings to be used
$2,000.00
1 Disposal of 25m of old fence $1,009.00
Subtotal $3,009.00
GST (10%) $300.90
Total $3,309.90
Bank Account Details:
Account Name: A plus quality construction Pty Ltd
BSB:083004
Account Number: 449424225`

  it('reads the whole brief off the real quote, every field at once', () => {
    expect(read(REAL_QUOTE)).toEqual({
      fenceType: 'Timber',
      heightMm: 1800,
      lengthMeters: 25,
      removeOldFence: true,
      existingPrice: 3309.9,
    })
  })

  it('takes the GST-inclusive total, not the subtotal and not a line item', () => {
    expect(read(REAL_QUOTE).existingPrice).toBe(3309.9)
    // The "Total" column heading sits directly above a quantity of 1 — reading that as the
    // quote is worse than reading nothing, because it prices the job at a dollar.
    expect(read('Qty Description Unit Price Total\n1 Install fence $2,000.00').existingPrice).toBeUndefined()
  })

  it("reads the trade's own shorthand for a run and a height", () => {
    // 20 metres long, 1800mm high, written the way a fencer writes it
    expect(read('Supply 20L of 1.8H colorbond')).toMatchObject({ lengthMeters: 20, heightMm: 1800 })
    expect(read('25 lineal metres of 1800H colorbond')).toMatchObject({ lengthMeters: 25, heightMm: 1800 })
    expect(read('30 LM colorbond fence, 1.5m high')).toMatchObject({ lengthMeters: 30, heightMm: 1500 })
    expect(read('40m of 6ft colorbond fencing')).toMatchObject({ lengthMeters: 40, heightMm: 1829 })
    // The unit spelled out in full, and a run that never says the word "fence" next to it
    expect(read('35m timber paling, 1.8 metres high')).toMatchObject({ lengthMeters: 35, heightMm: 1800 })
    expect(read('rural post and wire 200m')).toMatchObject({ lengthMeters: 200 })
    expect(read('glass pool fence, 12m run, 1.2H')).toMatchObject({ lengthMeters: 12, heightMm: 1200 })
  })

  it('does not read the height as the length just because both are in metres', () => {
    expect(read('Install 1.8m high colorbond fence').lengthMeters).toBeUndefined()
    // Nor a footing depth or a post spacing, which sit on the page in the same units
    expect(read('Colorbond 1.8m high, posts concreted 600mm deep at 2.4m centres').lengthMeters).toBeUndefined()
  })

  it('counts any way of saying the old one goes as a removal', () => {
    for (const line of [
      'Disposal of 25m of old fence',
      'Remove and cart away existing timber fence',
      'Demolition of existing fence',
      'Old fence to be taken away',
      'Pull down the current fence first',
    ]) {
      expect(read(line).removeOldFence).toBe(true)
    }
  })

  it('does not book a demolition off a line that says there is none', () => {
    expect(read('No disposal of old fence required').removeOldFence).toBeUndefined()
    expect(read('Excludes removal of the existing fence').removeOldFence).toBeUndefined()
  })

  it('stays quiet about an old fence the document never mentions', () => {
    // Silence is not a "no" — leaving it unset is what makes the agent ask
    expect(read('Install 25m of 1.8H timber fence').removeOldFence).toBeUndefined()
  })

  // Twenty documents written every way a fencer writes one. The value here is not any single
  // line, it is that the answer to each is the same on every run — which was the complaint.
  it('reads a run however the page words it', () => {
    expect(read('Supply and install 1800 high x 25000 long Colorbond fence').lengthMeters).toBe(25)
    expect(read('Approx 80 lineal feet of 6ft treated pine paling').lengthMeters).toBe(24)
    expect(read('need bout 30 odd meters of colorbond').lengthMeters).toBe(30)
    expect(read('Timber paling 1.8H @ $120 per lineal metre x 25 LM = $3,000.00').lengthMeters).toBe(25)
  })

  it('reads a height in feet, inches included', () => {
    expect(read(`Install 30m of 5'6" colorbond fence`).heightMm).toBe(1676)
    expect(read('6 foot high colorbond').heightMm).toBe(1829)
    // 80 feet is the run, not the height — no fence is eighty feet tall
    expect(read('80 lineal feet of colorbond fencing').heightMm).toBeUndefined()
  })

  it('refuses a span, because the rate is charged per metre', () => {
    // Picking either end quotes a job nobody described; leaving it makes the agent ask
    expect(read('Somewhere between 20 and 30 metres of 1.8H colorbond').lengthMeters).toBeUndefined()
    expect(read('20-30m of 1.8H colorbond').lengthMeters).toBeUndefined()
    expect(read('20 to 30 lineal metres of colorbond').lengthMeters).toBeUndefined()
  })

  it('takes the fence height, not the gate beside it or the footing under it', () => {
    const twoHeights = read(`18m of 1.2H glass pool fencing
1 x 1.8H aluminium gate with self closing hinge`)

    expect(twoHeights.heightMm).toBe(1200)
    expect(read('45m colorbond, height 1800mm, posts 600mm deep at 2.4m centres')).toMatchObject({
      heightMm: 1800,
      lengthMeters: 45,
    })
  })

  it('takes the quote, not the deposit and not a line item', () => {
    const withDeposit = read(`40m of 1.8H Colorbond
Total inc GST $6,600.00
50% deposit due $3,300.00`)

    expect(withDeposit.existingPrice).toBe(6600)
  })

  it('leaves a page that only lists rates alone — nobody quoted a job on it', () => {
    const card = read(`Colorbond 1.5m — $95/m
Colorbond 1.8m — $115/m
Timber paling 1.8m — $130/m`)

    expect(card.lengthMeters).toBeUndefined()
    expect(card.existingPrice).toBeUndefined()
  })

  it('never reads a suburb off the page — that still only comes from the map', () => {
    expect(read('Install 25m fence at 12 Smith St, Pakenham VIC 3810').suburb).toBeUndefined()
  })

  it('will not blend figures across several attached quotes', () => {
    const facts = runOne('Normalize Extracted Text', {
      nodes: { 'Normalize Input1': { message: 'two quotes', sessionId: 's' } },
      input: [{ json: { combinedExtractedText: ['25m of 1.8H timber', 'Total $9,000.00'] } }],
    }).docFacts

    expect(facts).toEqual({})
  })

  it('hands them to the agent under the heading it already trusts', () => {
    const { docFactsBlock } = runOne('Normalize Extracted Text', {
      nodes: { 'Normalize Input1': { message: 'x', sessionId: 's' } },
      input: [{ json: { combinedExtractedText: [REAL_QUOTE] } }],
    })

    expect(docFactsBlock).toContain('do NOT ask about these again')
    expect(docFactsBlock).toContain('"existingPrice":3309.9')
  })

  it('says nothing at all when there was no attachment', () => {
    const out = runOne('Normalize Extracted Text', {
      nodes: { 'Normalize Input1': { message: 'no file here', sessionId: 's' } },
      input: [{ json: {} }],
    })

    expect(out.docFacts).toEqual({})
    expect(out.docFactsBlock).toBe('')
    expect(out.extractionFailed).toBe(false)
  })
})

describe('a field the document answered is never asked about', () => {
  const DOC = { docFacts: { fenceType: 'Timber', heightMm: 1800, lengthMeters: 25, removeOldFence: true, existingPrice: 3309.9 } }

  it('fills in what the model dropped, so the same PDF always gives the same brief', () => {
    // The model returning an empty checklist is the bad run the customer kept hitting
    const turn = formatTurn(
      { type: 'question', message: 'What height are you after?', options: [], checklist: {} },
      { extracted: DOC },
    )

    expect(turn.checklist).toMatchObject({ fenceType: 'Timber', heightMm: 1800, lengthMeters: 25, removeOldFence: true })
    expect(turn.checklist.existingPrice).toBe(3309.9)
    // Everything the document answered is filled, so the only thing left to ask is the suburb
    expect(turn.intent).toBe('compare_quote')
  })

  it('never overrules what the customer actually said', () => {
    const turn = formatTurn(
      { type: 'question', message: 'x', options: [], checklist: { ...FULL_BRIEF, lengthMeters: 40 } },
      { extracted: DOC },
    )

    expect(turn.checklist.lengthMeters).toBe(40)
  })
})
