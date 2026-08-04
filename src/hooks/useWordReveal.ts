import { useEffect, useState } from 'react'

const WORDS_PER_TICK = 2
const TICK_MS = 45

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

// How many of `total` words should be visible right now, stepping up on a timer so a reply
// lands the way a streamed one does instead of snapping in whole.
//
// The caller still renders *every* word — only the not-yet-revealed ones are transparent —
// so assistive tech and tests read the complete message from the first frame, and the
// bubble is already its final size before the first word appears.
export function useWordReveal(total: number, enabled: boolean) {
  const [revealed, setRevealed] = useState(enabled ? 0 : total)

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      setRevealed(total)
      return
    }
    setRevealed(0)
    const timer = setInterval(() => {
      setRevealed((count) => {
        if (count >= total) {
          clearInterval(timer)
          return count
        }
        return Math.min(total, count + WORDS_PER_TICK)
      })
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [total, enabled])

  return revealed
}
