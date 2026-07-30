# Fencing AI Agent — n8n Integration

How this React app talks to the n8n "Fencing AI Agent" workflow. The workflow
itself lives in a separate repo/folder (`all thing claude/workflows/fencing-ai-agent.json`)
— this doc is the contract between that workflow and this frontend, so UI
work here can start without needing n8n open side by side.

## What the workflow does

One webhook. You send a chat message + a session id, it sends back one of
three response shapes: a normal chat reply, a multiple-choice question, or a
final result (top matching fencing businesses + pricing). The agent gathers
a 6-item checklist (suburb, fence type, length, height, old-fence removal,
site access) conversationally, then a deterministic step (not the LLM) looks
up real businesses in Firebase and computes pricing.

**Not live yet:** Firebase isn't populated/connected on the workflow side
yet, so `result`-type responses will come back with an empty `results` array
until that's done. Don't read an empty result as a frontend bug while
testing early.

## Endpoint

```
POST {N8N_BASE_URL}/webhook/fencing-chat-api      # production (after the workflow is Activated)
POST {N8N_BASE_URL}/webhook-test/fencing-chat-api # while testing from the n8n editor, before activating
```

`N8N_BASE_URL` is whatever host your n8n instance runs on (n8n Cloud
subdomain, or self-hosted URL) — ask for it if it's not been shared yet, it's
not something to guess into an env file.

Headers: `Content-Type: application/json`. No auth header — the webhook is
currently open (`allowedOrigins: "*"` on the n8n side). Fine for dev; narrow
that to this app's real domain once there's a production URL, and revisit
whether the endpoint needs its own auth before going live.

## Request body

```ts
interface FencingChatRequest {
  message: string;   // free text, OR the `value` of a clicked MCQ option — see "Answering a question" below
  sessionId: string;
}
```

`sessionId`: one per conversation, generated client-side
(`crypto.randomUUID()`), sent unchanged on every message in that
conversation. It's the key n8n's chat memory uses to remember prior turns —
a new id starts a fresh conversation with no memory of the old one. Chat
memory is in-memory on the n8n side for now (not persisted to a database),
so it resets if the n8n instance restarts — don't build any assumption of
infinite/durable history into the frontend.

## Response body

Always one JSON object, one of three shapes based on `type`:

```ts
type FencingChatResponse =
  | {
      type: 'message';
      sessionId: string;
      message: string;       // render as a normal chat bubble
      options: [];
      results: [];
      avgRatePerMeter: null;
    }
  | {
      type: 'question';
      sessionId: string;
      message: string;                              // the question text
      options: { label: string; value: string }[];   // render as buttons/chips, 2-5 of them
      results: [];
      avgRatePerMeter: null;
    }
  | {
      type: 'result';
      sessionId: string;
      message: string;   // friendly intro line (or a "no matches" note if results is empty)
      options: [];
      results: {
        businessName: string;
        ratePerMeter: number;
        estimatedTotal: number;
        notes: string;    // e.g. "standard height 1800mm, + $24/m for old fence removal" — may be empty string
      }[];
      avgRatePerMeter: number | null;
    };
```

`results` is already sorted cheapest-first and capped at 3 — no
client-side sorting/slicing needed.

### Answering a question

When `type: 'question'`, the user picks one of `options`. Send that option's
**`value`** (not the `label`) back as `message` on the next request, same
`sessionId`. The agent reads it as a normal chat message — there's no
separate "answer a question" endpoint.

### Errors

There's no separate error shape. If anything fails on the workflow side
(model call, tool call, or the Firebase lookup), you still get back a normal
`type: 'message'` response with an apologetic `message` string — render it
like any other chat bubble, no special-casing needed. The only case this repo
needs its own error handling for is a real network failure (request never
reached n8n, or timed out) — wrap the axios call in a try/catch for that,
same as any other API call in this app.

## Where this plugs into the existing structure

Per this repo's `CLAUDE.md`: `src/services/` is where API calls live, and
Zustand (`src/store/`) is for shared client UI state, not for caching server
responses. Two things worth deciding when the chat UI actually gets built:

- **Don't reuse `src/services/api.ts`'s axios instance as-is** — it points
  at this app's own backend (`VITE_API_BASE_URL`, defaults to `/api`) and its
  request interceptor attaches this app's own `authToken`, which has nothing
  to do with the n8n webhook. A separate small instance/function (e.g.
  `src/services/fencingAgent.ts`), pointed at its own `VITE_FENCING_AGENT_URL`
  env var, keeps the two unrelated auth/base-URL concerns from leaking into
  each other.
- **Where `sessionId` and the message list live** is a call for whoever
  builds the chat page — a Zustand store is a reasonable fit for the
  in-progress conversation (it's live UI state, not a cached server
  response), but that's a decision for build time, not something this doc
  is prescribing.

## Quick manual test (before any UI exists)

```bash
curl -X POST "{N8N_BASE_URL}/webhook-test/fencing-chat-api" \
  -H "Content-Type: application/json" \
  -d '{"message":"hi, need a fence quote","sessionId":"test-1"}'
```

Should come back `type: "message"` with a friendly opener. Keep POSTing with
the same `sessionId`, answering whatever it asks, until you get a `type:
"result"` (or, right now, a graceful "no matches" `result` — see the
Firebase note at the top).
