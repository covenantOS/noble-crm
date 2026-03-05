# Features still to build or improve (from spec)

This list is based on **SPEC.md** vs what’s implemented. Use it to prioritize next work.

---

## High priority (core flows)

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Send estimate to customer** | §4 Estimate detail: “Send to Customer” | **Missing** | When admin marks estimate as SENT or clicks “Send to Customer”, app should send the estimate link via Resend (estimate_sent_email template) and Bloo (estimate_sent_imessage template). Right now only status and `sentAt` are updated; no email/iMessage is sent. |
| **DATABASE_URL in Vercel** | Deploy | **Required** | Production DB not configured until you add Supabase connection string in Vercel. Without it, app and bootstrap cannot run. |
| **Seed pricing/templates** | §1 Priority | **One-time** | If DB is empty, run `npx prisma db seed` (with production `DATABASE_URL`) so PricingConfig, MessageTemplate, and CompanySettings exist. Bootstrap only creates the admin user. |

---

## Change orders

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Change order flow** | §Additional DB: ChangeOrder, §File structure /change-orders | **API done** | `GET/POST /api/change-orders`, `PATCH /api/change-orders/[id]`. Admin UI and Payment records on approve still optional. |
| **Adjusted contract value in UI** | §ChangeOrder: “original contract total plus all approved change order totals” | **Not built** | Contract/dashboard should show original total + sum of approved change orders. |

---

## Messaging and automation

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Estimate reminder (3 days after sent)** | §Email/iMessage templates | **Not built** | If estimate not viewed/approved after 3 days, send reminder email + iMessage using templates. Needs a cron or scheduled job. |
| **Job starting reminder (day before)** | §iMessage: “Day before job starts” | **Not built** | Trigger when admin sets or confirms a “job start date”. Send template to customer. Requires a way to set/display start date (e.g. on Contract or Job). |
| **Review request (after job complete)** | §iMessage: “Review request (job complete)” | **Not built** | When admin marks job/contract complete, send review request with Google link. Needs “mark complete” action and template send. |
| **Message history on customer detail** | §7 All Customers: “message history” | **Partial** | Message model and Bloo/Resend webhooks update status. Customer detail page doesn’t yet show a message timeline. |

---

## UX and data

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Google Places autocomplete** | §2 Step 1: “address (Google Places autocomplete)” | **Not built** | Property address is a text field. Add Places API autocomplete for address. |
| **Quick estimate mode** | §2 Step 3: “quick estimate mode… just enter total exterior sqft or total interior sqft” | **Not built** | Allow a single total sqft input instead of full measurements; AI still works with that. |
| **Estimate list search/filter** | §6: “Search and filter (by status, date range, customer name, price range)” | **Partial** | Filters exist; search by customer name and price range can be improved. |
| **Duplicate estimate** | §3 Estimate detail: “Duplicate” | **Not built** | Add “Duplicate” action that clones estimate (and optionally customer/property) as new draft. |
| **Contract PDF (documentUrl)** | §Contract: “documentUrl (PDF)” | **Partial** | Contract snapshot and e-signature are stored; generating and storing a signed contract PDF (and setting `documentUrl`) is not implemented. |
| **Logo upload** | §5 Settings: “Logo upload” | **Not built** | Company logo is not configurable; need upload and storage (e.g. Supabase Storage). |

---

## Storage and files

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Supabase Storage for photos** | §Tech stack: “Supabase Storage for all photos and generated documents” | **Partial** | Photos may be stored as URLs or base64; spec calls for Supabase Storage for uploads and generated PDFs. |
| **Supabase Storage for generated PDFs** | Same | **Partial** | Estimate PDF is generated on the fly; contract and other generated docs could be uploaded to Storage and linked (e.g. `documentUrl`). |

---

## PWA and reliability

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Offline data entry and sync** | §PWA: “data entry and photo capture should work offline; sync when back online” | **Not built** | Manifest and install exist; offline queue and sync for estimates/photos are not implemented. |
| **Service worker caching** | §PWA | **Partial** | next-pwa adds a service worker; offline behavior for app shell and API is not fully defined. |

---

## Admin and ops

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Mark job midpoint / completion** | §Auto-draw: “admin marks midpoint reached” / “marks job complete” | **Partial** | `process-scheduled` cron charges by due date. There is no explicit “Mark midpoint” / “Mark complete” in the UI that triggers charges or reminders; those could be driven by due dates only or by explicit actions. |
| **PaymentReminder records** | §DB: PaymentReminder | **Partial** | process-scheduled creates reminders; ensure all 48h/due/failed flows create PaymentReminder rows for audit. |
| **Multi-user roles** | §DB User: OWNER, SALES, ESTIMATOR, CREW_LEAD | **Partial** | Schema has roles; app effectively uses a single admin (OWNER). Role-based access and UI for other roles not built. |

---

## Stripe and payments

| Feature | Spec reference | Status | Notes |
|--------|----------------|--------|--------|
| **Klarna/Afterpay in Stripe** | §Stripe: “Enable Klarna and Afterpay in Stripe Dashboard” | **Config** | Enable in Stripe Dashboard for Tier 3 (finance); app already uses Checkout. |
| **STRIPE_* in Vercel** | ENV_VARS | **Required for payments** | Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel for live payments. |

---

## Summary

- **Must-do for production:** Set **DATABASE_URL** in Vercel, run **bootstrap** (or full **seed**), then optionally **“Send estimate to customer”** (email + iMessage when estimate is sent).
- **Next valuable:** **Change order flow** (API + UI + payments), **estimate reminder** (3 days), **job start** and **review request** automation, **contract PDF** generation and storage.
- **Nice-to-have:** Google Places, quick estimate mode, duplicate estimate, logo upload, offline PWA, multi-role UI.
