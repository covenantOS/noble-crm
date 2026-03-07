import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/estimates — List all estimates with filters
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const status = searchParams.get('status');
        const search = searchParams.get('search');
        const dateFrom = searchParams.get('dateFrom');
        const dateTo = searchParams.get('dateTo');
        const priceMin = searchParams.get('priceMin');
        const priceMax = searchParams.get('priceMax');
        const sort = searchParams.get('sort') || 'date';
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

        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) (where.createdAt as Record<string, Date>).gte = new Date(dateFrom);
            if (dateTo) {
                const end = new Date(dateTo);
                end.setHours(23, 59, 59, 999);
                (where.createdAt as Record<string, Date>).lte = end;
            }
        }
        if (priceMin != null && priceMin !== '' || priceMax != null && priceMax !== '') {
            const priceFilter: { gte?: number; lte?: number } = {};
            if (priceMin != null && priceMin !== '') priceFilter.gte = parseFloat(priceMin);
            if (priceMax != null && priceMax !== '') priceFilter.lte = parseFloat(priceMax);
            where.basePrice = priceFilter;
        }

        const orderBy = sort === 'price_asc'
            ? { basePrice: 'asc' as const }
            : sort === 'price_desc'
            ? { basePrice: 'desc' as const }
            : sort === 'status'
            ? [{ status: 'asc' as const }, { createdAt: 'desc' as const }]
            : { createdAt: 'desc' as const };

        const [estimates, total] = await Promise.all([
            prisma.estimate.findMany({
                where,
                skip,
                take: limit,
                orderBy,
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
                squareFootageExterior: property.squareFootageExterior ? parseInt(property.squareFootageExterior) : null,
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
                    create: (() => {
                        const list = (measurements || []).map((m: { surface: string; description?: string; linearFeet?: number; height?: number; grossArea?: number; windowDeduction?: number; doorDeduction?: number; netPaintableArea?: number; coatsRequired?: number; notes?: string }) => ({
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
                        }));
                        // Quick estimate mode: when no per-surface measurements but total sqft provided, add synthetic rows for pricing
                        if (list.length === 0 && (property.squareFootageExterior || property.squareFootageInterior)) {
                            const ext = property.squareFootageExterior ? parseInt(String(property.squareFootageExterior), 10) : 0;
                            const int = property.squareFootageInterior ? parseInt(String(property.squareFootageInterior), 10) : 0;
                            if (ext > 0) list.push({ surface: 'EXTERIOR_WALL', description: 'Quick total exterior', linearFeet: null, height: null, grossArea: null, windowDeduction: 0, doorDeduction: 0, netPaintableArea: ext, coatsRequired: 2, notes: null });
                            if (int > 0) list.push({ surface: 'INTERIOR_WALL', description: 'Quick total interior', linearFeet: null, height: null, grossArea: null, windowDeduction: 0, doorDeduction: 0, netPaintableArea: int, coatsRequired: 2, notes: null });
                        }
                        return list;
                    })(),
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
