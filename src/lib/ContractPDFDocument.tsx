import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10 },
  title: { fontSize: 18, marginBottom: 4, fontWeight: 700 },
  subtitle: { fontSize: 11, marginBottom: 20, color: '#c9a84c' },
  section: { marginBottom: 12 },
  heading: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  body: { marginBottom: 6, lineHeight: 1.4 },
  signatureBox: { marginTop: 16, marginBottom: 8 },
  signatureLabel: { fontSize: 9, color: '#6b7280', marginBottom: 4 },
  signatureImg: { width: 180, height: 60, objectFit: 'contain' },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 8, color: '#6b7280' },
});

interface ContractSnapshot {
  scopeOfWork?: string;
  timeline?: string;
  paymentTier?: string;
  totalAmount?: number;
  depositAmount?: number | null;
  midpointAmount?: number | null;
  completionAmount?: number | null;
  signerName?: string;
  signedAt?: string;
}

interface ContractPDFProps {
  contract: {
    contractSnapshot: ContractSnapshot | null;
    signatureData: string | null;
    signerName: string | null;
    signedAt: Date | null;
    totalAmount: number;
    depositAmount: number | null;
    midpointAmount: number | null;
    completionAmount: number | null;
    paymentTier: string;
  };
  propertyAddress?: string;
}

export function ContractPDFDocument({ contract, propertyAddress }: ContractPDFProps) {
  const snap = contract.contractSnapshot as ContractSnapshot | null;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const sigSrc = contract.signatureData?.startsWith('data:') ? contract.signatureData : contract.signatureData ? `data:image/png;base64,${contract.signatureData}` : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Westchase Painting Company</Text>
        <Text style={styles.subtitle}>By Noble — Signed Contract</Text>

        {propertyAddress && (
          <View style={styles.section}>
            <Text style={styles.heading}>Property</Text>
            <Text style={styles.body}>{propertyAddress}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.heading}>Payment</Text>
          <Text style={styles.body}>Tier: {contract.paymentTier?.replace(/_/g, ' ')}</Text>
          <Text style={styles.body}>Total: {fmt(contract.totalAmount)}</Text>
          {contract.depositAmount != null && (
            <Text style={styles.body}>Deposit: {fmt(contract.depositAmount)}</Text>
          )}
          {contract.midpointAmount != null && (
            <Text style={styles.body}>Midpoint: {fmt(contract.midpointAmount)}</Text>
          )}
          {contract.completionAmount != null && (
            <Text style={styles.body}>Completion: {fmt(contract.completionAmount)}</Text>
          )}
        </View>

        {snap?.scopeOfWork && (
          <View style={styles.section}>
            <Text style={styles.heading}>Scope of Work</Text>
            <Text style={styles.body}>{snap.scopeOfWork}</Text>
          </View>
        )}

        {snap?.timeline && (
          <View style={styles.section}>
            <Text style={styles.heading}>Timeline</Text>
            <Text style={styles.body}>{snap.timeline}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.heading}>Signature</Text>
          {contract.signerName && (
            <Text style={styles.body}>Signed by: {contract.signerName}</Text>
          )}
          {contract.signedAt && (
            <Text style={styles.body}>Date: {new Date(contract.signedAt).toLocaleString('en-US')}</Text>
          )}
          {sigSrc && (
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Signature</Text>
              <Image style={styles.signatureImg} src={sigSrc} />
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Bonded & Insured • EPA Lead-Safe Certified • PCA Member • Sherwin-Williams PRO+ Partner
        </Text>
      </Page>
    </Document>
  );
}
