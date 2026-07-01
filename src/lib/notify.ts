// Notification provider abstraction (email + SMS), GATED on env keys.
//
// The core honesty rule of this module: if the relevant provider key is NOT
// configured, we DO NOT pretend to send. sendEmail/sendSms return
// { sent:false, reason:"no provider configured" } and log a line so the caller
// can surface an honest "delivery wasn't sent" state. Only when the key is
// present do we make the real provider HTTP call.
//
// LIVE vs GATED:
//   - The abstraction + the honest no-op path are LIVE now.
//   - Actual email delivery is GATED on RESEND_API_KEY (+ RESEND_FROM). The
//     Resend send is a real fetch() against their API -- it just doesn't run
//     without the key.
//   - Actual SMS delivery is GATED on TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
//     (+ TWILIO_FROM). Real Twilio Messages API fetch(), same gating.

import type { Env } from "./types";

export interface NotifyResult {
  sent: boolean;
  // Present when sent === false: why nothing was delivered (e.g. "no provider
  // configured", "no recipient", or the provider's error text).
  reason?: string;
  // Provider message id when sent === true (Resend/Twilio id), for logging.
  id?: string;
}

const NO_PROVIDER: NotifyResult = { sent: false, reason: "no provider configured" };

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  // Optional plain-text fallback; Resend accepts either/both.
  text?: string;
}

// Sends an email via Resend when RESEND_API_KEY + RESEND_FROM are set.
// Returns the honest no-op result when the key is absent or there's no
// recipient. Never throws -- a provider failure is caught and returned as
// { sent:false, reason } so a send/reminder flow is never blocked by it.
export async function sendEmail(env: Env, args: SendEmailArgs): Promise<NotifyResult> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    console.log(`[notify] sendEmail skipped (no RESEND key configured) -> to=${args.to} subject="${args.subject}"`);
    return NO_PROVIDER;
  }
  if (!args.to || !args.to.trim()) {
    console.log(`[notify] sendEmail skipped (no recipient) subject="${args.subject}"`);
    return { sent: false, reason: "no recipient" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        ...(args.text ? { text: args.text } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[notify] Resend send failed (${res.status}): ${body}`);
      return { sent: false, reason: `email provider error (${res.status})` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    console.log(`[notify] email sent to=${args.to} id=${data.id || "?"}`);
    return { sent: true, id: data.id };
  } catch (err) {
    console.error("[notify] Resend send threw:", err);
    return { sent: false, reason: "email provider error" };
  }
}

export interface SendSmsArgs {
  to: string;
  body: string;
}

// Sends an SMS via Twilio when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN +
// TWILIO_FROM are set. Same honest-no-op-when-unconfigured contract as
// sendEmail. Never throws.
export async function sendSms(env: Env, args: SendSmsArgs): Promise<NotifyResult> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
    console.log(`[notify] sendSms skipped (no TWILIO creds configured) -> to=${args.to}`);
    return NO_PROVIDER;
  }
  if (!args.to || !args.to.trim()) {
    return { sent: false, reason: "no recipient" };
  }
  try {
    // Twilio's Messages API is form-encoded and uses HTTP basic auth
    // (accountSid:authToken). btoa is available in the Workers runtime.
    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const form = new URLSearchParams({ To: args.to, From: env.TWILIO_FROM, Body: args.body });
    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[notify] Twilio send failed (${res.status}): ${body}`);
      return { sent: false, reason: `sms provider error (${res.status})` };
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    console.log(`[notify] sms sent to=${args.to} sid=${data.sid || "?"}`);
    return { sent: true, id: data.sid };
  } catch (err) {
    console.error("[notify] Twilio send threw:", err);
    return { sent: false, reason: "sms provider error" };
  }
}

// Small helper: escape a string for safe interpolation into notification HTML.
export function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
