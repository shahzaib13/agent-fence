import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setVoiceLiveLines } from '../utils/voiceLiveStore'
import { MORE_OPTION_VALUE } from '../services/fencingChat'
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
      trade={handlers.trade}
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
    setVoiceLiveLines([])
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

  it('does not show option tiles on older AI turns once a newer reply lands', () => {
    renderWindow([question, { id: 'ai-2', role: 'ai', text: 'And how long is it?' }])

    expect(screen.getByText('What type of fence are you after?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Timber' })).not.toBeInTheDocument()
  })

  it('shows Try again on retryable errors and hides it when retryable is false', () => {
    renderWindow([
      {
        id: 'err-1',
        role: 'ai',
        text: "We're a bit busy right now.",
        isError: true,
        retryable: true,
      },
    ])
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()

    cleanup()
    renderWindow([
      {
        id: 'err-2',
        role: 'ai',
        text: "That file type isn't something I can read.",
        isError: true,
        retryable: false,
      },
    ])
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('passes the picked option back with the message it belongs to', async () => {
    const user = userEvent.setup()
    const onSelectOption = vi.fn()
    renderWindow([question], false, { onSelectOption })

    await user.click(await screen.findByRole('button', { name: 'Colorbond' }))

    expect(onSelectOption).toHaveBeenCalledWith('ai-1', question.options?.[1])
  })

  it('renders More options as a chip and sends __more__, not a text box', async () => {
    const user = userEvent.setup()
    const onSelectOption = vi.fn()
    renderWindow(
      [
        {
          id: 'ai-tiles',
          role: 'ai',
          text: 'What kind of tiles?',
          options: [
            { label: 'Ceramic', value: 'ceramic' },
            { label: 'More options', value: MORE_OPTION_VALUE },
            { label: 'Other', value: '__other__' },
          ],
        },
      ],
      false,
      { onSelectOption, trade: 'tiling' },
    )

    expect(await screen.findByRole('button', { name: 'More options' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    expect(onSelectOption).toHaveBeenCalledWith('ai-tiles', { label: 'More options', value: MORE_OPTION_VALUE })
  })

  it('labels a collapsed kitchen chip from the server title, not the slug', async () => {
    renderWindow([
      {
        id: 'ai-size',
        role: 'ai',
        text: 'How big is the kitchen?',
        options: [{ label: 'Medium', value: 'medium' }],
        answered: { label: 'Medium', value: 'medium' },
        answeredField: 'kitchenSize',
        answeredTitle: 'Kitchen size',
      },
      { id: 'ai-next', role: 'ai', text: 'What kind of benchtop?' },
    ])

    expect(screen.getByText('Kitchen size: Medium')).toBeInTheDocument()
    expect(screen.queryByText(/kitchenSize/i)).not.toBeInTheDocument()
  })

  it('locks the composer and the tiles while a reply is in flight', async () => {
    renderWindow([question], true)

    expect(screen.getByLabelText(/your reply/i)).toBeDisabled()
    expect(await screen.findByRole('button', { name: 'Timber' })).toBeDisabled()
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

    it('opens a free-text box for fencing Other answers without an Other button', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption, trade: 'fencing' })
      const user = userEvent.setup()

      expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
      expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
      await user.type(screen.getByLabelText(/your answer/i), 'chainmesh')
      await user.click(screen.getByRole('button', { name: /use this/i }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-length', { label: 'chainmesh', value: 'chainmesh' })
    })

    it('opens a free-text box for tiling Other answers without an Other button', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption, trade: 'tiling' })
      const user = userEvent.setup()

      expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
      expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
      expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
      await user.type(screen.getByLabelText(/your answer/i), 'laundry splashback')
      await user.click(screen.getByRole('button', { name: /use this/i }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-length', {
        label: 'laundry splashback',
        value: 'laundry splashback',
      })
    })

    it('opens a free-text box for retaining wall Other answers without an Other button', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption, trade: 'retaining_wall' })
      const user = userEvent.setup()

      expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
      expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
      expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
      await user.type(screen.getByLabelText(/your answer/i), 'timber sleepers')
      await user.click(screen.getByRole('button', { name: /use this/i }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-length', {
        label: 'timber sleepers',
        value: 'timber sleepers',
      })
    })

    it('opens a free-text box for decking Other answers without an Other button', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption, trade: 'decking' })
      const user = userEvent.setup()

      expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
      expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
      expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
      await user.type(screen.getByLabelText(/your answer/i), 'spotted gum')
      await user.click(screen.getByRole('button', { name: /use this/i }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-length', {
        label: 'spotted gum',
        value: 'spotted gum',
      })
    })

    it('opens a free-text box instead of sending "Other" anywhere, even before a trade is locked', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption })

      expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
      expect(await screen.findByLabelText(/your answer/i)).toBeInTheDocument()
      expect(screen.queryByLabelText(/length in metres/i)).not.toBeInTheDocument()
      expect(onSelectOption).not.toHaveBeenCalled()
    })

    it('sends what was typed as an ordinary answer', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption })
      const user = userEvent.setup()

      await user.type(await screen.findByLabelText(/your answer/i), '5m x 4m')
      await user.click(screen.getByRole('button', { name: /use this/i }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-length', { label: '5m x 4m', value: '5m x 4m' })
    })

    it('wraps in a textarea and submits on Enter, not Shift+Enter', async () => {
      const onSelectOption = vi.fn()
      renderWindow([lengthQuestion], false, { onSelectOption })
      const user = userEvent.setup()

      const field = await screen.findByLabelText(/your answer/i)
      expect(field.tagName).toBe('TEXTAREA')

      await user.type(field, 'first{Shift>}{Enter}{/Shift}second')
      expect(onSelectOption).not.toHaveBeenCalled()
      expect(field).toHaveValue('first\nsecond')

      await user.type(field, '{Enter}')
      expect(onSelectOption).toHaveBeenCalledWith('ai-length', { label: 'first\nsecond', value: 'first\nsecond' })
    })

    it('keeps the real tiles next to the free-text box', async () => {
      renderWindow([lengthQuestion], false)

      expect(await screen.findByRole('button', { name: '10m' })).toBeInTheDocument()
      expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /back to options/i })).not.toBeInTheDocument()
    })
  })

  describe('old fence / old tiles removal chips', () => {
    const fencingRemoval: ChatMessage = {
      id: 'ai-removal',
      role: 'ai',
      text: 'Is there an old fence to remove?',
      options: [
        { label: 'Yes, take it away', value: 'any' },
        { label: 'Nothing to remove', value: 'none' },
        { label: 'Other', value: '__other__' },
      ],
    }

    const tilingRemoval: ChatMessage = {
      id: 'ai-tiles',
      role: 'ai',
      text: 'Are there old tiles to take up?',
      options: [
        { label: 'Yes, take them up', value: 'any' },
        { label: 'Nothing to take up', value: 'none' },
        { label: 'Other', value: '__other__' },
      ],
    }

    it('renders the server labels and never invents a removal type', async () => {
      renderWindow([fencingRemoval], false, { trade: 'fencing' })

      expect(await screen.findByRole('button', { name: 'Yes, take it away' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Nothing to remove' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
      expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /timber fence/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /ceramic tiles/i })).not.toBeInTheDocument()
    })

    it('sends the yes-answer value through when the first chip is tapped', async () => {
      const onSelectOption = vi.fn()
      renderWindow([tilingRemoval], false, { onSelectOption, trade: 'tiling' })
      const user = userEvent.setup()

      expect(await screen.findByRole('button', { name: 'Yes, take them up' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Yes, take them up' }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-tiles', { label: 'Yes, take them up', value: 'any' })
    })

    it('sends free-text about the old type through unchanged', async () => {
      const onSelectOption = vi.fn()
      renderWindow([fencingRemoval], false, { onSelectOption, trade: 'fencing' })
      const user = userEvent.setup()

      await user.type(await screen.findByLabelText(/your answer/i), 'the old timber one')
      await user.click(screen.getByRole('button', { name: /use this/i }))

      expect(onSelectOption).toHaveBeenCalledWith('ai-removal', {
        label: 'the old timber one',
        value: 'the old timber one',
      })
    })
  })

  it('renders alternative offers as priced cards instead of the option row', async () => {
    const onSelectOption = vi.fn()
    const user = userEvent.setup()
    renderWindow(
      [
        {
          id: 'ai-alt',
          role: 'ai',
          text: 'Nobody nearby does that exact spec. One of these instead?',
          options: [
            { label: 'Colorbond, 1.8m · $2,200', value: 'alt:colorbond:1.8m' },
            { label: "No thanks, I'll change something", value: 'no' },
          ],
          alternatives: [
            {
              material: 'colorbond',
              materialLabel: 'Colorbond',
              heightKey: '1.8m',
              businessName: 'Southeast Fencing',
              estimatedTotal: 2200,
              value: 'alt:colorbond:1.8m',
            },
          ],
        },
      ],
      false,
      { onSelectOption },
    )

    expect(await screen.findByText('$2,200')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Colorbond, 1.8m · $2,200' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /no thanks/i }))
    expect(onSelectOption).toHaveBeenCalledWith('ai-alt', {
      label: "No thanks, I'll change something",
      value: 'no',
    })
  })

  it('draws voice mode dividers with the curly rule class', () => {
    renderWindow([{ id: 'v-vs-1-divider-on', role: 'divider', text: 'Voice mode on' }])
    const divider = screen.getByRole('separator', { name: 'Voice mode on' })
    expect(divider).toHaveClass('voice-divider')
  })

  it('renders live agent text from the overlay store, not the message list', () => {
    setVoiceLiveLines([
      { role: 'assistant', text: 'How long is the fence going to be?', receivedAt: 1 },
    ])
    renderWindow([])
    expect(screen.getByLabelText('Live call transcript')).toHaveTextContent('How long is the fence going to be?')
  })

  it('shows one suburb chip after a place is picked, not the MCQ option row too', () => {
    renderWindow([
      {
        id: 'ai-suburb',
        role: 'ai',
        text: 'Which suburb is the fence going in?',
        expects: 'suburb',
        answered: { label: 'Pakenham, VIC 3810', value: 'Pakenham, VIC 3810' },
        answeredField: 'suburb',
      },
      { id: 'ai-next', role: 'ai', text: 'What type of fence are you after?' },
    ])

    expect(screen.getAllByText('Suburb: Pakenham, VIC 3810')).toHaveLength(1)
  })

  it('draws example photos under the bubble and keeps the option tiles', async () => {
    const onSelectOption = vi.fn()
    renderWindow(
      [
        {
          id: 'ai-looks',
          role: 'ai',
          text: 'Here you go. What type of fence are you after?',
          options: [
            { label: 'Timber', value: 'Timber' },
            { label: 'Colorbond', value: 'Colorbond' },
          ],
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
      ],
      false,
      { onSelectOption },
    )

    expect(await screen.findByText('Bunnings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view photo from bunnings/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Colorbond' })).toBeInTheDocument()
    expect(onSelectOption).not.toHaveBeenCalled()
  })

  it('sends a budget chip through onSelectBudget, not onSelectOption', async () => {
    const onSelectOption = vi.fn()
    const onSelectBudget = vi.fn()
    const user = userEvent.setup()
    const hipages = {
      name: 'hipages',
      figure: '$85 to $100 a metre installed',
      perMetreMin: 85,
      perMetreMax: 100,
      budgetValue: 'budget:85-100:hipages',
      url: null,
    }
    render(
      <ChatWindow
        messages={[
          {
            id: 'ai-rates',
            role: 'ai',
            text: 'What type of fence are you after?',
            options: [
              { label: 'Timber', value: 'Timber' },
              { label: 'Colorbond', value: 'Colorbond' },
            ],
            sources: [hipages, { name: 'Airtasker', figure: 'no figure', budgetValue: null }],
          },
        ]}
        isLoading={false}
        onSend={() => {}}
        onSelectOption={onSelectOption}
        onSelectBudget={onSelectBudget}
        onSelectPlace={() => {}}
        onRetry={() => {}}
      />,
    )

    await user.click(await screen.findByRole('button', { name: /hipages, \$85 to \$100 a metre installed/i }))

    expect(onSelectBudget).toHaveBeenCalledWith('ai-rates', hipages)
    expect(onSelectOption).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Colorbond' })).toBeInTheDocument()
  })

  it('shows photos on a voice bubble and still hides MCQ pills', async () => {
    renderWindow([
      {
        id: 'v-vs-1-3-a',
        role: 'ai',
        text: "Here you go — I've put some photos on your screen.",
        isVoice: true,
        options: [{ label: 'Colorbond', value: 'colorbond' }],
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
    ])

    expect(await screen.findByText('Bunnings')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Colorbond' })).not.toBeInTheDocument()
  })
})
