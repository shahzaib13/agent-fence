import { useEffect, useId, useRef, useState } from 'react'
import type { AnswerImage } from '../services/fencingChat'

/**
 * 2–3 column sample board between the bubble and the options.
 * Thumbs only in the grid — click opens an in-chat lightbox (same message’s photos).
 * Absent `images` is not an empty state: the caller simply does not render this.
 */
export function AnswerPhotos({ images }: { images: AnswerImage[] }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const visible = images.filter((image) => image.thumbUrl && !failed.has(image.thumbUrl))
  if (visible.length === 0) return null

  return (
    <>
      <ul
        className="grid max-w-xl grid-cols-2 gap-x-2.5 gap-y-3 sm:grid-cols-3"
        aria-label="Example photos"
      >
        {visible.map((image, index) => (
          <li key={image.thumbUrl}>
            <PhotoTile
              image={image}
              onOpen={() => setOpenIndex(index)}
              onError={() => setFailed((previous) => new Set(previous).add(image.thumbUrl))}
            />
          </li>
        ))}
      </ul>
      {openIndex !== null && (
        <PhotoLightbox
          images={visible}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  )
}

function PhotoTile({
  image,
  onOpen,
  onError,
}: {
  image: AnswerImage
  onOpen: () => void
  onError: () => void
}) {
  const width = image.width > 0 ? image.width : 4
  const height = image.height > 0 ? image.height : 3

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View photo from ${image.sourceName}`}
      className="block w-full rounded-xl text-left transition-opacity duration-150 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
    >
      <figure className="m-0">
        <span
          className="block overflow-hidden rounded-xl bg-[#EDF1F0]"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <img src={image.thumbUrl} alt="" onError={onError} className="h-full w-full object-cover" />
        </span>
        <figcaption className="mt-1.5 truncate text-xs font-medium tracking-wide text-gray-400">
          {image.sourceName}
        </figcaption>
      </figure>
    </button>
  )
}

function PhotoLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: AnswerImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const titleId = useId()
  const image = images[index]
  const hasMany = images.length > 1
  const thumbSrc = image?.thumbUrl ?? ''
  const originalSrc = image?.url?.trim() || ''
  // Thumb first — already on screen in the grid, and many shop `url`s are CORP-blocked.
  const [displaySrc, setDisplaySrc] = useState(thumbSrc)
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setDisplaySrc(thumbSrc)
    setLoaded(false)

    let cancelled = false
    const showThumbIfReady = () => {
      const el = imgRef.current
      if (el?.complete && el.naturalWidth > 0) setLoaded(true)
    }
    showThumbIfReady()

    // Upgrade to the original only when it actually loads. CORP / CORS cancels never replace the thumb.
    if (!originalSrc || originalSrc === thumbSrc) return

    const probe = new Image()
    probe.onload = () => {
      if (cancelled) return
      setDisplaySrc(originalSrc)
    }
    probe.onerror = () => {
      // Keep the thumb — blocked or dead original must not leave a spinning void.
    }
    probe.src = originalSrc

    return () => {
      cancelled = true
      probe.onload = null
      probe.onerror = null
    }
  }, [thumbSrc, originalSrc])

  useEffect(() => {
    setLoaded(false)
    const el = imgRef.current
    if (el?.complete && el.naturalWidth > 0) setLoaded(true)
  }, [displaySrc])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (!hasMany) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onIndexChange((index - 1 + images.length) % images.length)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        onIndexChange((index + 1) % images.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasMany, images.length, index, onClose, onIndexChange])

  if (!image) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#062D27]/70 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={!loaded}
        className="relative flex max-h-[min(90dvh,52rem)] w-full max-w-4xl flex-col gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 text-white">
          <p id={titleId} className="min-w-0 truncate text-sm font-medium">
            {image.sourceName}
            {hasMany ? (
              <span className="ml-2 font-normal text-white/70">
                {index + 1} / {images.length}
              </span>
            ) : null}
          </p>
          <button
            type="button"
            aria-label="Close photo"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="relative flex min-h-[min(40dvh,20rem)] min-w-0 flex-1 items-center justify-center">
          {hasMany ? (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
              className="absolute left-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:left-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : null}

          {!loaded ? (
            <span
              role="status"
              aria-label="Loading photo"
              className="absolute h-10 w-10 rounded-full border-2 border-white/25 border-t-white animate-spin"
            />
          ) : null}

          <img
            key={displaySrc}
            ref={imgRef}
            src={displaySrc}
            alt={`Example from ${image.sourceName}`}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className={`max-h-[min(75dvh,44rem)] max-w-full rounded-2xl object-contain shadow-[0_25px_50px_-12px_rgba(0,0,0,0.45)] transition-opacity duration-150 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />

          {hasMany ? (
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => onIndexChange((index + 1) % images.length)}
              className="absolute right-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : null}
        </div>

        {originalSrc ? (
          <a
            href={originalSrc}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View original photo from ${image.sourceName}`}
            className="self-center rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Open original
          </a>
        ) : null}
      </div>
    </div>
  )
}

