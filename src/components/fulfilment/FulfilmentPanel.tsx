'use client';
// src/components/fulfilment/FulfilmentPanel.tsx — ONLINE ORDERS IN THE STAFF PORTAL. Everything a packing team member
// does, signed in with their own PIN, so every pick, pack, label and handover is credited to them (on a shared device
// too). What appears depends on their job (lib/fulfilment-access): pickers pick; packers also finish orders and hand
// over pickups; shippers also buy labels. The same engine and screens as the Orders app, so nothing drifts.
//
//   1. Take next, or scan any item: the most urgent order is yours.
//   2. Walk the shelf list (three orders wanting the same oil is one trip) and scan each item in.
//   3. The last item finishes the order: shipping waits for a label, pickup goes on the shelf and the customer is told.
//   4. Ship it (label or tracking), or hand it over when they arrive.
import * as React from 'react';
import { collection, doc, getDoc, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { permissionsFor } from '@/lib/fulfilment-access';
import { claimNextBatch, claimSpecificOrder, recordItemScan } from '@/lib/retail-fulfill';
import { finishPacking } from '@/lib/orders-flow';
import { codesMatch, parseProductQr, type RetailOrder } from '@/lib/retail-orders';
import { dueLine, firstName, itemCount, methodLabel, orderNum, packQueue, packProgress } from '@/lib/orders-view';
import { Btn, C, Empty, Initials, ListRow, UndoBar, feel, muted, Ic } from '@/components/orders/ui';
import { MissingSheet } from '@/components/orders/MissingSheet';
import { ShipSheet } from '@/components/orders/ShipSheet';
import { HandoverSheet } from '@/components/orders/HandoverSheet';
import { binMatches, compareBins } from '@/lib/bins';
import { staffAuthHeader } from '@/lib/staff-fetch';

type BoardOrder = RetailOrder & { id: string } & Record<string, any>;
const ACTIVE = ['paid', 'picking', 'packed', 'ready', 'arrived'];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1"><p className="m-0 text-[13px] font-semibold" style={muted}>{title}</p>{sub ? <span className="text-[13px]" style={muted}>{sub}</span> : null}</div>
      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: C.line }}>{children}</div>
    </section>);
}

export function FulfilmentPanel({ tenantId, firestore, staffMember }: {
  tenantId: string; firestore: Firestore | null; staffMember: { id: string; name: string; role?: string; fulfilmentRole?: string };
}) {
  const fs = firestore as Firestore;
  const perms = React.useMemo(() => permissionsFor(staffMember as any), [staffMember]);
  const actor = React.useMemo(() => ({ id: staffMember.id, name: staffMember.name }), [staffMember]);
  const [orders, setOrders] = React.useState<BoardOrder[]>([]);
  const [rs, setRs] = React.useState<any>({});
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [missing, setMissing] = React.useState<{ order: BoardOrder; line: any } | null>(null);
  const [shipId, setShipId] = React.useState<string | null>(null);
  const [handId, setHandId] = React.useState<string | null>(null);
  const [showMissing, setShowMissing] = React.useState(false);

  React.useEffect(() => {
    if (!fs || !tenantId) return;
    getDoc(doc(fs, 'tenants', tenantId)).then((s) => setRs((s.data() as any)?.retailSettings || {})).catch(() => {});
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ACTIVE)),
      (snap) => { setOrders(snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }))); setLoading(false); }, () => setLoading(false));
  }, [fs, tenantId]);

  const byId = React.useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const queue = React.useMemo(() => packQueue(orders, rs).filter((o: any) => o.stage === 'paid' && !o.batchId && !o.waveId), [orders, rs]);
  const mine = React.useMemo(() => orders.filter((o) => o.stage === 'picking' && (o.claimedBy === staffMember.id || o.assignedTo === staffMember.id)), [orders, staffMember.id]);
  const toFinish = React.useMemo(() => perms.canPack ? orders.filter((o) => o.stage === 'picking' && !mine.includes(o) && packProgress(o).total > 0 && packProgress(o).done >= packProgress(o).total) : [], [orders, mine, perms.canPack]);
  const toShip = React.useMemo(() => perms.canShip ? orders.filter((o) => o.stage === 'packed' && o.method === 'ship' && o.holdForReview !== true) : [], [orders, perms.canShip]);
  const shelfOrders = React.useMemo(() => perms.canPack ? orders.filter((o) => ['ready', 'arrived'].includes(o.stage) && o.method !== 'ship').sort((a, b) => Number(b.stage === 'arrived') - Number(a.stage === 'arrived')) : [], [orders, perms.canPack]);

  // Bins and weights for the products in hand, asked of the server (the portal can't read product records directly).
  const [info, setInfo] = React.useState<Record<string, { bin: string; overflow: string; weightOz: number | null }>>({});
  const wantIds = React.useMemo(() => [...new Set([...mine, ...toShip].flatMap((o) => (o.lines || []).map((l: any) => String(l.productId || ''))).filter(Boolean))].sort().join(','), [mine, toShip]);
  React.useEffect(() => {
    const ids = wantIds ? wantIds.split(',').filter((id) => !info[id]) : [];
    if (!ids.length) return;
    let gone = false;
    void (async () => {
      try {
        const r = await fetch('/api/retail/pick-info', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, productIds: ids }) });
        const d = await r.json().catch(() => ({}));
        if (!gone && d?.items) setInfo((prev) => { const next = { ...prev }; ids.forEach((id) => { next[id] = d.items[id] || { bin: '', overflow: '', weightOz: null }; }); return next; });
      } catch { /* bins are a help, not a requirement */ }
    })();
    return () => { gone = true; };
  }, [wantIds, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const weights = React.useMemo(() => Object.entries(info).map(([id, v]) => ({ id, weightOz: v.weightOz ?? undefined })), [info]);

  const shelf = React.useMemo(() => {
    const m = new Map<string, { key: string; name: string; needed: number; scanned: number; nums: string[]; bin: string; overflow: string }>();
    mine.forEach((o) => (o.lines || []).forEach((l: any) => {
      if (l.digital === true || ['shorted', 'refunded', 'backordered'].includes(l.status)) return;
      const need = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)); if (need <= 0) return;
      const key = `${l.productId}|${l.optionsLabel || ''}`;
      const row = m.get(key) || { key, name: `${l.name}${l.optionsLabel ? ` · ${l.optionsLabel}` : ''}`, needed: 0, scanned: 0, nums: [], bin: info[l.productId]?.bin || '', overflow: info[l.productId]?.overflow || '' };
      row.needed += need; row.scanned += Math.min(l.qtyScanned || 0, need); row.nums.push(orderNum(o)); m.set(key, row);
    }));
    return [...m.values()].sort((a, b) => Number(a.scanned >= a.needed) - Number(b.scanned >= b.needed) || compareBins(a.bin, b.bin) || a.name.localeCompare(b.name));
  }, [mine, info]);
  const left = shelf.reduce((a, r) => a + Math.max(0, r.needed - r.scanned), 0);

  const say = (m: string, ok = true) => { feel(ok); setToast(m); };
  const finish = async (o: BoardOrder) => {
    const r = await finishPacking(fs, tenantId, o, orders, actor as any, rs);
    say(r.ok ? (o.method === 'ship' ? `${orderNum(o)} packed. It’s ready for a label.` : `${orderNum(o)} is on the shelf${(r as any).slot ? ` at ${(r as any).slot}` : ''}. ${firstName(o.customerName)} has been told.`) : r.message, r.ok);
  };
  const takeNext = async () => {
    if (!fs || busy) return;
    if (mine.length >= perms.claimLimit) { say(`Finish what you have first. Your job holds up to ${perms.claimLimit} at a time.`, false); return; }
    setBusy('take');
    try { const r = await claimNextBatch(fs, tenantId, actor as any, perms.claimLimit - mine.length); if ('error' in r) say(r.error, false); else say(`${r.orderIds.length === 1 ? 'An order is' : `${r.orderIds.length} orders are`} yours. Start scanning.`); }
    finally { setBusy(''); }
  };
  const onScan = async (value: string) => {
    if (!fs || busy) return;
    setBusy('scan');
    try {
      for (const o of mine) {
        const r = await recordItemScan(fs, tenantId, o.id, value, actor as any);
        if (r.ok) {
          say(`${orderNum(o)} · ${r.message}`);
          if ((r as any).pickComplete && perms.canPack) await finish(o);
          return;
        }
      }
      const atBin = shelf.find((r) => r.scanned < r.needed && binMatches(r.bin, value));
      if (atBin) { say(`You’re at ${atBin.bin}. Grab ${atBin.needed - atBin.scanned} × ${atBin.name}.`); return; }
      const raw = value.trim(); const pid = parseProductQr(raw);
      const owner = queue.find((o) => (o.lines || []).some((l: any) => (pid && l.productId === pid) || l.productId === raw || codesMatch(l.barcode, raw) || codesMatch(l.sku, raw)));
      if (owner && mine.length < perms.claimLimit) {
        const grab = await claimSpecificOrder(fs, tenantId, owner.id, actor as any);
        if (!('error' in grab)) { const r2 = await recordItemScan(fs, tenantId, owner.id, value, actor as any); if (r2.ok) { say(`${orderNum(owner)} is yours · ${r2.message}`); return; } }
      }
      say(owner ? 'That item’s order would put you over your limit. Finish one first.' : 'None of the waiting orders need that item.', false);
    } finally { setBusy(''); }
  };

  if (!perms.canPick) return <Empty title="Online orders aren’t part of your job" sub="Ask a manager if you should be packing orders." />;

  return (
    <div className="pb-6" style={{ color: C.ink }}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0"><h2 className="m-0 text-[28px] font-light tracking-[-0.02em]">Orders</h2><p className="m-0 mt-0.5 text-[15px]" style={muted}>{loading ? 'Loading…' : `${queue.length} waiting · you have ${mine.length} of ${perms.claimLimit}`}</p></div>
        <Btn kind="primary" onClick={() => void takeNext()} disabled={busy === 'take' || queue.length === 0 || mine.length >= perms.claimLimit}>{busy === 'take' ? 'Taking…' : 'Take next'}</Btn>
      </div>

      {mine.length > 0 && (
        <section className="cf-anim-rise mt-5 rounded-2xl border-2 p-4" style={{ borderColor: C.ink }}>
          <p className="m-0 text-[17px] font-semibold">{left > 0 ? `${left} item${left === 1 ? '' : 's'} to grab` : 'All in'}</p>
          <p className="m-0 mt-0.5 text-[14px]" style={muted}>{mine.map((o) => `${orderNum(o)} ${firstName(o.customerName)}`).join(' · ')}</p>
          <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy === 'scan'} label="Scan each item as it goes in" /></div>
          <div className="mt-3">
            {shelf.map((r) => { const done = r.scanned >= r.needed; return (
              <div key={r.key} className="flex min-h-[56px] items-center gap-3 border-b py-2.5" style={{ borderColor: C.line, opacity: done ? 0.5 : 1 }}>
                <span key={done ? 'd' : 'n'} className={`${done ? 'cf-anim-pop ' : ''}grid h-7 w-7 shrink-0 place-items-center rounded-full border-2`} style={done ? { background: C.ok, borderColor: C.ok } : { borderColor: '#d2d3d7' }}>{done ? Ic.check : null}</span>
                {r.bin ? <span className="shrink-0 rounded-lg px-2 py-1 font-mono text-[13px] font-semibold" style={done ? { background: C.soft, color: C.muted } : { background: C.ink, color: C.paper }}>{r.bin}</span> : null}
                <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold">{r.name}</span><span className="block truncate text-[13px]" style={muted}>{[r.nums.join(' · '), r.overflow ? `Overflow: ${r.overflow}` : ''].filter(Boolean).join(' · ')}</span></span>
                <span className="shrink-0 text-[15px] font-semibold">{r.scanned}/{r.needed}</span>
              </div>); })}
          </div>
          <button type="button" onClick={() => setShowMissing((v) => !v)} className="mt-3 h-11 text-[15px] font-semibold" style={muted}>{showMissing ? 'Hide' : 'Something missing?'}</button>
          {showMissing && <div className="cf-anim-rise mt-1 flex flex-wrap gap-2">
            {mine.flatMap((o) => (o.lines || []).filter((l: any) => !l.digital && !['shorted', 'refunded', 'backordered'].includes(l.status) && (l.qtyScanned || 0) < (l.qtyOrdered || 0) - (l.qtyShorted || 0)).map((l: any) => (
              <button key={`${o.id}-${l.lineId}`} type="button" onClick={() => setMissing({ order: o, line: l })} className="cf-press h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: C.soft }}>{l.name} ({orderNum(o)})</button>)))}
          </div>}
        </section>)}

      {toFinish.length > 0 && (
        <Section title="Picked, ready to finish">
          {toFinish.map((o) => <ListRow key={o.id} lead={<Initials name={o.customerName} />} title={o.customerName} detail={`${orderNum(o)} · ${methodLabel(o.method)} · picked by ${firstName(o.claimedByName) || 'someone'}`} trail={<Btn kind="primary" className="h-10 px-4 text-[14px]" onClick={() => void finish(o)}>Finish</Btn>} />)}
        </Section>)}

      {toShip.length > 0 && (
        <Section title="Ready to ship" sub={`${toShip.length}`}>
          {toShip.map((o) => <ListRow key={o.id} onClick={() => setShipId(o.id)} lead={<Initials name={o.customerName} />} title={o.customerName} detail={`${orderNum(o)} · ${o.labelUrl || o.trackingNumber ? 'Label bought' : 'Needs a label'}${o.groundOnly ? ' · ground only' : ''}`} trail={<span style={muted}>{Ic.chev}</span>} />)}
        </Section>)}

      {shelfOrders.length > 0 && (
        <Section title="Pickup shelf" sub={`${shelfOrders.length}`}>
          {shelfOrders.map((o) => <ListRow key={o.id} onClick={() => setHandId(o.id)} lead={<Initials name={o.customerName} />} title={o.customerName}
            detail={[o.stage === 'arrived' ? `Outside${o.curbside?.spotOrVehicle ? ` in ${o.curbside.spotOrVehicle}` : ''}` : methodLabel(o.method), o.shelfSlot ? `Shelf ${o.shelfSlot}` : '', `${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            trail={<span className="text-[14px] font-semibold" style={o.stage === 'arrived' ? { color: C.warn } : muted}>{o.stage === 'arrived' ? 'Now' : 'Hand over'}</span>} />)}
        </Section>)}

      <Section title="Waiting to be picked" sub={queue.length ? `${queue.length}` : undefined}>
        {!loading && queue.length === 0 ? <p className="m-0 px-4 py-8 text-center text-[15px]" style={muted}>Nothing waiting. Nice work.</p>
          : queue.slice(0, 12).map((o) => { const d = dueLine(o, rs); return <ListRow key={o.id} lead={<Initials name={o.customerName} />} title={o.customerName} detail={`${orderNum(o)} · ${methodLabel(o.method)} · ${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`} trail={<span className="text-[14px]" style={d.late ? { color: C.warn, fontWeight: 600 } : muted}>{d.text}</span>} />; })}
      </Section>

      {missing && <MissingSheet fs={fs} tenantId={tenantId} order={missing.order} line={missing.line} actor={actor as any} onClose={() => setMissing(null)} onDone={(m) => { setMissing(null); say(m); }} />}
      {shipId && byId.get(shipId) && <ShipSheet fs={fs} tenantId={tenantId} order={byId.get(shipId)} inventory={weights} rs={rs} actor={actor as any} onClose={() => setShipId(null)} onDone={(m) => { setShipId(null); say(m); }} />}
      {handId && byId.get(handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={byId.get(handId)} actor={actor as any} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); say(m); }} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={110} />}
    </div>);
}
