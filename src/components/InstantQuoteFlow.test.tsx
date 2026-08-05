import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComparisonQuote } from '../services/fencingChat'
import { sendOtp, verifyOtp } from '../services/otp'
import { InstantQuoteFlow } from './InstantQuoteFlow'

// The stub service sleeps to imitate a network round trip — mocked away so the tests aren't
// paced by it. Firebase will replace the same two functions.
vi.mock('../services/otp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/otp')>()),
  sendOtp: vi.fn(async (phoneE164: string) => ({ verificationId: 'test-verification', phoneE164 })),
  verifyOtp: vi.fn(async () => {}),
}))

const quotes: ComparisonQuote[] = [
  {
    businessName: 'Modern Decks NSW',
    ratePerMeter: 118,
    projectTotalMin: 7200,
    projectTotalMax: 7600,
    badges: ['Most Affordable'],
    tag: 'BEST_VALUE',
    savingsFromAverage: 1900,
  },
  {
    businessName: 'Heritage Decking Co.',
    ratePerMeter: 145,
    projectTotalMin: 7850,
    projectTotalMax: 8200,
    badges: [],
    tag: null,
    savingsFromAverage: 1250,
  },
  {
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
  render(<InstantQuoteFlow quotes={quotes} onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

/** Walks from the open dialog to the details step with the first business selected. */
async function goToDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: /modern decks nsw/i }))
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

  it('opens as a modal with every business name readable, not blurred', () => {
    renderFlow()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const name = screen.getByText('Modern Decks NSW')
    expect(name).not.toHaveAttribute('aria-hidden')
    expect(name.className).not.toMatch(/blur-/)
    expect(screen.queryByText('Business name hidden')).not.toBeInTheDocument()
  })

  it('requires at least one business before continuing, and counts the ones picked', async () => {
    const { user } = renderFlow()

    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /modern decks nsw/i }))
    await user.click(screen.getByRole('checkbox', { name: /coastal timber solutions/i }))
    expect(screen.getByRole('button', { name: /continue \(2\)/i })).toBeEnabled()

    // Selection toggles off again
    await user.click(screen.getByRole('checkbox', { name: /coastal timber solutions/i }))
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

  it('verifies the code and lands on the confirmation with the picked businesses', async () => {
    const { user, onClose } = renderFlow()
    await user.click(screen.getByRole('checkbox', { name: /modern decks nsw/i }))
    await user.click(screen.getByRole('checkbox', { name: /heritage decking co/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await fillDetails(user)

    const boxes = await screen.findAllByRole('textbox', { name: /^digit/i })
    await user.click(boxes[0])
    await user.paste('123456')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    const confirmation = await screen.findByRole('heading', { name: /you're all set/i })
    expect(confirmation).toBeInTheDocument()
    expect(verifyOtp).toHaveBeenCalledWith({ verificationId: 'test-verification', phoneE164: '+923029447610' }, '123456')
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
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
