// GET /api/contracts/[id] — Get contract with estimate, customer, payments
// PATCH /api/contracts/[id] — Update contract (scheduledStartDate, etc.)
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
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        estimate: { include: { property: true } },
        payments: true,
        changeOrders: true,
      },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }
    return NextResponse.json(contract);
  } catch (error) {
    console.error('Get contract error:', error);
    return NextResponse.json({ error: 'Failed to fetch contract' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { scheduledStartDate?: string | null; completedAt?: string | null };
    const data: { scheduledStartDate?: Date | null; completedAt?: Date | null } = {};
    if (body.scheduledStartDate !== undefined) {
      data.scheduledStartDate = body.scheduledStartDate ? new Date(body.scheduledStartDate) : null;
    }
    if (body.completedAt !== undefined) {
      data.completedAt = body.completedAt ? new Date(body.completedAt) : null;
    }
    const contract = await prisma.contract.update({
      where: { id },
      data,
      include: {
        customer: true,
        estimate: { include: { property: true } },
        payments: true,
      },
    });
    return NextResponse.json(contract);
  } catch (error) {
    console.error('Patch contract error:', error);
    return NextResponse.json({ error: 'Failed to update contract' }, { status: 500 });
  }
}
