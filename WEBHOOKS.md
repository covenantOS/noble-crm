# Webhook setup — Resend & Bloo.io

Use these steps to register webhooks so the app receives email and iMessage delivery events.

---

## Resend (email events)

**Docs:** [Resend Webhooks](https://resend.com/docs/dashboard/webhooks/introduction)

### 1. Webhook URL

```
https://my.nobletampa.com/api/webhooks/resend
```

### 2. Create the webhook in Resend

1. Go to [Resend → Webhooks](https://resend.com/webhooks).
2. Click **Add Webhook**.
3. **Endpoint URL:** `https://my.nobletampa.com/api/webhooks/resend`
4. **Events:** Select the events you want (recommended):
   - `email.sent`
   - `email.delivered`
   - `email.bounced`
   - `email.complained` (optional)
5. Click **Create**. Resend will show the **Signing secret** once — copy it.

### 3. Add the signing secret in Vercel

1. Vercel → your project → **Settings** → **Environment Variables**.
2. Add:
   - **Name:** `RESEND_WEBHOOK_SECRET`
   - **Value:** the signing secret from Resend (starts with `whsec_` or similar).
   - **Environment:** Production (and Preview if you test there).
3. Redeploy so the new env var is available.

### 4. Verify

- Send a test email through the app (or from Resend dashboard).
- In Resend → Webhooks → your webhook → **Logs**, you should see successful (200) deliveries.
- The app responds with `200` and `{ "received": true }`. Signature verification runs when `RESEND_WEBHOOK_SECRET` is set (Svix).

### Optional: local testing

Use a tunnel (e.g. ngrok) and point Resend at `https://your-subdomain.ngrok.io/api/webhooks/resend`. Use the same signing secret in `.env` as `RESEND_WEBHOOK_SECRET`.

---

## Bloo.io (iMessage/RCS message events)

**Docs:** [Blooio Webhook events](https://docs.blooio.com/api-reference/webhook-events)

### 1. Webhook URL

```
https://my.nobletampa.com/api/webhooks/bloo
```

### 2. Create the webhook in Bloo

1. Log in to [Bloo.io](https://app.blooio.com/) and open **Webhooks** (or **Integrations** → Webhooks).
2. Click **Create Webhook** (or **Add Webhook**).
3. **URL:** `https://my.nobletampa.com/api/webhooks/bloo`
4. **Events:** **All** (or at least):
   - Message events: `message.sent`, `message.delivered`, `message.read`, `message.failed`
   - Optionally `message.received` for inbound messages.
5. Create the webhook. Bloo shows the **Signing secret** once — copy it.

### 3. Add the signing secret in Vercel

1. Vercel → your project → **Settings** → **Environment Variables**.
2. Add:
   - **Name:** `BLOO_WEBHOOK_SECRET`
   - **Value:** the signing secret from Bloo (from the webhook you just created).
   - **Environment:** Production (and Preview if needed).
3. Redeploy.

### 4. Verify

- Send a test iMessage through the app (or from Bloo).
- The app updates `Message` records by `blooMessageId` when it receives `message.sent`, `message.delivered`, `message.read`, or `message.failed`.
- Respond with `200` quickly so Bloo does not retry. Signature is verified with `BLOO_WEBHOOK_SECRET` (HMAC-SHA256).

### Optional: local testing

Use ngrok (or similar) and set the Bloo webhook URL to your tunnel. Put the same signing secret in `.env` as `BLOO_WEBHOOK_SECRET`.

---

## Summary

| Service   | Webhook URL                                      | Env var (signing secret)   |
|----------|---------------------------------------------------|----------------------------|
| Resend   | `https://my.nobletampa.com/api/webhooks/resend`   | `RESEND_WEBHOOK_SECRET`    |
| Bloo.io  | `https://my.nobletampa.com/api/webhooks/bloo`     | `BLOO_WEBHOOK_SECRET`      |

After adding the secrets in Vercel, redeploy so the routes can verify signatures in production.
