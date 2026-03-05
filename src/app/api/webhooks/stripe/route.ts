import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import prisma from '@/lib/prisma';
import { getStripe } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !sig) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    console.error('Stripe webhook signature verification failed', e);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const contractId = session.metadata?.contractId;
        if (!contractId) break;

        const contract = await prisma.contract.findUnique({
          where: { id: contractId },
          include: { customer: true, estimate: { include: { property: true } } },
        });
        if (!contract) break;

        const paymentTier = session.metadata?.paymentTier;
        const stripeCustomerId = session.customer as string;

        let paymentMethodId: string | undefined;
        if (session.payment_intent) {
          const pi = await getStripe().paymentIntents.retrieve(session.payment_intent as string);
          paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
        }

        await prisma.contract.update({
          where: { id: contractId },
          data: {
            status: 'SIGNED',
            stripeCustomerId: stripeCustomerId || undefined,
            ...(paymentMethodId && { stripePaymentMethodId: paymentMethodId }),
          },
        });

        const amount = (session.amount_total ?? 0) / 100;
        await prisma.payment.create({
          data: {
            contractId,
            type: paymentTier === 'PAYMENT_PLAN' ? 'DEPOSIT' : 'FULL_UPFRONT',
            method: 'CARD_STRIPE',
            amount,
            status: 'COMPLETED',
            paidAt: new Date(),
            stripePaymentIntentId: session.payment_intent as string | undefined,
          },
        });

        if (paymentTier === 'PAYMENT_PLAN' && contract.depositAmount != null) {
          const base = new Date();
          const midpointDue = new Date(base);
          midpointDue.setDate(midpointDue.getDate() + 14);
          const completionDue = new Date(base);
          completionDue.setDate(completionDue.getDate() + 28);
          await prisma.payment.createMany({
            data: [
              { contractId, type: 'MIDPOINT', amount: contract.midpointAmount ?? 0, status: 'SCHEDULED', dueDate: midpointDue, scheduledDate: midpointDue },
              { contractId, type: 'COMPLETION', amount: contract.completionAmount ?? 0, status: 'SCHEDULED', dueDate: completionDue, scheduledDate: completionDue },
            ],
          });
        }

        await prisma.estimate.update({
          where: { id: contract.estimateId },
          data: { status: 'APPROVED', approvedAt: new Date() },
        });
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const contractId = pi.metadata?.contractId;
        const type = pi.metadata?.type as string | undefined;
        if (!contractId || !type) break;

        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'COMPLETED', paidAt: new Date() },
        });
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'FAILED', failedAt: new Date() },
        });
        break;
      }

      default:
        // Unhandled event type
        break;
    }
  } catch (e) {
    console.error('Stripe webhook handler error', e);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
