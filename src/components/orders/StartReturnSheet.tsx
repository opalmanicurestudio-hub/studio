'use client';
// src/components/orders/StartReturnSheet.tsx — START A RETURN ON THE ORDER (mockup 10D). At the counter or on the phone:
// what's coming back and why (a final-sale item only for a fault, as the server rules), how they get their money back
// (a refund to their card, store credit, or a replacement, each once it's checked in), and how it gets back: they're
// here with it, so it carries straight on into checking it in (scan or mark each item, its condition, and the refund),
// or a prepaid label is emailed to them. The return is opened on the server (api/retail/fulfil openReturn), which checks
// every count again; the customer sees it on their order page. Takes the place of the old Return desk page.
import * as React from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import { openReturn, type Actor } from '@/lib/fulfil-client';
import { returnRefundCents } from '@/lib/retail-orders';
import { returnableUnits } from '@/lib/return-reserve';
export { hasReturnable } from '@/lib/return-reserve';
import { canReturnLine, isFinalSaleLine } from '@/lib/return-eligibility';
import { startedAgo, windowEndsAt, windowOpen } from '@/lib/order-windows';
import { firstName, money, orderNum } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';
import { ReturnSheet } from './ReturnSheet';
import { Btn, C, Sheet, feel, muted } from './ui';

type Reason = 'defective' | 'changed_mind' | 'damaged_in_transit' | 'wrong_item' | 'other';
type Resolution = 'refund' | 'store_credit' | 'replacement';
const REASONS: { id: Reason; label: string }[] = [
  { id: 'defective', label: 'It doesn’t work' }, { id: 'changed_mind', label: 'Changed their mind' },
  { id: 'damaged_in_transit', label: 'Arrived damaged' }, { id: 'wrong_item', label: 'Wrong item' }, { id: 'other', label: 'Other' },
];
const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });


function Choice({ on, title, sub, onPick }: { on: boolean; title: string; sub?: string; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onPick} className="cf-press flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left" style={{ background: on ? C.soft : C.paper, border: `1px solid ${on ? C.ink : C.line}` }}>
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${on ? C.ink : C.line}` }}>{on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.ink }} />}</span>
      <span className="min-w-0"><span className="block text-[15px] font-semibold">{title}</span>{sub ? <span className="block text-[13px]" style={muted}>{sub}</span> : null}</span>
    </button>);
}

export function StartReturnSheet({ fs, tenantId, order, returns, actor, rs, canRefund, onClose, onDone }: {
  fs: Firestore; tenantId: string; order: any; returns: any[]; actor: Actor; rs: any; canRefund: boolean; onClose: () => void; onDone: (m: string) => void;
}) {
  const who = firstName(order.customerName);
  // Reports on the order (waiting, or put right) hold their units, as the server counts them.
  const [claims, setClaims] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    let live = true;
    getDocs(query(collection(fs, `tenants/${tenantId}/retailClaims`), where('orderId', '==', order.id), limit(30)))
      .then((s) => { if (live) setClaims(s.docs.map((d) => d.data())); }).catch(() => { if (live) setClaims([]); });
    return () => { live = false; };
  }, [fs, tenantId, order.id]);
  const lines = (order.lines || []).filter((l: any) => l?.lineId && l.digital !== true)
    .map((l: any) => ({ l, max: returnableUnits(l, claims || [], returns || []) }));
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [why, setWhy] = React.useState<Record<string, Reason>>({});
  const [res, setRes] = React.useState<Resolution>('refund');
  // A label to their email: a shipped order with its address, its link key and an email to send it to.
  const shipBack = order.method === 'ship' && !!order.shippingAddress && !!order.qrToken && !!String(order.customerEmail || '').trim();
  const [note, setNote] = React.useState('');
  // A scan while choosing what's coming back is heard here, not by the screen behind (which could start packing).
  const [heard, setHeard] = React.useState('');
  useWedgeScanner(() => { feel(false); setHeard('Pick what’s coming back first. Scan the items when you check them in.'); }, true, { layer: 'front' });
  const [how, setHow] = React.useState<'here' | 'label'>('here');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [checkIn, setCheckIn] = React.useState<any | null>(null);

  const picks = lines.filter((x: any) => (qty[x.l.lineId] || 0) > 0).map((x: any) => ({ lineId: x.l.lineId, qty: Math.min(qty[x.l.lineId], x.max), reason: why[x.l.lineId] }));
  const missingWhy = picks.some((p: any) => !p.reason);
  // A final-sale item comes back only for a fault (lib/return-eligibility), as the server rules.
  const blocked = picks.some((p: any) => p.reason && !canReturnLine(lines.find((x: any) => x.l.lineId === p.lineId)?.l, p.reason).allowed);
  const worth = picks.length ? returnRefundCents(order, picks.map((p: any) => ({ ...p, sku: '', name: '' })) as any) : 0;
  const days = Math.max(0, Math.floor(Number(rs?.returnWindowDays) || 0));
  const ends = windowEndsAt(order, days);
  const inWindow = windowOpen(order, days);
  const canCredit = !!String(order.customerEmail || '').trim();
  const ready = picks.length > 0 && !missingWhy && !blocked && claims !== null;

  const start = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    const r = await openReturn(fs, tenantId, order, picks as any, res, note.trim().slice(0, 500), actor);
    if (!r.ok || !r.returnId) { setBusy(false); feel(false); setErr(r.message || 'The return couldn’t be started. Try again.'); return; }
    if (how === 'here') {
      const s = await getDoc(doc(fs, `tenants/${tenantId}/retailReturns`, r.returnId)).catch(() => null);
      setBusy(false); feel(true);
      if (s?.exists()) { setCheckIn({ ...(s.data() as any), id: s.id }); return; }
      onDone(`Return started for ${who}. Check it in from Problems.`); return;
    }
    // Not here: a prepaid label to their email (api/retail/return-label). One that can't be made is listed in Problems,
    // with a way to send it again.
    try {
      const lr = await fetch('/api/retail/return-label', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, returnId: r.returnId, qrToken: order.qrToken || '' }) });
      const d = await lr.json().catch(() => ({}));
      feel(lr.ok);
      onDone(lr.ok ? `Return started. The prepaid label is on its way to ${who}’s email.` : `Return started, but the label couldn’t be made: ${String(d.error || 'try again').slice(0, 140)}. It’s listed in Problems to send again.`);
    } catch { onDone('Return started, but the label didn’t go. It’s listed in Problems to send again.'); }
    finally { setBusy(false); }
  };

  if (checkIn) return <ReturnSheet fs={fs} tenantId={tenantId} ret={checkIn} initialOrder={order} actor={actor} rs={rs} canRefund={canRefund} onClose={() => onDone(`Return started for ${who}. Check it in from the order, or from Problems.`)} onDone={onDone} />;

  return (
    <Sheet title={`Start a return for ${who}`} sub={`${orderNum(order)}${ends ? inWindow ? ` · within the ${days}-day window until ${day(ends)}` : ` · past the ${days}-day window (${startedAgo(order)}). You can still take it back.` : ''}${rs?.returnsEnabled === false ? ' Online returns are off in your policies; you can still take one back here.' : ''}`} onClose={onClose} closeLabel="Not now">
      <p className="m-0 mt-3 text-[13px] font-semibold" style={muted}>What’s coming back</p>
      {claims === null ? <p className="m-0 mt-2 text-[14px]" style={muted}>Loading the order…</p> : (
        <div className="mt-1">
          {lines.map(({ l, max }: any) => {
            const q = Math.min(qty[l.lineId] || 0, max); const final = isFinalSaleLine(l);
            const v = why[l.lineId] ? canReturnLine(l, why[l.lineId] as any) : { allowed: true };
            return (
              <div key={l.lineId} className="border-b py-3" style={{ borderColor: C.line }}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[16px] font-semibold">{l.name}</p>
                    <p className="m-0 text-[13px]" style={muted}>{max <= 0 ? 'Already returned, refunded or part of a report' : final ? 'Final sale: only if it’s faulty, damaged or wrong' : `${max} can come back`}</p>
                  </div>
                  {max > 0 && (
                    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`How many ${l.name}`}>
                      <button type="button" aria-label={`One fewer ${l.name}`} disabled={q <= 0} onClick={() => setQty((s) => ({ ...s, [l.lineId]: Math.max(0, q - 1) }))} className="cf-press h-11 w-11 rounded-full text-[18px] disabled:opacity-40" style={{ background: C.soft }}>−</button>
                      <span className="w-7 text-center text-[16px] font-semibold" aria-live="polite">{q}</span>
                      <button type="button" aria-label={`One more ${l.name}`} disabled={q >= max} onClick={() => setQty((s) => ({ ...s, [l.lineId]: Math.min(max, q + 1) }))} className="cf-press h-11 w-11 rounded-full text-[18px] disabled:opacity-40" style={{ background: C.soft }}>+</button>
                    </div>)}
                </div>
                {q > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Why ${l.name} is coming back`}>
                    {REASONS.map((r) => {
                      const on = why[l.lineId] === r.id; const no = final && !['defective', 'damaged_in_transit', 'wrong_item'].includes(r.id);
                      return <button key={r.id} type="button" aria-pressed={on} disabled={no} onClick={() => setWhy((s) => ({ ...s, [l.lineId]: r.id }))}
                        className="cf-press h-11 rounded-full px-3.5 text-[14px] font-semibold disabled:opacity-40" style={on ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{r.label}</button>;
                    })}
                  </div>)}
                {q > 0 && !v.allowed && <p className="m-0 mt-1.5 text-[13px]" style={{ color: C.warn }}>{(v as any).message}</p>}
              </div>);
          })}
        </div>)}

      <p className="m-0 mt-4 text-[13px] font-semibold" style={muted} id="ret-res">How they get their money back</p>
      <div className="mt-1.5 space-y-2" role="group" aria-labelledby="ret-res">
        <Choice on={res === 'refund'} title="A refund to their card, once it’s checked in" onPick={() => setRes('refund')} />
        {canCredit && <Choice on={res === 'store_credit'} title="Store credit, once it’s checked in" sub="Kept with their email, ready at checkout" onPick={() => setRes('store_credit')} />}
        <Choice on={res === 'replacement'} title="A replacement" sub="Sent again at no charge once it’s checked in" onPick={() => setRes('replacement')} />
      </div>

      {shipBack && (
        <>
          <p className="m-0 mt-4 text-[13px] font-semibold" style={muted} id="ret-how">Getting it back</p>
          <div className="mt-1.5 space-y-2" role="group" aria-labelledby="ret-how">
            <Choice on={how === 'here'} title="They’re here with it" sub="Check it in now, in this sheet" onPick={() => setHow('here')} />
            <Choice on={how === 'label'} title="Email them a prepaid label" sub="It waits in Problems until it comes back" onPick={() => setHow('label')} />
          </div>
        </>)}

      {picks.length > 0 && res !== 'replacement' && (
        <div className="mt-4 rounded-2xl px-3.5 py-3" style={{ background: C.soft }}>
          <p className="m-0 text-[17px] font-semibold">{money(worth)} {res === 'refund' ? 'back to their card' : 'in store credit'}</p>
          <p className="m-0 mt-0.5 text-[13px]" style={muted}>Worked out from what they paid, with its tax. Your restocking fee applies only when they changed their mind{how === 'label' ? ', and return shipping comes off if your policy has them pay it' : ''}.</p>
        </div>)}
      <label className="mt-4 block text-[13px] font-semibold" style={muted}>Note for the team (optional)
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: box is dented, item looks unused" className="mt-1 h-11 w-full rounded-2xl border px-3.5 text-[15px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
      <p role="status" aria-live="polite" className="m-0 mt-2 text-[13px] empty:hidden" style={muted}>{heard}</p>
      {err && <p role="alert" className="m-0 mt-3 text-[14px]" style={{ color: C.warn }}>{err}</p>}
      {missingWhy && <p className="m-0 mt-3 text-[13px]" style={muted}>Say why each item is coming back.</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={!ready || busy} onClick={() => void start()}>
        {busy ? 'Starting…' : how === 'here' ? 'Start and check it in' : 'Start and email the label'}
      </Btn>
      <p className="m-0 mt-2 text-[12.5px] leading-snug" style={muted}>{how === 'here' ? `It carries straight on: scan each item or mark it, say what condition it’s in, and ${res === 'refund' ? 'send the refund' : res === 'store_credit' ? 'issue the credit' : 'send the replacement'}, all in this sheet.` : 'The label goes to their email and is on their order page.'} {who} sees the return and where it is on their order page.</p>
    </Sheet>);
}
