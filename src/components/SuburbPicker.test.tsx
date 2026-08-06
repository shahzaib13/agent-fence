import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSuburbPlace, searchSuburbs, type SuburbPlace } from '../services/places'
import { SuburbPicker } from './SuburbPicker'

vi.mock('../services/places', () => ({
  newSessionToken: () => 'token-1',
  searchSuburbs: vi.fn(),
  fetchSuburbPlace: vi.fn(),
}))

const suggestions = [
  { placeId: 'place-1', primaryText: 'Pakenham', secondaryText: 'VIC, Australia' },
  { placeId: 'place-2', primaryText: 'Pakenham Upper', secondaryText: 'VIC, Australia' },
]

const pakenham: SuburbPlace = {
  suburb: 'Pakenham',
  state: 'VIC',
  stateFullName: 'Victoria',
  postcode: '3810',
  country: 'AU',
  countryName: 'Australia',
  displayLabel: 'Pakenham, VIC 3810',
  formattedAddress: 'Pakenham VIC 3810',
  latitude: -38.0776708,
  longitude: 145.4818724,
  placeId: 'place-1',
  placeTypes: ['locality', 'political'],
  name: 'Pakenham',
}

describe('SuburbPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(searchSuburbs).mockResolvedValue(suggestions)
    vi.mocked(fetchSuburbPlace).mockResolvedValue(pakenham)
  })

  it('searches once the query is long enough and lists what Google returned', async () => {
    const user = userEvent.setup()
    render(<SuburbPicker onSelect={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'pa')
    await waitFor(() => expect(searchSuburbs).not.toHaveBeenCalled())

    await user.type(screen.getByRole('combobox'), 'kan')
    expect(await screen.findByRole('option', { name: /pakenham vic, australia/i })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    // One request for the whole burst of typing, not one per keystroke
    expect(searchSuburbs).toHaveBeenCalledTimes(1)
    expect(searchSuburbs).toHaveBeenCalledWith('pakan', 'token-1')
  })

  it('resolves the picked suggestion to a full place and shows its label', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<SuburbPicker onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'pakan')
    await user.click(await screen.findByRole('option', { name: /^pakenham vic, australia/i }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(pakenham))
    expect(fetchSuburbPlace).toHaveBeenCalledWith('place-1', 'token-1')
    expect(screen.getByRole('combobox')).toHaveValue('Pakenham, VIC 3810')
    // Picking must not kick off a fresh search for the label it just filled in
    expect(searchSuburbs).toHaveBeenCalledTimes(1)
  })

  it('can be driven from the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<SuburbPicker onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'pakan')
    await screen.findAllByRole('option')

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(fetchSuburbPlace).toHaveBeenCalledWith('place-2', 'token-1'))
  })

  it('opens straight onto suggestions it was seeded with, without searching again', async () => {
    render(<SuburbPicker initialQuery="pakan" initialSuggestions={suggestions} sessionToken="seeded" onSelect={vi.fn()} />)

    expect(await screen.findByRole('option', { name: /^pakenham vic, australia/i })).toBeInTheDocument()
    expect(searchSuburbs).not.toHaveBeenCalled()

    // The details call joins the session the seeded search already opened
    await userEvent.setup().click(screen.getByRole('option', { name: /^pakenham vic, australia/i }))
    await waitFor(() => expect(fetchSuburbPlace).toHaveBeenCalledWith('place-1', 'seeded'))
  })

  it('says so when nothing in Australia matches', async () => {
    vi.mocked(searchSuburbs).mockResolvedValue([])
    const user = userEvent.setup()
    render(<SuburbPicker onSelect={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'zzzzz')
    expect(await screen.findByText(/no australian suburb matches that/i)).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('surfaces a failed search instead of looking like an empty result', async () => {
    vi.mocked(searchSuburbs).mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    render(<SuburbPicker onSelect={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'pakan')
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't responding/i)
  })

  it('keeps the answer unset when the details lookup fails', async () => {
    vi.mocked(fetchSuburbPlace).mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<SuburbPicker onSelect={onSelect} />)

    await user.type(screen.getByRole('combobox'), 'pakan')
    await user.click(await screen.findByRole('option', { name: /^pakenham vic, australia/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/pick it again/i)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
