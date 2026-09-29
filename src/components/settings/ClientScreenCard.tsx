'use client';
// src/components/settings/ClientScreenCard.tsx — THE CLIENT SCREEN (Settings → Payments). Saves once you pause typing.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { clientScreenSettingsOf } from '@/lib/client-screen';

export function ClientScreenCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [s, setS] = React.useState(clientScreenSettingsOf(tenant)); const [msg, setMsg] = React.useState<string | null>(null);
  const timer = React.useRef<any>(null);
  const save = (next: any) => { setS(next); setMsg(null); clearTimeout(timer.current);
    timer.current = setTimeout(async () => { try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { clientScreen: next }); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } }, 600); };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const check = (k: keyof typeof s, label: string, note?: string) => <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!(s as any)[k]} disabled={!canEdit} onChange={(e) => save({ ...s, [k]: e.target.checked })} /><span><b>{label}</b>{note ? <span className="text-muted-foreground"> — {note}</span> : null}</span></label>;
  const presets = [...s.tipPresets, 0, 0, 0, 0].slice(0, 4);
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Client screen</p>
        <p className="text-sm text-muted-foreground">An iPad at the desk facing the client: they see the ticket as you ring it up, choose a tip, approve card-on-file charges (and sign), and get their receipt. Pair it from the POS → Client screen.</p></div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Tip choices (%)</p>
        <div className="flex flex-wrap gap-2">{presets.map((v, i) => <input key={i} type="number" inputMode="numeric" min={0} max={100} value={v || ''} placeholder={i < 3 ? '' : 'optional'} disabled={!canEdit} aria-label={`Tip choice ${i + 1}`}
          onChange={(e) => { const next = [...presets]; next[i] = Math.max(0, Math.min(100, Number(e.target.value) || 0)); save({ ...s, tipPresets: next.filter((n) => n > 0) }); }} className="h-10 w-20 rounded-xl border px-3 text-right" />)}</div>
        <div className="flex flex-wrap gap-2 pt-1">{([['before_tax', 'Tip on the amount before tax'], ['after_tax', 'Tip on the total after tax']] as const).map(([k, l]) =>
          <button key={k} type="button" disabled={!canEdit} aria-pressed={s.tipOn === k} onClick={() => save({ ...s, tipOn: k })} className={`rounded-full border px-4 py-1.5 ${s.tipOn === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
        {check('allowCustomTip', 'Let them enter another amount')}
        {check('showNoTip', 'Show “No tip”')}
      </div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Card on file</p>
        {check('signCardOnFile', 'Ask for a signature when approving a card-on-file charge', 'saved as a signed approval (useful if a charge is ever disputed)')}
        {s.signCardOnFile && <div className="flex flex-wrap items-center gap-2 pl-6">Only for charges of $<input type="number" inputMode="decimal" min={0} value={s.signOver || ''} placeholder="0" disabled={!canEdit} onChange={(e) => save({ ...s, signOver: Math.max(0, Number(e.target.value) || 0) })} className="h-10 w-24 rounded-xl border px-3 text-right" aria-label="Signature from this amount" /> or more <span className="text-xs text-muted-foreground">(blank = every charge)</span></div>}
      </div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Welcome message</p>
        <input value={s.welcome} onChange={(e) => save({ ...s, welcome: e.target.value.slice(0, 120) })} disabled={!canEdit} aria-label="Welcome message" className="h-10 w-full rounded-xl border px-3" />
        {check('offerReceipt', 'Offer “Text / email my receipt” after they pay')}
      </div>
      {!canEdit && <p className="text-xs text-muted-foreground">Only a manager can change these.</p>}
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </div>
  );
}
