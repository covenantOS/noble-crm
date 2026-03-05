import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createHmac } from 'crypto';

const SECRET = process.env.NEXTAUTH_SECRET || 'noble-customer-secret-change-in-production';
const COOKIE_NAME = 'noble_customer_session';

function verifyCookie(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const [customerId, sig] = cookie.split('.');
  if (!customerId || !sig) return null;
  const expected = createHmac('sha256', SECRET).update(customerId).digest('hex');
  if (sig !== expected) return null;
  return customerId;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const customerId = verifyCookie(token);
  if (!customerId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      estimates: {
        orderBy: { createdAt: 'desc' },
        include: { property: true },
      },
      contracts: {
        orderBy: { createdAt: 'desc' },
        include: { estimate: { include: { property: true } }, payments: true },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    estimates: customer.estimates,
    contracts: customer.contracts,
  });
}
