import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AnswerImage } from '../services/fencingChat'
import { AnswerPhotos } from './AnswerPhotos'

const colorbond: AnswerImage = {
  url: 'https://bunnings.com.au/fence.jpg',
  thumbUrl: 'https://encrypted-tbn0.gstatic.com/images?q=colorbond',
  sourceName: 'Bunnings',
  width: 3900,
  height: 2194,
}

const timber: AnswerImage = {
  url: 'https://example.com/timber.jpg',
  thumbUrl: 'https://encrypted-tbn0.gstatic.com/images?q=timber',
  sourceName: 'Mitre 10',
  width: 800,
  height: 600,
}

const thumb = (src: string) => document.querySelector(`img[src="${src}"]`)

describe('AnswerPhotos', () => {
  it('renders the thumbnail in the grid, never the original', () => {
    render(<AnswerPhotos images={[colorbond]} />)

    expect(thumb(colorbond.thumbUrl)).toBeInTheDocument()
    expect(thumb(colorbond.url)).not.toBeInTheDocument()
    expect(screen.getByText('Bunnings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view photo from bunnings/i })).toBeInTheDocument()
  })

  it('opens an in-chat lightbox on the thumb first, with a new-tab credit link', async () => {
    const user = userEvent.setup()
    render(<AnswerPhotos images={[colorbond]} />)

    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /example from bunnings/i })).toHaveAttribute('src', colorbond.thumbUrl)

    const link = screen.getByRole('link', { name: /view original photo from bunnings/i })
    expect(link).toHaveAttribute('href', colorbond.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('closes the lightbox from the close button and Escape', async () => {
    const user = userEvent.setup()
    render(<AnswerPhotos images={[colorbond]} />)

    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close photo/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('steps through photos in the same message with next/prev and arrow keys', async () => {
    const user = userEvent.setup()
    render(<AnswerPhotos images={[colorbond, timber]} />)

    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next photo/i }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /example from mitre 10/i })).toHaveAttribute('src', timber.thumbUrl)

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /example from bunnings/i })).toHaveAttribute(
      'src',
      colorbond.thumbUrl,
    )
  })

  it('keeps the thumb when the original probe fails (CORP / dead host)', async () => {
    const user = userEvent.setup()
    const imageSpy = vi.spyOn(globalThis, 'Image').mockImplementation(function MockImage(this: {
      onload: ((ev: Event) => void) | null
      onerror: ((ev: Event) => void) | null
      src: string
    }) {
      this.onload = null
      this.onerror = null
      Object.defineProperty(this, 'src', {
        set() {
          queueMicrotask(() => this.onerror?.(new Event('error')))
        },
        get() {
          return colorbond.url
        },
      })
    } as unknown as typeof Image)

    render(<AnswerPhotos images={[colorbond]} />)
    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))

    await Promise.resolve()
    expect(screen.getByRole('img', { name: /example from bunnings/i })).toHaveAttribute(
      'src',
      colorbond.thumbUrl,
    )

    imageSpy.mockRestore()
  })

  it('upgrades to the original when the probe loads', async () => {
    const user = userEvent.setup()
    const imageSpy = vi.spyOn(globalThis, 'Image').mockImplementation(function MockImage(this: {
      onload: ((ev: Event) => void) | null
      onerror: ((ev: Event) => void) | null
      src: string
    }) {
      this.onload = null
      this.onerror = null
      Object.defineProperty(this, 'src', {
        set() {
          queueMicrotask(() => this.onload?.(new Event('load')))
        },
        get() {
          return colorbond.url
        },
      })
    } as unknown as typeof Image)

    render(<AnswerPhotos images={[colorbond]} />)
    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))

    expect(await screen.findByRole('img', { name: /example from bunnings/i })).toHaveAttribute(
      'src',
      colorbond.url,
    )

    imageSpy.mockRestore()
  })

  it('shows a spinner until the lightbox thumb loads, then hides the stale frame', async () => {
    const user = userEvent.setup()
    render(<AnswerPhotos images={[colorbond, timber]} />)

    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status', { name: /loading photo/i })).toBeInTheDocument()

    fireEvent.load(screen.getByRole('img', { name: /example from bunnings/i }))
    expect(dialog).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByRole('status', { name: /loading photo/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next photo/i }))
    expect(screen.getByRole('status', { name: /loading photo/i })).toBeInTheDocument()
    fireEvent.load(screen.getByRole('img', { name: /example from mitre 10/i }))
    expect(screen.queryByRole('status', { name: /loading photo/i })).not.toBeInTheDocument()
  })

  it('sizes the tile from the original’s ratio, not its pixels', () => {
    render(<AnswerPhotos images={[colorbond]} />)

    expect(thumb(colorbond.thumbUrl)?.parentElement).toHaveStyle({ aspectRatio: '3900 / 2194' })
  })

  it('puts the source name under the photo in a 2–3 column grid', () => {
    render(<AnswerPhotos images={[colorbond]} />)

    const list = screen.getByRole('list', { name: 'Example photos' })
    expect(list).toHaveClass('grid-cols-2', 'sm:grid-cols-3')
    const caption = screen.getByText('Bunnings')
    expect(caption.tagName).toBe('FIGCAPTION')
    expect(caption.parentElement?.querySelector('img')?.getAttribute('src')).toBe(colorbond.thumbUrl)
  })

  it('hides a tile whose thumbnail fails to load', () => {
    const broken: AnswerImage = {
      url: 'https://example.com/dead.jpg',
      thumbUrl: 'https://encrypted-tbn0.gstatic.com/images?q=dead',
      sourceName: 'Broken host',
      width: 4,
      height: 3,
    }
    render(<AnswerPhotos images={[colorbond, broken]} />)

    fireEvent.error(thumb(broken.thumbUrl)!)

    expect(screen.queryByText('Broken host')).not.toBeInTheDocument()
    expect(screen.getByText('Bunnings')).toBeInTheDocument()
  })

  it('opens a lightbox without an original link when url is empty', async () => {
    const user = userEvent.setup()
    render(<AnswerPhotos images={[{ ...colorbond, url: '' }]} />)

    await user.click(screen.getByRole('button', { name: /view photo from bunnings/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /example from bunnings/i })).toHaveAttribute(
      'src',
      colorbond.thumbUrl,
    )
  })
})
