import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shareTranscriptInChats } from './chat'

// Typed to match the real signature, nulls included, so the failure cases below are honest.
const storeFile = vi.fn<(path: string, blob: Blob, fileName: string) => Promise<string | null>>(
  async (path) => `https://storage/${path}`,
)
vi.mock('./transcript', () => ({ storeFile: (path: string, blob: Blob, fileName: string) => storeFile(path, blob, fileName) }))
vi.mock('./firebase', () => ({ app: { name: 'test' } }))

// Every write is recorded in order, because the order is the contract: the thread's meta has to
// exist before a message may be pushed into it.
const writes: { op: string; path: string; value: unknown }[] = []
const pathOf = (reference: { path: string }) => reference.path

vi.mock('firebase/database', () => ({
  getDatabase: () => ({ db: true }),
  ref: (_db: unknown, path: string) => ({ path }),
  update: async (reference: { path: string }, value: unknown) => {
    writes.push({ op: 'update', path: pathOf(reference), value })
  },
  set: async (reference: { path: string }, value: unknown) => {
    writes.push({ op: 'set', path: pathOf(reference), value })
  },
  push: async (reference: { path: string }, value: unknown) => {
    writes.push({ op: 'push', path: pathOf(reference), value })
  },
}))

const pdf = new Blob(['pdf'], { type: 'application/pdf' })
const summary = {
  generatedAt: 1_754_000_000_000,
  messageCount: 1,
  brief: [{ label: 'Suburb', value: 'Pakenham, VIC 3810' }],
  transcript: [{ role: 'customer' as const, text: 'I need a fence' }],
}
const share = (businesses: { id: string; name: string }[]) =>
  shareTranscriptInChats({ customerUid: 'cust-1', businesses, pdf, summary })

describe('shareTranscriptInChats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writes.length = 0
    storeFile.mockImplementation(async (path) => `https://storage/${path}`)
  })

  it('files the PDF under the thread, the way their own uploader does', async () => {
    await share([{ id: 'biz-1', name: 'Modi Fencing' }])

    const [path] = storeFile.mock.calls[0]
    expect(path).toMatch(/^chats\/cust-1_biz-1\/media\/\d+_ai-conversation\.pdf$/)
  })

  it('writes the thread before the message, because the rules read it first', async () => {
    await share([{ id: 'biz-1', name: 'Modi Fencing' }])

    expect(writes.map((write) => `${write.op} ${write.path}`)).toEqual([
      'update chats/cust-1_biz-1/meta',
      'set userChats/cust-1/cust-1_biz-1',
      'push chats/cust-1_biz-1/messages',
      'update chats/cust-1_biz-1/meta',
    ])
  })

  it('sends the message as the customer, carrying the document', async () => {
    await share([{ id: 'biz-1', name: 'Modi Fencing' }])
    const message = writes.find((write) => write.op === 'push')?.value as Record<string, unknown>

    expect(message).toMatchObject({
      senderId: 'cust-1',
      // Decides which side of the conversation the bubble sits on
      senderType: 'user',
      text: 'AI quote conversation',
      status: 'sent',
      mediaType: 'document',
      fileName: 'ai-conversation.pdf',
      mediaUrl: expect.stringContaining('chats/cust-1_biz-1/media/'),
    })
    expect(typeof message.timestamp).toBe('number')
  })

  it('leaves the inbox preview until there is something to preview', async () => {
    await share([{ id: 'biz-1', name: 'Modi Fencing' }])
    const [first, , , last] = writes

    // The first meta write only identifies the thread; an inbox row with no lastMessage is
    // skipped, so announcing one before the push would list an empty conversation
    expect(first.value).not.toHaveProperty('lastMessage')
    expect(last.value).toMatchObject({ lastMessage: 'AI quote conversation', lastSenderType: 'user' })
  })

  it('merges into a thread that already exists rather than replacing it', async () => {
    await share([{ id: 'biz-1', name: 'Modi Fencing' }])

    // `set` would wipe whatever an ongoing conversation was already carrying
    expect(writes.filter((write) => write.path.endsWith('/meta')).every((write) => write.op === 'update')).toBe(true)
  })

  it('gives every picked business its own thread', async () => {
    await share([
      { id: 'biz-1', name: 'Modi Fencing' },
      { id: 'biz-2', name: 'Hallam Fencing' },
    ])

    expect(writes.filter((write) => write.op === 'push').map((write) => write.path)).toEqual([
      'chats/cust-1_biz-1/messages',
      'chats/cust-1_biz-2/messages',
    ])
  })

  it('posts nothing when the upload failed, rather than a message pointing at nothing', async () => {
    storeFile.mockResolvedValue(null)

    await share([{ id: 'biz-1', name: 'Modi Fencing' }])

    expect(writes).toEqual([])
  })

  it('lets one failed thread not take the others down', async () => {
    storeFile.mockImplementation(async (path) => (path.includes('biz-1') ? null : `https://storage/${path}`))

    await share([
      { id: 'biz-1', name: 'Modi Fencing' },
      { id: 'biz-2', name: 'Hallam Fencing' },
    ])

    expect(writes.filter((write) => write.op === 'push').map((write) => write.path)).toEqual([
      'chats/cust-1_biz-2/messages',
    ])
  })

  it('does nothing at all when nobody was picked', async () => {
    await share([])

    expect(storeFile).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
