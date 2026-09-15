import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_RESTORE_MS, useAuth } from './useAuth'

const getAuthClient = vi.hoisted(() => vi.fn())
const onAuthStateChanged = vi.hoisted(() => vi.fn())

vi.mock('../services/firebase', () => ({
  getAuthClient: () => getAuthClient(),
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
}))

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAuthClient.mockResolvedValue({ name: 'auth' })
    onAuthStateChanged.mockImplementation((_auth: unknown, callback: (user: null) => void) => {
      callback(null)
      return () => {}
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops blocking the app when Firebase never restores a session', async () => {
    vi.useFakeTimers()
    getAuthClient.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useAuth())
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(AUTH_RESTORE_MS)
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('treats a failed restore as signed out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getAuthClient.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useAuth())

    await vi.waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
  })
})
