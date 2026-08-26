import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/dom'

// ThinkingScreen's card-by-card reveal holds each response for a real, deliberate delay (see
// Home.tsx's REVEAL_BUFFER_MS/MIN_HOLD_MS) — worth more than the default 1000ms `waitFor` ceiling
// so a genuinely-passing async assertion doesn't get flagged as a timeout.
configure({ asyncUtilTimeout: 3000 })

// Node may start with `--localstorage-file` and a broken Storage (no `clear`). Quotes tests
// need a complete web-storage surface; restore one when the host's is unusable.
if (typeof globalThis.localStorage?.clear !== 'function') {
  const store = new Map<string, string>()
  const localStorage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage })
}

// jsdom still ships <dialog> without showModal/close (browsers have had both for years), so
// anything rendering a native modal dialog throws on mount. Shim the open/close pair —
// there's no top layer or focus trap to emulate here, only the `open` state and the event
// the component listens for.
const dialogPrototype = window.HTMLDialogElement?.prototype
if (dialogPrototype && !dialogPrototype.showModal) {
  dialogPrototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  dialogPrototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
