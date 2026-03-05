// POST /api/estimates/send-reminders — Send 3-day reminder to customers who haven't viewed/approved (call from cron or manually)
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendEmail, buildEstimateReminderEmail } from '@/lib/resend';
import { sendMessage as sendBloo } from '@/lib/bloo';

const CRON_SECRET = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
const BASE_URL = process.env.NEXTAUTH_URL || '';

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const estimates = await prisma.estimate.findMany({
    where: {
      status: 'SENT',
      sentAt: { lte: threeDaysAgo },
      viewToken: { not: null },
    },
    include: {
      customer: true,
      property: true,
    },
  });

  const results: { estimateId: string; email?: boolean; iMessage?: boolean; error?: string }[] = [];

  for (const est of estimates) {
    const link = `${BASE_URL.replace(/\/$/, '')}/view/${est.id}/${est.viewToken}`;
    const firstName = est.customer.firstName || 'there';
    const address = est.property.address;
    const result: { estimateId: string; email?: boolean; iMessage?: boolean; error?: string } = { estimateId: est.id };

    try {
      if (est.customer.email) {
        await sendEmail({
          to: est.customer.email,
          subject: `Following up on your estimate — ${address}`,
          html: buildEstimateReminderEmail(firstName, address, link),
        });
        result.email = true;
      }
      if (est.customer.phone) {
        const text = `Hey ${firstName}, just checking in — did you get a chance to look at the estimate I sent over for ${address}? Happy to hop on a quick call if you have any questions. No rush.`;
        await sendBloo(est.customer.phone, text);
        result.iMessage = true;
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : 'Send failed';
    }
    results.push(result);
  }

  return NextResponse.json({ sent: results.length, results });
}
