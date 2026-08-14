# OpexNow Stamp

Multi-tenant e-Meterai stamping API (Cloudflare Workers) + admin console (React + Vite).

- **Worker API** — `worker/` (Hono on Cloudflare Workers). Uploads a PDF, resolves an anchor keyword on the page text layer, issues a serial number through the Peruri staging/production gateway, and embeds a QR e-Meterai stamp onto the document.
- **Admin console** — `web/` (React + Vite), served by the Worker's `assets` binding. Template builder with a live PDF preview, one-off / batch stamping, job tracker, staging quota, and API-key management.

See `docs/PRD.md` for the product background.

## Prerequisites

- Node.js ≥ 20 (developed on 22)
- npm (workspaces)

## Quick start (local)

```powershell
# 1. Install dependencies (hoisted to the root)
npm install

# 2. Prepare worker secrets
Copy-Item worker/.dev.vars.example worker/.dev.vars
#   .dev.vars is git-ignored. Regenerate STAMP_CREDENTIAL_ENCRYPTION_KEY
#   (`openssl rand -base64 32`) before any real deployment.

# 3. Apply the D1 schema and seed the demo tenant
npm run db:apply
npm run db:seed

# 4. Build the web console (the Worker serves web/dist via the assets binding)
npm run build --workspace web

# 5. Start the API + console on http://127.0.0.1:8787
npm run dev:api
```

Open http://127.0.0.1:8787/ and log in with the seeded credentials:

- Console login: `admin@demo.local` / `opex-demo-2026`
- Tenant: `ten_demo` (staging daily limit 20 stamps)

While iterating on the UI you can instead run Vite directly (hot reload) on http://localhost:5173 — it proxies `/templates`, `/stamp`, `/jobs`, `/tenants`, `/auth`, `/console`, `/download` to the worker on `127.0.0.1:8787`:

```powershell
npm run dev:web     # separate terminal
```

## Sample document

A generated one-page demo invoice lives at `worker/.samples/invoice-sample.pdf` (contains the line "Total Amount"). Regenerate it with:

```powershell
npm run make-sample --workspace worker
```

## Scripts (root)

| Script | What it does |
| --- | --- |
| `npm run dev:api` | `wrangler dev --port 8787` (worker + served console) |
| `npm run dev:web` | Vite dev server with proxy to the worker |
| `npm run build` | Builds `web/` and typechecks the worker |
| `npm run db:apply` | Applies `worker/migrations` to the local D1 |
| `npm run db:seed` | Seeds demo tenant / admin / API key (prints the API secret once) |

## Configuration

`worker/wrangler.jsonc` — bindings, D1 (`stampdb`), R2 (`opexnow-stamp-docs`), Durable Objects (`STAGING_QUOTA`, `JWT_CACHE`), Queue (`opexnow-stamp-jobs`, DLQ), `assets: ../web/dist`.

Local run uses `MOCK_PERURI=true` and the local signer (`worker/src/lib/stamp.ts`), so no real Peruri credentials are needed. To exercise the real gateway, set `MOCK_PERURI=false`, `STAGING_PERURI_USERNAME`/`STAGING_PERURI_PASSWORD` in `worker/.dev.vars`, and enable the tenant's production credentials from the console Settings page.

## How it works

1. **Template build** — `POST /templates` with a PDF; the worker extracts the text layer (custom PDF parser in `worker/src/lib/pdf.ts`), returns candidate keywords per page. `PUT /templates/:id` pins anchors (`keyword` + dx/dy cm) and the seal box size / default position.
2. **Stamp** — `POST /stamp` (sync or async via Queue) stores the document in R2, resolves the anchor, calls `stampv2` for a serial number (this spends the staging quota), then renders the QR seal at the anchor and stores the signed PDF.
3. **Job lifecycle** — `pending_anchor → pending_sn → sn_issued → signing → signed`; failures record `{stage, message}` in `error` and retries use the queue.

## API keys

Create a key from the console **API Keys** page, or use the seeded `opx_demo` key. Authenticate either with a bearer token (`POST /auth/token`) or HMAC headers:

- `X-API-Key`, `X-Timestamp` (ISO/epoch ms), `X-Signature` = HMAC-SHA256 of `"{timestamp}\n{method}\n{path}\n{sha256(body)}"` (tolerance 300 s).

## Security notes

- Secrets live in `worker/.dev.vars` / `wrangler secret put`; never commit them.
- Production signing credentials are AES-256-GCM encrypted at rest with AAD binding to tenant + key id.
- Passwords are PBKDF2-SHA256; API secrets stored as SHA-256 hashes plus encrypted copies.
- Login endpoint is rate-limited.
