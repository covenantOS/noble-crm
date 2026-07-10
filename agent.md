# Noble CRM — Agent Surface

Field-service CRM for Noble Tampa (multi-account: Westchase Painting, Tampa Kitchen Cabinets, Sunshine Demo, etc.).

**Live:** Cloudflare Worker `noble-crm` · GitHub `covenantOS/noble-crm`  
**Agent UI:** append `?agent` to any path for large targets and always-visible actions.

## Auth

Session cookie via better-auth (`/api/auth/*`). Most `/api/*` routes require a signed-in user. Roles: `admin` | `office` | `estimator` | `technician` | `pending`.

Brand scope: pass `?brand_id=<id>` on list/stats/intelligence routes. Omit for All Accounts.

## Capability map

`GET /api/agent/capabilities` — machine-readable list of actions.

### Owner intelligence (AI-first slice)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/search?q=` | Global search: customers, jobs, estimates, invoices |
| GET | `/api/today` | Today board: jobs, awaiting estimates, overdue AR, signed overnight |
| GET | `/api/digest` | Narrative money/ops sentences |
| POST | `/api/assistant` | Keyless intent assistant `{ message, brand_id? }` |
| GET | `/api/agent/capabilities` | This surface |

### Core CRUD (brand-scoped lists)

- `GET/POST /api/customers`, `GET/PUT/DELETE /api/customers/{id}`
- `GET/POST /api/jobs`, `GET/PUT/DELETE /api/jobs/{id}` (+ notes, crew, checklist, materials, review-request)
- `GET/POST /api/estimates`, estimate lines/rooms/surfaces, convert, send, deposit
- `GET/POST /api/invoices`, payments, lines
- `GET /api/stats` — KPIs
- `GET /api/schedule` — week board
- Brands, technicians, service types, materials, products, service agreements

### Public (token-gated, no session)

- `GET /api/public/estimates/{token}` · accept · decline · pdf
- Customer-facing HTML under public estimate routes

### Demo

- `GET /api/demo/status`
- `POST /api/demo/reset` — **admin only**; wipes Sunshine Painting demo brand data and reseeds

## UI agent affordances

- **⌘K / Ctrl+K** — command palette (search + jump actions)
- **Assistant FAB** — bottom-right keyless assistant
- **Owner brief** — dashboard narrative digest
- **`?agent`** — automation-friendly chrome

## Assistant intents (keyless)

`overdue invoices` · `jobs today` · `open estimates` · `digest` · `find {name}` · `go to schedule|customers|invoices|estimates|jobs`

When `ANTHROPIC_API_KEY` is set as a Worker secret, `claude_ready` flips true on digest/capabilities (full tool-use drafting is the next enhancer step; keyless remains the default product path).

## Conventions

- Money: integer **cents** in DB; API often dollars at the edge via `fromCents`
- Timezone for "today": **America/New_York** (Tampa)
- Deploy: push to `main` (Git-connected worker). Prefer `pnpm db:migrate:remote` before schema-dependent pushes
- Do not `wrangler deploy` for production unless explicitly requested
