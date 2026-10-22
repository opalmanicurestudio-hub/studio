'use client';
// src/components/orders/use-label-flags.ts — ORDERS A LABEL HAS PUT UNDER NEEDS YOU, whatever stage they're at: a label
// nobody has scanned for days, or a void that didn't finish (lib/label-sweep); a voided label the carrier scanned
// anyway; a box waiting for its new label (lib/label-boxes); a refund Shippo turned down, or a carrier's later
// adjustment to the postage (lib/label-records); a parcel the carrier is having trouble with (lib/ship-day). A few small
// lists, live, merged into one.
import * as React from 'react';
import { collection, limit, onSnapshot, query, where, type Firestore } from 'firebase/firestore';

const FLAGS: [string, number][] = [['labelUnscannedOpen', 50], ['voidedLabelMoving.open', 20], ['relabelOpen', 20], ['labelRefundDenied.open', 20], ['labelCharge.open', 20], ['carrierIssue.open', 30]];

export function useLabelFlagOrders(fs: Firestore, tenantId: string): any[] {
  const [rows, setRows] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!fs || !tenantId) { setRows([]); return; }
    const parts = new Map<string, any[]>();
    const merge = () => { const m = new Map<string, any>(); for (const list of parts.values()) for (const o of list) m.set(o.id, o); setRows([...m.values()]); };
    const subs = FLAGS.map(([field, n]) => onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where(field, '==', true), limit(n)),
      (s) => { parts.set(field, s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))); merge(); },
      () => { parts.set(field, []); merge(); }));
    return () => subs.forEach((u) => u());
  }, [fs, tenantId]);
  return rows;
}
