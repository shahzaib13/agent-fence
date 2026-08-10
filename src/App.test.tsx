import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('routing', () => {
  it('shows a 404 page for a URL that matches no route', async () => {
    // vercel.json rewrites every path to index.html, so this is exactly what a mistyped URL, a
    // stale link or a crawler reaches: the app boots and matches nothing. Without the catch-all
    // route that rendered an empty document — no header, no way back, nothing to read.
    window.history.pushState({}, '', '/not-a-real-page')

    render(<App />)

    expect(await screen.findByRole('heading', { name: /this page doesn't exist/i })).toBeInTheDocument()
  })

  it('does not let the catch-all swallow a real route', async () => {
    window.history.pushState({}, '', '/')

    render(<App />)

    expect(await screen.findByRole('heading', { name: /describe your construction project/i })).toBeInTheDocument()
  })
})
