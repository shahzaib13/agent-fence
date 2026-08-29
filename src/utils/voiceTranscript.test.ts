import { describe, expect, it } from 'vitest'
import {
  applyLiveTranscriptUpdate,
  dropCommittedLivePair,
  dropLeadingAssistant,
  lastLiveTranscriptEntry,
  seedLiveGreeting,
} from './voiceTranscript'

describe('lastLiveTranscriptEntry', () => {
  it('reads only the last window row', () => {
    expect(
      lastLiveTranscriptEntry({
        transcript: [
          { role: 'user', content: 'Colorbond please' },
          { role: 'agent', content: 'How long is the fence?' },
        ],
      }),
    ).toEqual({ role: 'assistant', text: 'How long is the fence?' })
  })

  it('returns null when there is no transcript', () => {
    expect(lastLiveTranscriptEntry({})).toBeNull()
  })
})

describe('applyLiveTranscriptUpdate', () => {
  it('replaces the tail when the last role is unchanged', () => {
    const first = applyLiveTranscriptUpdate([], {
      transcript: [{ role: 'agent', content: 'Hi' }],
    })
    const grown = applyLiveTranscriptUpdate(first, {
      transcript: [{ role: 'agent', content: 'Hi there, how' }],
    })

    expect(grown).toEqual([{ role: 'assistant', text: 'Hi there, how' }])
  })

  it('does not append — Retell sends the full grown string each time', () => {
    const buffer = applyLiveTranscriptUpdate([{ role: 'user', text: 'Ber' }], {
      transcript: [
        { role: 'agent', content: 'Hi' },
        { role: 'user', content: 'Berwick' },
      ],
    })

    expect(buffer).toEqual([{ role: 'user', text: 'Berwick' }])
  })

  it('pushes when the role changes', () => {
    const afterAgent = applyLiveTranscriptUpdate([], {
      transcript: [{ role: 'agent', content: 'Which suburb?' }],
    })
    const afterUser = applyLiveTranscriptUpdate(afterAgent, {
      transcript: [
        { role: 'agent', content: 'Which suburb?' },
        { role: 'user', content: 'Berwick' },
      ],
    })

    expect(afterUser).toEqual([
      { role: 'assistant', text: 'Which suburb?' },
      { role: 'user', text: 'Berwick' },
    ])
  })

  it('does not key off earlier window rows after the sliding window drops them', () => {
    const live = [
      { role: 'user' as const, text: 'About twenty metres' },
      { role: 'assistant' as const, text: 'Got it.' },
    ]
    const next = applyLiveTranscriptUpdate(live, {
      transcript: [
        { role: 'user', content: 'Timber' },
        { role: 'agent', content: 'How tall?' },
        { role: 'user', content: 'About twenty metres' },
        { role: 'agent', content: 'Got it.' },
        { role: 'user', content: 'And a gate' },
      ],
    })

    expect(next).toEqual([
      { role: 'user', text: 'About twenty metres' },
      { role: 'assistant', text: 'Got it.' },
      { role: 'user', text: 'And a gate' },
    ])
  })
})

describe('seedLiveGreeting', () => {
  it('puts the greeting on screen before /voice/session', () => {
    expect(seedLiveGreeting('  Hi, I can help with your fence.  ')).toEqual([
      { role: 'assistant', text: 'Hi, I can help with your fence.' },
    ])
  })
})

describe('dropLeadingAssistant', () => {
  it('drops the greeting agent once turn 0 is committed', () => {
    expect(
      dropLeadingAssistant([
        { role: 'assistant', text: 'Hi' },
        { role: 'user', text: 'Berwick' },
      ]),
    ).toEqual([{ role: 'user', text: 'Berwick' }])
  })
})

describe('dropCommittedLivePair', () => {
  it('removes one user and one agent so the buffer tracks our count, not the window', () => {
    expect(
      dropCommittedLivePair([
        { role: 'user', text: 'Berwick' },
        { role: 'assistant', text: 'How long?' },
        { role: 'user', text: 'Twenty' },
      ]),
    ).toEqual([{ role: 'user', text: 'Twenty' }])
  })
})
