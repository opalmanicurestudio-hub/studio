'use client';
// src/components/orders/workspace/RecordPane.tsx — EVERY DOCUMENT AND THE WHOLE STORY OF ONE ORDER. The documents (the
// packing slip, the invoice, each box's label, the photos by box, a return label, the evidence pack for a claim, the bag
// label for a pickup, and the customer's own order page) open from here. Under them, everything that happened, in order:
// what the team did, what happened by itself (payments, the carrier), what the customer was told and what they wrote,
// with a filter for each.
import * as React from 'react';
import Link from 'next/link';
import { eventLine, firstName, money } from '@/lib/orders-view';
import { filterRecord, recordOf, type RecordFilter } from '@/lib/order-thread';
import { PACK_PHOTO_KIND_LABEL, packPhotosOf } from '@/lib/pack-photo';
import { labelSlots, tail } from '@/lib/label-boxes';
import { isZplLabel } from '@/lib/label-format';
import { openPrint } from '@/lib/open-print';
import { LabelHistory, labelTotals } from '../LabelHistory';
import { C, Sheet, muted } from '../ui';

const when = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
const day = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const time = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; };

/** The order's documents, as tiles (on the Record tab) or as a short list (beside the order). */
export function Documents({ tenantId, order, recs, returns, list, onToast }: { tenantId: string; order: any; recs: any[] | null; returns: any[]; list?: boolean; onToast: (m: string) => void }) {
  const [photosOpen, setPhotosOpen] = React.useState(false);
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const t = encodeURIComponent(order.qrToken || '');
  const photos = packPhotosOf(order);
  const slots = labelSlots(order).filter((s) => !s.voided && s.labelUrl);
  const ship = order.method === 'ship';
  const money$ = labelTotals(recs || []);
  const boxes = photos.reduce((m, p) => m.set(p.box, [...(m.get(p.box) || []), p]), new Map<number, typeof photos>());
  const tab = (url: string) => window.open(url, '_blank');
  const evidence = async () => { const e = await openPrint(tenantId, `evidence:${order.id}`, `/print/evidence/${tenantId}/${order.id}`); if (e) onToast(e); };
  type Doc = { key: string; title: string; sub: string; acts: { label: string; run?: () => void; href?: string }[] };
  const docs: Doc[] = [];
  if (order.qrToken && order.method !== 'digital') docs.push({ key: 'slip', title: 'Packing slip', sub: order.gift ? 'Gift: prices left off' : `${(order.lines || []).length} line${(order.lines || []).length === 1 ? '' : 's'}`, acts: [{ label: 'Print', run: () => tab(`/print/packing-slip/${tenantId}/${order.id}?t=${t}`) }] });
  if (order.qrToken) docs.push({ key: 'invoice', title: 'Invoice', sub: `${money(order.totalCents)}${(order.refundedCents || 0) > 0 ? ` · ${money(order.refundedCents)} refunded` : order.paidAt ? ' · paid' : ''}`, acts: [{ label: 'Open', run: () => tab(`/shop/${tenantId}/invoice/${order.id}?t=${t}`) }] });
  if (ship && (slots.length || (recs && recs.length))) docs.push({ key: 'labels', title: slots.length > 1 ? 'Labels' : 'Label', sub: slots.length ? slots.map((s) => `Box ${s.slot + 1} · ${tail(s.tracking)}`).join(', ') : `${recs?.length || 0} on record`,
    acts: [...(slots.length === 1 ? [{ label: isZplLabel(slots[0].labelUrl) ? 'Printer file' : 'Print', run: () => tab(slots[0].labelUrl) }] : slots.length > 1 ? [{ label: 'Print all', run: () => void openPrint(tenantId, 'orders', `/print/labels/${tenantId}?ids=${order.id}`).then((e) => { if (e) onToast(e); }) }] : []), ...(recs && recs.length ? [{ label: 'History', run: () => setLabelsOpen(true) }] : [])] });
  docs.push({ key: 'photos', title: 'Photos', sub: photos.length ? [...boxes.entries()].sort((a, b) => a[0] - b[0]).map(([b, ps]) => `Box ${b}: ${ps.map((p) => (p.kind === 'contents' ? 'open' : PACK_PHOTO_KIND_LABEL[p.kind].toLowerCase())).join(', ')}`).join(' · ') : 'None yet', acts: photos.length ? [{ label: 'View', run: () => setPhotosOpen(true) }] : [] });
  if (!list) docs.push({ key: 'evidence', title: 'Evidence pack', sub: 'Scans, photos, weights and carrier scans, for a claim', acts: [{ label: 'Open', href: `/retail-orders/evidence/${order.id}` }, { label: 'Print', run: () => void evidence() }] });
  const withLabel = (returns || []).filter((r) => r.labelUrl);
  if (!list && ship) docs.push({ key: 'return', title: 'Return label', sub: withLabel.length ? withLabel.map((r) => `${String(r.status || 'open')}${r.labelTrackingNumber ? ` · ${tail(r.labelTrackingNumber)}` : ''}`).join(', ') : (returns || []).length ? 'Return started, no label yet' : 'None', acts: withLabel.map((r, i) => ({ label: withLabel.length > 1 ? `Open ${i + 1}` : 'Open', run: () => tab(r.labelUrl) })) });
  if (!list && order.qrToken && !ship && order.method !== 'digital') docs.push({ key: 'bag', title: 'Bag label', sub: order.method === 'delivery' ? 'For the shelf: their name, order and where it goes' : 'For the shelf: their name, order and pickup code', acts: [{ label: 'Print', run: () => tab(`/print/label/${tenantId}/${order.id}?t=${t}`) }] });
  if (!list) docs.push({ key: 'page', title: 'Their order page', sub: 'What they see: status, messages and updates', acts: [{ label: 'Open', run: () => tab(`/shop/${tenantId}/order/${order.id}`) }] });

  const act = (a: { label: string; run?: () => void; href?: string }) => a.href
    ? <Link key={a.label} href={a.href} className="h-9 content-center text-[14px] font-semibold underline underline-offset-4">{a.label}</Link>
    : <button key={a.label} type="button" onClick={a.run} className="h-9 text-[14px] font-semibold underline underline-offset-4">{a.label}</button>;

  return (
    <div>
      <p className="m-0 text-[13px] font-semibold" style={muted}>Documents</p>
      {list ? (
        <div className="mt-1">
          {docs.map((d) => (
            <div key={d.key} className="flex min-h-[48px] items-center justify-between gap-3 border-b py-1.5" style={{ borderColor: C.line }}>
              <span className="min-w-0 truncate text-[14.5px]">{d.title}{d.key === 'photos' && photos.length ? ` · ${photos.length}` : ''}</span>
              {d.acts.length ? <span className="flex shrink-0 gap-3">{d.acts.slice(0, 2).map(act)}</span> : <span className="shrink-0 text-[13.5px]" style={muted}>{d.sub}</span>}
            </div>))}
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {docs.map((d) => (
            <div key={d.key} className="flex min-h-[96px] flex-col gap-1 rounded-2xl border px-3.5 py-3" style={{ borderColor: C.line }}>
              <p className="m-0 text-[15px] font-semibold">{d.title}</p>
              <p className="m-0 flex-1 text-[13px] leading-snug" style={muted}>{d.sub}</p>
              {d.acts.length > 0 && <div className="flex flex-wrap gap-x-3">{d.acts.map(act)}</div>}
            </div>))}
        </div>)}
      {ship && money$.postage > 0 && !list && <p className="m-0 mt-2 text-[13px]" style={muted}>Postage {money(money$.postage)}{money$.waiting ? ` · ${money(money$.waiting)} on the way back` : ''}{money$.charges ? ` · ${money(money$.charges)} in carrier adjustments` : ''}</p>}
      {photosOpen && (
        <Sheet title="Photos of the boxes" sub={`${photos.length} photo${photos.length === 1 ? '' : 's'}, kept with the order`} onClose={() => setPhotosOpen(false)} closeLabel="Done" wide>
          {[...boxes.entries()].sort((a, b) => a[0] - b[0]).map(([b, ps]) => (
            <div key={b} className="mt-3">
              <p className="m-0 text-[14px] font-semibold">Box {b}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ps.map((p) => (
                  <figure key={p.url} className="m-0">
                    <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={`Box ${b}: ${PACK_PHOTO_KIND_LABEL[p.kind]}`} className="aspect-square w-full rounded-xl object-cover" /></a>
                    <figcaption className="mt-1 text-[12.5px]" style={muted}>{p.kind === 'contents' ? 'Open' : PACK_PHOTO_KIND_LABEL[p.kind]}{p.by ? ` · ${firstName(p.by)}` : ''}{p.at ? ` · ${when(p.at)}` : ''}</figcaption>
                  </figure>))}
              </div>
            </div>))}
        </Sheet>)}
      {labelsOpen && <LabelHistory order={order} recs={recs} onClose={() => setLabelsOpen(false)} />}
    </div>);
}

export function RecordPane({ tenantId, order, events, inbox, tickets, recs, returns, onToast }: { tenantId: string; order: any; events: any[] | null; inbox: any[]; tickets: any[]; recs: any[] | null; returns: any[]; onToast: (m: string) => void }) {
  const [f, setF] = React.useState<RecordFilter>('all');
  React.useEffect(() => { setF('all'); }, [order.id]);
  const who = firstName(order.customerName);
  const rows = React.useMemo(() => recordOf(events || [], inbox, tickets, eventLine), [events, inbox, tickets]);
  const list = filterRecord(rows, f);
  const chips: [RecordFilter, string][] = [['all', 'Everything'], ['told', `What ${who} was told`], ['customer', `What ${who} wrote`], ['team', 'The team'], ['system', 'Automatic']];
  const sideWord = (s: string, w: string) => (s === 'told' ? (w === 'Update sent' ? 'Update' : w) : s === 'customer' ? who : w);
  return (
    <div>
      <Documents tenantId={tenantId} order={order} recs={recs} returns={returns} onToast={onToast} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold" style={muted}>What happened</p>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {chips.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={f === id} onClick={() => setF(id)} className="h-8 rounded-full px-3 text-[13px] font-semibold" style={f === id ? { background: C.ink, color: C.paper } : { border: `1px solid ${C.line}`, background: C.paper, color: C.ink }}>{label}</button>))}
        </div>
      </div>
      <div className="mt-2">
        {events === null && <p className="m-0 py-6 text-[15px]" style={muted}>Loading the record…</p>}
        {events !== null && list.length === 0 && <p className="m-0 py-6 text-[15px]" style={muted}>Nothing here yet.</p>}
        {list.map((r) => (
          <div key={r.id} className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 border-b py-2.5 text-[14.5px] leading-snug" style={{ borderColor: C.line }}>
            <span className="text-[12.5px] leading-tight" style={muted}><span className="block">{day(r.at)}</span><span className="block">{time(r.at)}</span></span>
            <span className="min-w-0"><span className="mr-1.5 text-[12.5px] font-semibold" style={{ color: r.tone === 'warn' ? C.warn : r.tone === 'ok' ? C.ok : C.muted }}>{sideWord(r.side, r.who)}</span><span className="whitespace-pre-wrap">{r.text}</span></span>
          </div>))}
      </div>
    </div>);
}
