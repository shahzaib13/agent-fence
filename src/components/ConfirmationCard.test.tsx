import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmationCard } from './ConfirmationCard'

const checklist = { suburb: 'Pakenham', fenceType: 'Pool Fencing', lengthMeters: 15 }
const options = [
  { label: "Yes, that's all correct", value: 'yes' },
  { label: "No, something's wrong", value: 'no' },
]

describe('ConfirmationCard', () => {
  it('shows the recap message and the checklist as a bullet list', () => {
    render(<ConfirmationCard message="From your data, is this correct?" checklist={checklist} options={options} onSelectOption={() => {}} />)

    expect(screen.getByText('From your data, is this correct?')).toBeInTheDocument()
    expect(screen.getByText('Suburb: Pakenham')).toBeInTheDocument()
    expect(screen.getByText('Fence type: Pool Fencing')).toBeInTheDocument()
  })

  it('calls onSelectOption with the clicked option', async () => {
    const user = userEvent.setup()
    const onSelectOption = vi.fn()
    render(<ConfirmationCard message="Correct?" checklist={checklist} options={options} onSelectOption={onSelectOption} />)

    await user.click(screen.getByRole('button', { name: /yes, that's all correct/i }))

    expect(onSelectOption).toHaveBeenCalledWith(options[0])
  })
})
