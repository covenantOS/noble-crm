import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { ContractPDFDocument } from '@/lib/ContractPDFDocument';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = request.nextUrl.searchParams.get('token');

    const contract = await prisma.contract.findUnique({
      where: { id },
      include: { estimate: { select: { viewToken: true, property: true } } },
    });

    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const session = await getServerSession(authOptions);
    const allowedBySession = !!session?.user;
    const allowedByToken =
      token && contract.estimate?.viewToken && token === contract.estimate.viewToken;

    if (!allowedBySession && !allowedByToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const propertyAddress = contract.estimate?.property
      ? `${contract.estimate.property.address}, ${contract.estimate.property.city}, ${contract.estimate.property.state} ${contract.estimate.property.zip}`
      : undefined;

    type Snap = Parameters<typeof ContractPDFDocument>[0]['contract']['contractSnapshot'];
    const doc = React.createElement(ContractPDFDocument, {
      contract: {
        contractSnapshot: contract.contractSnapshot as Snap,
        signatureData: contract.signatureData,
        signerName: contract.signerName,
        signedAt: contract.signedAt,
        totalAmount: contract.totalAmount,
        depositAmount: contract.depositAmount,
        midpointAmount: contract.midpointAmount,
        completionAmount: contract.completionAmount,
        paymentTier: contract.paymentTier,
      },
      propertyAddress,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(doc as any);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="contract-${id}.pdf"`,
      },
    });
  } catch (e) {
    console.error('Contract PDF error:', e);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
