import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        properties: true,
        estimates: {
          orderBy: { createdAt: 'desc' },
          include: {
            property: { select: { address: true } },
          },
        },
        contracts: {
          orderBy: { createdAt: 'desc' },
          include: {
            payments: true,
            estimate: { select: { property: { select: { address: true } } } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const payments = customer.contracts.flatMap((c: { payments: unknown[]; estimate: { property: { address: string } }; id: string }) =>
      (c.payments as { id: string; type: string; amount: number; status: string; paidAt: Date | null; dueDate: Date | null; contractId: string }[]).map((p) => ({
        ...p,
        contractId: c.id,
        propertyAddress: c.estimate?.property?.address,
      }))
    );
    const totalRevenue = payments
      .filter((p: { status: string }) => p.status === 'COMPLETED')
      .reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
    const dates: Date[] = [];
    if (customer.messages[0]?.createdAt) dates.push(customer.messages[0].createdAt);
    payments.forEach((p: { paidAt: Date | null }) => { if (p.paidAt) dates.push(p.paidAt); });
    customer.contracts.forEach((c: { signedAt: Date | null }) => { if (c.signedAt) dates.push(c.signedAt); });
    customer.estimates.forEach((e: { createdAt: Date }) => dates.push(e.createdAt));
    const lastActivity = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null;

    return NextResponse.json({
      ...customer,
      payments,
      totalRevenue,
      lastActivity,
    });
  } catch (error) {
    console.error('Customer detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 });
  }
}
