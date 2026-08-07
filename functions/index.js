// Hands a signed-in customer over to the partner site without a second verification.
//
// Firebase keeps its session in IndexedDB, which is per-origin: the same project on two hosts
// is still two logged-out browsers. A custom token is the sanctioned way across, and minting one
// needs the Admin SDK — which is the whole reason this function exists. Nothing else here is
// business logic.
//
// The caller proves who it is with its own ID token; this only ever mints a token for the uid
// inside it, so the endpoint cannot be used to become somebody else.
const { onRequest } = require('firebase-functions/v2/https')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

initializeApp()

// Only the AI site may call this. Set in functions/.env, which Firebase reads at deploy time.
// A `*` is allowed in the host, because Vercel mints a new preview domain on every push and
// listing them one by one is not a thing anybody keeps up with.
const ESCAPE_REGEX = /[.+?^${}()|[\]\\]/g

const toOrigin = (value) =>
  // A wildcard stands in for one host label, so https://*.vercel.app matches a preview URL but
  // never something like https://evil.com/?x=.vercel.app
  value.includes('*')
    ? new RegExp('^' + value.replace(ESCAPE_REGEX, '\\$&').replace(/\*/g, '[^.]+') + '$')
    : value

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((entry) => toOrigin(entry.trim()))
  .filter(Boolean)

exports.createHandoff = onRequest({ cors: ALLOWED_ORIGINS, region: 'us-central1' }, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'POST only' })
    return
  }

  const idToken = request.body && request.body.idToken
  if (!idToken) {
    response.status(400).json({ error: 'idToken is required' })
    return
  }

  try {
    // `true` also checks the token has not been revoked — a signed-out or disabled account
    // should not be able to walk through this door.
    const { uid } = await getAuth().verifyIdToken(idToken, true)
    const token = await getAuth().createCustomToken(uid)
    // Valid one hour, meant to be spent once, and it travels in a URL fragment so it never
    // reaches a server log on the way.
    response.json({ token })
  } catch (error) {
    console.error('handoff refused:', error.code || error.message)
    response.status(401).json({ error: 'that session could not be verified' })
  }
})
