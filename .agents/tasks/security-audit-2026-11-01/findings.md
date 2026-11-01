# Security Audit — VeriAuth AI (KYC biometric verification)

**Scope:** `c:/Users/Ma ron/OneDrive/Desktop/trueengine-main` — TanStack Start (React 19) + Supabase (Postgres RLS) + face-api/tesseract.js, deployed target **Cloudflare Workers** (`cloudflare-module` nitro preset, confirmed by build). Investigation only; no code was modified.
**Date:** 2026-11-01
**Method:** read all source under `src/`, `drizzle/`, `supabase/`, config files; ran `npm audit` (bun was not on PATH; npm used `package-lock.json`); ran a full production `vite build` with dummy env and grepped the emitted client bundle for server-only secret identifiers and source maps.

## Findings by severity

**Critical: 0 | High: 3 | Medium: 6 | Low: 4**  (plus 4 runtime-verification items and 8 owner-decision items)

No committed secrets were found in the repo. No secret identifiers (`SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_`, `LOVABLE_API_KEY`, `LOVABLE_CRON_SECRET`, `client.server`, `ai.server`, `rate-limit.server`) appear in the built client bundle, and no `.map` source maps are shipped to the client — verified by building and grepping `.output/public`. Secret rotation is therefore **not** required based on repository contents; confirm in the hosting platforms that secrets exist only in platform env (Lovable Cloud / Cloudflare / Supabase dashboard).

---

### HIGH

#### H1 — Biometric/PII data handling does not match the consent promises, and no retention or deletion is implemented
- **Location:** Consent claims `src/routes/index.tsx:252-257`; biometric descriptor storage `src/lib/kyc.functions.ts:306-307`; image storage `:271`; dedup loads all descriptors `:231-237`; schema `drizzle/migrations/0001_kyc_biometrics.sql` (`face_descriptor real[]`, `id_face_descriptor real[]`, `document_path`, `selfie_path`, `back_document_path`); types `src/integrations/supabase/types.ts`.
- **Evidence:** The consent panel tells users:
  - "Media encrypted with AES-256-GCM; keys rotated every 24 hours." (line 252)
  - "Biometric templates stored as irreversible vector hashes only." (line 253)
  - "Raw document and selfie media auto-purged after 30 days." (line 254)
  - "Every access is written to an immutable audit log." (line 256)
  - "You may request deletion at any time via the data portal." (line 256)

  None of these are implemented:
  - `face_descriptor`/`id_face_descriptor` are the **raw 128-float face-recognition vectors**, stored in plaintext as `real[]` — they are reversible, reusable biometric templates, **not** "irreversible vector hashes". `vector_hash` (sha256 of `fullName|dateOfBirth`) is a dedup key, not a biometric hash.
  - There is **no purge job, scheduled function, retention timer, or 30-day expiry** anywhere in the codebase (the "auto-purge" line in `analytics.tsx` audit log is hardcoded mock data). Raw ID/selfie images live in the private `kyc-media` storage bucket indefinitely.
  - There is **no deletion endpoint, data portal, or account-deletion flow**. A grep for `delete`/`remove` on the `verifications`/storage paths returns nothing. No GDPR/BIPA right-to-erasure path exists.
  - "Immutable audit log" — reads are not audited (only `review_verification` status changes write to `audit_log` via the trigger), and the table is not append-only at the DB level (service role can delete rows).
  - "AES-256-GCM key rotation every 24h" is not verifiable and is not an application control; it is a platform claim presented as an app guarantee.
- **Impact:** For a biometric KYC product about to go public, this is the most serious exposure: storing raw face templates + raw ID/selfie images with no retention cap and no deletion path, while telling data subjects the opposite in the consent text, creates direct **BIPA (Illinois) and GDPR** liability (unlawful retention, no erasure, deceptive consent). The false claims are also a deceptive-practices/FTC risk independent of any breach.
- **Fix:** Either implement the promised controls (automated purge per a written retention policy, a deletion/right-to-erasure endpoint that removes the DB row + storage objects + descriptors, encryption-at-rest/key management for biometric templates, audit of read access) **or** remove every claim from the consent panel that is not true. Decide the retention/erasure policy first — see Needs Owner Decision.

#### H2 — `zod` vulnerable to memory-exhaustion DoS on anonymous input-validation endpoints
- **Location:** `src/lib/kyc.functions.ts:194` (`submitVerification` input is the entire raw client payload parsed by zod) and `:65` (`analyzeDocument`); `package.json` pins `zod ^3.25.76`. `npm audit --omit=dev` reports `zod <4.6.6` — **high** — "Zod can exhaust memory while validating oversized constrained collections" (GHSA-mrhx-c7xc-m3w5).
- **Evidence:** `submitVerification`'s `.inputValidator((d: unknown) => d)` accepts the full client body, then `submitInput.safeParse(raw)` runs zod over it (`consent` is `z.record(...)` with no key-count cap; arrays use `.catch/.transform` caps but the exhaustion can occur before `.catch` resolves). Both endpoints are **anonymous** (no auth middleware) and reachable by anyone. The production build (`zod.mjs` 100 kB) ships this path on the server.
- **Impact:** A remote, unauthenticated attacker can crash/DoS the verification service (and, on Cloudflare Workers, exhaust the isolate's memory/CPU budget, affecting all tenants on the isolate) by sending oversized constrained collections to `submitVerification`/`analyzeDocument`.
- **Fix:** Upgrade `zod` to `>=4.6.6` (a breaking v3→v4 migration; budget for schema changes) and add explicit size caps on unbounded fields (e.g. cap `consent` keys, cap total payload size before parsing). Also fix H3-class server hardening around these endpoints.

#### H3 — Anonymous submission endpoint writes biometric data + images via the service-role key with weak abuse controls
- **Location:** `src/lib/kyc.functions.ts:192-208` (no auth middleware; `enforceRateLimit("submit", 5, 10*60_000)`), `:208` (`supabaseAdmin` import), `:271` (storage upload), `:283` (DB insert), `:306-307` (descriptor insert).
- **Evidence:** `submitVerification` and `analyzeDocument` are `createServerFn` with **no `.middleware(requireSupabaseAuth)`** (the `requireSupabaseAuth` middleware in `src/integrations/supabase/auth-middleware.ts` is defined but unused). Anyone can POST, and the handler runs with the **service-role key (bypasses RLS)** to upload to the private `kyc-media` bucket and insert into `verifications`. Controls are: zod validation (6 MB data-URL cap, magic-byte check via `toBytes`), 3 required consent booleans, and an in-memory rate limit. The server-computed `status` can only be `Pending` or `Rejected` (never `Approved` — the comment at `src/lib/kyc.functions.ts` ~:188 explicitly guards auto-approval), so this is not an authz bypass, but it is an unauthenticated write/abuse path.
- **Impact:** Anonymous abuse can fill private storage with biometric images and drive up AI-gateway cost (every `analyzeDocument` call sends the image to the Lovable AI gateway). Combined with the per-instance rate limiter (M1), an attacker can exceed the intended 5-per-10-min limit trivially across instances.
- **Fix:** Add a shared, server-side rate limit (see M1) and a global submission cap; consider a captcha/proof-of-work or a per-IP storage quota for anonymous submissions; keep the never-auto-approve guarantee.

---

### MEDIUM

#### M1 — Rate limiting is in-memory per-instance; ineffective on the Cloudflare deploy target
- **Location:** `src/lib/rate-limit.server.ts:11` (`buckets = new Map()`), `:17-37` (`enforceRateLimit`), `:13-15` (`clientIp` reads `cf-connecting-ip` / `x-real-ip` / `x-forwarded-for`).
- **Evidence:** The limiter state lives in a module-level `Map`. The build emits `cloudflare-module`, so production runs across many isolates with independent maps. The file's own comment says: "For multi-instance / serverless production, back this with a shared store." `clientIp()` trusts `x-forwarded-for` when Cloudflare headers are absent — client-spoofable off-Cloudflare.
- **Impact:** Per-IP limits (analyze 20/10min, submit 5/10min) are effectively bypassable by hitting different isolates or spoofing `x-forwarded-for` (if not behind Cloudflare). Enables the H3 abuse and brute-force amplification.
- **Fix:** Back the limiter with a shared store (Cloudflare KV/Durable Objects, Upstash, or a Supabase counter table). On Cloudflare `cf-connecting-ip` is authoritative — keep that, drop reliance on `x-forwarded-for` as a primary source.

#### M2 — Liveness detection and face-match are fully client-side and client-asserted (spoofable)
- **Location:** Liveness loop `src/routes/index.tsx` (`LivenessStep`, ~`:430-700`); face descriptor extraction `src/lib/face.ts` (browser face-api); client-side match `src/lib/face.ts:compareFaces` called in `src/routes/index.tsx` `ResultStep` (~`:1130`); the client sends `face.similarity`, `face.samePerson`, and `liveness.challenges` to the server (`src/lib/kyc.functions.ts` `submitInput`, ~`:96-126`).
- **Evidence:** The selfie/ID face descriptors, the similarity score, the `samePerson` boolean, and the liveness challenge log are all computed in the browser and sent as request fields. The server stores and scores them. The mitigation is explicit (`src/lib/kyc.functions.ts` ~:188 "every input above is client-supplied, so the system must never auto-approve") — final status is always `Pending` or `Rejected` and a human reviews. That mitigation is sound; the residual risk is that liveness/face-match assurance is only as strong as "a human eyeballs it."
- **Impact:** A determined attacker can submit fabricated descriptors / "all challenges passed" and get a Pending case with an inflated trust score, relying on reviewer inattention. This is acceptable for assisted review but is not genuine liveness assurance.
- **Fix:** No code change strictly required if the human-review model is the intended assurance. If stronger assurance is required, move liveness/face-match to the server (or a specialist vendor) — see Needs Owner Decision D8.

#### M3 — Content-Security-Policy is effectively report-only; XSS defense-in-depth is absent
- **Location:** `src/server.ts` `withSecurityHeaders()` — sets the enforced `Content-Security-Policy` header to **only** the `FRAME_ANCESTORS` string, and the full restrictive policy only as `Content-Security-Policy-Report-Only`; the report-only policy permits `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:`.
- **Evidence:** The comment states the full policy is "report-only first … tighten and enforce after checking the console." As shipped, the enforced CSP blocks clickjacking only; there is no enforced `script-src`/`connect-src`/etc., and even the report-only policy allows `'unsafe-inline'` scripts. No `dangerouslySetInnerHTML` with user content was found (the only one is static CSS in `src/components/ui/chart.tsx:73`), so there is no current XSS sink — but if one is introduced, the CSP will not stop it.
- **Impact:** Low immediate (no XSS sink found) but weak posture for a public biometric app. Combined with M4, a single future XSS would have no CSP backstop.
- **Fix:** After confirming nothing breaks, switch the full policy from `Content-Security-Policy-Report-Only` to the enforced `Content-Security-Policy`, remove `'unsafe-inline'` from `script-src` (use nonces/hashes), and keep `frame-ancestors`.

#### M4 — Supabase session tokens are stored in `localStorage`
- **Location:** `src/integrations/supabase/client.ts:51-55` (`auth: { storage: brokeredPreviewStorage(), persistSession: true }`); `src/integrations/supabase/previewAuthStorage.ts` returns `localStorage` on any non-Lovable-preview host (i.e. the public domain).
- **Evidence:** On the production domain the storage falls back to `localStorage`, so the admin's Supabase `access_token`/`refresh_token` live in `localStorage`, readable by any script in the page. With M3 (no enforced CSP), a future XSS would exfiltrate admin sessions.
- **Impact:** Admin KYC sessions are JS-accessible. Today there is no XSS sink, so risk is latent; for an admin-only app handling biometric data it is a meaningful defense-in-depth gap.
- **Fix:** Prefer Supabase cookie-based SSR auth (HttpOnly, Secure, SameSite=Lax) over `localStorage`, or at minimum enforce a strict CSP (M3) so XSS cannot read the token.

#### M5 — ID images are sent to a third-party AI processor (Lovable AI gateway → OpenAI) but consent does not disclose this
- **Location:** `src/lib/ai.server.ts:12` (`GATEWAY = "https://ai.gateway.lovable.dev/v1/responses"`, model `openai/gpt-6-astra`), `:22` (`LOVABLE_API_KEY`); called from `src/lib/kyc.functions.ts:71-78` passing the user's ID image (`input_image`) to the gateway.
- **Evidence:** `analyzeDocument` sends the raw document image (front/back) to the Lovable AI gateway, which forwards to OpenAI. The "Document scanning" consent (`src/routes/index.tsx` consents array) says only "Allow optical capture and MRZ/OCR parsing of my identity document" — it does not mention AI processing or a third-party/sub-processor.
- **Impact:** Undisclosed transfer of ID images to a sub-processor is a GDPR Article 13/14 transparency gap and a BIPA-relevant disclosure gap for a biometric KYC flow.
- **Fix:** Disclose third-party AI processing in the consent text and ensure a data-processing agreement is in place with the gateway provider; or run OCR on-device only (the `ocr-fallback.ts` Tesseract path already exists) and drop the AI OCR path for production.

#### M6 — Dependency vulnerabilities in production runtime (seroval, vite)
- **Location:** `package.json` (`vite` pinned `8.1.5`; `@tanstack/react-start`/`@tanstack/react-core` pull in `seroval`); `auditprod.txt` (`npm audit --omit=dev`).
- **Evidence:** `npm audit --omit=dev` reports: `seroval 1.5.5–1.6.10` **moderate** (code injection via typed-array constructor; script injection via RegExp sources in serialized output — GHSA-f86p-h4j2-7qgj, GHSA-9wx9-5pv9-3349), used by TanStack to serialize server-function payloads; and `vite 8.0.0–8.1.5` **high** (launch-editor command-injection/Windows bypass + cross-origin script execution via custom middleware — GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm, GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22). The `vite` issues are dev-server/launch-editor scope (the production runtime serves the built bundle, not the Vite dev server), so real-world prod exposure for vite is low; `seroval` runs in the prod request path.
- **Impact:** `seroval` could enable code/script injection if attacker-influenced values (RegExp/typed-arrays with poisoned constructors) round-trip through server-fn serialization; this app's responses are structured and don't obviously serialize such values, so exploitability is low-but-not-zero. `vite` affects the dev server and the build pipeline, not the deployed runtime.
- **Fix:** `npm audit fix --force` will move `vite`→8.3.5 and `seroval` via TanStack bumps; bump `zod` per H2. Re-test after upgrades (vite/seroval bumps can be breaking).

---

### LOW

#### L1 — Dev-only dependency vulnerabilities (build/lint toolchain, not shipped to runtime)
- **Evidence:** `npm audit` (with devDeps) additionally reports `esbuild` (transitive via `drizzle-kit` → `@esbuild-kit/esm-loader`), `minimatch <11.0.1` (ReDoS, via `eslint`/`typescript-eslint`), and the `eslint`/`@eslint-community/eslint-utils` chain. All are `devDependencies` (`drizzle-kit`, `eslint`, `typescript-eslint`) used at build/lint time only — none ship to the production runtime (confirmed absent from `.output/public`).
- **Fix:** Routine `npm audit fix` for the dev toolchain; low priority.

#### L2 — Signed media URLs are unauthenticated bearer tokens (600s)
- **Location:** `src/routes/_authenticated/admin.tsx` `useSignedUrl` (`createSignedUrl(path, 600)`).
- **Evidence:** Admin review fetches time-limited signed URLs for the private `kyc-media` objects; the URL itself grants read for 10 minutes to anyone who obtains it.
- **Impact:** Standard Supabase pattern; acceptable. Risk is only if a URL is logged/shared.
- **Fix:** Keep the short TTL; ensure signed URLs are never written to logs.

#### L3 — `case_code` is sequential and enumerable
- **Location:** `drizzle/migrations/0000_kyc_core.sql` (`case_seq start 10001`, default `'VA-' || nextval`).
- **Evidence:** Case codes are sequential. They do not themselves leak data (all reads are admin-RLS-gated; the submit response returns only the submitter's own code and a `Flagged`/clear boolean, never another case's code), but sequential identifiers aid enumeration of volume.
- **Fix:** Optional — make `case_code` a random token if you don't want ordering inferable.

#### L4 — Hygiene: unused auth middleware, deprecated API, oversized client chunk
- **Evidence:** `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts:34`) is exported but never applied to any server fn. Build emits deprecation warnings (`createServerFn().inputValidator()` → `.validator()`) and a 1.3 MB client chunk (`index-*.js`).
- **Fix:** Delete unused middleware or apply it where appropriate; switch to `.validator()`; code-split the client bundle. Not security-critical.

---

## Needs runtime verification (could not confirm by reading source)

- **V1 — Confirm migration `0003_security_hardening` is actually applied in the live Supabase DB.** The code assumes `review_verification()` and the self-restricting `has_role()` exist and that direct `UPDATE` on `verifications` was revoked from `authenticated` and the bucket is `public=false` (`drizzle/migrations/0003_security_hardening.sql`). `drizzle/schema.ts` is intentionally blank, so this could not be verified from the repo. In the Supabase SQL editor confirm: `review_verification` exists, `has_role` body includes `auth.role() = 'service_role' or _user_id = auth.uid()`, the `Admins update verifications` policy is gone, `verifications` UPDATE is revoked from `authenticated`, and `storage.buckets.public = false` for `kyc-media`. If `0003` was **not** applied, authenticated non-admins could `UPDATE` verifications directly (authz gap) and the admin review UI would error.
- **V2 — Confirm deployed response headers match `src/server.ts`.** Verify the live site returns the security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, the CSP headers) and that no platform/CDN config injects a wildcard or reflective `Access-Control-Allow-Origin` with credentials. No custom CORS was found in code; server functions are same-origin RPC, but confirm at runtime.
- **V3 — Confirm Supabase project hardening.** Public sign-ups disabled (per the `0003` comment), RLS enabled on every table incl. `storage.objects`, a strong JWT secret, and Supabase Auth brute-force/rate limiting enabled (the app does not rate-limit `signInWithPassword` itself — `src/routes/auth.tsx` relies on Supabase).
- **V4 — Confirm no source maps ship in the deployed client.** This build emitted none in `.output/public`; confirm the deploy config doesn't enable `sourcemap: true` and that the CDN doesn't serve `.map` files from the server bundle.

## Needs owner decision (product/security tradeoffs not pre-authorized)

- **D1 — Data retention policy.** Decide the actual retention period for raw ID/selfie images and face descriptors, then implement an automated purge (or accept indefinite retention and stop claiming 30-day auto-purge).
- **D2 — Right to erasure.** Implement a deletion/data-subject-request flow (remove DB row + storage objects + descriptors + audit references), or remove the "request deletion via the data portal" claim.
- **D3 — Biometric template storage.** Decide whether to keep raw 128-float face descriptors (encrypt-at-rest + strict access control + retention) or stop storing them (recompute/dedupe on `vector_hash` only). Reconcile the "irreversible vector hashes" claim with reality — face descriptors cannot be one-way hashed and still be matchable, so the claim should be removed or the storage model changed.
- **D4 — Consent text accuracy.** Align all five consent claims (`src/routes/index.tsx:252-256`) with what is actually implemented; otherwise the consent is deceptive.
- **D5 — Third-party AI processor disclosure + DPA.** Disclose the Lovable AI gateway / OpenAI processing in consent and put a data-processing agreement in place, or disable the AI OCR path and use on-device Tesseract only.
- **D6 — Admin account hardening.** Enable MFA and (optionally) a captcha on admin sign-in (`src/routes/auth.tsx`); ensure the single admin uses a strong unique password. The admin account is the sole gate on all biometric data.
- **D7 — Rate limiting shared store.** Move the limiter off the per-instance `Map` (Cloudflare KV/Durable Objects/Upstash) so multi-isolate limits hold — or accept the current per-isolate behavior.
- **D8 — Server-side liveness/anti-spoof.** If genuine liveness assurance (not just assisted human review) is required, move liveness/face-match to the server or a specialist vendor. Otherwise document that the product's assurance model is "human review of client-captured evidence."

## What is already solid (baseline)

- Row-level security + a `SECURITY DEFINER` `review_verification()` that enforces admin server-side and can only set review fields; direct `UPDATE` revoked from authenticated users (pending V1). `has_role` is self-restricting (no role enumeration).
- No raw SQL / string-interpolated queries — all DB access uses parameterised Supabase/PostgREST calls (`src/lib/kyc.functions.ts`).
- CSRF middleware applied to server functions (`src/start.ts` `createCsrfMiddleware`), and auth is bearer-token based (not cookies), so session-fixation/CSRF surface is small.
- File uploads validated by magic bytes and capped at 6 MB; storage paths use `crypto.randomUUID()` folders with fixed extensions (no path traversal from filenames); private bucket.
- Error responses to clients are generic (`src/server.ts`, `src/lib/kyc.functions.ts`) — stack traces go only to server logs. Timing-safe cron auth (`src/integrations/supabase/cron-auth.ts`).
- Security headers present (HSTS, nosniff, Referrer-Policy, Permissions-Policy `camera=(self)`); `frame-ancestors 'self'` enforced.
- No secrets committed; service-role/AI/cron secrets are server-only and were verified absent from the built client bundle (no `.map` files shipped either).
