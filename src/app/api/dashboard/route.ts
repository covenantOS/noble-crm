import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Count estimates this month
        const estimatesThisMonth = await prisma.estimate.count({
            where: {
                createdAt: { gte: startOfMonth },
            },
        });

        // Count approved estimates this month for close rate
        const approvedThisMonth = await prisma.estimate.count({
            where: {
                createdAt: { gte: startOfMonth },
                status: 'APPROVED',
            },
        });

        const sentOrBeyond = await prisma.estimate.count({
            where: {
                createdAt: { gte: startOfMonth },
                status: { in: ['SENT', 'VIEWED', 'APPROVED', 'DECLINED', 'EXPIRED'] },
            },
        });

        const closeRate = sentOrBeyond > 0
            ? Math.round((approvedThisMonth / sentOrBeyond) * 100)
            : 0;

        // Revenue this month (sum of approved/paid contracts)
        const contracts = await prisma.contract.findMany({
            where: {
                createdAt: { gte: startOfMonth },
                status: { in: ['SIGNED', 'ACTIVE', 'COMPLETED'] },
            },
            select: { totalAmount: true },
        });

        const revenueThisMonth = contracts.reduce((sum: number, c: { totalAmount: number }) => sum + c.totalAmount, 0);
        const averageJobSize = contracts.length > 0
            ? Math.round(revenueThisMonth / contracts.length)
            : 0;

        // Recent estimates
        const recentEstimates = await prisma.estimate.findMany({
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: {
                customer: { select: { firstName: true, lastName: true } },
                property: { select: { address: true } },
            },
        });

        const formattedEstimates = recentEstimates.map((est: { id: string; customer: { firstName: string; lastName: string }; property: { address: string }; status: string; basePrice: number | null; createdAt: Date }) => ({
            id: est.id,
            customerName: `${est.customer.firstName} ${est.customer.lastName}`,
            propertyAddress: est.property.address,
            status: est.status,
            basePrice: est.basePrice,
            createdAt: est.createdAt.toISOString(),
        }));

        // Active estimates: in progress, sent, awaiting approval (DRAFT, AI_PROCESSING, REVIEW, SENT, VIEWED)
        const activeEstimatesCount = await prisma.estimate.count({
            where: { status: { in: ['DRAFT', 'AI_PROCESSING', 'REVIEW', 'SENT', 'VIEWED'] } },
        });

        // Recent activity: last 5 signed contracts + last 5 completed payments
        const [recentContracts, recentPayments] = await Promise.all([
            prisma.contract.findMany({
                where: { status: { in: ['SIGNED', 'ACTIVE', 'COMPLETED'] } },
                orderBy: { signedAt: 'desc' },
                take: 5,
                include: {
                    customer: { select: { firstName: true, lastName: true } },
                    estimate: { select: { property: { select: { address: true } } } },
                },
            }),
            prisma.payment.findMany({
                where: { status: 'COMPLETED' },
                orderBy: { paidAt: 'desc' },
                take: 5,
                include: {
                    contract: {
                        select: {
                            customer: { select: { firstName: true, lastName: true } },
                            estimate: { select: { property: { select: { address: true } } } },
                        },
                    },
                },
            }),
        ]);

        const recentActivity = [
            ...recentContracts.map((c: { id: string; signedAt: Date | null; customer: { firstName: string; lastName: string }; estimate: { property: { address: string } } }) => ({
                type: 'contract_signed',
                id: c.id,
                at: c.signedAt?.toISOString(),
                label: `Contract signed — ${c.customer.firstName} ${c.customer.lastName}, ${c.estimate.property.address}`,
            })),
            ...recentPayments.map((p: { id: string; paidAt: Date | null; amount: number; contract: { customer: { firstName: string; lastName: string }; estimate: { property: { address: string } } } }) => ({
                type: 'payment',
                id: p.id,
                at: p.paidAt?.toISOString(),
                label: `Payment $${p.amount} — ${p.contract.customer.firstName}, ${p.contract.estimate.property.address}`,
            })),
        ]
            .filter((a: { at?: string | null }) => a.at)
            .sort((a: { at?: string }, b: { at?: string }) => ((b.at ?? '') > (a.at ?? '') ? 1 : -1))
            .slice(0, 8);

        return NextResponse.json({
            stats: {
                estimatesThisMonth,
                closeRate,
                revenueThisMonth,
                averageJobSize,
                activeEstimatesCount,
            },
            recentEstimates: formattedEstimates,
            recentActivity,
        });
    } catch (error) {
        console.error('Dashboard API error:', error);
        return NextResponse.json(
            {
                stats: { estimatesThisMonth: 0, closeRate: 0, revenueThisMonth: 0, averageJobSize: 0, activeEstimatesCount: 0 },
                recentEstimates: [],
                recentActivity: [],
            },
            { status: 200 }
        );
    }
}
