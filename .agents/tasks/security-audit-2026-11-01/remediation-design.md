# Remediation Design — VeriAuth AI Security Audit (2026-11-01)

**Status:** Second iteration — revised to address `design-review.json` (verdict: CHANGES_REQUESTED; 0 HIGH, 4 MEDIUM, 6 NIT). See "Responses to design-review findings" at the end.
**Audience:** Implementer + product owner.
**Source findings:** `findings.md` (0 Critical, 3 High, 6 Medium, 4 Low, 4 runtime-verification items, 8 owner-decision items).
**Review:** `design-review.md` + `design-review.json`.

## Overview

This is a TanStack Start (React 19) single-page app backed by Supabase (Postgres with RLS) that runs a biometric KYC flow, deployed to **Cloudflare Workers** (`cloudflare-module` nitro preset, confirmed in `vite.config.ts`). The app has two sides: an anonymous public portal (`/`) that captures ID/selfie images, runs on-device face/liveness checks (face-api + tesseract.js), and submits via the `submitVerification`/`analyzeDocument` server functions; and an admin dashboard (`/_authenticated/admin`) that reviews cases over Supabase RLS and approves/rejects via a `SECURITY DEFINER` `review_verification()` RPC. There are **no committed secrets** and **no active authn/authz bypass** — the baseline RLS + never-auto-approve model is sound. The real risks before public launch are: (1) consent text that makes data-handling promises the app does not keep (H1/M5 — legal liability), (2) a memory-exhaustion DoS on the anonymous parse path via a vulnerable `zod` (H2), (3) an anonymous unauthenticated write/abuse path (H3), and (4) defense-in-depth gaps around the admin session (M3/M4). Dependencies (M6) round out the Highs.

The strategy is **minimal, targeted changes that close each vulnerability without restructuring working code**, ordered critical-first. Where a fix would change product/data-handling behavior the owner has not authorized, or require paying for a service, it is moved to **Needs owner decision** and not silently designed in. The most important call for the owner is H1: either ship truthful-but-thinner consent now (this design) and separately decide the real retention/erasure/biometric-storage controls, or defer launch until those controls are built.

### Locked technology stack

- **Runtime:** TanStack Start `@tanstack/react-start` 1.168.x, `@tanstack/react-router` 1.170.x, React 19.2, deployed via Cloudflare Workers (`cloudflare-module`).
- **Data:** Supabase (Postgres + RLS) via `@supabase/supabase-js` ^2.117; admin client uses the service-role key (server-only); browser client uses the publishable key.
- **Validation:** `zod` upgraded to `^4.6.6` (from `^3.25.76`) — pinned in `package.json` (H2).
- **Build:** `vite` bumped to `^8.3.5` (from `8.1.5`); `seroval` pinned to `>=1.6.11` via the `package.json` `overrides` block (M6).
- **Biometrics:** `@vladmandic/face-api` (client), `tesseract.js` (client OCR fallback); server OCR via the Lovable AI gateway (`https://ai.gateway.lovable.dev/v1/responses`, model `openai/gpt-6-astra`), keyed by `LOVABLE_API_KEY`.
- **Auth:** Supabase email/password for the single admin; bearer-token server functions with CSRF middleware (`createCsrfMiddleware` in `src/start.ts`).
- Note: the auto-generated files (`client.ts`, `previewAuthStorage.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `cron-auth.ts`, `client.server.ts`) carry a "Do not edit it directly" header. Edits there are kept to what the generator would not overwrite, and the need to edit them is flagged.

### Implementation order

```
Batch 0 (Critical):  Verify & lock down DB authorization + Supabase project   [V1, V3]   ← launch blocker
Batch 1 (High):       Make consent truthful + disclose third-party AI          [H1, M5, D4]
Batch 2 (High):       Dependency security upgrades (zod, vite, seroval, dev)  [H2, M6, L1, L4]
Batch 3 (High):       Anonymous-submission abuse controls + IP hardening      [H3, M1-partial]
Batch 4 (Medium):     Enforce full CSP (session/CSP defense-in-depth)         [M3, M4, V2, V4]
Batch 5 (Low):        Hygiene (signed URLs, case_code, bundle)                [L2, L3, L4]
                     (M2 needs no code change; documented under Batch notes)
```

Critical-first (committed secrets / RLS / auth-session): **no committed secrets exist** (verified absent from the built client bundle in `findings.md`); the only critical-priority work is verifying the live DB/Supabase authorization (Batch 0). The auth-session defense-in-depth (M4) is Medium and handled in Batch 4 because the active authz is already enforced server-side.

---

## Batch 0 — Critical: Verify & lock down database authorization + Supabase project (V1, V3)

No app code changes. This is SQL verification + dashboard settings that the application already assumes are true; it is a **launch blocker** because the admin review UI and the non-admin UPDATE revocation depend on migration `0003_security_hardening.sql` being live.

### V1 — Confirm migration `0003_security_hardening` is applied in the live DB

Run these in the Supabase SQL editor and confirm each. All queries are schema-qualified to `public` to avoid stray rows from other schemas:

| Check | Query | Expected |
|---|---|---|
| `review_verification` exists & is `security definer` | `select proname, prosecdef from pg_proc p join pg_namespace n on p.pronamespace=n.oid where proname='review_verification' and n.nspname='public';` | 1 row, `prosecdef = true` |
| `has_role` is self-restricting | `select prosrc from pg_proc p join pg_namespace n on p.pronamespace=n.oid where proname='has_role' and n.nspname='public';` | body contains `auth.role() = 'service_role' or _user_id = auth.uid()` |
| "Admins update verifications" policy removed | `select * from pg_policies where tablename='verifications' and policyname='Admins update verifications';` | 0 rows |
| `UPDATE` revoked from `authenticated` | `select * from information_schema.role_table_grants where table_name='verifications' and privilege_type='UPDATE' and grantee='authenticated';` | 0 rows |
| `kyc-media` bucket private | `select id, public from storage.buckets where id='kyc-media';` | `public = false` |
| RLS on `storage.objects` | `select relname, relrowsecurity from pg_class where relname='objects' and relnamespace=(select oid from pg_namespace where nspname='storage');` | `relrowsecurity = true` |

**If any check fails, remediate by applying the specific statement from `0003_security_hardening.sql`** (re-run `create or replace function public.has_role(...)`, `drop policy if exists "Admins update verifications"`, `revoke update on public.verifications from authenticated`, `update storage.buckets set public = false where id='kyc-media'`). These are idempotent. The `verifications_audit` trigger from `0000` must remain in place.

- **Failure conditions / impact:** if `review_verification` is missing, admin review RPCs return `42883` and approval is impossible. If `has_role` is the old non-self-restricting version (from `0000`), role enumeration of other users is possible. If `UPDATE` is still granted to `authenticated`, a signed-in non-admin could `PATCH` verifications directly — an authz gap.
- **Owner of enforcement:** Supabase DB layer; the app code only calls `review_verification()` and relies on RLS.
- **Logged at:** Supabase dashboard logs; failed RPCs surface in the admin UI toast.

### V3 — Confirm Supabase project hardening (dashboard, not code)

- Disable public sign-ups: Auth → Sign In / Providers → "Allow new users to sign up" = **off**. Required: admin gating relies on no self-service account creation (the seed comment in `0003` assumes a manually-seeded first admin).
- RLS enabled on every table incl. `storage.objects` (Table editor → RLS).
- Strong JWT secret (Settings → API); rotate if default/weak.
- Enable Supabase Auth brute-force/rate-limiting (Auth settings). The app does **not** rate-limit `signInWithPassword` itself (`src/routes/auth.tsx` relies on Supabase), so Supabase-side protection is the only control on admin sign-in.
- Confirm encryption-at-rest is enabled for both Database and Storage (used by the consent wording in Batch 1): Settings → Database → "Encryption at rest" (Supabase enables this by default; verify it is not disabled). See new runtime-verification item V5.

- **Assumption:** the Supabase project in use is the one these migrations were written for. If a different project was provisioned for launch, re-apply `0000`–`0003` in order there.
- **Testability:** the verification queries above are the test.

---

## Batch 1 — High: Make consent truthful + disclose third-party AI (H1, M5, D4)

The most serious exposure is that the consent panel (`src/routes/index.tsx`) promises data-handling controls that do not exist (AES-256-GCM with 24h key rotation, "irreversible vector hashes", 30-day auto-purge, immutable read audit log, deletion portal). This creates BIPA/GDPR liability and an FTC deceptive-practices risk independent of any breach. The **minimal, owner-authorized fix is to make the text match reality**, not to build the controls — building the controls changes data-handling behavior the owner has not authorized (see Needs owner decision D1–D3).

### Files

- `src/routes/index.tsx` — the "Zero-Trust Privacy Guarantee" card (~line 236), the `showPolicy` bullet list (~lines 252–258), and the `consents` array (~lines 70–86).
- `src/lib/kyc-data.ts` — the mock `auditLog` array (lines ~110–114) is **dead code** (exported, never imported anywhere in `src/**` — confirmed by grep), and contains two fabricated entries that reinforce the exact claims removed below.

### Approach for H1 (remove the five false claims)

Replace the five policy bullets with accurate statements. Each change below either removes a fabricated claim or restates it as something actually true:

1. "Media encrypted with AES-256-GCM; keys rotated every 24 hours." → **Remove the AES-256-GCM / 24h-rotation claim (fabricated app-level guarantee the app does not implement).** Replace with: "Your documents are transmitted over encrypted HTTPS and stored encrypted at rest in a private, access-controlled storage bucket." The "at rest" wording refers to **platform-managed** Supabase encryption (DB + Storage), not the fabricated app-level AES-256-GCM key rotation — and is gated on verification item V5. This keeps bullet 1 consistent with the "Zero-Trust Privacy Guarantee" card directly above (see N8 reconciliation below).
2. "Biometric templates stored as irreversible vector hashes only." → **Remove "irreversible"/"hashes" (false: `face_descriptor`/`id_face_descriptor` are raw 128-float vectors, reversible).** Replace with: "Facial descriptors are extracted on your device and stored to detect duplicate applications. They are not sold or shared."
3. "Raw document and selfie media auto-purged after 30 days." → **Remove entirely.** No purge exists. (Re-added only if/when D1 sets a real policy.)
4. "Every access is written to an immutable audit log." → **Replace.** Only review-status changes are audited (`verifications_audit` trigger), reads are not, and the table is not append-only at the DB level. New text: "All review decisions are recorded in an audit log."
5. "You may request deletion at any time via the data portal." → **Remove entirely.** No deletion portal or endpoint exists. (Re-added only if/when D2 is implemented.)

### Reconcile the "Zero-Trust Privacy Guarantee" card with the bullets (N8)

The card above the bullets (line ~236) currently reads: "Encrypted in transit and at rest. No data sold, ever." The bullet-1 edit above reintroduces an at-rest claim so the card and the bullet agree. Decision: **keep the card's "at rest" wording**, because it refers to platform-managed Supabase encryption (a real platform control), which is a different and accurate statement from the fabricated app-level "AES-256-GCM; keys rotated every 24 hours." To avoid re-introducing an unverified claim, this is gated on V5: confirm Supabase DB + Storage encryption-at-rest is enabled for this project.

- If V5 confirms encryption-at-rest is enabled → keep the card unchanged and the bullet-1 wording above. Card and bullet are consistent and accurate.
- If V5 finds encryption-at-rest is **not** enabled → soften the card to "Encrypted in transit; stored in a private, access-controlled bucket." and change bullet 1 to "Your documents are transmitted over encrypted HTTPS and stored in a private, access-controlled storage bucket." (dropping "encrypted at rest" from both). Do not ship an "at rest" claim that cannot be verified the same way the AES-256-GCM claim was rejected.

This keeps the at-rest claim accurate-and-consistent (the design's invariant is "no consent claim that is not backed by code / a verified platform control") rather than removing it from the bullet while leaving it on the card.

### Approach for M5 (disclose third-party AI processing, concretely named)

`analyzeDocument` sends the raw ID image to the Lovable AI gateway (`src/lib/ai.server.ts`), which forwards to OpenAI (`openai/gpt-6-astra`); consent does not mention AI or a sub-processor. GDPR Art. 13/14 transparency prefers identifying the recipient/category concretely, so the disclosure names it rather than saying "our cloud AI sub-processor" generically.

- Update the "Document scanning" consent detail (consents array, key `doc`, line ~73) from "Allow optical capture and MRZ/OCR parsing of my identity document." to: "Allow capture of my identity document and AI-assisted OCR analysis — including processing by a cloud AI sub-processor (OpenAI via our AI gateway) — to extract and verify identity fields."
- Add one accurate policy bullet: "Document images are processed by a third-party cloud AI service (OpenAI via our AI gateway) for OCR analysis."

**No privacy-policy reference.** This batch does **not** add "See our privacy policy for details" — no privacy-policy route or component exists in the app (grep finds only the "Consent & Privacy" step title, the "Privacy Audit Status" metric, and this "Zero-Trust Privacy Guarantee" card; no `/privacy` page). Referencing a document that does not exist would violate the design's own "no claim not backed by code" invariant. Publishing a privacy policy is a separate launch item — see Needs owner decision D9.

### Approach for D4

D4 ("align all five consent claims with what is implemented") is satisfied by the H1 edits above — every claim is now accurate, removed, or (for at-rest) a verified platform control gated on V5.

### Approach for the mock audit log (dead code — delete, do not hand-edit)

`auditLog` in `src/lib/kyc-data.ts` (lines ~110–114) is **exported but never imported anywhere** (verified by grep across `src/**` — only the definition site matches). It does **not** render on `/analytics` (`analytics.tsx` imports only `attackResilience` and `latencyBreakdown` from `@/lib/kyc-data`); the prior design's "renders on the public /analytics page" rationale was incorrect.

The array contains **two** fabricated entries that reinforce the exact claims removed from consent:
- `auditLog[0]`: "Biometric template hashed and encrypted (AES-256-GCM)" — reinforces the removed AES/hashing claims.
- `auditLog[3]`: "Auto-purge cycle removed 412 expired records (30-day policy)" — reinforces the removed 30-day auto-purge claim.

**Fix: delete the entire `auditLog` export** from `kyc-data.ts` (the five-element array, lines ~110–114). Editing one entry of dead code removes no user-facing exposure and leaves the other fabricated entry in the repo; deleting the dead export removes both fabricated claims from the codebase with no behavior change (nothing imports it). If a future owner wires up a live audit log, they will write fresh, accurate entries — these mocks should not be the seed.

### Edge cases & invariants

- **Consent keys must not change.** The server gate `["doc","bio","retention"].every((k) => data.consent[k] === true)` (`src/lib/kyc.functions.ts`) depends on exactly these three keys (`doc`/`bio`/`retention`, confirmed at lines 71/76/81). Keep the keys; edit only `label`/`detail` text and the policy bullets.
- The `consent` zod record `z.record(z.string(), z.boolean())` still validates any subset; the three-key requirement is enforced in the handler, not the schema. (Batch 2 will cap record keys.)
- Removing the "data portal" line must not leave a dead link — there is no link element today, only prose, so nothing else changes. Likewise M5 adds no dead "privacy policy" reference.

### Error handling

Pure text/content change plus a dead-code deletion; no runtime failure paths. If a future owner restores a claim, it must match an implemented control or a verified platform control (the design's invariant is "no consent claim that is not backed by code / a verified control").

### Testability

- Unit/integration: assert the consent panel renders the new strings and that `submitVerification` still requires all three consent keys (unchanged); assert `auditLog` is no longer exported from `kyc-data.ts` (or that nothing references it).
- Manual: visually confirm no fabricated retention/encryption/deletion/audit claims remain on `/`; confirm the card and bullet-1 agree on the at-rest wording.

### Needs owner decision (NOT designed here)

- **D1** Data retention policy + automated purge (changes data-handling behavior).
- **D2** Right-to-erasure endpoint + data-subject-request flow (new feature + policy).
- **D3** Biometric template storage model — keep raw 128-float descriptors with encryption-at-rest + access control + retention, or stop storing them and dedupe on `vector_hash` only (changes the dedup/storage model). The "irreversible vector hashes" claim is removed in this batch; face descriptors cannot be one-way hashed and remain matchable, so that specific claim must never return unless the storage model changes.
- **D9 (new)** Publish a privacy policy. A public biometric KYC product needs a privacy notice (GDPR Art. 13/14 transparency; BIPA written-policy/notice obligations) covering the AI sub-processor (OpenAI via the Lovable AI gateway), data retention, and data-subject rights. No `/privacy` route exists today. *Tradeoff: legal/content work.* This is a launch blocker for a public biometric KYC app; until it ships, consent must state the disclosure inline (done above) and must not reference a privacy policy that does not exist.

---

## Batch 2 — High: Dependency security upgrades (H2, M6, L1, L4)

### H2 — Upgrade zod v3 → v4 (≥4.6.6) + add pre-parse size caps

**File:** `package.json` (`zod`), `src/lib/kyc.functions.ts` (schemas + the two server fns).

The root cause is `zod ^3.25.76` (<4.6.6), vulnerable to memory exhaustion while validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5), reachable on the **anonymous** `submitVerification`/`analyzeDocument` parse paths. Two layers close it: (a) upgrade to the patched major, (b) bound collection sizes *before* zod touches them.

**Upgrade:**
- `package.json`: `"zod": "^3.25.76"` → `"zod": "^4.6.6"`.
- `npm install`, then fix the breaking surface for this file (the only file that imports `zod` — verified by grep across `src/**`; `@hookform/resolvers/zod` is not imported anywhere, so form resolvers are unaffected):
  - **`.inputValidator()` → `.validator()`** on both `analyzeDocument` and `submitVerification`. (This also clears the L4 deprecation warning.)
  - `submitInput` schema, port the constructs that changed across v3→v4:
    - `z.record(z.string(), z.boolean())` — stable in v4; keep but add the key cap (below).
    - `liveness.challenges`: the original is `z.array(...).catch([]).transform((a) => a.slice(0, 10))`. Keep the 10-element **storage** cap by writing `z.array(...).max(20).catch([]).transform((a) => a.slice(0, 10))`. Note on the bound: **`preValidateSize` (below) is the real guard against the GHSA allocation-exhaustion vector** — zod parses every array element *before* evaluating `.max()`, so `.max(20)` does **not** prevent the element-by-element allocation the advisory describes; it is redundant defense-in-depth. The `.slice(0, 10)` is retained purely to preserve the existing 10-element storage behavior (11–20 valid challenges are now accepted-and-then-trimmed rather than rejected — harmless, and the never-auto-approve invariant is unaffected).
    - `descriptor = z.array(z.number().finite()).length(128).nullable().catch(null)` — `.length(128)` is exact; stable in v4. Keep.
    - `clip = (n) => z.string().catch("").transform(...)` and `dateField` — verify `.catch().transform()` chaining behaves the same in v4 (`.catch` returns the fallback value, `.transform` runs on it); adjust if v4 changed ordering.
    - `z.enum(["front","back"]).default("front")` — stable.

**Pre-parse size guard (new helper, bounds before parsing — the actual GHSA mitigation):**

Add a `preValidateSize(raw: unknown)` guard called *before* `submitInput.safeParse(raw)` in the `submitVerification` handler, rejecting early with the same generic "Some details were missing. Please retake the photos." message (no oracle for attackers):

```ts
// Bound the anonymous payload BEFORE zod allocates, closing the GHSA collection-exhaustion path.
// This is the real guard: zod parses all elements before .max()/length checks, so collection
// bounds must be enforced on the raw object before safeParse, not inside the schema.
function preValidateSize(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.documentImage === "string" && r.documentImage.length > 8_000_000) return false;
  if (typeof r.backImage === "string" && r.backImage.length > 8_000_000) return false;
  if (typeof r.selfieImage === "string" && r.selfieImage.length > 8_000_000) return false;
  if (r.consent && typeof r.consent === "object" && Object.keys(r.consent).length > 16) return false;
  const ch = (r.liveness as { challenges?: unknown[] } | undefined)?.challenges;
  if (Array.isArray(ch) && ch.length > 20) return false;
  return true;
}
```

The 8 MB per-image string cap mirrors `dataUrl.max(6_000_000)` (base64 inflation ~1.33×). These caps are defense-in-depth on top of the v4 fix; they bound the specific collection-exhaustion vector even if a future zod regression occurs.

**Error handling:** `preValidateSize` returns `false` → handler returns the generic invalid-input error (existing path). `safeParse` failure path is unchanged. Both are recoverable client errors (4xx-equivalent), logged server-side only.

**Fallback if the v4 migration proves too risky pre-launch:** keep `zod ^3.25.76` and rely on `preValidateSize` + the `.max(20)`/`.slice(0,10)` on the challenges array. This **reduces** the exhaustion vector (via the pre-parse guard, the real bound) but does not get the upstream patch, so it is a contingency, not the chosen path. The chosen path is the upgrade.

### M6 — vite + seroval

`npm audit --omit=dev` reports `vite 8.0.0–8.1.5` (high, dev-server/launch-editor scope — low prod exposure since the built bundle is served, not the Vite dev server) and `seroval 1.5.5–1.6.10` (moderate, runs in the prod server-function serialization path).

**Chosen approach — targeted bumps (not blanket `--force`):** `npm audit fix --force` can jump majors and break the `@lovable.dev/vite-tanstack-config` version coordination. Instead:

- `vite`: `8.1.5` → `^8.3.5` (patch within the same major; keeps the Lovable config compatible).
- `seroval`: pinned deterministically via the `package.json` `overrides` block. The existing block is `{ "rolldown": "1.2.1" }` — add `"seroval": ">=1.6.11"`:
  ```json
  "overrides": {
    "rolldown": "1.2.1",
    "seroval": ">=1.6.11"
  }
  ```
  Rationale: `@tanstack/react-core` is **transitive** (via `@tanstack/react-start`/`@tanstack/react-router`), so only `react-start` and `react-router` can be bumped directly, and a patch bump within the same minor may not widen TanStack's own `seroval` range enough to pull `>=1.6.11` — `npm ls seroval` could still show the vulnerable version and a "raise the trio" fix would silently no-op. The `overrides` entry forces the patched version deterministically regardless of TanStack's pin. After install, run `npm ls seroval` to confirm `>=1.6.11` is resolved, then re-test the server-function request path (forcing seroval could surface API incompatibilities with TanStack's serializer); if a break appears, pin to the lowest working `>=1.6.11` and escalate to the owner rather than dropping below the patched range.
- Re-run the full `npm run build` and exercise the request path after the bump — the audit explicitly warns vite/seroval bumps can be breaking.

### L1 — dev-only toolchain

`npm audit fix` (no `--force`) for devDependencies (`drizzle-kit`→esbuild, `eslint`/`typescript-eslint`→minimatch/eslint-utils). None ship to runtime (confirmed absent from `.output/public` in findings). Low priority; can be a separate pass. Do not let `--force` touch the runtime tree.

### Edge cases & invariants

- The never-auto-approve invariant (`score < 40 ? "Rejected" : "Pending"`) is untouched and must remain intact across the schema changes.
- All parameterised PostgREST calls remain unchanged (no SQL interpolation introduced).

### Testability

- Unit: `submitInput` parses a valid sample; `preValidateSize` rejects oversized `consent` (>16 keys), oversized `challenges` (>20), oversized image strings (>8 MB) before `safeParse`; `analyzeDocument` validator accepts/rejects correctly.
- Build: `npm run build` succeeds and emits the Cloudflare bundle.
- `npm audit --omit=dev` reports seroval and vite clear; `npm ls seroval` shows `>=1.6.11`.

---

## Batch 3 — High: Anonymous-submission abuse controls + IP hardening (H3, M1-partial)

`submitVerification` and `analyzeDocument` are anonymous (`createServerFn` with no auth middleware) and run with the service-role key to upload to the private `kyc-media` bucket and insert into `verifications`. Existing controls are per-instance rate limits and zod validation. The never-auto-approve guarantee makes this **not** an authz bypass, but it is an unauthenticated write/abuse path. H3 names **two** abuse vectors: (1) filling private storage with biometric images (the `submitVerification` write path), and (2) driving up AI-gateway cost ("every `analyzeDocument` call sends the image to the Lovable AI gateway"). The strong fix (shared per-IP limit) is Needs owner decision D7; this batch adds the owner-authorized application-level bound that does not require a new service.

### H3a — Global submission cap on the storage-fill vector (owner-authorized, no new service)

**File:** `src/lib/kyc.functions.ts` (`submitVerification` handler).

Add a global rolling-window cap right after the consent check and before storage/insert. This bounds the **storage-fill** vector:

```ts
const SUBMIT_CAP_PER_HOUR = 500; // tune to expected peak × headroom
const since = new Date(Date.now() - 60 * 60_000).toISOString();
const { count, error: capErr } = await supabaseAdmin
  .from("verifications")
  .select("id", { count: "exact", head: true })
  .gte("created_at", since);
if (!capErr && (count ?? 0) >= SUBMIT_CAP_PER_HOUR) {
  return { ok: false as const, error: "The verification service is busy. Please try again shortly." };
}
// if capErr, fail OPEN (below) — a cap outage must not take down verification
```

This uses the existing Supabase project (no new paid service). `SUPABASE_SERVICE_ROLE_KEY` is already imported here.

### H3b — The `analyzeDocument` AI-cost vector is NOT application-bounded here (residual, explicitly accepted)

`analyzeDocument` does **not** write a `verifications` row (it only calls the AI gateway and returns OCR fields), so there is no DB count to cap against the way H3a does. Any application-level global bound on `analyzeDocument` would require a shared counter store — which is exactly D7 (an infra/cost tradeoff the owner has not authorized). Therefore this batch **does not** bound `analyzeDocument` at the application level.

**Accepted residual (named, not inherited silently):** the `analyzeDocument` AI-cost / credit-exhaustion vector is bounded **only** by:
- the per-instance `enforceRateLimit("analyze", 20, 10*60_000)` limiter (`src/lib/kyc.functions.ts:65`), which M1 establishes is **bypassable across Cloudflare isolates** (per-instance `Map`), and
- the Lovable AI gateway's own `429`/`402` responses (the handler surfaces "Too many requests" only for that case, otherwise a generic "Document analysis is unavailable.").

So an attacker spamming `analyzeDocument` across isolates can still burn AI credits up to the gateway's quota. **Full per-IP / global coverage of this vector waits on D7** (shared store), which covers both `submitVerification` and `analyzeDocument` once built. Until D7 ships, the storage-fill vector (H3a) is application-bounded but the AI-cost vector is not. This is the honest state of the owner-authorized stopgap; it is not presented as closing all of H3.

**Keep the never-auto-approve guarantee** (`scoreVerification`: `status = score < 40 ? "Rejected" : "Pending"`). This is the actual safety gate; document it as a required invariant: *no code path may set `status` to `Approved` from the anonymous submission flow — only `review_verification()` (admin) may approve.*

### M1-partial — `clientIp()` hardening (close the spoofing vector on the production target)

**File:** `src/lib/rate-limit.server.ts` (`clientIp`).

On Cloudflare, `cf-connecting-ip` is authoritative and unspoofable; the current code falls through to `x-real-ip` then `x-forwarded-for`, which is client-spoofable off-Cloudflare. Make `cf-connecting-ip` the primary and only trusted source when present; only use `x-forwarded-for` as a best-effort fallback when `cf-connecting-ip` is absent (i.e., local/dev or a non-Cloudflare deploy):

```ts
export function clientIp(): string {
  const h = getRequest()?.headers;
  const cf = h?.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  // Best-effort fallback only when not behind Cloudflare (cf-connecting-ip is absent).
  const fwd = h?.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || "unknown";
}
```

Drop reliance on `x-real-ip`. On the production Cloudflare target `cf-connecting-ip` is always set, so the spoofable path is unreachable in prod. This closes the IP-spoofing half of M1.

### Edge cases

- The global cap could reject legitimate traffic during a genuine organic spike. Set `SUBMIT_CAP_PER_HOUR` generously (500 ≈ 8/min sustained) above expected volume; tune via the admin dashboard. The cap counts **all** verifications including `Rejected`, which is correct (all writes consume storage/AI).
- The count query adds one PostgREST round trip to the submit path (which already does several); acceptable. For scale, an index on `verifications(created_at)` would help but is **not** required for the minimal fix and is out of scope here.

### Error handling

- **Global cap query failure (`capErr`): fail OPEN** — proceed to the existing validation/storage path. Rationale: the cap is an abuse bound, not a safety gate; failing closed would make a Supabase outage block all verification. The never-auto-approve guarantee and zod validation are unaffected. `capErr` is logged server-side (`console.warn`), never returned to the client.
- `RateLimitError` (per-instance limiter) and the new generic cap message both map to the existing "service busy"/"too many requests" client error path.

### Validation / invariants

- `SUBMIT_CAP_PER_HOUR` is a named module constant. The count uses parameterised PostgREST `.gte()` (no interpolation).
- The anonymous endpoints stay anonymous (no `requireSupabaseAuth` middleware — applying it would break public submission). The auto-generated `requireSupabaseAuth` remains intentionally unused (see L4).

### Testability

- Unit (mocked `supabaseAdmin`): reject when `count >= CAP`; allow when `count < CAP`; **fail open** when count query errors.
- `clientIp`: returns `cf-connecting-ip` when present; falls back to first `x-forwarded-for` entry only when `cf-connecting-ip` absent.

### Needs owner decision (NOT designed here)

- **D7** Move the per-IP limiter off the in-memory `Map` to a shared store so multi-isolate limits hold. Recommended minimal option: a Supabase counter table `(ip, name, count, reset_at)` incremented via a `security definer` upsert — uses existing infra, no new paid service. Alternatives (Cloudflare Durable Objects / KV / Upstash) require a paid plan or a new service. This is the audit's recommended M1 fix and the stronger H3 fix (covers **both** `submitVerification` and `analyzeDocument`); it is owner-decision because the store choice is an infra/cost tradeoff. The per-instance limiter + global submit cap (this batch) is the owner-authorized stopgap; note it does not bound `analyzeDocument` (H3b).
- **Captcha / proof-of-work / per-IP storage quota** on anonymous submission (H3 "consider"). Captcha is explicitly an owner-decision tradeoff; per-IP storage quota is a product decision.

---

## Batch 4 — Medium: Enforce full CSP — session/CSP defense-in-depth (M3, M4, V2, V4)

There is no current XSS sink (no `dangerouslySetInnerHTML` with user content; the one usage is static CSS in `chart.tsx`), so this is defense-in-depth for a public biometric app: today the enforced CSP blocks clickjacking only, and the admin Supabase session token lives in `localStorage`. The minimal, no-restructure fix is to **enforce the full restrictive CSP** (M3), which is also the audit's stated "at minimum" mitigation for M4. The stronger M4 mitigation (cookie-based SSR auth) restructures the auto-generated auth flow and is Needs owner decision.

### M3 — Promote the full CSP from report-only to enforced, with a stricter canary

**File:** `src/server.ts` (`withSecurityHeaders`, `CSP_REPORT_ONLY`).

The full restrictive policy is currently sent only as `Content-Security-Policy-Report-Only`; the enforced `Content-Security-Policy` is just `FRAME_ANCESTORS`. Promote the full policy to enforced, but make the report-only canary **stricter** than the enforced policy on the `script-src` directive so it can actually detect inline scripts.

**Key insight the prior design missed:** a report-only policy that *allows* inline scripts (i.e., keeps `'unsafe-inline'` in `script-src`) emits **no** inline-script violation — so "wait for zero inline-script violations, then remove `'unsafe-inline'`" either waits forever for a signal that cannot arrive, or removes `'unsafe-inline'` blind. To detect inline scripts, the canary must be **stricter** than the enforced policy on exactly this directive: the canary drops `'unsafe-inline'` from `script-src` while the enforced policy keeps it. Then inline scripts show up as report-only violations (which do not block rendering), and the decision to drop `'unsafe-inline'` from the enforced policy is evidence-based.

**First deploy — enforced keeps `'unsafe-inline'`, canary drops it:**

```ts
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co",
  "media-src 'self' blob:",
  "connect-src 'self' blob: data: https://*.supabase.co https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  // Enforced: full policy WITH 'unsafe-inline' in script-src (cannot break rendering on first deploy).
  headers.set("Content-Security-Policy", [CSP_REPORT_ONLY, FRAME_ANCESTORS].join("; "));
  // Canary: STRICTER than enforced on script-src — drops 'unsafe-inline' so inline scripts
  // surface as report-only violations (a policy that allows inline emits none).
  // .replace hits only the FIRST occurrence (script-src), leaving style-src 'unsafe-inline' intact.
  headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY.replace("'unsafe-inline'", ""));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
```

`style-src 'unsafe-inline'` is intentionally left in both policies for now: style-based script injection is far lower risk and is a separate follow-up. The canary's stricter directive is `script-src` only (the inline-script XSS vector). The `wasm-unsafe-eval` + `blob:` + `cdn.jsdelivr.net` entries are required for face-api/tesseract and stay in both.

**Decision procedure (evidence-based, not blind):**

1. Deploy with the canary above and run the **full portal flow** (document OCR → face → liveness → submit → admin review) plus the `/analytics` and `/auth` pages, watching the browser console for `Content-Security-Policy-Report-Only` violations. The report-only canary surfaces *missing-source* violations (a source the app needs but the policy omits) AND, because it dropped `'unsafe-inline'` from `script-src`, *inline-script* violations.
2. If the report-only console shows **no inline-script violations** → it is safe to drop `'unsafe-inline'` from `CSP_REPORT_ONLY` (and thus the enforced policy). Make that the second commit. **At that point M4's "enforce a strict CSP so XSS cannot read the token" mitigation is in effect.**
3. If the report-only console shows **inline-script violations** → the app does use inline scripts; do **not** remove `'unsafe-inline'`. Either (a) add per-request nonces/hashes (the non-minimal path, see Needs owner decision), or (b) keep `'unsafe-inline'` in `script-src` and **document that M4's strict-CSP mitigation is NOT yet in effect** (the admin `localStorage` token remains reachable by any inline script; the other M4 mitigations — gating on no XSS sink + the future cookie-auth decision — are what hold in the meantime).
4. Fix any *missing-source* violations the canary also surfaces (e.g., a model CDN) by adding the source to `CSP_REPORT_ONLY` (additive, recoverable) before/while doing step 2.

**M4 status must be stated explicitly per deploy:** until step 2 actually completes with zero inline-script violations, M4's strict-CSP mitigation is **unmet**. The design does not claim M4 is mitigated by the first deploy; only by the second commit (if step 2 succeeds) or not at all (if step 3 keeps `'unsafe-inline'`).

The prior design's claim that the report-only policy "already lists the sources the app needs" / "was tuned during the report-only phase, so enforcing it is low-risk" was **not established by the repo** (the `src/server.ts` comment says "tighten and enforce after checking the console," implying the console review may not have been completed). The canary in step 1 is what actually verifies missing-source coverage at runtime; the implementer must run the full flow under report-only before relying on enforcement.

### V2 (runtime verification, folds here)

After deploy, confirm the live site returns: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and the now-full enforced `Content-Security-Policy` (not just frame-ancestors). Confirm no platform/CDN config injects a wildcard or reflective `Access-Control-Allow-Origin` with credentials (no custom CORS was found in code; server fns are same-origin RPC).

### V4 (runtime verification, folds here)

Confirm the deploy does not enable `sourcemap: true` and the CDN does not serve `.map` from the server bundle. The local build emitted none in `.output/public`; verify the deploy config matches.

### Edge cases

- Enforcing CSP could break a flow if a source was missed in the report-only phase (e.g., a model CDN). The kept report-only canary surfaces this in the console before it bites users (report-only does not block). Fix is to add the missing source to `CSP_REPORT_ONLY` (and thus the enforced policy) — a config change, fully recoverable.
- `frame-ancestors` stays enforced (clickjacking protection preserved).

### Error handling

A too-tight CSP degrades a page (blocked model/script) but is not fatal; the user sees a broken capture flow and the console shows the blocked URL. Remediation is additive (widen the directive). No data loss.

### Testability

- Integration: assert the response `Content-Security-Policy` header equals the full policy (not just frame-ancestors), and that `Content-Security-Policy-Report-Only` is the stricter canary (no `'unsafe-inline'` in its `script-src`).
- Manual: run the full portal flow under the enforced CSP + stricter canary and check the console; the decision to drop `'unsafe-inline'` from enforced is gated on the canary showing zero inline-script violations.

### Needs owner decision (NOT designed here)

- **M4 cookie-based SSR auth** (HttpOnly, Secure, SameSite=Lax) instead of `localStorage`. This is the audit's "prefer" mitigation for the admin token, but it restructures the auto-generated auth flow (`client.ts`, `previewAuthStorage.ts`, `auth-attacher.ts` carry "Do not edit directly" headers) and changes the auth model from client-persisted bearer tokens to SSR cookies. Flagged, not designed. Until it ships, M4's only code mitigation is the strict CSP from this batch (in effect only once step 2 completes) plus the absence of a current XSS sink.
- **Further `'unsafe-inline'` removal via nonces** — fully removing inline-script risk requires per-request nonces injected into SSR HTML and the CSP header, which touches the render pipeline (non-minimal). Needed only if step 3 shows inline scripts.

---

## Batch 5 — Low: Hygiene (L2, L3, L4)

### L2 — Signed media URLs

Keep the 600 s TTL (`admin.tsx` `useSignedUrl` → `createSignedUrl(path, 600)`). Action: confirm signed URLs are never written to logs (grep for `console.`/logger calls near `createSignedUrl` results — none found in reading). Add a short comment at the call site noting "do not log the returned URL." No behavior change; acceptable per the audit.

### L3 — `case_code` sequential (optional)

`case_code` defaults to `('VA-' || nextval('public.case_seq'))` (`0000_kyc_core.sql`). It is admin-RLS-gated and the submit response returns only the submitter's own code, so there is no direct data leak — only ordering inference. **Optional** minimal change via a new migration `0004`. `gen_random_bytes()` requires the `pgcrypto` extension; migration `0000` uses the built-in `gen_random_uuid()` but never creates `pgcrypto`, so the extension is not guaranteed by the repo. Prefix the migration so it runs as written:

```sql
-- 0004_random_case_code.sql
create extension if not exists pgcrypto;

alter table public.verifications alter column case_code
  set default ('VA-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8)));
```

Existing rows keep their sequential codes; new rows get random 8-hex suffixes. Drop `case_seq` if no longer referenced. Low value; implement only if the owner wants to hide volume ordering.

### L4 — Hygiene

- **`.inputValidator()` → `.validator()`**: done in Batch 2 with the zod/TanStack work.
- **Unused `requireSupabaseAuth`** (`src/integrations/supabase/auth-middleware.ts`): it is auto-generated and intentionally not applied to the anonymous endpoints (applying it would break public submission). Recommended action: leave it in place as a library helper (removing risks the Supabase generator re-adding it); document that the anonymous endpoints are intentionally anonymous and that any future authenticated server fn should apply it. No code change required.
- **1.3 MB client chunk**: low-priority perf. The heavy libs (face-api, tesseract) are already lazy-loaded via dynamic import. The chunk is the UI kit + recharts + motion. Minimal optional improvement: route-level `React.lazy` for `/admin` and `/analytics`. Not security-critical; not required for launch.

---

## M2 — No code change (documented)

Client-side liveness/face-match is spoofable (`src/lib/face.ts`, descriptors/similarity/`samePerson`/challenge log are client-asserted and sent to the server). The mitigation is sound and already implemented: `scoreVerification` **never auto-approves** (`status` is only `Pending`/`Rejected`; a human reviews). No code change required for the current assurance model ("human review of client-captured evidence"). Document this as the product's assurance model. Moving liveness/face-match to the server or a specialist vendor for genuine assurance is **Needs owner decision D8**.

---

## Needs owner decision (product/security tradeoffs NOT pre-authorized)

These are flagged, not designed in. Each shows the tradeoff and a recommended direction.

- **D1 — Data retention policy.** Decide the retention period for raw ID/selfie images and face descriptors, then implement an automated purge (a scheduled server fn using the existing `authenticateCronRequest` + `LOVABLE_CRON_SECRET`, deleting storage objects and updating/scrubbing the DB row). *Tradeoff: changes data-handling behavior.* Until decided, Batch 1 removes the false "30-day auto-purge" claim. **Recommended:** set a written retention period and build the purge job before high-volume use.
- **D2 — Right to erasure.** Build a deletion / data-subject-request endpoint (remove DB row + storage objects + descriptors + audit references), or keep the "request deletion" claim removed (done in Batch 1). *Tradeoff: new feature + policy.* **Recommended:** implement a minimal admin-triggered erasure endpoint before launch.
- **D3 — Biometric template storage model.** Keep raw 128-float descriptors (add encryption-at-rest + strict access control + retention) or stop storing them (dedupe on `vector_hash` only). *Tradeoff: changes the dedup/storage model; "irreversible vector hashes" can never be true for matchable descriptors.* **Recommended:** decide before launch; if keeping descriptors, add at-rest encryption and access control and never reintroduce the "irreversible" claim.
- **D5 — Third-party AI processor.** The consent disclosure (concretely naming OpenAI via the Lovable AI gateway) is done in Batch 1. Remaining: put a data-processing agreement in place with the Lovable AI gateway / OpenAI sub-processor, or disable the AI OCR path and run on-device Tesseract only (`src/lib/ocr-fallback.ts` already exists). *Tradeoff: DPA is a business contract; dropping AI changes OCR accuracy.*
- **D6 — Admin account hardening.** Enable MFA on the admin Supabase account and (optionally) a captcha on admin sign-in (`src/routes/auth.tsx`); ensure the single admin uses a strong unique password. *Tradeoff: MFA/captcha are product/security choices (captcha is an owner-decision tradeoff per the brief).* The admin account is the sole gate on all biometric data. **Recommended:** enable Supabase MFA before launch; captcha optional.
- **D7 — Rate-limiting shared store.** Move the per-IP limiter off the in-memory `Map` so multi-isolate limits hold. Covers **both** `submitVerification` (storage-fill) and `analyzeDocument` (AI-cost) vectors named in H3. *Tradeoff: paid service / infra choice.* **Recommended:** Supabase counter table via a `security definer` upsert (existing infra, no new paid service); alternatives are Cloudflare Durable Objects / KV / Upstash. Batch 3 is the owner-authorized stopgap; note it bounds only the storage-fill vector (H3a), not the AI-cost vector (H3b residual).
- **D8 — Server-side liveness / anti-spoof.** If genuine liveness assurance (not just assisted human review) is required, move liveness/face-match to the server or a specialist vendor. *Tradeoff: significant architecture change / vendor cost.* **Recommended:** for now, document the assurance model as "human review of client-captured evidence" (no code change); revisit if the threat model requires automated spoof rejection.
- **D9 — Publish a privacy policy (new).** A public biometric KYC product needs a privacy notice (GDPR Art. 13/14 transparency; BIPA written-policy/notice obligations) covering the AI sub-processor (OpenAI via the Lovable AI gateway), data retention, and data-subject rights. No `/privacy` route exists today; Batch 1 deliberately does not reference one. *Tradeoff: legal/content work; not a code change the owner pre-authorized.* **Recommended:** this is a launch blocker for a public biometric KYC app — publish before high-volume use. Until it ships, consent states the AI-sub-processor disclosure inline (Batch 1) and makes no "privacy policy" reference.

---

## Assumptions

- The Supabase project in use is the one `0000`–`0003` were written for; if a new project was provisioned for launch, re-apply the migrations there in order (Batch 0 verifies).
- `LOVABLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` exist only in platform env (Lovable Cloud / Cloudflare / Supabase dashboard) — the audit confirmed they are absent from the repo and the built client bundle; this design does not require rotation (no committed secrets).
- The deploy target remains Cloudflare Workers (`cf-connecting-ip` available), so the M1 fallback path is unreachable in prod.
- The repo is Lovable-connected: changes must be committed normally to the working branch (no force-push / rebase of pushed history) so the branch stays in a working state and syncs to Lovable.
- "Fix all the issues" authorizes the minimal, non-behavior-changing code/config/SQL fixes in Batches 0–5. Product/cost/captcha/data-retention/privacy-policy tradeoffs (D1–D9) are explicitly excluded and flagged.

## What will need runtime verification during implementation

- **V1** migration `0003` applied (Batch 0 SQL checks) — launch blocker.
- **V3** Supabase project hardening (sign-ups off, RLS everywhere, JWT secret, auth brute-force) — launch blocker.
- **V5 (new)** Supabase Database + Storage encryption-at-rest is enabled for this project (gates the at-rest wording in the consent card + bullet 1, Batch 1). If not enabled, soften the card/bullet to drop "at rest."
- **V2** deployed response headers match `src/server.ts` after the CSP change (Batch 4); no wildcard/reflective ACAO with credentials.
- **V4** no `.map` source maps served by the deploy config (Batch 4).
- After Batch 2: `npm audit --omit=dev` clean for `seroval`/`vite`; `npm ls seroval` shows `>=1.6.11`; full `npm run build` succeeds; server-fn parse paths accept valid input and reject oversized collections (via `preValidateSize`).
- After Batch 4: full portal flow under enforced CSP + stricter canary shows no blocking violations; **`'unsafe-inline'` may be dropped from `script-src` (enforced) only if the stricter report-only canary shows zero inline-script violations**. Until that step completes, M4's strict-CSP mitigation is NOT in effect — state this per deploy.
- After Batch 1: no fabricated retention/encryption/deletion/audit claims remain on `/`; the "Zero-Trust Privacy Guarantee" card and bullet 1 agree on the at-rest wording (gated on V5); `auditLog` is no longer exported from `kyc-data.ts`.

---

## Responses to design-review findings

The review returned `CHANGES_REQUESTED` with 4 MEDIUM and 6 NIT findings. Each is addressed below; none were backlogged or ignored.

### MEDIUM findings — all addressed

**MEDIUM 1 (review) — CSP `'unsafe-inline'` removal was self-contradictory and never produced its signal; M4 unmet.**
*Addressed in Batch 4.* The canary is now **stricter** than the enforced policy on `script-src`: enforced keeps `'unsafe-inline'`, the report-only canary drops it (`CSP_REPORT_ONLY.replace("'unsafe-inline'", "")`, which hits only the first occurrence — `script-src` — leaving `style-src 'unsafe-inline'` intact). A policy that disallows inline scripts *does* emit inline-script violations, so "drop `'unsafe-inline'` from enforced only if the canary shows zero inline-script violations" is now a real, evidence-based gate rather than a condition that is vacuously true. The design now explicitly states that **M4's strict-CSP mitigation is unmet until that second commit completes**, and documents the keep-`'unsafe-inline'` + "M4 not in effect" fallback if the canary shows inline scripts. The unverified assumption that the report-only policy "was already tuned" is removed; the implementer is told to run the full flow under the canary to verify missing-source coverage at runtime.

**MEDIUM 2 (review) — H3 fix bounded only `submitVerification`; `analyzeDocument` AI-cost vector unbounded and unacknowledged.**
*Addressed in Batch 3.* Split into H3a (global submit cap, bounds the storage-fill vector) and H3b (the `analyzeDocument` AI-cost vector is explicitly **not** application-bounded here). The design names the residual: `analyzeDocument` is bounded only by the per-instance limiter (bypassable per M1) and the gateway's 429/402; full coverage waits on D7. The chosen path is "explicitly accept and state the residual" rather than add a bound, because `analyzeDocument` writes no DB row (so there is no DB count to cap against the way H3a does) and any application-level global bound requires a shared store — which is D7, an infra/cost tradeoff the owner has not authorized. D7's description is updated to note it covers both vectors.

**MEDIUM 3 (review) — Mock audit-log fix rested on a wrong rendering premise (dead code) and edited only one of two fabricated entries.**
*Addressed in Batch 1.* Verified independently (grep confirms `auditLog` is exported in `kyc-data.ts` but imported nowhere in `src/**`; `analytics.tsx` imports only `attackResilience` and `latencyBreakdown`). The wrong "renders on /analytics" rationale is removed. The fix is now to **delete the entire dead `auditLog` export** rather than hand-edit one entry — this removes both fabricated entries at once (`"Biometric template hashed and encrypted (AES-256-GCM)"` and `"Auto-purge cycle removed 412 expired records (30-day policy)"`), which reinforced the exact claims removed from consent. No behavior change (nothing imports it).

**MEDIUM 4 (review) — M5 disclosure referenced a privacy policy that does not exist.**
*Addressed in Batch 1.* The new M5 bullet no longer says "See our privacy policy for details" — the AI-sub-processor disclosure is stated inline ("Document images are processed by a third-party cloud AI service (OpenAI via our AI gateway) for OCR analysis."). Publishing a privacy policy is added as a new Needs-owner-decision item **D9** (and flagged as a launch blocker for a public biometric KYC app, since a privacy notice is itself a GDPR Art. 13/14 / BIPA requirement). The design no longer references a document that does not exist.

### NIT findings — all addressed

**NIT 5 — zod challenges change silently dropped the slice-to-10 and misstated how `.max()` bounds.**
*Addressed in Batch 2.* The schema is now `z.array(...).max(20).catch([]).transform((a) => a.slice(0, 10))`, preserving the existing 10-element storage cap. The rationale text is corrected: `preValidateSize` is explicitly named as the **real** guard against the GHSA allocation-exhaustion vector (zod parses all elements before evaluating `.max()`, so `.max(20)` does not prevent the element-by-element allocation the advisory describes and is redundant defense-in-depth); `.slice(0, 10)` is retained only to preserve the existing storage behavior, with the behavior change (11–20 valid challenges accepted-then-trimmed) called out as harmless under the never-auto-approve invariant.

**NIT 6 — L3 migration used `gen_random_bytes()` without declaring `pgcrypto`.**
*Addressed in Batch 5.* The proposed `0004` migration is prefixed with `create extension if not exists pgcrypto;` so it runs as written even where the extension is not pre-enabled.

**NIT 7 — seroval fix via "raising the TanStack trio" may not move seroval.**
*Addressed in Batch 2 / stack.* The fix is now deterministic: add `"seroval": ">=1.6.11"` to the existing `package.json` `overrides` block (alongside `"rolldown": "1.2.1"`). The design notes `@tanstack/react-core` is transitive and a patch bump may not widen TanStack's seroval range, so the override is the reliable lever; after install, `npm ls seroval` confirms the patched version, and the request path is re-tested for serializer incompatibilities. "Raise the trio" is no longer the only lever.

**NIT 8 — Batch 1 did not reconcile the "Zero-Trust Privacy Guarantee" card with the at-rest claim removed from the bullet.**
*Addressed in Batch 1.* Added an explicit "Reconcile the card" subsection with a decision: keep the card's "at rest" wording and make bullet 1 consistent by reintroducing "stored encrypted at rest" — but only as platform-managed Supabase encryption (a verified control), gated on new verification item **V5**. If V5 finds encryption-at-rest is not enabled, both the card and bullet are softened to drop "at rest." The at-rest claim is now a verified platform control rather than a fabricated app-level AES-256-GCM guarantee, and card and bullet agree.

**NIT 9 — V1 `has_role` query omitted the `public` schema filter.**
*Addressed in Batch 0.* The `has_role` check is now schema-qualified: `select prosrc from pg_proc p join pg_namespace n on p.pronamespace=n.oid where proname='has_role' and n.nspname='public';`, consistent with the `review_verification` check.

**NIT 10 — M5 consent detail named the sub-processor only generically.**
*Addressed in Batch 1.* The `doc` consent detail now names the recipient concretely: "a cloud AI sub-processor (OpenAI via our AI gateway)," and the new policy bullet names "a third-party cloud AI service (OpenAI via our AI gateway)." Tied to D9 (the to-be-published privacy policy) for completeness.
