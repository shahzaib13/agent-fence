import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AlternativeOffers } from './AlternativeOffers'

const alternatives = [
  {
    material: 'colorbond',
    materialLabel: 'Colorbond',
    heightKey: '1.8m',
    businessName: 'Southeast Fencing & Gates',
    estimatedTotal: 2200,
    value: 'alt:colorbond:1.8m',
  },
]

const options = [
  { label: 'Colorbond, 1.8m · $2,200', value: 'alt:colorbond:1.8m' },
  { label: "No thanks, I'll change something", value: 'no' },
]

describe('AlternativeOffers', () => {
  it('renders a priced card and leftover options, sending the alt value on tap', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<AlternativeOffers alternatives={alternatives} options={options} onSelect={onSelect} />)

    expect(screen.getByText('Colorbond, 1.8m')).toBeInTheDocument()
    expect(screen.getByText('$2,200')).toBeInTheDocument()
    expect(screen.getByText('Southeast Fencing & Gates')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: /no thanks/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /colorbond, 1\.8m/i }))
    expect(onSelect).toHaveBeenCalledWith({ label: 'Colorbond, 1.8m', value: 'alt:colorbond:1.8m' })
  })
})
