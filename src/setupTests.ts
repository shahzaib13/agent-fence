import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/dom'

// ThinkingScreen's card-by-card reveal holds each response for a real, deliberate delay (see
// Home.tsx's REVEAL_BUFFER_MS/MIN_HOLD_MS) — worth more than the default 1000ms `waitFor` ceiling
// so a genuinely-passing async assertion doesn't get flagged as a timeout.
configure({ asyncUtilTimeout: 3000 })
