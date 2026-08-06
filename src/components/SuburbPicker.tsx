import { useEffect, useRef, useState } from 'react'
import { fetchSuburbPlace, newSessionToken, searchSuburbs, type SuburbPlace, type SuburbSuggestion } from '../services/places'

// Short enough that "3810" and most suburb prefixes search, long enough that the first two
// keystrokes don't each cost a request.
const MIN_QUERY = 3
const DEBOUNCE_MS = 250

// The suburb answer is the one thing in the brief the customer can't be allowed to typo: an
// unrecognised suburb doesn't fail loudly, it silently matches zero businesses. So it's picked
// from Google rather than typed, and only a picked place counts as an answer.
export function SuburbPicker({
  initialQuery = '',
  initialSuggestions = [],
  sessionToken: seededToken,
  disabled,
  onSelect,
}: {
  initialQuery?: string
  initialSuggestions?: SuburbSuggestion[]
  /** The session the seeded suggestions came from, so the details call joins it. */
  sessionToken?: string
  disabled?: boolean
  onSelect: (place: SuburbPlace) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [suggestions, setSuggestions] = useState<SuburbSuggestion[]>(initialSuggestions)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isSearching, setIsSearching] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(initialSuggestions.length > 0)
  const [hasSearched, setHasSearched] = useState(initialQuery.trim().length >= MIN_QUERY)

  const sessionToken = useRef('')
  if (!sessionToken.current) sessionToken.current = seededToken ?? newSessionToken()
  // Whatever we already have results for, so seeded suggestions don't refetch themselves and
  // picking a suggestion doesn't re-search the name it just filled in.
  const settledQuery = useRef(initialQuery.trim())
  const requestId = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed === settledQuery.current) return
    if (trimmed.length < MIN_QUERY) {
      setSuggestions([])
      setIsOpen(false)
      setHasSearched(false)
      return
    }

    const id = requestId.current + 1
    requestId.current = id
    const timer = setTimeout(async () => {
      setIsSearching(true)
      setError(null)
      try {
        const results = await searchSuburbs(trimmed, sessionToken.current)
        // A slower earlier request must not overwrite a newer one's results.
        if (requestId.current !== id) return
        setSuggestions(results)
        setActiveIndex(-1)
        setIsOpen(true)
        setHasSearched(true)
      } catch {
        if (requestId.current !== id) return
        setSuggestions([])
        setError("Suburb search isn't responding. Try again in a moment.")
      } finally {
        if (requestId.current === id) setIsSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  async function choose(suggestion: SuburbSuggestion) {
    if (isResolving) return
    setIsResolving(true)
    setError(null)
    try {
      const place = await fetchSuburbPlace(suggestion.placeId, sessionToken.current)
      // One session covers the typing plus this lookup; the next search starts a fresh one.
      sessionToken.current = newSessionToken()
      settledQuery.current = place.displayLabel
      setQuery(place.displayLabel)
      setIsOpen(false)
      onSelect(place)
    } catch {
      setError("Couldn't load that suburb's details. Pick it again.")
    } finally {
      setIsResolving(false)
    }
  }

  const busy = isSearching || isResolving
  const showEmpty = isOpen && hasSearched && !busy && suggestions.length === 0 && !error

  return (
    <div className="w-full max-w-md animate-[card-rise_0.45s_ease-out_backwards]">
      <div className="relative">
        <label htmlFor="suburb-search" className="sr-only">
          Search for your suburb
        </label>
        {/* No visible label sits above this box in the thread, so the pin is what says
            "place", not decoration. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          className="pointer-events-none absolute top-1/2 left-4 h-4.5 w-4.5 -translate-y-1/2 text-gray-400"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <input
          id="suburb-search"
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="suburb-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `suburb-option-${activeIndex}` : undefined}
          autoComplete="off"
          disabled={disabled || isResolving}
          placeholder="Start typing your suburb or postcode…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          // Closes on blur, but only after a click on a row has had its chance to land.
          onBlur={() => setTimeout(() => setIsOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (suggestions.length === 0) return
              setIsOpen(true)
              setActiveIndex((current) => {
                const step = event.key === 'ArrowDown' ? 1 : -1
                return (current + step + suggestions.length) % suggestions.length
              })
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const target = suggestions[activeIndex] ?? (suggestions.length === 1 ? suggestions[0] : null)
              if (target) void choose(target)
              return
            }
            if (event.key === 'Escape') setIsOpen(false)
          }}
          className="w-full rounded-2xl border border-gray-200 bg-white py-3.5 pr-11 pl-11 text-[15px] text-[#062D27] transition-all placeholder:text-gray-300 focus:border-[#062D27]/40 focus:outline-none focus:shadow-[0_4px_20px_rgba(6,45,39,0.06)] disabled:cursor-not-allowed disabled:opacity-60"
        />

        {busy && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 right-4 flex -translate-y-1/2 gap-1"
          >
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-1.5 w-1.5 rounded-full bg-[#062D27] animate-[dot-pulse_1.2s_ease-in-out_infinite]"
                style={{ animationDelay: `${dot * 0.15}s` }}
              />
            ))}
          </span>
        )}
        <span role="status" className="sr-only">
          {isSearching ? 'Searching suburbs' : isResolving ? 'Loading suburb details' : ''}
        </span>

        {isOpen && suggestions.length > 0 && (
          <ul
            id="suburb-listbox"
            role="listbox"
            aria-label="Suburb suggestions"
            // Keeps the input focused while a row is clicked, so blur doesn't close the list
            // out from under the pointer.
            onMouseDown={(event) => event.preventDefault()}
            className="absolute top-full right-0 left-0 z-10 mt-2 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1 shadow-[0_12px_40px_rgba(6,45,39,0.12)] animate-[fade-in-up_0.18s_ease-out]"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                id={`suburb-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // Two stacked spans otherwise read as one run-on word ("PakenhamVIC, Australia").
                aria-label={`${suggestion.primaryText} ${suggestion.secondaryText}`.trim()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void choose(suggestion)}
                className={`cursor-pointer px-4 py-2.5 transition-colors ${
                  index === activeIndex ? 'bg-[#EFF6F5]' : ''
                }`}
              >
                <span className="block text-[15px] font-medium text-[#062D27]">{suggestion.primaryText}</span>
                <span className="block text-xs text-gray-500">{suggestion.secondaryText}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {showEmpty && (
        <p className="mt-2 text-sm text-gray-500">No Australian suburb matches that. Check the spelling and try again.</p>
      )}
    </div>
  )
}
