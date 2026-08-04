import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWordReveal } from './useWordReveal'

afterEach(() => {
  vi.useRealTimers()
})

describe('useWordReveal', () => {
  it('shows everything at once when the reveal is off (history messages)', () => {
    const { result } = renderHook(() => useWordReveal(8, false))

    expect(result.current).toBe(8)
  })

  it('steps up over time and stops at the total', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWordReveal(5, true))

    expect(result.current).toBe(0)

    act(() => {
      vi.advanceTimersByTime(45)
    })
    expect(result.current).toBe(2)

    act(() => {
      vi.advanceTimersByTime(45 * 10)
    })
    expect(result.current).toBe(5)
  })

  it('restarts from nothing when the message it is revealing changes length', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ total }) => useWordReveal(total, true), {
      initialProps: { total: 4 },
    })

    act(() => {
      vi.advanceTimersByTime(45 * 5)
    })
    expect(result.current).toBe(4)

    rerender({ total: 9 })
    expect(result.current).toBe(0)
  })
})
