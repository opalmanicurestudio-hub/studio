'use client';
// src/components/orders/use-customer-history.ts — WHO THIS CUSTOMER IS, FROM THE RECORDS (mockups 10A, 10E): their
// orders and what they spent, how many had a refund or return, and their earlier reports. It takes the place of
// flagging a customer by hand: the same picture for everyone, from what actually happened. Read once per customer, up
// to their last 60 orders and 30 reports (enough to see a pattern; a longer history reads as "60 orders").
import * as React from 'react';
import { collection, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';

const NOT_A_SALE = ['placed', 'cancelled'];
/** reports: null when their earlier reports couldn't be read (never shown as none). */
export type CustomerHistory = { orders: number; spent: number; since: string; returns: number; reports: number | null };

export function useCustomerHistory(fs: Firestore | null | undefined, tenantId: string, email: string, exceptClaimId = ''): CustomerHistory | null {
  const [h, setH] = React.useState<CustomerHistory | null>(null);
  React.useEffect(() => {
    // As the order saved it (the reports are filed with the order's address as it is).
    const e = String(email || '').trim();
    if (!fs || !tenantId || !e) { setH(null); return; }
    let live = true;
    Promise.all([
      getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('customerEmail', '==', e), limit(60))),
      getDocs(query(collection(fs, `tenants/${tenantId}/retailClaims`), where('customerEmail', '==', e), limit(30))).catch(() => null),
    ]).then(([s, c]) => {
      if (!live) return;
      const rows = s.docs.map((d) => ({ ...(d.data() as any), id: d.id })).filter((o) => !NOT_A_SALE.includes(String(o.stage)) && !o.isTest && !o.parentOrderId);
      const spent = rows.reduce((a, o) => a + Math.max(0, (Number(o.chargedCents ?? o.totalCents) || 0) - (Number(o.refundedCents) || 0)), 0);
      const first = rows.map((o) => Date.parse(String(o.paidAt || o.placedAt || ''))).filter(Number.isFinite).sort((a, b) => a - b)[0];
      const reports = c ? c.docs.filter((d) => d.id !== exceptClaimId).length : null;
      setH({ orders: rows.length, spent, since: first ? new Date(first).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '', returns: rows.filter((o) => o.returnSummary || (Number(o.refundedCents) || 0) > 0).length, reports });
    }).catch(() => { if (live) setH(null); });
    return () => { live = false; };
  }, [fs, tenantId, email, exceptClaimId]);
  return h;
}

/** "6 orders since March 2026 · no earlier reports · 1 return" */
export function historyLine(h: CustomerHistory | null): string {
  if (!h || !h.orders) return '';
  return [
    // None found means the address didn't match the order's, not a first order.
    h.orders ? `${h.orders} order${h.orders === 1 ? '' : 's'}${h.since ? ` since ${h.since}` : ''}` : '',
    h.reports == null ? '' : h.reports ? `${h.reports} earlier report${h.reports === 1 ? '' : 's'}` : 'no earlier reports',
    h.returns ? `${h.returns} with a refund or return` : 'no refunds or returns',
  ].filter(Boolean).join(' · ');
}
