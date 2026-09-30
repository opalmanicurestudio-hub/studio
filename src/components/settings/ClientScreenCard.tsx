'use client';
// src/components/settings/ClientScreenCard.tsx — THE CLIENT SCREEN (Settings → Payments). Saves once you pause typing.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { clientScreenSettingsOf } from '@/lib/client-screen';
import { momentSettingsOf } from '@/lib/moments';
import { rebookSettingsOf } from '@/lib/client-screen';

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
  const rb = rebookSettingsOf({ clientScreen: s }); const setRb = (patch: any) => save({ ...s, rebook: { ...rb, ...patch } });
  const pctBox = (v: number, on: (n: number) => void, label: string) => <span className="flex items-center gap-1">{label} <input type="number" inputMode="numeric" min={0} max={100} value={v || ''} placeholder="0" disabled={!canEdit} aria-label={label} onChange={(e) => on(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="h-10 w-16 rounded-xl border px-2 text-right" />% off services <span className="text-xs text-muted-foreground">(blank = just a greeting)</span></span>;
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Client screen</p>
        <p className="text-sm text-muted-foreground">An iPad at the desk facing the client: they see the ticket as you ring it up, choose a tip, approve card-on-file charges (and sign), and get their receipt. Pair it from the POS → Client screen.</p></div>
      <div className="space-y-2 text-sm"><p className="font-semibold">How it runs</p>
        {check('auto', 'Run it automatically', 'the iPad follows the checkout: welcome → ticket → tip → approve / cash → thank you. Staff only step in when something needs a decision.')}
        {s.auto && <div className="space-y-2 pl-6">{check('autoTip', 'Ask for the tip automatically on card-on-file charges', 'once per ticket, before they approve')}
          {check('offerKeepChange', 'Cash: show the total, then their change with “Keep it as a tip” / “My change, please”')}</div>}
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
      <div className="space-y-2 text-sm"><p className="font-semibold">Book the next visit</p>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={rb.on} disabled={!canEdit} onChange={(e) => setRb({ on: e.target.checked })} /><span><b>Offer “Book your next visit”</b> after they pay <span className="text-muted-foreground">— suggests the service they come back for (set on each service), at their usual day and time, with their provider first</span></span></label>
        {rb.on && <div className="space-y-2 pl-6">
          <div className="flex flex-wrap items-center gap-2">Show <input type="number" min={1} max={6} value={rb.suggestCount} disabled={!canEdit} onChange={(e) => setRb({ suggestCount: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })} className="h-10 w-16 rounded-xl border px-2 text-right" aria-label="Suggested times" /> suggested times
            · quick picks <input defaultValue={rb.quickWeeks.join(', ')} disabled={!canEdit} onBlur={(e) => setRb({ quickWeeks: e.target.value.split(/[ ,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) })} className="h-10 w-32 rounded-xl border px-3" aria-label="Quick picks in weeks" /> weeks</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rb.otherProviders} disabled={!canEdit} onChange={(e) => setRb({ otherProviders: e.target.checked })} /> Offer other providers if theirs is booked up</label>
          <p className="font-semibold">Deposits (when the booking needs one)</p>
          <div className="flex flex-wrap gap-2">{([['hold', 'Saved card: hold until the visit'], ['charge', 'Saved card: charge now']] as const).map(([k, l]) =>
            <button key={k} type="button" disabled={!canEdit} aria-pressed={rb.cardMode === k} onClick={() => setRb({ cardMode: k })} className={`rounded-full border px-3 py-1 ${rb.cardMode === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rb.payNow} disabled={!canEdit} onChange={(e) => setRb({ payNow: e.target.checked })} /> Pay the deposit now on their phone (QR code)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rb.payLater} disabled={!canEdit} onChange={(e) => setRb({ payLater: e.target.checked })} /> Pay later — send them a link (their time is held)</label>
          <div className="flex flex-wrap items-center gap-2">Pre-book reward <input type="number" min={0} max={50} value={rb.prebookPct || ''} placeholder="0" disabled={!canEdit} onChange={(e) => setRb({ prebookPct: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} className="h-10 w-16 rounded-xl border px-2 text-right" aria-label="Pre-book reward percent" />% off services at that visit <span className="text-xs text-muted-foreground">(0 = none; never combines with other discounts)</span></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rb.standing} disabled={!canEdit} onChange={(e) => setRb({ standing: e.target.checked })} /> Offer a standing appointment ({rb.standingCount} visits at the same time)</label>
          {rb.standing && <div className="flex items-center gap-2 pl-6"><input type="number" min={2} max={6} value={rb.standingCount} disabled={!canEdit} onChange={(e) => setRb({ standingCount: Math.max(2, Math.min(6, Number(e.target.value) || 3)) })} className="h-10 w-16 rounded-xl border px-2 text-right" aria-label="Standing visits" /> visits</div>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={rb.waitlist} disabled={!canEdit} onChange={(e) => setRb({ waitlist: e.target.checked })} /> Offer the waitlist when nothing fits</label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={rb.visitLink} disabled={!canEdit} onChange={(e) => setRb({ visitLink: e.target.checked })} /><span>Also offer it on their visit link after the visit <span className="text-muted-foreground">— for clients who said “Not today” (links work for 90 days)</span></span></label>
          <p className="text-xs text-muted-foreground">Deposit amounts follow your booking and rebooking rules. Booking needs the CRON_SECRET setting on your hosting (it’s already used by your reminders).</p>
        </div>}
      </div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Paying on the iPad</p>
        {check('payOnScreen', 'Let clients pay on the iPad', 'Stripe’s secure card form — card details never touch your system')}
        {check('payOnPhone', 'Let clients pay on their phone', 'a QR code on the iPad; Apple Pay and Google Pay on their own phone')}
        {check('offerSaveCard', 'Offer “Save my card for next time”', 'their own tick box — recorded as their consent')}
        <p className="text-xs text-muted-foreground">Needs Stripe connected (Settings → Payments). Your Stripe card reader works from the desk as before.</p>
      </div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Card on file</p>
        {check('signCardOnFile', 'Ask for a signature when approving a card-on-file charge', 'saved as a signed approval (useful if a charge is ever disputed)')}
        {s.signCardOnFile && <div className="flex flex-wrap items-center gap-2 pl-6">Only for charges of $<input type="number" inputMode="decimal" min={0} value={s.signOver || ''} placeholder="0" disabled={!canEdit} onChange={(e) => save({ ...s, signOver: Math.max(0, Number(e.target.value) || 0) })} className="h-10 w-24 rounded-xl border px-3 text-right" aria-label="Signature from this amount" /> or more <span className="text-xs text-muted-foreground">(blank = every charge)</span></div>}
      </div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Look and feel</p>
        <div className="flex flex-wrap gap-2">{([['lively', 'Lively'], ['calm', 'Calm'], ['off', 'No animation']] as const).map(([k, l]) =>
          <button key={k} type="button" disabled={!canEdit} aria-pressed={s.motion === k} onClick={() => save({ ...s, motion: k })} className={`rounded-full border px-4 py-1.5 ${s.motion === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
        <p className="text-xs text-muted-foreground">A slow glow in your brand colour on the welcome screen, steps that glide in, a tick that draws itself when they pay. The iPad’s own “Reduce Motion” setting always wins.</p>
        {check('confetti', 'Confetti for celebrations', 'birthdays, milestones, and when they leave a tip')}
        <div className="flex flex-wrap items-center gap-2">Back to your logo <input type="number" inputMode="numeric" min={5} max={120} value={s.returnAfter} disabled={!canEdit} onChange={(e) => save({ ...s, returnAfter: Math.max(5, Math.min(120, Number(e.target.value) || 20)) })} className="h-10 w-20 rounded-xl border px-3 text-right" aria-label="Seconds before returning to the logo" /> seconds after a sale</div>
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
