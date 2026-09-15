import { render as renderBare, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FencingChatError,
  sendFencingChatMessage,
  type FencingChatResponse,
} from '../services/fencingChat'
import { fetchSuburbPlace, searchSuburbs, type SuburbPlace } from '../services/places'
import { Home } from './Home'

vi.mock('../services/fencingChat', async (importOriginal) => ({
  // Only the network calls are faked — the module's constants are part of the contract the chat
  // renders against, and stubbing them by hand is how they drift.
  ...(await importOriginal<typeof import('../services/fencingChat')>()),
  sendFencingChatMessage: vi.fn(),
}))

vi.mock('../services/places', async (importOriginal) => ({
  // Only what talks to Google is faked. The pure helpers are real, because stubbing them by
  // hand is how a test ends up passing against behaviour the app doesn't have.
  ...(await importOriginal<typeof import('../services/places')>()),
  isPlacesConfigured: () => true,
  newSessionToken: () => 'token-1',
  searchSuburbs: vi.fn(),
  fetchSuburbPlace: vi.fn(),
}))

vi.mock('../services/quoteResults', () => ({
  isQuoteResultReady: (doc: { displayState?: string }) => doc.displayState === 'ready',
  listenQuoteResult: vi.fn(async () => () => {}),
}))

vi.mock('../hooks/useVoiceCall', () => ({
  useVoiceCall: () => ({
    status: 'idle',
    start: vi.fn(),
    stop: vi.fn(),
    isActive: false,
  }),
}))

const mockedSend = vi.mocked(sendFencingChatMessage)
const mockedSearch = vi.mocked(searchSuburbs)
const mockedFetchPlace = vi.mocked(fetchSuburbPlace)

const suburbSuggestions = [
  { placeId: 'place-1', primaryText: 'Pakenham', secondaryText: 'VIC, Australia' },
  { placeId: 'place-2', primaryText: 'Pakenham Upper', secondaryText: 'VIC, Australia' },
]

const pakenham: SuburbPlace = {
  suburb: 'Pakenham',
  state: 'VIC',
  stateFullName: 'Victoria',
  postcode: '3810',
  country: 'AU',
  countryName: 'Australia',
  displayLabel: 'Pakenham, VIC 3810',
  formattedAddress: 'Pakenham VIC 3810',
  latitude: -38.0776708,
  longitude: 145.4818724,
  placeId: 'place-1',
  placeTypes: ['locality', 'political'],
  name: 'Pakenham',
}

const suburbQuestion: FencingChatResponse = {
  sessionId: 'session-1',
  type: 'question',
  message: 'Which suburb is the fence going in?',
  options: [],
  results: [],
  avgRatePerMeter: null,
  expects: 'suburb',
}

const emptyChecklist = {
  suburb: 'Berwick',
  fenceType: null,
  lengthMeters: null,
  heightMm: null,
  removeOldFence: null,
  siteAccess: null,
}

async function startChat(user: ReturnType<typeof userEvent.setup>, description = 'Colorbond fence, Berwick, 20m') {
  render(<Home />)
  await user.type(screen.getByLabelText(/describe your construction project/i), description)
  await user.click(screen.getByRole('button', { name: /start analysis/i }))
}

// Header links need a router context; these pages are always inside one in the app.
const render = (ui: ReactElement) => renderBare(ui, { wrapper: MemoryRouter })

describe('Home', () => {
  beforeEach(() => {
    mockedSend.mockReset()
    mockedSearch.mockReset().mockResolvedValue(suburbSuggestions)
    mockedFetchPlace.mockReset().mockResolvedValue(pakenham)
  })

  it('renders the hero and no project type is selected by default', async () => {
    render(<Home />)

    expect(screen.getByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^fencing$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^tiling$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^kitchen fitting$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^retaining wall$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^decking$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^home renovation$/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('drops straight into the chat thread with the typed description as the first message', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Hi there! Happy to help with that — ready for a few questions?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user)

    expect(screen.getByText('Colorbond fence, Berwick, 20m')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/ready for a few questions/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: null,
    })
    // the composer is always there — the user can type at any point, MCQ on screen or not
    expect(screen.getByLabelText(/your reply/i)).toBeInTheDocument()
  })

  it('sends an MCQ pick immediately and collapses the row to just that answer', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What type of fence are you after?',
      options: [
        { label: 'Timber', value: 'Timber' },
        { label: 'Colorbond', value: 'Colorbond' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: emptyChecklist,
      checklistComplete: false,
    })

    await startChat(user)

    const option = await screen.findByRole('button', { name: 'Colorbond' })

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Great choice.',
      options: [],
      results: [],
      avgRatePerMeter: null,
      checklist: { ...emptyChecklist, fenceType: 'Colorbond' },
      checklistDisplay: { fenceType: { title: 'Fence type', value: 'Colorbond' } },
      checklistAnswered: [{ key: 'fenceType', title: 'Fence type', value: 'Colorbond' }],
      checklistComplete: false,
    })
    // no Continue step any more — one click sends
    await user.click(option)
    expect(mockedSend).toHaveBeenLastCalledWith(
      'Colorbond',
      expect.any(String),
      undefined,
      expect.objectContaining({ knownChecklist: emptyChecklist, place: null }),
    )

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Timber' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByText('Fence type: Colorbond').length).toBeGreaterThanOrEqual(1))
  })

  it('labels a kitchen chip from checklistAnswered, never the raw slug', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'kitchen',
      message: 'How big is the kitchen?',
      options: [
        { label: 'Small', value: 'small' },
        { label: 'Medium', value: 'medium' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: { suburb: 'Berwick', kitchenSize: null },
    })

    await startChat(user, 'New kitchen in Berwick')
    const option = await screen.findByRole('button', { name: 'Medium' })

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'kitchen',
      message: 'What kind of benchtop?',
      options: [{ label: 'Caesarstone', value: 'caesarstone' }],
      results: [],
      avgRatePerMeter: null,
      checklist: { suburb: 'Berwick', kitchenSize: 'medium' },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'kitchenSize', title: 'Kitchen size', value: 'Medium' },
      ],
    })
    await user.click(option)

    await waitFor(() => expect(screen.getAllByText('Kitchen size: Medium').length).toBeGreaterThanOrEqual(1))
    expect(screen.queryByText(/kitchenSize/i)).not.toBeInTheDocument()
  })

  it('sends More options as a normal chip value', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'What kind of tiles?',
      options: [
        { label: 'Ceramic', value: 'ceramic' },
        { label: 'Porcelain', value: 'porcelain' },
        { label: 'More options', value: '__more__' },
      ],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user, 'I need my bathroom tiled')
    expect(await screen.findByRole('button', { name: 'More options' })).toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'Any of these?',
      options: [
        { label: 'Mosaic', value: 'mosaic' },
        { label: 'More options', value: '__more__' },
      ],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(screen.getByRole('button', { name: 'More options' }))

    expect(mockedSend).toHaveBeenLastCalledWith('__more__', expect.any(String), undefined, expect.any(Object))
    expect(await screen.findByRole('button', { name: 'Mosaic' })).toBeInTheDocument()
  })

  it('draws example photos under the bubble and still shows the question tiles', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: "Here you go — I've put some photos on your screen so you can see how it looks.\n\nWhat type of fence are you after?",
      options: [
        { label: 'Timber', value: 'Timber' },
        { label: 'Colorbond', value: 'Colorbond' },
      ],
      results: [],
      avgRatePerMeter: null,
      answer: {
        kind: 'looks',
        text: "Here you go — I've put some photos on your screen so you can see how it looks.",
        sources: [],
        images: [
          {
            url: 'https://bunnings.com.au/fence.jpg',
            thumbUrl: 'https://encrypted-tbn0.gstatic.com/images?q=colorbond',
            sourceName: 'Bunnings',
            width: 3900,
            height: 2194,
          },
        ],
      },
    })

    await startChat(user)

    expect(await screen.findByRole('button', { name: /view photo from bunnings/i })).toBeInTheDocument()
    expect(document.querySelector('img[src="https://encrypted-tbn0.gstatic.com/images?q=colorbond"]')).toBeInTheDocument()
    expect(document.querySelector('img[src="https://bunnings.com.au/fence.jpg"]')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Colorbond' })).toBeInTheDocument()
    expect(mockedSend).toHaveBeenCalledTimes(1)
  })

  it('sends a budget chip as the exact budgetValue string and leaves the question tiles up', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'hipages lists $85 to $100 a metre installed. What type of fence are you after?',
      options: [
        { label: 'Timber', value: 'Timber' },
        { label: 'Colorbond', value: 'Colorbond' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: emptyChecklist,
      answer: {
        kind: 'rates',
        text: 'hipages lists $85 to $100 a metre installed',
        sources: [
          {
            name: 'hipages',
            figure: '$85 to $100 a metre installed',
            perMetreMin: 85,
            perMetreMax: 100,
            budgetValue: 'budget:85-100:hipages',
            url: null,
          },
          { name: 'advice', figure: 'it depends', budgetValue: null },
        ],
      },
    })

    await startChat(user)

    const chip = await screen.findByRole('button', { name: /hipages, \$85 to \$100 a metre installed/i })
    expect(screen.getByText('Which of these is closest to your budget?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /advice/i })).not.toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: "Noted — I'll show you how the quotes compare to $85 to $100 a metre. What type of fence are you after?",
      options: [
        { label: 'Timber', value: 'Timber' },
        { label: 'Colorbond', value: 'Colorbond' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: emptyChecklist,
    })

    await user.click(chip)

    expect(mockedSend).toHaveBeenLastCalledWith(
      'budget:85-100:hipages',
      expect.any(String),
      undefined,
      expect.objectContaining({ knownChecklist: emptyChecklist, place: null }),
    )
    expect(await screen.findByRole('button', { name: 'Colorbond' })).toBeInTheDocument()
    expect(screen.getByText('Closest to your budget')).toBeInTheDocument()
  })

  it('follows the flip when a quote to beat actually turns up, because that is new information', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      intent: 'new_quote',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user)

    // They attach a quote, or finally mention the figure. Unlike a bare classifier flip this
    // carries the evidence with it, so the results page is right to switch to a comparison.
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      intent: 'compare_quote',
      message: 'Here is how your quote compares.',
      options: [],
      checklist: { suburb: null, fenceType: 'Timber', existingPrice: 4000 },
      results: [],
      avgRatePerMeter: 160,
      comparison: {
        potentialSavings: 200,
        marketAverage: 4200,
        totalQuotesScreened: 3,
        userExistingPrice: 4000,
        quotes: [
          {
            businessName: 'A Plus Fencing',
            ratePerMeter: 150,
            projectTotalMin: 3000,
            projectTotalMax: 3000,
            badges: [],
            tag: 'BEST_VALUE',
            savingsFromAverage: 200,
          },
        ],
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))

    expect(await screen.findByRole('heading', { name: /quote direct comparison/i })).toBeInTheDocument()
  })

  it('locks the flow to the first intent and ignores a bare flip without a quote to beat', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      intent: 'new_quote',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user)

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      // Classifier flipping mid-conversation without evidence is refused for local intent lock
      type: 'message',
      intent: 'compare_quote',
      message: 'Got it.',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))

    await waitFor(() => expect(screen.getByText('Got it.')).toBeInTheDocument())
    // Still in chat — no comparison page from a bare flip
    expect(screen.queryByRole('heading', { name: /quote direct comparison/i })).not.toBeInTheDocument()
    expect(mockedSend).toHaveBeenLastCalledWith(
      'Timber',
      expect.any(String),
      undefined,
      expect.objectContaining({ knownChecklist: null, place: null }),
    )
  })

  it('locks trade from the backend for the Other input mode, and ignores an empty later trade', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What type of fence are you after?',
      options: [
        { label: 'Timber', value: 'Timber' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      trade: 'fencing',
    })

    await startChat(user)

    expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'Anything else to add?',
      options: [{ label: 'Other', value: '__other__' }],
      results: [],
      avgRatePerMeter: null,
      trade: '',
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))

    expect(await screen.findByText(/anything else to add/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
  })

  it('sends a free-text Other answer before a trade is locked, including measurements as typed', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: null,
      message: 'What size is the job?',
      options: [
        { label: '10m', value: 10 },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user, 'I need a quote')

    expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'So that is about 20 square metres — is that right?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
      results: [],
      avgRatePerMeter: null,
    })
    await user.type(screen.getByLabelText(/your answer/i), '5m x 4m')
    await user.click(screen.getByRole('button', { name: /use this/i }))

    expect(mockedSend).toHaveBeenLastCalledWith(
      '5m x 4m',
      expect.any(String),
      undefined,
      expect.objectContaining({ knownChecklist: null, place: null }),
    )
    expect(mockedSend.mock.calls.at(-1)?.[3]).not.toHaveProperty('trade')
    expect(await screen.findByText(/20 square metres/i)).toBeInTheDocument()
  })

  it('echoes the checklist it already has back on every turn, so nothing gets asked twice', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
      checklist: emptyChecklist,
      checklistComplete: false,
    })

    await startChat(user, 'I want a fence in Berwick')

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Timber it is.',
      options: [],
      results: [],
      avgRatePerMeter: null,
      checklist: { ...emptyChecklist, fenceType: 'Timber' },
      checklistComplete: false,
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))

    // Round-trip the checklist verbatim — including suburb, even before a place is confirmed.
    expect(mockedSend).toHaveBeenLastCalledWith(
      'Timber',
      expect.any(String),
      undefined,
      expect.objectContaining({ knownChecklist: emptyChecklist }),
    )
  })

  it('sends a numeric MCQ option value as a string, matching the workflow contract', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What height fence are you after?',
      options: [
        { label: '1500mm', value: 1500 },
        { label: '1800mm', value: 1800 },
      ],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user)

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Got it!',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(await screen.findByRole('button', { name: '1800mm' }))

    expect(mockedSend).toHaveBeenLastCalledWith('1800', expect.any(String), undefined, expect.objectContaining({ place: null }))
  })

  it('lets the user type a reply instead of picking a tile', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'How long is the fence?',
      options: [
        { label: 'Up to 20m', value: 20 },
        { label: '20-50m', value: 50 },
      ],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user)
    await waitFor(() => expect(screen.getByText(/how long is the fence/i)).toBeInTheDocument())

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Roughly 35 metres, noted.',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.type(screen.getByLabelText(/your reply/i), 'about 35 metres')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(mockedSend).toHaveBeenLastCalledWith('about 35 metres', expect.any(String), undefined, expect.objectContaining({ place: null }))
    await waitFor(() => expect(screen.getByText(/roughly 35 metres, noted/i)).toBeInTheDocument())
  })

  it('confirms the brief inside the thread, then shows the thinking screen and the comparison page', async () => {
    const user = userEvent.setup()
    const fullChecklist = {
      suburb: 'Pakenham',
      fenceType: 'Pool Fencing',
      lengthMeters: 15,
      heightMm: 1800,
      removeOldFence: true,
      siteAccess: 'easy',
    }
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'confirmation',
      intent: 'new_quote',
      message: 'Got it — Pakenham, Pool Fencing, 15m. All correct?',
      options: [
        { label: "Yes, that's all correct", value: 'yes' },
        { label: "No, something's wrong", value: 'no' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: fullChecklist,
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Pakenham' },
        { key: 'fenceType', title: 'Fence type', value: 'Pool Fencing' },
        { key: 'lengthMeters', title: 'Length', value: '15m' },
      ],
      checklistComplete: false,
    })

    await startChat(user, 'Pool fencing in Pakenham, 15m')

    await waitFor(() => expect(screen.getByText(/all correct\?/i)).toBeInTheDocument())
    const yesButton = await screen.findByRole('button', { name: /yes, that's all correct/i })
    expect(screen.getAllByText('Suburb: Pakenham').length).toBeGreaterThan(0)

    let resolveNext: (value: FencingChatResponse) => void = () => {}
    mockedSend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve
        }),
    )
    await user.click(yesButton)

    // the thinking screen only appears now, once the whole conversation is settled
    await waitFor(() => expect(screen.getByRole('heading', { name: /finalising your quote/i })).toBeInTheDocument())

    resolveNext({
      sessionId: 'session-1',
      type: 'result',
      intent: 'new_quote',
      message: 'Got everything!',
      options: [],
      results: [
        { businessName: 'A Plus Fencing', suburb: 'Pakenham', ratePerMeter: 152, estimatedTotal: 3040, notes: '' },
        { businessName: 'Budget Fencing', suburb: 'Pakenham', ratePerMeter: 120, estimatedTotal: 2400, notes: '' },
      ],
      avgRatePerMeter: 152,
    })

    // a new_quote result lands on the same comparison page the compare flow uses
    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    expect(screen.getByText('$2,400')).toBeInTheDocument()
    expect(screen.getByText(/best value choice/i)).toBeInTheDocument()
    // the suburb shown is the customer's own, not a placeholder
    expect(screen.getAllByText('Services Pakenham')).toHaveLength(2)
    // and the names are behind the blur, on this flow too
    expect(screen.getByText('A Plus Fencing')).toHaveAttribute('aria-hidden', 'true')

    // The result arriving is also the end of the wait. It used to leave the thinking screen
    // armed behind the results page, so the way back to the conversation showed a progress
    // animation that nothing was ever going to finish, and only a reload cleared it.
    await user.click(screen.getByRole('button', { name: /view chat/i }))

    expect(await screen.findByText(/all correct\?/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /finalising your quote/i })).not.toBeInTheDocument()
  })

  it('opens the results page for an empty match, using the backend message rather than an error', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      message: "Sorry — I don't have any fencing businesses covering Gotham City yet. Want to try a nearby suburb?",
      options: [],
      results: [],
      avgRatePerMeter: null,
      noMatchReason: 'suburb',
    })

    await startChat(user, 'Colorbond fence in Gotham City, 20m')

    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    expect(screen.getByText(/don't have any fencing businesses covering/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /instant quote/i })).not.toBeInTheDocument()
  })

  it('lets the user correct a wrong field from the confirmation card, then re-shows the confirmation', async () => {
    const user = userEvent.setup()
    const baseChecklist = {
      suburb: 'Berwick',
      fenceType: 'Timber',
      lengthMeters: 20,
      heightMm: 1800,
      removeOldFence: false,
      siteAccess: 'easy',
    }
    const confirmationOptions = [
      { label: "Yes, that's all correct", value: 'yes' },
      { label: "No, something's wrong", value: 'no' },
    ]
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'confirmation',
      message: 'Got it — Berwick, Timber, 20m. All correct?',
      options: confirmationOptions,
      results: [],
      avgRatePerMeter: null,
      checklist: baseChecklist,
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'fenceType', title: 'Fence type', value: 'Timber' },
        { key: 'lengthMeters', title: 'Length', value: '20m' },
      ],
      checklistComplete: false,
    })

    await startChat(user, 'Timber fence in Berwick, 20m')
    const noButton = await screen.findByRole('button', { name: /no, something's wrong/i })

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'No worries — what should I fix?',
      options: [],
      results: [],
      avgRatePerMeter: null,
      checklist: baseChecklist,
      checklistComplete: false,
    })
    await user.click(noButton)
    await waitFor(() => expect(screen.getByText(/what should i fix/i)).toBeInTheDocument())
    // the answered confirmation stays in the thread, collapsed to what was chosen
    expect(screen.getByText("No, something's wrong")).toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'confirmation',
      message: 'Got it — Colorbond instead. All correct now?',
      options: confirmationOptions,
      results: [],
      avgRatePerMeter: null,
      checklist: { ...baseChecklist, fenceType: 'Colorbond' },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'fenceType', title: 'Fence type', value: 'Colorbond' },
        { key: 'lengthMeters', title: 'Length', value: '20m' },
      ],
      checklistComplete: false,
    })
    await user.type(screen.getByLabelText(/your reply/i), "it's Colorbond, not Timber")
    await user.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(screen.getByText(/all correct now\?/i)).toBeInTheDocument())
    expect(screen.getAllByText('Fence type: Colorbond').length).toBeGreaterThan(0)
  })

  it('shows an inline retry in the thread when the chat API fails', async () => {
    const user = userEvent.setup()
    mockedSend.mockRejectedValueOnce(new Error('network error'))

    await startChat(user)

    await waitFor(() => expect(screen.getByText(/something went wrong on my end/i)).toBeInTheDocument())
    const retryButton = await screen.findByRole('button', { name: /try again/i })

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(screen.queryByText(/something went wrong on my end/i)).not.toBeInTheDocument()
    expect(mockedSend).toHaveBeenLastCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: null,
    })
  })

  it('shows the API customer message and Try again when the error is retryable', async () => {
    const user = userEvent.setup()
    mockedSend.mockRejectedValueOnce(
      new FencingChatError({
        message: "We're a bit busy right now — give that another go in a moment.",
        code: 'upstream_busy',
        retryable: true,
        status: 503,
        sessionId: 'session-1',
      }),
    )

    await startChat(user)

    await waitFor(() =>
      expect(screen.getByText(/we're a bit busy right now/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText(/upstream_busy/i)).not.toBeInTheDocument()
  })

  it('hides Try again and keeps the brief when the error is not retryable', async () => {
    const user = userEvent.setup()
    const keptChecklist = {
      suburb: 'Berwick',
      fenceType: 'Colorbond',
      lengthMeters: 20,
      material: null,
      height: null,
      removal: null,
      existingPrice: null,
      _ui: { page: 0 },
    }
    mockedSend.mockRejectedValueOnce(
      new FencingChatError({
        message: "That file type isn't something I can read — try a photo or PDF.",
        code: 'unsupported_file_type',
        retryable: false,
        status: 415,
        sessionId: 'session-1',
        checklist: keptChecklist,
        checklistDisplay: {
          suburb: { title: 'Suburb', value: 'Berwick' },
          fenceType: { title: 'Fence type', value: 'Colorbond' },
        },
        checklistAnswered: [
          { key: 'suburb', title: 'Suburb', value: 'Berwick' },
          { key: 'fenceType', title: 'Fence type', value: 'Colorbond' },
        ],
        checklistComplete: false,
      }),
    )

    await startChat(user)

    await waitFor(() =>
      expect(screen.getByText(/isn't something i can read/i)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Fence type: Colorbond')).toBeInTheDocument()
  })

  it('shows the live checklist in the sidebar as the workflow fills it in', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
      checklist: emptyChecklist,
      checklistDisplay: { suburb: { title: 'Suburb', value: 'Berwick' } },
      checklistAnswered: [{ key: 'suburb', title: 'Suburb', value: 'Berwick' }],
      checklistPending: [{ key: 'fenceType', title: 'Fence type' }],
      checklistComplete: false,
    })

    await startChat(user, 'A fence in Berwick')

    await waitFor(() => expect(screen.getByText('Building your brief')).toBeInTheDocument())
    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Fence type')).toBeInTheDocument()
  })

  it('keeps showing the last-known checklist even when a later turn omits it entirely', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
      checklist: { suburb: 'Berwick', fenceType: null },
      checklistDisplay: { suburb: { title: 'Suburb', value: 'Berwick' } },
      checklistAnswered: [{ key: 'suburb', title: 'Suburb', value: 'Berwick' }],
      checklistPending: [{ key: 'fenceType', title: 'Fence type' }],
      checklistComplete: false,
    })

    await startChat(user, 'A fence in Berwick')
    await waitFor(() => expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument())

    // No `checklist` field at all on this turn — a plain aside/acknowledgement.
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Sure, I can explain that.',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.type(screen.getByLabelText(/your reply/i), 'what does that mean?')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(screen.getByText(/i can explain that/i)).toBeInTheDocument())
    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
  })

  it('shows the separate Quote Comparison page when the API returns a comparison', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'comparison_result',
      intent: 'compare_quote',
      message: 'Got it — let me see what else is out there for this...',
      options: [],
      results: [],
      avgRatePerMeter: null,
      comparison: {
        potentialSavings: 1900,
        marketAverage: 9100,
        totalQuotesScreened: 12,
        userExistingPrice: 9100,
        quotes: [
          {
            businessName: 'Modern Decks NSW',
            ratePerMeter: 118,
            projectTotalMin: 7200,
            projectTotalMax: 7600,
            leadTimeWeeksMin: 1,
            leadTimeWeeksMax: 2,
            badges: ['Standard Timber', 'Most Affordable'],
            tag: 'BEST_VALUE',
            savingsFromAverage: 1900,
          },
        ],
      },
    })

    await startChat(user, 'Colorbond, Berwick, 20m, already quoted $9,100')

    await waitFor(() => expect(screen.getByRole('heading', { name: /quote direct comparison/i })).toBeInTheDocument())
    expect(screen.getByText('Modern Decks NSW')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
  })

  it('does not route to the Quote Comparison page on type alone — only `intent: "compare_quote"` decides that', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'comparison_result',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
      comparison: { potentialSavings: null, marketAverage: null, totalQuotesScreened: 0, userExistingPrice: null, quotes: [] },
    })

    await startChat(user)

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: /quote direct comparison/i })).not.toBeInTheDocument()
  })

  it('New project resets the conversation back to the hero', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user)
    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /new project/i }))
    expect(screen.getByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
    expect(screen.queryByText(/what suburb is this in/i)).not.toBeInTheDocument()
  })

  it('selecting a published trade still opens the chat and calls the API', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })

    render(<Home />)
    await user.click(await screen.findByRole('button', { name: /^retaining wall$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    expect(screen.queryByRole('heading', { name: /retaining wall quotes are in development/i })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('I need a retaining wall — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: 'retaining_wall',
    })
  })

  it('keeps a chip-locked trade when the backend later returns a different one', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'Are you tiling the floor, the walls, or both?',
      options: [
        { label: 'Floor', value: 'floor' },
        { label: 'Wall', value: 'wall' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      trade: 'fencing',
    })

    render(<Home />)
    await user.click(await screen.findByRole('button', { name: /^tiling$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Floor' })).toBeInTheDocument())
    expect(mockedSend).toHaveBeenLastCalledWith('I need a tiling — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: 'tiling',
    })

    // Chip locked tiling → Other stays free-text even if the backend claims fencing
    expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
  })

  it('locks trade from the chip when mapped, otherwise leaves it for the backend', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValue({
      sessionId: 'session-1',
      type: 'message',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })

    render(<Home />)
    await user.click(await screen.findByRole('button', { name: /^fencing$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('I need a fencing — ', expect.any(String), [], {
        knownChecklist: null,
        place: null,
        trade: 'fencing',
      }),
    )
  })

  it('updates the prefilled description every time the chip selection changes', async () => {
    const user = userEvent.setup()
    render(<Home />)

    const textarea = screen.getByLabelText(/describe your construction project/i)
    await user.click(await screen.findByRole('button', { name: /^tiling$/i }))
    expect(textarea).toHaveValue('I need a tiling — ')

    await user.click(screen.getByRole('button', { name: /^fencing$/i }))
    expect(textarea).toHaveValue('I need a fencing — ')

    // once the user edits beyond the auto-prefill, switching chips should not clobber their text
    await user.type(textarea, 'urgently')
    await user.click(screen.getByRole('button', { name: /^retaining wall$/i }))
    expect(textarea).toHaveValue('I need a fencing — urgently')
  })

  it('submits the hero description on Enter without needing the button', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Colorbond fence, Berwick, 20m{Enter}')

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: null,
    })
  })

  it('sends any free-typed description straight to the chat API, even if it never mentions fencing', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user, 'I need a medical report')

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('I need a medical report', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: null,
    })
  })

  it('renders a null-trade picker turn and sends the tapped value as the next message', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: null,
      message: 'Are you looking for Fencing or Tiling services?',
      options: [
        { label: 'Fencing', value: 'fencing' },
        { label: 'Tiling', value: 'tiling' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: { _ui: { page: 0 } },
    })

    await startChat(user, 'hi, I need a quote')

    expect(await screen.findByRole('button', { name: 'Tiling' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fencing' })).toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'What are you having tiled?',
      options: [
        { label: 'Bathroom', value: 'bathroom' },
        { label: 'Floor only', value: 'floor_only' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: { _ui: { page: 0 } },
    })
    await user.click(screen.getByRole('button', { name: 'Tiling' }))

    expect(mockedSend).toHaveBeenLastCalledWith(
      'tiling',
      expect.any(String),
      undefined,
      expect.objectContaining({ knownChecklist: { _ui: { page: 0 } } }),
    )
    expect(mockedSend.mock.calls.at(-1)?.[3]).not.toHaveProperty('trade')
    expect(await screen.findByText(/what are you having tiled/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Bathroom' })).toBeInTheDocument()
    expect(screen.queryByText(/suburb:\s*tiling/i)).not.toBeInTheDocument()
  })

  it('sends trade on the first turn only, not on later answers', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'Are you tiling the floor, the walls, or both?',
      options: [
        { label: 'Floor', value: 'floor' },
        { label: 'Wall', value: 'wall' },
      ],
      results: [],
      avgRatePerMeter: null,
    })

    render(<Home />)
    await user.click(await screen.findByRole('button', { name: /^tiling$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Floor' })).toBeInTheDocument())
    expect(mockedSend).toHaveBeenLastCalledWith('I need a tiling — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: 'tiling',
    })

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'What are you having tiled?',
      options: [{ label: 'Bathroom', value: 'bathroom' }],
      results: [],
      avgRatePerMeter: null,
      checklist: { jobType: 'floor' },
      checklistAnswered: [{ key: 'jobType', title: 'Job', value: 'Floor' }],
    })
    await user.click(screen.getByRole('button', { name: 'Floor' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Bathroom' })).toBeInTheDocument())
    expect(mockedSend.mock.calls.at(-1)?.[3]).not.toHaveProperty('trade')
  })

  it('clears the fencing brief after a trade change and does not label the picker as a field', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'fencing',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick' },
        fenceType: { title: 'Material', value: 'Colorbond' },
        heightMm: { title: 'Height', value: '1800mm' },
      },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'fenceType', title: 'Material', value: 'Colorbond' },
        { key: 'heightMm', title: 'Height', value: '1800mm' },
      ],
      checklistPending: [{ key: 'lengthMeters', title: 'Length' }],
    })

    await startChat(user, 'Colorbond fence in Berwick')
    await waitFor(() => expect(screen.getByText('Material: Colorbond')).toBeInTheDocument())
    expect(screen.getByText('Height: 1800mm')).toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'fencing',
      message: 'Want to change the service?',
      options: [
        { label: 'Yes, change it', value: 'trade-change:yes' },
        { label: 'No, carry on', value: 'trade-change:no' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick' },
        fenceType: { title: 'Material', value: 'Colorbond' },
        heightMm: { title: 'Height', value: '1800mm' },
      },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'fenceType', title: 'Material', value: 'Colorbond' },
        { key: 'heightMm', title: 'Height', value: '1800mm' },
      ],
    })
    await user.type(screen.getByLabelText(/your reply/i), 'i want to change the trade{Enter}')
    await screen.findByRole('button', { name: /yes, change it/i })

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: null,
      message: 'Are you looking for Fencing, Tiling, or Kitchen services?',
      options: [
        { label: 'Fencing', value: 'fencing' },
        { label: 'Tiling', value: 'tiling' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: {},
      checklistDisplay: {},
      checklistAnswered: [],
      checklistPending: [],
    })
    await user.click(screen.getByRole('button', { name: /yes, change it/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiling' })).toBeInTheDocument())
    expect(screen.queryByText('Material: Colorbond')).not.toBeInTheDocument()
    expect(screen.queryByText('Height: 1800mm')).not.toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'What are you having tiled?',
      options: [
        { label: 'Bathroom', value: 'bathroom' },
        { label: 'Floor only', value: 'floor_only' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: { jobType: null },
      checklistDisplay: {},
      checklistAnswered: [],
      checklistPending: [{ key: 'jobType', title: 'Job' }],
    })
    await user.click(screen.getByRole('button', { name: 'Tiling' }))

    expect(await screen.findByText(/what are you having tiled/i)).toBeInTheDocument()
    expect(screen.queryByText(/suburb:\s*tiling/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Material: Colorbond')).not.toBeInTheDocument()
    expect(screen.queryByText('Height: 1800mm')).not.toBeInTheDocument()
    expect(screen.getByText('Job')).toBeInTheDocument()
    expect(mockedSend.mock.calls.at(-1)?.[0]).toBe('tiling')
  })

  it('keeps the brief when the customer declines a trade change', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'fencing',
      message: 'Want to change the service?',
      options: [
        { label: 'Yes, change it', value: 'trade-change:yes' },
        { label: 'No, carry on', value: 'trade-change:no' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick' },
        fenceType: { title: 'Material', value: 'Colorbond' },
      },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'fenceType', title: 'Material', value: 'Colorbond' },
      ],
      checklistPending: [{ key: 'heightMm', title: 'Height' }],
    })

    await startChat(user, 'Colorbond fence in Berwick')
    await screen.findByRole('button', { name: /no, carry on/i })
    expect(screen.getByText('Material: Colorbond')).toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'fencing',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick' },
        fenceType: { title: 'Material', value: 'Colorbond' },
      },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'fenceType', title: 'Material', value: 'Colorbond' },
      ],
      checklistPending: [{ key: 'heightMm', title: 'Height' }],
    })
    await user.click(screen.getByRole('button', { name: /no, carry on/i }))

    expect(await screen.findByText(/what type of fence/i)).toBeInTheDocument()
    expect(screen.getByText('Material: Colorbond')).toBeInTheDocument()
    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Height')).toBeInTheDocument()
  })

  it('renders a kitchen option from the chat response, not a hardcoded trade list', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: null,
      message: 'Are you looking for Fencing, Tiling or Kitchen services?',
      options: [
        { label: 'Fencing', value: 'fencing' },
        { label: 'Tiling', value: 'tiling' },
        { label: 'Kitchen', value: 'kitchen' },
      ],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user, 'hi, I need a quote')

    expect(await screen.findByRole('button', { name: 'Kitchen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fencing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tiling' })).toBeInTheDocument()
  })

  it('locks kitchen from the chip and keeps Other as free text', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What kind of kitchen job is this?',
      options: [
        { label: 'New kitchen', value: 'new' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      trade: 'kitchen',
    })

    render(<Home />)
    await user.click(await screen.findByRole('button', { name: /^kitchen fitting$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'New kitchen' })).toBeInTheDocument())
    expect(mockedSend).toHaveBeenLastCalledWith('I need a kitchen fitting — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: 'kitchen',
    })
    expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
  })

  it('fills the kitchen brief from response rows, not fencing field names', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'kitchen',
      message: 'What kind of benchtop?',
      options: [{ label: 'Caesarstone', value: 'caesarstone' }],
      results: [],
      avgRatePerMeter: null,
      checklist: { suburb: 'Berwick', jobType: 'new', kitchenSize: 'medium', benchtop: null },
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick' },
        jobType: { title: 'Job', value: 'New kitchen' },
        kitchenSize: { title: 'Kitchen size', value: 'Medium' },
      },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'jobType', title: 'Job', value: 'New kitchen' },
        { key: 'kitchenSize', title: 'Kitchen size', value: 'Medium' },
      ],
      checklistPending: [
        { key: 'benchtop', title: 'Benchtop' },
        { key: 'removal', title: 'Removal' },
        { key: 'extras', title: 'Extras' },
      ],
    })

    await startChat(user, 'New kitchen in Berwick')

    await waitFor(() => expect(screen.getByText('Building your brief')).toBeInTheDocument())
    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Kitchen size: Medium')).toBeInTheDocument()
    expect(screen.getByText('Benchtop')).toBeInTheDocument()
    expect(screen.queryByText(/^Material$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Length$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Height$/)).not.toBeInTheDocument()
  })

  it('does not print a kitchen result as a per-metre rate', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      trade: 'kitchen',
      message: 'Here is what I found nearby.',
      options: [],
      results: [
        {
          businessName: 'Berwick Kitchens',
          suburb: 'Berwick',
          ratePerMeter: 15470,
          estimatedTotal: 15470,
          notes: '2-pack, 3.2m run, Caesarstone',
        },
      ],
      avgRatePerMeter: 15470,
      unit: 'item',
    })

    await startChat(user, 'New kitchen in Berwick')

    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    expect(screen.getAllByText('$15,470').length).toBeGreaterThan(0)
    expect(screen.getByText('2-pack, 3.2m run, Caesarstone')).toBeInTheDocument()
    expect(screen.queryByText('$15470/m rate')).not.toBeInTheDocument()
    expect(screen.queryByText('$15,470/m rate')).not.toBeInTheDocument()
    expect(screen.queryByText(/\/m rate/)).not.toBeInTheDocument()
  })

  it('routes a typed bathroom renovation to that trade without sending a slug', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'home_renovation',
      message: 'Which room is this?',
      options: [
        { label: 'Bathroom', value: 'bathroom' },
        { label: 'Kitchen', value: 'kitchen' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      unit: 'item',
    })

    await startChat(user, 'I want to renovate my bathroom in Berwick')

    expect(mockedSend).toHaveBeenCalledWith('I want to renovate my bathroom in Berwick', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: null,
    })
    expect(await screen.findByRole('button', { name: 'Bathroom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kitchen' })).toBeInTheDocument()
  })

  it('sends the home_renovation slug when that chip is locked', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'Which room is this?',
      options: [
        { label: 'Bathroom', value: 'bathroom' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      trade: 'home_renovation',
    })

    render(<Home />)
    await user.click(await screen.findByRole('button', { name: /^home renovation$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Bathroom' })).toBeInTheDocument())
    expect(mockedSend).toHaveBeenLastCalledWith('I need a home renovation — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: 'home_renovation',
    })
  })

  it('fills a home renovation brief from the server rows, with no quantity and no leftover removal', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'home_renovation',
      message: 'Anything extra in the room?',
      options: [{ label: 'Nothing extra', value: 'none' }],
      results: [],
      avgRatePerMeter: null,
      unit: 'item',
      checklist: { suburb: 'Berwick', room: 'bathroom', jobType: 'strip_out', extras: null },
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick' },
        room: { title: 'Room', value: 'Bathroom' },
        jobType: { title: 'Job', value: 'Just strip it out' },
      },
      checklistAnswered: [
        { key: 'suburb', title: 'Suburb', value: 'Berwick' },
        { key: 'room', title: 'Room', value: 'Bathroom' },
        { key: 'jobType', title: 'Job', value: 'Just strip it out' },
      ],
      checklistPending: [
        { key: 'extras', title: 'Extras' },
        { key: 'conditions', title: 'Site' },
      ],
    })

    await startChat(user, 'I want to renovate my bathroom in Berwick')

    await waitFor(() => expect(screen.getByText('Building your brief')).toBeInTheDocument())
    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Room: Bathroom')).toBeInTheDocument()
    expect(screen.getByText('Job: Just strip it out')).toBeInTheDocument()
    expect(screen.getByText('Extras')).toBeInTheDocument()
    expect(screen.queryByText(/^Removal$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Length$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Size$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Height$/)).not.toBeInTheDocument()
  })

  it('does not print a home renovation result as a per-metre rate and shows every badge', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      trade: 'home_renovation',
      message: 'Here is what I found nearby.',
      options: [],
      results: [],
      avgRatePerMeter: 18400,
      unit: 'item',
      comparison: {
        potentialSavings: null,
        marketAverage: 18400,
        totalQuotesScreened: 1,
        userExistingPrice: null,
        quotes: [
          {
            businessName: 'Berwick Renovations',
            ratePerMeter: 18400,
            projectTotalMin: 18400,
            projectTotalMax: 18400,
            notes: '',
            badges: [
              'Services Berwick',
              'Floor tiling measured on site, not in this price',
              'Carpentry charged by the hour on site, not in this price',
            ],
            tag: 'BEST_VALUE',
            savingsFromAverage: null,
            unit: 'item' as const,
          },
        ],
      },
    })

    await startChat(user, 'I want to renovate my bathroom in Berwick')

    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    expect(screen.getAllByText('$18,400').length).toBeGreaterThan(0)
    expect(screen.getByText('Floor tiling measured on site, not in this price')).toBeInTheDocument()
    expect(screen.getByText('Carpentry charged by the hour on site, not in this price')).toBeInTheDocument()
    expect(screen.queryByText('$18400/m rate')).not.toBeInTheDocument()
    expect(screen.queryByText('$18,400/m rate')).not.toBeInTheDocument()
    expect(screen.queryByText(/\/m rate/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\/m² rate/)).not.toBeInTheDocument()
  })

  it('routes a typed retaining wall quote to that trade without sending a slug', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'retaining_wall',
      message: "Who's buying the materials?",
      options: [
        { label: 'They supply the materials', value: 'supply_and_install' },
        { label: "I'm buying the materials", value: 'labour_only' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      unit: 'm',
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
        wallType: { title: 'Wall type', value: 'Concrete sleepers' },
      },
      checklistPending: [
        { key: 'supply', title: 'Who supplies' },
        { key: 'lengthMeters', title: 'Length' },
        { key: 'heightKey', title: 'Height' },
        { key: 'removal', title: 'Old wall' },
        { key: 'drainage', title: 'Drainage' },
        { key: 'conditions', title: 'Site' },
      ],
    })

    await startChat(user, 'I need a retaining wall')

    expect(mockedSend).toHaveBeenCalledWith('I need a retaining wall', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: null,
    })
    expect(await screen.findByText(/who's buying the materials/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'They supply the materials' })).toBeInTheDocument()
    expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fencing' })).not.toBeInTheDocument()
  })

  it('fills a retaining wall brief from checklistDisplay and checklistPending, not field names', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'retaining_wall',
      message: "Who's buying the materials?",
      options: [{ label: 'They supply the materials', value: 'supply_and_install' }],
      results: [],
      avgRatePerMeter: null,
      checklist: {
        suburb: 'Berwick, VIC 3806',
        wallType: 'concrete_sleepers',
        supply: null,
        lengthMeters: null,
      },
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
        wallType: { title: 'Wall type', value: 'Concrete sleepers' },
      },
      checklistPending: [
        { key: 'supply', title: 'Who supplies' },
        { key: 'lengthMeters', title: 'Length' },
        { key: 'heightKey', title: 'Height' },
        { key: 'removal', title: 'Old wall' },
        { key: 'drainage', title: 'Drainage' },
        { key: 'conditions', title: 'Site' },
      ],
    })

    await startChat(user, 'I need a retaining wall')

    await waitFor(() => expect(screen.getByText('Building your brief')).toBeInTheDocument())
    expect(screen.getByText('Suburb: Berwick, VIC 3806')).toBeInTheDocument()
    expect(screen.getByText('Wall type: Concrete sleepers')).toBeInTheDocument()
    expect(screen.getByText('Who supplies')).toBeInTheDocument()
    expect(screen.getByText('Old wall')).toBeInTheDocument()
    expect(screen.getByText('Drainage')).toBeInTheDocument()
    expect(screen.queryByText(/^Material$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^wallType$/)).not.toBeInTheDocument()
  })

  it('prints a retaining wall result per linear metre, not per square metre', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      trade: 'retaining_wall',
      message: 'Got everything — here is what I found nearby.',
      options: [],
      results: [
        {
          businessName: 'Berwick Retaining Wall',
          suburb: 'Berwick',
          ratePerMeter: 520,
          estimatedTotal: 11200,
          notes: 'incl. GST · In your suburb · 4.8★ (52) · Materials supplied · Old wall removed · Drainage included',
        },
      ],
      avgRatePerMeter: 520,
      unit: 'm',
    })

    await startChat(user, 'I need a retaining wall')

    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    expect(screen.getByText('$520/m rate')).toBeInTheDocument()
    expect(screen.queryByText('$520/m² rate')).not.toBeInTheDocument()
    expect(
      screen.getByText('incl. GST · In your suburb · 4.8★ (52) · Materials supplied · Old wall removed · Drainage included'),
    ).toBeInTheDocument()
  })

  it('routes a typed merbau deck to that trade without sending a slug', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'decking',
      message: 'How high off the ground will the deck sit?',
      options: [
        { label: 'Close to the ground', value: 'low' },
        { label: 'Up high — needs stairs', value: 'high' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      unit: 'm2',
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
      },
      checklistPending: [
        { key: 'deckHeight', title: 'Height' },
        { key: 'material', title: 'Decking' },
        { key: 'areaSqm', title: 'Size' },
      ],
    })

    await startChat(user, 'I need a merbau deck')

    expect(mockedSend).toHaveBeenCalledWith('I need a merbau deck', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: null,
    })
    expect(await screen.findByText(/how high off the ground will the deck sit/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Up high — needs stairs' })).toBeInTheDocument()
    expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fencing' })).not.toBeInTheDocument()
  })

  it('fills a decking brief from checklistDisplay and checklistPending, not fence field names', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'decking',
      message: 'About how many square metres?',
      options: [{ label: '20–40 m²', value: '20-40' }],
      results: [],
      avgRatePerMeter: null,
      checklist: {
        suburb: 'Berwick, VIC 3806',
        deckHeight: 'high',
        material: 'merbau',
        areaSqm: null,
        attachment: null,
        removal: null,
        balustrade: null,
        stairs: null,
        conditions: null,
      },
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
        deckHeight: { title: 'Height', value: 'Up high — needs stairs' },
        material: { title: 'Decking', value: 'Merbau' },
      },
      checklistPending: [
        { key: 'areaSqm', title: 'Size' },
        { key: 'attachment', title: 'Attachment' },
        { key: 'removal', title: 'Old deck' },
        { key: 'balustrade', title: 'Balustrade' },
        { key: 'stairs', title: 'Stairs' },
        { key: 'conditions', title: 'Site' },
      ],
    })

    await startChat(user, 'I need a merbau deck')

    await waitFor(() => expect(screen.getByText('Building your brief')).toBeInTheDocument())
    expect(screen.getByText('Suburb: Berwick, VIC 3806')).toBeInTheDocument()
    expect(screen.getByText('Height: Up high — needs stairs')).toBeInTheDocument()
    expect(screen.getByText('Decking: Merbau')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('Old deck')).toBeInTheDocument()
    expect(screen.getByText('Balustrade')).toBeInTheDocument()
    expect(screen.queryByText(/how many metres/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/balustrade length/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^fenceType$/i)).not.toBeInTheDocument()
  })

  it('does not leave a balustrade-length step after the customer says no balustrade', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'decking',
      message: 'Do you want a balustrade?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No balustrade', value: 'none' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: {
        suburb: 'Berwick, VIC 3806',
        deckHeight: 'high',
        material: 'merbau',
        areaSqm: 30,
        attachment: 'house',
        removal: 'none',
        balustrade: null,
        balustradeLm: null,
        stairs: null,
        stairFlights: null,
      },
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
        material: { title: 'Decking', value: 'Merbau' },
      },
      checklistPending: [
        { key: 'balustrade', title: 'Balustrade' },
        { key: 'stairs', title: 'Stairs' },
        { key: 'conditions', title: 'Site' },
      ],
    })

    await startChat(user, 'I need a merbau deck')

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'decking',
      message: 'Will the deck need stairs?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No stairs', value: 'none' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: {
        suburb: 'Berwick, VIC 3806',
        deckHeight: 'high',
        material: 'merbau',
        areaSqm: 30,
        attachment: 'house',
        removal: 'none',
        balustrade: 'none',
        balustradeLm: null,
        stairs: null,
        stairFlights: null,
      },
      checklistDisplay: {
        suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
        material: { title: 'Decking', value: 'Merbau' },
        balustrade: { title: 'Balustrade', value: 'None' },
      },
      checklistPending: [
        { key: 'stairs', title: 'Stairs' },
        { key: 'conditions', title: 'Site' },
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'No balustrade' }))

    expect(await screen.findByText(/will the deck need stairs/i)).toBeInTheDocument()
    expect(screen.getByText('Stairs')).toBeInTheDocument()
    expect(screen.queryByText(/how many metres/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/balustrade length/i)).not.toBeInTheDocument()
  })

  it('prints a decking result per square metre and keeps the server total', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      trade: 'decking',
      message: 'Got everything — here is what I found nearby.',
      options: [],
      results: [
        {
          businessName: 'Berwick Decks',
          suburb: 'Berwick',
          ratePerMeter: 625,
          estimatedTotal: 19815,
          notes: 'incl. GST · 0.7 km away · 4.7★ (220) · Old deck removed · 12m of balustrade included · Stairs included · Includes $450 design',
        },
      ],
      avgRatePerMeter: 625,
      unit: 'm2',
    })

    await startChat(user, 'I need a merbau deck')

    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    expect(screen.getByText('$625/m² rate')).toBeInTheDocument()
    expect(screen.queryByText('$625/m rate')).not.toBeInTheDocument()
    expect(screen.getAllByText('$19,815').length).toBeGreaterThan(0)
    expect(screen.queryByText('$18,750')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'incl. GST · 0.7 km away · 4.7★ (220) · Old deck removed · 12m of balustrade included · Stairs included · Includes $450 design',
      ),
    ).toBeInTheDocument()
  })

  it('shows a no-price-list decking message as given, without a suburb re-prompt', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      trade: 'decking',
      message: 'There are decking businesses around Berwick, VIC 3806, but none of them have confirmed their pricing yet.',
      options: [],
      results: [],
      avgRatePerMeter: null,
      unit: 'm2',
      checklist: { suburb: 'Berwick, VIC 3806', material: 'merbau' },
    })

    await startChat(user, 'I need a merbau deck')

    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    expect(
      screen.getByText(/decking businesses around Berwick, VIC 3806, but none of them have confirmed their pricing yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/try a nearby suburb/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/try a different suburb/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /instant quote/i })).not.toBeInTheDocument()
  })

  it('keeps a covered suburb when a decking result omits place', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'decking',
      message: 'How high off the ground will the deck sit?',
      options: [{ label: 'Close to the ground', value: 'low' }],
      results: [],
      avgRatePerMeter: null,
      place: pakenham,
    })

    await startChat(user, 'I need a merbau deck')
    await screen.findByRole('button', { name: 'Close to the ground' })

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      trade: 'decking',
      message: 'Nobody near you does Spotted gum at well off the ground. The closest they can do is Treated pine at…',
      options: [],
      results: [
        {
          businessName: 'Berwick Decks',
          suburb: 'Pakenham',
          ratePerMeter: 480,
          estimatedTotal: 14400,
          notes: 'Treated pine',
        },
      ],
      avgRatePerMeter: 480,
      unit: 'm2',
    })
    await user.click(screen.getByRole('button', { name: 'Close to the ground' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /view chat/i }))

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      trade: 'decking',
      message: 'Anything else I can help with?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.type(screen.getByLabelText(/your reply/i), 'thanks{Enter}')

    await waitFor(() =>
      expect(mockedSend).toHaveBeenLastCalledWith(
        'thanks',
        expect.any(String),
        undefined,
        expect.objectContaining({ place: pakenham }),
      ),
    )
  })

  it('locks decking from the chip and keeps Other as free text', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'How high off the ground will the deck sit?',
      options: [
        { label: 'Close to the ground', value: 'low' },
        { label: 'Other', value: '__other__' },
      ],
      results: [],
      avgRatePerMeter: null,
      trade: 'decking',
    })

    render(<Home />)
    await user.click(await screen.findByRole('button', { name: /^decking$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close to the ground' })).toBeInTheDocument())
    expect(mockedSend).toHaveBeenLastCalledWith('I need a decking — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
      trade: 'decking',
    })
    expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
  })

  it('does not ask which trade when the backend already locked tiling from the words', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      trade: 'tiling',
      message: 'What are you having tiled?',
      options: [{ label: 'Bathroom', value: 'bathroom' }],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user, 'I need my bathroom tiled')

    expect(await screen.findByText(/what are you having tiled/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fencing' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tiling' })).not.toBeInTheDocument()
  })

  it('answers a suburb turn from the picker and carries the whole place to the workflow', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce(suburbQuestion)
    await startChat(user)
    await screen.findByText(/which suburb is the fence going in/i)

    await user.type(screen.getByRole('combobox'), 'pakan')
    await user.click(await screen.findByRole('option', { name: /^pakenham vic, australia/i }))

    // The label is what the agent reads; the record behind it rides alongside so postcode,
    // state and coordinates aren't thrown away.
    await waitFor(() =>
      expect(mockedSend).toHaveBeenLastCalledWith(
        'Pakenham, VIC 3810',
        expect.any(String),
        undefined,
        expect.objectContaining({ place: pakenham }),
      ),
    )
    expect((await screen.findAllByText('Suburb: Pakenham, VIC 3810')).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('sends response.place on the next turn, not the suburb the picker last selected', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce(suburbQuestion)
    await startChat(user)
    await screen.findByText(/which suburb is the fence going in/i)

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
      place: null,
    })

    await user.type(screen.getByRole('combobox'), 'pakan')
    await user.click(await screen.findByRole('option', { name: /^pakenham vic, australia/i }))

    await waitFor(() =>
      expect(mockedSend).toHaveBeenLastCalledWith(
        'Pakenham, VIC 3810',
        expect.any(String),
        undefined,
        expect.objectContaining({ place: pakenham }),
      ),
    )

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Timber it is.',
      options: [],
      results: [],
      avgRatePerMeter: null,
      place: null,
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))

    expect(mockedSend).toHaveBeenLastCalledWith(
      'Timber',
      expect.any(String),
      undefined,
      expect.objectContaining({ place: null }),
    )
  })

  it('looks a typed suburb up against Google before spending a workflow turn on it', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce(suburbQuestion)
    await startChat(user)
    await screen.findByText(/which suburb is the fence going in/i)
    mockedSend.mockClear()

    await user.type(screen.getByLabelText(/your reply/i), 'pakenham{Enter}')

    expect(await screen.findByText(/which one is yours/i)).toBeInTheDocument()
    expect(mockedSearch).toHaveBeenCalledWith('pakenham', 'token-1')
    // Nothing reached the chat API — the typed text was a lookup, not an answer
    expect(mockedSend).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('option', { name: /^pakenham vic, australia/i }))
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith(
        'Pakenham, VIC 3810',
        expect.any(String),
        undefined,
        expect.objectContaining({ place: pakenham }),
      ),
    )
  })

  it('tells the customer when a typed suburb matches nothing in Australia', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce(suburbQuestion)
    mockedSearch.mockResolvedValue([])
    await startChat(user)
    await screen.findByText(/which suburb is the fence going in/i)
    mockedSend.mockClear()

    await user.type(screen.getByLabelText(/your reply/i), 'pakenhma{Enter}')

    expect(await screen.findByText(/couldn't find "pakenhma" as an australian suburb/i)).toBeInTheDocument()
    expect(mockedSend).not.toHaveBeenCalled()
    // Still answerable — the picker stays open on the failed attempt
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  describe('a suburb the customer already named', () => {
    it('opens the picker on it, so confirming is one tap instead of typing it again', async () => {
      const user = userEvent.setup()
      mockedSend.mockResolvedValueOnce({
        ...suburbQuestion,
        // What the quote document said — an address, not a suburb
        suggestedSuburb: '12 Smith St, Pakenham VIC 3810',
      })

      await startChat(user)

      await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
      // The postcode is what gets searched: a whole street address matches no region
      expect(mockedSearch).toHaveBeenCalledWith('3810', expect.any(String))
    })

    it('leaves the picker empty rather than showing a wrong guess when nothing matches', async () => {
      const user = userEvent.setup()
      mockedSearch.mockResolvedValue([])
      mockedSend.mockResolvedValueOnce({ ...suburbQuestion, suggestedSuburb: 'somewhere unhelpful' })

      await startChat(user)

      await screen.findByRole('combobox')
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    })

    it('does not search when the turn is not asking for a suburb', async () => {
      const user = userEvent.setup()
      mockedSend.mockResolvedValueOnce({
        sessionId: 'session-1',
        type: 'message',
        message: 'Got it.',
        options: [],
        results: [],
        avgRatePerMeter: null,
        suggestedSuburb: 'Pakenham',
      })

      await startChat(user)

      await waitFor(() => expect(screen.getByText('Got it.')).toBeInTheDocument())
      expect(mockedSearch).not.toHaveBeenCalled()
    })
  })
})
