# Design Review — Remediation Design (2026-11-01)

**Reviewer:** design-review subagent (fresh review, no prior context).
**Inputs:** `findings.md` (0 Critical, 3 High, 6 Medium, 4 Low, 4 runtime-verification items, 8 owner-decision items) and `remediation-design.md` (second iteration).
**Method:** read the design end-to-end, then verified the design's load-bearing claims against source (`package.json`, `src/lib/kyc.functions.ts`, `src/lib/kyc-data.ts`, `src/lib/rate-limit.server.ts`, `src/lib/ai.server.ts`, `src/server.ts`, `src/routes/index.tsx`) and grep across `src/**` for import/dead-code claims. No whole-codebase re-investigation.
**Verdict:** **CHANGES_REQUESTED** — 3 MEDIUM findings (each blocks).

The design is strong overall: every finding (H1–H3, M1–M6, L1–L4, V1–V4, D1–D8) has either a concrete fix or an explicit Needs-owner-decision flag, and a new D9 (privacy policy) is added. The batch order is sound, the never-auto-approve invariant is preserved and documented, and the prior review's 4 MEDIUM + 6 NIT are genuinely addressed. The issues below are correctness/completeness gaps in specific fixes, not wholesale problems with the plan.

---

## Verified Assumptions

These design claims were checked against source and hold:

- **`auditLog` is dead code.** Defined/exported in `src/lib/kyc-data.ts` (lines 110–114) and imported nowhere in `src/**` (grep: only the definition site matches). `src/routes/analytics.tsx` imports only `attackResilience, latencyBreakdown` from `@/lib/kyc-data` — confirmed. The Batch 1 decision to delete the whole export (removing both fabricated entries) is sound and behavior-neutral.
- **zod is imported only in `src/lib/kyc.functions.ts`** (grep: `from "zod"` matches only that file). `@hookform/resolvers` is **not imported anywhere** (grep: no matches). So the v3→v4 migration's runtime code surface really is one file.
- **Consent gate keys are `doc` / `bio` / `retention`.** The server gate `["doc","bio","retention"].every((k) => data.consent[k] === true)` (`kyc.functions.ts`) and the `consents` array in `index.tsx` use exactly those three keys. The design's "consent keys must not change" invariant is correct.
- **Never-auto-approve invariant exists** with the SECURITY comment: `const status = score < 40 ? "Rejected" : "Pending";` preceded by "every input above is client-supplied, so the system must never auto-approve." The design preserves and documents it.
- **`preValidateSize` field names match the schema.** `submitInput` has `documentImage`/`backImage`/`selfieImage`/`consent`/`liveness.challenges` — the fields the design's guard inspects.
- **`package.json` matches the design's stack claims:** `zod ^3.25.76`, `vite 8.1.5`, `overrides: { "rolldown": "1.2.1" }`, `@tanstack/react-start 1.168.60`, `@tanstack/react-router 1.170.41`.
- **`src/server.ts` CSP matches the findings:** enforced `Content-Security-Policy` is `FRAME_ANCESTORS` only; the full policy is `Content-Security-Policy-Report-Only` with `'unsafe-inline'` present in **both** `script-src` and `style-src`. The design's `.replace("'unsafe-inline'", "")`-hits-only-the-first-occurrence reasoning is correct.
- **`clientIp()` matches the findings:** `cf-connecting-ip ?? x-real-ip ?? x-forwarded-for`. The M1-partial hardening (prefer `cf-connecting-ip`, drop `x-real-ip`, `x-forwarded-for` best-effort fallback) is a faithful, correct change.
- **M5 disclosure is accurate.** `ai.server.ts` uses `MODEL = "openai/gpt-6-astra"` via the Lovable gateway keyed by `LOVABLE_API_KEY`, so "OpenAI via our AI gateway" is a truthful recipient name.
- **The five consent bullets and the "Zero-Trust Privacy Guarantee" card** ("Encrypted in transit and at rest. No data sold, ever.") match `index.tsx` exactly as the findings and the design describe.

---

## Unverified / Wrong Assumptions

- **WRONG — `preValidateSize` "bounds the specific collection-exhaustion vector."** It bounds `consent` keys and `liveness.challenges`, but omits `face.selfieDescriptor` / `face.idDescriptor`, which are themselves constrained collections (`z.array(z.number().finite()).length(128)`). See Finding 1.
- **WRONG (likely) — "Supabase enables [encryption at rest] by default."** This is true for Storage (S3 SSE) but **not** for the Database, where encryption-at-rest is a Supabase Pro/Enterprise add-on that is off by default. The consent card's blanket "at rest" covers DB-stored biometric descriptors. See Finding 2.
- **WRONG — "the kept report-only canary surfaces [missing-source violations] in the console before it bites users."** On the first enforced deploy a missing source is **blocked** by the enforced policy at the same moment the canary reports it; the canary only pre-warns for inline scripts (where it is stricter). See Finding 3.
- **WRONG — H3b: "the handler surfaces 'Too many requests' … for [the gateway 429/402] case."** The gateway 429/402 throw `AiError` with messages "The AI service is busy…" / "AI credits are used up…" which do **not** start with "Too many requests" and therefore surface as the generic "Document analysis is unavailable." The "Too many requests" message actually comes from the per-instance `RateLimitError`. See NIT 5.

---

## Findings

### 1. MEDIUM — `preValidateSize` omits the face-descriptor arrays, leaving a collection-exhaustion vector open under the stated fallback

**Where:** Batch 2, `preValidateSize` helper + the "Fallback if the v4 migration proves too risky" note.

**Problem:** The design's pre-parse guard bounds `documentImage`/`backImage`/`selfieImage` (strings), `consent` keys (>16), and `liveness.challenges` (>20). It does **not** bound `face.selfieDescriptor` or `face.idDescriptor`. Per `kyc.functions.ts`, those are `descriptor = z.array(z.number().finite()).length(128).nullable().catch(null)` — i.e. constrained collections, the exact class the GHSA-mrhx-c7xc-m3w5 advisory targets: zod validates every element (allocating per-element results) **before** applying `.length(128)` and rejecting. An attacker POSTing `face.selfieDescriptor` as a 1,000,000-element number array triggers the same memory exhaustion as an oversized `consent` record or `challenges` array.

The primary fix (upgrade `zod` to ≥4.6.6) closes this for all collections. But the design explicitly offers a **fallback** — "keep `zod ^3.25.76` and rely on `preValidateSize` + the `.max(20)`/`.slice(0,10)` on the challenges array … This **reduces** the exhaustion vector." Under that fallback the descriptor arrays are **not** bounded by `preValidateSize`, so the exhaustion vector for descriptors stays wide open, contradicting "reduces the exhaustion vector."

**Fix:** Add descriptor-array length bounds to `preValidateSize` (the descriptors are exactly 128 elements when valid, so any larger is invalid):

```ts
const f = (r.face as { selfieDescriptor?: unknown[]; idDescriptor?: unknown[] } | undefined);
if (Array.isArray(f?.selfieDescriptor) && f!.selfieDescriptor!.length > 128) return false;
if (Array.isArray(f?.idDescriptor) && f!.idDescriptor!.length > 128) return false;
```

And amend the fallback note: under the v3 fallback, `preValidateSize` must bound **all** collection fields (including descriptors) to "reduce the exhaustion vector"; the v4 upgrade remains the only complete fix. If the implementer is unwilling to add descriptor bounds, mark the fallback as insufficient and make the v4 upgrade mandatory (no fallback).

---

### 2. MEDIUM — V5 conflates Storage encryption-at-rest (default) with Database encryption-at-rest (paid add-on); risks re-introducing a false "at rest" consent claim

**Where:** Batch 0 / V3 ("Supabase enables this by default; verify it is not disabled") and the V5 verification item; Batch 1 N8 reconciliation (card + bullet 1 "at rest" wording gated on V5).

**Problem:** The design reintroduces "stored encrypted at rest" into the consent card and bullet 1, gated on V5 confirming Supabase encryption-at-rest. The verification guidance says: *"Confirm encryption-at-rest is enabled for both Database and Storage … (Supabase enables this by default; verify it is not disabled)."* This is accurate for **Storage** (objects are encrypted at rest via S3 SSE by default) but **not** for the **Database**: Supabase Database encryption-at-rest is a Pro/Enterprise add-on that is **off by default** on the free tier.

The biometric face descriptors (`face_descriptor`/`id_face_descriptor`) and all PII live in the **Database**, and the consent card's blanket "Encrypted in transit and at rest" covers that DB-stored biometric data. Telling the implementer the DB control is "enabled by default" biases the V5 check toward a false positive — which is precisely the H1 failure mode this whole exercise is meant to eliminate (a consent claim not backed by a verified control).

**Fix:** Split V5 into two checks and drop the "default" claim for the DB:

- **Storage** (`kyc-media` objects): encryption-at-rest is on by default (S3 SSE) — verify it has not been disabled.
- **Database** (biometric descriptors + PII): encryption-at-rest is a **Supabase Pro/Enterprise add-on, off by default** — explicitly confirm it is enabled for this project; if the project is not on a plan that supports it, it is not enabled.

Then: if DB encryption-at-rest is **not** confirmed enabled, the card's blanket "at rest" and bullet 1's "stored encrypted at rest" must be softened (the design already has this fallback) — but the fallback only fires reliably if the implementer does not start from the false assumption that the DB control is on by default. The design's own invariant ("no consent claim that is not backed by code / a verified platform control") requires the DB setting to be verified, not assumed.

---

### 3. MEDIUM — CSP "the canary surfaces missing-source violations before it bites users" is wrong on the first enforced deploy

**Where:** Batch 4, the "First deploy" code (enforced = full policy + canary = stricter on `script-src`) and the "Edge cases" section.

**Problem:** The design promotes the full restrictive policy from report-only to **enforced** on the first deploy while adding a report-only canary that is stricter only on `script-src` (it drops `'unsafe-inline'`). For every **other** directive (`connect-src`, `img-src`, `font-src`, …) the canary is **identical** to the enforced policy. So if a source the app needs is missing (e.g., a face/OCR model CDN not listed in `connect-src`), the **enforced** policy blocks that resource for users **immediately** — at the same moment the canary reports it. The canary does **not** pre-warn for missing sources; it only pre-warns for inline scripts (the one directive where it is stricter).

The design's "Edge cases" claim — *"The kept report-only canary surfaces this in the console before it bites users (report-only does not block)"* — is therefore incorrect for the missing-source case: it bites users (broken capture flow: OCR/face models fail to load) on the first enforced deploy, with no non-blocking pre-warning. For a biometric KYC app about to go public, a broken capture flow is a launch-blocking regression. The design's safer prose ("the implementer must run the full flow under report-only before relying on enforcement") contradicts the step-1 code, which deploys enforced + canary together.

**Fix:** Make the safe procedure explicit and correct the edge-case claim:

1. **Before any code change**, run the full portal flow (document OCR → face → liveness → submit → admin review) plus `/analytics` and `/auth` under the **current** report-only policy and confirm **zero** missing-source violations in the console. This is the pre-enforcement safety gate that actually catches missing sources without blocking users.
2. Only after that clean run, apply the code change promoting the full policy to enforced (with the stricter canary for inline-script detection).
3. Correct the Edge-cases text: the report-only canary pre-warns for **inline scripts only** (where it is stricter); for **missing sources** the enforced policy blocks simultaneously with the canary reporting, so missing-source coverage must be verified under report-only *before* the first enforced deploy — not relied upon to surface "before it bites users."

Alternative: on the first deploy keep the full policy as `Report-Only` (not enforced) and promote to enforced only after a clean canary run, so no source is ever blocked unverified.

---

### 4. NIT — The `CSP_REPORT_ONLY.replace("'unsafe-inline'", "")` canary is positional/fragile

**Where:** Batch 4, the `withSecurityHeaders` snippet.

**Problem:** Dropping `'unsafe-inline'` from `script-src` via a `String.replace` of the first `'unsafe-inline'` occurrence relies on `script-src` appearing before `style-src` in the directive string. If a maintainer reorders the directives, the replace silently strips `'unsafe-inline'` from `style-src` instead — defeating the inline-script detection on which the entire M3/M4 decision procedure depends, with no compile-time signal. (It also leaves a stray double-space in `script-src`, which is harmless but cosmetic.)

**Fix:** Construct the canary as an explicit, separate constant whose `script-src` omits `'unsafe-inline'`, rather than deriving it by positional replace:

```ts
const CSP_SCRIPT_CANARY = ([
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net", // no 'unsafe-inline'
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  /* …rest identical… */
]).join("; ");
```

This is order-independent and self-documenting.

---

### 5. NIT — H3b misattributes the "Too many requests" error path

**Where:** Batch 3, H3b ("the Lovable AI gateway's own 429/402 responses (the handler surfaces 'Too many requests' only for that case …)").

**Problem:** Per `src/lib/ai.server.ts`, the gateway 429 throws `AiError("The AI service is busy. Please wait a moment and try again.")` and 402 throws `AiError("AI credits are used up. Please add credits to continue.")`. Neither message starts with `"Too many requests"`, so the `analyzeDocument` handler's `e.message.startsWith("Too many requests")` check does **not** match them — they surface as the generic `"Document analysis is unavailable."`. The `"Too many requests"` message actually comes from the per-instance `RateLimitError` thrown by `enforceRateLimit("analyze", …)` **before** the AI call. The design has the attribution backwards.

This does not change the residual analysis (the gateway still backstops with an error and `ok:false`), but an implementer relying on the design's description would expect a distinct "Too many requests" signal from the gateway and would not get one.

**Fix:** Correct H3b: the gateway 429/402 backstop surfaces to the caller as the generic `"Document analysis is unavailable."`; the `"Too many requests."` client message comes from the per-instance `RateLimitError`, not the gateway. Update the H3b wording accordingly.

---

### 6. NIT — The H1 "remove claims vs build controls" choice is surfaced only in Overview prose, not as a discrete owner-decision item

**Where:** Overview ("either ship truthful-but-thinner consent now (this design) … or defer launch until those controls are built") vs. Batch 1, which implements the "remove claims" path.

**Problem:** H1's finding offers two valid fixes — implement the promised controls, or remove the false claims. The design defaults to "remove claims" (Batch 1) and presents "build controls" only as D1–D3 plus a prose alternative. But committing a public biometric product to materially thinner consent/trust claims is a product decision with conversion/trust consequences; the owner said "fix all the issues," which could reasonably mean "build the controls." The choice is surfaced in Overview prose but is not a discrete Needs-owner-decision item, and Batch 1 proceeds to implement one side of it.

**Fix:** Add the choice itself as a discrete Needs-owner-decision item (e.g., D0: "Confirm thinner consent (remove claims, ship now) vs. build the retention/erasure/encryption controls (defer launch)") so the owner explicitly signs off on the remove-claims path before Batch 1 ships — rather than having it land as the implicit default.

---

### 7. NIT — zod v4 peer-dependency impact on the installed (unused) `@hookform/resolvers` is not addressed

**Where:** Batch 2 ("`@hookform/resolvers/zod` is not imported anywhere, so form resolvers are unaffected").

**Problem:** The claim is correct at **runtime** (the resolver isn't imported). But `@hookform/resolvers` (v5.2.2) **is** an installed dependency and carries a zod peer dependency; bumping `zod` to v4 can trigger a peer-dependency conflict at `npm install` time even though no code imports it. The design's "unaffected" statement addresses only the code surface.

**Fix:** Add to Batch 2 verification: confirm `npm install` of `zod ^4.6.6` does not conflict with `@hookform/resolvers`'s zod peer range (or remove the unused dependency / use an `override`), so the install succeeds cleanly. Mention this alongside the existing "re-run `npm run build`" step.

---

## Verdict

**CHANGES_REQUESTED.**

Counts: **3 MEDIUM** (Findings 1, 2, 3), **4 NIT** (Findings 4, 5, 6, 7). The MEDIUM findings each block: an incomplete DoS bound that falsifies the stated fallback (1), a verification assumption that risks re-introducing the exact false consent claim H1 targets (2), and a CSP safety procedure whose stated pre-warning mechanism does not work for the missing-source case on first deploy (3). None were downgraded to NIT. The NITs are correctness/maintainability improvements that do not by themselves block.

All findings have concrete, scoped fixes above and can be resolved in a quick loop-back without re-architecting the plan.
