import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSuburbPlace, isPlacesConfigured, searchSuburbs } from './places'

// Stands in for the Maps SDK the service loads from Google. Same object for every test, because
// the module caches whatever it resolved the first time — as the real page does too.
const getPlacePredictions = vi.fn()
const getDetails = vi.fn()

const placesLibrary = {
  AutocompleteService: class {
    getPlacePredictions = getPlacePredictions
  },
  PlacesService: class {
    getDetails = getDetails
  },
  AutocompleteSessionToken: class {},
  PlacesServiceStatus: { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS', REQUEST_DENIED: 'REQUEST_DENIED' },
}

vi.stubGlobal('google', { maps: { places: placesLibrary } })

const prediction = (id: string, main: string) => ({
  place_id: id,
  description: `${main} VIC, Australia`,
  structured_formatting: { main_text: main, secondary_text: 'VIC, Australia' },
})

const pakenhamDetails = {
  place_id: 'ChIJxUv0xoYb1moRsOCMIXVWBAU',
  name: 'Pakenham',
  types: ['locality', 'political'],
  formatted_address: 'Pakenham VIC 3810, Australia',
  geometry: { location: { lat: () => -38.0776708, lng: () => 145.4818724 } },
  address_components: [
    { long_name: 'Pakenham', short_name: 'Pakenham', types: ['locality', 'political'] },
    { long_name: 'Victoria', short_name: 'VIC', types: ['administrative_area_level_1', 'political'] },
    { long_name: 'Australia', short_name: 'AU', types: ['country', 'political'] },
    { long_name: '3810', short_name: '3810', types: ['postal_code'] },
  ],
}

const respondWithDetails = (details: unknown, status = 'OK') =>
  getDetails.mockImplementation((_request, callback) => callback(details, status))

const respondWithPredictions = (predictions: unknown[], status = 'OK') =>
  getPlacePredictions.mockImplementation((_request, callback) => callback(predictions, status))

describe('places', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('reports whether a key is configured', () => {
    expect(isPlacesConfigured()).toBe(true)
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    expect(isPlacesConfigured()).toBe(false)
  })

  describe('searchSuburbs', () => {
    it('restricts the search to Australian regions and maps the predictions', async () => {
      respondWithPredictions([prediction('place-1', 'Pakenham')])

      const results = await searchSuburbs('pakenh', 'session-1')

      expect(results).toEqual([{ placeId: 'place-1', primaryText: 'Pakenham', secondaryText: 'VIC, Australia' }])
      expect(getPlacePredictions.mock.calls[0][0]).toMatchObject({
        input: 'pakenh',
        componentRestrictions: { country: 'au' },
        // A suburb name and a bare postcode both have to match, and `(regions)` is the one
        // filter that does both.
        types: ['(regions)'],
      })
    })

    it('spends the same session token on every keystroke of one lookup', async () => {
      respondWithPredictions([], 'ZERO_RESULTS')

      await searchSuburbs('pakenh', 'session-1')
      await searchSuburbs('pakenha', 'session-1')

      const [first, second] = getPlacePredictions.mock.calls
      expect(first[0].sessionToken).toBe(second[0].sessionToken)
      expect(first[0].sessionToken).toBeInstanceOf(placesLibrary.AutocompleteSessionToken)
    })

    it('falls back to the full description when Google sends no structured format', async () => {
      respondWithPredictions([{ place_id: 'place-2', description: 'Berwick VIC, Australia' }])

      expect(await searchSuburbs('berwick', 'session-1')).toEqual([
        { placeId: 'place-2', primaryText: 'Berwick VIC, Australia', secondaryText: '' },
      ])
    })

    it('treats no matches as an empty list, but a real fault as an error', async () => {
      respondWithPredictions([], 'ZERO_RESULTS')
      expect(await searchSuburbs('zzzzzz', 'session-1')).toEqual([])

      respondWithPredictions([], 'REQUEST_DENIED')
      await expect(searchSuburbs('pakenh', 'session-1')).rejects.toThrow(/REQUEST_DENIED/)
    })

    it('gives up instead of spinning forever when the SDK never calls back', async () => {
      // What a rejected key actually looks like: the script is served, so `onerror` never
      // fires, and Google simply never runs the callback. Only a timeout ends this.
      vi.resetModules()
      vi.stubGlobal('google', undefined)
      vi.useFakeTimers()
      try {
        const fresh = await import('./places')
        // Asserted before the clock moves, so the rejection is never momentarily unhandled.
        const settled = expect(fresh.searchSuburbs('pakenh', 'session-timeout')).rejects.toThrow(
          /did not finish loading/i,
        )
        await vi.advanceTimersByTimeAsync(10_000)
        await settled
      } finally {
        vi.useRealTimers()
        vi.stubGlobal('google', { maps: { places: placesLibrary } })
        vi.resetModules()
      }
    })

    it('spends no request on a query too short to mean anything, or without a key', async () => {
      expect(await searchSuburbs('pa', 'session-1')).toEqual([])
      expect(await searchSuburbs('   ', 'session-1')).toEqual([])
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
      expect(await searchSuburbs('pakenham', 'session-1')).toEqual([])
      expect(getPlacePredictions).not.toHaveBeenCalled()
    })
  })

  describe('fetchSuburbPlace', () => {
    it('builds the full record the signup schema expects', async () => {
      respondWithDetails(pakenhamDetails)

      expect(await fetchSuburbPlace('place-1', 'session-1')).toEqual({
        suburb: 'Pakenham',
        state: 'VIC',
        stateFullName: 'Victoria',
        postcode: '3810',
        country: 'AU',
        countryName: 'Australia',
        displayLabel: 'Pakenham, VIC 3810',
        // The country is never in doubt for an AU-only search, and the signup records drop it too
        formattedAddress: 'Pakenham VIC 3810',
        latitude: -38.0776708,
        longitude: 145.4818724,
        placeId: 'ChIJxUv0xoYb1moRsOCMIXVWBAU',
        placeTypes: ['locality', 'political'],
        name: 'Pakenham',
      })
    })

    it('asks only for the fields it maps, inside the same session as the search', async () => {
      respondWithPredictions([], 'ZERO_RESULTS')
      respondWithDetails(pakenhamDetails)

      await searchSuburbs('pakenh', 'session-2')
      await fetchSuburbPlace('place-1', 'session-2')

      expect(getDetails.mock.calls[0][0]).toMatchObject({
        placeId: 'place-1',
        fields: ['place_id', 'name', 'types', 'formatted_address', 'geometry', 'address_components'],
        sessionToken: getPlacePredictions.mock.calls[0][0].sessionToken,
      })
    })

    it('starts a new session once a lookup has been paid for', async () => {
      respondWithPredictions([], 'ZERO_RESULTS')
      respondWithDetails(pakenhamDetails)

      await searchSuburbs('pakenh', 'session-3')
      await fetchSuburbPlace('place-1', 'session-3')
      await searchSuburbs('berwi', 'session-3')

      const [firstSearch, secondSearch] = getPlacePredictions.mock.calls
      expect(secondSearch[0].sessionToken).not.toBe(firstSearch[0].sessionToken)
    })

    it('drops the postcode from the label rather than printing a gap when Google has none', async () => {
      respondWithDetails({
        ...pakenhamDetails,
        address_components: pakenhamDetails.address_components.filter((c) => !c.types.includes('postal_code')),
      })

      const place = await fetchSuburbPlace('place-1', 'session-1')
      expect(place.postcode).toBe('')
      expect(place.displayLabel).toBe('Pakenham, VIC')
    })

    it('falls back to the sublocality, then the display name, for the suburb', async () => {
      respondWithDetails({
        ...pakenhamDetails,
        address_components: [
          { long_name: 'Pakenham', short_name: 'Pakenham', types: ['sublocality', 'political'] },
          { long_name: 'Victoria', short_name: 'VIC', types: ['administrative_area_level_1'] },
        ],
      })
      expect((await fetchSuburbPlace('place-1', 'session-1')).suburb).toBe('Pakenham')

      respondWithDetails({ ...pakenhamDetails, address_components: [] })
      expect((await fetchSuburbPlace('place-1', 'session-1')).suburb).toBe('Pakenham')
    })

    it('surfaces a failed lookup instead of returning a half-empty place', async () => {
      respondWithDetails(null, 'REQUEST_DENIED')
      await expect(fetchSuburbPlace('place-1', 'session-1')).rejects.toThrow(/REQUEST_DENIED/)
    })

    it('refuses to call Google without a key', async () => {
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
      await expect(fetchSuburbPlace('place-1', 'session-1')).rejects.toThrow(/not configured/i)
      expect(getDetails).not.toHaveBeenCalled()
    })
  })
})
