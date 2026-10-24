'use client';
// src/components/retail/VariantSettings.tsx — HOW EACH VARIANT SELLS, under its listing in Shop settings. A variant
// sells the way its listing is set (pre-order, a download, made to order, its wholesale price and minimum, its weight
// for postage: lib/variants asSold) unless it's set on the variant itself. Here each variant can have a wholesale
// price and a weight of its own (a wholesale minimum is the listing's, counted across its variants), and a setting of
// its own from before (a pre-order run, a download, made-to-order days) can be put back to the listing's.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { choiceFor, variantIdsOf, variantPriceCents } from '@/lib/variants';

type Draft = { wholesale: string; weight: string };
const draftOf = (v: any): Draft => ({
  wholesale: Number(v?.wholesalePriceDollars) > 0 ? String(v.wholesalePriceDollars) : '',
  weight: Number(v?.weightOz) > 0 ? String(v.weightOz) : '',
});
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
const day = (d: any) => { const t = Date.parse(`${String(d || '')}T12:00:00`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };

export function VariantSettings({ firestore, tenantId, listing, byId, onToast }: {
  firestore: Firestore | null; tenantId: string; listing: any; byId: Map<string, any>;
  onToast: (t: { title: string; description?: string; bad?: boolean }) => void;
}) {
  const vids = variantIdsOf(listing);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [busy, setBusy] = React.useState('');
  if (!vids.length) return null;

  const save = async (id: string, patch: Record<string, any>, done: string) => {
    if (!firestore || !tenantId || busy) return;
    setBusy(id);
    try { await updateDoc(doc(firestore, `tenants/${tenantId}/inventory`, id), patch); onToast({ title: done }); setDrafts((d) => { const n = { ...d }; delete n[id]; return n; }); }
    catch (e: any) { onToast({ title: 'Not saved', description: e?.message || 'Try again.', bad: true }); }
    setBusy('');
  };
  const listingWholesale = Number(listing.wholesalePriceDollars) > 0 ? money(listing.wholesalePriceDollars) : '';

  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed p-2.5">
      <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">How each variant sells</p>
      <p className="text-[11px] font-bold text-muted-foreground">
        Each variant sells the way this listing is set above (pre-order, a download, made to order, its weight). Give one a wholesale price or a weight of its own here. Left blank, a variant’s wholesale price is the listing’s wholesale discount off its own price, and its weight is the listing’s. A wholesale minimum counts all the variants together.
      </p>
      {vids.map((id) => {
        const v = byId.get(id); if (!v) return null;
        const d = drafts[id] || draftOf(v); const changed = JSON.stringify(d) !== JSON.stringify(draftOf(v));
        const label = choiceFor(listing, id)?.choice.label || v.name || 'Variant';
        const own: { text: string; patch: Record<string, any> }[] = [];
        if (v.preorder === true) own.push({ text: `On a pre-order run of its own${v.preorderEtaAt ? `, ships by ${day(v.preorderEtaAt)}` : ''}.`, patch: { preorder: false, preorderEtaAt: null, preorderClosesAt: null, preorderLimit: null } });
        if (v.digital === true) own.push({ text: 'A download of its own.', patch: { digital: false, digitalUrl: null, digitalFilePath: null, digitalFileName: null, digitalAccessDays: null } });
        if (Number(v.leadDays?.max ?? v.leadDays?.min) > 0) own.push({ text: `Made to order on its own, ${v.leadDays?.min || v.leadDays?.max} to ${v.leadDays?.max || v.leadDays?.min} business days.`, patch: { leadDays: null } });
        return (
          <div key={id} className="space-y-1.5 rounded-xl border-2 p-2">
            <p className="truncate text-[11px] font-black uppercase tracking-tight">{label}</p>
            <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
              <span className="text-[10px] font-bold text-muted-foreground">Wholesale $</span>
              <span className="text-[10px] font-bold text-muted-foreground">Weight (oz)</span>
              <Input aria-label={`Wholesale price for ${label}`} placeholder={listingWholesale ? money(variantPriceCents({ ...v, wholesalePriceDollars: null }, listing, 'wholesale') / 100) : 'Wholesale $'} inputMode="decimal" value={d.wholesale}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [id]: { ...d, wholesale: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) } })}
                className="h-9 rounded-xl border-2 font-mono text-xs font-bold" />
              <Input aria-label={`Weight in ounces for ${label}`} placeholder={Number(listing.weightOz) > 0 ? `Listing’s ${listing.weightOz} oz` : 'Weight oz'} inputMode="decimal" value={d.weight}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [id]: { ...d, weight: e.target.value.replace(/[^\d.]/g, '').slice(0, 7) } })}
                className="h-9 rounded-xl border-2 font-mono text-xs font-bold" />
            </div>
            {own.map((o) => (
              <div key={o.text} className="flex items-center justify-between gap-2">
                <p className="min-w-0 text-[11px] font-bold text-muted-foreground">{o.text}</p>
                <Button type="button" variant="outline" size="sm" disabled={busy === id} onClick={() => void save(id, o.patch, `${label} sells as the listing is set now`)}
                  className="h-8 shrink-0 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest">Use the listing’s</Button>
              </div>))}
            {changed && (
              <Button type="button" variant="outline" size="sm" disabled={busy === id}
                onClick={() => void save(id, { wholesalePriceDollars: d.wholesale.trim() === '' ? null : Number(d.wholesale) || 0, weightOz: d.weight.trim() === '' ? null : Math.max(0, Number(d.weight) || 0) }, `${label} saved`)}
                className="h-8 w-full rounded-xl border-2 text-[9px] font-black uppercase tracking-widest">{busy === id ? 'Saving…' : `Save ${label}`}</Button>)}
          </div>);
      })}
    </div>);
}
