// Google Places through the Maps JavaScript SDK, not the REST endpoints. The choice isn't
// stylistic: the legacy Places web service (maps.googleapis.com/maps/api/place/*) sends no CORS
// headers, so a browser can never call it directly — the SDK is how Google intends web clients
// to reach it. Places API (New) does allow direct REST, but it's a separate API that has to be
// enabled on the Cloud project; this one is already on, since the Flutter app uses it.
//
// The SDK <script> is fetched on first use, not at page load: nobody who never reaches the
// suburb question should pay for Google's bundle.

// Suburbs and postcodes, never businesses or street addresses. `(regions)` is the only filter
// that covers both — verified against the live API: `(cities)` drops postcode searches ("3810"
// returns nothing), and no filter at all lets shops through ("JB Hi-Fi Pakenham").
const SUBURB_TYPES = ['(regions)']
const REGION = 'au'
const DETAIL_FIELDS = ['place_id', 'name', 'types', 'formatted_address', 'geometry', 'address_components']

// Global the SDK calls once every requested library is ready.
const SDK_CALLBACK = '__onGooglePlacesReady'
const SDK_TIMEOUT_MS = 10_000

// Read per call rather than at import time, so tests can stub the env and so a missing key
// degrades to plain typing instead of throwing on module load.
const apiKey = () => import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export const isPlacesConfigured = () => !!apiKey()

/** One row in the dropdown. Google gives no postcode here — that arrives with the details. */
export interface SuburbSuggestion {
  placeId: string
  /** "Pakenham" */
  primaryText: string
  /** "VIC, Australia" */
  secondaryText: string
}

/** A confirmed place. Field names match `locationData` on the job and user documents. */
export interface SuburbPlace {
  suburb: string
  state: string
  stateFullName: string
  postcode: string
  /** 'AU' */
  country: string
  /** 'Australia' */
  countryName: string
  /** What the customer sees and what gets sent to n8n: "Pakenham, VIC 3810". */
  displayLabel: string
  /** Google's own, minus the country: "Pakenham VIC 3810". */
  formattedAddress: string
  latitude: number
  longitude: number
  placeId: string
  placeTypes: string[]
  name: string
}

let sdk: Promise<typeof google.maps.places> | null = null

function loadPlaces(): Promise<typeof google.maps.places> {
  if (sdk) return sdk
  const key = apiKey()
  if (!key) return Promise.reject(new Error('Places API key is not configured'))

  sdk = new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps?.places) {
      resolve(google.maps.places)
      return
    }
    const fail = (reason: string) => {
      // Cleared so a failed load (offline, blocked key) can be retried by the next keystroke
      // instead of poisoning the module for the rest of the session.
      sdk = null
      script.remove()
      reject(new Error(reason))
    }
    // A rejected key is not a failed request: Google still serves the script with a 200 and
    // then simply never calls the callback (it logs InvalidKeyMapError instead). Without this
    // the promise stays pending forever and the picker spins on "searching" with no way out.
    const timer = setTimeout(() => fail('Google Maps did not finish loading'), SDK_TIMEOUT_MS)

    const script = document.createElement('script')
    script.async = true
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&libraries=places&language=en&region=AU&callback=${SDK_CALLBACK}`
    // The callback is what guarantees the places library itself has landed — `onload` only says
    // the bootstrap script arrived. Google's console warning asks for `loading=async` here, but
    // verified against the live API: with that flag the callback never fires, and the alternative
    // it wants (`google.maps.importLibrary`) only exists when the API is loaded via their inline
    // bootstrap snippet, not a plain script tag. The warning is the cheaper of the two costs.
    Reflect.set(window, SDK_CALLBACK, () => {
      clearTimeout(timer)
      resolve(google.maps.places)
    })
    script.onerror = () => {
      clearTimeout(timer)
      fail('Google Maps could not be loaded')
    }
    document.head.appendChild(script)
  })
  return sdk
}

// Callers pass a plain string id around; the SDK wants its own token object. Keeping the map
// here means neither the picker nor its tests need to know what a session token really is.
const sessions = new Map<string, google.maps.places.AutocompleteSessionToken>()

function sessionFor(places: typeof google.maps.places, id: string) {
  let token = sessions.get(id)
  if (!token) {
    token = new places.AutocompleteSessionToken()
    sessions.set(id, token)
  }
  return token
}

/**
 * Ties a run of keystrokes to the one details call that follows, so the whole lookup bills as
 * a single session. Discarded after the details call — the next search starts a new one.
 */
export function newSessionToken(): string {
  return crypto.randomUUID()
}

function component(components: google.maps.GeocoderAddressComponent[], type: string) {
  return components.find((entry) => entry.types?.includes(type))
}

function toSuburbPlace(details: google.maps.places.PlaceResult, placeId: string): SuburbPlace {
  const components = details.address_components ?? []
  const name = details.name ?? ''
  const locality = component(components, 'locality') ?? component(components, 'sublocality')
  const admin = component(components, 'administrative_area_level_1')
  const postal = component(components, 'postal_code')
  const country = component(components, 'country')
  const location = details.geometry?.location

  const suburb = locality?.long_name ?? name
  const state = admin?.short_name ?? ''
  const postcode = postal?.long_name ?? ''
  // Every AU place formats as "…, Australia"; the country is never in doubt here and the
  // signup records don't carry it either.
  const formattedAddress = (details.formatted_address ?? '').replace(/,?\s*Australia$/i, '').trim()

  return {
    suburb,
    state,
    stateFullName: admin?.long_name ?? '',
    postcode,
    // The search is AU-only, so these are effectively constants — but they are stored on every
    // record, and reading them off the response beats hard-coding a country into a lookup.
    country: country?.short_name ?? 'AU',
    countryName: country?.long_name ?? 'Australia',
    displayLabel: [suburb, [state, postcode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    formattedAddress,
    latitude: location?.lat() ?? 0,
    longitude: location?.lng() ?? 0,
    placeId: details.place_id ?? placeId,
    placeTypes: details.types ?? [],
    name,
  }
}

/** Australian suburbs matching what's been typed. Returns [] for anything too short to be useful. */
export async function searchSuburbs(input: string, sessionToken: string): Promise<SuburbSuggestion[]> {
  const query = input.trim()
  if (!isPlacesConfigured() || query.length < 3) return []

  const places = await loadPlaces()
  const service = new places.AutocompleteService()

  const predictions = await new Promise<google.maps.places.AutocompletePrediction[]>((resolve, reject) => {
    service.getPlacePredictions(
      {
        input: query,
        componentRestrictions: { country: REGION },
        types: SUBURB_TYPES,
        sessionToken: sessionFor(places, sessionToken),
      },
      (results, status) => {
        // "Nothing matched" is an answer, not a failure — only a real fault should surface the
        // error line to the customer.
        if (status === places.PlacesServiceStatus.ZERO_RESULTS) resolve([])
        else if (status === places.PlacesServiceStatus.OK && results) resolve(results)
        else reject(new Error(`Suburb search failed: ${status}`))
      },
    )
  })

  return predictions.map((prediction) => ({
    placeId: prediction.place_id,
    primaryText: prediction.structured_formatting?.main_text ?? prediction.description,
    secondaryText: prediction.structured_formatting?.secondary_text ?? '',
  }))
}

/** The one call that turns a picked suggestion into a full record — postcode included. */
export async function fetchSuburbPlace(placeId: string, sessionToken: string): Promise<SuburbPlace> {
  if (!isPlacesConfigured()) throw new Error('Places API key is not configured')

  const places = await loadPlaces()
  // getDetails insists on an element to attribute Google's logo to, even when nothing renders a
  // map. A detached div is the documented way to satisfy it.
  const service = new places.PlacesService(document.createElement('div'))

  const result = await new Promise<google.maps.places.PlaceResult>((resolve, reject) => {
    service.getDetails({ placeId, fields: DETAIL_FIELDS, sessionToken: sessionFor(places, sessionToken) }, (place, status) => {
      if (status === places.PlacesServiceStatus.OK && place) resolve(place)
      else reject(new Error(`Suburb details failed: ${status}`))
    })
  })

  // The session ends with the details call, whatever the picker does next.
  sessions.delete(sessionToken)
  return toSuburbPlace(result, placeId)
}
