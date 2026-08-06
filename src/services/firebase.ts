import { initializeApp } from 'firebase/app'

// This config is public on purpose and is safe in source control: it identifies the project,
// it does not authorise anything. A Firebase web app's security comes from Firestore Security
// Rules and App Check, never from hiding these values — Google's own quickstart ships them in
// the page. Keeping them here rather than in .env means a fresh clone runs without setup.
const firebaseConfig = {
  apiKey: 'AIzaSyBK5IjnsBrZ3Ud3RRxqa6lY0OYDw6D_Als',
  authDomain: 'quotemy-ai.firebaseapp.com',
  databaseURL: 'https://quotemy-ai-default-rtdb.firebaseio.com',
  projectId: 'quotemy-ai',
  storageBucket: 'quotemy-ai.firebasestorage.app',
  messagingSenderId: '795078746989',
  appId: '1:795078746989:web:7cabde1ec17ec3d5997064',
  measurementId: 'G-7CS1VYF495',
}

// Analytics is deliberately left out: nothing in the app reads it, it pulls another chunk into
// the bundle, and it drops cookies — which is a consent decision, not a setup step. Add
// `getAnalytics(app)` here when someone actually wants the numbers.
export const app = initializeApp(firebaseConfig)

// Auth and Firestore are ~145 kB gzipped between them — more than this entire app was before
// Firebase arrived — and the landing page needs neither. Both load on first use instead of
// with the page. Every caller is already async (they're doing network work anyway), so the
// import costs nothing a fetch wasn't already going to cost.
export async function getAuthClient() {
  const { getAuth } = await import('firebase/auth')
  return getAuth(app)
}

export async function getDb() {
  const { getFirestore } = await import('firebase/firestore')
  return getFirestore(app)
}
