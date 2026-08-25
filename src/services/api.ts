import axios from 'axios'

// Deliberately bare. There used to be a pair of interceptors here that read a bearer token out
// of `localStorage.authToken` and attached it to every request — including the cross-origin POST
// to the fencing chat API. Nothing ever wrote that key, so it never fired, but it was a loaded
// path: the day somebody started using it, the token would have shipped off on every chat turn.
//
// Real authentication here is Firebase, which keeps its session in IndexedDB and rotates it
// itself. Nothing in this app should be putting credentials in localStorage. If a request ever
// does need an identity, send the Firebase ID token on that call — do not add it globally here.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 10_000,
})
