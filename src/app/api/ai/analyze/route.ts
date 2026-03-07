import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { analyzeEstimate } from '@/lib/ai';
import { calculateFullPricing } from '@/lib/pricing';
import type { LineItem, SurfaceMeasurement } from '@/lib/pricing';

export async function POST(request: NextRequest) {
  let estimateId: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { estimateId?: string; photos?: Array<{ base64: string; mediaType: string; location?: string; notes?: string }> };
    estimateId = body.estimateId;
    const photos = body.photos ?? [];

    if (!estimateId) {
      return NextResponse.json({ error: 'estimateId required' }, { status: 400 });
    }

    const estimate = await prisma.estimate.findUnique({
      where: { id: estimateId },
      include: {
        customer: true,
        property: true,
        surfaces: true,
        measurements: true,
      },
    });

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    const configRows = await prisma.pricingConfig.findMany();
    const pricingConfig = configRows.reduce<Record<string, string>>(
      (acc: Record<string, string>, r: { key: string; value: string }) => {
        acc[r.key] = r.value;
        return acc;
      },
      {}
    );

    const surfaceByType = estimate.surfaces.reduce<Record<string, { condition: string }>>(
      (acc: Record<string, { condition: string }>, s: { surfaceType: string; condition: string }) => {
        acc[s.surfaceType] = { condition: s.condition };
        return acc;
      },
      {}
    );

    const measurementsForPricing: SurfaceMeasurement[] = estimate.measurements.map((m: { surface: string; description: string | null; linearFeet: number | null; height: number | null; grossArea: number | null; windowDeduction: number | null; doorDeduction: number | null; netPaintableArea: number | null; coatsRequired: number | null }) => ({
      surfaceType: m.surface,
      description: m.description ?? undefined,
      linearFeet: m.linearFeet ?? undefined,
      height: m.height ?? undefined,
      grossArea: m.grossArea ?? undefined,
      windowDeduction: m.windowDeduction ?? undefined,
      doorDeduction: m.doorDeduction ?? undefined,
      netPaintableArea: m.netPaintableArea ?? undefined,
      coatsRequired: m.coatsRequired ?? 2,
      condition: surfaceByType[m.surface]?.condition as 'GOOD' | 'FAIR' | 'POOR' | undefined,
    }));

    const input = {
      property: {
        address: estimate.property.address,
        city: estimate.property.city,
        state: estimate.property.state,
        squareFootageInterior: estimate.property.squareFootageInterior ?? undefined,
        stories: estimate.property.stories ?? undefined,
        constructionType: estimate.property.constructionType,
        yearBuilt: estimate.property.yearBuilt ?? undefined,
      },
      scopeType: estimate.scopeType,
      surfaces: estimate.surfaces.map((s: { surfaceType: string; description: string | null; condition: string; notes: string | null }) => ({
        surfaceType: s.surfaceType,
        description: s.description ?? undefined,
        condition: s.condition,
        notes: s.notes ?? undefined,
      })),
      measurements: estimate.measurements.map((m: { surface: string; description: string | null; linearFeet: number | null; height: number | null; grossArea: number | null; windowDeduction: number | null; doorDeduction: number | null; netPaintableArea: number | null; coatsRequired: number | null; notes: string | null }) => ({
        surface: m.surface,
        description: m.description ?? undefined,
        linearFeet: m.linearFeet ?? undefined,
        height: m.height ?? undefined,
        grossArea: m.grossArea ?? undefined,
        windowDeduction: m.windowDeduction ?? 0,
        doorDeduction: m.doorDeduction ?? 0,
        netPaintableArea: m.netPaintableArea ?? undefined,
        coatsRequired: m.coatsRequired ?? 2,
        notes: m.notes ?? undefined,
      })),
      notes: estimate.humanNotes ?? '',
      pricingConfig,
      photos: photos.length > 0 ? photos : undefined,
    };

    await prisma.estimate.update({
      where: { id: estimateId },
      data: { status: 'AI_PROCESSING' },
    });

    const aiResult = await analyzeEstimate(input);

    const summary = aiResult.summary;
    const pricingSummary = calculateFullPricing(measurementsForPricing, pricingConfig, {
      totalMaterialCost: summary.totalMaterialCost,
      totalLaborCost: summary.totalLaborCost,
      lineItems: aiResult.lineItems as LineItem[],
    });

    const timelineStr = aiResult.timeline
      ? `Estimated ${aiResult.timeline.estimatedDays} days. ${aiResult.timeline.weatherNote || ''} ${aiResult.timeline.recommendedStartWindow || ''}`.trim()
      : null;

    await prisma.$transaction([
      prisma.estimateLineItem.deleteMany({ where: { estimateId } }),
      prisma.estimate.update({
        where: { id: estimateId },
        data: {
          status: 'REVIEW',
          basePrice: pricingSummary.basePrice,
          upfrontCashPrice: pricingSummary.tiers.upfrontCashPrice,
          upfrontCardPrice: pricingSummary.tiers.upfrontCardPrice,
          financePrice: pricingSummary.tiers.financePrice,
          paymentPlanPrice: pricingSummary.tiers.paymentPlanPrice,
          scopeOfWork: aiResult.scopeOfWork,
          timeline: timelineStr,
          aiAnalysis: JSON.parse(JSON.stringify(aiResult)),
        },
      }),
    ]);

    const eid = estimateId as string;
    await prisma.estimateLineItem.createMany({
      data: aiResult.lineItems.map((item, i) => ({
        estimateId: eid,
        category: item.category as 'PREP' | 'PAINT' | 'PRIMER' | 'TRIM' | 'DETAIL' | 'REPAIR' | 'MATERIAL' | 'OTHER',
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: item.unitCost,
        totalCost: item.totalCost,
        sortOrder: i,
      })),
    });

    // Save photos so customer view and estimate detail show them
    await prisma.estimatePhoto.deleteMany({ where: { estimateId: eid } });
    if (photos.length > 0) {
      const photoAnalysis = Array.isArray(aiResult.photoAnalysis) ? aiResult.photoAnalysis as Array<{ photoIndex: number; findings?: string; recommendation?: string }> : [];
      const photoRows = photos
        .map((p, i) => {
          if (!p.base64) return null;
          const dataUrl = `data:${p.mediaType || 'image/jpeg'};base64,${p.base64}`;
          const analysis = photoAnalysis.find((pa) => pa.photoIndex === i);
          return {
            estimateId: eid,
            url: dataUrl,
            caption: p.notes || null,
            location: p.location || null,
            aiAnalysis: (() => {
              if (!analysis) return null;
              const parts = [analysis.findings || '', analysis.recommendation ? ' Recommendation: ' + analysis.recommendation : ''];
              const s = parts.join('').trim();
              return s || null;
            })(),
            showToCustomer: true,
            sortOrder: i,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (photoRows.length > 0) {
        await prisma.estimatePhoto.createMany({ data: photoRows });
      }
    }

    const updated = await prisma.estimate.findUnique({
      where: { id: eid },
      include: { lineItems: true, customer: true, property: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('AI analyze error:', error);
    if (estimateId) {
      await prisma.estimate.updateMany({
        where: { id: estimateId },
        data: { status: 'DRAFT' },
      }).catch(() => {});
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
