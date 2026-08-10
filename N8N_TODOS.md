# n8n Workflow — Fix List

Companion to [SECURITY_AUDIT.md](SECURITY_AUDIT.md) and [SECURITY_TODOS.md](SECURITY_TODOS.md).
This one is **only** about the workflow behaving predictably. Security items for n8n stay in `SECURITY_TODOS.md` (B3).

**Workflow:** `n8n/fencing-workflow-updated.json` · **26 nodes** (was 37) · agent `Fencing AI Agent1` on `gpt-4o-mini`

---

## ✔ Applied — 2026-08-10

**Tasks 1 through 9 are written into `n8n/fencing-workflow-updated.json` in this repo, and the backup file has been synced to match.** Task 10 is a judgement call left open.

> ### ⚠️ Nothing is live until you import it
> Editing the file in this repo changes nothing on your n8n server. To deploy: **n8n → Workflows → Import from File → `n8n/fencing-workflow-updated.json`**. Export your current live workflow first — that export, not this file, is your rollback.

| Task | What was changed | Where |
|---|---|---|
| 1 | Consent gate on turn 0, code-owned question after that, `expectsSuburb` regex deleted | `Format New-Quote Result1` |
| 2 | "READ FOR MEANING" replaces the document-only mapping rules | system prompt |
| 2b | Falls out of 1 + 4 — no separate change needed | — |
| 3 | Prompt **16,599 → 9,253 chars (44% smaller)** | system prompt |
| 4 | siteAccess deadlock, range contradiction, `existingPrice`/`suggestedSuburb` in examples | system prompt |
| 5 | New `Merge Extracted Files` node; the four extraction branches now converge through it | connections |
| 6 | `extractionFailed` flag, "couldn't read that file" prefix, truncation 4k → 8k keeping the tail | `Normalize Extracted Text`, `Format New-Quote Result1` |
| 7 | Agent `onError: continueErrorOutput`, new `Fallback Response` node, retry 2× on the model node | agent + new node |
| 8 | `"message"` schema gains `minLength: 1`; `maxTokens` 1500 → 2000 | parser + model |
| 9 | 13 orphaned nodes deleted; backup file synced | whole workflow |

**Frontend (done, tested, in the working tree):**

- `turn` sent on every request — [fencingChat.ts](src/services/fencingChat.ts), [Home.tsx](src/pages/Home.tsx)
- Blank-message guard so a `""` from the workflow can never render an empty bubble — [fencingChat.ts](src/services/fencingChat.ts)

**Verification:** `npm run test` **268 pass / 22 files** (was 252) · `npm run build` clean · lint unchanged.
The workflow's own Code-node harness [`n8n/workflow.test.mjs`](n8n/workflow.test.mjs) went from 63 to **76 tests** and runs the real `jsCode` out of the JSON, so the gate logic is covered before it ever reaches n8n.

### 🔴 Fixed after first live test — the consent question looped

Found by running it: answering "Yes, go ahead" produced the consent question again, forever.

**Cause.** `Normalize Input1` is the node that lifts fields out of the request `body` — `message`, `sessionId`, `knownChecklist`, `place`. `turn` was never added to it. So `source.turn` was `undefined`, `Number(undefined || 0)` was `0`, and **every turn looked like the opening turn**.

**Fixed three ways:**

1. `turn` is now mapped in `Normalize Input1`, as `''` when absent — so "not told" stays distinguishable from "turn 0".
2. **The gate fails open.** An unknown turn is treated as mid-conversation, not as 0. Reading absence as 0 is what turned a config slip into an unanswerable chat; at worst this now skips the consent step for one client.
3. Declining matches `no / not right now / nope / not now / later` instead of two exact strings, so a typed reply is not swallowed.

**And a test that actually catches this class of bug:** `every field the code nodes read is actually mapped out of the request` parses `source.X` out of both code nodes' real `jsCode` and asserts `Normalize Input1` provides each one. Verified by removing the mapping — it flags both nodes. The old tests could not have caught it, because they stub `Normalize Input1` by hand and were happily supplying a field the real node never produced.

**Re-import the workflow** — this fix is in the same file.

### Two things found while implementing that the plan had wrong

- **`source` did not exist** in `Format New-Quote Result1` — the node looked `Normalize Input1` up inline every time. The snippet in Task 1 would have thrown `ReferenceError`. A `source` handle was added.
- **`messages.length` was the wrong turn counter.** A first message that failed and was being retried counted as turn 2, so the retry — the attempt the customer actually sees — skipped the consent step. It now counts *successful* AI replies, so a retry is still turn 0. The existing retry test caught this.

### Still open after this

- **Task 10** — trying `gpt-5-mini`. Left deliberately: do it after living with the shorter prompt, or you cannot tell which change helped. Note the orphaned `OpenAI Chat Model2` node is gone, so it is now a one-value edit on `OpenAI Chat Model1`.
- **B3 in [SECURITY_TODOS.md](SECURITY_TODOS.md)** — webhook authentication and `allowedOrigins`. **Not touched here.** The webhook is still open to the internet.
- The **verification steps** below that need your n8n instance: the Merge-node run count, and the 7-conversation test script.

---

## 🛑 Before you import

- [ ] **Export the live workflow from n8n and save it with today's date.** This is your rollback — the file in this repo is not necessarily what has been running.
- [ ] After importing, **open `Merge Extracted Files` and check it shows 4 inputs** wired from the two extract nodes' success and error outputs. This is the one change whose behaviour depends on your n8n version; everything else is plain code and parameters.
- [ ] Run the 7-conversation test script at the bottom before pointing customers at it.

---

## The one root cause

Every symptom you described traces to the same thing:

> **The model decides which question to ask, even though `Format New-Quote Result1` already knows the correct answer deterministically.**

That code node computes `missing` and `nextField` correctly on every turn — and then only uses them in two edge cases (empty message, premature confirmation). Every other turn, whatever the model felt like asking goes straight to the customer.

| Your symptom | Why |
|---|---|
| Asks a question you already answered | Model chose the field; nothing checks it against `missing` |
| Answers a later field first, then it keeps re-asking that one | Same — `nextField` says "suburb", the model says "height again" |
| Empty message | Schema allows `"message": ""`; the code's fallback then substitutes the due question, which reads as a repeat |
| Asks twice on one turn | Separate cause — see Task 5 |
| Errors instead of asking | `maxTokens: 1500` + a 16.6k-char prompt → truncated JSON → parser throws → 500 |
| Can't read PDFs | Extraction failure is silent — see Task 4 |
| Doesn't understand indirect wording | Prompt's mapping rules are scoped to attached documents only — see Task 2 |

---

## Task 1 · Let the code choose the question 🔴

**Node:** `Format New-Quote Result1` · **Effort:** ~15 lines · **Cost impact:** slightly cheaper (shorter outputs)

The model keeps two jobs — read the customer's message into fields, and write a warm sentence. It loses the third: deciding what to ask. The code already knows.

Find this block near the end:

```js
if (missing.length > 0) {
  if (type === 'confirmation') {
    type = ASK[nextField].options.length ? 'question' : 'message';
    message = ASK[nextField].message;
    options = ASK[nextField].options;
  }
}
```

Replace it with:

```js
// Turn 1 is never a checklist question. The customer has just described their job; marching
// straight into an interrogation is how a chat turns into a form. The opener asks permission
// and nothing else, and the code only takes over the questioning from the turn after that.
const CONSENT = {
  message: "That's not quite enough for me to price it accurately. Happy to answer a few quick questions?",
  options: [
    { label: 'Yes, go ahead', value: 'yes' },
    { label: 'Not right now', value: 'no' },
  ],
};

// Sent by the client (see "One small frontend change" below). Turn 0 is the hero description.
const turn = Number($('Normalize Input1').first().json.turn || 0);
const reply = String(source.message || '').trim().toLowerCase();

if (turn === 0) {
  // Whatever their description already told us is still captured in `merged` above — we simply
  // do not ask anything yet.
  type = 'question';
  message = CONSENT.message;
  options = CONSENT.options;
} else if (turn === 1 && (reply === 'no' || reply === 'not right now')) {
  // They declined. Back off gracefully rather than asking anyway — and leave the door open,
  // because the next thing they type resumes the flow normally.
  type = 'message';
  message = "No worries. Whenever you're ready, just tell me a bit more about the fence.";
  options = [];
} else if (missing.length > 0) {
  // The model writes prose; the code decides the question. `missing` is computed above from the
  // merged checklist and is the only trustworthy view of what is still needed — the model has
  // repeatedly asked for fields it was already told, and re-asked a later field while an earlier
  // one sat empty. Keeping its acknowledgement and replacing its question keeps the warmth and
  // removes the guesswork.
  //
  // Keep only the model's first sentence: that is the "Nice, 25 metres." part. Anything after
  // it is the question we are about to replace anyway.
  const ack = (typeof parsed.message === 'string' ? parsed.message.trim() : '')
    .split(/(?<=[.!?])\s+/)[0]
    .slice(0, 90)
    .trim();
  // Drop an acknowledgement that is itself a question — the model sometimes puts its question
  // first, and prefixing one question with another reads as two.
  const keep = ack && !ack.includes('?') ? ack + ' ' : '';

  message = keep + ASK[nextField].message;
  options = ASK[nextField].options;
  type = options.length ? 'question' : 'message';
}
```

Then, further down, **simplify the suburb-picker trigger** — this is now possible because the consent opener carries options:

```js
// Was: nextField === 'suburb' && options.length === 0 && /\bsuburbs?\b|\bpost ?code\b/i.test(message)
//
// The wording test existed only to keep the picker off the opening greeting, which used to be a
// question with no options and so looked exactly like a suburb turn. The consent opener now
// carries Yes/No options, so `options.length === 0` tells them apart on its own — and the
// fragile business of two codebases having to agree on a regex goes away with it.
const expectsSuburb = nextField === 'suburb' && options.length === 0;
```

### One small frontend change this needs

The code node cannot tell turn 1 from turn 2 on its own — an empty `knownChecklist` happens on both when the first message established nothing, which is exactly the case that would ask for consent twice. The client already knows, so it should say. In [Home.tsx](src/pages/Home.tsx), inside `sendMessage`:

```ts
const response = await sendFencingChatMessage(apiText, sessionId, quoteFiles, {
  intent,
  turn: messages.length,   // 0 on the hero description, and never 0 again
  knownChecklist: /* unchanged */,
  place: confirmedPlace ?? place,
})
```

…plus the matching field in `SessionContext` and in the payload builder in [fencingChat.ts](src/services/fencingChat.ts). Two lines each, no behaviour change on its own. Reopened conversations start with `initialSession.messages` already populated, so they never read as turn 0 — which is correct: consent was given the first time round.

**What changes for the customer**

- **Turn 1 asks permission, with Yes and No buttons** — no checklist question until they agree
- "Not right now" is respected instead of ignored
- Never asked about a field that already has a value
- Never asked out of order — always the first field still missing
- Never a premature "all correct?"
- Never an empty bubble
- Options always exactly match the question (they come from `ASK`, not the model)
- The suburb picker never lands on the greeting, and no longer depends on a regex matching

**Will it break anything?** No. `ASK` already holds the exact same question text and option arrays the prompt tells the model to use, and the frontend already renders whatever `options` it is given. The response shape is unchanged apart from the new `turn` field going *in*, which older workflow versions would simply ignore.

**Rollback:** put the old block back. Nothing else depends on it.

**Prompt follow-up:** once the code owns the opener, delete the whole **"THE OPENER — FIRST TURN ONLY"** section from the system message (Task 3). It is now dead instruction that can only contradict the code.

---

## Task 2 · Teach the prompt to find *meaning*, not keywords 🔴

**Node:** `Fencing AI Agent1` → `systemMessage` · **Cost impact:** cheaper (Task 3 shrinks the prompt)

Right now the excellent shorthand-mapping rules live inside a section headed **"READING AN ATTACHED QUOTE OR PHOTO"**, so the model applies them to documents and not to what people type. And the typed-input rule actively works against you:

> *"map what they typed onto the closest valid value **for the field you asked about**… never treat an unrelated question from them as an answer"*

That is why *"dispose the old 25 metre fence"* gets rejected instead of filling two fields.

**Replace the "IF THEY TYPE INSTEAD OF PICKING" section with:**

```
READ FOR MEANING, EVERY TIME (CRITICAL):

Every message you receive — typed by the customer, or extracted from an attached document —
is described in whatever words that person or that business happened to use. Nobody writes
your field names. Your job is to work out what they MEANT and fill in every field it settles,
not just the one you asked about.

ONE MESSAGE CAN ANSWER SEVERAL FIELDS. Take all of them.
  "dispose the old 25 metre fence"     -> lengthMeters 25, removeOldFence true
  "25 meter L and 1.8H"                -> lengthMeters 25, heightMm 1800
  "25m x 1800, colorbond, pakenham"    -> lengthMeters 25, heightMm 1800,
                                          fenceType Colorbond, suggestedSuburb "pakenham"
  "need the old paling one taken away" -> fenceType Timber, removeOldFence true

TRADE SHORTHAND YOU WILL SEE (this list is examples, not the whole language — reason by
meaning, and if a phrase clearly means one of these things, treat it as that thing):
- Length:  "L", "lin m", "lineal metres", "LM", "run", "m of fence", "linear"
- Height:  "H", "high", "1.8H", "1800mm", "6ft", "6 foot", "1.8m"
- Removal: "disposal", "remove", "demolish", "dismantle", "take away", "tear out",
           "pull down", "cart away", "rip out", "old fence removal", "make good"
- Timber:  "paling", "hardwood", "treated pine", "pine", "wood", "picket", "lapped and capped"
- Colorbond: "colorbond", "colourbond", "steel fence", "sheet fence"
- Aluminium: "aluminium", "aluminum", "slat", "batten screen"
- Pool:    "pool fence", "glass pool", "frameless", "semi-frameless", "pool compliant"
- Security: "chainmesh", "chain wire", "chain link", "mesh", "security fence"
- Rural:   "post and wire", "farm", "paddock", "stock fence", "ringlock"

WHEN A PHRASE IS NOT ON THAT LIST, still try. "Knock down the old one" is removal.
"Two metres tall" is heightMm 2000. Only give up when a sentence genuinely settles nothing.

WHAT NOT TO DO:
- Do NOT reject an answer because it was not about the field you asked. Take what it gives you.
- Do NOT ask a question about anything you just worked out, or anything in the established block.
- Do NOT invent a value you are not reasonably sure of. Unsure is null — asking is cheap,
  quoting the wrong fence is not.
- If they asked YOU something, answer it in one line first, then carry on.
```

**What changes for the customer**

- A single sentence can fill three or four fields — the conversation gets dramatically shorter
- Trade jargon in an attached quote is understood instead of ignored
- Answering "sideways" stops being punished

**Will it break anything?** No — the schema, the fields and the response shape are unchanged. Combined with Task 1 the risk of over-extraction is contained: the code still owns which question comes next, so a wrong guess costs one correction, not a derailed conversation.

---

## Task 2b · Suburb re-checking — already built, the prefill is what's broken 🟠

**Do not add a location lookup to n8n.** It already exists on the client, it is cheaper there, and duplicating it would add latency to every turn. Here is what is actually in place today:

| Requirement | Status |
|---|---|
| A suburb that isn't proper gets asked again | ✅ `isMissing()`: `if (field === 'suburb' && !place) return true` — suburb counts as missing until the customer picks a real place, no matter who wrote the name down |
| The agent can't "settle" it by guessing | ✅ Hard override in `Format New-Quote Result1`: `if (checklist.suburb && !place)` forces the suburb question back, discarding whatever the model wanted to ask |
| Google autocomplete field | ✅ [SuburbPicker.tsx](src/components/SuburbPicker.tsx) — debounced, 3-char minimum, AU-restricted, session-token billed |
| Customer only has to confirm | ✅ `prefillSuburb()` in [Home.tsx](src/pages/Home.tsx) pre-loads the picker with whatever they (or their PDF) called the place — one tap, no typing |
| Only a confirmed place counts | ✅ Typed text is looked up first and never sent as an answer |

**So why does it feel like it isn't working?** The prefill has a trigger, and the trigger is a regex — and the two sides disagree:

```
n8n      →  /\bsuburbs?\b|\bpost ?code\b/i
frontend →  /suburbs?|post ?code|whereabouts/i        ← has "whereabouts", n8n doesn't
```

When the model writes *"Whereabouts is the fence going?"*, the frontend opens the picker but n8n never set `expects`/`suggestedSuburb` — so the picker comes up **empty** and the customer types the suburb from scratch, exactly the thing the feature exists to avoid.

- [x] **Task 1 fixes this on its own** — the message becomes the fixed `ASK.suburb.message`, which always contains the word "suburb". Then delete the regex entirely (see the `expectsSuburb` snippet in Task 1).
- [x] **Task 4 is the other half** — `suggestedSuburb` appears in no prompt example, so the model rarely emits it. Without it there is nothing to prefill *with*, even when the trigger fires.

Do Task 1 and Task 4, and the "type it again" problem goes away. No new nodes, no extra API calls.

---

## Task 3 · Cut the prompt roughly in half 🟠

**Node:** `Fencing AI Agent1` → `systemMessage` · **Cost impact:** meaningfully cheaper — this text is billed on **every single turn**

The prompt is **16,599 characters (~4,000 tokens)** sent with every message. A large part of it is the option arrays and worked JSON examples — **all of which already exist in `Format New-Quote Result1`'s `ASK` map**, which is what actually gets used after Task 1.

- [x] Delete the whole **"HOW TO ASK QUESTIONS (THE MCQ RULE) - STRICT MAPPING"** section — the code supplies options now
- [x] Cut examples 1–5 down to **two** (one question turn, one confirmation turn)
- [x] Delete **"CRITICAL UI RULE"** — it only matters if the model writes options, which it no longer does
- [x] Delete **"NEVER PROMISE A NUMBER OF QUESTIONS"** and **"ACKNOWLEDGE, THEN ASK"** wording rules down to one line each
- [x] Keep in full: the checklist definitions, the ALREADY-ESTABLISHED block, unit conversion, the new Task 2 section, and the output format rule

**Target: under 8,000 characters.**

**What changes:** fewer instructions to contradict each other, less truncation risk, lower cost per turn, and a model that follows what remains more reliably.

**Will it break anything?** Only if you delete Task 1 as well. Do Task 1 **first**, confirm options still render in the app, then cut the prompt.

---

## Task 4 · Fix the contradictions the prompt argues with itself about 🟠

**Node:** `Fencing AI Agent1` → `systemMessage`

- [x] **`siteAccess` deadlock.** Field 6 says *"ONLY ASK IF removeOldFence IS true… leave it null"*, but *"COUNT BEFORE YOU CONFIRM"* says confirmation needs **all six** non-null. With `removeOldFence: false` the model can never legally confirm.
      → Change "ALL SIX checklist fields" to **"every field that still applies (siteAccess does not apply when removeOldFence is false)"**
- [x] **Example 3 contradicts field 6** — it shows `removeOldFence: false` *with* `siteAccess: "easy"`. Change it to `siteAccess: null`.
- [x] **Ranges.** *"NEVER A RANGE"* says one exact number always; the UNITS section says *`"60-90 feet" -> "18-27"`*. Delete the range example from UNITS.
- [x] **`existingPrice` and `suggestedSuburb` appear in no example.** The model therefore rarely emits them — and `intent` is derived from `existingPrice`, so **`compare_quote` almost never fires**. Add both fields to the two surviving examples.

**What changes:** the confirmation step becomes reachable for jobs with no old fence; attached-quote totals actually get captured, which turns the results page into the direct comparison it was built for.

---

## Task 5 · Stop the agent running more than once per turn 🔴

**Nodes:** the extraction branches · **Cost impact:** could cut OpenAI spend per attachment turn by 2–4×

`Normalize Extraction Field` has **four** incoming connections:

```
Extract PDF   --main0 (success)--> Normalize Extraction Field
Extract PDF   --main1 (error)  --> Normalize Extraction Field
Extract Image --main0 (success)--> Normalize Extraction Field
Extract Image --main1 (error)  --> Normalize Extraction Field
```

In n8n a node with several incoming connections runs **once per branch that carries data**, and everything downstream — including `Fencing AI Agent1` — runs again with it. Each run writes another turn into the memory buffer, so on the next message the model reads its own duplicated question and gets confused.

- [ ] **Diagnose first.** Open an execution where a file was attached and look at the run count on `Fencing AI Agent1`. More than 1 confirms it.
- [x] **Fix:** insert a **Merge** node (mode: *Append*, inputs: 4) between the four outputs and `Normalize Extraction Field`.
- [ ] Re-run the same attachment and confirm the agent shows exactly one run.

**What changes:** one question per turn, clean memory, and the OpenAI bill for attachment turns drops by however many times it was duplicating.

**Will it break anything?** The Merge node passes items straight through, so `Aggregate Extracted Text` still receives the same items. Test with: no file, one PDF, one image, and a PDF + image together.

---

## Task 6 · Make a failed PDF say so 🟠

**Nodes:** `Normalize Extraction Field`, `Normalize Extracted Text`, `Format New-Quote Result1`

When extraction fails, the error branch produces no `text`, so `extractedTextPart` becomes `''` and the agent **never learns a document was attached**. The customer watches their quote get ignored in silence.

- [x] ~~Add an `extractionFailed` assignment to `Normalize Extraction Field`~~ — **not needed.** The Aggregate node only carries `extractedTextPart` through, so the flag would have been dropped anyway. It is derived in `Normalize Extracted Text` instead: an attachment went through extraction and produced nothing.
- [x] In `Normalize Extracted Text`, carry it through:
      ```js
      const failed = current.extractionFailed === true ||
        (Array.isArray(combined) && combined.length > 0 && !extractedText);
      return [{ json: { message: source.message, sessionId: source.sessionId, extractedText, extractionFailed: failed } }];
      ```
- [x] In `Format New-Quote Result1`, when `extractionFailed` is true and `extractedText` is empty, prefix the reply:
      *"I couldn't read that file, sorry — can you tell me the total and the length?"*

- [x] **Also raise the truncation limit.** `extractedText` is cut at `slice(0, 4000)`. A multi-page quote loses its end — and **the Total is always at the end**. Raise to 8000, or keep the first 4000 **plus the last 2000**.

**What changes:** "it ignored my PDF" becomes "it told me it couldn't read my PDF and asked" — a far better failure, and one you can actually act on.

---

## Task 7 · Never return a 500 to React 🔴

**Nodes:** `Fencing AI Agent1`, plus one new Code node

Today, if the structured output parser throws (truncated JSON, malformed output), the workflow dies before `Respond to Webhook1`. React handles it correctly — the customer sees *"Sorry, something went wrong on my end"* with a working **Try again** — but the turn is lost and you learn nothing.

Since the code node already knows what to ask, a parse failure does not have to end the turn.

- [x] On `Fencing AI Agent1`, set **On Error → Continue (using error output)**
- [x] Add a Code node **`Fallback Response`** on the error output, wired to `Respond to Webhook1`:

```js
// The model failed to produce parsable JSON. Everything needed to carry on is still here:
// the checklist the client sent us, and the fixed question for whatever is still missing.
// Answering deterministically beats a 500 the customer has to retry into.
const source = $('Normalize Input1').first().json;
let known = {};
try { known = JSON.parse(source.knownChecklist || '{}') || {}; } catch { known = {}; }
let place = null;
try { place = JSON.parse(source.place || 'null'); } catch { place = null; }

const FIELDS = ['suburb', 'fenceType', 'lengthMeters', 'heightMm', 'removeOldFence', 'siteAccess'];
const ASK = { /* paste the same ASK map from Format New-Quote Result1 */ };

const isMissing = (f) => {
  if (f === 'suburb' && !place) return true;
  if (f === 'siteAccess' && known.removeOldFence === false) return false;
  return known[f] === null || known[f] === undefined;
};
const nextField = FIELDS.filter(isMissing)[0];

return [{ json: {
  sessionId: source.sessionId,
  intent: known.existingPrice != null ? 'compare_quote' : 'new_quote',
  place,
  type: nextField && ASK[nextField].options.length ? 'question' : 'message',
  message: nextField ? ASK[nextField].message : 'Sorry, I lost my place there — could you say that again?',
  options: nextField ? ASK[nextField].options : [],
  ...(nextField === 'suburb' ? { expects: 'suburb' } : {}),
  checklistComplete: false,
  checklist: Object.keys(known).length ? known : null,
  results: [],
  avgRatePerMeter: null,
} }];
```

- [x] Also set **Retry On Fail: 2 tries, 1000 ms** on `OpenAI Chat Model1` — that one is for transient API errors, which a retry genuinely fixes.
- [x] Do **not** retry the parser. The same input produces the same bad output; retrying just bills you twice for the same failure.

**What changes:** a bad model turn costs the customer nothing — they get the right next question anyway. Your workflow stops returning 500s, and the conversation never dead-ends.

**Does React get the error?** Yes, today it already does — see the verification table at the bottom. After this task it mostly stops needing to.

---

## Task 8 · Tighten the output schema 🟡

**Node:** `Structured Output Parser (New Quote)`

- [x] `"message": { "type": "string", "minLength": 1 }` — an empty string currently passes validation, which is where the blank bubbles come from
- [x] Raise `maxTokens` on `OpenAI Chat Model1` from **1500 → 2000**, at least until Task 3 has shrunk the prompt

---

## Task 9 · Delete the 13 orphaned nodes 🟡

None of these are connected to anything. They cannot run, and they make the canvas read as though a compare-quote flow exists when it does not:

`Intent & Quote-Compare Agent` · `Chat Memory (Compare Flow)` · `Structured Output Parser (Compare)` · `Format Comparison Result` · `Intent Router: Compare or New?` · `Comparison Checklist Complete?` · `Route: New-Quote or Compare Result?` · `Rank & Format Comparison Response` · `Dummy Firebase Workers Data1` · `Query Firestore Workers1` · `Rank and Format Top` · `Format Result Response1` · **`OpenAI Chat Model2` (gpt-5-mini)**

Comparison is not a separate flow any more — it is `existingPrice` being present, decided in `Format New-Quote Result1`. These are leftovers from the old design.

- [x] Delete them
- [x] Apply every change in this file to **`n8n/fencing-workflow-updated (backup).json`** as well, or re-importing the backup silently undoes all of it

---

## Task 10 · Consider `gpt-5-mini` ⚪ — *after* Task 3

`OpenAI Chat Model2` is already configured with `gpt-5-mini` and wired to nothing. Once the prompt is under 8k characters, swap the agent's model over and run the same five test conversations.

Do it **after** Task 3, not before — otherwise you will not know whether an improvement came from the model or from the shorter prompt.

---

## Your ideas — straight answers

**"No loops"** — Agreed, don't add one. A retry loop around a model that produced bad output tends to produce bad output again, and bills you each time.

**"Should the agent re-verify its own answer?"** — Verify, yes. With a **second AI call, no.** Validation belongs in the Code node: it is free, instant, and gives the same answer every time. A verifier model costs double and can be wrong too. Task 1 *is* the verification you were reaching for — it just runs in JavaScript instead of in a model.

**"Cost matters"** — These tasks reduce it. Task 5 stops duplicate agent runs, Task 3 cuts ~4k tokens off every turn, Task 1 shortens outputs. Nothing here adds an LLM call.

**"Retry on error, then stop"** — Exactly right, with one refinement: retry **transient** failures (Task 7's `Retry On Fail` on the model node), and answer **deterministically** on parse failures rather than retrying. That is what makes it predictable and shows you where things break.

**"Verify each PDF's data separately"** — Half of this already works: `Split Attachments by Binary Key` turns every file into its own item and each is extracted independently. What is missing is knowing when one failed (Task 6). Per-file *fact attribution* — "the total came from file 2" — is possible but is real work, and you should only build it once customers actually attach several quotes at once.

---

## Order to do them in

| # | Task | Fixes | Risk |
|---|---|---|---|
| 1 | Code chooses the question **+ consent gate** | Repeats, out-of-order, empty, premature confirm, asking before they agreed | 🟡 needs the 2-line `turn` field |
| 2 | Prompt reads for meaning | Jargon, indirect answers, mixed answers | 🟢 none |
| 4 | Prompt contradictions | siteAccess deadlock, missing `existingPrice`/`suggestedSuburb` | 🟢 none |
| 2b | Suburb prefill | "It made me type the suburb again" — falls out of 1 + 4 | 🟢 none |
| 5 | Merge node | Double questions, duplicated memory, 2–4× cost | 🟡 test attachments |
| 7 | Never return 500 | Dead-ended turns | 🟢 additive |
| 6 | PDF failure visible | "It ignored my PDF" | 🟢 additive |
| 8 | Schema + maxTokens | Empty messages, truncation | 🟢 none |
| 3 | Shrink prompt | Cost, truncation, drift | 🟡 do after 1 |
| 9 | Delete orphans | Confusion | 🟢 none |
| 10 | Try gpt-5-mini | Maybe accuracy | 🟡 A/B after 3 |

**Tasks 1, 2 and 4 together fix every symptom on the list.** If you only do three things, do those — 2b then costs nothing extra, because it is a consequence of the other two rather than work of its own.

---

## Test script — run this after every task

Five conversations. Each should behave identically before and after, except for the bug being fixed.

1. **Plain:** "I need a fence" → **first reply must be the consent question with Yes/No, not a checklist question** → Yes → answer everything in order → confirm → results
2. **Out of order:** "1.8m high colorbond" as the *first* message → after consent it must ask **suburb** next, never height again
3. **Mixed/indirect:** "dispose the old 25 metre fence" → must fill `lengthMeters 25` **and** `removeOldFence true` in one turn
4. **Declining:** answer the opener with **"Not right now"** → must back off, not ask anyway → then type something → must resume normally
5. **Suburb prefill:** mention a suburb in the first description → when the suburb turn comes, the picker must open **already showing Google matches**, needing one tap
6. **Attachment:** attach a real quote PDF → check `Fencing AI Agent1` ran **once**, and that length/height/type/total were all extracted
7. **Broken attachment:** attach a corrupt or password-protected PDF → must say it couldn't read it, not ignore it

Tests 2, 3 and 5 are the ones failing today. Test 6's run count is the one people forget to look at.

---

## Verified: React already handles workflow errors correctly ✅

Checked against the frontend as it stands today — no changes needed on that side.

| Workflow does this | React does this |
|---|---|
| 500 / crash before `Respond to Webhook` | In-thread *"Sorry, something went wrong on my end"* + **Try again** that replays the exact payload, files included |
| Takes longer than 30 s | Same — axios timeout, same message, same retry |
| Returns a shape that isn't valid | Rejected at [fencingChat.ts:166](src/services/fencingChat.ts#L166), same error path |
| Returns `type: 'result'` with no matches | Kept in the thread so the reason is readable, not an empty results page |
| Returns an empty `message` | ⚠️ **Renders an empty bubble** — the frontend accepts `""` as a valid string. Task 8 fixes this at the source. |

The one gap is that empty-string message. Everything else is already handled.
