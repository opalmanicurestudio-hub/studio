'use client';
// src/components/orders/LabelHistory.tsx — EVERY LABEL AN ORDER HAS HAD (lib/label-records), newest first: what each
// cost, its boxes and where they are, who bought it and why, what happened to its refund, and any carrier
// adjustments since. The money totals at the top are what the order's shipping really cost.
import * as React from 'react';
import { collection, limit, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { Sheet, C, muted } from './ui';
import { firstName, money, orderNum } from '@/lib/orders-view';
import { boxTrail, labelKey, labelSlots, reasonLine, tail } from '@/lib/label-boxes';

const MOVED = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];
const day = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const ms = (v: unknown) => Date.parse(String(v || '')) || 0;

/** The order's label records, live, oldest first. Null while loading. */
export function useLabelRecords(fs: Firestore, tenantId: string, orderId: string): any[] | null {
  const [recs, setRecs] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    if (!fs || !tenantId || !orderId) { setRecs([]); return; }
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/shippingLabels`), where('orderIds', 'array-contains', orderId), limit(30)),
      (s) => setRecs(s.docs.map((d) => ({ ...(d.data() as any), id: d.id })).sort((a, b) => ms(a.boughtAt) - ms(b.boughtAt))), () => setRecs([]));
  }, [fs, tenantId, orderId]);
  return recs;
}

type Tone = 'ok' | 'warn' | 'plain';
const badgeStyle = (t: Tone): React.CSSProperties => (t === 'ok' ? { background: C.okSoft, color: C.ok } : t === 'warn' ? { background: C.warnSoft, color: C.warn } : { border: `1px solid ${C.line}`, color: C.muted });

/** Is this record the label the order carries now (all of it, or some of its boxes)? */
function isCurrent(rec: any, order: any): boolean {
  const recs: string[] = Array.isArray(order?.labelRecs) ? order.labelRecs : [];
  if (recs.length) return recs.includes(rec.id);
  return !!order?.shippoTransactionId && labelKey(order.shippoTransactionId) === rec.id;
}

export function labelTotals(recs: any[]): { postage: number; refunded: number; waiting: number; charges: number } {
  let spent = 0, refunded = 0, waiting = 0, charges = 0;
  for (const r of recs) {
    spent += Number(r.amountCents) || 0; refunded += Number(r.refundedCents) || 0; charges += Number(r.chargesCents) || 0;
    for (const e of Object.values(r.refunds || {}) as any[]) if (e?.status === 'requested') waiting += Number(e.cents) || 0;
  }
  return { postage: Math.max(0, spent - refunded), refunded, waiting, charges };
}

export function LabelHistory({ order, recs, onClose }: { order: any; recs: any[] | null; onClose: () => void }) {
  const list = recs || [];
  const t = labelTotals(list);
  const slots = labelSlots(order);
  const byId = new Map(list.map((r) => [r.id, r]));
  const head = [`Postage ${money(t.postage)}`, t.refunded ? `refunded ${money(t.refunded)}` : '', t.waiting ? `${money(t.waiting)} on the way back` : '', t.charges ? `extra charges ${money(t.charges)}` : ''].filter(Boolean).join(' · ');

  const card = (rec: any, no: number) => {
    const current = isCurrent(rec, order);
    const refunds: Record<string, any> = rec.refunds || {};
    const entries = Object.values(refunds) as any[];
    const boxes: any[] = Array.isArray(rec.boxes) ? rec.boxes : [];
    const n = Math.max(1, boxes.length);
    // Where each of its boxes is, as far as the order and the carrier know.
    const boxLine = (b: any): { text: string; tone: Tone } => {
      const s = slots.find((x) => x.txn && x.txn === b.txn);
      const r = refunds[b.txn];
      if (r?.status === 'refunded') return { text: `refunded ${money(r.cents)}`, tone: 'plain' };
      if (r?.status === 'denied') return { text: 'refund turned down', tone: 'warn' };
      if (r?.status === 'unconfirmed') return { text: 'refund not confirmed', tone: 'warn' };
      if (r?.status === 'requested') return { text: 'refund requested', tone: 'plain' };
      if (r?.status === 'refused') return { text: 'Shippo wouldn’t refund it', tone: 'warn' };
      if (s?.voided) return { text: 'voided · needs a new label', tone: 'warn' };
      if (b.replacedBy) return { text: 'replaced', tone: 'plain' };
      if (s) {
        const tr = boxTrail(order, s.slot);
        if (tr.status === 'DELIVERED') return { text: `delivered${day(tr.at) ? ` ${day(tr.at)}` : ''}`, tone: 'ok' };
        if (MOVED.includes(tr.status)) return { text: `with ${String(rec.carrier || 'the carrier').split(' ')[0]}${day(tr.at) ? ` since ${day(tr.at)}` : ''}`, tone: 'ok' };
        return { text: 'not scanned yet', tone: 'plain' };
      }
      return { text: '', tone: 'plain' };
    };
    const lines = boxes.map(boxLine);
    const badge: { text: string; tone: Tone } = (() => {
      if (current) {
        const mine = slots.filter((s) => (s.record ? s.record === rec.id : true));
        const trails = mine.map((s) => boxTrail(order, s.slot));
        if (mine.some((s) => s.voided)) return { text: 'A box needs a new label', tone: 'warn' };
        if (trails.length && trails.every((x) => x.status === 'DELIVERED')) { const last = day(trails.map((x) => x.at).sort().slice(-1)[0]); return { text: `Delivered${last ? ` ${last}` : ''}`, tone: 'ok' }; }
        if (trails.some((x) => MOVED.includes(x.status))) return { text: `With ${String(rec.carrier || 'the carrier').split(' ')[0]}`, tone: 'ok' };
        return { text: order.stage === 'shipped' ? 'Marked shipped' : 'Ready to go', tone: 'plain' };
      }
      if (entries.some((e) => e?.status === 'denied')) return { text: 'Refund turned down', tone: 'warn' };
      if (entries.some((e) => e?.status === 'requested')) return { text: 'Refund requested', tone: 'plain' };
      if (entries.some((e) => e?.status === 'unconfirmed')) return { text: 'Refund not confirmed', tone: 'warn' };
      const done = entries.filter((e) => e?.status === 'refunded').length;
      if (done && done >= n) return { text: 'Refunded', tone: 'plain' };
      if (done) return { text: 'Partly refunded', tone: 'plain' };
      if (rec.replacedBy) return { text: 'Replaced', tone: 'plain' };
      return { text: 'Voided', tone: 'plain' };
    })();
    // What happened to it, in order.
    const nextRec = rec.replacedBy ? byId.get(rec.replacedBy) : null;
    const steps: { text: string; sub: string; tone: Tone; at: number }[] = [];
    // The labels it replaced, by their number here: several when the old boxes were bought on more than one.
    const olds = (Array.isArray(rec.replaces?.ids) && rec.replaces.ids.length ? rec.replaces.ids : rec.replaces ? [rec.replaces.id] : []).map((id: string) => list.findIndex((x) => x.id === id) + 1).filter((k: number) => k > 0);
    const oldWords = olds.length > 1 ? `labels ${olds.slice(0, -1).join(', ')} and ${olds[olds.length - 1]}` : `label ${olds[0] || 'before it'}`;
    steps.push({ text: rec.replaces ? `Bought to replace ${oldWords}${rec.replaces?.slot != null ? `’s box ${rec.replaces.slot + 1}` : ''}${rec.reason ? `: ${reasonLine(rec.reason)}` : ''}` : 'Bought', sub: [day(rec.boughtAt), rec.boughtBy?.name ? firstName(rec.boughtBy.name) : '', rec.how === 'bulk' ? 'in a bulk buy' : ''].filter(Boolean).join(' · '), tone: 'plain', at: ms(rec.boughtAt) });
    if (rec.replacedBy) steps.push({ text: `Replaced${rec.replacedWhy ? `: ${reasonLine(rec.replacedWhy)}` : ''}`, sub: [day(rec.replacedAt), nextRec?.boughtBy?.name ? firstName(nextRec.boughtBy.name) : ''].filter(Boolean).join(' · '), tone: 'plain', at: ms(rec.replacedAt) });
    else if (rec.voidedAt) steps.push({ text: `Voided${rec.voidWhy ? `: ${String(rec.voidWhy).replace(/^voided by hand/, 'by hand')}` : ''}`, sub: day(rec.voidedAt), tone: 'plain', at: ms(rec.voidedAt) });
    const askedFor = entries.filter((e) => ['requested', 'refunded', 'denied', 'unconfirmed'].includes(String(e?.status)));
    const asked = askedFor.map((e) => ms(e?.requestedAt)).filter(Boolean).sort((a, b) => a - b)[0];
    if (asked) steps.push({ text: askedFor.length > 1 && askedFor.length < n ? `Refund requested for ${askedFor.length} of ${n} boxes` : askedFor.length === 1 && n > 1 ? 'Refund requested for 1 box' : 'Refund requested', sub: day(new Date(asked).toISOString()), tone: 'plain', at: asked + 1 });
    // Boxes whose refunds were settled the same day read as one step.
    const settled = new Map<string, { status: string; cents: number; boxes: number; at: number; why: string }>();
    for (const e of entries) {
      if (!['refunded', 'denied', 'unconfirmed', 'refused'].includes(String(e?.status))) continue;
      const k = `${e.status}|${day(e.doneAt)}`; const g = settled.get(k) || { status: String(e.status), cents: 0, boxes: 0, at: ms(e.doneAt), why: String(e.why || '') };
      g.cents += Number(e.cents) || 0; g.boxes += 1; g.at = Math.max(g.at, ms(e.doneAt)); settled.set(k, g);
    }
    for (const g of settled.values()) {
      if (g.status === 'refunded') steps.push({ text: `Refunded ${money(g.cents)}`, sub: `${day(new Date(g.at).toISOString())} · recorded in Money`, tone: 'ok', at: g.at });
      if (g.status === 'denied') steps.push({ text: `Turned down${g.boxes > 1 ? ` for ${g.boxes} boxes` : ''}: the carrier scanned it`, sub: day(new Date(g.at).toISOString()), tone: 'warn', at: g.at });
      if (g.status === 'unconfirmed') steps.push({ text: 'Not confirmed after 45 days', sub: 'Check it in Shippo', tone: 'warn', at: g.at });
      if (g.status === 'refused') steps.push({ text: `Shippo wouldn’t void ${g.boxes > 1 ? `${g.boxes} boxes` : 'one box'}, so ${money(g.cents)} isn’t coming back`, sub: [day(new Date(g.at).toISOString()), g.why].filter(Boolean).join(' · '), tone: 'warn', at: g.at });
    }
    steps.sort((a, b) => a.at - b.at);
    const charges = Object.values(rec.charges || {}).sort((a: any, b: any) => ms(a?.at) - ms(b?.at)) as any[];
    const insured = Number(rec.protection?.insuranceCents) || 0;
    const sig = String(rec.protection?.signature || 'NONE');
    const moving = slots.some((s) => s.record === rec.id && MOVED.includes(boxTrail(order, s.slot).status));
    const until = ms(rec.boughtAt) ? new Date(ms(rec.boughtAt) + 90 * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return (
      <div key={rec.id} className="rounded-[20px] px-4 py-3.5" style={{ border: `1px solid ${C.line}` }}>
        <div className="flex flex-wrap items-center gap-2"><span className="text-[16px] font-semibold">Label {no}</span><span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-semibold" style={badgeStyle(badge.tone)}>{badge.text}</span></div>
        <div className="mt-1.5 flex justify-between gap-2.5 text-[14px]"><span>{[rec.carrier, rec.service].filter(Boolean).join(' ') || 'Shipping label'} · {n > 1 ? `${n} boxes` : '1 box'}</span><span className="shrink-0">{rec.amountCents ? money(rec.amountCents) : ''}</span></div>
        {(insured > 0 || sig !== 'NONE') && <p className="m-0 mt-1 text-[14px]" style={muted}>{[insured > 0 ? `Insured for ${money(insured).replace(/\.00$/, '')}` : '', sig === 'ADULT' ? 'Adult signature' : sig !== 'NONE' ? 'Signature' : ''].filter(Boolean).join(' · ')}</p>}
        {boxes.map((b, i) => (
          <div key={b.txn || i} className="mt-1 flex justify-between gap-2.5 text-[14px]" style={muted}><span>{n > 1 ? `Box ${i + 1} ` : ''}{tail(b.tracking) || 'No tracking yet'}</span><span className="shrink-0 text-right" style={lines[i].tone === 'warn' ? { color: C.warn } : lines[i].tone === 'ok' ? { color: C.ok } : undefined}>{lines[i].text}</span></div>))}
        {charges.map((c: any, i: number) => (
          <div key={i} className="mt-2 rounded-2xl px-3.5 py-3 text-[14px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
            <div className="flex justify-between gap-2.5 font-semibold" style={{ color: C.ink }}><span>Carrier adjustment{day(c.at) ? `, ${day(c.at)}` : ''}{n > 1 && c.slot != null ? ` · box ${c.slot + 1}` : ''}</span><span className="shrink-0">{c.cents > 0 ? '+' : '−'}{money(Math.abs(c.cents))}</span></div>
            <span className="mt-0.5 block">{(() => { const d = String(c.description || '').trim() || (c.cents > 0 ? 'The carrier charged more after the label was bought' : 'The carrier gave some postage back'); return `${d}${/[.!?]$/.test(d) ? '' : '.'} Recorded in Money.`; })()}</span>
          </div>))}
        {current && !rec.replaces ? (
          <p className="m-0 mt-2 text-[14px]" style={muted}>Bought {day(rec.boughtAt)}{rec.boughtBy?.name ? ` by ${firstName(rec.boughtBy.name)}` : ''}{rec.how === 'bulk' ? ' in a bulk buy' : ''}</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {steps.map((s, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.tone === 'ok' ? C.ok : s.tone === 'warn' ? C.warn : C.line }} />
                <span className="flex-1"><span className="block text-[14.5px]">{s.text}</span>{s.sub && <span className="block text-[12.5px]" style={muted}>{s.sub}</span>}</span>
              </div>))}
          </div>)}
        {current && !moving && ['paid', 'picking', 'packed'].includes(String(order.stage)) && until && <p className="m-0 mt-2 text-[12.5px]" style={muted}>Can be voided for a refund until {until}, as long as it isn’t used.</p>}
      </div>);
  };

  return (
    <Sheet title="Shipping labels" sub={`${orderNum(order)} · ${head}`} onClose={onClose} closeLabel="Done">
      {recs === null ? <p className="m-0 py-6 text-[15px]" style={muted}>Loading labels…</p>
        : list.length === 0 ? <p className="m-0 py-6 text-[15px]" style={muted}>No labels bought here for this order yet. Labels bought before label records were kept show on the order’s record.</p>
        : <div className="mt-2 flex flex-col gap-3">{list.map((r, i) => ({ r, no: i + 1 })).reverse().map(({ r, no }) => card(r, no))}</div>}
      <p className="m-0 mt-4 text-center text-[12.5px] leading-snug" style={muted}>Refunds can be asked for within 90 days of buying a label. USPS labels work for 30 days.</p>
    </Sheet>);
}
