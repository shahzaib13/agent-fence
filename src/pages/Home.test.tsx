import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendFencingChatMessage, type FencingChatResponse } from '../services/fencingChat'
import { Home } from './Home'

vi.mock('../services/fencingChat', () => ({
  sendFencingChatMessage: vi.fn(),
}))

const mockedSend = vi.mocked(sendFencingChatMessage)

describe('Home', () => {
  beforeEach(() => {
    mockedSend.mockReset()
  })

  it('renders the hero and no project type is selected by default', () => {
    render(<Home />)

    expect(screen.getByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^deck$/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('sends the description, then requires selecting + Continue before submitting an MCQ answer', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'question',
      message: 'Nice one! What height fence are you after?',
      options: [
        { label: '1500mm', value: '1500' },
        { label: '1800mm', value: '1800' },
      ],
      results: [],
      avgRatePerMeter: null,
    })

    render(<Home />)
    await user.type(
      screen.getByLabelText(/describe your construction project/i),
      'A Colorbond fence in Berwick, about 20 metres',
    )
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/what height fence are you after/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('A Colorbond fence in Berwick, about 20 metres', expect.any(String), [])
    // no free-text box while an MCQ question is showing
    expect(screen.queryByLabelText(/your answer/i)).not.toBeInTheDocument()

    const continueButton = screen.getByRole('button', { name: /^continue$/i })
    expect(continueButton).toBeDisabled()

    const option = screen.getByRole('button', { name: /1800mm/i })
    await user.click(option)
    expect(option).toHaveAttribute('aria-pressed', 'true')
    expect(continueButton).toBeEnabled()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'What suburb is this in?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(continueButton)
    expect(mockedSend).toHaveBeenLastCalledWith('1800', expect.any(String), undefined)

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument()
  })

  it('Back resets the flow back to the hero', async () => {
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
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Colorbond fence, Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))
    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
  })

  it('shows matched businesses once the checklist is complete', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      message: 'Got everything — here is what I found nearby.',
      options: [],
      results: [
        { businessName: 'A Plus Fencing', ratePerMeter: 152, estimatedTotal: 3040, notes: 'standard height 1800mm' },
      ],
      avgRatePerMeter: 152,
    })

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Colorbond fence, Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText('A Plus Fencing')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /view quote/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start a new quote/i })).toBeInTheDocument()
  })

  it('shows the separate Quote Comparison page instead of the quiz grid when n8n returns a comparison_result', async () => {
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

    render(<Home />)
    await user.click(screen.getByRole('button', { name: /^fence$/i }))
    await user.type(
      screen.getByLabelText(/describe your construction project/i),
      'Colorbond, Berwick, 20m, already quoted $9,100',
    )
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /quote direct comparison/i })).toBeInTheDocument())
    expect(screen.getByText('Modern Decks NSW')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view quote/i })).not.toBeInTheDocument()

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

    render(<Home />)
    await user.click(screen.getByRole('button', { name: /^fence$/i }))
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Colorbond, Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: /quote direct comparison/i })).not.toBeInTheDocument()
  })

  it('falls back to rendering results when intent says compare_quote but the response has no comparison object', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'result',
      intent: 'compare_quote',
      message: '',
      options: [],
      results: [
        { businessName: 'Gisborne Fencing Services', ratePerMeter: 118, estimatedTotal: 2360, notes: 'standard height 1800mm' },
      ],
      avgRatePerMeter: 147.97,
    })

    render(<Home />)
    await user.click(screen.getByRole('button', { name: /^fence$/i }))
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Colorbond, Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText('Gisborne Fencing Services')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: /quote direct comparison/i })).not.toBeInTheDocument()
  })

  it('shows a retry button in the same card on failure, not a chat bubble', async () => {
    const user = userEvent.setup()
    mockedSend.mockRejectedValueOnce(new Error('network error'))

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Colorbond fence, Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/something went wrong on my end/i)).toBeInTheDocument())
    const retryButton = screen.getByRole('button', { name: /try again/i })
    expect(retryButton).toBeInTheDocument()

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
    expect(mockedSend).toHaveBeenLastCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [])
  })

  it('selecting a non-fencing project type shows the coming-soon screen instead of calling the API', async () => {
    const user = userEvent.setup()

    render(<Home />)
    await user.click(screen.getByRole('button', { name: /^deck$/i }))
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    expect(screen.getByRole('heading', { name: /deck quotes are in development/i })).toBeInTheDocument()
    expect(mockedSend).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /get a fencing quote instead/i }))
    expect(screen.getByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
  })

  it('selecting Fence still goes to the real quiz flow', async () => {
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
    await user.click(screen.getByRole('button', { name: /^fence$/i }))
    await user.type(screen.getByLabelText(/describe your construction project/i), 'about 20 metres')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalled()
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
    expect(mockedSend).toHaveBeenCalledWith('Colorbond fence, Berwick, 20m', expect.any(String), [])
  })

  it('sends any free-typed description straight to n8n with no chip selected, even if it never mentions fencing', async () => {
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
    await user.type(screen.getByLabelText(/describe your construction project/i), 'I need a medical report')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('I need a medical report', expect.any(String), [])
  })

  it('shows the live checklist in the sidebar as the workflow fills it in', async () => {
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
      checklist: {
        suburb: 'Berwick',
        fenceType: null,
        lengthMeters: null,
        heightMm: null,
        removeOldFence: null,
        siteAccess: null,
      },
      checklistComplete: false,
    })

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'A fence in Berwick')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText('Building your brief')).toBeInTheDocument())
    expect(screen.getAllByText('Suburb: Berwick').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fence type').length).toBeGreaterThan(0)
  })

  it('sends a numeric/boolean MCQ option value as a string, matching the workflow contract', async () => {
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

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Colorbond fence, Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/what height fence are you after/i)).toBeInTheDocument())

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'Got it!',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(screen.getByRole('button', { name: /1800mm/i }))
    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(mockedSend).toHaveBeenLastCalledWith('1800', expect.any(String), undefined)
  })

  it('shows a distinct confirmation card once the checklist is complete, then finalises after Yes', async () => {
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

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Pool fencing in Pakenham, 15m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/all correct\?/i)).toBeInTheDocument())
    expect(screen.getAllByText('Suburb: Pakenham').length).toBeGreaterThan(0)
    // confirmation is a distinct card, not the normal MCQ tile grid
    expect(screen.queryByText(/^Question \d/)).not.toBeInTheDocument()

    let resolveNext: (value: FencingChatResponse) => void = () => {}
    mockedSend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve
        }),
    )
    await user.click(screen.getByRole('button', { name: /yes, that's all correct/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /finalising your quote/i })).toBeInTheDocument())

    resolveNext({
      sessionId: 'session-1',
      type: 'result',
      intent: 'new_quote',
      message: 'Got everything!',
      options: [],
      results: [{ businessName: 'A Plus Fencing', ratePerMeter: 152, estimatedTotal: 3040, notes: '' }],
      avgRatePerMeter: 152,
    })

    await waitFor(() => expect(screen.getByText('A Plus Fencing')).toBeInTheDocument())
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
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'confirmation',
      message: 'Got it — Berwick, Timber, 20m. All correct?',
      options: [
        { label: "Yes, that's all correct", value: 'yes' },
        { label: "No, something's wrong", value: 'no' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: baseChecklist,
      checklistComplete: false,
    })

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Timber fence in Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))
    await waitFor(() => expect(screen.getByText(/all correct\?/i)).toBeInTheDocument())

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
    await user.click(screen.getByRole('button', { name: /no, something's wrong/i }))

    await waitFor(() => expect(screen.getByText(/what should i fix/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument()

    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'confirmation',
      message: 'Got it — Colorbond instead. All correct now?',
      options: [
        { label: "Yes, that's all correct", value: 'yes' },
        { label: "No, something's wrong", value: 'no' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: { ...baseChecklist, fenceType: 'Colorbond' },
      checklistComplete: false,
    })
    await user.type(screen.getByLabelText(/your answer/i), "it's Colorbond, not Timber")
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(screen.getByText(/all correct now\?/i)).toBeInTheDocument())
    expect(screen.getAllByText('Fence type: Colorbond').length).toBeGreaterThan(0)
  })

  it('keeps showing the last-known checklist even when a later turn omits it entirely', async () => {
    const user = userEvent.setup()
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'confirmation',
      message: 'Got it — Berwick, Timber, 20m. All correct?',
      options: [
        { label: "Yes, that's all correct", value: 'yes' },
        { label: "No, something's wrong", value: 'no' },
      ],
      results: [],
      avgRatePerMeter: null,
      checklist: { suburb: 'Berwick', fenceType: 'Timber', lengthMeters: 20 },
      checklistComplete: false,
    })

    render(<Home />)
    await user.type(screen.getByLabelText(/describe your construction project/i), 'Timber fence in Berwick, 20m')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))
    await waitFor(() => expect(screen.getByText(/all correct\?/i)).toBeInTheDocument())

    // No `checklist` field at all on this turn — a plain aside/acknowledgement.
    mockedSend.mockResolvedValueOnce({
      sessionId: 'session-1',
      type: 'message',
      message: 'No worries — what should I fix?',
      options: [],
      results: [],
      avgRatePerMeter: null,
    })
    await user.click(screen.getByRole('button', { name: /no, something's wrong/i }))

    await waitFor(() => expect(screen.getByText(/what should i fix/i)).toBeInTheDocument())
    expect(screen.getByText('Building your brief')).toBeInTheDocument()
    expect(screen.getAllByText('Suburb: Berwick').length).toBeGreaterThan(0)
  })

  it('sends a typo\'d description straight to n8n too, no local keyword classification', async () => {
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
    await user.type(screen.getByLabelText(/describe your construction project/i), 'I need a fance around my yard')
    await user.click(screen.getByRole('button', { name: /start analysis/i }))

    await waitFor(() => expect(screen.getByText(/what suburb is this in/i)).toBeInTheDocument())
    expect(mockedSend).toHaveBeenCalledWith('I need a fance around my yard', expect.any(String), [])
  })
})
