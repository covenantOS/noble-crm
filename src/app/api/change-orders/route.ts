// GET /api/change-orders?contractId= — List change orders (by contract)
// POST /api/change-orders — Create change order
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

    const contractId = request.nextUrl.searchParams.get('contractId');
    if (!contractId) {
      return NextResponse.json({ error: 'contractId required' }, { status: 400 });
    }

    const orders = await prisma.changeOrder.findMany({
      where: { contractId },
      orderBy: { proposedAt: 'desc' },
      include: { contract: { include: { estimate: { include: { property: true } } } } },
    });

    return NextResponse.json(orders);
  } catch (error) {
    console.error('List change orders error:', error);
    return NextResponse.json({ error: 'Failed to list change orders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as {
      contractId: string;
      description: string;
      reason?: string;
      additionalMaterialCost?: number;
      additionalLaborCost?: number;
      additionalSurfaces?: unknown;
    };

    const { contractId, description, reason, additionalMaterialCost = 0, additionalLaborCost = 0, additionalSurfaces } = body;
    if (!contractId || !description) {
      return NextResponse.json({ error: 'contractId and description required' }, { status: 400 });
    }

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: { estimate: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const configRows = await prisma.pricingConfig.findMany({
      where: { key: 'change_order_markup_percent' },
    });
    const markupPct = configRows[0] ? parseFloat(configRows[0].value) : 15;
    const subtotal = additionalMaterialCost + additionalLaborCost;
    const additionalPrice = Math.round(subtotal * (1 + markupPct / 100) * 100) / 100;

    const changeOrder = await prisma.changeOrder.create({
      data: {
        contractId,
        description,
        reason: reason ?? null,
        additionalSurfaces: additionalSurfaces ? JSON.parse(JSON.stringify(additionalSurfaces)) : null,
        additionalMaterialCost,
        additionalLaborCost,
        markupPercent: markupPct,
        additionalPrice,
        status: 'PROPOSED',
      },
      include: { contract: { include: { estimate: { include: { property: true } } } } },
    });

    return NextResponse.json(changeOrder);
  } catch (error) {
    console.error('Create change order error:', error);
    return NextResponse.json({ error: 'Failed to create change order' }, { status: 500 });
  }
}
