'use client';
// src/components/settings/ClientScreenCard.tsx — THE CLIENT SCREEN (Settings → Payments). Saves once you pause typing.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { clientScreenSettingsOf } from '@/lib/client-screen';
import { momentSettingsOf } from '@/lib/moments';

export function ClientScreenCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [s, setS] = React.useState(clientScreenSettingsOf(tenant)); const [msg, setMsg] = React.useState<string | null>(null);
  const timer = React.useRef<any>(null);
  const save = (next: any) => { setS(next); setMsg(null); clearTimeout(timer.current);
    timer.current = setTimeout(async () => { try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { clientScreen: next }); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } }, 600); };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const check = (k: keyof typeof s, label: string, note?: string) => <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!(s as any)[k]} disabled={!canEdit} onChange={(e) => save({ ...s, [k]: e.target.checked })} /><span><b>{label}</b>{note ? <span className="text-muted-foreground"> — {note}</span> : null}</span></label>;
  const presets = [...s.tipPresets, 0, 0, 0, 0].slice(0, 4);
  const m = momentSettingsOf({ clientScreen: s });
  const setM = (patch: any) => save({ ...s, moments: { ...m, ...patch } });
  const pctBox = (v: number, on: (n: number) => void, label: string) => <span className="flex items-center gap-1">{label} <input type="number" inputMode="numeric" min={0} max={100} value={v || ''} placeholder="0" disabled={!canEdit} aria-label={label} onChange={(e) => on(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="h-10 w-16 rounded-xl border px-2 text-right" />% off services <span className="text-xs text-muted-foreground">(blank = just a greeting)</span></span>;
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Client screen</p>
        <p className="text-sm text-muted-foreground">An iPad at the desk facing the client: they see the ticket as you ring it up, choose a tip, approve card-on-file charges (and sign), and get their receipt. Pair it from the POS → Client screen.</p></div>
      <div className="space-y-2 text-sm"><p className="font-semibold">How it runs</p>
        {check('auto', 'Run it automatically', 'the iPad follows the checkout: welcome → ticket → tip → approve / cash → thank you. Staff only step in when something needs a decision.')}
        {s.auto && <div className="space-y-2 pl-6">{check('autoTip', 'Ask for the tip automatically', 'when staff choose Cash or Card on file, once per ticket')}
          {check('offerKeepChange', 'Offer “Keep the change as a tip” on cash sales')}</div>}
      </div>
      <div className="space-y-3 text-sm"><p className="font-semibold">Moments</p>
        <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={m.birthday.on} disabled={!canEdit} onChange={(e) => setM({ birthday: { ...m.birthday, on: e.target.checked } })} /> 🎂 Birthday</label>
          {m.birthday.on && <><div className="flex flex-wrap gap-2">{([['day', 'On the day'], ['week', 'Their birthday week'], ['month', 'Their birthday month']] as const).map(([k, l]) =>
            <button key={k} type="button" disabled={!canEdit} aria-pressed={m.birthday.window === k} onClick={() => setM({ birthday: { ...m.birthday, window: k } })} className={`rounded-full border px-3 py-1 ${m.birthday.window === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
            {pctBox(m.birthday.rewardPct, (n) => setM({ birthday: { ...m.birthday, rewardPct: n } }), 'Birthday treat')}<p className="text-xs text-muted-foreground">Once a year. Needs their birthday on their profile.</p></>}
        </div>
        <div className="rounded-2xl bg-slate-50 p-3"><label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={m.first.on} disabled={!canEdit} onChange={(e) => setM({ first: { on: e.target.checked } })} /> 👋 First visit — a warm welcome</label></div>
        <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={m.milestones.on} disabled={!canEdit} onChange={(e) => setM({ milestones: { ...m.milestones, on: e.target.checked } })} /> ✨ Visit milestones</label>
          {m.milestones.on && <><div className="flex flex-wrap items-center gap-2">On visits <input defaultValue={m.milestones.visits.join(', ')} disabled={!canEdit} aria-label="Milestone visits" onBlur={(e) => setM({ milestones: { ...m.milestones, visits: e.target.value.split(/[ ,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 1) } })} className="h-10 w-48 rounded-xl border px-3" /></div>
            {pctBox(m.milestones.rewardPct, (n) => setM({ milestones: { ...m.milestones, rewardPct: n } }), 'Thank-you')}</>}
        </div>
        <p className="text-xs text-muted-foreground">A treat never combines with discount codes or team discounts — whichever is bigger applies. Staff see it on the checkout; the client sees it on the iPad.</p>
      </div>
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
