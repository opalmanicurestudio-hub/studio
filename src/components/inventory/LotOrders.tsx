'use client';
// src/components/inventory/LotOrders.tsx — WHO GOT THIS LOT. For a recall or a quality question: every online order
// that a given lot went out on, with the customer's name and how to reach them.
import * as React from 'react';
import { collection, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';

export function LotOrders({ tenantId, productId, lot }: { tenantId: string; productId: string; lot: string }) {
  const { firestore } = useFirebase() as any;
  const [rows, setRows] = React.useState<any[] | null>(null); const [busy, setBusy] = React.useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const s = await getDocs(query(collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`), where('lotKeys', 'array-contains', `${productId}|${lot}`), limit(200)));
      setRows(s.docs.map((d) => ({ ...(d.data() as any), id: d.id })));
    } catch { setRows([]); } finally { setBusy(false); }
  };
  if (!rows) return <button type="button" onClick={() => void load()} disabled={busy} className="mt-1 text-[11px] font-bold underline underline-offset-2 text-muted-foreground">{busy ? 'Looking…' : 'Who got this lot?'}</button>;
  if (!rows.length) return <p className="mt-1 text-[11px] font-bold text-muted-foreground">No online orders have had this lot yet.</p>;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[11px] font-bold text-muted-foreground">{rows.length} online order{rows.length === 1 ? '' : 's'}:</p>
      {rows.map((o) => (
        <p key={o.id} className="text-[11px] font-bold">
          <a href={`/retail-orders?order=${o.id}`} className="underline underline-offset-2">#{String(o.orderNumber ?? '').padStart(4, '0')}</a> {o.customerName}{o.customerEmail ? ` · ${o.customerEmail}` : ''}{o.customerPhone ? ` · ${o.customerPhone}` : ''}
        </p>))}
    </div>);
}
