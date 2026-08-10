import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatWindow, type ChatMessage } from './ChatWindow'

const question: ChatMessage = {
  id: 'ai-1',
  role: 'ai',
  text: 'What type of fence are you after?',
  options: [
    { label: 'Timber', value: 'Timber' },
    { label: 'Colorbond', value: 'Colorbond' },
  ],
}

function renderWindow(messages: ChatMessage[], isLoading = false, handlers: Partial<Parameters<typeof ChatWindow>[0]> = {}) {
  return render(
    <ChatWindow
      messages={messages}
      isLoading={isLoading}
      onSend={handlers.onSend ?? (() => {})}
      onSelectOption={handlers.onSelectOption ?? (() => {})}
      onSelectPlace={handlers.onSelectPlace ?? (() => {})}
      onRetry={handlers.onRetry ?? (() => {})}
      pendingFiles={handlers.pendingFiles}
    />,
  )
}

const fakeFile = (name: string, type: string) => new File(['x'], name, { type })

describe('ChatWindow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cycles the pending bubble through its thinking lines and dots while the reply is in flight', () => {
    vi.useFakeTimers()
    renderWindow([question], true)

    expect(screen.getByText('Thinking')).toBeInTheDocument()

    // dots build up a beat at a time, then reset
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByText('..')).toBeInTheDocument()

    // and the line itself swaps after a full cycle rather than sitting still
    act(() => {
      vi.advanceTimersByTime(2400)
    })
    expect(screen.getByText('Reading your answer')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('says what it is doing with the attachments the turn is carrying', () => {
    renderWindow([question], true, { pendingFiles: [fakeFile('quote.pdf', 'application/pdf')] })
    expect(screen.getByText('Reading your document')).toBeInTheDocument()

    cleanup()
    renderWindow([question], true, { pendingFiles: [fakeFile('fence.jpg', 'image/jpeg')] })
    expect(screen.getByText('Looking at your photos')).toBeInTheDocument()

    cleanup()
    renderWindow([question], true, {
      pendingFiles: [fakeFile('quote.pdf', 'application/pdf'), fakeFile('fence.jpg', 'image/jpeg')],
    })
    expect(screen.getByText('Reading what you sent')).toBeInTheDocument()
  })

  it('renders an older turn in full straight away instead of replaying its reveal', () => {
    renderWindow([question, { id: 'ai-2', role: 'ai', text: 'And how long is it?' }])

    // ai-1 is no longer the newest reply, so its text and tiles are there without waiting
    expect(screen.getByText('What type of fence are you after?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Timber' })).toBeInTheDocument()
  })

  it('passes the picked option back with the message it belongs to', async () => {
    const user = userEvent.setup()
    const onSelectOption = vi.fn()
    renderWindow([question, { id: 'ai-2', role: 'ai', text: 'Pick one.' }], false, { onSelectOption })

    await user.click(screen.getByRole('button', { name: 'Colorbond' }))

    expect(onSelectOption).toHaveBeenCalledWith('ai-1', question.options?.[1])
  })

  it('locks the composer and the tiles while a reply is in flight', () => {
    renderWindow([question, { id: 'ai-2', role: 'ai', text: 'Pick one.' }], true)

    expect(screen.getByLabelText(/your reply/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Timber' })).toBeDisabled()
    expect(screen.getByRole('status', { name: /waiting for a reply/i })).toBeInTheDocument()
  })

  it('sends typed text and clears the composer', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderWindow([question], false, { onSend })

    const input = screen.getByLabelText(/your reply/i)
    await user.type(input, '  about 35 metres  ')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(onSend).toHaveBeenCalledWith('about 35 metres')
    expect(input).toHaveValue('')
  })

  it('sends on Enter but starts a new line on Shift+Enter', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderWindow([question], false, { onSend })

    const input = screen.getByLabelText(/your reply/i)
    await user.type(input, 'first{Shift>}{Enter}{/Shift}second')
    expect(onSend).not.toHaveBeenCalled()
    expect(input).toHaveValue('first\nsecond')

    await user.type(input, '{Enter}')
    expect(onSend).toHaveBeenCalledWith('first\nsecond')
  })

  describe('an answer that is not on the row', () => {
    const lengthQuestion: ChatMessage = {
      id: 'ai-length',
      role: 'ai',
      text: 'How long is the fence?',
      options: [
        { label: '10m', value: 10 },
        { label: '20m', value: 20 },
        { label: 'Other', value: '__other__' },
      ],
    }

    it('opens a box instead of sending "Other" anywhere', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption })
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Other' }))

      expect(screen.getByLabelText(/length in metres/i)).toBeInTheDocument()
      expect(onSelectOption).not.toHaveBeenCalled()
    })

    it('sends what was typed as an ordinary answer', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption })
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Other' }))
      await user.type(screen.getByLabelText(/length in metres/i), '27')
      await user.click(screen.getByRole('button', { name: /use this/i }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-length', { label: '27m', value: 27 })
    })

    it('refuses a length that cannot be a fence', async () => {
      renderWindow([lengthQuestion], false)
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Other' }))
      const box = screen.getByLabelText(/length in metres/i)

      await user.type(box, '0')
      expect(screen.getByRole('button', { name: /use this/i })).toBeDisabled()

      await user.clear(box)
      await user.type(box, '5000')
      expect(screen.getByRole('button', { name: /use this/i })).toBeDisabled()

      await user.clear(box)
      await user.type(box, '27.5')
      expect(screen.getByRole('button', { name: /use this/i })).toBeEnabled()
    })

    it('goes back to the tiles when it was the wrong turn to take', async () => {
      renderWindow([lengthQuestion], false)
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Other' }))
      await user.click(screen.getByRole('button', { name: /back to options/i }))

      expect(screen.getByRole('button', { name: '10m' })).toBeInTheDocument()
      expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
    })
  })
})
