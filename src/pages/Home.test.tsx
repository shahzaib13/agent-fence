import { render as renderBare, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendFencingChatMessage, type FencingChatResponse } from '../services/fencingChat'
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
    expect(mockedSend).toHaveBeenCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [], { intent: undefined, turn: 0, knownChecklist: null, place: null, trade: '' })
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
      checklistComplete: false,
    })
    // no Continue step any more — one click sends
    await user.click(option)
    expect(mockedSend).toHaveBeenLastCalledWith('Colorbond', expect.any(String), undefined, expect.objectContaining({ intent: undefined }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Timber' })).not.toBeInTheDocument())
    // the surviving chip names the field the answer filled, worked out by diffing the checklist
    await waitFor(() => expect(screen.getAllByText('Fence type: Colorbond').length).toBeGreaterThan(1))
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
      type: 'message',
      intent: 'compare_quote',
      message: 'Got it.',
      options: [],
      checklist: { suburb: null, fenceType: 'Timber', existingPrice: 4000 },
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))

    await waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(2))
    await user.type(screen.getByLabelText(/your reply/i), 'ok{Enter}')

    await waitFor(() =>
      expect(mockedSend).toHaveBeenLastCalledWith(
        'ok',
        expect.any(String),
        undefined,
        expect.objectContaining({ intent: 'compare_quote' }),
      ),
    )
  })

  it('locks the flow to the first intent n8n reports and echoes it back on every later turn', async () => {
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
      // n8n's classifier flipping mid-conversation is exactly what we refuse to follow
      type: 'message',
      intent: 'compare_quote',
      message: 'Got it.',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))
    expect(mockedSend).toHaveBeenLastCalledWith('Timber', expect.any(String), undefined, expect.objectContaining({ intent: 'new_quote' }))

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Sure.',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.type(screen.getByLabelText(/your reply/i), 'ok')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(mockedSend).toHaveBeenLastCalledWith('ok', expect.any(String), undefined, expect.objectContaining({ intent: 'new_quote' }))
  })

  it('echoes the locked trade back every turn and ignores an empty one from the backend', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'What type of fence are you after?',
      options: [{ label: 'Timber', value: 'Timber' }],
      results: [],
      avgRatePerMeter: null,
      trade: 'fencing',
    })

    await startChat(user)
    expect(mockedSend).toHaveBeenLastCalledWith(
      'Colorbond fence, Berwick, 20m',
      expect.any(String),
      [],
      expect.objectContaining({ trade: '' }),
    )

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Got it.',
      options: [],
      results: [],
      avgRatePerMeter: null,
      trade: '',
    })
    await user.click(await screen.findByRole('button', { name: 'Timber' }))
    expect(mockedSend).toHaveBeenLastCalledWith(
      'Timber',
      expect.any(String),
      undefined,
      expect.objectContaining({ trade: 'fencing' }),
    )
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
      // the workflow picked the suburb straight out of the hero description
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

    // Everything else is echoed back — but never the suburb, because no place has been
    // confirmed yet and a suburb the agent wrote down on its own is not established.
    expect(mockedSend).toHaveBeenLastCalledWith(
      'Timber',
      expect.any(String),
      undefined,
      expect.objectContaining({ knownChecklist: { ...emptyChecklist, suburb: null } }),
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

    expect(mockedSend).toHaveBeenLastCalledWith('1800', expect.any(String), undefined, expect.objectContaining({ intent: undefined }))
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

    expect(mockedSend).toHaveBeenLastCalledWith('about 35 metres', expect.any(String), undefined, expect.objectContaining({ intent: undefined }))
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

  it('keeps a no-match result in the thread so the reason is actually readable', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      message: "Sorry — I don't have any fencing businesses covering Gotham City yet. Want to try a nearby suburb?",
      options: [],
      results: [],
      avgRatePerMeter: null,
    })

    await startChat(user, 'Colorbond fence in Gotham City, 20m')

    await waitFor(() => expect(screen.getByText(/don't have any fencing businesses covering/i)).toBeInTheDocument())
    // still in the chat, so the suburb can be corrected on the spot
    expect(screen.getByLabelText(/your reply/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start a new quote/i })).not.toBeInTheDocument()
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
      checklistComplete: false,
    })
    await user.type(screen.getByLabelText(/your reply/i), "it's Colorbond, not Timber")
    await user.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(screen.getByText(/all correct now\?/i)).toBeInTheDocument())
    expect(screen.getAllByText('Fence type: Colorbond').length).toBeGreaterThan(0)
  })

  it('shows an inline retry in the thread when the webhook fails', async () => {
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
    expect(mockedSend).toHaveBeenLastCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [], { intent: undefined, turn: 0, knownChecklist: null, place: null, trade: '' })
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

  it('shows the separate Quote Comparison page when n8n returns a comparison', async () => {
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
    expect(mockedSend).toHaveBeenCalledWith(
      'I need a deck — ',
      expect.any(String),
      [],
      expect.objectContaining({ trade: '' }),
    )
  })

  it('locks trade to fencing only when the Fence chip was tapped, otherwise leaves it for the backend', async () => {
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
      expect(mockedSend).toHaveBeenCalledWith(
        'I need a fence — ',
        expect.any(String),
        [],
        expect.objectContaining({ trade: 'fencing' }),
      ),
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
    expect(mockedSend).toHaveBeenCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [], { intent: undefined, turn: 0, knownChecklist: null, place: null, trade: '' })
  })

  it('sends any free-typed description straight to n8n, even if it never mentions fencing', async () => {
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
    expect(mockedSend).toHaveBeenCalledWith('I need a medical report', expect.any(String), [], { intent: undefined, turn: 0, knownChecklist: null, place: null, trade: '' })
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
    expect(await screen.findByText('Suburb: Pakenham, VIC 3810')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
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
    // Nothing reached n8n — the typed text was a lookup, not an answer
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
