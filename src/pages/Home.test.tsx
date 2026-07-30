import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendFencingChatMessage } from '../services/fencingChat'
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
