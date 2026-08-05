import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/dom'

// ThinkingScreen's card-by-card reveal holds each response for a real, deliberate delay (see
// Home.tsx's REVEAL_BUFFER_MS/MIN_HOLD_MS) — worth more than the default 1000ms `waitFor` ceiling
// so a genuinely-passing async assertion doesn't get flagged as a timeout.
configure({ asyncUtilTimeout: 3000 })

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
