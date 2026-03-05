# Domain: my.nobletampa.com (Cloudflare + Vercel)

Get **my.nobletampa.com** live in two places: Vercel (add domain) and Cloudflare (point DNS).

---

## 1. Vercel — Add the domain

1. Open [Vercel Dashboard](https://vercel.com/dashboard) → your **Noble Estimator** project.
2. Go to **Settings** → **Domains**.
3. Click **Add** and enter: `my.nobletampa.com`
4. Vercel will show the DNS target, e.g.:
   - `cname.vercel-dns.com`, or
   - A project-specific host like `noble-estimator-xxx.vercel-dns.com`
5. Leave this tab open and copy the **target** value.

---

## 2. Cloudflare — Point DNS to Vercel

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → select the account that has **nobletampa.com**.
2. Open the zone **nobletampa.com** → **DNS** → **Records**.
3. **Add a CNAME record:**
   - **Type:** CNAME  
   - **Name:** `my` (full name will be `my.nobletampa.com`)  
   - **Target:** the value from Vercel (e.g. `cname.vercel-dns.com`)  
   - **Proxy status:** **DNS only** (grey cloud). Turn the orange cloud **off** so traffic goes straight to Vercel and SSL works.
4. Save.

---

## 3. Wait and confirm

- DNS can take a few minutes to propagate.
- In Vercel **Domains**, wait until `my.nobletampa.com` shows as **Valid** (Vercel will issue SSL).
- Ensure **NEXTAUTH_URL** in Vercel env vars is `https://my.nobletampa.com` and redeploy if you changed it.

---

## 4. Webhook URLs (already correct)

- **Bloo:** `https://my.nobletampa.com/api/webhooks/bloo`
- **Resend:** `https://my.nobletampa.com/api/webhooks/resend`
- **Stripe:** Add in Stripe Dashboard → Webhooks → `https://my.nobletampa.com/api/webhooks/stripe`

Once the domain is valid in Vercel and DNS is correct in Cloudflare, the site and webhooks will be live at **https://my.nobletampa.com**.
