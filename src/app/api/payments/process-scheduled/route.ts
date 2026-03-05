import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { chargePaymentMethod } from '@/lib/stripe';
import { sendEmail } from '@/lib/resend';
import { sendMessage as sendBloo } from '@/lib/bloo';
import { renderTemplate } from '@/lib/bloo';

const CRON_SECRET = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const duePayments = await prisma.payment.findMany({
    where: {
      status: 'SCHEDULED',
      dueDate: { lte: in48h },
      contract: {
        stripeCustomerId: { not: null },
        stripePaymentMethodId: { not: null },
        status: 'ACTIVE',
      },
    },
    include: {
      contract: {
        include: {
          customer: true,
          estimate: { include: { property: true } },
        },
      },
    },
  });

  const results: { paymentId: string; action: string; success: boolean; error?: string }[] = [];

  for (const payment of duePayments) {
    const contract = payment.contract;
    if (!contract.stripeCustomerId || !contract.stripePaymentMethodId) continue;

    const due = payment.dueDate ? new Date(payment.dueDate) : null;
    const msUntilDue = due ? due.getTime() - now.getTime() : 0;

    if (msUntilDue > 0 && msUntilDue <= 48 * 60 * 60 * 1000) {
      const sentReminder = await prisma.paymentReminder.findFirst({
        where: { paymentId: payment.id, type: 'UPCOMING' },
      });
      if (!sentReminder) {
        try {
          const companyPhone = (await prisma.companySettings.findUnique({ where: { key: 'companyPhone' } }))?.value || '(813) 555-0123';
          const msg = renderTemplate(
            'Hey {{firstName}}, heads up — your scheduled payment of ${{amount}} for {{address}} will be charged to your card on file on {{date}}. If you need to update your payment method, reply or call us.',
            {
              firstName: contract.customer.firstName,
              amount: String(payment.amount),
              address: contract.estimate.property.address,
              date: due ? due.toLocaleDateString('en-US') : '',
            }
          );
          if (contract.customer.phone) await sendBloo(contract.customer.phone, msg);
          if (contract.customer.email) {
            await sendEmail({
              to: contract.customer.email,
              subject: `Upcoming payment — ${contract.estimate.property.address}`,
              html: `<p>${msg.replace(/\n/g, '<br>')}</p>`,
            });
          }
          await prisma.paymentReminder.create({
            data: { paymentId: payment.id, type: 'UPCOMING', channel: 'EMAIL' },
          });
          results.push({ paymentId: payment.id, action: '48h_reminder', success: true });
        } catch (e) {
          results.push({ paymentId: payment.id, action: '48h_reminder', success: false, error: String(e) });
        }
      }
      continue;
    }

    if (msUntilDue > 0) continue;

    try {
      await chargePaymentMethod(
        contract.stripeCustomerId,
        contract.stripePaymentMethodId,
        payment.amount,
        contract.id,
        payment.type as 'MIDPOINT' | 'COMPLETION',
        contract.estimate.property.address
      );
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', paidAt: new Date() },
      });
      const msg = renderTemplate(
        'Hey {{firstName}}, payment of ${{amount}} received for {{address}}. Thanks!',
        {
          firstName: contract.customer.firstName,
          amount: String(payment.amount),
          address: contract.estimate.property.address,
        }
      );
      if (contract.customer.phone) await sendBloo(contract.customer.phone, msg);
      if (contract.customer.email) {
        await sendEmail({
          to: contract.customer.email,
          subject: `Payment received — ${contract.estimate.property.address}`,
          html: `<p>${msg}</p>`,
        });
      }
      results.push({ paymentId: payment.id, action: 'charge', success: true });
    } catch (e) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      const companyPhone = (await prisma.companySettings.findUnique({ where: { key: 'companyPhone' } }))?.value || '(813) 555-0123';
      const failMsg = `We tried to process your scheduled payment of $${payment.amount} for ${contract.estimate.property.address} but it didn't go through. Please call us at ${companyPhone} or reply to update your payment method.`;
      if (contract.customer.phone) await sendBloo(contract.customer.phone, failMsg);
      if (contract.customer.email) {
        await sendEmail({
          to: contract.customer.email,
          subject: `Payment failed — ${contract.estimate.property.address}`,
          html: `<p>${failMsg}</p>`,
        });
      }
      results.push({ paymentId: payment.id, action: 'charge', success: false, error: String(e) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
