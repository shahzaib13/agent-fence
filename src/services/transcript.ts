// The conversation, as a PDF the tradie can open next to the job. This site's part of the
// handover ends here: it produces the artefact and puts a link on the job. How the other site
// surfaces it — a link in the job header, a first message in the chat — is that site's call,
// and keeping it that way means their chat can change without breaking anything here.
//
// Both the PDF library and Firebase Storage load on demand: a customer who never posts a job
// should not download either.
import { checklistFieldLabel, formatChecklistValue } from '../utils/checklist'
import type { QuoteSession } from './quotes'

const PAGE = { width: 595, height: 842 } // A4 at 72dpi, the unit jsPDF uses by default
const MARGIN = 56
const LINE = 15
const INK = '#062D27'
const MUTED = '#6B7280'

/** Where a session's transcript lives. Keyed by session, so it exists before the job does. */
const storagePath = (sessionId: string) => `transcripts/${sessionId}.pdf`

function buildPdf(session: QuoteSession, jsPDF: typeof import('jspdf').jsPDF) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const width = PAGE.width - MARGIN * 2
  let y = MARGIN

  const room = (needed: number) => {
    if (y + needed <= PAGE.height - MARGIN) return
    doc.addPage()
    y = MARGIN
  }

  const write = (text: string, { size = 10, color = INK, bold = false, indent = 0, gap = 0 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color)
    for (const line of doc.splitTextToSize(text, width - indent) as string[]) {
      room(LINE)
      doc.text(line, MARGIN + indent, y)
      y += LINE
    }
    y += gap
  }

  write('AI quote conversation', { size: 18, bold: true })
  write(
    `${new Date(session.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}` +
      `  ·  ${session.messages.length} messages`,
    { size: 9, color: MUTED, gap: 14 },
  )

  // The brief first: it is what a tradie actually needs, and burying it under a dozen turns of
  // small talk would mean nobody reads it.
  if (session.checklist) {
    write('The brief', { size: 12, bold: true, gap: 4 })
    for (const [field, value] of Object.entries(session.checklist)) {
      if (value === null || value === undefined || value === '') continue
      write(`${checklistFieldLabel(field)}: ${formatChecklistValue(field, value)}`, { size: 10, indent: 10 })
    }
    y += 14
  }

  write('The conversation', { size: 12, bold: true, gap: 6 })
  for (const message of session.messages) {
    const isCustomer = message.role === 'user'
    write(isCustomer ? 'Customer' : 'Assistant', { size: 8, bold: true, color: isCustomer ? INK : MUTED })
    write(message.text, { size: 10, indent: 10, gap: 4 })
    // A tapped option is an answer too — without it the thread reads as unanswered questions.
    if (message.answered) write(`↳ picked: ${message.answered.label}`, { size: 9, color: MUTED, indent: 10, gap: 4 })
  }

  return doc.output('blob') as Blob
}

/**
 * Renders the conversation and stores it. Returns a download URL, or null if either half fails —
 * the caller must treat this as optional, because a missing PDF is worth far less than a lost
 * lead, and the lead is written in the same breath.
 */
export async function uploadTranscript(session: QuoteSession): Promise<string | null> {
  try {
    const [{ jsPDF }, { getDownloadURL, getStorage, ref, uploadBytes }, { app }] = await Promise.all([
      import('jspdf'),
      import('firebase/storage'),
      import('./firebase'),
    ])

    const blob = buildPdf(session, jsPDF)
    const fileRef = ref(getStorage(app), storagePath(session.sessionId))
    await uploadBytes(fileRef, blob, {
      contentType: 'application/pdf',
      // Named so a download lands as something recognisable rather than a uuid.
      contentDisposition: `inline; filename="ai-conversation-${session.sessionId}.pdf"`,
    })
    return await getDownloadURL(fileRef)
  } catch (error) {
    console.error('Could not attach the AI conversation to this job:', error)
    return null
  }
}
