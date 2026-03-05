// POST /api/estimates/[id]/duplicate — Clone estimate as new draft (same customer, property, scope, line items; new viewToken, no sent state)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

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
    const existing = await prisma.estimate.findUnique({
      where: { id },
      include: {
        lineItems: true,
        surfaces: true,
        measurements: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    const user = await prisma.user.findFirst();
    if (!user) {
      return NextResponse.json({ error: 'No admin user' }, { status: 400 });
    }

    const newEstimate = await prisma.estimate.create({
      data: {
        propertyId: existing.propertyId,
        customerId: existing.customerId,
        createdById: user.id,
        status: 'DRAFT',
        scopeType: existing.scopeType,
        basePrice: existing.basePrice,
        upfrontCashPrice: existing.upfrontCashPrice,
        upfrontCardPrice: existing.upfrontCardPrice,
        financePrice: existing.financePrice,
        paymentPlanPrice: existing.paymentPlanPrice,
        humanNotes: existing.humanNotes,
        scopeOfWork: existing.scopeOfWork,
        timeline: existing.timeline,
        warrantyTerms: existing.warrantyTerms,
      },
    });

    if (existing.lineItems.length > 0) {
      await prisma.estimateLineItem.createMany({
        data: existing.lineItems.map((item: { category: string; description: string; quantity: number; unit: string; unitCost: number; totalCost: number; sortOrder: number }) => ({
          estimateId: newEstimate.id,
          category: item.category as 'PREP' | 'PAINT' | 'PRIMER' | 'TRIM' | 'DETAIL' | 'REPAIR' | 'MATERIAL' | 'OTHER',
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitCost: item.unitCost,
          totalCost: item.totalCost,
          sortOrder: item.sortOrder,
        })),
      });
    }

    if (existing.surfaces.length > 0) {
      await prisma.estimateSurface.createMany({
        data: existing.surfaces.map((s: { surfaceType: string; description: string | null; condition: string; included: boolean; notes: string | null }) => ({
          estimateId: newEstimate.id,
          surfaceType: s.surfaceType as 'EXTERIOR_WALL' | 'INTERIOR_WALL' | 'CEILING' | 'TRIM' | 'FASCIA' | 'SOFFIT' | 'DOOR' | 'GARAGE_DOOR' | 'FENCE' | 'DECK' | 'CABINET' | 'SHUTTERS' | 'ACCENT_WALL' | 'OTHER',
          description: s.description,
          condition: (s.condition || 'GOOD') as 'GOOD' | 'FAIR' | 'POOR',
          included: s.included ?? true,
          notes: s.notes,
        })),
      });
    }

    if (existing.measurements.length > 0) {
      await prisma.estimateMeasurement.createMany({
        data: existing.measurements.map((m: { surface: string; description: string | null; linearFeet: number | null; height: number | null; grossArea: number | null; windowDeduction: number | null; doorDeduction: number | null; netPaintableArea: number | null; coatsRequired: number; notes: string | null }) => ({
          estimateId: newEstimate.id,
          surface: m.surface as 'EXTERIOR_WALL' | 'INTERIOR_WALL' | 'CEILING' | 'TRIM' | 'FASCIA' | 'SOFFIT' | 'DOOR' | 'GARAGE_DOOR' | 'FENCE' | 'DECK' | 'CABINET' | 'SHUTTERS' | 'ACCENT_WALL' | 'OTHER',
          description: m.description,
          linearFeet: m.linearFeet,
          height: m.height,
          grossArea: m.grossArea,
          windowDeduction: m.windowDeduction ?? 0,
          doorDeduction: m.doorDeduction ?? 0,
          netPaintableArea: m.netPaintableArea,
          coatsRequired: m.coatsRequired ?? 2,
          notes: m.notes,
        })),
      });
    }

    const full = await prisma.estimate.findUnique({
      where: { id: newEstimate.id },
      include: {
        customer: true,
        property: true,
        lineItems: true,
        surfaces: true,
        measurements: true,
      },
    });

    return NextResponse.json(full);
  } catch (error) {
    console.error('Duplicate estimate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Duplicate failed' },
      { status: 500 }
    );
  }
}
