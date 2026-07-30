---
name: new-component
description: Scaffold a new React component following this repo's conventions in CLAUDE.md
---

Create a component named $ARGUMENTS under `src/components/<Name>/index.tsx` (or `src/pages/<Name>.tsx` if it's route-level — ask if unclear).

Rules (from CLAUDE.md, don't skip these):
- Functional component, hooks only, no `any`.
- Only add a sibling `types.ts` if the props interface has 3+ fields or is imported elsewhere — otherwise declare the props type inline in `index.tsx`.
- Style with Tailwind classes only.
- If the component has any branch, loop, or state, add a colocated `index.test.tsx` using Vitest + React Testing Library that exercises it.
- Don't create a `features/`, `hooks/`, or `utils/` folder for this unless the component actually needs one right now.

After creating it, run `npm run test` and `npx tsc -b` to confirm it's wired up correctly.
