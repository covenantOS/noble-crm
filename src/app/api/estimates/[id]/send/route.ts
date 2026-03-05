// POST /api/estimates/[id]/send — Send estimate to customer (email + iMessage), set status to SENT
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { sendEmail, buildEstimateSentEmail } from '@/lib/resend';
import { sendMessage as sendBloo } from '@/lib/bloo';

const BASE_URL = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

function substituteTemplate(content: string, vars: Record<string, string>): string {
  let out = content;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), value ?? '');
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

    const { id } = await params;
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: { customer: true, property: true },
    });

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    if (estimate.status === 'SENT' || estimate.status === 'VIEWED' || estimate.status === 'APPROVED' || estimate.status === 'DECLINED') {
      return NextResponse.json({ error: 'Estimate already sent or beyond' }, { status: 400 });
    }

    // Ensure view token
    let viewToken = estimate.viewToken;
    if (!viewToken) {
      viewToken = randomBytes(18).toString('base64url');
      await prisma.estimate.update({
        where: { id },
        data: { viewToken },
      });
    }

    const estimateLink = `${BASE_URL.replace(/\/$/, '')}/view/${estimate.id}/${viewToken}`;
    const estimateTotal = estimate.basePrice != null
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(estimate.basePrice)
      : '—';

    const companyRows = await prisma.companySettings.findMany({
      where: { key: { in: ['company_phone', 'company_name'] } },
    });
    const companyPhone = companyRows.find((r: { key: string; value: string }) => r.key === 'company_phone')?.value ?? '(813) 555-0123';

    const customerFirstName = estimate.customer.firstName || 'there';
    const propertyAddress = estimate.property.address;

    const vars: Record<string, string> = {
      customerFirstName,
      propertyAddress,
      estimateTotal,
      estimateLink,
      companyPhone,
    };

    const errors: string[] = [];

    // Email
    if (estimate.customer.email) {
      try {
        const html = buildEstimateSentEmail(customerFirstName, propertyAddress, estimateTotal, estimateLink);
        const subject = `Your Painting Estimate for ${propertyAddress} — Westchase Painting Company`;
        await sendEmail({
          to: estimate.customer.email,
          subject,
          html,
        });
        await prisma.message.create({
          data: {
            customerId: estimate.customerId,
            estimateId: estimate.id,
            direction: 'OUTBOUND',
            channel: 'EMAIL',
            content: subject,
            status: 'SENT',
            sentAt: new Date(),
          },
        });
      } catch (e) {
        errors.push(`Email: ${e instanceof Error ? e.message : 'Send failed'}`);
      }
    }

    // iMessage
    if (estimate.customer.phone) {
      try {
        const imessageText = substituteTemplate(
          'Hey {{customerFirstName}}, this is Will from Westchase Painting Company. I just sent over your estimate for {{propertyAddress}} to your email. Take a look when you get a chance and let me know if you have any questions. Talk soon!',
          vars
        );
        const result = await sendBloo(estimate.customer.phone, imessageText);
        await prisma.message.create({
          data: {
            customerId: estimate.customerId,
            estimateId: estimate.id,
            direction: 'OUTBOUND',
            channel: 'IMESSAGE',
            content: imessageText,
            status: 'SENT',
            sentAt: new Date(),
            blooMessageId: result.message_id ?? (result as { message_ids?: string[] }).message_ids?.[0],
          },
        });
      } catch (e) {
        errors.push(`iMessage: ${e instanceof Error ? e.message : 'Send failed'}`);
      }
    }

    if (!estimate.customer.email && !estimate.customer.phone) {
      return NextResponse.json({ error: 'Customer has no email or phone' }, { status: 400 });
    }

    await prisma.estimate.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      message: 'Estimate sent to customer.',
      email: !!estimate.customer.email,
      iMessage: !!estimate.customer.phone,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Send estimate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send' },
      { status: 500 }
    );
  }
}
