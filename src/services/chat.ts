// Dropping the AI conversation into each business's chat with the customer.
//
// That chat lives in the Realtime Database, not Firestore, and its UI renders attachments from
// message records only — a file sitting in Storage shows up nowhere on its own. So each thread
// needs three things written, in this order, because the database rules expect the thread's
// meta to exist before a message may be pushed into it.
//
// Everything here is best-effort. The job and the customer are already saved by the time this
// runs; a chat message that fails to post is worth a console error, not a lost lead.
import { compactAiSummary, type AiSummary, type AiSummaryQuote } from './aiSummary'
import { storeFile } from './transcript'

const FILE_NAME = 'ai-conversation.pdf'
const PREVIEW = 'AI quote conversation'

export interface ChatBusiness {
  /** Firebase Auth uid of the business — the second half of the thread id. */
  id: string
  name: string
  quote?: AiSummaryQuote
}

/** Their convention, and the customer's own uid is the first half so the rules recognise them. */
const threadId = (customerUid: string, businessUid: string) => `${customerUid}_${businessUid}`

/**
 * Posts the transcript into every business the customer picked. Each business has its own
 * thread, so each gets its own copy — they cannot see one another.
 */
export async function shareTranscriptInChats({
  customerUid,
  businesses,
  pdf,
  summary,
}: {
  customerUid: string
  businesses: ChatBusiness[]
  pdf: Blob
  summary: Omit<AiSummary, 'quote'>
}): Promise<void> {
  if (businesses.length === 0) return

  const [{ getDatabase, ref, push, set, update }, { app }] = await Promise.all([
    import('firebase/database'),
    import('./firebase'),
  ])
  const db = getDatabase(app)

  await Promise.all(
    businesses.map(async (business) => {
      const chatId = threadId(customerUid, business.id)
      // Their own uploader stamps the time into the name, and keeps chat media under the
      // thread. Following that means this file lives wherever their chat media lives, rather
      // than somewhere only this integration knows about.
      const sentAt = Date.now()
      const mediaUrl = await storeFile(`chats/${chatId}/media/${sentAt}_${FILE_NAME}`, pdf, FILE_NAME)
      if (!mediaUrl) return

      try {
        // 1. The thread first — the rules read `meta.userId` / `meta.businessId` when deciding
        //    whether a message may be written. `update` rather than `set`, so an existing
        //    conversation keeps whatever else it is carrying.
        await update(ref(db, `chats/${chatId}/meta`), {
          userId: customerUid,
          businessId: business.id,
          businessName: business.name,
          updatedAt: sentAt,
        })

        // 2. The customer's index of their own conversations. Without it the thread is
        //    unreachable from their inbox.
        await set(ref(db, `userChats/${customerUid}/${chatId}`), true)

        // 3. The message itself. `senderType` decides which side of the conversation the bubble
        //    sits on, and this is the customer handing over their own brief.
        await push(ref(db, `chats/${chatId}/messages`), {
          senderId: customerUid,
          senderType: 'user',
          text: PREVIEW,
          timestamp: sentAt,
          status: 'sent',
          mediaUrl,
          mediaType: 'document',
          fileName: FILE_NAME,
          aiSummary: compactAiSummary({
            ...summary,
            ...(business.quote ? { quote: business.quote } : {}),
          }),
        })

        // 4. The preview last, once there is really something to preview. An inbox row with no
        //    `lastMessage` is skipped entirely, so writing this too early would list a
        //    conversation that turned out to be empty.
        await update(ref(db, `chats/${chatId}/meta`), {
          lastMessage: PREVIEW,
          lastMessageAt: sentAt,
          lastSenderType: 'user',
        })
      } catch (error) {
        console.error(`Could not post the transcript into the chat with ${business.name}:`, error)
      }
    }),
  )
}
