import { useEffect, useState } from 'react'
import { getAuthClient } from '../services/firebase'
import { clearLocalQuotes } from '../services/quotes'

export interface SignedInUser {
  uid: string
  /** E.164 with the +, as Firebase stores it. */
  phoneE164: string
  /** Digits only — how every Firestore record keys this customer. */
  phone: string
}

/**
 * Who is signed in, straight from Firebase rather than from whatever the last OTP returned.
 * That distinction is the whole point: the SDK persists the session in IndexedDB by itself, so
 * reading it here is what makes a refresh keep the user logged in.
 *
 * `isLoading` is true until Firebase has restored (or ruled out) a session — rendering "Sign in"
 * during that gap makes an already-logged-in user flicker as though they had been logged out.
 */
export function useAuth() {
  const [user, setUser] = useState<SignedInUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false

    void (async () => {
      const [{ onAuthStateChanged }, auth] = await Promise.all([import('firebase/auth'), getAuthClient()])
      if (cancelled) return
      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        const phoneE164 = firebaseUser?.phoneNumber ?? ''
        setUser(firebaseUser ? { uid: firebaseUser.uid, phoneE164, phone: phoneE164.replace(/\D/g, '') } : null)
        setIsLoading(false)
      })
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return { user, isLoading }
}

/**
 * Signs out and leaves nothing of this customer behind in the browser.
 *
 * The Firebase session is only half of what identifies somebody here — their conversations are
 * cached in localStorage too, and on a shared machine the next person must not find them.
 *
 * The reload is not decoration. Every screen holding a conversation in React state re-saves it
 * the moment `user` flips to null, and that rebuilt object carries no `uid` — so without a hard
 * reset the quote lands straight back in the storage we just cleared, now unowned, ready for the
 * next sign-in to claim. Dropping the whole page is the one way to be sure no stale state
 * survives the boundary between two people.
 */
export async function signOutUser() {
  const [{ signOut }, auth] = await Promise.all([import('firebase/auth'), getAuthClient()])
  await signOut(auth)
  clearLocalQuotes()
  window.location.assign('/')
}
