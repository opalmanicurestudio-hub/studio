'use client';
// src/components/orders/workspace/DeliveryPane.tsx — A LOCAL DELIVERY, INSIDE THE ORDER (lib/delivery-plan). Where it
// goes and when it was promised, the customer's note for the driver, then its steps: out with whoever takes it (the
// person signed in is the driver), delivered, or brought back with the reason. One brought back can go out again.
import * as React from 'react';
import { addressLinesOf, oneLine } from '@/lib/address-flow';
import { markDelivered, markDeliveryFailed, markOutForDelivery } from '@/lib/fulfil-client';
import { firstName, itemCount } from '@/lib/orders-view';
import { formatTime } from '@/lib/tenant-time';
import { Btn, C, Sheet, feel, muted } from '../ui';

const REASONS = ['No one was there to take it', 'Couldn’t get in (gate, buzzer or door)', 'Couldn’t find the address', 'They asked us not to leave it', 'Something else'];
const shortDay = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };

/** When it was promised, in words: "Fri Oct 30, 2–4 pm" or "within 90 minutes, by 3:40 pm". */
export function deliveryWhen(order: any, shopZone: string): string {
  const d = order?.delivery || {};
  if (d.window?.label) return String(d.window.label);
  if (d.asap?.by) return `Within ${d.asap.minutes || 90} minutes, by ${formatTime(d.asap.by, shopZone)}`;
  return '';
}

export function DeliveryPane({ tenantId, order, shopZone, onToast }: { tenantId: string; order: any; shopZone: string; onToast: (m: string) => void }) {
  const [busy, setBusy] = React.useState('');
  const [failOpen, setFailOpen] = React.useState<{ why: string; other: string } | null>(null);
  const [err, setErr] = React.useState('');
  // Delivered completes the order (the sale goes through), so it's asked twice: tap, then confirm.
  const [sure, setSure] = React.useState(false);
  React.useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 6000); return () => clearTimeout(t); }, [sure]);
  const d = order.delivery || {};
  const stage = String(order.stage || '');
  const status = String(d.status || 'waiting');
  const who = firstName(order.customerName);
  const when = deliveryWhen(order, shopZone);
  const a = order.shippingAddress;
  const maps = a ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(oneLine(a))}` : '';

  const run = async (what: 'out' | 'done' | 'fail', reason = '') => {
    setBusy(what); setErr('');
    const r = what === 'out' ? await markOutForDelivery(tenantId, order.id) : what === 'done' ? await markDelivered(tenantId, order.id) : await markDeliveryFailed(tenantId, order.id, reason);
    setBusy(''); feel(!!r.ok);
    if (!r.ok) { setErr(r.message || 'That didn’t work. Try again.'); return; }
    if (what === 'fail') setFailOpen(null);
    onToast(r.message);
  };

  const where = (
    <div className="rounded-2xl p-4" style={{ background: C.soft }}>
      <p className="m-0 text-[13px] font-semibold" style={muted}>Deliver to</p>
      {addressLinesOf(a).map((l, i) => <p key={i} className={`m-0 ${i === 0 ? 'mt-0.5 text-[16px] font-semibold' : 'text-[15px]'}`}>{l}</p>)}
      <p className="m-0 mt-1.5 text-[14px]" style={muted}>{[when, `${itemCount(order)} item${itemCount(order) === 1 ? '' : 's'}`, order.customerPhone ? `Phone ${order.customerPhone}` : ''].filter(Boolean).join(' · ')}</p>
      {d.note && <p className="m-0 mt-2 rounded-xl px-3 py-2 text-[15px]" style={{ background: C.paper }}><span className="font-semibold">Note for the driver:</span> {d.note}</p>}
      {maps && <a href={maps} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-11 items-center text-[14.5px] font-semibold underline underline-offset-4">Directions</a>}
    </div>);

  if (stage === 'cancelled') return <p className="m-0 text-[15px]" style={muted}>This order was canceled.</p>;
  if (stage === 'completed') return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={{ background: C.okSoft }}>
        <p className="m-0 text-[15px] font-semibold" style={{ color: C.ok }}>Delivered{d.deliveredAt ? ` ${shortDay(d.deliveredAt)}, ${formatTime(d.deliveredAt, shopZone)}` : order.completedAt ? ` ${shortDay(order.completedAt)}` : ''}{d.deliveredByName ? ` by ${firstName(d.deliveredByName)}` : ''}</p>
      </div>
      {where}
    </div>);
  if (['paid', 'picking'].includes(stage)) return (
    <div className="space-y-3">
      {where}
      <p className="m-0 text-[14px]" style={muted}>Once it’s packed, whoever drives takes it out from here.</p>
    </div>);

  return (
    <div className="space-y-3">
      {status === 'out' ? (
        <div className="rounded-2xl p-4" style={{ background: C.soft }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>On its way</p>
          <p className="m-0 mt-0.5 text-[17px] font-semibold">With {firstName(d.driverName) || 'a driver'}{d.outAt ? ` since ${formatTime(d.outAt, shopZone)}` : ''}</p>
          {Number(d.tries) > 1 && <p className="m-0 text-[13px]" style={muted}>Try {d.tries}</p>}
        </div>
      ) : status === 'failed' ? (
        <div className="rounded-2xl p-4" style={{ background: C.warnSoft }}>
          <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>Brought back{d.failedAt ? ` at ${formatTime(d.failedAt, shopZone)}` : ''}</p>
          <p className="m-0 mt-0.5 text-[14px]" style={{ color: C.warn }}>{d.failReason ? `${String(d.failReason).replace(/[.!?]$/, '')}.` : 'It couldn’t be delivered.'} Talk to {who} about another time, then send it out again, or cancel it from More.</p>
        </div>
      ) : (
        <div className="rounded-2xl p-4" style={{ background: C.soft }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>{stage === 'ready' ? 'Shelf' : 'Packed'}</p>
          <p className="m-0 mt-0.5 text-[17px] font-semibold">{stage === 'ready' ? (order.shelfSlot ? `Spot ${order.shelfSlot}, waiting for a driver` : 'Waiting for a driver') : 'Ready to go out'}</p>
        </div>
      )}
      {where}
      <div className="flex flex-wrap gap-2">
        {status === 'out' ? (<>
          {sure ? (<>
            <Btn kind="primary" className="flex-1" disabled={!!busy} onClick={() => { setSure(false); void run('done'); }}>{busy === 'done' ? 'Saving…' : `Yes, ${who} has it`}</Btn>
            <Btn kind="soft" className="flex-1" disabled={!!busy} onClick={() => setSure(false)}>Not yet</Btn>
          </>) : (<>
            <Btn kind="primary" className="flex-1" disabled={!!busy} onClick={() => setSure(true)}>{busy === 'done' ? 'Saving…' : 'Delivered'}</Btn>
            <Btn kind="soft" className="flex-1" disabled={!!busy} onClick={() => setFailOpen({ why: REASONS[0], other: '' })}>Couldn’t deliver</Btn>
          </>)}
        </>) : (
          <Btn kind="primary" className="flex-1" disabled={!!busy} onClick={() => void run('out')}>{busy === 'out' ? 'Saving…' : status === 'failed' ? 'Send it out again with me' : 'I’m taking it out'}</Btn>
        )}
      </div>
      {err && <p role="alert" className="m-0 text-[15px]" style={{ color: C.warn }}>{err}</p>}
      <p className="m-0 text-[13px]" style={muted} aria-live="polite">{status === 'out' ? (sure ? 'Delivered completes the order. Confirm it’s with them, or left where they asked.' : 'Mark it delivered once it’s with them, or left where they asked.') : 'Whoever taps this is the driver.'}</p>

      {failOpen && (
        <Sheet title="Couldn’t deliver" sub="It goes back on the ready shelf, and the order says why." onClose={() => setFailOpen(null)}>
          <div className="space-y-2 pt-2" role="radiogroup" aria-label="What happened">
            {REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={failOpen.why === r} onClick={() => setFailOpen({ ...failOpen, why: r })}
                className="cf-press flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-[15px]" style={{ background: failOpen.why === r ? C.ink : C.soft, color: failOpen.why === r ? C.paper : C.ink }}>{r}</button>))}
            {failOpen.why === 'Something else' && (
              <input value={failOpen.other} maxLength={120} placeholder="What happened" aria-label="What happened"
                onChange={(e) => setFailOpen({ ...failOpen, other: e.target.value })} className="h-12 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: C.line }} />)}
            <Btn kind="primary" className="mt-2 w-full" disabled={!!busy} onClick={() => void run('fail', failOpen.why === 'Something else' && failOpen.other.trim() ? failOpen.other.trim() : failOpen.why)}>{busy === 'fail' ? 'Saving…' : 'Bring it back'}</Btn>
          </div>
        </Sheet>)}
    </div>);
}
