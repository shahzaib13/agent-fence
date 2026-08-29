import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../components/ChatWindow'
import { sortMessagesByTime, withCreatedAt } from './chatTimeline'

describe('sortMessagesByTime', () => {
  it('orders by createdAt across typed and voice bubbles', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', text: 'Hi', createdAt: 100 },
      { id: '2', role: 'ai', text: 'Voice reply', createdAt: 300 },
      { id: '3', role: 'user', text: 'Typed later', createdAt: 200 },
    ]
    expect(sortMessagesByTime(messages, 0).map((message) => message.id)).toEqual(['1', '3', '2'])
  })

  it('falls back to session start plus index when createdAt is missing', () => {
    const messages: ChatMessage[] = [
      { id: 'a', role: 'user', text: 'First' },
      { id: 'b', role: 'ai', text: 'Second', createdAt: 50 },
    ]
    expect(sortMessagesByTime(messages, 10).map((message) => message.id)).toEqual(['a', 'b'])
  })
})

describe('withCreatedAt', () => {
  it('adds a timestamp when absent', () => {
    const message = withCreatedAt({ id: '1', role: 'user', text: 'Hi' }, 123)
    expect(message.createdAt).toBe(123)
  })

  it('keeps an existing timestamp', () => {
    const message = withCreatedAt({ id: '1', role: 'user', text: 'Hi', createdAt: 99 }, 123)
    expect(message.createdAt).toBe(99)
  })
})
