import { describe, expect, it } from 'vitest'
import {
  applyLiveTranscriptUpdate,
  dropLinesBefore,
  lastLiveTranscriptEntry,
  seedLiveGreeting,
  type LiveTranscriptLine,
} from './voiceTranscript'

const at = (role: LiveTranscriptLine['role'], text: string, receivedAt: number): LiveTranscriptLine => ({
  role,
  text,
  receivedAt,
})

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
    const first = applyLiveTranscriptUpdate([], { transcript: [{ role: 'agent', content: 'Hi' }] }, 100)
    const grown = applyLiveTranscriptUpdate(
      first,
      { transcript: [{ role: 'agent', content: 'Hi there, how' }] },
      200,
    )

    expect(grown).toEqual([at('assistant', 'Hi there, how', 200)])
  })

  it('does not append — Retell sends the full grown string each time', () => {
    const buffer = applyLiveTranscriptUpdate(
      [at('user', 'Ber', 50)],
      {
        transcript: [
          { role: 'agent', content: 'Hi' },
          { role: 'user', content: 'Berwick' },
        ],
      },
      100,
    )

    expect(buffer).toEqual([at('user', 'Berwick', 100)])
  })

  it('keeps one line per role when the role changes', () => {
    const afterAgent = applyLiveTranscriptUpdate(
      [],
      { transcript: [{ role: 'agent', content: 'Which suburb?' }] },
      100,
    )
    const afterUser = applyLiveTranscriptUpdate(
      afterAgent,
      {
        transcript: [
          { role: 'agent', content: 'Which suburb?' },
          { role: 'user', content: 'Berwick' },
        ],
      },
      200,
    )

    expect(afterUser).toEqual([at('assistant', 'Which suburb?', 100), at('user', 'Berwick', 200)])
  })

  it('revises the existing user line instead of appending fragments after an echo flip', () => {
    let buffer = applyLiveTranscriptUpdate(
      [],
      { transcript: [{ role: 'user', content: 'One.' }] },
      100,
    )
    buffer = applyLiveTranscriptUpdate(
      buffer,
      {
        transcript: [
          { role: 'user', content: 'One.' },
          { role: 'agent', content: 'One.' },
        ],
      },
      150,
    )
    buffer = applyLiveTranscriptUpdate(
      buffer,
      {
        transcript: [
          { role: 'agent', content: 'One.' },
          { role: 'user', content: 'One gate.' },
        ],
      },
      200,
    )

    expect(buffer).toEqual([at('assistant', 'One.', 150), at('user', 'One gate.', 200)])
  })

  it('never holds more than one line per role', () => {
    const live = [at('user', 'About twenty metres', 10), at('assistant', 'Got it.', 20)]
    const next = applyLiveTranscriptUpdate(
      live,
      {
        transcript: [
          { role: 'user', content: 'Timber' },
          { role: 'agent', content: 'How tall?' },
          { role: 'user', content: 'About twenty metres' },
          { role: 'agent', content: 'Got it.' },
          { role: 'user', content: 'And a gate' },
        ],
      },
      30,
    )

    expect(next).toEqual([at('assistant', 'Got it.', 20), at('user', 'And a gate', 30)])
  })
})

describe('seedLiveGreeting', () => {
  it('puts the greeting on screen before /voice/session', () => {
    expect(seedLiveGreeting('  Hi, I can help with your fence.  ', 42)).toEqual([
      at('assistant', 'Hi, I can help with your fence.', 42),
    ])
  })
})

describe('dropLinesBefore', () => {
  it('drops lines received before the sync was issued, keeps in-flight ones', () => {
    expect(
      dropLinesBefore(
        [
          at('user', 'Berwick', 100),
          at('assistant', 'How long is the fence?', 200),
          at('user', 'Twenty', 350),
        ],
        300,
      ),
    ).toEqual([at('user', 'Twenty', 350)])
  })

  it('clears the whole overlay when nothing arrived during the request', () => {
    expect(
      dropLinesBefore(
        [at('user', 'Berwick', 100), at('assistant', 'How long is the fence?', 200)],
        300,
      ),
    ).toEqual([])
  })

  it('keeps a line that arrived at the exact issue time', () => {
    expect(dropLinesBefore([at('user', 'Twenty', 300)], 300)).toEqual([at('user', 'Twenty', 300)])
  })

  it('does not compare text — spoke and live wording can diverge', () => {
    // Live heard digits; committed spoke is the same turn in different words. Time decides.
    expect(
      dropLinesBefore([at('assistant', 'Victoria 3 8 1 0', 100)], 200),
    ).toEqual([])
  })
})
