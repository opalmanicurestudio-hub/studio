'use client';
// src/components/settings/PayLaterCard.tsx
//
// "Offer pay-later" — Klarna, Afterpay and Affirm on bigger purchases.
// Shows what it costs, where it appears, the minimum order, and whether
// Stripe has approved each option for this business.

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader } from 'lucide-react';
import { PAY_LATER_FEE_TEXT } from '@/lib/pay-later';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/stripe/pay-later', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const TONE: Record<string, string> = { active: 'bg-emerald-100 text-emerald-800', pending: 'bg-amber-100 text-amber-800', inactive: 'bg-stone-200 text-stone-600', unrequested: 'bg-stone-100 text-stone-500' };

export function PayLaterCard({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null);
  const [min, setMin] = useState('150');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (tenantId) api({ action: 'status', tenantId }).then((r) => { if (r.ok) { setD(r); setMin(String(r.setting.minAmount)); } }); }, [tenantId]);
  if (!d) return null;
  const save = async (enabled: boolean) => {
    setBusy(true); setMsg('');
    const r = await api({ action: 'save', tenantId, enabled, minAmount: Number(min) || 0 });
    setBusy(false);
    if (r.ok) { setD({ ...d, setting: r.setting, capabilities: r.capabilities }); setMsg(enabled ? 'Pay-later is on. Stripe is approving each option — usually within minutes.' : 'Pay-later is off.'); }
    else setMsg(r.error || 'Couldn’t save.');
  };
  const on = !!d.setting.enabled;
  return (
    <div className="mt-6 space-y-3 rounded-3xl border-2 border-dashed border-border/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-widest">Offer pay-later</p>
          <p className="mt-1 text-sm text-muted-foreground">Let customers split bigger purchases into 4 payments or monthly instalments with Klarna, Afterpay or Affirm. You’re paid the full amount up front; they carry the risk.</p>
        </div>
        <button type="button" role="switch" aria-checked={on} disabled={busy || !d.connected} onClick={() => save(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-primary' : 'bg-muted'}`}>
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
      {!d.connected && <p className="text-sm text-amber-700">Connect Stripe above first.</p>}
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-2xl bg-muted/40 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cost</p><p className="font-bold">{PAY_LATER_FEE_TEXT} per sale</p><p className="text-[12px] text-muted-foreground">vs 3.3% + 30¢ for cards</p></div>
        <div className="rounded-2xl bg-muted/40 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Where</p><p className="font-bold">Your online shop</p><p className="text-[12px] text-muted-foreground">Never on deposits, saved cards, rent or in person</p></div>
        <label className="rounded-2xl bg-muted/40 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Only on orders from</p>
          <span className="mt-1 flex items-center gap-1 font-bold">$<input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} onBlur={() => on && save(true)} className="h-8 w-24 rounded-lg border px-2 text-sm" /></span></label>
      </div>
      {on && d.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{d.capabilities.map((c: any) => <span key={c.key} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[c.status] || TONE.unrequested}`}>{c.label}: {c.status === 'active' ? 'ready' : c.status}</span>)}</div>
      )}
      <p className="text-[12px] text-muted-foreground">Best for bigger tickets — extensions, packages, kits and courses. On small sales the higher fee usually isn’t worth it.</p>
      {busy && <Loader className="h-4 w-4 animate-spin" />}
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
