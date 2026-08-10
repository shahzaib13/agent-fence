# Security & Production TODOs — Agent Fence

Companion checklist to [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Every item is one action.
Tick as you go. Ordered by **what hurts first**, not by how hard it is.

**Legend:** 🔴 blocker · 🟠 high · 🟡 medium · ⚪ nice-to-have
**Where:** `console` = no code, just clicking · `code` = a change in this repo · `n8n` = the workflow

---

## ✔ Done — 2026-08-10 · React frontend pass

Every frontend `code` item below is shipped. `npm run test` **252 pass / 22 files**, `npm run build` clean,
lint unchanged (one pre-existing fixture warning). No behaviour change other than the fixes themselves.

| Fixed | Where |
|---|---|
| Country code now env-driven (`VITE_DEFAULT_COUNTRY_CODE`, fallback `+92`, format-validated) | `utils/phone.ts` |
| Error boundary — no more blank page on a render crash | `components/ErrorBoundary.tsx`, `main.tsx` |
| 404 catch-all route | `pages/NotFound.tsx`, `App.tsx` |
| Cross-user quote leak — uid filter on list **and** direct URL | `services/quotes.ts` |
| **Sticky ownership** — a signed-out re-save can no longer launder an owned quote into a claimable one *(found during the fix, not in the original audit)* | `services/quotes.ts` |
| Sign-out clears the quote cache and hard-resets the page | `hooks/useAuth.ts` |
| Deleted the localStorage bearer-token interceptor | `services/api.ts` |
| `crypto.randomUUID()` for session ids | `utils/id.ts` |
| 5 security headers enforced + CSP in Report-Only | `vercel.json` |
| File upload size / type / count validation | `components/HeroInputScreen.tsx` |
| `.gitignore` `./` patterns fixed, temp docs untracked | `.gitignore` |
| `VITE_` publish-safety rule documented for whoever adds the next var | `.env.example` |

**Deliberately not changed:** `jobs.ts:50` still uses `Math.random()` for the human-readable job number
(`VI-48291`). The format only has 90,000 values per state, so a CSPRNG buys nothing — enumeration is a
**rules** problem (B1), and changing the format would break the partner site.

**Still open below:** everything marked `console` or `n8n`, plus observability. None of it is frontend code.

---

## Phase 0 — TODAY. Money. ~20 minutes, zero code.

Nothing here needs a developer. Do it before you sleep — every one of these is a stranger's ability to spend your client's money.

- [ ] 🔴 **OpenAI hard spend limit** · `console`
  - Platform → Settings → **Limits** → set a **Hard limit** (start ~$20/month) + a soft alert
  - Why first: the n8n webhook is unauthenticated, so this is the only real ceiling on it
  - Time: 2 min

- [ ] 🔴 **Firebase SMS Region Policy** · `console`
  - Firebase Console → Authentication → Settings → **SMS Region Policy** → allow-list **AU** only (add **PK** while you're still testing)
  - Why: SMS toll fraud works by pumping premium-rate numbers in obscure countries. An allow-list deletes the attack's entire business model.
  - Time: 2 min

- [ ] 🔴 **Google Maps daily quota caps** · `console`
  - Cloud Console → APIs & Services → **Maps JavaScript API** → *Quotas & System Limits* → set "Requests per day"
  - Repeat for **Places API** — Autocomplete and Details are separate quotas
  - Set roughly 10× your expected daily traffic
  - ⚠️ **This is the hard stop. A budget alert is NOT a cap — it only emails you.**
  - Time: 10 min

- [ ] 🔴 **Re-mint + restrict the Maps API key** · `console`
  - Create a **new, web-only** key (leave the Flutter key alone)
  - Application restriction → HTTP referrers → `agent-fence.vercel.app`, `localhost:5173`, `*.vercel.app`
  - API restriction → Maps JavaScript API + Places API only
  - Put the new key in Vercel env vars, then **rebuild** (Vite bakes `VITE_*` at build time)
  - Then **check billing history** — the old key has been open for a while; confirm no abuse already happened
  - Time: 15 min

- [ ] 🟠 **Cloud Billing budget + alerts** · `console`
  - Billing → Budgets & alerts → thresholds at 50 / 90 / 100 %
  - Email only — this is your early warning, not your cap
  - Time: 5 min

- [ ] 🟠 **Vercel Spend Management** · `console`
  - Project → Settings → Spend Management → set a pause threshold
  - Time: 2 min

---

## Phase 1 — Before a single real customer

### 🔴 B1 · Get the security rules under version control

The biggest unknown in the whole project. `firebase.json` deploys **functions only** — there is no `firestore.rules`, no `storage.rules`, no `database.rules.json` anywhere in this repo. Meanwhile the browser is the sole author of every write.

- [ ] Export the live rules:
  - [ ] `firebase firestore:rules:get`
  - [ ] Realtime DB rules — Firebase Console → Realtime Database → Rules
  - [ ] Storage rules — Firebase Console → Storage → Rules
- [ ] Commit all three to this repo
- [ ] Wire them into `firebase.json` so they deploy with the code and can't silently drift
- [ ] Verify **each** of these paths enforces per-uid ownership:
  - [ ] `jobs/{jobId}` — [jobs.ts:141](src/services/jobs.ts#L141)
  - [ ] `users/{phone}` — [jobs.ts:148](src/services/jobs.ts#L148) ⚠️ **doc ID is the phone number, not the uid**
  - [ ] `businesses/{id}/incoming_jobs/{jobId}` — [jobs.ts:175](src/services/jobs.ts#L175)
  - [ ] `businesses/{id}/accepted_jobs/{jobId}` — same line. Can a user write `status: 'accepted'` on their own injected lead?
  - [ ] `quotes/{sessionId}` — [quotes.ts:106](src/services/quotes.ts#L106) ⚠️ **`uid` is a client-supplied field**
  - [ ] RTDB `chats/{id}/meta`, `chats/{id}/messages`, `userChats/{uid}` — [chat.ts:58-89](src/services/chat.ts#L58-L89)
  - [ ] Storage `transcripts/`, `chats/*/media/` — [transcript.ts:100](src/services/transcript.ts#L100)
- [ ] Re-audit once they are visible

> The client-side code is honest — it writes the verified phone and the real uid. But a client is not an enforcement point. `curl` with a valid ID token bypasses all of it. **The rules are the only thing between an attacker and that list.**

### 🔴 B3 · Close the n8n webhook

- [ ] Narrow `allowedOrigins` from `*` to your real domains · `n8n` *(do this now — costs nothing)*
- [ ] Add **Header Auth** on the webhook node · `n8n` + `code`
  - Honest caveat: the header ships in the JS bundle too, so it stops scripts, not a determined attacker
- [ ] **Real fix:** send the Firebase ID token and verify it in a Code node at the top of the workflow · `n8n`
  - Requires making the chat sign-in-first — a product decision, raise it with the client
- [ ] Add IP rate-limiting in front of n8n (Caddy / nginx on the Hostinger VPS)
- [ ] ⚠️ **Apply every fix to `n8n/fencing-workflow-updated (backup).json` too** — it carries the identical insecure config, so a future re-import silently reopens the hole

### 🔴 Code blockers

- [x] **`DEFAULT_COUNTRY_CODE` is now env-driven** · [phone.ts](src/utils/phone.ts) — done, but **not finished**
  - Was hard-coded `'+92'`, so every Australian typing `0412…` became `+92412…`, no SMS arrived, and the flow died at OTP with no clue why
  - Now reads `VITE_DEFAULT_COUNTRY_CODE`, falls back to `+92`, and ignores a malformed value rather than prefixing every number with garbage
  - ⚠️ **Remaining action, and it is not code:** set `VITE_DEFAULT_COUNTRY_CODE=+61` in the Vercel environment before the Australian launch, then redeploy. Until then production still dials Pakistan.
- [x] **Add an error boundary** · `main.tsx` *(~20 lines)*
  - Today any render throw = permanent blank white page
  - Do this together with Sentry (Phase 3) — a boundary with no reporting means you show a nice screen and still never learn
- [x] **Add a `path="*"` 404 route** · [App.tsx](src/App.tsx) *(~5 lines)*
  - `vercel.json` rewrites everything to `index.html`, so `/pricing`, `/about`, any typo → blank page

---

## Phase 2 — Same week

- [ ] 🟠 **Enable and enforce App Check** · `console`
  - reCAPTCHA Enterprise provider, enforce on **Auth, Firestore, Storage, Functions**
  - This is what makes "only my real app may call this" true across the whole Firebase surface
  - Also the second layer under the SMS toll-fraud fix

- [x] 🟠 **Fix the cross-user quote leak** · [quotes.ts:111](src/services/quotes.ts#L111) *(3 lines)*
  - [x] Filter in `listQuotes`: `loadLocalQuotes().filter((s) => !s.uid || s.uid === uid)`
  - [x] Same ownership check in `loadQuote` ([quotes.ts:130](src/services/quotes.ts#L130))
  - [x] Clear `agent-fence.quotes` inside `signOutUser()` ([useAuth.ts:47](src/hooks/useAuth.ts#L47))
  - Today: customer A signs out on a shared machine → customer B signs in → **B sees A's conversations**

- [x] 🟡 **Delete the `api.ts` localStorage interceptor** · [api.ts:8-14](src/services/api.ts#L8-L14) *(7 lines)*
  - Attaches `Authorization: Bearer <localStorage.authToken>` to every request — including the cross-origin n8n POST
  - Nothing sets that key today, so it's inert; it's a loaded gun, not a wound

- [x] 🟡 **`crypto.randomUUID()` in `id.ts`** · [id.ts](src/utils/id.ts) *(1 line)*
  - `Math.random()` is not cryptographic and gives ~31 bits — and that value becomes the Firestore doc ID and the Storage transcript path
  - Already used correctly at [places.ts:122](src/services/places.ts#L122)

- [x] 🟡 **Security headers in `vercel.json`** · [vercel.json](vercel.json)
  - [x] `Content-Security-Policy` — needs `script-src` for `maps.googleapis.com`, `www.google.com/recaptcha`, `apis.google.com`
  - [x] `X-Frame-Options: DENY` / `frame-ancestors 'none'` — **the OTP dialog is clickjackable today**
  - [x] `Referrer-Policy: strict-origin-when-cross-origin`
  - [x] `X-Content-Type-Options: nosniff`
  - [x] `Permissions-Policy`
  - [x] `Strict-Transport-Security`

- [ ] 🟡 **`maxInstances` on the Cloud Function** · [functions/index.js:33](functions/index.js#L33) *(1 line)*
  ```js
  { cors: ALLOWED_ORIGINS, region: 'us-central1', maxInstances: 10 }
  ```

- [ ] 🟡 **File size limit in Storage rules** · `console`
  ```
  allow write: if request.auth != null
               && request.resource.size < 10 * 1024 * 1024
               && request.resource.contentType == 'application/pdf';
  ```

- [x] 🟡 **Adopt the `VITE_` rule, and audit every existing var against it** · standing rule
  - > **Every `VITE_`-prefixed variable is compiled into the public JavaScript. `.gitignore` protects GitHub, not the browser.**
  - A value is only safe in a `VITE_` var if it is safe to publish on a billboard
  - [x] Confirm the current four are all publish-safe: webhook URL ⚠️ *(only because B3 fixes the endpoint, not the URL)*, Maps key ⚠️ *(only once restricted)*, partner URL ✅, handoff URL ✅
  - [x] Real secrets go server-side only — Cloud Function, n8n credentials, or Firebase rules. **Never** a `VITE_` var.
  - [x] Add this to code review: any new `VITE_SOMETHING_KEY` gets challenged before it merges

- [x] 🟡 **Fix the broken `.gitignore` patterns** · [.gitignore:25-26](.gitignore#L25-L26)
  - `./` prefix is not supported by git, so both "Temp files" got committed anyway
  ```gitignore
  WORKFLOW_INTEGRATION.md
  UI_REFERNCE_FIGMA.txt
  .firebase/
  ```
  - Decide first: `WORKFLOW_INTEGRATION.md` is 26 KB of real integration docs and may be worth keeping deliberately — in that case delete the two lines instead of fixing them

---

## Phase 3 — Observability 👁️ (currently **0 / 10**)

**Verified: you have no way of knowing your app crashed.** No monitoring dependency in `package.json`. No `getAnalytics`, no `gtag`, no `window.onerror`, no `unhandledrejection` handler anywhere in `src/`. The `measurementId: 'G-7CS1VYF495'` sits in the Firebase config but analytics is never initialised (deliberately — see [firebase.ts:18](src/services/firebase.ts#L18)).

### What is invisible to you right now

| What happens | Who finds out today |
|---|---|
| A component crashes → white screen | **Nobody.** The user leaves. |
| Chat webhook fails → "something went wrong" | **Nobody.** Only that user's console. |
| Handoff to QuoteMy fails | **Nobody** — [handoff.ts:44](src/services/handoff.ts#L44) is a `console.error` in *their* browser |
| Transcript PDF upload fails | **Nobody** — swallowed by design, best-effort |
| **The `+92` bug: every AU customer dies at OTP** | **Nobody.** You'd just see zero conversions and guess why. |
| `createHandoff` rejects a token | ✅ Cloud Logging — your one working log |
| n8n workflow errors | ✅ n8n execution log on the VPS |

That `+92` row is the point. A real, currently-live bug that kills 100 % of your target market's signups — and there is no signal anywhere that would tell you. You would be debugging by guesswork.

### The lazy fix: two installs cover ~90 %

- [ ] 🟠 **Sentry** — error reporting *(free tier: 5k errors/month)*
  - [ ] `npm i @sentry/react`
  - [ ] `Sentry.init({ dsn, tracesSampleRate: 0.1 })` in `main.tsx`
  - [ ] Wire it into the error boundary from Phase 1 — **do these two together**
  - [ ] Replace the 6 `console.error` calls with `Sentry.captureException` (Home.tsx:207, chat.ts:91, handoff.ts:44/49, transcript.ts:81/107)
  - [ ] Upload sourcemaps in the Vercel build, or every stack trace is minified garbage
  - Catches: render crashes, unhandled promise rejections, `window.onerror`, and anything you report by hand
  - Time: ~1 hour

- [ ] 🟠 **Vercel Analytics** — traffic + Web Vitals *(zero config)*
  - [ ] `npm i @vercel/analytics` → `<Analytics />` in `App.tsx`
  - Tells you page views, where people drop off, and real-world load speed
  - No cookie banner needed (unlike GA4)
  - Time: 5 min

- [ ] 🟡 **Uptime check** — is the site even up?
  - Cloud Monitoring uptime check, or UptimeRobot free tier
  - Point it at the site **and** at the n8n webhook host
  - Time: 10 min

### Funnel events worth tracking (once Sentry is in)

You will want to answer "where do people give up?" — these are the five steps that matter:

- [ ] Hero submit → chat started
- [ ] Checklist complete → confirmation shown
- [ ] Comparison page reached
- [ ] "Instant Quote" opened → businesses selected
- [ ] **OTP sent → OTP verified** ← this is where the `+92` bug lives; instrument it first
- [ ] Job submitted → handoff redirect

### Deliberately NOT recommending

- **Firebase Analytics / GA4** — it's product analytics, not crash reporting, and it drops cookies, which is a consent decision for AU/EU traffic, not a setup step. The existing comment at [firebase.ts:18](src/services/firebase.ts#L18) already made this call correctly. Vercel Analytics gives you the traffic numbers without the banner.
- **A custom logging service.** Sentry's free tier is more than this app will generate. Don't build one.

---

## Phase 4 — Before scale

- [x] ⚪ **Client-side file validation** · [HeroInputScreen.tsx:83](src/components/HeroInputScreen.tsx#L83)
  - Cap ~10 MB per file, max ~4 files, real MIME check
  - `accept=".pdf"` is a UI hint the browser does not enforce
  - Today a 200 MB "PDF" hangs for 30 s then shows the generic error — the customer never learns the file was the problem
- [ ] ⚪ **Strip `console.error` from production builds** (or route them all through Sentry, which removes the need)
- [x] ⚪ **Delete the two `deadfile.*` components** — 157 unreferenced lines
- [ ] ⚪ **Narrow the Vercel CORS wildcard** · [functions/index.js:25](functions/index.js#L25)
  - `https://*.vercel.app` allows *any* Vercel-hosted site as an origin
  - Low exploitability (caller still needs a valid ID token) but wider than needed
- [ ] ⚪ **Route-level `React.lazy`** — entry chunk is 391 KB / 125 KB gzipped
  - Mild: Firebase, jsPDF and html2canvas are already lazy, which was the expensive part
- [ ] ⚪ **Billing kill-switch** — budget → Pub/Sub → Cloud Function calling `cloudbilling.projects.updateBillingInfo` with an empty billing account
  - Google documents this under "Cap Cloud Billing costs"
  - Test on a scratch project first: it takes the **whole project** offline, which is correct at 3 a.m. and alarming at 3 p.m.
- [ ] ⚪ **`inert` on the background behind modals** — no focus trap today
  - The missing trap is deliberate and documented ([InstantQuoteFlow.tsx:124](src/components/InstantQuoteFlow.tsx#L124)): `showModal()` would draw over the reCAPTCHA challenge and dead-end the signup. Keep that decision, just add `inert`.
- [ ] ⚪ Fix the one lint warning — unused `allWorkers` in `test-fixtures/dummy-workers-300.js:1`

---

## ✅ Verified good — do not re-audit

Ticked because they were checked and passed. Leave them alone.

- [x] **No XSS surface** — no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` anywhere in `src/`
- [x] **No secrets in git** — full pattern scan of every tracked file; one match, the Firebase web key, which is public by design
- [x] **`.env` never committed** — verified across all branches
- [x] **`functions/.env`** — tracked deliberately, contains only `ALLOWED_ORIGINS`
- [x] **n8n exports carry no credentials** — n8n strips them
- [x] **No auth tokens in localStorage** — Firebase uses IndexedDB and rotates them
- [x] **No sourcemaps in `dist/`**
- [x] **OTP flow** — single-use codes, verifier reset per attempt, cooldown, mapped error messages, pre-flight length check
- [x] **`jobSubmittedRef`** — a failed handoff retries only the token hop; businesses never get duplicate leads
- [x] **Handoff design** — token in the URL fragment (never hits a server log), `verifyIdToken(token, true)` checks revocation, only mints for the uid inside the token
- [x] **Session restore** — no logged-out flicker for a signed-in user
- [x] **Loading states** — buttons disable while busy, skeletons on `/quotes`, shimmer in chat
- [x] **Form validation** — control chars stripped, whitespace collapsed, length capped, email pattern, E.164
- [x] **All network calls bounded** — 30 s chat, 8 s handoff, 10 s uploads and Maps SDK
- [x] **Places session tokens** — bills a keystroke run + details as one session. Correct and cheaper.
- [x] **One Firestore doc per conversation**, not per message — ~12× fewer writes
- [x] **162 unit tests pass · build clean · 1 lint warning**

---

## Scoreboard

| Area | Now | After Phase 0-1 | After Phase 2-3 |
|---|---|---|---|
| Production readiness | 5.6 | ~7 | ~8.5 |
| Runaway-bill risk | 🔴 CRITICAL | 🟢 LOW | 🟢 LOW |
| Breach risk | 🟠 MED-HIGH | 🟡 MEDIUM | 🟢 LOW-MED |
| Observability | **0 / 10** | 0 / 10 | 🟢 7 / 10 |

**Phase 0 is 20 minutes of clicking and removes the worst financial risk entirely.** Start there.
