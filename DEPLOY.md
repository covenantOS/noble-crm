# Deploy Noble Estimator to Vercel + Supabase

## Your login (after seed)

- **Email:** `will@westchasepainting.com`
- **Password:** `password`  
  *(Change after first login via Settings or by re-running seed with a new password.)*

---

## 1. Supabase database (Noble CRM project)

Your Supabase project **Noble CRM** is ready:  
`https://bxlfryupkbjkfmizuuzh.supabase.co`

**Schema is already applied** (all tables exist). You only need to seed data and point the app at the DB.

### Get your database URL

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → **Noble CRM** → **Project Settings** (gear) → **Database**.
2. Under **Connection string**, choose **URI**.
3. Copy the connection string and replace `[YOUR-PASSWORD]` with your database password (or reset it under **Database** → **Reset database password**).
4. Use the **Session mode** or **Transaction mode** pooler URL (port **6543**) for serverless. Example:
   ```txt
   postgresql://postgres.bxlfryupkbjkfmizuuzh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

### Run migrations (if schema changed)

If you have new tables (e.g. `CustomerVerificationCode`), run:

```bash
npx prisma migrate dev --name add_customer_verification_code
```

(or apply the migration SQL manually in Supabase SQL editor).

### Seed the database (one-time, from your machine)

From the project root, with `DATABASE_URL` in `.env` set to the Supabase URI above:

```bash
npx prisma db seed
```

This seeds pricing config, message templates, company settings, and the default admin user (`will@westchasepainting.com` / `password`).

---

## 2. Vercel deployment

### One-time setup

1. **Log in to Vercel**
   ```bash
   vercel login
   ```

2. **Link and deploy**
   ```bash
   vercel link    # link to existing or create project
   vercel --prod  # deploy
   ```

3. **Environment variables (Vercel project settings → Environment Variables)**

   Set these for **Production** (and Preview if you want):

   | Name | Value |
   |------|--------|
   | `DATABASE_URL` | Your Supabase connection string (URI from step 1) |
   | `NEXTAUTH_URL` | `https://my.nobletampa.com` (or your Vercel URL until the domain is live) |
   | `NEXTAUTH_SECRET` | A long random string (e.g. `openssl rand -base64 32`) |
   | `ANTHROPIC_API_KEY` | Your Claude API key (for AI estimate analysis) |
   | `AUTH_PASSWORD_SALT` | (Optional) Override for password hashing; leave blank to use default |

   When you’re ready:

   - **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - **Resend:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (e.g. `estimates@mail.nobletampa.com` — sending domain is **mail.nobletampa.com**)
   - **Bloo.io (v2 API):** `BLOO_API_KEY`, `BLOO_FROM_NUMBER` (e.g. `+14245145517`). For delivery/read status: `BLOO_WEBHOOK_SECRET` (from Bloo when you create the webhook).

   **Webhook signing secrets:** After you create webhooks in Resend and Bloo, add `RESEND_WEBHOOK_SECRET` and `BLOO_WEBHOOK_SECRET` to Vercel. Full steps: **WEBHOOKS.md**.

4. **Redeploy** after adding env vars so the build uses them:
   ```bash
   vercel --prod
   ```

---

## 3. Custom domain: my.nobletampa.com (Cloudflare)

The app should be served at **https://my.nobletampa.com**. Do this after the Vercel project is deployed.

### In Vercel

1. Open your project on [Vercel Dashboard](https://vercel.com/dashboard) → **Settings** → **Domains**.
2. Click **Add** and enter `my.nobletampa.com`.
3. Vercel will show the target you need for DNS (e.g. `cname.vercel-dns.com` or a project-specific hostname like `xxx.vercel-dns.com`). Leave this tab open.

### In Cloudflare

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → select the account that has **nobletampa.com**.
2. Open the zone **nobletampa.com** → **DNS** → **Records**.
3. **Add record:**
   - **Type:** `CNAME`
   - **Name:** `my` (so the full name is `my.nobletampa.com`)
   - **Target:** the value Vercel gave you (e.g. `cname.vercel-dns.com`)
   - **Proxy status:** **DNS only** (grey cloud). Turn the orange cloud off so traffic goes straight to Vercel and SSL works correctly.
4. Save. Propagation is usually within a few minutes.

### Finish in Vercel

1. Back in Vercel **Domains**, wait until the domain shows as **Valid** (Vercel will issue SSL).
2. Set **NEXTAUTH_URL** in Vercel env vars to `https://my.nobletampa.com` and redeploy if you had used the `.vercel.app` URL before.

After this, the app will be live at **https://my.nobletampa.com**.

---

## 4. After deploy

1. Open **https://my.nobletampa.com** (or your Vercel URL until the domain is connected).
2. You should be redirected to `/login`.
3. Sign in with **will@westchasepainting.com** / **password**.
4. Change the default password when you’re ready (e.g. by updating the user in Supabase or adding a “change password” flow).

---

## Resend & Bloo.io

- **Resend:** Sending domain **mail.nobletampa.com** is configured. Add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (e.g. `estimates@mail.nobletampa.com`) to Vercel env vars; estimate-sent and other emails will then send.
- **Bloo.io (v2):** API base is `https://backend.blooio.com/v2/api` ([docs](https://docs.blooio.com/)). Set `BLOO_API_KEY`, `BLOO_FROM_NUMBER` (e.g. `+14245145517`). iMessage/RCS templates in the app use this client.
- **Bloo webhook (optional):** To track sent/delivered/read/failed for outbound messages, create a webhook in the Bloo dashboard and set the URL to `https://my.nobletampa.com/api/webhooks/bloo`. Events: **All** (or at least message events + delivery status). After creating the webhook, copy the **signing secret** (shown once) into Vercel as `BLOO_WEBHOOK_SECRET`. The route verifies the signature and updates `Message` records by `blooMessageId`.
- **Resend webhook (optional):** Create a webhook in [Resend → Webhooks](https://resend.com/webhooks) with URL `https://my.nobletampa.com/api/webhooks/resend`. Add the signing secret as `RESEND_WEBHOOK_SECRET` in Vercel. **Full step-by-step for both: WEBHOOKS.md.**

Stripe is wired in the code; add your keys and webhook URL when you’re ready to test payments.

---

## What's left with the app

Integrations you have (Supabase, Vercel, Cloudflare, GitHub, Stripe, Resend, Bloo.io) are wired in code and docs. Remaining work is feature completion:

| Area | Status | Notes |
|------|--------|--------|
| **PDF generation** | Not built | Estimate/contract PDF via @react-pdf/renderer or Puppeteer |
| **Customer-facing page** | Not built | `/view/[estimateId]/[token]` — 4 payment tiers, contract, e-sign, payment |
| **Contract (17 sections)** | Not built | Full contract text + e-signature + IP capture |
| **Stripe flows** | API ready | Need: create-checkout, charge-saved, webhook route + env vars |
| **Auto-charge (Tier 4)** | Not built | 48h notices, retry logic, midpoint/completion triggers |
| **Email/iMessage sends** | Clients ready | Resend + Bloo clients done; wire "send estimate", "reminder", "contract signed" into flows |
| **Change orders** | Not built | CRUD + approval flow |
| **PWA** | Partial | next-pwa present; manifest/offline to finish |
| **Dashboard stats** | Basic | Estimates list, customers; could add stats (revenue, close rate) |

Once env vars and webhooks are set (see **WEBHOOKS.md** and the Vercel checklist in `.env.example`), the app runs end-to-end for: login, settings, new estimate wizard, AI analysis, estimate list/detail. Remaining work is customer-facing view, contract, Stripe checkout, and automated messaging triggers.

---

## Summary

| Item | Value |
|------|--------|
| **Production URL** | https://my.nobletampa.com |
| **Login (after seed)** | will@westchasepainting.com / password |
| **Supabase project** | Noble CRM (`bxlfryupkbjkfmizuuzh`) |
| **Cloudflare** | Zone `nobletampa.com` → CNAME `my` → Vercel (DNS only) |
| **Webhooks** | Resend + Bloo — see **WEBHOOKS.md** |
