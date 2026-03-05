// POST /api/contracts/[id]/charge-payment — Admin triggers midpoint or completion charge (payment plan)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { chargePaymentMethod } from '@/lib/stripe';
import { sendEmail } from '@/lib/resend';
import { sendMessage as sendBloo } from '@/lib/bloo';

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'gi'), v ?? '');
  }
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: contractId } = await params;
    const body = await request.json().catch(() => ({})) as { paymentType?: string };
    const paymentType = body.paymentType === 'MIDPOINT' ? 'MIDPOINT' : body.paymentType === 'COMPLETION' ? 'COMPLETION' : null;
    if (!paymentType) {
      return NextResponse.json({ error: 'paymentType must be MIDPOINT or COMPLETION' }, { status: 400 });
    }

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: true,
        estimate: { include: { property: true } },
        payments: true,
      },
    });

    if (!contract || !contract.stripeCustomerId || !contract.stripePaymentMethodId) {
      return NextResponse.json({ error: 'Contract not found or has no saved payment method' }, { status: 404 });
    }

    const payment = contract.payments.find((p: { type: string; status: string }) => p.type === paymentType && p.status === 'SCHEDULED');
    if (!payment) {
      return NextResponse.json({ error: `No scheduled ${paymentType.toLowerCase()} payment found` }, { status: 400 });
    }

    await chargePaymentMethod(
      contract.stripeCustomerId,
      contract.stripePaymentMethodId,
      payment.amount,
      contract.id,
      paymentType,
      contract.estimate.property.address
    );

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'COMPLETED', paidAt: new Date() },
    });

    if (paymentType === 'COMPLETION') {
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      // Review request (spec: "Review request sent via iMessage 24 hours after job completion")
      const companyRows = await prisma.companySettings.findMany({
        where: { key: { in: ['google_review_link', 'company_phone'] } },
      });
      const googleReviewLink = companyRows.find((r) => r.key === 'google_review_link')?.value || 'https://g.page/r/your-google-business/review';
      const reviewMsg = renderTemplate(
        'Hey {{firstName}}, your home looks amazing! We wrapped up at {{address}} and everything turned out great. Would you mind leaving us a quick Google review? It helps us a ton: {{googleReviewLink}}. Thanks for choosing Westchase Painting Company!',
        {
          firstName: contract.customer.firstName,
          address: contract.estimate.property.address,
          googleReviewLink,
        }
      );
      if (contract.customer.phone) {
        try { await sendBloo(contract.customer.phone, reviewMsg); } catch (_) {}
      }
      if (contract.customer.email) {
        try {
          await sendEmail({
            to: contract.customer.email,
            subject: `Thanks! — Review request for ${contract.estimate.property.address}`,
            html: `<p>${reviewMsg.replace(/\n/g, '<br>')}</p><p><a href="${googleReviewLink}">Leave a Google review</a></p>`,
          });
        } catch (_) {}
      }
    }

    const msg = renderTemplate(
      'Hey {{firstName}}, payment of ${{amount}} received for {{address}}. Thanks!',
      {
        firstName: contract.customer.firstName,
        amount: String(payment.amount),
        address: contract.estimate.property.address,
      }
    );
    if (contract.customer.phone) {
      try { await sendBloo(contract.customer.phone, msg); } catch (_) {}
    }
    if (contract.customer.email) {
      try {
        await sendEmail({
          to: contract.customer.email,
          subject: `Payment received — ${contract.estimate.property.address}`,
          html: `<p>${msg.replace(/\n/g, '<br>')}</p>`,
        });
      } catch (_) {}
    }

    return NextResponse.json({ ok: true, paymentId: payment.id, status: 'COMPLETED' });
  } catch (error) {
    console.error('Charge payment error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Charge failed' },
      { status: 500 }
    );
  }
}
