import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10 },
  title: { fontSize: 18, marginBottom: 4, fontWeight: 700 },
  subtitle: { fontSize: 11, marginBottom: 20, color: '#c9a84c' },
  section: { marginBottom: 12 },
  heading: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  body: { marginBottom: 6, lineHeight: 1.4 },
  row: { flexDirection: 'row', marginBottom: 2 },
  cell: { flex: 1 },
  cellRight: { flex: 1, textAlign: 'right' },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 8, color: '#6b7280' },
});

interface EstimatePDFProps {
  estimate: {
    scopeOfWork?: string | null;
    timeline?: string | null;
    basePrice?: number | null;
    upfrontCashPrice?: number | null;
    upfrontCardPrice?: number | null;
    paymentPlanPrice?: number | null;
    customer: { firstName: string; lastName: string; email: string | null; phone: string };
    property: { address: string; city: string; state: string; zip: string };
    lineItems: Array<{ description: string; quantity: number; unit: string; unitCost: number; totalCost: number }>;
  };
}

export function EstimatePDFDocument({ estimate }: EstimatePDFProps) {
  const addr = `${estimate.property.address}, ${estimate.property.city}, ${estimate.property.state} ${estimate.property.zip}`;
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Westchase Painting Company</Text>
        <Text style={styles.subtitle}>By Noble — Estimate</Text>

        <View style={styles.section}>
          <Text style={styles.heading}>Property</Text>
          <Text style={styles.body}>{addr}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Customer</Text>
          <Text style={styles.body}>
            {estimate.customer.firstName} {estimate.customer.lastName} • {estimate.customer.phone}
            {estimate.customer.email ? ` • ${estimate.customer.email}` : ''}
          </Text>
        </View>

        {estimate.scopeOfWork && (
          <View style={styles.section}>
            <Text style={styles.heading}>Scope of Work</Text>
            <Text style={styles.body}>{estimate.scopeOfWork}</Text>
          </View>
        )}

        {estimate.timeline && (
          <View style={styles.section}>
            <Text style={styles.heading}>Timeline</Text>
            <Text style={styles.body}>{estimate.timeline}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.heading}>Line Items</Text>
          {estimate.lineItems.map((item, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{item.description}</Text>
              <Text style={styles.cellRight}>{fmt(item.totalCost)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Pricing Summary</Text>
          {estimate.upfrontCashPrice != null && (
            <Text style={styles.body}>Pay in full (cash/check): {fmt(estimate.upfrontCashPrice)}</Text>
          )}
          {estimate.upfrontCardPrice != null && (
            <Text style={styles.body}>Pay in full (card): {fmt(estimate.upfrontCardPrice)}</Text>
          )}
          {estimate.basePrice != null && (
            <Text style={styles.body}>Base / finance: {fmt(estimate.basePrice)}</Text>
          )}
          {estimate.paymentPlanPrice != null && (
            <Text style={styles.body}>Payment plan: {fmt(estimate.paymentPlanPrice)}</Text>
          )}
        </View>

        <Text style={styles.footer}>
          Bonded & Insured • EPA Lead-Safe Certified • PCA Member • Sherwin-Williams PRO+ Partner
        </Text>
      </Page>
    </Document>
  );
}
