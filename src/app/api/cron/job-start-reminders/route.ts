// POST /api/cron/job-start-reminders — Send "day before job starts" to customers (call from cron)
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendEmail } from '@/lib/resend';
import { sendMessage as sendBloo } from '@/lib/bloo';

const CRON_SECRET = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const contracts = await prisma.contract.findMany({
    where: {
      status: { in: ['ACTIVE', 'SIGNED'] },
      scheduledStartDate: { gte: tomorrow, lte: tomorrowEnd },
    },
    include: {
      customer: true,
      estimate: { include: { property: true } },
    },
  });

  const results: { contractId: string; email?: boolean; iMessage?: boolean; error?: string }[] = [];

  const msg = 'Hey {{firstName}}, quick heads up — our crew will be at {{address}} tomorrow morning. If you can make sure cars are out of the driveway and any patio furniture is pulled back from the walls, that would be awesome. We\'ll take great care of everything.';

  for (const c of contracts) {
    const firstName = c.customer.firstName || 'there';
    const address = c.estimate.property.address;
    const text = msg.replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{address\}\}/g, address);
    const result: { contractId: string; email?: boolean; iMessage?: boolean; error?: string } = { contractId: c.id };

    try {
      if (c.customer.email) {
        await sendEmail({
          to: c.customer.email,
          subject: `Job starting tomorrow — ${address}`,
          html: `<p>${text.replace(/\n/g, '<br>')}</p>`,
        });
        result.email = true;
      }
      if (c.customer.phone) {
        await sendBloo(c.customer.phone, text);
        result.iMessage = true;
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : 'Send failed';
    }
    results.push(result);
  }

  return NextResponse.json({ sent: results.length, results });
}
