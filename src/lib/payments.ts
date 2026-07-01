// Stripe online-payment scaffold, GATED on STRIPE_SECRET_KEY.
//
// Honesty rule (same spirit as notify.ts): with NO Stripe key configured we
// return { configured:false } and make ZERO network calls -- we do not fake a
// checkout URL or a payment. Only when env.STRIPE_SECRET_KEY is present do we
// make the real Stripe Checkout Session API call via fetch().
//
// LIVE vs GATED:
//   - The structure (createInvoiceCheckout + verifyStripeWebhook below) is
//     LIVE now.
//   - The actual Stripe API call is GATED on STRIPE_SECRET_KEY.
//   - Webhook signature verification is GATED on STRIPE_WEBHOOK_SECRET.
//
// No Stripe SDK is used (it isn't Workers-friendly); everything is a direct
// fetch() against the Stripe REST API, which runs fine on the Workers runtime.

import type { Env } from "./types";

export interface CheckoutResult {
  // false when STRIPE_SECRET_KEY isn't set -- the caller returns a clean
  // "online payments not configured" 501, never a 500.
  configured: boolean;
  // Present only when configured && the session was created successfully.
  url?: string;
  // Present when configured but the Stripe call failed.
  error?: string;
}

// Minimal shape createInvoiceCheckout needs about the invoice being paid.
export interface CheckoutInvoice {
  id: number;
  identifier: string;
  total: number;
  brandName?: string | null;
}

// Creates a Stripe Checkout Session for an invoice's total and returns the
// hosted checkout URL. Amount is the invoice's tier total (the plain invoice
// total here -- surcharge tiers are applied at record-payment time for manual
// methods; card checkout charges the straight total so the customer isn't
// double-charged a card surcharge they didn't opt into). Returns
// { configured:false } with no network call when the key is absent.
export async function createInvoiceCheckout(
  env: Env,
  invoice: CheckoutInvoice,
  baseUrl: string,
): Promise<CheckoutResult> {
  if (!env.STRIPE_SECRET_KEY) {
    return { configured: false };
  }
  try {
    // Stripe amounts are in the smallest currency unit (cents). Round to avoid
    // float dust producing a non-integer cents value Stripe rejects.
    const amountCents = Math.round((invoice.total || 0) * 100);
    const productName = `${invoice.brandName || "Noble Tampa"} — Invoice ${invoice.identifier}`;

    // Public thank-you / cancel URLs. These are real Worker routes (see
    // /pay/success and /pay/cancel in src/server/index.ts) so the customer
    // lands on a branded page rather than a dead link.
    const successUrl = `${baseUrl}/pay/success?invoice=${invoice.id}`;
    const cancelUrl = `${baseUrl}/pay/cancel?invoice=${invoice.id}`;

    // Checkout Sessions are created with form-encoded params (Stripe's REST
    // API is form-encoded, including its bracketed nested keys).
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", String(invoice.id));
    // Stash the invoice id in metadata so the webhook can record the payment
    // against the right invoice on checkout.session.completed.
    form.set("metadata[invoice_id]", String(invoice.id));
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(amountCents));
    form.set("line_items[0][price_data][product_data][name]", productName);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[payments] Stripe checkout session failed (${res.status}): ${body}`);
      return { configured: true, error: `Stripe error (${res.status})` };
    }
    const data = (await res.json()) as { url?: string };
    if (!data.url) {
      return { configured: true, error: "Stripe returned no checkout URL" };
    }
    return { configured: true, url: data.url };
  } catch (err) {
    console.error("[payments] createInvoiceCheckout threw:", err);
    return { configured: true, error: "Stripe request failed" };
  }
}

export interface WebhookVerifyResult {
  valid: boolean;
  // The parsed event object when valid.
  event?: StripeEvent;
  reason?: string;
}

// The slice of a Stripe event we care about.
export interface StripeEvent {
  type: string;
  data: {
    object: {
      id?: string;
      payment_intent?: string;
      amount_total?: number;
      metadata?: Record<string, string>;
      client_reference_id?: string;
    };
  };
}

// Verifies a Stripe webhook signature (the "Stripe-Signature" header) against
// STRIPE_WEBHOOK_SECRET using the documented HMAC-SHA256 scheme, implemented
// with WebCrypto (available on Workers) since the Stripe SDK's verifier isn't
// usable here. Returns { valid:false } when the secret isn't configured (the
// webhook route then returns a clean "not configured" response instead of
// trusting an unverified payload).
export async function verifyStripeWebhook(
  env: Env,
  payload: string,
  signatureHeader: string | null,
): Promise<WebhookVerifyResult> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return { valid: false, reason: "webhook secret not configured" };
  }
  if (!signatureHeader) {
    return { valid: false, reason: "missing signature header" };
  }
  try {
    // Header format: "t=timestamp,v1=signature[,v1=signature...]".
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((kv) => {
        const [k, v] = kv.split("=");
        return [k.trim(), v];
      }),
    ) as { t?: string; v1?: string };
    if (!parts.t || !parts.v1) {
      return { valid: false, reason: "malformed signature header" };
    }

    const signedPayload = `${parts.t}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
    const expected = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

    // Constant-time-ish comparison (length + char compare) against the header's
    // v1 signature.
    if (expected.length !== parts.v1.length) {
      return { valid: false, reason: "signature mismatch" };
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
    }
    if (diff !== 0) {
      return { valid: false, reason: "signature mismatch" };
    }

    const event = JSON.parse(payload) as StripeEvent;
    return { valid: true, event };
  } catch (err) {
    console.error("[payments] verifyStripeWebhook threw:", err);
    return { valid: false, reason: "verification error" };
  }
}
