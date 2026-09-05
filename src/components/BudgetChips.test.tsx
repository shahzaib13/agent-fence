import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AnswerSource } from '../services/fencingChat'
import { BudgetChips } from './BudgetChips'

const hipages: AnswerSource = {
  name: 'hipages',
  figure: '$85 to $100 a metre installed',
  perMetreMin: 85,
  perMetreMax: 100,
  budgetValue: 'budget:85-100:hipages',
  url: null,
}

const advice: AnswerSource = {
  name: 'Airtasker',
  figure: 'it depends on the job',
  budgetValue: null,
}

describe('BudgetChips', () => {
  it('asks which figure is closest to budget, not which provider to hire', () => {
    render(<BudgetChips sources={[hipages, advice]} onSelect={vi.fn()} />)

    expect(screen.getByText('Which of these is closest to your budget?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /hipages, \$85 to \$100 a metre installed/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /airtasker/i })).not.toBeInTheDocument()
  })

  it('sends the source on tap, not an option value', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<BudgetChips sources={[hipages]} onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: /hipages/i }))
    expect(onSelect).toHaveBeenCalledWith(hipages)
  })

  it('collapses to the picked figure once chosen', () => {
    render(<BudgetChips sources={[hipages]} picked={hipages} onSelect={vi.fn()} />)

    expect(screen.getByText('Closest to your budget')).toBeInTheDocument()
    expect(screen.getByText('hipages')).toBeInTheDocument()
    expect(screen.getByText(/\$85 to \$100 a metre installed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hipages/i })).not.toBeInTheDocument()
  })
})
