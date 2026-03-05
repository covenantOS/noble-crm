import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// GET /api/settings — Fetch all settings (pricing, company, templates)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [pricingConfig, companySettings, messageTemplates] = await Promise.all([
      prisma.pricingConfig.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] }),
      prisma.companySettings.findMany(),
      prisma.messageTemplate.findMany({ orderBy: { key: 'asc' } }),
    ]);

    const company = companySettings.reduce<Record<string, string>>((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {});

    return NextResponse.json({
      pricing: pricingConfig,
      company,
      templates: messageTemplates,
    });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT /api/settings — Update a section (pricing | company | templates)
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { section, data } = body as { section: 'pricing' | 'company' | 'templates'; data: unknown };

    if (section === 'pricing' && Array.isArray(data)) {
      for (const item of data as { key: string; value: string }[]) {
        if (item?.key) {
          await prisma.pricingConfig.updateMany({
            where: { key: item.key },
            data: { value: String(item.value) },
          });
        }
      }
      return NextResponse.json({ success: true });
    }

    if (section === 'company' && data && typeof data === 'object') {
      const entries = Object.entries(data as Record<string, string>);
      for (const [key, value] of entries) {
        await prisma.companySettings.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        });
      }
      return NextResponse.json({ success: true });
    }

    if (section === 'templates' && Array.isArray(data)) {
      for (const item of data as { key: string; subject?: string; content: string }[]) {
        if (item?.key) {
          await prisma.messageTemplate.updateMany({
            where: { key: item.key },
            data: {
              ...(item.subject != null && { subject: item.subject }),
              content: item.content ?? '',
            },
          });
        }
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid section or data' }, { status: 400 });
  } catch (error) {
    console.error('Settings PUT error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
