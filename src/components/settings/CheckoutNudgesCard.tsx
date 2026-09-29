'use client';
// src/components/settings/CheckoutNudgesCard.tsx — SUGGESTIONS AT CHECKOUT (Settings → Payments). Saves as you go.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { nudgeSettingsOf } from '@/lib/checkout-nudges';

export function CheckoutNudgesCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [s, setS] = React.useState(nudgeSettingsOf(tenant)); const [msg, setMsg] = React.useState<string | null>(null);
  const save = async (patch: any) => {
    const next = { ...s, ...patch }; setS(next); setMsg(null);
    try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { checkoutNudges: next }); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); }
  };
  const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) =>
    <button type="button" disabled={!canEdit} aria-pressed={on} onClick={onClick} className={`rounded-full border px-4 py-1.5 text-sm ${on ? 'bg-slate-900 text-white' : 'bg-white'}`}>{children}</button>;
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Suggestions at checkout</p>
        <p className="text-sm text-muted-foreground">One honest suggestion when it genuinely suits the client, with the maths shown. A membership is only suggested if, on their last 3 months of visits, it would have cost them less.</p></div>
      {([['membership', 'Memberships', 'when it would have saved them money'], ['package', 'Packages', 'when they keep booking the same service'], ['rebook', 'Book the next visit', 'when nothing is booked yet, using their usual gap']] as const).map(([k, l, note]) =>
        <label key={k} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={(s as any)[k]} disabled={!canEdit} onChange={(e) => save({ [k]: e.target.checked })} />
          <span><b>{l}</b> <span className="text-muted-foreground">— {note}</span></span></label>)}
      <div className="space-y-2 text-sm"><p className="font-semibold">After a client says “not now”</p>
        <div className="flex flex-wrap gap-2">{[30, 60, 90].map((d) => <Pill key={d} on={s.quietDays === d} onClick={() => save({ quietDays: d })}>Quiet for {d} days</Pill>)}</div></div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Per checkout</p>
        <div className="flex flex-wrap gap-2"><Pill on={s.max === 1} onClick={() => save({ max: 1 })}>At most one suggestion</Pill><Pill on={s.max === 2} onClick={() => save({ max: 2 })}>Up to two</Pill></div></div>
      {!canEdit && <p className="text-xs text-muted-foreground">Only a manager can change these.</p>}
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </div>
  );
}
