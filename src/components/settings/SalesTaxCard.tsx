'use client';
// src/components/settings/SalesTaxCard.tsx — SALES TAX AT CHECKOUT (Settings → Payments).
// Products share the online store's rate; services are taxed only if you say so; fees never are.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { posTaxOf } from '@/lib/pos-tax';

export function SalesTaxCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const cur = posTaxOf(tenant);
  const [products, setProducts] = React.useState(String(tenant?.retailSettings?.taxRatePercent ?? (cur.legacy ? 7 : cur.productsPct)));
  const [servicesTaxed, setServicesTaxed] = React.useState<boolean>(cur.legacy ? true : tenant?.salesTax?.servicesTaxed === true);
  const [services, setServices] = React.useState(String(tenant?.salesTax?.servicesPct ?? (cur.legacy ? 7 : cur.productsPct)));
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<string | null>(null);
  const pct = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 25 ? Math.round(n * 1000) / 1000 : null; };
  const save = async () => {
    const p = pct(products), sv = pct(services);
    if (p === null || (servicesTaxed && sv === null)) { setMsg('Rates must be between 0 and 25%.'); return; }
    setBusy(true); setMsg(null);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { 'retailSettings.taxRatePercent': p, salesTax: { configured: true, servicesTaxed, servicesPct: servicesTaxed ? sv : 0, updatedAt: new Date().toISOString() } });
      setMsg('Saved — checkout uses these rates from now on.');
    } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Sales tax at checkout</p>
        <p className="text-sm text-muted-foreground">What the POS adds to a client’s bill. Fees (late cancellations, no-shows, change fees, balances) are never taxed.</p></div>
      {cur.legacy && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900"><b>Please check this.</b> Checkout is still using the old default — <b>7% on everything, services included</b>. Set your rates below to change it. Check with your accountant if you’re unsure what’s taxable where you are.</p>}
      <label className="block space-y-1 text-sm"><span className="font-semibold">Products</span>
        <div className="flex items-center gap-2"><input value={products} onChange={(e) => setProducts(e.target.value)} inputMode="decimal" disabled={!canEdit} className="h-10 w-28 rounded-xl border px-3" /><span>%</span></div>
        <span className="text-xs text-muted-foreground">The same rate your online store uses.</span></label>
      <div className="space-y-2 text-sm"><span className="font-semibold">Services</span>
        <div className="flex flex-wrap gap-2">{([[false, 'Not taxed'], [true, 'Taxed']] as const).map(([v, l]) =>
          <button key={String(v)} type="button" disabled={!canEdit} aria-pressed={servicesTaxed === v} onClick={() => setServicesTaxed(v)} className={`rounded-full border px-4 py-1.5 ${servicesTaxed === v ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
        {servicesTaxed && <div className="flex items-center gap-2"><input value={services} onChange={(e) => setServices(e.target.value)} inputMode="decimal" disabled={!canEdit} className="h-10 w-28 rounded-xl border px-3" /><span>%</span></div>}
      </div>
      {canEdit ? <button type="button" onClick={save} disabled={busy} className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Saving…' : 'Save tax settings'}</button>
        : <p className="text-xs text-muted-foreground">Only a manager can change tax settings.</p>}
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </div>
  );
}
