# Agent Fence — Project Rules

## Tech Stack
- React 19 + TypeScript, Vite (rolldown-vite, oxlint — do not add ESLint/Babel on top)
- Tailwind CSS v4 (via `@tailwindcss/vite`, no `tailwind.config.js` / `postcss.config.js` needed)
- React Router v8 for routing
- Zustand for shared client state. Server/remote data goes through `services/`, not the store — don't cache API responses in Zustand.
- Axios (`src/services/api.ts`) for HTTP
- Vitest + React Testing Library for unit/component tests, Playwright for e2e (`e2e/`)

## Folder Structure
- `src/components`: reusable, presentation-focused UI (no route/page components here)
- `src/pages`: route-level components, wired in `src/App.tsx`
- `src/hooks`: custom hooks shared across 2+ places
- `src/services`: API calls and external integrations (axios instances, SDK wrappers)
- `src/store`: Zustand stores
- `src/utils`: pure helper/formatter functions
- `e2e`: Playwright specs

**Don't pre-create empty folders.** `features/`, `types/`, `hooks/`, `utils/` get created the moment the first real file needs them, not before — an empty folder with a placeholder `index.ts` is dead code that lint will flag as unused.

## Coding Standards
- Functional components with hooks only.
- No `any`. Colocate a `types.ts` next to a component **only** when its prop interface is non-trivial (3+ props, or reused elsewhere) — a component with zero or one simple prop keeps its type inline. Don't generate a types.ts file by default.
- One component = one responsibility. Don't split a component into subcomponents/files until something else actually reuses the piece.
- Tailwind for styling; no CSS modules or styled-components alongside it.
- Every interactive element needs a visible focus state and an accessible name — no icon-only buttons without `aria-label`.

## Testing
- Every new component/hook with real logic (a branch, a loop, state, an effect) gets a colocated `*.test.tsx`/`*.test.ts` — see `src/pages/Home.test.tsx` for the pattern.
- User-visible flows spanning more than one page/component get a Playwright spec in `e2e/`.
- `npm run test` (unit), `npm run test:e2e` (browser), `npm run build` (typecheck + prod build) must all pass before calling a change done.

## Code review
Use the built-in `/code-review` and `/security-review` skills for reviewing diffs — don't write a custom review skill, they already cover TS safety, hook deps, and security.

## Design
The `frontend-design` skill is active in this repo (`.claude/skills/frontend-design`) — it governs visual/UX decisions for any new UI: commit to a real aesthetic direction, no generic Inter+gradient-card AI-slop defaults. When a Figma file is available, pull actual design tokens/screenshots via the Figma MCP tools instead of inventing a palette.
