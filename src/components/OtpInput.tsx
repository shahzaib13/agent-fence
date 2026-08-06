import { useEffect, useRef } from 'react'
import { OTP_LENGTH } from '../services/otp'

// One box per digit, because that is what a texted code looks like everywhere else. Shared by
// the Instant Quote flow and the sign-in dialog — the fiddly parts (advancing on type, stepping
// back on backspace, taking a whole pasted code) are worth writing once.
export function OtpInput({
  digits,
  onChange,
  hasError,
  autoFocus,
}: {
  digits: string[]
  onChange: (digits: string[]) => void
  hasError?: boolean
  autoFocus?: boolean
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (autoFocus) boxes.current[0]?.focus()
  }, [autoFocus])

  function write(startIndex: number, value: string) {
    const typed = value.replace(/\D/g, '')
    if (!typed) {
      onChange(digits.map((digit, index) => (index === startIndex ? '' : digit)))
      return
    }
    // A pasted code fills from wherever it landed, so one paste completes the whole thing.
    const next = [...digits]
    for (let offset = 0; offset < typed.length && startIndex + offset < OTP_LENGTH; offset += 1) {
      next[startIndex + offset] = typed[offset]
    }
    onChange(next)
    boxes.current[Math.min(startIndex + typed.length, OTP_LENGTH - 1)]?.focus()
  }

  return (
    <div role="group" aria-label={`${OTP_LENGTH}-digit verification code`} className="flex gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Digit ${index + 1}`}
          aria-invalid={hasError ? true : undefined}
          value={digit}
          onFocus={(event) => event.target.select()}
          onChange={(event) => write(index, event.target.value)}
          onPaste={(event) => {
            event.preventDefault()
            write(0, event.clipboardData.getData('text'))
          }}
          onKeyDown={(event) => {
            // Backspace in an empty box steps back rather than doing nothing.
            if (event.key === 'Backspace' && !digit && index > 0) boxes.current[index - 1]?.focus()
          }}
          className={`h-14 w-full min-w-0 rounded-2xl border-2 text-center text-2xl font-semibold text-[#062D27] transition-colors focus:outline-none focus-visible:border-[#062D27] focus-visible:ring-2 focus-visible:ring-[#062D27]/15 sm:h-16 ${
            hasError ? 'border-red-300 bg-red-50/40' : 'border-gray-200 bg-white'
          }`}
        />
      ))}
    </div>
  )
}
