import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComparisonQuote } from '../services/fencingChat'
import { shareTranscriptInChats } from '../services/chat'
import { submitJob } from '../services/jobs'
import { sendOtp, verifyOtp } from '../services/otp'
import type { SuburbPlace } from '../services/places'
import type { QuoteSession } from '../services/quotes'
import { partnerSiteUrl } from '../services/handoff'
import { InstantQuoteFlow } from './InstantQuoteFlow'

// The stub service sleeps to imitate a network round trip — mocked away so the tests aren't
// paced by it. Firebase will replace the same two functions.
vi.mock('../services/otp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/otp')>()),
  sendOtp: vi.fn(async (phoneE164: string) => ({ verificationId: 'test-verification', phoneE164 })),
  verifyOtp: vi.fn(async () => 'firebase-uid'),
}))

// Verifying now also writes the lead. Firestore stays out of it here; jobs.test.ts covers the
// document that gets built.
vi.mock('../services/jobs', () => ({ submitJob: vi.fn(async () => 'VI-12345') }))
// The PDF is rendered and uploaded for real elsewhere; here it is just a URL.
vi.mock('../services/transcript', () => ({
  buildTranscriptPdf: vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' })),
  storeTranscriptForJob: vi.fn(async () => 'https://storage/ai.pdf'),
}))
// The chat lives in the Realtime Database on the other side; chat.test.ts covers what it writes.
vi.mock('../services/chat', () => ({ shareTranscriptInChats: vi.fn(async () => {}) }))
// Leaving for the partner site is a real navigation; here it is just a recorded call.
vi.mock('../services/handoff', () => ({
  partnerSiteUrl: vi.fn(async () => 'https://partner.example/#t=handoff-token'),
}))
const assign = vi.fn()
vi.stubGlobal('location', { assign })

const quoteSession: QuoteSession = {
  sessionId: 'sess-1',
  status: 'complete',
  createdAt: 1_754_000_000_000,
  updatedAt: 1_754_000_100_000,
  messages: [{ id: 'm1', role: 'user', text: 'I need a fence' }],
  checklist: { suburb: 'Pakenham, VIC 3810', fenceType: 'Timber' },
  place: null,
  comparison: null,
}


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
  placeId: 'ChIJxUv0xoYb1moRsOCMIXVWBAU',
  placeTypes: ['locality', 'political'],
  name: 'Pakenham',
}

const quotes: ComparisonQuote[] = [
  {
    businessId: 'biz-1',
    businessName: 'Modern Decks NSW',
    ratePerMeter: 118,
    projectTotalMin: 7200,
    projectTotalMax: 7600,
    badges: ['Most Affordable'],
    tag: 'BEST_VALUE',
    savingsFromAverage: 1900,
  },
  {
    businessId: 'biz-2',
    autoAcceptsAi: true,
    businessName: 'Heritage Decking Co.',
    ratePerMeter: 145,
    projectTotalMin: 7850,
    projectTotalMax: 8200,
    badges: [],
    tag: null,
    savingsFromAverage: 1250,
  },
  {
    businessId: 'biz-3',
    businessName: 'Coastal Timber Solutions',
    ratePerMeter: 175,
    projectTotalMin: 8400,
    projectTotalMax: 9100,
    badges: [],
    tag: null,
    savingsFromAverage: null,
  },
]

function renderFlow(onClose = vi.fn()) {
  render(<InstantQuoteFlow quotes={quotes} place={pakenham} quoteSession={quoteSession} onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

/** Names are blurred on the cards, so each checkbox is labelled by its position instead. */
function pick(businessName: string) {
  const index = quotes.findIndex((quote) => quote.businessName === businessName)
  return screen.getByRole('checkbox', { name: `Business ${index + 1}` })
}

/** Walks from the open dialog to the details step with the first business selected. */
async function goToDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(pick('Modern Decks NSW'))
  await user.click(screen.getByRole('button', { name: /continue/i }))
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>, phone = '+923029447610') {
  await user.type(screen.getByLabelText(/full name/i), 'Ayesha Khan')
  await user.type(screen.getByLabelText(/email/i), 'ayesha@example.com')
  await user.type(screen.getByLabelText(/phone number/i), phone)
  await user.click(screen.getByRole('button', { name: /continue/i }))
}

describe('InstantQuoteFlow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens as a modal with every business name still behind a blur', () => {
    renderFlow()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const name = screen.getByText('Modern Decks NSW')
    expect(name).toHaveAttribute('aria-hidden', 'true')
    expect(name.className).toMatch(/blur-/)
    expect(screen.getAllByText('Business name hidden')).toHaveLength(quotes.length)
  })

  it('requires at least one business before continuing, and counts the ones picked', async () => {
    const { user } = renderFlow()

    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled()

    await user.click(pick('Modern Decks NSW'))
    await user.click(pick('Coastal Timber Solutions'))
    expect(screen.getByRole('button', { name: /continue \(2\)/i })).toBeEnabled()

    // Selection toggles off again
    await user.click(pick('Coastal Timber Solutions'))
    expect(screen.getByRole('button', { name: /continue \(1\)/i })).toBeEnabled()
  })

  it('closes on cancel', async () => {
    const { user, onClose } = renderFlow()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('closes on the cross', async () => {
    const { user, onClose } = renderFlow()

    await user.click(screen.getByRole('button', { name: /close instant quote/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('closes on Escape', async () => {
    const { user, onClose } = renderFlow()

    screen.getByRole('button', { name: /close instant quote/i }).focus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('rejects an empty name, a malformed email, and an unusable phone number', async () => {
    const { user } = renderFlow()
    await goToDetails(user)

    await user.type(screen.getByLabelText(/email/i), 'ayesha@@example')
    await user.type(screen.getByLabelText(/phone number/i), '12')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText('Enter your full name.')).toBeInTheDocument()
    expect(screen.getByText('Enter an email address we can reach you at.')).toBeInTheDocument()
    expect(screen.getByText(/country code/i)).toBeInTheDocument()
    expect(sendOtp).not.toHaveBeenCalled()
  })

  it('normalises a local number to E.164 on blur and sends the code to that', async () => {
    const { user } = renderFlow()
    await goToDetails(user)

    await user.type(screen.getByLabelText(/phone number/i), '0302 944 7610')
    await user.tab()
    expect(screen.getByLabelText(/phone number/i)).toHaveValue('+923029447610')

    await user.type(screen.getByLabelText(/full name/i), 'Ayesha Khan')
    await user.type(screen.getByLabelText(/email/i), 'ayesha@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(sendOtp).toHaveBeenCalledWith('+923029447610'))
  })

  it('sanitises padded input before it leaves the form', async () => {
    const { user } = renderFlow()
    await goToDetails(user)

    await user.type(screen.getByLabelText(/full name/i), '  Ayesha   Khan  ')
    await user.type(screen.getByLabelText(/email/i), '  AYESHA@Example.com ')
    await user.type(screen.getByLabelText(/phone number/i), '+923029447610')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await screen.findByRole('group', { name: /verification code/i })
    await user.click(screen.getByRole('button', { name: /change number/i }))
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Ayesha Khan')
    expect(screen.getByLabelText(/email/i)).toHaveValue('ayesha@example.com')
  })

  it('moves focus forward as the code is typed and accepts a pasted code', async () => {
    const { user } = renderFlow()
    await goToDetails(user)
    await fillDetails(user)

    const boxes = await screen.findAllByRole('textbox', { name: /^digit/i })
    expect(boxes).toHaveLength(6)
    expect(screen.getByRole('button', { name: /^verify$/i })).toBeDisabled()

    await user.type(boxes[0], '12')
    expect(boxes[0]).toHaveValue('1')
    expect(boxes[1]).toHaveValue('2')

    await user.click(boxes[0])
    await user.paste('654321')
    expect(boxes.map((box) => (box as HTMLInputElement).value).join('')).toBe('654321')
    expect(screen.getByRole('button', { name: /^verify$/i })).toBeEnabled()
  })

  it('verifies the code, saves the lead, and takes them straight to the businesses', async () => {
    const { user } = renderFlow()
    await user.click(pick('Modern Decks NSW'))
    await user.click(pick('Heritage Decking Co.'))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await fillDetails(user)

    const boxes = await screen.findAllByRole('textbox', { name: /^digit/i })
    await user.click(boxes[0])
    await user.paste('123456')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(verifyOtp).toHaveBeenCalledWith({ verificationId: 'test-verification', phoneE164: '+923029447610' }, '123456')
    // The lead is saved with the businesses that were actually ticked, under the verified uid
    await waitFor(() =>
      expect(submitJob).toHaveBeenCalledWith({
        fullName: 'Ayesha Khan',
        email: 'ayesha@example.com',
        phoneE164: '+923029447610',
        uid: 'firebase-uid',
        place: pakenham,
        sessionId: 'sess-1',
        aiChatPdfUrl: 'https://storage/ai.pdf',
        // Each one carries its own AI auto-accept toggle, which decides where its copy lands
        businesses: [
          { id: 'biz-1', autoAcceptsAi: false },
          { id: 'biz-2', autoAcceptsAi: true },
        ],
      }),
    )

    // Every picked business gets the transcript in its own chat, under the verified uid
    await waitFor(() =>
      expect(shareTranscriptInChats).toHaveBeenCalledWith(
        expect.objectContaining({
          customerUid: 'firebase-uid',
          businesses: [
            { id: 'biz-1', name: 'Modern Decks NSW' },
            { id: 'biz-2', name: 'Heritage Decking Co.' },
          ],
        }),
      ),
    )

    // No congratulations screen in between — the conversation they came for is over there
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://partner.example/#t=handoff-token'))
    expect(screen.queryByRole('heading', { name: /you're all set/i })).not.toBeInTheDocument()
  })

  it('keeps them on OTP and shows an error when handoff cannot mint #t=', async () => {
    vi.mocked(partnerSiteUrl).mockRejectedValueOnce(
      new Error("Couldn't open your QuoteMy session. Try again in a moment."),
    )
    const { user } = renderFlow()
    await user.click(pick('Modern Decks NSW'))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await fillDetails(user)

    const boxes = await screen.findAllByRole('textbox', { name: /^digit/i })
    await user.click(boxes[0])
    await user.paste('123456')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't open your quotemy session/i)
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: /verification code/i })).toBeInTheDocument()
  })

  it('retries only the partner handoff after the lead is already saved', async () => {
    vi.mocked(partnerSiteUrl)
      .mockRejectedValueOnce(new Error("Couldn't open your QuoteMy session. Try again in a moment."))
      .mockResolvedValueOnce('https://partner.example/#t=retry-token')

    const { user } = renderFlow()
    await user.click(pick('Modern Decks NSW'))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await fillDetails(user)

    const boxes = await screen.findAllByRole('textbox', { name: /^digit/i })
    await user.click(boxes[0])
    await user.paste('123456')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't open your quotemy session/i)
    expect(submitJob).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /^verify$/i }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://partner.example/#t=retry-token'))
    expect(submitJob).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected code without leaving the step', async () => {
    vi.mocked(verifyOtp).mockRejectedValueOnce(new Error("That code didn't match. Try again."))
    const { user } = renderFlow()
    await goToDetails(user)
    await fillDetails(user)

    const boxes = await screen.findAllByRole('textbox', { name: /^digit/i })
    await user.click(boxes[0])
    await user.paste('000000')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't match. Try again.")
    expect(screen.getByRole('group', { name: /verification code/i })).toBeInTheDocument()
  })

  it('holds resend behind a cooldown and steps back to details from the cross', async () => {
    const { user } = renderFlow()
    await goToDetails(user)
    await fillDetails(user)

    await screen.findByRole('group', { name: /verification code/i })
    expect(screen.getByRole('button', { name: /resend code in 30s/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /go back a step/i }))
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument()
    expect(sendOtp).toHaveBeenCalledTimes(1)
  })
})
