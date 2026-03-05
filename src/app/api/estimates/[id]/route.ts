import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/estimates/[id] — Get single estimate with all relations
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const estimate = await prisma.estimate.findUnique({
            where: { id },
            include: {
                customer: true,
                property: true,
                createdBy: { select: { name: true, email: true } },
                lineItems: { orderBy: { sortOrder: 'asc' } },
                photos: { orderBy: { sortOrder: 'asc' } },
                measurements: true,
                surfaces: true,
                contracts: {
                    include: {
                        payments: true,
                        changeOrders: true,
                    },
                },
            },
        });

        if (!estimate) {
            return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
        }

        return NextResponse.json(estimate);
    } catch (error) {
        console.error('Get estimate error:', error);
        return NextResponse.json({ error: 'Failed to fetch estimate' }, { status: 500 });
    }
}

// PUT /api/estimates/[id] — Update estimate
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();

        const estimate = await prisma.estimate.update({
            where: { id },
            data: {
                status: body.status,
                scopeType: body.scopeType,
                basePrice: body.basePrice,
                upfrontCashPrice: body.upfrontCashPrice,
                upfrontCardPrice: body.upfrontCardPrice,
                financePrice: body.financePrice,
                paymentPlanPrice: body.paymentPlanPrice,
                aiAnalysis: body.aiAnalysis,
                humanNotes: body.humanNotes,
                scopeOfWork: body.scopeOfWork,
                timeline: body.timeline,
                warrantyTerms: body.warrantyTerms,
                sentAt: body.status === 'SENT' ? new Date() : undefined,
                viewedAt: body.status === 'VIEWED' ? new Date() : undefined,
                approvedAt: body.status === 'APPROVED' ? new Date() : undefined,
            },
            include: {
                customer: true,
                property: true,
                lineItems: true,
                photos: true,
                measurements: true,
                surfaces: true,
            },
        });

        // Update line items if provided
        if (body.lineItems) {
            // Delete existing and recreate
            await prisma.estimateLineItem.deleteMany({ where: { estimateId: id } });
            await prisma.estimateLineItem.createMany({
                data: body.lineItems.map((item: { category: string; description: string; quantity: number; unit: string; unitCost: number; totalCost: number }, index: number) => ({
                    estimateId: id,
                    category: item.category,
                    description: item.description,
                    quantity: item.quantity,
                    unit: item.unit,
                    unitCost: item.unitCost,
                    totalCost: item.totalCost,
                    sortOrder: index,
                })),
            });
        }

        return NextResponse.json(estimate);
    } catch (error) {
        console.error('Update estimate error:', error);
        return NextResponse.json({ error: 'Failed to update estimate' }, { status: 500 });
    }
}

// DELETE /api/estimates/[id]
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        await prisma.estimate.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete estimate error:', error);
        return NextResponse.json({ error: 'Failed to delete estimate' }, { status: 500 });
    }
}
