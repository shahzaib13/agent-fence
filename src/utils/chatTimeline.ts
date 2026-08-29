import type { ChatMessage } from '../components/ChatWindow'

/** Chronological order for typed bubbles and voice turns sharing one thread. */
export function sortMessagesByTime(messages: ChatMessage[], sessionStartMs: number): ChatMessage[] {
  return [...messages]
    .map((message, index) => ({
      message,
      order: message.createdAt ?? sessionStartMs + index,
    }))
    .sort((left, right) => left.order - right.order)
    .map(({ message }) => message)
}

export function withCreatedAt(message: ChatMessage, createdAt = Date.now()): ChatMessage {
  return message.createdAt ? message : { ...message, createdAt }
}
