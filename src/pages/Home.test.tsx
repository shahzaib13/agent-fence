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
  // Only the network call is faked — the module's constants are part of the contract the chat
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

  it('renders the hero and no project type is selected by default', () => {
    render(<Home />)

    expect(screen.getByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^deck$/i })).toHaveAttribute('aria-pressed', 'false')
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

  it('selecting a non-fencing project type still opens the chat and calls the API', async () => {
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
    await user.click(screen.getByRole('button', { name: /^deck$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    expect(screen.queryByRole('heading', { name: /deck quotes are in development/i })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('I need a deck — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
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
    await user.click(screen.getByRole('button', { name: /^tiling$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Floor' })).toBeInTheDocument())
    expect(mockedSend).toHaveBeenLastCalledWith('I need a tiling — ', expect.any(String), [], {
      knownChecklist: null,
      place: null,
    })

    // Chip locked tiling → Other stays metres-only even if the backend claims fencing
    expect(await screen.findByLabelText(/length in metres/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/your answer/i)).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /^fence$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('I need a fence — ', expect.any(String), [], {
        knownChecklist: null,
        place: null,
      }),
    )
  })

  it('updates the prefilled description every time the chip selection changes', async () => {
    const user = userEvent.setup()
    render(<Home />)

    const textarea = screen.getByLabelText(/describe your construction project/i)
    await user.click(screen.getByRole('button', { name: /^deck$/i }))
    expect(textarea).toHaveValue('I need a deck — ')

    await user.click(screen.getByRole('button', { name: /^fence$/i }))
    expect(textarea).toHaveValue('I need a fence — ')

    // once the user edits beyond the auto-prefill, switching chips should not clobber their text
    await user.type(textarea, 'urgently')
    await user.click(screen.getByRole('button', { name: /^pergola$/i }))
    expect(textarea).toHaveValue('I need a fence — urgently')
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
    })
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
