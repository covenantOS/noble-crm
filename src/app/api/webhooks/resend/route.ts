import { NextRequest, NextResponse } from 'next/server';

/**
 * Resend webhook: receive email.sent, email.delivered, email.bounced, etc.
 * Register URL in Resend: https://my.nobletampa.com/api/webhooks/resend
 * Set RESEND_WEBHOOK_SECRET in Vercel (from Resend when you create the webhook).
 * Respond with 200 quickly so Resend does not retry.
 * See WEBHOOKS.md for full setup.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: { type?: string; data?: { email_id?: string } };
  try {
    payload = JSON.parse(rawBody) as { type?: string; data?: { email_id?: string } };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Optional: verify Svix signature if RESEND_WEBHOOK_SECRET is set
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const id = request.headers.get('svix-id');
    const timestamp = request.headers.get('svix-timestamp');
    const signature = request.headers.get('svix-signature');
    if (!id || !timestamp || !signature) {
      return NextResponse.json({ error: 'Missing Svix headers' }, { status: 401 });
    }
    try {
      const { Webhook } = await import('svix');
      const wh = new Webhook(secret);
      wh.verify(rawBody, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature });
    } catch (e) {
      console.error('Resend webhook signature verification failed', e);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const eventType = payload.type;
  if (eventType) {
    // Future: update Message by resendEmailId when we store it on send
    // e.g. email.delivered -> DELIVERED, email.bounced -> FAILED
    if (process.env.NODE_ENV === 'development') {
      console.log('[Resend webhook]', eventType, payload.data?.email_id);
    }
  }

  return NextResponse.json({ received: true });
}
