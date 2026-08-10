import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('render exploded')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs every caught error itself, and the boundary logs it again. Both are expected
    // here — silencing them keeps a passing test from looking like a failing one.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays out of the way when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>the app</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('the app')).toBeInTheDocument()
  })

  it('shows a way out instead of a blank page when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    // Both exits matter: reload is the recovery, the link is the escape if reloading keeps failing.
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a new quote/i })).toHaveAttribute('href', '/')
  })

  it('renders its fallback without needing the router or an auth session', () => {
    // The point of the boundary is that it survives whatever took the app down — so it must not
    // reach for context that may be exactly what broke. No <MemoryRouter> here on purpose: if
    // the fallback ever grows a <Link>, this test fails.
    expect(() =>
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow()
  })
})
