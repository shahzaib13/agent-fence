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

### Suburb matching is exact, and it is the first filter

`Rank and Format Top ` used to rank on `fenceType` and `lengthMeters` only —
`suburb` was collected, echoed back, shown in the sidebar, and then **never
used**, even though every record in the dataset carries a `serviceSuburbs`
array. A customer in Pakenham was ranked against every business in the
dataset that did their fence type, wherever it was.

Both ranking nodes now filter on `serviceSuburbs` before anything else, and
the match is deliberately **exact** — normalised for case, punctuation, a
trailing state abbreviation and a postcode (`"Pakenham"`, `"pakenham vic"`,
`"Pakenham, 3810"` are one place) but never fuzzy or "nearby". A near-miss
must miss: quoting someone a business that doesn't service them is worse than
telling them there is nobody.

Each result carries `suburb`, set to the matched entry from the business's own
`serviceSuburbs` — the customer's suburb, spelled the way the record does. It
is never one of the business's *other* service suburbs, which would read like
the wrong job was matched. `ResultsPanel` renders it; it used to print a
hard-coded `'Balmain'`/`'Rozelle'`/`'Drummoyne'` placeholder next to a real
business name.

An empty result now distinguishes its two causes via `noMatchReason`:
`'suburb'` (no business covers it at all) or `'fenceType'` (some do, none in
that type), and `Format Result Response1` words the message accordingly. The
frontend keeps a zero-result `type: 'result'` **in the chat thread** instead
of switching to the results page, so the explanation is actually shown and
the customer can correct the suburb or fence type in one line.

### Units are converted, not enforced

The checklist stores `heightMm` in millimetres and `lengthMeters` in metres;
customers do not think in those units and are never asked to. The agent's
prompt carries an explicit conversion table (`1.8m`/`180cm`/`6ft` → `1800`,
`20000mm` → `20`) including what to assume when no unit is given at all.

`Format New-Quote Result1` additionally normalises `heightMm` in code: a fence
runs roughly 600-2400mm, so a value under 10 was metres and one under 100 was
centimetres — there is no real fence height in those ranges for the guard to
misread. `lengthMeters` deliberately has **no** such guard: a 600m rural
boundary is a genuine answer, so there is no out-of-range value to key off,
and it is left to the prompt.
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
  intent?: 'new_quote' | 'compare_quote'  // see "Intent is locked by the client" below
  knownChecklist?: string  // JSON of the already-known fields, see below
}
```

### `knownChecklist` — why the client restates what it already knows

The agents hold no state beyond their rolling chat-memory window, so a value
they were told several turns ago is only available if it is still inside that
window *and* the model bothers to restate it. When either fails, the field
comes back `null` and gets asked for a second time — the classic case being a
suburb typed into the hero screen ("I want a fence in Pakenham") being asked
for again a turn or two later.

So the frontend sends back every field it already has, as a JSON string of
just the non-null entries. `Normalize Input1` carries it as `knownChecklist`
and it is used twice:

- **Injected into `Fencing AI Agent1`'s prompt** as an `--- Already
  established for this job, do NOT ask about these again ---` block, so the
  agent is told outright rather than having to remember. Its system prompt
  treats that block as settled fact, overridden only by a newer contradicting
  message from the customer.
- **Merged over the agent's output** in `Format New-Quote Result1` and
  `Format Comparison Result`: any field the turn dropped back to `null` that
  the client knew a value for is restored *before* anything counts what is
  still missing. The injection stops the wrong question being asked; the merge
  guarantees an established value can't be lost.

One known wrinkle: on the `"no, something's wrong"` correction path the agent
deliberately resets a field to `null` so it can re-ask it. The merge restores
it, so for that one turn the sidebar still shows the old value — the question
is still asked and the answer still overwrites it, so it self-corrects on the
next turn.

Chat memory (`Chat Memory (Window Buffer)1` for new-quote, `Chat Memory
(Compare Flow)` for compare) is a 30-message rolling window keyed by
`sessionId`, in-memory only — resets if the n8n instance restarts. It was 10,
which is shorter than a finished new-quote conversation (opener + 6 questions
+ confirmation ≈ 16 messages), so the agent was being told to "always carry
forward known values" for values that had already fallen out of its window.

### Intent is locked by the client

`Intent & Quote-Compare Agent` re-runs its new_quote/compare_quote
classification on **every** turn, with nothing carrying the previous verdict
forward. A flip mid-conversation swaps which agent is driving, and the two
agents keep separate checklists (6 items vs 4) in separate memories — so the
compare agent would reach *its* confirmation step after three answers, and
once the user confirmed, control would fall back to the new-quote agent which
still had `heightMm`/`removeOldFence`/`siteAccess` unset and asked for them
right after the "all correct?" step had supposedly finished.

The frontend now locks the intent to whatever the first turn reported and
echoes it back as `intent` on every later request (`Home.tsx`,
`sendFencingChatMessage`). `Normalize Input1` copies it to `lockedIntent`, and
`Format Comparison Result` prefers it over whatever the classifier decided
this turn. `handleRestart` clears it, so a new session re-decides from scratch.

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
  results: { businessName: string; suburb: string; ratePerMeter: number; estimatedTotal: number; notes: string }[]
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
object back, partially filled in (unknown fields are `null`). It drives the
live "Building your brief" sidebar next to the chat thread, and diffing it
between turns is also how the frontend labels a collapsed answer chip
("Fence type: Colorbond") — the workflow's `options` carry no field name of
their own, so the diff is the only way to know which field an answer filled.

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

The frontend renders this inside the chat thread as a distinct
`ConfirmationCard` (`src/components/ConfirmationCard.tsx` — the checklist as a
bullet list + the two buttons; the recap sentence itself is the normal message
bubble above it), not the MCQ tile row. The two option `value`s must stay the
literal lowercase strings `"yes"`/`"no"`. `checklistComplete` only flips to
`true` on the very next turn, once the user has replied `"yes"` — and that
reply is also the only point where the frontend leaves the chat for the
`ThinkingScreen`.

**A `confirmation` turn is now gated deterministically.** `Format New-Quote
Result1` counts the nulls in the checklist first: if any of the 6 fields is
still unset, a `confirmation` is rewritten into a plain `question` for the
first missing field (using the same canonical option set the prompt hands the
agent), and `checklistComplete` is forced to `false` so the ranking step can
never run on a half-filled brief. `Format Comparison Result` does the same for
its 3 required fields. The prompts ask for this too, but the model was not
reliably obeying and the flag is what fires the ranking.

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

### Multiple quotes in one compare-quote attachment

If the attached content for a `compare_quote` conversation contains more
than one distinct price (several businesses' quotes on one document, or
several documents each with their own price), `Intent & Quote-Compare Agent`
confirms each one individually — reusing the exact same `type: 'confirmation'`
mechanism above, once per quote (`"Quote 1 of 3 — A Plus Fencing: $2400. Is
this correct?"`, then `"Quote 2 of 3 — ..."`, etc., with `existingPrice: null`
in the checklist until all of them are done). No new frontend component or
schema field was needed for this — the frontend just renders whatever
`message`/`options` it's given, same as any other confirmation turn. Once
every quote is confirmed, `existingPrice` is set to the **lowest** of the
confirmed prices (the hardest one to beat, and the most meaningful savings
baseline) before the flow continues as normal. If only one price is found,
none of this applies — it's the same single-`existingPrice` flow as before.

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

### MCQ-first, but typing always works

Both agents' prompts are explicit: **`suburb` is the only field asked as free
text** (plus the optional `existingPrice` in compare-quote, which is never
asked for directly). Every other field comes back as 2-5 `options` with an
exact, prompt-specified label/value set (fenceType's 6 options,
lengthMeters' 4 buckets, heightMm's 2 values, etc.).

That's about what the agent *asks*, not what the user can *answer with*: the
chat composer is always available, so any question can be answered by typing
instead of clicking. The agent is instructed to map a typed reply onto the
closest valid value for the field it just asked about ("about 35 metres" →
`lengthMeters: 35`), and to re-ask with the same options if it genuinely
can't. Nothing on the frontend routes on this — it renders whatever `options`
it's given (empty → the row is just skipped) and sends whatever the user
typed.

### The opener turn

The first turn of a conversation does not ask a checklist question. The agent
acknowledges the description the user typed on the hero screen and asks
whether they're ready for a few questions (`type: 'message'`, `options: []`),
echoing back whatever the description already told it in `checklist`. The
prompt also forbids naming a *number* of questions ("7 quick questions") —
it can't know how many are left, and it was ending up wrong a turn later.

### Errors

No separate error shape. Model/tool/lookup failures come back as an
apologetic `type: 'message'`. The frontend only needs its own error handling
for real network failures (timeout/unreachable).

**`message` is never empty.** It used to be able to be: `Format Comparison
Result` emits `message: ""` by design on every `new_quote` turn (that agent
stays silent and hands off), and the old guards only rejected non-strings, so
an empty string sailed through to the user as a blank chat bubble whenever
that turn was the one being responded to — plus `Format Result Response1`
defaulted its `agentMessage` to `''` inside a try/catch. All three formatter
nodes now treat blank/whitespace-only as missing and substitute either the
question that was actually due or a plain fallback line.

## Known issues in `n8n/fencing-workflow-updated.json`

Historical note — items 1-3 below were found and fixed (1-2 by hand in the
n8n editor, 3 and the `confirmation` step by this integration work). Kept
here as a record; #4 and #7 are the ones still open.

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
5. ~~Blank chat bubbles~~ — **fixed**, see "Errors" above.
5b. ~~Asks for a field the customer already gave (usually the suburb, typed on
   the hero screen)~~ — **fixed** by `knownChecklist`, see above.
5c. ~~Results ignore the customer's suburb entirely~~ — **fixed**, see "Suburb
   matching is exact" above. This was the most damaging one: the suburb was
   collected and displayed but never filtered on.
6. ~~Recaps after three answers, then re-asks the rest~~ — **fixed** by the
   client-side intent lock (see "Intent is locked by the client") plus the
   deterministic checklist gate in `Format New-Quote Result1`.
7. **`Intent & Quote-Compare Agent` still runs an LLM call on every turn even
   when the session is locked to `new_quote`, and writes its `""` hand-off
   reply into `Chat Memory (Compare Flow)` each time.** Wasted tokens and a
   memory full of empty assistant turns. Skipping the node entirely would
   mean rewiring `Format Comparison Result`, which `Fencing AI Agent1`'s
   prompt expression and `Route: New-Quote or Compare Result?` both read
   from — not worth it until the token cost actually matters.

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
