import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The last line between a thrown render and a blank white page.
 *
 * A class, because `componentDidCatch` still has no hook equivalent — this is the one place
 * React insists on one.
 *
 * Deliberately dependency-free: no Header, no react-router, no useAuth. Whatever crashed could
 * be any of those, and a fallback that throws while rendering the fallback leaves exactly the
 * blank page it was meant to replace. Plain anchors and a reload button, nothing else.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The only signal that exists today — it lands in the visitor's console and nowhere else.
    // When error reporting is added this becomes `Sentry.captureException(error, { extra: info })`,
    // and a crash starts reaching someone who can act on it.
    console.error('Unhandled render error:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FCFDFD] px-4 text-center">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[#062D27]" />
        <h1 className="text-2xl font-semibold tracking-tight text-[#062D27]">Something went wrong</h1>
        <p className="max-w-md text-base text-[#6B7280]">
          That's on us, not you. Your saved quotes are still here — reloading usually clears it.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-medium text-white transition-transform duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Reload the page
          </button>
          <a
            href="/"
            className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-semibold text-[#062D27] transition-colors hover:border-[#062D27]/40 hover:bg-[#F1F4F3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Start a new quote
          </a>
        </div>
      </div>
    )
  }
}
