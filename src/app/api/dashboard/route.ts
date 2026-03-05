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

        return NextResponse.json({
            stats: {
                estimatesThisMonth,
                closeRate,
                revenueThisMonth,
                averageJobSize,
            },
            recentEstimates: formattedEstimates,
        });
    } catch (error) {
        console.error('Dashboard API error:', error);
        return NextResponse.json(
            {
                stats: { estimatesThisMonth: 0, closeRate: 0, revenueThisMonth: 0, averageJobSize: 0 },
                recentEstimates: [],
            },
            { status: 200 }
        );
    }
}
