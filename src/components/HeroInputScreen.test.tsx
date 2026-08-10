import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HeroInputScreen } from './HeroInputScreen'

const noop = () => {}

function renderHero() {
  const onSubmit = vi.fn()
  const { container } = render(
    <HeroInputScreen
      description="I need a fence"
      onDescriptionChange={noop}
      selectedType={null}
      onSelectType={noop}
      onSubmit={onSubmit}
    />,
  )
  // The file inputs are hidden and driven by the icon buttons, so there is no accessible name to
  // query them by — the accept attribute is what tells them apart.
  const pdfInput = container.querySelector('input[type="file"][accept*="pdf"]') as HTMLInputElement
  return { onSubmit, pdfInput }
}

/** A file of a given size without actually allocating it — `size` is read-only, so it is redefined. */
function fakeFile(name: string, type: string, megabytes: number) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: Math.round(megabytes * 1024 * 1024) })
  return file
}

describe('HeroInputScreen attachments', () => {
  it('accepts a normal PDF', async () => {
    const { pdfInput } = renderHero()

    await userEvent.upload(pdfInput, fakeFile('quote.pdf', 'application/pdf', 2))

    expect(screen.getByText('quote.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('turns away a file that is too big to be worth uploading', async () => {
    const { pdfInput } = renderHero()

    await userEvent.upload(pdfInput, fakeFile('huge.pdf', 'application/pdf', 11))

    // The point is the specific reason. Before this check the upload was attempted, hung for the
    // full 30s timeout, and surfaced a generic "something went wrong".
    expect(screen.getByRole('alert')).toHaveTextContent(/huge\.pdf.*over 10 MB/i)
    expect(screen.queryByText('huge.pdf')).not.toBeInTheDocument()
  })

  it('turns away something that is not a PDF at all, whatever the picker allowed', async () => {
    const { pdfInput } = renderHero()
    // `applyAccept: false` because user-event honours the accept attribute by default, which is
    // precisely the thing that cannot be trusted: a real file dialog lets people switch the
    // filter off, and a drop or a paste never consults it. Turning the simulation's own guard
    // off is what makes this test exercise the app's check rather than the library's.
    const user = userEvent.setup({ applyAccept: false })

    await user.upload(pdfInput, fakeFile('payload.exe', 'application/x-msdownload', 1))

    expect(screen.getByRole('alert')).toHaveTextContent(/payload\.exe.*isn't a PDF/i)
    expect(screen.queryByText('payload.exe')).not.toBeInTheDocument()
  })

  it('still takes a PDF the system reported no type for', async () => {
    const { pdfInput } = renderHero()

    await userEvent.upload(pdfInput, fakeFile('scan.pdf', '', 1))

    expect(screen.getByText('scan.pdf')).toBeInTheDocument()
  })

  it('caps how many files can ride along with one description', async () => {
    const { pdfInput } = renderHero()

    await userEvent.upload(
      pdfInput,
      [1, 2, 3, 4, 5].map((n) => fakeFile(`quote-${n}.pdf`, 'application/pdf', 1)),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/up to 4 files/i)
    expect(screen.getByText('quote-4.pdf')).toBeInTheDocument()
    expect(screen.queryByText('quote-5.pdf')).not.toBeInTheDocument()
  })

  it('hands the accepted files to the submit handler', async () => {
    const { onSubmit, pdfInput } = renderHero()
    await userEvent.upload(pdfInput, fakeFile('quote.pdf', 'application/pdf', 1))

    await userEvent.click(screen.getByRole('button', { name: /start analysis/i }))

    expect(onSubmit).toHaveBeenCalledWith([expect.objectContaining({ name: 'quote.pdf' })])
  })
})
