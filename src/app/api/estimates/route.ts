import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/estimates — List all estimates with filters
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const status = searchParams.get('status');
        const search = searchParams.get('search');
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');
        const skip = (page - 1) * limit;

        const where: Record<string, unknown> = {};

        if (status && status !== 'all') {
            where.status = status;
        }

        if (search) {
            where.OR = [
                { customer: { firstName: { contains: search, mode: 'insensitive' } } },
                { customer: { lastName: { contains: search, mode: 'insensitive' } } },
                { property: { address: { contains: search, mode: 'insensitive' } } },
            ];
        }

        const [estimates, total] = await Promise.all([
            prisma.estimate.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
                    property: { select: { address: true, city: true, state: true, zip: true } },
                    createdBy: { select: { name: true } },
                    _count: { select: { photos: true, lineItems: true } },
                },
            }),
            prisma.estimate.count({ where }),
        ]);

        return NextResponse.json({
            estimates,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('List estimates error:', error);
        return NextResponse.json({ error: 'Failed to fetch estimates' }, { status: 500 });
    }
}

// POST /api/estimates — Create a new estimate
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const {
            customer,
            property,
            scopeType,
            surfaces,
            measurements,
            notes,
        } = body;

        // Get the first user (admin) as creator
        const user = await prisma.user.findFirst();
        if (!user) {
            return NextResponse.json({ error: 'No admin user found' }, { status: 400 });
        }

        // Create or find customer
        let customerId: string;
        if (customer.id) {
            customerId = customer.id;
        } else {
            const newCustomer = await prisma.customer.create({
                data: {
                    firstName: customer.firstName,
                    lastName: customer.lastName,
                    email: customer.email || null,
                    phone: customer.phone,
                    source: customer.source || 'OTHER',
                },
            });
            customerId = newCustomer.id;
        }

        // Create property
        const newProperty = await prisma.property.create({
            data: {
                customerId,
                address: property.address,
                city: property.city || 'Tampa',
                state: property.state || 'FL',
                zip: property.zip,
                squareFootageInterior: property.squareFootageInterior ? parseInt(property.squareFootageInterior) : null,
                stories: property.stories ? parseInt(property.stories) : 1,
                constructionType: property.constructionType || 'STUCCO',
                yearBuilt: property.yearBuilt ? parseInt(property.yearBuilt) : null,
                notes: property.notes || null,
            },
        });

        // Create estimate
        const estimate = await prisma.estimate.create({
            data: {
                propertyId: newProperty.id,
                customerId,
                createdById: user.id,
                scopeType: scopeType || 'EXTERIOR',
                status: 'DRAFT',
                humanNotes: notes || null,
                surfaces: {
                    create: (surfaces || []).map((s: { surfaceType: string; description?: string; condition?: string; notes?: string; included?: boolean }) => ({
                        surfaceType: s.surfaceType,
                        description: s.description || null,
                        condition: s.condition || 'GOOD',
                        included: s.included !== false,
                        notes: s.notes || null,
                    })),
                },
                measurements: {
                    create: (measurements || []).map((m: { surface: string; description?: string; linearFeet?: number; height?: number; grossArea?: number; windowDeduction?: number; doorDeduction?: number; netPaintableArea?: number; coatsRequired?: number; notes?: string }) => ({
                        surface: m.surface,
                        description: m.description || null,
                        linearFeet: m.linearFeet ? parseFloat(String(m.linearFeet)) : null,
                        height: m.height ? parseFloat(String(m.height)) : null,
                        grossArea: m.grossArea ? parseFloat(String(m.grossArea)) : null,
                        windowDeduction: m.windowDeduction ? parseFloat(String(m.windowDeduction)) : 0,
                        doorDeduction: m.doorDeduction ? parseFloat(String(m.doorDeduction)) : 0,
                        netPaintableArea: m.netPaintableArea ? parseFloat(String(m.netPaintableArea)) : null,
                        coatsRequired: m.coatsRequired || 2,
                        notes: m.notes || null,
                    })),
                },
            },
            include: {
                customer: true,
                property: true,
                surfaces: true,
                measurements: true,
            },
        });

        return NextResponse.json(estimate, { status: 201 });
    } catch (error) {
        console.error('Create estimate error:', error);
        return NextResponse.json({ error: 'Failed to create estimate' }, { status: 500 });
    }
}
