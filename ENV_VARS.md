# Noble Estimator — Full environment variables

Set these in **Vercel**: Project → Settings → Environment Variables (Production + Preview if you want).

Use the same names and values in local `.env` for development.

---

## Required for app to run

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase: Project Settings → Database → URI, use pooler port 6543) | `postgresql://postgres.PROJECT:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres` |
| `NEXTAUTH_URL` | Full URL of the app (must match the domain you use) | `https://my.nobletampa.com` |
| `NEXTAUTH_SECRET` | Secret for signing sessions (e.g. `openssl rand -base64 32`) | long random string |

---

## Auth (optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTH_PASSWORD_SALT` | Override for admin password hashing; omit to use default | optional |

---

## AI (Claude) — required for estimate analysis

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Claude API key from Anthropic console | `sk-ant-api03-...` |

---

## Stripe (payments)

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key (Dashboard → Developers → API keys) | `sk_live_...` or `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (Dashboard → Webhooks → Add endpoint → Signing secret) | `whsec_...` |

---

## Resend (email — sending domain: mail.nobletampa.com)

| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key | `re_...` |
| `RESEND_FROM_EMAIL` | From address (must use verified domain) | `estimates@mail.nobletampa.com` |
| `RESEND_WEBHOOK_SECRET` | From Resend after creating webhook (see WEBHOOKS.md) | `whsec_...` |

---

## Bloo.io (iMessage/RCS — v2 API)

| Variable | Description | Example |
|----------|-------------|---------|
| `BLOO_API_KEY` | Bloo.io API key | `api_...` |
| `BLOO_FROM_NUMBER` | Sending number | `+14245145517` |
| `BLOO_WEBHOOK_SECRET` | From Bloo after creating webhook (see WEBHOOKS.md) | `whsec_...` or Bloo’s secret format |

---

## Cron / scheduled payments (optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `CRON_SECRET` | Secret for protecting `/api/payments/process-scheduled`; if unset, app uses `NEXTAUTH_SECRET` | optional |

## Bootstrap (optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `BOOTSTRAP_SECRET` | Optional; if set, used to authorize one-time `POST /api/bootstrap` (create default admin). If unset, `NEXTAUTH_SECRET` is used. | optional |

---

## Copy-paste list (names only)

```
DATABASE_URL
NEXTAUTH_URL
NEXTAUTH_SECRET
AUTH_PASSWORD_SALT
ANTHROPIC_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_WEBHOOK_SECRET
BLOO_API_KEY
BLOO_FROM_NUMBER
BLOO_WEBHOOK_SECRET
CRON_SECRET
BOOTSTRAP_SECRET
```

---

## Production values to use

- **NEXTAUTH_URL**: `https://my.nobletampa.com`
- **RESEND_FROM_EMAIL**: `estimates@mail.nobletampa.com`
- **BLOO_FROM_NUMBER**: `+14245145517` (or your Bloo number)
