'use client';
// src/components/inventory/SoldForSection.tsx — WHOSE PRODUCT IS THIS. A product can be sold for one of your renters:
// your team packs and sends it like anything else, and the renter's share (after your cut) is credited to their rent
// account when the order goes out (lib/renter-sales).
import * as React from 'react';
import { collection, getDocs, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const nameOf = (r: any) => `${r?.firstName || ''} ${r?.lastName || ''}`.trim() || r?.name || 'Renter';

export function SoldForSection({ product, onSave }: { product: any; onSave: (patch: any) => Promise<void> | void }) {
  const { firestore } = useFirebase() as any; const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const [renters, setRenters] = React.useState<any[]>([]);
  const cur = product?.soldFor || null;
  const [rid, setRid] = React.useState<string>(cur?.renterId || '');
  const [cut, setCut] = React.useState<string>(String(cur?.shopCutPct ?? 20));
  const [busy, setBusy] = React.useState(false); const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    void getDocs(collection(firestore as Firestore, `tenants/${tenantId}/renters`)).then((s) => setRenters(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((r) => !['archived', 'inactive', 'former'].includes(String(r.status || ''))))).catch(() => setRenters([]));
  }, [firestore, tenantId]);
  if (!renters.length && !cur) return null;
  const dirty = rid !== (cur?.renterId || '') || (rid && Number(cut) !== Number(cur?.shopCutPct ?? 20));
  const save = async () => {
    setBusy(true);
    try {
      const r = renters.find((x) => x.id === rid);
      await onSave({ soldFor: rid ? { renterId: rid, renterName: r ? nameOf(r) : cur?.renterName || 'Renter', shopCutPct: Math.min(100, Math.max(0, Math.round(Number(cut) || 0))) } : null });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  };
  const pct = Math.min(100, Math.max(0, Number(cut) || 0));
  const price = Number(product?.msrp) || 0;
  return (
    <div className="rounded-[1.5rem] border-2 p-5 space-y-3">
      <div>
        <p className="text-sm font-black uppercase tracking-tight">Sold for a renter</p>
        <p className="text-[11px] font-bold text-muted-foreground">Your team packs and sends it like anything else. Their share is credited to their rent when the order goes out, and taken back if it’s returned.</p>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Whose product</Label>
          <select aria-label="Whose product" value={rid} onChange={(e) => setRid(e.target.value)} className="h-11 w-full rounded-xl border-2 bg-white px-3 text-sm font-bold">
            <option value="">The shop’s own</option>
            {renters.map((r) => <option key={r.id} value={r.id}>{nameOf(r)}</option>)}
          </select>
        </div>
        {rid && (
          <div className="space-y-1">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Shop keeps</Label>
            <div className="flex items-center gap-1"><Input aria-label="Shop keeps percent" inputMode="numeric" value={cut} onChange={(e) => setCut(e.target.value.replace(/\D/g, '').slice(0, 3))} className="h-11 w-16 rounded-xl border-2 text-center font-mono font-bold" /><span className="text-sm font-bold">%</span></div>
          </div>)}
      </div>
      {rid && price > 0 && <p className="text-[11px] font-bold text-muted-foreground">At ${price.toFixed(2)}, they get ${(price * (100 - pct) / 100).toFixed(2)} per sale and the shop keeps ${(price * pct / 100).toFixed(2)}.</p>}
      {(dirty || saved) && <Button onClick={() => void save()} disabled={busy || saved} className="h-11 w-full rounded-xl font-black uppercase text-[10px] tracking-widest">{saved ? 'Saved' : busy ? 'Saving…' : 'Save'}</Button>}
    </div>);
}
