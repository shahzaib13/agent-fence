import { describe, expect, it } from 'vitest'
import { assistantTextFromTurn, committedVoiceTurnCount, freshVoiceTurns, lastVoiceTurnN } from '../services/voice'
import { mergeVoiceTurns, messagesFromVoiceTurns, voiceModeOnDivider } from './voiceMessages'

describe('messagesFromVoiceTurns', () => {
  it('renders spoke, not wrote', () => {
    expect(
      messagesFromVoiceTurns(
        [{ n: 1, said: 'Colorbond', wrote: 'How long?', spoke: 'How long is the fence going to be?' }],
        'vs-1',
      ),
    ).toEqual([
      expect.objectContaining({ id: 'v-vs-1-1-u', role: 'user', text: 'Colorbond', isVoice: true }),
      expect.objectContaining({
        id: 'v-vs-1-1-a',
        role: 'ai',
        text: 'How long is the fence going to be?',
        isVoice: true,
      }),
    ])
  })

  it('does not attach offered pills to voice bubbles', () => {
    const messages = mergeVoiceTurns(
      [],
      [
        {
          n: 4,
          said: 'treated pine',
          spoke: 'What type of fence are you after?',
          offered: [{ label: 'Colorbond', value: 'colorbond' }],
        },
      ],
      'vs-1',
    )

    const ai = messages.find((message) => message.id === 'v-vs-1-4-a')
    expect(ai?.text).toBe('What type of fence are you after?')
    expect(ai?.options).toBeUndefined()
  })

  it('keeps turns from separate calls when sessionIds differ', () => {
    const first = mergeVoiceTurns([], [{ n: 1, said: 'Hi', spoke: 'Hello' }], 'call-a')
    const both = mergeVoiceTurns(first, [{ n: 1, said: 'Again', spoke: 'Welcome back' }], 'call-b')

    expect(both).toEqual([
      expect.objectContaining({ id: 'v-call-a-1-u', text: 'Hi' }),
      expect.objectContaining({ id: 'v-call-a-1-a', text: 'Hello' }),
      expect.objectContaining({ id: 'v-call-b-1-u', text: 'Again' }),
      expect.objectContaining({ id: 'v-call-b-1-a', text: 'Welcome back' }),
    ])
  })

  it('reuses stable ids when the same turn is merged again', () => {
    const turn = { n: 3, spoke: 'Which suburb?' }
    const once = mergeVoiceTurns([], [turn], 'vs-1')
    const twice = mergeVoiceTurns(once, [turn], 'vs-1')
    expect(twice).toHaveLength(1)
    expect(twice[0].id).toBe('v-vs-1-3-a')
  })

  it('renders greeting turn n:0 as an AI bubble', () => {
    expect(messagesFromVoiceTurns([{ n: 0, said: '', wrote: '', spoke: 'Hi, I can help with your fence.' }], 'vs-1')).toEqual([
      expect.objectContaining({
        id: 'v-vs-1-0-a',
        role: 'ai',
        text: 'Hi, I can help with your fence.',
        isVoice: true,
      }),
    ])
  })

  it('builds persistent voice mode dividers', () => {
    expect(voiceModeOnDivider('vs-1', 100)).toEqual({
      id: 'v-vs-1-divider-on',
      role: 'divider',
      text: 'Voice mode on',
      createdAt: 100,
    })
  })
})

describe('freshVoiceTurns', () => {
  it('includes greeting turn n:0 when nothing has been merged yet', () => {
    expect(freshVoiceTurns([{ n: 0, spoke: 'Hi' }, { n: 1, said: 'Berwick' }], -1)).toEqual([
      { n: 0, spoke: 'Hi' },
      { n: 1, said: 'Berwick' },
    ])
  })

  it('filters by turn number, not array index', () => {
    const turns = [
      { n: 41, spoke: 'Older turn' },
      { n: 42, spoke: 'Newer turn' },
    ]
    expect(freshVoiceTurns(turns, 41)).toEqual([{ n: 42, spoke: 'Newer turn' }])
    expect(lastVoiceTurnN(turns, 41)).toBe(42)
  })
})

describe('assistantTextFromTurn', () => {
  it('uses spoke only', () => {
    expect(assistantTextFromTurn({ spoke: 'Hi there', wrote: 'Hi' })).toBe('Hi there')
    expect(assistantTextFromTurn({ wrote: 'Hi' })).toBeUndefined()
  })
})

describe('committedVoiceTurnCount', () => {
  it('excludes greeting turn n:0', () => {
    expect(committedVoiceTurnCount([{ n: 0, spoke: 'Hi' }, { n: 1, said: 'Berwick', spoke: 'Ok' }])).toBe(1)
  })
})
