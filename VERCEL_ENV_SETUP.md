# Vercel environment variables — what you have vs what’s missing

## 1. Create NEXTAUTH_SECRET (you need a new one)

The secret must be a **single line**, no spaces or newlines. Generate it once and paste into Vercel.

**Option A — Terminal (PowerShell):**
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Copy the **one line** it prints (e.g. `Mp9M35FgOZRSVNg33dCsnwvfRXZG2h1WopE3FhVKc9g=`).

**Option B — Browser:** Go to https://generate-secret.vercel.app/32 and copy the value.

**In Vercel:** Project → Settings → Environment Variables.  
- If **NEXTAUTH_SECRET** already exists, **Edit** it and replace the value with the new one (paste only that one line).  
- If not, **Add** name `NEXTAUTH_SECRET`, value = what you copied, Environment = Production.  
Save, then **redeploy** (Deployments → ⋮ on latest → Redeploy).

---

## 2. Password “password” and AUTH_PASSWORD_SALT

Your admin user is set to password **`password`** using the **default** salt.

- **Do not add** `AUTH_PASSWORD_SALT` in Vercel (leave it unset).  
- If `AUTH_PASSWORD_SALT` is already there, **remove it** and redeploy.  
Then log in with **will@westchasepainting.com** / **password**.

---

## 3. What you have vs what’s missing

| Variable | You have? | Where to get it |
|----------|-----------|------------------|
| **NEXTAUTH_SECRET** | Yes (fix value per §1) | Generate with command above |
| **NEXTAUTH_URL** | Yes | `https://my.nobletampa.com` |
| **ANTHROPIC_API_KEY** | Yes | Anthropic console |
| **RESEND_FROM_EMAIL** | Yes | `estimates@mail.nobletampa.com` |
| **RESEND_WEBHOOK_SECRET** | Yes | Resend dashboard (webhook) |
| **BLOO_FROM_NUMBER** | Yes | Your Bloo number |
| **BLOO_WEBHOOK_SECRET** | Yes | Bloo dashboard (webhook) |
| **DATABASE_URL** | **Missing** | Supabase (see §4) |
| **STRIPE_SECRET_KEY** | **Missing** | Stripe Dashboard → Developers → API keys |
| **STRIPE_WEBHOOK_SECRET** | **Missing** | Stripe Dashboard → Webhooks → Add endpoint → Signing secret |
| **RESEND_API_KEY** | **Missing** | Resend dashboard → API Keys |
| **BLOO_API_KEY** | **Missing** | Bloo.io dashboard / API key |

Without **DATABASE_URL** the app cannot talk to the database (login, estimates, etc.).  
Without **STRIPE_*** you can’t take payments or create invoices.  
Without **RESEND_API_KEY** / **BLOO_API_KEY** you can’t send email or iMessage.

---

## 4. Get DATABASE_URL (Supabase)

1. Go to https://supabase.com/dashboard and open project **Noble CRM**.
2. **Project Settings** (gear) → **Database**.
3. Under **Connection string** choose **URI**.
4. Copy the URI. It looks like:
   `postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
5. Replace `[YOUR-PASSWORD]` with your **database password** (the one you set for the project; if you forgot, use **Reset database password** on the same page).
6. Use the **Session mode** (port **6543**) pooler URL for Vercel.
7. In Vercel: **Environment Variables** → **Add** → Name `DATABASE_URL`, Value = that full URI, Production. Save and redeploy.

---

## 5. Stripe (invoices / payments)

1. **STRIPE_SECRET_KEY:** Stripe Dashboard → **Developers** → **API keys** → **Secret key** (starts with `sk_live_` or `sk_test_`). Copy and add to Vercel as `STRIPE_SECRET_KEY`.
2. **STRIPE_WEBHOOK_SECRET:** Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**.  
   - URL: `https://my.nobletampa.com/api/webhooks/stripe`  
   - Events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`.  
   After saving, open the webhook → **Signing secret** → reveal and copy. Add to Vercel as `STRIPE_WEBHOOK_SECRET`.

The app uses Stripe for checkout and payment intents; it does not use Stripe Invoicing. “Dynamically create invoices” would mean adding Stripe Invoices API or your own invoice generation; the current spec is checkout + payment plan auto-charge.

---

## 6. Resend (sending email)

Resend dashboard → **API Keys** → Create / copy key (starts with `re_`). Add to Vercel as `RESEND_API_KEY`. You already have `RESEND_FROM_EMAIL` and `RESEND_WEBHOOK_SECRET`.

---

## 7. Bloo (sending iMessage)

Bloo.io dashboard → copy your API key. Add to Vercel as `BLOO_API_KEY`. You already have `BLOO_FROM_NUMBER` and `BLOO_WEBHOOK_SECRET`.

---

## 8. Optional

- **AUTH_PASSWORD_SALT** — Leave unset so the default admin password works.
- **CRON_SECRET** — Only if you call `/api/payments/process-scheduled` on a schedule; can use `NEXTAUTH_SECRET` as fallback.

---

## Summary checklist

- [ ] NEXTAUTH_SECRET: one line, no newline (regenerate and paste in Vercel).
- [ ] AUTH_PASSWORD_SALT: not set (or remove if present).
- [ ] DATABASE_URL: from Supabase Database → Connection string (URI, pooler 6543).
- [ ] STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET: from Stripe Dashboard.
- [ ] RESEND_API_KEY: from Resend dashboard.
- [ ] BLOO_API_KEY: from Bloo dashboard.
- [ ] Redeploy after changing env vars.
