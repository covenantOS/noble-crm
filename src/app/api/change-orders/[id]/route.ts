// PATCH /api/change-orders/[id] — Update status (e.g. APPROVED, DECLINED, COMPLETED)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import type { ChangeOrderStatus } from '@prisma/client';

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
    const body = await request.json() as { status?: string; customerApprovalMethod?: string; customerApprovalEvidence?: string };

    const validStatuses: ChangeOrderStatus[] = ['PROPOSED', 'CUSTOMER_NOTIFIED', 'APPROVED', 'DECLINED', 'COMPLETED'];
    const status = body.status && validStatuses.includes(body.status as ChangeOrderStatus) ? (body.status as ChangeOrderStatus) : undefined;

    const updateData: { status?: ChangeOrderStatus; customerApprovalMethod?: 'EMAIL' | 'TEXT' | 'IN_APP_SIGNATURE'; customerApprovalEvidence?: string; approvedAt?: Date; completedAt?: Date } = {};
    if (status) updateData.status = status;
    if (body.customerApprovalMethod) updateData.customerApprovalMethod = body.customerApprovalMethod as 'EMAIL' | 'TEXT' | 'IN_APP_SIGNATURE';
    if (body.customerApprovalEvidence != null) updateData.customerApprovalEvidence = body.customerApprovalEvidence;
    if (status === 'APPROVED') updateData.approvedAt = new Date();
    if (status === 'COMPLETED') updateData.completedAt = new Date();

    const order = await prisma.changeOrder.update({
      where: { id },
      data: updateData,
      include: { contract: { include: { payments: true, estimate: { include: { property: true } } } } },
    });

    // When approving a change order, create a Payment record for the additional amount
    if (status === 'APPROVED' && order.additionalPrice != null && order.additionalPrice > 0) {
      const existing = await prisma.payment.findFirst({
        where: { changeOrderId: order.id },
      });
      if (!existing) {
        await prisma.payment.create({
          data: {
            contractId: order.contractId,
            changeOrderId: order.id,
            type: 'CHANGE_ORDER',
            amount: order.additionalPrice,
            status: 'SCHEDULED',
          },
        });
      }
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error('Update change order error:', error);
    return NextResponse.json({ error: 'Failed to update change order' }, { status: 500 });
  }
}
