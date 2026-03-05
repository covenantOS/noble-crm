import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const search = request.nextUrl.searchParams.get('search') || '';
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '20', 10), 50);

    const customers = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : undefined,
      take: limit,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        _count: { select: { estimates: true } },
        contracts: {
          include: {
            payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
          },
        },
        estimates: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    });

    const list = customers.map((c) => {
      const totalRevenue = c.contracts.flatMap((ct) => ct.payments).reduce((sum, p) => sum + p.amount, 0);
      const dates: Date[] = [];
      c.contracts.forEach((ct) => { if (ct.signedAt) dates.push(ct.signedAt); });
      if (c.estimates[0]?.createdAt) dates.push(c.estimates[0].createdAt);
      if (c.messages[0]?.createdAt) dates.push(c.messages[0].createdAt);
      const lastActivity = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null;
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        estimateCount: c._count.estimates,
        totalRevenue,
        lastActivity,
      };
    });

    return NextResponse.json(list);
  } catch (error) {
    console.error('Customers list error:', error);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}
