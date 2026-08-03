# Fencing AI Agent — n8n Integration

How this React app talks to the n8n "Fencing AI Agent" workflow. This doc
describes the workflow as it actually is today, exported at
`n8n/fencing-workflow-updated.json` in this repo — read that file's node
names if you need to trace something back to the source. A "Known issues"
section at the bottom lists real bugs found in the current export.

## What the workflow does

One webhook. You send a chat message + a session id, it sends back one of
five response shapes: a normal chat reply, a multiple-choice question, a
**confirmation** turn (recaps the whole checklist and asks yes/no before
proceeding), a final new-quote result (top matching fencing businesses +
pricing), or a final quote-comparison result. Two separate LLM agents run
the conversation:

- **`Intent & Quote-Compare Agent`** — runs first, every turn. Decides
  `intent`: `new_quote` (the default) or `compare_quote` (only when the user
  explicitly asks to beat/compare an existing price — attaching a quote
  document alone does *not* count). If `new_quote`, it hands off immediately
  and does nothing else. If `compare_quote`, it gathers a 4-item checklist
  (`suburb`, `fenceType`, `lengthMeters`, `existingPrice` — the last one
  optional, never blocks completion) and runs the comparison once complete.
- **`Fencing AI Agent1`** — runs the `new_quote` conversation, gathering a
  6-item checklist (`suburb`, `fenceType`, `lengthMeters`, `heightMm`,
  `removeOldFence`, `siteAccess`).

Once a checklist is complete, a deterministic step (not the LLM) ranks
businesses and computes pricing — **currently against a ~145KB hard-coded
dummy dataset** (`Dummy Firebase Workers Data1` node), not a real database.
The one node that would hit a real Firestore lookup
(`Query Firestore Workers1`) is disabled and has no incoming connection —
don't expect "live" business data until that's wired up and enabled.

## Endpoint

```
POST {N8N_BASE_URL}/webhook/fencing-chat-api
```

Node: `Webhook (React Input)2`. `responseMode: "responseNode"` — the actual
HTTP response is whatever the single `Respond to Webhook1` node emits, not
an immediate ack. No `authentication` set, CORS `allowedOrigins: "*"`. Same
env-var/production notes as before: ask for `N8N_BASE_URL` if not shared,
narrow CORS before going live.

(There's also a `When chat message received` trigger — that's n8n's own Chat
UI test trigger, not the one this app calls.)

## Request body

```ts
interface FencingChatRequest {
  message: string   // free text, OR an MCQ option's `value` coerced to a string — see below
  sessionId: string  // generated client-side, unchanged for the whole conversation
}
```

Chat memory (`Chat Memory (Window Buffer)1` for new-quote, `Chat Memory
(Compare Flow)` for compare) is a 10-message rolling window keyed by
`sessionId`, in-memory only — resets if the n8n instance restarts, and can in
principle lose a checklist value if the conversation runs past the window
(the agent is prompted to always re-echo known values, but nothing outside
the LLM's own output actually guarantees this).

### Multi-file uploads

The frontend can attach multiple files under repeated `quoteFile` multipart
fields in the same request. `Split Attachments by Binary Key` fans these out,
routes each to PDF-text-extraction or vision-based image extraction, then
**all extracted text is joined into a single combined string** (truncated to
4000 characters) and sent to the LLM in **one** turn. There is no
per-document confirmation step and no mechanism for "confirm document 1,
then document 2" — it's all-or-nothing per request today.

## Response body

```ts
type FencingChatResponse = {
  sessionId: string
  type: 'message' | 'question' | 'confirmation' | 'result' | 'comparison_result'
  message: string
  options: { label: string; value: string | number | boolean }[]
  results: { businessName: string; ratePerMeter: number; estimatedTotal: number; notes: string }[]
  avgRatePerMeter: number | null
  comparison?: {
    potentialSavings: number | null
    marketAverage: number | null
    totalQuotesScreened: number
    userExistingPrice: number | null
    quotes: {
      businessName: string; ratePerMeter: number
      projectTotalMin: number; projectTotalMax: number
      leadTimeWeeksMin: number; leadTimeWeeksMax: number
      badges: string[]; tag: string | null; savingsFromAverage: number | null
    }[]
  } | null
  intent?: 'new_quote' | 'compare_quote'   // see "Known issues" — not present on every turn
  checklist?: Record<string, string | number | boolean | null> | null
  checklistComplete?: boolean
}
```

### `checklist` — the important field for the frontend's live progress UI

Every `message`/`question`/`confirmation` turn echoes the full checklist
object back, partially filled in (unknown fields are `null`). This is the
*only* progress signal that exists today — there is no separate stage/status
endpoint, so `ThinkingScreen` (`src/components/ThinkingScreen.tsx`) derives
which of its 4 cards is "active" directly from this field plus
`checklistComplete` (see below), instead of a fake timer.

Two different shapes depending on `intent`:
- `new_quote`: `{ suburb, fenceType, lengthMeters, heightMm, removeOldFence, siteAccess }`
- `compare_quote`: `{ suburb, fenceType, lengthMeters, existingPrice }`

The frontend treats `checklist` as an untyped `Record<string, string | number
| boolean | null>` (`ChecklistData` in `fencingChat.ts`) rather than hardcoding
either field set, so it won't need a code change if a field is renamed/added.
Labels shown in the UI come from a small local map
(`src/utils/checklist.ts`'s `FIELD_LABELS`) — if you add a new checklist
field on the workflow side, add its label there too or it'll just fall back
to showing the raw key.

### `type: 'confirmation'` — the recap-and-yes/no turn

Once every checklist field is known (whichever flow), the workflow does
**not** immediately set `checklistComplete: true`. It first sends one
`type: 'confirmation'` turn: a short recap `message`, the fully-filled
`checklist`, and `options` that MUST be exactly:

```json
[{ "label": "Yes, that's all correct", "value": "yes" }, { "label": "No, something's wrong", "value": "no" }]
```

The frontend renders this as a distinct `ConfirmationCard`
(`src/components/ConfirmationCard.tsx` — title text + the checklist as a
bullet list + the two buttons), not the normal MCQ tile grid. The two option
`value`s must stay the literal lowercase strings `"yes"`/`"no"` — the
frontend doesn't special-case this turn by `type` alone for the *button*
styling, but `checklistComplete` genuinely only flips to `true` on the very
next turn, once the user has replied `"yes"`.

- **`"yes"`** → next response is an ordinary `type: 'message'` with
  `checklistComplete: true` (the short handoff line), then the deterministic
  ranking step runs as before.
- **`"no"`** → next response is an ordinary `type: 'message'` asking what to
  fix (`options: []`, free text). Whatever the user says next either directly
  supplies a corrected value (checklist updates, workflow goes straight back
  to a fresh `confirmation` turn) or just names a field with no value (that
  field is reset to `null`, the normal MCQ for it fires, then back to
  `confirmation` once answered). This loops until `"yes"`.

Both `Fencing AI Agent1` (new_quote) and `Intent & Quote-Compare Agent`
(compare_quote) implement this same pattern now.

### Option values are not always strings

Most MCQ options carry a `number` or `boolean` `value` (e.g. `{"label":
"1800mm", "value": 1800}`, `{"label": "Yes, please remove it", "value":
true}`) — only `suburb`/`existingPrice`-adjacent free-text fields are
strings. The frontend converts whatever a clicked option's `value` is to a
string before sending it back as `message` (`String(option.value)` in
`Home.tsx`) — n8n's `Normalize Input1` Set node then re-parses it as text
for the agent same as any typed message.

### Answering a question

Same as before: send the clicked option's `value` (stringified) back as
`message` on the next request, same `sessionId`. No separate endpoint.

### MCQ-first by design

Both agents' prompts are explicit: **`suburb` is the only free-text field**
in both flows (plus the optional `existingPrice` in compare-quote, which is
never asked for directly). Every other field must come back as 2-5 `options`
with an exact, prompt-specified label/value set (e.g. fenceType's 6 options,
lengthMeters' 4 buckets, heightMm's 2 values, etc.) — the workflow is not
supposed to ever return free text for those fields. If a build ever shows a
free-text box for something other than suburb, that's the workflow prompt
misbehaving, not a frontend routing bug (the frontend just renders whatever
`options` it's given; empty `options` → free text, non-empty → buttons).

### Errors

Unchanged: no separate error shape. Model/tool/lookup failures still come
back as an apologetic `type: 'message'`. The frontend only needs its own
error handling for real network failures (timeout/unreachable).

## Known issues in `n8n/fencing-workflow-updated.json`

Historical note — items 1-3 below were found and fixed (1-2 by hand in the
n8n editor, 3 and the `confirmation` step by this integration work). Kept
here as a record; only #4 is still open.

1. ~~`comparison_result` never actually fires~~ — **fixed**. `Route:
   New-Quote or Compare Result?`'s doubled `==` (evaluated against the
   literal string `"=compare_quote"`, never matching) is now a single `=`.
2. ~~Dangling node reference~~ — **fixed**. `Rank & Format Comparison
   Response` now reads from `Format Comparison Result` (the node that
   actually exists), not a non-existent `Parse Comparison JSON`.
3. ~~`intent` missing on most turns~~ — **fixed**. `Format New-Quote
   Result1` now sets `intent` from `Format Comparison Result` on every turn,
   same as the other formatter nodes.
4. **All quote/comparison data is a static dataset, not live.** `Query
   Firestore Workers1` is disabled with no incoming connection — every
   result is computed against `Dummy Firebase Workers Data1`'s hard-coded
   array. Worth confirming this is expected for now; if "live data" means
   real Firestore-backed businesses, that's the node to wire up.

## Recommended next steps (not required for the current frontend, but the
frontend is designed to make room for these later)

- **Per-document confirmation for compare-quote uploads.** If multiple
  existing-quote PDFs should be confirmed one at a time instead of combined
  into one blob, that's a `Split Attachments by Binary Key` / extraction
  pipeline change (looping the LLM turn per document using the existing chat
  memory to track "which document are we up to"), not a frontend change.
- **A live progress signal**, if fake-but-honest checklist-derived loading
  (what `ThinkingScreen` does today) isn't dynamic enough — would need a
  small separate status endpoint/stage write, since this webhook is a single
  request/response with no streaming.

## Quick manual test

```bash
curl -X POST "{N8N_BASE_URL}/webhook/fencing-chat-api" \
  -H "Content-Type: application/json" \
  -d '{"message":"hi, need a fence quote","sessionId":"test-1"}'
```

Keep POSTing with the same `sessionId`, answering whatever it asks (send the
option's `value` back, stringified), until you get `type: "result"`.
