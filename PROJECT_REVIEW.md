# Noble Estimator — Full Project Review

**Product:** Noble Estimator (foundation of Noble CRM)  
**Purpose:** Field estimating tool for Westchase Painting Company: capture property data → AI analysis → estimate → contract → payment → customer messaging.  
**Audience:** Internal team (admin/estimators) + homeowners (customer-facing pages and portal).

---

## 1. Executive Summary

The app is **spec-aligned for core flows**: estimate creation with AI, sending to customer (email + iMessage), customer-facing estimate + 4 payment tiers, full contract (17 sections) + e-signature, Stripe (card, Klarna/Afterpay, payment plan with auto-charge), change orders, dashboard/customers/settings, and automation (estimate reminder, job-start reminder, review on complete). Gaps remain in UX polish (Google Places, quick-estimate mode), storage (Supabase Storage for photos/PDFs), PWA offline sync, contract PDF storage, and multi-role access.

---

## 2. Full Feature List (Implemented)

### 2.1 Authentication & access

| Feature | Description |
|--------|-------------|
| Admin login | NextAuth.js credentials (email + password). Session required for all admin routes. |
| Bootstrap | One-time `POST /api/bootstrap` (or seed) creates initial admin user. |
| Customer portal login | Magic link: customer enters phone or email → receives code → enters code → signed cookie session. |
| Route protection | Middleware: `/login`, `/view/*`, `/customer/*`, `/api/view/*`, `/api/customer/*`, `/api/contracts/*`, `/api/webhooks/*`, `/api/cron/*`, `/api/estimates/send-reminders` are public; all other app routes require admin session. |

### 2.2 Dashboard (/)

| Feature | Description |
|--------|-------------|
| Stats | Estimates this month, **active** (in progress / awaiting), close rate %, revenue this month, average job size. |
| Recent estimates | Table: customer, property, status, price, created (time ago). Link to estimate detail. |
| Recent activity | Feed of last 8 items: contract signed, payment received (with time ago). |
| Quick actions | New Estimate, View All Estimates, View Customers, Settings. |
| Credentials card | Bonded & Insured, EPA Lead-Safe, OSHA, PCA, SW PRO+ (reference). |

### 2.3 New estimate flow (/estimates/new)

| Feature | Description |
|--------|-------------|
| Step 1: Customer & property | Form: first/last name, phone, email, source. Property: address, city, state, zip, square footage, stories, construction type, year built, notes. Customer search/autocomplete from existing customers. |
| Step 2: Scope | Scope type (Exterior / Interior / Both). Surface checklist with condition (Good/Fair/Poor) and notes per surface. |
| Step 3: Measurements | Per-surface: linear feet, height, gross area, window/door deductions, net paintable area, coats. |
| Step 4: Photos & notes | Photo capture/upload (base64), location tag, notes. General notes for AI. |
| Step 5: AI analysis | "Generate Estimate" → POST /api/ai/analyze. Loading screen; Claude analyzes photos + data, returns line items, scope of work, flags, timeline. Estimate saved with status REVIEW. |
| Step 6: Review & adjust | Line items table, AI photo analysis, flags, scope of work (editable). "Approve & Generate PDF" → estimate approved; "Back to Edit" returns to earlier step. |

### 2.4 Estimate list (/estimates)

| Feature | Description |
|--------|-------------|
| List | Paginated table: customer, property, scope, status, price, created. |
| Search | By customer name or property address. |
| Filters | Status (all/draft/sent/approved/…), **date range** (from/to), **price range** (min/max). |
| Sort | Newest first, price high–low, price low–high, status. |
| Quick actions | View, **Send** (when draft/review + customer has email or phone), **Duplicate**, **Delete** (with confirm). |

### 2.5 Estimate detail (/estimates/[id])

| Feature | Description |
|--------|-------------|
| Summary | Status badge, customer/property, pricing (base, cash, card, finance, payment plan), scope of work, timeline. |
| Line items & photos | Tables/lists; AI flags and photo analysis shown. |
| Actions | **View customer page** (public estimate link), **Contract / Sign link** (public contract URL), **Send to Customer**, Edit, Duplicate. |
| Contracts & change orders | Per contract: status, total, **adjusted total** (original + approved change orders), list of change orders. **Add change order** (description, material $, labor $); markup from PricingConfig. **Job start date** (saved on contract for reminders). |
| Mark midpoint / Mark complete | For payment-plan contracts with scheduled midpoint/completion payments: **Mark midpoint** and **Mark complete** trigger charge to saved card and send receipt (email + iMessage). On complete: contract set to COMPLETED, **review request** sent (iMessage + email with Google review link). |

### 2.6 Customers

| Feature | Description |
|--------|-------------|
| List (/customers) | Search by name/email/phone. Table: name, phone, email, **# estimates**, **total revenue**, **last activity**, View. |
| Detail (/customers/[id]) | Contact info, **total revenue**, **last activity**. Address, notes. Properties list. Estimates table (property, status, price, date, View). Contracts table. **Payments** table (type, amount, status, due, paid). **Message history** (direction, channel, content snippet, date). "New estimate for this customer" button. |

### 2.7 Settings (/settings)

| Feature | Description |
|--------|-------------|
| Pricing configuration | All PricingConfig by category (Material, Labor, Markup, Payment, Coverage, Other). Edit values, Save. |
| Company info | Name, legal name, address, phone, email, website, **google_review_link**, credentials. |
| **Internal policies** | Four editable policies (Sub-Contractor, Material, Quality, Review) stored in CompanySettings. |
| Message templates | List from DB; edit subject (email) and body; variables noted. Save. |
| Integrations | Read-only note: API keys and webhooks via env vars. |

### 2.8 Customer-facing estimate & contract (/view/[estimateId]/[token])

| Feature | Description |
|--------|-------------|
| Public estimate page | No login. Branded header, property address, scope of work, selected photos, line items. **Four payment tiers** (cards): Upfront Cash (best value), Upfront Card, Finance (Klarna/Afterpay), Payment Plan (50/40/10) with schedule. "Select" → go to contract. |
| Contract page | Full contract text (17 sections from spec). Payment schedule summary. E-signature pad, printed name. "Sign & Continue" → POST /api/contracts/sign. |
| Post-sign | Tier 1 (cash): instructions only. Tier 2/3/4: Stripe Checkout (or SetupIntent + Checkout for payment plan). Redirect to success page. Contract and payments created; confirmation email + iMessage sent. |

### 2.9 Customer portal (/customer, /customer/dashboard)

| Feature | Description |
|--------|-------------|
| Login | Enter phone or email → code sent (email and/or iMessage) → enter code → signed session. |
| Dashboard | After login: list of estimates (status, price, view link) and contracts (status, total, payments, property). |

### 2.10 Payments & Stripe

| Feature | Description |
|--------|-------------|
| Checkout | Tier 2: full upfront card. Tier 3: full amount with Klarna/Afterpay. Tier 4: deposit + save payment method for midpoint/completion. |
| Auto-charge | When admin clicks **Mark midpoint** or **Mark complete**, POST /api/contracts/[id]/charge-payment charges saved card and sends receipt. |
| Scheduled processing | POST /api/payments/process-scheduled (cron): 48h reminders, then charge when due; on failure, notify customer and retry logic. |
| Webhooks | Stripe webhook: checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed, setup_intent.succeeded → update Payment/Contract, send confirmations. |

### 2.11 Messaging (Resend + Bloo.io)

| Feature | Description |
|--------|-------------|
| Send estimate | On "Send to Customer": branded email + iMessage with estimate link. |
| Contract signed | Confirmation email + iMessage after sign + payment. |
| Payment receipt | On charge success (manual or cron): email + iMessage. |
| Payment failed | On charge failure: email + iMessage with company phone. |
| 48h reminder | process-scheduled sends 48h before due payment (iMessage). |
| Estimate reminder | POST /api/estimates/send-reminders (cron): SENT estimates 3+ days old get reminder email + iMessage. |
| Job-start reminder | POST /api/cron/job-start-reminders (cron): contracts with scheduledStartDate = tomorrow get "day before" message. |
| Review request | On **Mark complete**: iMessage + email with Google review link (from Settings). |
| Webhooks | Resend and Bloo webhooks supported for delivery/read status (optional). |

### 2.12 Change orders

| Feature | Description |
|--------|-------------|
| API | GET /api/change-orders?contractId=, POST (create), PATCH /api/change-orders/[id] (status, approval method/evidence). |
| UI | On estimate detail, per contract: list change orders, **adjusted total**, **Add change order** form (description, material $, labor $). Markup from PricingConfig. |

### 2.13 PDF & AI

| Feature | Description |
|--------|-------------|
| Estimate PDF | GET /api/estimates/[id]/pdf generates PDF (react-pdf) for download/view. |
| AI analysis | POST /api/ai/analyze: structured data + photos → Claude; returns line items, scope, flags, timeline, photo analysis. |

### 2.14 Cron / automation

| Feature | Description |
|--------|-------------|
| Estimate reminder | POST /api/estimates/send-reminders with `Authorization: Bearer CRON_SECRET`. |
| Job-start reminder | POST /api/cron/job-start-reminders with same header. |
| Process scheduled payments | POST /api/payments/process-scheduled (48h reminder + charge when due). |

---

## 3. Gap List (vs SPEC)

### 3.1 Not built / partial

| Gap | Spec reference | Notes |
|-----|----------------|-------|
| **Google Places autocomplete** | Step 1: property address | Address is a text field; no Places API. |
| **Quick estimate mode** | Step 3: total exterior/interior sqft only | No single-field "quick" mode; full measurements only. |
| **Contract PDF (documentUrl)** | Contract model | Snapshot + signature stored; no generated signed PDF saved to Storage or `documentUrl`. |
| **Logo upload** | Settings: company logo | Logo not configurable; no upload or Supabase Storage. |
| **Supabase Storage for photos** | Tech stack | Photos stored as base64 or URL in DB; no Supabase Storage upload. |
| **Supabase Storage for generated PDFs** | Tech stack | Estimate PDF generated on the fly; not uploaded to Storage. |
| **Offline PWA / sync** | PWA: offline data entry, sync when online | Manifest + install; no offline queue or sync. |
| **PaymentReminder records** | DB model | process-scheduled sends reminders; optional audit rows in PaymentReminder not fully wired. |
| **Multi-user roles** | User.role (OWNER, SALES, ESTIMATOR, CREW_LEAD) | Schema has role; app treats single admin; no role-based UI or permissions. |
| **Create Payment on change order approve** | ChangeOrder: "create additional Payment records" | Change orders create records and show adjusted value; creating a Payment record on approve is not implemented. |

### 3.2 Configuration / one-time

| Item | Notes |
|------|--------|
| **DATABASE_URL** | Must be set in Vercel (Supabase connection string). |
| **Stripe** | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; enable Klarna/Afterpay in Stripe Dashboard for Tier 3. |
| **Resend / Bloo** | API keys and from address/number in env. |
| **Seed** | Run `npx prisma db seed` (or use bootstrap + Supabase inserts) for PricingConfig, MessageTemplate, CompanySettings, policies. |
| **Contract schema** | Run `npx prisma db push` (or migration) for `scheduledStartDate`, `completedAt` on Contract. |
| **Cron** | Configure Vercel Cron or external cron for send-reminders, job-start-reminders, process-scheduled. |

---

## 4. How It Works (System & Architecture)

### 4.1 Stack

- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind.
- **Backend:** Next.js API routes, Prisma ORM, PostgreSQL (Supabase).
- **Auth:** NextAuth (admin), signed cookie (customer portal).
- **AI:** Anthropic Claude (analysis + optional PDF copy).
- **Payments:** Stripe (Checkout, PaymentIntent, SetupIntent).
- **Email:** Resend. **iMessage/RCS:** Bloo.io.
- **PDF:** @react-pdf/renderer (estimate). **PWA:** next-pwa (manifest, service worker).

### 4.2 Data flow (high level)

1. **Estimate creation:** Admin fills wizard → AI analyzes → estimate saved (REVIEW then approved).
2. **Send to customer:** Admin clicks Send → email + iMessage with link to `/view/[id]/[token]`.
3. **Customer view:** Opens link → sees estimate + 4 tiers → selects tier → contract page → signs → Stripe (if not cash) → contract + payments created; confirmations sent.
4. **Payment plan:** Deposit at sign; midpoint/completion either triggered by admin (**Mark midpoint** / **Mark complete**) or by cron (process-scheduled by due date). 48h reminder before charge; receipt or failure message after.
5. **Change orders:** Admin adds on estimate detail; adjusted total = contract total + approved change order amounts.
6. **Automation:** Cron calls send-reminders (3-day estimate reminder), job-start-reminders (day before start), process-scheduled (payment reminders + charges).

### 4.3 Key APIs (reference)

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/dashboard | Stats, active count, recent estimates, recent activity. |
| GET/POST | /api/estimates | List (with filters/sort) or create estimate. |
| GET/PUT/DELETE | /api/estimates/[id] | Get/update/delete estimate. |
| POST | /api/estimates/[id]/send | Send estimate to customer (email + iMessage). |
| POST | /api/estimates/[id]/duplicate | Clone as new draft. |
| GET | /api/estimates/[id]/pdf | Generate estimate PDF. |
| POST | /api/ai/analyze | Run AI analysis (wizard step 5). |
| GET | /api/view/estimate | Public: get estimate by id+token; mark viewed. |
| POST | /api/contracts/sign | Public: create contract, snapshot, Stripe session. |
| GET/PATCH | /api/contracts/[id] | Get contract; update scheduledStartDate/completedAt. |
| POST | /api/contracts/[id]/charge-payment | Admin: charge midpoint or completion + receipt + review (if completion). |
| GET/POST | /api/change-orders | List by contractId; create. |
| PATCH | /api/change-orders/[id] | Update status (e.g. APPROVED). |
| GET | /api/customers | List with estimate count, revenue, last activity. |
| GET | /api/customers/[id] | Detail with payments, messages. |
| GET/PUT | /api/settings | Get/update pricing, company, templates. |
| POST | /api/estimates/send-reminders | Cron: 3-day estimate reminder. |
| POST | /api/cron/job-start-reminders | Cron: day-before job start. |
| POST | /api/payments/process-scheduled | Cron: 48h reminder + charge when due. |
| POST | /api/customer/send-code | Send magic code. |
| POST | /api/customer/verify | Verify code, set session. |
| GET | /api/customer/me | Customer portal data. |

---

## 5. Full Workflow

### 5.1 Admin: From walk-through to paid job

1. **Login** at `/login` (email + password).
2. **Dashboard:** See stats, active count, recent estimates, recent activity. Use "New Estimate" or "View All Estimates".
3. **New estimate (/estimates/new):**
   - Step 1: Enter or search customer; enter property (address, city, state, zip, sqft, stories, construction, year).
   - Step 2: Choose scope (Exterior/Interior/Both); set surface checklist and condition/notes.
   - Step 3: Enter measurements per surface (linear ft, height, deductions, net area, coats).
   - Step 4: Add photos (capture/upload), location, notes; add general notes.
   - Step 5: Click "Generate Estimate" → AI runs → loading → result.
   - Step 6: Review line items, scope, flags; edit if needed → "Approve & Generate PDF".
4. **Estimate detail:** See full estimate. Click **Send to Customer** → customer gets email + iMessage with link.
5. **Customer** (see §6) opens link, views estimate, picks payment tier, signs contract, pays (or gets cash instructions).
6. **After sign:** Contract and payments created; confirmation sent. For payment plan, **deposit** is already paid; **midpoint** and **completion** are scheduled.
7. **Optional:** Set **Job start date** on contract (estimate detail → Contracts & change orders → Job start).
8. **When job hits midpoint:** On estimate detail, click **Mark midpoint** → card charged, receipt sent.
9. **When job is complete:** Click **Mark complete** → completion payment charged, receipt + **review request** sent, contract set to COMPLETED.
10. **Change orders:** On estimate detail, under contract, **Add change order** (description, material $, labor $) → later PATCH to APPROVED; **adjusted total** updates.
11. **Customers:** Use **Customers** to search, see revenue/last activity, open detail for payments and message history.

### 5.2 Automation (cron)

- **Daily (example):** Call `POST /api/estimates/send-reminders` → reminders for estimates SENT 3+ days ago.
- **Daily:** Call `POST /api/cron/job-start-reminders` → "day before" message for contracts with start date tomorrow.
- **Daily (or twice daily):** Call `POST /api/payments/process-scheduled` → 48h reminders and charges for due payments.

All cron routes accept `Authorization: Bearer CRON_SECRET` (or NEXTAUTH_SECRET if CRON_SECRET not set).

---

## 6. Client (Homeowner) Experience

### 6.1 Receiving the estimate

- Gets **email** (branded, from Resend) and **iMessage** (from Will/Bloo) with a single link: `https://<domain>/view/[estimateId]/[token]`.
- No account needed to view.

### 6.2 Viewing the estimate (/view/[estimateId]/[token])

- Sees company header, credentials, property address.
- Reads **scope of work**, **line items**, **photos** (only those marked show-to-customer).
- Sees **four payment options** with clear prices and, for payment plan, the 50/40/10 schedule.
- Chooses one option and clicks to go to contract.

### 6.3 Signing the contract (/view/[estimateId]/[token]/contract)

- Reads full **contract** (17 sections: parties, scope, price, payment terms, auto-charge consent, timeline, change orders, warranty, etc.).
- Sees **payment schedule** again for the chosen tier.
- Signs with **e-signature** and **printed name**.
- Clicks "Sign & Continue":
  - **Tier 1 (cash):** Shown payment instructions; contract saved; no Stripe.
  - **Tier 2/3:** Redirected to **Stripe Checkout** (card or Klarna/Afterpay); after payment, redirected to success.
  - **Tier 4:** Stripe collects deposit and saves payment method; redirect to success.
- Gets **confirmation email + iMessage** (e.g. "You're all set… we're getting you on the schedule").

### 6.4 After signing

- **Payment plan:** Gets **48h reminder** before midpoint and completion charges; then **receipt** or **payment failed** message (with company phone).
- **Job start:** If admin set a start date, gets **"day before"** message (crew tomorrow, move cars, etc.).
- **Job complete:** After admin marks complete, gets **review request** with Google review link.

### 6.5 Customer portal (optional)

- Goes to `/customer`, enters **phone or email**.
- Receives **code** (email and/or iMessage), enters it → logged in.
- **Dashboard:** Sees their estimates and contracts (status, amounts, payments, links to view estimate). No payment actions in portal; view-only.

---

## 7. Summary Table

| Area | Implemented | Gaps |
|------|-------------|------|
| Auth | Admin login, customer magic-link portal | Multi-role (SALES, ESTIMATOR, CREW_LEAD) not used in UI |
| Dashboard | Stats, active, recent estimates, activity, quick actions | — |
| New estimate | Full wizard, AI analysis, review & approve | Google Places, quick-estimate mode |
| Estimate list | Search, status/date/price/sort, Send/Duplicate/Delete | — |
| Estimate detail | Send, contract link, PDF, Edit, Duplicate, contracts & change orders, Mark midpoint/complete, job start date | — |
| Customers | List (revenue, activity), detail (payments, messages) | — |
| Settings | Pricing, company, policies, templates, integrations note | Logo upload |
| Customer-facing | Estimate view, 4 tiers, contract, e-sign, Stripe, success | — |
| Customer portal | Login by code, dashboard (estimates + contracts) | — |
| Payments | Checkout, auto-charge (UI + cron), webhooks, receipts/failures | PaymentReminder audit rows optional |
| Messaging | Send estimate, confirmations, receipts, 48h reminder, 3-day reminder, job-start, review request | — |
| Change orders | API + UI, adjusted total | Create Payment on approve not done |
| PDF | Estimate PDF on the fly | Contract PDF / documentUrl, Storage |
| Storage | — | Supabase Storage for photos/PDFs |
| PWA | Manifest, install | Offline sync |

This document reflects the current codebase and SPEC.md. Use it for onboarding, prioritization, and handoff.
