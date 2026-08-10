# Production & Security Audit — Agent Fence

**Date:** 2026-08-09 · **Branch:** `fix/security` @ `361d3de` · **Method:** full read of `src/`, `functions/`, config, git history; `npm run build`, `npm run test`, `npx oxlint` executed; production bundle in `dist/` inspected.

---

## The one-paragraph answer

The application code itself is **better than average** — no XSS surface, no tokens in localStorage, a genuinely careful OTP flow, real loading states, and error handling on every network call. No secret has ever leaked into git (verified by a full scan of every tracked file). What is missing is the **layer underneath and around it**: the Firestore/Storage/Realtime-DB security rules that are supposed to stop a crafted request are not in this repository at all, the Google Maps key is knowingly unrestricted and is sitting in the public JS bundle, the n8n webhook is completely unauthenticated with two OpenAI models behind it, there is no Firebase App Check in front of paid SMS, and there is no CSP or error boundary. A user typing a URL that doesn't exist gets a **blank white page**. One thrown render error anywhere gets the **same blank white page**.

| | Score | Verdict |
|---|---|---|
| **Overall production readiness** | **5.6 / 10** | Not ready for real traffic. Three blockers. |
| **Chance of breaking in production** | **MEDIUM–HIGH** | Blank-screen failure modes are reachable today. |
| **Chance of being exploited by an attacker** | **MEDIUM–HIGH** | Dominated by unverifiable DB rules. |
| **Chance of a runaway bill** | **🔴 CRITICAL** | Four metered services are reachable by anyone, uncapped. |
| **Chance of a secret leaking via git** | **LOW** | Clean. Full secret scan found nothing. |

### Per-phase scores

| Phase | Score | One-line verdict |
|---|---|---|
| 1 · Authentication & Authorization | **7 / 10** | OTP flow is genuinely good; the authorization layer is invisible to this repo. |
| 2 · UI, State & Loading | **8 / 10** | Best area. One real leak: sign-out does not clear the browser. |
| 3 · Routing & Navigation | **4 / 10** | No 404 page. A wrong URL is a blank screen. |
| 4 · Error Handling | **5 / 10** | Per-call handling is careful. Nothing catches a render crash. |
| 5 · Security & Validation | **5 / 10** | Zero XSS surface, good form validation — undone by keys and missing rules. |
| 6 · Production Readiness | **7 / 10** | Build clean, 162 tests pass, env hygiene correct. |
| 7 · Secrets & Repo Hygiene | **8 / 10** | Nothing leaked. One broken `.gitignore` pattern. |
| 8 · Cost & Billing Control | **1 / 10** | No cap, no quota, no alert, on any of four metered services. |

---

## Blockers — fix before launch

### 🔴 B1 · No security rules under version control, and the browser writes everything

**Severity: CRITICAL (if rules are loose) · Confidence: cannot verify from this repo**

`firebase.json` deploys **functions only**. There is no `firestore.rules`, no `storage.rules`, no `database.rules.json` anywhere in the project. Meanwhile the browser is the sole author of every one of these writes:

| Path | Written from | Risk if rules are permissive |
|---|---|---|
| `jobs/{jobId}` | [jobs.ts:141](src/services/jobs.ts#L141) | Fabricated leads |
| `users/{phone}` | [jobs.ts:148](src/services/jobs.ts#L148) | **Doc ID is the phone number, not the uid** — overwrite another customer's name/email |
| `businesses/{id}/incoming_jobs/{jobId}` | [jobs.ts:175](src/services/jobs.ts#L175) | Spam any business's inbox |
| `businesses/{id}/accepted_jobs/{jobId}` | [jobs.ts:175](src/services/jobs.ts#L175) | Write `status: 'accepted'`, `autoAccepted: true` on your own injected lead |
| `quotes/{sessionId}` | [quotes.ts:106](src/services/quotes.ts#L106) | `uid` is a **client-supplied field** — set it to anyone |
| `chats/{id}/meta`, `.../messages`, `userChats/{uid}` | [chat.ts:58-89](src/services/chat.ts#L58-L89) | Post into another user's chat thread |
| Storage `transcripts/`, `chats/*/media/` | [transcript.ts:100](src/services/transcript.ts#L100) | Upload / read arbitrary transcripts |

The client-side code is honest — it writes the phone from the verified OTP session, the uid from Firebase. But a client is not an enforcement point. `curl` with a valid ID token bypasses every one of those checks. **The rules are the only thing standing between an attacker and this table, and I cannot see them.**

**Do this:**
1. `firebase firestore:rules:get`, `firebase database:get /.settings/rules`, and export the Storage rules from the console. Commit all three to this repo.
2. Add them to `firebase.json` so they deploy with the code and cannot silently drift.
3. Confirm each path enforces `request.auth.uid == resource.data.uid`, and that `users/{phone}` is keyed or gated so a signed-in user can only touch their own record.
4. Re-audit once they are visible.

Until step 1 is done, treat this as **CRITICAL**.

---

### 🔴 B2 · Google Maps API key is unrestricted and public

**Severity: HIGH (financial) · Confidence: confirmed**

The key `AIzaSyDRc7VKySgAc5gSSnFEmV_91HoIbbDxx_g` is baked into `dist/assets/index-bw5qe2Ui.js` — verified by grepping the built bundle. That part is unavoidable; the Maps web SDK works that way.

What is avoidable is that it is **unrestricted**, and your own `.env` says why:

> *"Careful: the key below is shared with the Flutter app, and a referrer restriction would break it there (mobile apps send no referrer). Give the web app its own key before restricting."*

That note was written and then not acted on. Anyone can lift the key out of your JS and bill Places Autocomplete + Details to the `quotemy-ai` project — roughly **$17 per 1,000 sessions**, uncapped.

**Do this:** mint a second key for the web app only → HTTP-referrer restriction listing `agent-fence.vercel.app`, `localhost:5173`, and `*.vercel.app` → API restriction to *Maps JavaScript API* + *Places API* → set a **daily quota cap** (see §Billing). Leave the Flutter key alone. **~15 minutes of console work.**

---

### 🔴 B3 · The n8n webhook is completely unauthenticated, with two OpenAI models behind it

**Severity: CRITICAL (financial) · Confidence: confirmed from the workflow export**

Read out of `n8n/fencing-workflow-updated.json`:

| Setting | Value |
|---|---|
| Node | `n8n-nodes-base.webhook` — "Webhook (React Input)" |
| Path | `fencing-chat-api` |
| **Authentication** | **none** |
| **`allowedOrigins`** | **`*`** — any website in the world may call it from a browser |
| Accepts | binary uploads via `quoteFile` |
| Behind it | `lmChatOpenAi` → **`gpt-4o-mini`**, `lmChatOpenAi` → **`gpt-5-mini`**, 2 LangChain agents, 3 Firestore nodes |

The full URL is in your public JS bundle (`n8n.srv1506542.hstgr.cloud/webhook/fencing-chat-api` — verified in `dist/`). So:

```bash
# Anyone. No key, no token, no origin check. Every call costs you OpenAI credits.
while true; do curl -X POST https://n8n.srv1506542.hstgr.cloud/webhook/fencing-chat-api \
  -H 'Content-Type: application/json' -d '{"message":"...","sessionId":"x"}'; done
```

This is worse than the Maps key: there an attacker at least has to bother extracting a key. Here the endpoint is simply open. And because the workflow accepts **file uploads** which get text-extracted into the model context, one crafted request can carry a very large token count — a script does not need many requests to become expensive.

There is also no visible rate limiting in the workflow, and the VPS itself is a flat-rate box, so nothing throttles the loop.

**Regression trap:** `n8n/fencing-workflow-updated (backup).json` is also tracked in git and carries the **identical** insecure config — `authentication: none`, `allowedOrigins: "*"`, same two models. Whoever hardens the live workflow must fix the backup too, or the next re-import silently reopens the hole. (Neither file contains credentials — n8n strips those on export — so this is a config regression risk, not a secret leak.)

**Do this (in order of how fast they help):**
1. **OpenAI hard spend limit** — Platform → Billing → Usage limits. This is the only true ceiling; do it today, before anything else.
2. **Shared secret on the webhook** — n8n webhook node → Authentication → *Header Auth*. Frontend sends the matching header from a `VITE_` var. Note: that header is visible in the bundle too, so it is a speed bump against scripts, not a real secret. It stops opportunistic abuse, not a determined attacker.
3. **The real fix** — send the Firebase ID token in the request and verify it in a Code node at the top of the workflow, so only signed-in users can spend your OpenAI budget. Requires making the chat sign-in-first, which is a product decision.
4. **Narrow `allowedOrigins`** from `*` to your actual domains.
5. Add a rate-limit / IP-throttle in front of n8n (Caddy or nginx on the Hostinger VPS).

---

## High findings

### 🟠 H1 · No Firebase App Check — SMS is billable and unprotected

Phone auth is gated only by Firebase's invisible reCAPTCHA. That stops a casual script, not a determined one. Every `sendOtp` is a **paid SMS** ([otp.ts:68](src/services/otp.ts#L68)), and both `SignInDialog` and `InstantQuoteFlow` expose it to anonymous visitors with no server-side rate limit. This is the classic SMS-pumping setup: an attacker cycles premium-rate numbers and you pay.

**Fix:** enable App Check with reCAPTCHA Enterprise and enforce it on Auth, Firestore, Storage, and the `createHandoff` function. Set an SMS region policy (AU only) and a daily quota in the Firebase console. *The 30-second client-side cooldown in the dialogs is UI courtesy, not a control — it lives in React state.*

### 🟠 H2 · Signing out does not clear the browser; a second user sees the first user's quotes

**Confirmed bug.** [quotes.ts:110-128](src/services/quotes.ts#L110-L128):

```ts
export async function listQuotes(uid: string): Promise<QuoteSession[]> {
  const local = loadLocalQuotes()   // ← every local session, regardless of whose uid is on it
  ...
  for (const session of [...remote, ...local]) byId.set(...)   // ← merged in unfiltered
```

`loadLocalQuotes()` returns **all 20** cached sessions. `signOutUser()` ([useAuth.ts:47](src/hooks/useAuth.ts#L47)) clears the Firebase session but never touches the `agent-fence.quotes` key. So:

1. Customer A quotes a job on a shared/family/office machine and signs out.
2. Customer B signs in on the same browser.
3. **B's `/quotes` page lists A's conversations** — suburb, fence spec, the whole chat transcript.

[`loadQuote()`](src/services/quotes.ts#L130) has the same hole: it returns the local copy without ever comparing `local.uid` to the caller's uid, so a direct `/quotes/<sessionId>` URL works the same way.

**Fix (three lines):** filter by uid in both functions, and clear the key on sign-out.

```ts
const local = loadLocalQuotes().filter((s) => !s.uid || s.uid === uid)
```

---

## Medium findings

### 🟡 M1 · No error boundary — one crash blanks the entire site
`main.tsx` renders `<App />` bare. There is no `componentDidCatch`, no `ErrorBoundary`, no React Router `errorElement` anywhere in `src/`. Any render throw — a malformed `comparison` object from n8n, an unexpected `null` in a saved session — unmounts the whole tree to an **empty white page** with no way back but a manual reload. **Highest damage-per-line-of-fix item in this report.**

### 🟡 M2 · No 404 page — an unknown URL is also a blank white page
[App.tsx:9-15](src/App.tsx#L9-L15) declares four routes and no `path="*"`. `vercel.json` rewrites every path to `index.html`, so `/pricing`, `/about`, `/quotes/typo/x` all load the app, match zero routes, and render **nothing** — not even the header. Every stale link, every mistyped URL, every crawler hit lands there.

```tsx
<Route path="*" element={<NotFound />} />
```

### 🟡 M3 · No security headers at all
`vercel.json` contains one rewrite and nothing else. Missing: `Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors` (**the OTP dialog is clickjackable today**), `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, `Strict-Transport-Security`. Add a `headers` block — CSP will need `script-src` entries for `maps.googleapis.com`, `www.google.com/recaptcha`, and `apis.google.com`.

### 🟡 M4 · Dead axios interceptor reads a bearer token from localStorage and sends it cross-origin
[api.ts:8-14](src/services/api.ts#L8-L14) attaches `Authorization: Bearer ${localStorage.getItem('authToken')}` to **every** request on the shared instance. [fencingChat.ts:165](src/services/fencingChat.ts#L165) posts through that instance to an **absolute third-party URL** (the n8n host). Nothing writes `authToken` today, so it is inert — but it is a loaded path: the moment anyone starts using that key, the token ships to n8n on every chat turn. Real auth already goes through Firebase, which never touches localStorage. **Delete the interceptor.**

### 🟡 M5 · Session IDs use `Math.random()` and become database document IDs
[id.ts:1](src/utils/id.ts#L1): `Date.now().toString(36) + Math.random().toString(36).slice(2,8)` — about 31 bits, from a generator that is explicitly not cryptographic (V8's `xorshift128+` is reconstructable from observed output). That value becomes the Firestore doc ID `quotes/{sessionId}` **and** the Storage path `transcripts/{sessionId}.pdf`. If either ruleset permits read-by-id, transcripts are enumerable.

`crypto.randomUUID()` is **already used** in this codebase at [places.ts:122](src/services/places.ts#L122). Use it here too — one-line change.

### 🟡 M6 · File uploads have no size or type validation
[HeroInputScreen.tsx:83](src/components/HeroInputScreen.tsx#L83) accepts whatever the picker returns and [fencingChat.ts:152](src/services/fencingChat.ts#L152) appends it all to one multipart POST. The `accept=".pdf"` attribute is a **UI hint the browser does not enforce**. No MB cap, no MIME check, no file-count cap. A 200 MB "PDF" is attempted, hangs for the full 30 s axios timeout, then surfaces the generic *"something went wrong on my end"* — the customer has no idea the file was the problem. Cap at ~10 MB per file / 4 files and reject on type with a specific message.

### 🟡 M7 · Handoff CORS allows every Vercel-hosted site
[functions/index.js:25](functions/index.js#L25) compiles `https://*.vercel.app` to `^https://[^.]+\.vercel\.app$`. The escaping is correct (`https://evil.com/?x=.vercel.app` will *not* match — nicely done), but **any** site anyone deploys to Vercel is an allowed origin. Exploitability is low: the caller must present a valid Firebase ID token, and Firebase sessions are per-origin, so an attacker's site cannot read one from yours. Still a wider door than needed — put previews on a separate function deployment or drop the wildcard.

---

## Low findings

| # | Finding | Location |
|---|---|---|
| L1 | **`DEFAULT_COUNTRY_CODE = '+92'` (Pakistan) in an Australia-only product.** An Australian typing `0412…` becomes `+92412…`, the SMS never arrives, and the flow dies at OTP with *"That number didn't accept a code."* Flagged in the code's own comment but not done. **Launch blocker for an AU launch, one character to fix.** | [phone.ts:8](src/utils/phone.ts#L8) |
| L2 | Six `console.error` calls survive into production, leaking endpoint and status detail to the console. | Home.tsx:207, chat.ts:91, handoff.ts:44/49, transcript.ts:81/107 |
| L3 | Two unreferenced dead files, 157 lines. Not bundled — just clutter. | `deadfile.AIRecommendationPanel.tsx`, `deadfile.ResultsPanel.tsx` |
| L4 | No route-level `React.lazy`. Entry chunk 391 KB / **125 KB gzipped**. Mild — Firebase, jsPDF and html2canvas are *already* lazy-loaded, which is the expensive part done right. | `App.tsx` |
| L5 | Modals set `role="dialog" aria-modal="true"` but have no focus trap — Tab escapes to the page behind. **Deliberate and documented** (`showModal()` would draw over the reCAPTCHA challenge and dead-end the signup). Acceptable; consider `inert` on the background. | InstantQuoteFlow.tsx:124, SignInDialog.tsx:22 |
| L6 | One lint warning: unused `allWorkers`. | `test-fixtures/dummy-workers-300.js:1` |

---

## Secrets, `.env` and repository hygiene — **8 / 10**

### Nothing has leaked into git ✅

A pattern scan was run across **every git-tracked file** in the repository for `AIza…` keys, `sk-…` tokens, `ghp_…`, Slack `xox…`, JWTs, PEM private keys, and `apikey=` / `secret=` / `password=` / `token=` assignments of 16+ characters.

**Exactly one match, and it is safe:**

```
src/services/firebase.ts:8  →  AIzaSyBK5Ijns…   ← Firebase web config, public by design
```

| Check | Result |
|---|---|
| Was `.env` ever committed, on any branch? | **No** — verified across full history |
| `functions/.env` (tracked deliberately) | Contains only `ALLOWED_ORIGINS`. No secret. ✅ |
| `.env.example` | Template only, all values blank. ✅ |
| n8n workflow exports | No embedded credentials block. n8n stripped them on export. ✅ |
| `firebase-schema/*.json` | Schema shapes only, no data. ✅ |
| Sourcemaps in `dist/` | None. ✅ |

### But `.gitignore` protects GitHub, not the browser ⚠️

This is the distinction that matters most, and it is easy to get wrong:

> **Every `VITE_`-prefixed variable is baked into the JavaScript at build time and is publicly readable by anyone who opens DevTools.** Gitignoring `.env` prevents a *repository* leak. It does nothing about a *bundle* leak.

All four values were confirmed present in `dist/assets/index-bw5qe2Ui.js`:

| `.env` value | In public bundle | Does it matter? |
|---|---|---|
| `VITE_FENCING_CHAT_WEBHOOK_URL` | ✅ | ⚠️ Yes — see B3, the endpoint has no auth |
| `VITE_GOOGLE_MAPS_API_KEY` | ✅ | 🔴 **Yes — unrestricted, see B2** |
| `VITE_PARTNER_SITE_URL` | ✅ | No |
| `VITE_HANDOFF_URL` | ✅ | No — the function verifies an ID token |

The rule to work by: **anything a browser needs, an attacker also gets.** A value is only safe in a `VITE_` var if it is safe to publish. Real secrets must live server-side — in the Cloud Function, in n8n, or in Firebase rules.

### 🟡 One real `.gitignore` bug

Lines 25–26:

```gitignore
# Temp files
./WORKFLOW_INTEGRATION.md      ← does not work
./UI_REFERNCE_FIGMA.txt        ← does not work
```

**`.gitignore` does not support a `./` prefix.** Git never matches these patterns, so both files were marked "Temp" and then committed anyway. `git check-ignore -v` confirms: `NOT IGNORED` for both.

Harmless in content — both were scanned and contain no URLs, keys, or credentials — but the intent silently failed.

**Fix:**

```gitignore
# Temp files
WORKFLOW_INTEGRATION.md
UI_REFERNCE_FIGMA.txt
.firebase/
```

And to stop tracking them (history keeps them; only future changes stop being recorded):

```bash
git rm --cached WORKFLOW_INTEGRATION.md UI_REFERNCE_FIGMA.txt
```

*Judgement call:* `WORKFLOW_INTEGRATION.md` is 26 KB of genuine integration documentation. It may be worth keeping in the repo deliberately — in which case delete the two "Temp files" lines instead of fixing them.

### What is correct in `.gitignore`

The env section is well done, including a negation pattern that people usually get wrong:

```gitignore
.env
.env.*
!.env.example        # template reaches the repo
!functions/.env      # origins list reaches the repo
```

`git check-ignore` confirms all three behave as intended. `dist`, `node_modules`, `/test-results/`, `/playwright-report/` and `*.local` are all correctly excluded.

---

## Billing & cost control — **1 / 10** 🔴

Nothing in this project has a spending cap, a quota, or even an alert. Four separately metered services are reachable from the open internet:

| Service | Who can trigger it | Cap today | Realistic worst case |
|---|---|---|---|
| **OpenAI** (`gpt-4o-mini`, `gpt-5-mini`) | **Anyone** — unauthenticated webhook | **None** | 🔴 Highest. A `while` loop with file uploads. |
| **Firebase Phone Auth (SMS)** | Anyone — no App Check | **None** | 🔴 SMS pumping to premium numbers. Classic large bill. |
| **Google Maps / Places** | Anyone — key unrestricted | **None** | 🟠 ~$17 per 1,000 Places sessions, uncapped |
| **Firestore / Storage / Functions** | Any signed-in user | **None** | 🟡 Cheap per unit, unbounded in aggregate |

### The single most important thing to understand

> **A Cloud Billing budget alert does NOT stop spending. It sends an email.**

Most people set a budget, see "budget" in the UI, and believe they are capped. They are not. On Google Cloud there are only two real ceilings:

1. **Per-API daily quota limits** — a hard stop. The API starts returning 429 and bills nothing further.
2. **A billing kill-switch function** — a Cloud Function subscribed to the budget's Pub/Sub topic that detaches the billing account. Drastic (the whole project goes down), but it is a true cap.

### Configure these, in this order

**Today — the two that can produce the biggest number:**

1. **OpenAI hard limit** → Platform → Settings → Limits → set a **hard** monthly cap (start at ~$20) and a soft alert. Once hit, the API refuses calls. This is the only thing standing between an open webhook and a large invoice.
2. **Firebase SMS region policy** → Firebase Console → Authentication → Settings → *SMS Region Policy* → **allow-list only the countries you serve** (AU, plus PK while testing). Toll fraud works by sending to expensive destinations; an allow-list removes the entire business model of the attack.

**This week:**

3. **Maps daily quota** → Cloud Console → APIs & Services → *Maps JavaScript API* → Quotas & System Limits → set "Requests per day". Repeat for *Places API* (Autocomplete + Details). Pick roughly 10× your expected daily traffic. **This is the hard stop — do not rely on the budget alert.**
4. **API key restriction** → per B2, referrer + API restrictions on a new web-only key.
5. **App Check** → enforce on Auth, Firestore, Storage and Functions. This is what makes "only my real app may call this" true across the whole Firebase surface.
6. **Cloud Function instance cap** — a one-line code change so a flood cannot scale the function to hundreds of instances:

   ```js
   // functions/index.js:33
   exports.createHandoff = onRequest(
     { cors: ALLOWED_ORIGINS, region: 'us-central1', maxInstances: 10 },
     async (request, response) => { … }
   )
   ```

7. **Storage size limit in rules** — cap uploads server-side, since the client cannot be trusted to:

   ```
   allow write: if request.auth != null
                && request.resource.size < 10 * 1024 * 1024
                && request.resource.contentType == 'application/pdf';
   ```

8. **Cloud Billing budget + alerts** at 50 / 90 / 100 % — email only, but it is how you find out early.
9. **Vercel Spend Management** → set a pause threshold on the project.

**Before scale:**

10. **Billing kill-switch** — budget → Pub/Sub topic → Cloud Function calling `cloudbilling.projects.updateBillingInfo` with an empty `billingAccountName`. Google documents this pattern under "Cap Cloud Billing costs". Test it on a scratch project first: it takes the entire project offline, which is the correct behaviour at 3 a.m. and an alarming one at 3 p.m.

### Cost hygiene already present

Worth crediting — some of this is already thought through:

- Places uses **session tokens** ([places.ts:106-115](src/services/places.ts#L106-L115)), which bills a run of keystrokes plus the details call as one session instead of per request. That is the correct and cheaper way to use the API.
- The Places SDK loads only when the suburb question is actually reached, not on page load.
- Firestore stores one document per conversation rather than one per message ([quotes.ts:1](src/services/quotes.ts#L1)) — roughly a 12× reduction in writes.
- Storage upload retry is capped at 10 s instead of Firebase's 10-minute default ([transcript.ts:98](src/services/transcript.ts#L98)).

The per-unit efficiency is good. What is missing is the ceiling.

---

## What is already right

Worth stating plainly, because a lot of this is done better than most production React apps:

- **Zero XSS surface in app code.** No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no `new Function` — grepped the whole of `src/`. React escapes every interpolation. Typing `<script>alert('hack')</script>` into any field renders it as literal text.
- **No auth tokens in localStorage.** Firebase manages the session in IndexedDB and rotates it. The only localStorage key is the quote cache.
- **The OTP flow is careful.** Codes are single-use ([otp.ts:102](src/services/otp.ts#L102)), the reCAPTCHA verifier is reset after every failure so retries don't inherit a spent challenge, developer error codes are mapped to human sentences, and the code is length-checked client-side before spending a billed round trip.
- **`jobSubmittedRef`** ([InstantQuoteFlow.tsx:118](src/components/InstantQuoteFlow.tsx#L118)) means a failed handoff retries only the token hop — businesses never receive duplicate leads. That is a subtle bug most codebases ship with.
- **The handoff is designed correctly.** Token travels in the URL **fragment** (never reaches a server log or `Referer`), `verifyIdToken(idToken, true)` checks revocation, and the function only ever mints for the uid inside the presented token — it cannot be used to become someone else.
- **Firebase web config in source is fine.** The comment at [firebase.ts:3](src/services/firebase.ts#L3) is correct: those values identify, they do not authorize.
- **Env hygiene is clean.** `.env` was **never committed** — verified across all branches in git history. `functions/.env` is committed deliberately and holds only an origin list.
- **Loading states are thorough.** Every submit button carries `disabled={isBusy}`, `/quotes` shows skeletons, the chat shows a shimmer with rotating copy, and the header renders nothing while auth restores so a signed-in user never flickers as logged-out.
- **Network error handling exists everywhere.** The chat surfaces an in-thread error with a **Try again** button that replays the exact failed payload including files; every Firestore/Storage/PDF side effect is best-effort and structured so the lead is never lost to a failed transcript.
- **Form validation is real.** [InstantQuoteFlow.tsx:26](src/components/InstantQuoteFlow.tsx#L26) strips Unicode control characters, collapses whitespace, caps length, validates email, and normalises phone numbers to E.164 before anything is sent.
- **Test and build health.** 162 unit tests across 12 files pass; `npm run build` completes clean with no type errors; one lint warning, in a fixture.

---

## The questions I asked, and the answers

| Question | Answer |
|---|---|
| User types `/pricing` — what happens? | **Blank white page.** Vercel rewrites to `index.html`, React Router matches nothing, renders nothing. → M2 |
| A component throws mid-render? | **Blank white page**, permanent until manual reload. No boundary. → M1 |
| Can an unauthenticated user reach `/quotes`? | Yes, **by design** — guests have a local history. No protected routes exist and none are needed; sign-in is a dialog, not a page, so there is no "redirect back after login" problem to get wrong. Good call. |
| Can a normal user reach admin functionality? | No admin surface exists in this app. |
| Token expires mid-session? | Handled. Firebase auto-refreshes; `partnerSiteUrl()` throws a specific message ("Sign-in expired before handoff") rather than crashing. |
| Does logging out clear the previous user's data? | **No.** → H2 |
| Can a user double-submit and create two leads? | No — `jobSubmittedRef` guards it, and every button disables while busy. |
| Backend down / 500? | Chat catches it, shows a friendly message and a working retry. Firestore/Storage failures are swallowed and logged; the lead still saves. |
| Does `<script>alert(1)</script>` execute anywhere? | **No.** No unsafe HTML sink exists in the codebase. |
| Are secrets hardcoded or exposed? | The Firebase config is public-by-design (fine). The **Maps key is exposed and unrestricted** (not fine → B2). The n8n webhook URL is in the bundle — unavoidable for a browser client, but it means the webhook must do its own auth and rate limiting. |
| Is `.env` in git? | No. Verified across all branches, plus a full secret scan of every tracked file. |
| Then are my keys safe? | From *git*, yes. From the *browser*, no — all four `VITE_` values are readable in the shipped JS. Only one of them actually matters (Maps). |
| Is `.gitignore` correct? | 95 %. The env negation logic is right; the two `./`-prefixed "Temp files" patterns silently do nothing. |
| Can a stranger spend my money? | **Yes, four ways, all uncapped.** OpenAI via the open webhook is the worst. → §Billing |
| Does a budget alert stop the spend? | **No.** It emails you. Only per-API quotas and a kill-switch function actually stop it. |
| Empty form submission? | Blocked — buttons disable, and `handleDetailsSubmit` validates all three fields before proceeding. |
| Sourcemaps shipped? | No. Vite default; `dist/assets/` contains no `.map` files. |
| Does the app work with the Maps key removed? | Yes — degrades to plain typing. Deliberate and tested. |
| n8n returns a malformed shape? | Validated at [fencingChat.ts:166](src/services/fencingChat.ts#L166) and throws → caught → in-thread error. Good. |
| Slow network / hung request? | 30 s axios timeout on chat, 8 s on handoff, 10 s on uploads and the Maps SDK. All bounded — nothing spins forever. |

---

## Fix order

**Today — money first. Nothing here is code; it is all console work.**
1. OpenAI **hard** spend limit *(2 min)* — the open webhook makes this urgent
2. Firebase **SMS region policy**, allow-list AU + PK *(2 min)*
3. Maps **daily quota caps** on Maps JS + Places APIs *(10 min)* — the actual hard stop
4. Restrict / re-mint the Maps API key *(15 min)*
5. Cloud Billing budget + alerts, and Vercel Spend Management *(10 min)*

**Before you take a single real customer:**
6. Export and commit the Firestore / Storage / Realtime-DB rules; verify per-uid ownership on every path in the B1 table *(hours)*
7. Put authentication on the n8n webhook and narrow `allowedOrigins` from `*` *(B3)*
8. Change `DEFAULT_COUNTRY_CODE` to `+61` *(1 char)*
9. Add an error boundary *(20 lines)*
10. Add a `path="*"` 404 route *(5 lines)*

**Same week:**
11. Enable and enforce App Check across Auth / Firestore / Storage / Functions
12. Filter local quotes by uid; clear localStorage on sign-out *(3 lines)*
13. Delete the `api.ts` localStorage interceptor *(7 lines)*
14. `crypto.randomUUID()` in `id.ts` *(1 line)*
15. Security headers in `vercel.json`
16. `maxInstances` on `createHandoff`; file-size limit in Storage rules
17. Fix the broken `./` patterns in `.gitignore`

**Before scale:**
18. Client-side file size/type validation
19. Strip `console.error` from production builds
20. Delete the two `deadfile.*` components
21. Narrow the Vercel CORS wildcard
22. Billing kill-switch function (budget → Pub/Sub → disable billing)

Items 8, 9, 10, 12, 13 and 14 together are **under 50 lines of code** and move the readiness score from 5.6 to roughly 8. Items 1–5 are twenty minutes of clicking and are the difference between a bad week and a bad invoice. Items 6 and 7 are the ones that actually determine whether you get breached.

---

## Backend note

You asked about tackling deployment issues by stack. This is **Firebase** (Auth, Firestore, Realtime DB, Storage, Cloud Functions on `quotemy-ai`) plus an **n8n workflow** on a self-hosted Hostinger VPS, with the frontend on **Vercel**. Two consequences worth planning around:

- Firebase's security model *is* the rules files. There is no server-side API layer between the browser and your data — which is exactly why B1 outranks everything else here.
- The n8n webhook at `n8n.srv1506542.hstgr.cloud/webhook/fencing-chat-api` is called directly from the browser with **no authentication and `allowedOrigins: "*"`**, and two OpenAI models sit behind it. This is now written up as blocker **B3** — it is the largest single financial exposure in the project, and the fix is on the n8n side rather than in this repo.
- The VPS itself is flat-rate, which is exactly why the OpenAI limit matters: nothing about the hosting bill will warn you that the workflow is being hammered.
