import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmationCard } from './ConfirmationCard'

const checklistAnswered = [
  { key: 'suburb', title: 'Suburb', value: 'Pakenham' },
  { key: 'fenceType', title: 'Fence type', value: 'Pool Fencing' },
]
const options = [
  { label: "Yes, that's all correct", value: 'yes' },
  { label: "No, something's wrong", value: 'no' },
]

describe('ConfirmationCard', () => {
  it('renders a kitchen brief from checklistAnswered without fencing field names', () => {
    render(
      <ConfirmationCard
        checklistAnswered={[
          { key: 'suburb', title: 'Suburb', value: 'Berwick' },
          { key: 'jobType', title: 'Job', value: 'New kitchen' },
          { key: 'kitchenSize', title: 'Kitchen size', value: 'Medium' },
          { key: 'supply', title: 'Who supplies', value: 'You supply cabinets' },
          { key: 'benchtop', title: 'Benchtop', value: 'Caesarstone' },
        ]}
        options={options}
        onSelectOption={() => {}}
      />,
    )

    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Kitchen size: Medium')).toBeInTheDocument()
    expect(screen.getByText('Benchtop: Caesarstone')).toBeInTheDocument()
    expect(screen.queryByText(/material/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/length/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/height/i)).not.toBeInTheDocument()
  })

  it('shows the collected brief from checklistAnswered', () => {
    render(<ConfirmationCard checklistAnswered={checklistAnswered} options={options} onSelectOption={() => {}} />)

    expect(screen.getByText('Suburb: Pakenham')).toBeInTheDocument()
    expect(screen.getByText('Fence type: Pool Fencing')).toBeInTheDocument()
  })

  it('calls onSelectOption with the clicked option', async () => {
    const user = userEvent.setup()
    const onSelectOption = vi.fn()
    render(<ConfirmationCard checklistAnswered={checklistAnswered} options={options} onSelectOption={onSelectOption} />)

    await user.click(screen.getByRole('button', { name: /yes, that's all correct/i }))

    expect(onSelectOption).toHaveBeenCalledWith(options[0])
  })

  it('collapses to just the chosen answer once answered', () => {
    render(
      <ConfirmationCard
        checklistAnswered={checklistAnswered}
        options={options}
        answered={options[0]}
        onSelectOption={() => {}}
      />,
    )

    expect(screen.getByText("Yes, that's all correct")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /no, something's wrong/i })).not.toBeInTheDocument()
  })
})
