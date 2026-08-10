// These ids are not just React keys — a session id becomes the Firestore document id
// (`quotes/{sessionId}`) and the Storage path of the conversation PDF
// (`transcripts/{sessionId}.pdf`). Anything guessable there is an enumerable transcript, so this
// uses the platform CSPRNG rather than `Math.random()`, whose ~31 bits are also reconstructable
// from observed output.
export function generateId() {
  return crypto.randomUUID()
}
