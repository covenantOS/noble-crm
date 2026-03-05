import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { EstimatePDFDocument } from '@/lib/EstimatePDFDocument';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: {
        customer: true,
        property: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    const doc = React.createElement(EstimatePDFDocument, { estimate });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(doc as any);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="estimate-${id}.pdf"`,
      },
    });
  } catch (e) {
    console.error('PDF generation error:', e);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
