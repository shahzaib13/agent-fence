import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveQuote, type QuoteSession } from '../services/quotes'
import { Quotes } from './Quotes'

const auth = vi.hoisted(() => ({
  user: null as { uid: string; phoneE164: string; phone: string } | null,
  isLoading: false,
}))

const quotes = vi.hoisted(() => ({
  listQuotes: vi.fn(),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: auth.user, isLoading: auth.isLoading }),
  signOutUser: vi.fn(),
}))

vi.mock('../services/quotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/quotes')>()
  return { ...actual, listQuotes: quotes.listQuotes }
})

const session = (overrides: Partial<QuoteSession> = {}): QuoteSession => ({
  sessionId: 'sess-1',
  status: 'in_progress',
  createdAt: 1000,
  updatedAt: 1000,
  messages: [{ id: 'm1', role: 'user', text: 'I need a ColorBond fence' }],
  checklist: { suburb: 'Pakenham', material: 'ColorBond' },
  place: null,
  comparison: null,
  trade: 'fencing',
  ...overrides,
})

function renderQuotes() {
  return render(
    <MemoryRouter>
      <Quotes />
    </MemoryRouter>,
  )
}

describe('Quotes', () => {
  beforeEach(() => {
    auth.user = null
    auth.isLoading = false
    quotes.listQuotes.mockReset()
    quotes.listQuotes.mockResolvedValue([])
    localStorage.clear()
  })

  afterEach(() => localStorage.clear())

  it('shows a local quote even while Firebase is still restoring the session', async () => {
    auth.isLoading = true
    saveQuote(session())

    renderQuotes()

    expect(await screen.findByRole('heading', { name: /fencing in pakenham/i })).toBeInTheDocument()
    expect(screen.queryByText('Loading your quotes')).not.toBeInTheDocument()
  })

  it('tells a guest with no history to start one, instead of spinning forever', () => {
    renderQuotes()

    expect(screen.getByText('No quotes yet.')).toBeInTheDocument()
    expect(screen.queryByText('Loading your quotes')).not.toBeInTheDocument()
  })

  it('replaces the local list with the signed-in account once auth is known', async () => {
    auth.user = { uid: 'uid-1', phoneE164: '+61411111111', phone: '61411111111' }
    quotes.listQuotes.mockResolvedValue([
      session({
        sessionId: 'remote-1',
        messages: [{ id: 'm1', role: 'user', text: 'Tiling in Richmond' }],
        checklist: { suburb: 'Richmond', tileType: 'floor' },
        trade: 'tiling',
      }),
    ])

    renderQuotes()

    expect(await screen.findByRole('heading', { name: /tiling in richmond/i })).toBeInTheDocument()
    await waitFor(() => expect(quotes.listQuotes).toHaveBeenCalledWith('uid-1'))
  })

  it('names a saved decking quote by the board, not as a fence', async () => {
    saveQuote(
      session({
        sessionId: 'deck-1',
        messages: [{ id: 'm1', role: 'user', text: 'I need a merbau deck' }],
        checklist: { suburb: 'Berwick', material: 'Merbau' },
        trade: 'decking',
      }),
    )

    renderQuotes()

    expect(await screen.findByRole('heading', { name: /decking in berwick/i })).toBeInTheDocument()
    expect(screen.queryByText(/merbau fence/i)).not.toBeInTheDocument()
  })

  it('names a saved kitchen quote from the published label, not Kitchen in suburb', async () => {
    saveQuote(
      session({
        sessionId: 'kit-1',
        messages: [{ id: 'm1', role: 'user', text: 'I need a new kitchen' }],
        checklist: { suburb: 'Berwick', jobType: 'new' },
        trade: 'kitchen',
      }),
    )

    renderQuotes()

    expect(await screen.findByRole('heading', { name: /kitchen fitting in berwick/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^kitchen in berwick$/i })).not.toBeInTheDocument()
  })

  it('names a saved home renovation quote from the published label', async () => {
    saveQuote(
      session({
        sessionId: 'reno-1',
        messages: [{ id: 'm1', role: 'user', text: 'I want to renovate my bathroom' }],
        checklist: { suburb: 'Berwick', room: 'bathroom' },
        trade: 'home_renovation',
      }),
    )

    renderQuotes()

    expect(await screen.findByRole('heading', { name: /home renovation in berwick/i })).toBeInTheDocument()
  })
})
