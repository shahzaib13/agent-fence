import { useRef, useState } from 'react'
import { generateId } from '../utils/id'

const PROJECT_TYPES = ['Fence', 'Deck', 'Pergola', 'Retaining Wall', 'Driveway', 'Bathroom', 'Kitchen', 'Extension']

function IconButton({ label, path, onClick }: { label: string; path: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-full p-1.5 text-gray-400 transition-all duration-150 hover:scale-110 hover:bg-gray-100 hover:text-gray-600 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </button>
  )
}

type AttachmentKind = 'image' | 'video' | 'file'

interface Attachment {
  id: string
  file: File
  kind: AttachmentKind
  previewUrl: string | null
}

// Same set of glyph paths IconButton already uses for photo/file/video, reused here
// so a chip's icon matches whichever button attached it.
const ATTACHMENT_KIND_ICON_PATH: Record<AttachmentKind, string> = {
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 4-6 4 4',
  file: 'M8 4h6l4 4v12H8zM14 4v4h4',
  video: 'M4 6h11v12H4zM15 9l5-3v12l-5-3',
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  return (
    <div className="relative flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 py-1.5 pr-7 pl-1.5">
      {attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4.5 w-4.5">
            <path strokeLinecap="round" strokeLinejoin="round" d={ATTACHMENT_KIND_ICON_PATH[attachment.kind]} />
          </svg>
        </span>
      )}
      <span className="max-w-32 truncate text-xs font-medium text-gray-600">{attachment.file.name}</span>
      <button
        type="button"
        aria-label={`Remove ${attachment.file.name}`}
        onClick={onRemove}
        className="absolute top-1 right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-gray-400 text-white transition-colors hover:bg-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#062D27]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-2.5 w-2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}

export function HeroInputScreen({
  description,
  onDescriptionChange,
  selectedType,
  onSelectType,
  onSubmit,
}: {
  description: string
  onDescriptionChange: (v: string) => void
  selectedType: string | null
  onSelectType: (t: string) => void
  onSubmit: (quoteFiles: File[]) => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  function addFiles(fileList: FileList | null, kind: AttachmentKind) {
    if (!fileList || fileList.length === 0) return
    const next = Array.from(fileList).map((file) => ({
      id: generateId(),
      file,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
    }))
    setAttachments((prev) => [...prev, ...next])
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  // All non-video attachments go out together in one request — video isn't processed
  // by the backend yet, so it's excluded here.
  function pickQuoteFiles(): File[] {
    return attachments.filter((a) => a.kind !== 'video').map((a) => a.file)
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-12 pb-24">
      <span className="mb-10 flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-[11px] font-medium tracking-wide text-gray-500">
          Calibrated to Australian building standards
        </span>
      </span>

      <div className="mb-12 flex max-w-4xl flex-col items-center gap-2 text-center">
        <h1 className="text-6xl leading-tight font-semibold tracking-tight text-[#062D27] sm:text-7xl">
          Describe your construction project.
        </h1>
        <h1 className="text-6xl leading-tight font-semibold tracking-tight text-gray-400 sm:text-7xl">
          AI handles everything else.
        </h1>
        <p className="mt-4 max-w-2xl text-xl text-gray-500">
          Accurate cost estimates, material take-offs, labour schedules, and a professional quote — in minutes, not
          weeks.
        </p>
      </div>

      <div className="flex w-full max-w-3xl flex-col items-center gap-6">
        <div className="w-full rounded-4xl border border-gray-100 bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
          {attachments.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-100 pb-4">
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </div>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files, 'image')
              e.target.value = ''
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files, 'video')
              e.target.value = ''
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files, 'file')
              e.target.value = ''
            }}
          />
          <label htmlFor="project-description" className="sr-only">
            Describe your construction project
          </label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (description.trim()) onSubmit(pickQuoteFiles())
              }
            }}
            placeholder="A deck — describe the size, location and finish you're imagining..."
            rows={3}
            className="min-h-30 w-full resize-none border-0 text-xl text-[#062D27] placeholder:text-gray-300 focus:outline-none"
          />
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-5">
              <IconButton label="Record voice note" path="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v3" />
              <IconButton
                label="Attach photo"
                path="M4 5h16v14H4zM4 15l4-4 4 4 4-6 4 4"
                onClick={() => photoInputRef.current?.click()}
              />
              <IconButton
                label="Attach file"
                path="M8 4h6l4 4v12H8zM14 4v4h4"
                onClick={() => fileInputRef.current?.click()}
              />
              <IconButton
                label="Attach video walkthrough"
                path="M4 6h11v12H4zM15 9l5-3v12l-5-3"
                onClick={() => videoInputRef.current?.click()}
              />
            </div>
            <button
              type="button"
              onClick={() => onSubmit(pickQuoteFiles())}
              disabled={!description.trim()}
              className="flex items-center gap-3 rounded-2xl bg-[#062D27] py-3 pr-4 pl-6 text-base font-medium text-white transition-all duration-150 hover:scale-[1.02] hover:bg-[#0a3f37] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              Start analysis
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4.5 w-4.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          {PROJECT_TYPES.map((type) => {
            const active = type === selectedType
            return (
              <button
                key={type}
                type="button"
                onClick={() => onSelectType(type)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-full border px-5 py-2 text-sm transition-all duration-150 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27] ${
                  active
                    ? 'border-[#062D27] bg-[#EFF6F5] font-medium text-[#062D27]'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${active ? 'bg-[#062D27]' : 'bg-gray-300'}`}
                />
                {type}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
