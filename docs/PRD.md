# E-Meterai Stamping API — Production Requirements & Technical Design

**Status:** Draft for implementation
**Audience:** Code agent / engineering team
**Source reference:** `peruri-emeterai-stamping-integration.md` (existing single-tenant AmteMeterai implementation)

---

## 1. Product Summary

A multi-tenant API product that lets any ERP electronically stamp invoice PDFs with a legally valid Peruri e-Meterai, without each client needing to understand Peruri's integration contract, PDF anchor positioning, or credential handling.

Core value proposition: ERP uploads a sample invoice once, defines where the stamp goes (via UI or natural-language instruction), and from then on calls one `/stamp` endpoint per invoice.

### 1.1 Goals

- Simple onboarding: upload sample → define anchor → get a template ID.
- One stable `/stamp` API regardless of underlying Peruri environment (staging/production).
- Deterministic, auditable stamping at runtime (no LLM in the hot path).
- Safe multi-tenant credential handling for production Peruri accounts.
- Deployable primarily on Cloudflare, with a dedicated compute tier for the parts that cannot run on Workers.

### 1.2 Non-goals (v1)

- Building our own e-Meterai issuance — we integrate with Peruri, we don't replace it.
- Supporting non-PDF stamp targets (images-as-invoices) — deferred, noted as future work.
- Multi-language OCR beyond Latin-script invoices — deferred.

---

## 2. Architecture Overview

```
                         ┌─────────────────────────────────────────┐
                         │              Cloudflare Workers           │
                         │  (API gateway, auth, tenant/template CRUD)│
                         └───────────────┬───────────────────────────┘
                                          │
                 ┌────────────────────────┼─────────────────────────┐
                 ▼                        ▼                         ▼
              D1 (metadata:         R2 (documents:           Durable Objects
          tenants, templates,     printouts, QR, stamped)   (per-tenant staging
           stamp jobs, keys)                                 quota + JWT cache)
                 │
                 ▼
             Queues (stamp job dispatch)
                 │
                 ▼
   ┌─────────────────────────────────────────────────────────┐
   │              Compute Tier (Fly.io / Railway / CF Containers) │
   │  - Anchor resolution service (PDF text-layer extraction,   │
   │    OCR fallback)                                            │
   │  - Peruri signadapter (Docker, file-based I/O, single-slot) │
   │  - Shared volume: UNSIGNED / STAMP / SIGNED                 │
   └───────────────────────────┬───────────────────────────────┘
                                │
                                ▼
                     Peruri Cloud APIs (per environment)
                     • POST /api/users/login        (JWT auth)
                     • POST /chanel/stampv2         (SN + QR image)
```

**Why not pure Workers:** Peruri's actual signing step (`docSigningZ`) is a Docker container (`signadapter`) that communicates via a shared filesystem volume, not stateless HTTP. Workers have no persistent filesystem and cannot run Docker containers, so a separate compute tier is required to host the adapter. Workers remain the public API surface, auth layer, and orchestrator; the compute tier is an internal service Workers dispatch jobs to via Queues.

---

## 3. Tenant & Environment Model

Each tenant (ERP client) operates in one of two Peruri environments, selectable **per request**, not just per tenant:

| | Staging | Production |
|---|---|---|
| Credentials | Shared platform account (staging) | Tenant's own Peruri username/password + NPWP identity |
| Quota | Centrally topped up by us, **rate-limited per tenant** | Bounded by tenant's own Peruri balance |
| Setup required | None — works immediately on signup | Tenant fills in credentials in Settings, validated live against Peruri login |
| JWT caching | Single shared token (platform-wide) | Per-tenant token, keyed by `tenant_id` |

### 3.1 Data model

```
Tenant
  id
  name
  api_key_hash
  api_secret_hash
  status: active | suspended
  production_enabled: bool
  peruri_identity: { nama_dipungut, no_identitas (NPWP) }   -- production only
  peruri_credentials_encrypted: bytes                        -- production only, AES-GCM, key from Workers Secret
  staging_daily_limit: int (default 20, admin-overridable)
  created_at

Template
  id
  tenant_id
  name
  version: int
  anchors: [ { keyword, dx_pt, dy_pt } ]   -- ordered, first match wins
  box: { width_pt, height_pt }
  default_position: { x, y, page }          -- fallback if no anchor found
  created_at

StampJob
  id
  tenant_id
  template_id
  stamp_target: staging | production
  status: pending_anchor | pending_sn | sn_issued | signing | signed | failed
  serial_number: string | null
  qr_storage_key: string | null
  unsigned_storage_key
  signed_storage_key: string | null
  error: { stage, message } | null
  created_at, updated_at
```

### 3.2 Credential handling requirements

- Production credentials are never stored in plaintext. Encrypt with AES-GCM using a key held in a Workers Secret, not in D1.
- On save, validate credentials with a live call to Peruri's production login endpoint before persisting; return a clear error on failure rather than storing unverified credentials.
- Provide a credential rotation flow in Settings (update username/password without a support ticket).
- Log Peruri auth failures as a distinct error class from anchor/template failures, so support can tell "bad credentials" from "bad template" at a glance.

---

## 4. Anchor / Template Resolution

### 4.1 Method

Primary method: **PDF text-layer extraction** (not OCR) — read text objects and their bounding boxes directly from the PDF (equivalent to what PdfPig does in the reference implementation). This is deterministic and has no recognition error.

Fallback: OCR (e.g. Tesseract/PaddleOCR) for scanned/flattened PDFs with no extractable text layer. Flag jobs that fall back to OCR so accuracy can be monitored separately.

### 4.2 Template creation flow

1. Tenant uploads a sample invoice (base64) via `/templates`.
2. Backend extracts all text + coordinates and returns candidate anchors.
3. Tenant specifies desired anchor + offset — either through a UI (click a position) or a natural-language instruction (e.g. "5cm right, 2cm below 'Total Amount'"), parsed into `{ keyword, dx_cm, dy_cm }` and converted to points (1cm = 28.35pt) at save time. Regex/rule-based parsing should handle the majority of phrasings; an LLM call may be used only as a fallback parser for unusual phrasing — never as the source of truth for the final coordinates.
4. Template is persisted with an ordered anchor list (supports fallback keywords, e.g. "Notes" → "Remarks", mirroring the reference implementation) and a `default_position` used if no anchor resolves.
5. Response includes `template_id` and `version`.

### 4.3 Runtime resolution

For each `/stamp` call:

1. Load the specified template (or latest version if unspecified).
2. Run text-layer extraction (or OCR fallback) against the submitted document.
3. Walk the anchor list in order; first match wins.
4. If no anchor matches, use `default_position` and flag the job with a low-confidence warning rather than failing outright — this must not silently block invoicing, but must be visible for review (e.g. surfaced in job status / webhook payload).
5. Compute absolute stamp box from anchor position + offset + fixed box size.

**Requirement:** anchor resolution must complete, and be validated as either "matched" or "used default with warning," *before* any Peruri quota is spent (see §5).

---

## 5. Staging Quota & Rate Limiting

Staging Peruri account is shared across all tenants, so per-tenant limiting is required to prevent one tenant exhausting shared quota.

### 5.1 Rules

- Flat daily cap per tenant (default 20/day), reset at UTC midnight (or a configured tenant timezone if needed later).
- Enforced atomically via a per-tenant **Durable Object** (avoids race conditions from concurrent requests reading stale counts).
- **Quota is only deducted at the moment a real Peruri `stampv2` call succeeds and returns a Serial Number + QR image** — not on request receipt, not on anchor resolution failure, not on signing failure/retry.
- Production stamping is not subject to this platform-level limiter (bounded only by the tenant's own Peruri account balance).
- Admins can override `staging_daily_limit` per tenant without a code deploy.

### 5.2 API behavior

- Exceeding the limit returns `429` with a `retry_after` and the UTC reset time.
- Every staging response includes remaining quota, either in the JSON body or an `X-Staging-Quota-Remaining` header.

### 5.3 Durable Object sketch

```javascript
async checkAndIncrementStagingQuota(tenantId) {
  const today = new Date().toISOString().slice(0, 10);
  let state = (await this.state.storage.get("staging")) ?? { date: today, count: 0 };
  if (state.date !== today) state = { date: today, count: 0 };
  if (state.count >= this.dailyLimit) {
    return { allowed: false, remaining: 0, reset_at: nextUtcMidnight() };
  }
  state.count++;
  await this.state.storage.put("staging", state);
  return { allowed: true, remaining: this.dailyLimit - state.count };
}
```

---

## 6. Stamp Job State Machine

No SN expiry is assumed (per Peruri behavior confirmed for this integration) — an issued SN + QR remains valid for signing indefinitely, so retries of the signing step never require re-spending quota.

```
pending_anchor
     │ (anchor resolved or default used)
     ▼
pending_sn
     │ (stampv2 call — THIS is where staging quota is deducted)
     ▼
sn_issued  ──────────────► [retry loop: signing can be retried freely
     │                      from here without touching Peruri again]
     │ (docSigningZ via signadapter)
     ▼
signing
     │ (signed PDF read back from shared volume, with retry-on-not-yet-flushed,
     │  mirroring reference implementation: up to 10 retries, 1s apart)
     ▼
signed  → upload to R2 → job complete → webhook / response
```

**Failure handling:**

- Failures at `pending_anchor` cost nothing and are freely retryable (fix template, re-submit).
- Failures at `pending_sn` (Peruri API error, auth error) cost nothing — quota is only spent on success.
- Failures at `signing` / `sn_issued` are retried against the *same* SN + QR — never re-call `stampv2` for a job that already has a serial number.
- Jobs stuck at `sn_issued` beyond a threshold (e.g. 2 minutes) should raise an internal alert — this is the earliest signal that the compute tier (signadapter) is unhealthy, since there's no expiry pressure forcing failure on its own.

---

## 7. API Surface (v1)

All endpoints authenticated via API key + secret (HMAC-signed request) issued per tenant.

### `POST /templates`
Upload a sample document, get back extracted anchor candidates.

### `PUT /templates/{id}`
Save/update anchor config (keyword list, offsets, box size, default position). Creates a new version.

### `POST /stamp`
```json
{
  "template_id": "tmpl_123",
  "stamp_target": "staging",
  "document_base64": "...",
  "document_metadata": {
    "invoice_number": "INV-0001",
    "value": 0,
    "identity_type": "NPWP",
    "identity_number": "...",
    "document_date": "2026-08-14"
  }
}
```
Sync response for single documents; for batch/large documents, return `job_id` + poll/webhook pattern (mirrors Peruri's own sync/async split).

```json
{
  "job_id": "job_456",
  "status": "signed",
  "serial_number": "...",
  "stamped_document_url": "https://.../download?key=...",
  "anchor_match": { "matched": true, "keyword": "Notes", "confidence": "high" }
}
```

### `GET /stamp/{job_id}`
Poll job status.

### `GET /tenants/me/quota`
Returns current staging quota usage/remaining.

### `PUT /tenants/me/settings`
Set production Peruri credentials + identity; triggers live validation against Peruri login before saving.

---

## 8. Storage Layout (R2)

```
tenants/{tenant_id}/templates/{template_id}/sample.pdf
tenants/{tenant_id}/jobs/{job_id}/unsigned.pdf
tenants/{tenant_id}/jobs/{job_id}/qr.png
tenants/{tenant_id}/jobs/{job_id}/signed.pdf
```

---

## 9. Security Requirements

- All tenant API calls authenticated via API key + HMAC signature (or bearer key over TLS at minimum for v1, HMAC as a fast-follow).
- Sandbox (staging) and production are logically separated per request, never inferred implicitly.
- Peruri production credentials encrypted at rest, decrypted only transiently at call time.
- No document content logged; only metadata (job id, tenant id, status, timing) in application logs.
- Rate limiting on the API layer itself (separate from staging quota) to prevent abuse of the `/templates` and `/stamp` endpoints generally.

---

## 10. Open Items for Engineering to Confirm Before Build

1. Peruri SN expiry — confirmed no expiry, but worth re-verifying against current Peruri docs/support before relying on it long-term.
2. Signadapter concurrency — currently single-slot per instance; confirm whether Peruri supports multiple concurrent adapter instances/licenses for scaling production throughput.
3. Compute tier hosting choice for the signadapter (Cloudflare Containers vs Fly.io/Railway vs self-managed VM) — depends on current Cloudflare Containers maturity/pricing at build time; verify before committing.
4. Whether `stamp_target` production calls should still be blocked by any platform-level abuse limiter (distinct from staging quota), even though they're bounded by the tenant's own Peruri balance.
5. Async job / webhook contract details (retry policy, signature verification on webhook payloads) — not fully specified here, needs a decision pass.

---

## 11. Summary of Key Design Decisions (for quick reference)

| Decision | Rationale |
|---|---|
| No LLM in the stamping hot path | Determinism, cost, latency — LLM only assists parsing natural-language offsets at template-setup time |
| Text-layer extraction primary, OCR fallback | Higher accuracy on native PDFs; OCR only where no text layer exists |
| `stamp_target` is per-request, not per-tenant | Lets production tenants keep testing new templates against staging |
| Quota deducted only on successful `stampv2` | Matches actual Peruri cost model; anchor/auth failures are free retries |
| Per-tenant Durable Object for staging quota | Atomic increment avoids race conditions vs. plain D1 reads |
| Compute tier separate from Workers | Peruri's signadapter requires Docker + shared filesystem, incompatible with Workers runtime |
| Per-tenant JWT cache in production | Reference implementation used a single global token; production multi-tenancy requires keying by tenant |

---

## 12. Design System & UI Reference

This product is a compliance-adjacent admin console, not a marketing site — the two people who'll actually use it are (a) a developer wiring up API keys and templates once, and (b) an ops/finance person checking on stamped invoices regularly. Design for repeat, functional use: legible density, fast scanning, nothing that gets in the way of someone doing this at 9am with a coffee.

Avoid the generic "AI-generated SaaS" defaults: no cream-background-plus-terracotta-accent, no near-black-plus-neon-green, no broadsheet-hairline-newspaper layout. This product's own subject material — official stamps, serial numbers, security paper, registries — gives it a more specific identity than any of those defaults.

### 12.1 Design concept

**Direction:** "Registry desk," not "startup landing page." The visual language borrows from official document infrastructure — ink stamps, security-paper micro-patterns, ledger tables, serial numbers — without tipping into pastiche or literally imitating any government emblem.

**Signature element:** A circular seal-impression motif used specifically for *completed* stamp jobs — a small circular badge, very slightly rotated (as a real stamp would land imperfectly), showing a checkmark and the job's serial number in mono type. This is the one place the product gets to look tactile; everywhere else stays quiet and functional.

### 12.2 Color

| Token | Hex | Use |
|---|---|---|
| `ink-navy` | `#1C2541` | Primary brand color, headers, primary buttons, active nav state |
| `indigo` | `#3A4A7A` | Links, secondary actions, focus rings |
| `seal-brass` | `#A87C3D` | Sparingly — the seal/signature motif, success accents, highlighted serial numbers. Not a background color. |
| `paper` | `#F6F6F3` | App background — a cool, slightly grey paper tone, deliberately not warm cream |
| `paper-raised` | `#FFFFFF` | Cards, panels, table rows on top of `paper` |
| `ink-grey` | `#565C68` | Secondary/body text |
| `ink-faint` | `#9AA0AC` | Placeholder text, disabled states, table dividers |
| `verified-green` | `#2F6F4E` | Success states (stamped, verified) — muted, not bright |
| `alert-rust` | `#B23A2E` | Errors only — reserved so it stays meaningful |
| `pending-amber` | `#B8862E` | In-progress / pending states (distinct from brass and rust) |

Rule: `seal-brass` and `pending-amber` are close in temperature on purpose — brass means "done and verified," amber means "in motion." Never use both in the same status badge to avoid confusion; keep status colors to one per state (see §12.6).

### 12.3 Typography

| Role | Typeface | Notes |
|---|---|---|
| Display (page titles, section headers) | **Fraunces** (serif, restrained weights only — 400/500) | Used only for page-level headings, not body copy or UI labels. Gives the "official document" character without looking decorative. |
| Body / UI | **IBM Plex Sans** | All interface text, labels, buttons, table content. Institutional but not cold. |
| Mono / data | **IBM Plex Mono** | API keys, template IDs, job IDs, serial numbers, JSON payloads, timestamps. Any value the user might copy-paste gets mono treatment — it signals "this is a precise, copyable value." |

Type scale: keep it restrained — 3 display sizes (32/24/18), 2 body sizes (15/13), 1 mono size (13, always with slightly increased letter-spacing for scanability). Avoid more than this; this is a working tool, not an editorial page.

### 12.4 Layout concept

Standard authenticated-app shell: fixed left sidebar (nav) + top bar (tenant/environment switcher, account) + main content area. ASCII sketch:

```
┌───────────┬──────────────────────────────────────────────┐
│           │  [Staging ▾]              tenant-name  ⚙ ▾    │  ← top bar: environment switcher is
│  Sidebar  ├──────────────────────────────────────────────┤     always visible, never hidden —
│  ─────    │                                                │     staging vs production must never
│  Overview │   Page title (Fraunces)                        │     be ambiguous to the user
│  Templates│   ─────────────────────────                    │
│  Stamp    │                                                │
│  Jobs     │   [ main content: table / form / cards ]       │
│  Settings │                                                │
│           │                                                │
└───────────┴──────────────────────────────────────────────┘
```

The environment switcher in the top bar is a deliberate, non-negotiable UI requirement, not just a style choice: since staging and production carry real legal/financial weight (production spends the tenant's own Peruri balance), the current environment must be visually unambiguous on every screen — color-code it (e.g. `indigo` chip for staging, `ink-navy` filled chip for production) and never let it disappear on scroll.

### 12.5 Page-by-page reference

**Login**
- Centered single card on `paper` background, no marketing copy, no illustration — this is a returning-user utility login, not an acquisition page.
- Fields: email/username, password. Below the fold: "Forgot password" only — no social login (B2B API product, doesn't fit).
- One quiet piece of brand presence: the wordmark in Fraunces at the top of the card, small, not a hero.

**Main menu / Overview (dashboard)**
- Not a vanity-metrics dashboard. Lead with operational state: staging quota remaining (prominent if near limit), recent stamp jobs (last 10, table), any jobs currently stuck/failed (surfaced above the fold if present — this is the one place urgency is appropriate).
- Empty state (new tenant, no jobs yet): direct instruction, not a blank void — "No documents stamped yet. Create a template to get started →" with a single clear CTA, per the interface-voice guidance in §12.7.

**Templates**
- List view: table of templates (name, version, anchor keyword, last used). Mono type for anchor keywords and coordinates.
- Template editor: split view — PDF preview on the left with the resolved anchor position drawn as an overlay box (this is the one place a visual "where will this land" preview earns real estate), config form on the right (keyword list, offsets in cm, box size).
- Show the offset input in both cm (what the user types) and resolved pt (what's actually stored) side by side — this doubles as a trust signal that the system understood the instruction correctly.

**Stamp / Jobs**
- Table, dense, sortable: job ID (mono), invoice number, template, environment (colored chip), status, serial number (mono, brass-colored once issued), timestamp.
- Status badges use exactly one color per state: `pending-amber` for anything in progress, `verified-green` for signed, `alert-rust` for failed. Never combine.
- Job detail view: the state-machine stages from §6 shown as a simple horizontal stepper (Pending → SN Issued → Signing → Signed), with the seal-impression signature element appearing only once the job reaches `signed`.

**Settings — Environment & Credentials**
- Staging section: read-only info (shared account, quota remaining, reset time) — nothing to configure.
- Production section: identity fields (NPWP, name) + credential fields, gated behind a clear "Switch to Production" action rather than auto-saving as you type — this should feel like a deliberate, confirmable step given what's at stake, not a casual settings toggle.
- On save, show live validation status inline (checking → verified/failed) rather than a generic "saved" toast, since credential validity is the actual thing the user needs confirmed.

**API Keys**
- Standard reveal-once-on-creation pattern for secrets; mono type throughout; a persistent, unmissable warning copy pattern ("This key won't be shown again — copy it now") rather than a small caption easy to miss.

### 12.6 Status color reference (for consistency across all pages)

| State | Color | Chip style |
|---|---|---|
| Staging environment | `indigo` | Outlined chip |
| Production environment | `ink-navy` | Filled chip |
| Pending / in progress | `pending-amber` | Filled, subtle pulse animation only while actively polling |
| Signed / verified | `verified-green` | Filled, with small check icon |
| Failed | `alert-rust` | Filled, with small alert icon |

### 12.7 Copy & voice guidelines

- Name things by what the user controls: "Templates," "API Keys," "Stamp Jobs" — not "Anchor Configuration Objects" or other implementation-speak, even though that's exactly what they are underneath.
- Errors state what happened and what to do, without apologizing: "Anchor not found in this document. Using default position — review before relying on this in production." Not "Oops, something went wrong."
- Action labels stay consistent end-to-end: a button that says "Switch to Production" should be followed by a status that says "Production" — never relabel the same action differently mid-flow.
- Keep empty states instructional, not decorative: every empty state names the one next action that resolves it.

### 12.8 Build quality bar

- Responsive down to a reasonable admin-tool breakpoint (this is a desktop-first tool used by integrators/ops, but shouldn't break on a tablet).
- Visible keyboard focus states throughout (this is a credential- and key-handling product — keyboard accessibility isn't optional polish here).
- Respect `prefers-reduced-motion`; the only motion that should exist at all is the subtle pending-state pulse and the seal-impression's small entrance animation on job completion — nothing else animates.