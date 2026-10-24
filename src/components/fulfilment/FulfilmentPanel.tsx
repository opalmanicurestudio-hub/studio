'use client';
// src/components/fulfilment/FulfilmentPanel.tsx — ONLINE ORDERS IN THE STAFF PORTAL. Everything a packing team member
// does, signed in with their own PIN, so every pick, pack, label and handover is credited to them (on a shared device
// too). What appears depends on their job (lib/fulfilment-access): pickers pick; packers also finish orders and hand
// over pickups; shippers also buy labels. The same engine and screens as the Orders app, so nothing drifts.
//
//   1. Take next, or scan any item: the most urgent order is yours.
//   2. Walk the shelf list (three orders wanting the same oil is one trip) and scan each item in.
//   3. The last item finishes the order: shipping waits for a label, pickup goes on the shelf and the customer is told.
//      With "Second scan at packing" on, an order picked at the shelf is scanned again, item by item, into the box first
//      (lib/retail-fulfill recordPackScan); a wave order's one scan is already at the box.
//   4. Ship it (label or tracking), or hand it over when they arrive.
import * as React from 'react';
import { collection, doc, getDoc, onSnapshot, query, updateDoc, where, type Firestore } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { permissionsFor } from '@/lib/fulfilment-access';
import { claimNextBatch, claimSpecificOrder, recordItemScan, recordPackScan } from '@/lib/retail-fulfill';
import { finishPacking } from '@/lib/orders-flow';
import { fulfilmentPolicy, isPackComplete, lineMatchesScan, type RetailOrder } from '@/lib/retail-orders';
import { dueLine, firstName, itemCount, methodLabel, orderNum, packQueue, packProgress } from '@/lib/orders-view';
import { tenantTimeZone } from '@/lib/tenant-time';
import { Btn, C, Empty, Initials, ListRow, UndoBar, feel, muted, Ic } from '@/components/orders/ui';
import { MissingSheet } from '@/components/orders/MissingSheet';
import { ShipSheet } from '@/components/orders/ShipSheet';
import { HandoverSheet } from '@/components/orders/HandoverSheet';
import { binMatches, compareBins } from '@/lib/bins';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { markLabelChecked, assignTote, looksLikeTracking, needsTote, orderForLabel, orderFromSlipScan, parseTote, skipTotes, toteBusy, toteOf } from '@/lib/totes';
import { printToteTags } from '@/lib/shelf-labels-client';

type Banner = { kind: 'tote' | 'ok' | 'warn'; title: string; sub?: string; tote?: number; at: number };

function ScanBanner({ b }: { b: Banner }) {
  const warn = b.kind === 'warn';
  return (
    <div key={b.at} role="status" aria-live="assertive" className="cf-anim-pop mt-3 flex items-center gap-4 rounded-2xl px-4 py-4" style={warn ? { background: C.warnSoft, color: C.warn } : b.kind === 'tote' ? { background: C.ok, color: '#fff' } : { background: C.ink, color: C.paper }}>
      {b.kind === 'tote' && b.tote ? <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-2xl text-center" style={{ background: '#fff', color: C.ok }}><span className="block text-[11px] font-bold leading-none">TOTE</span><span className="block text-[40px] font-bold leading-none">{b.tote}</span></span> : null}
      <span className="min-w-0"><span className="block text-[19px] font-semibold leading-tight">{b.title}</span>{b.sub ? <span className="mt-0.5 block text-[14px]" style={{ opacity: warn ? 1 : 0.85 }}>{b.sub}</span> : null}</span>
    </div>);
}

type BoardOrder = RetailOrder & { id: string } & Record<string, any>;
const ACTIVE = ['paid', 'picking', 'packed', 'ready', 'arrived'];
/** Units still to be scanned into the box (the second scan). */
const toCheck = (o: any) => (o?.lines || []).reduce((a: number, l: any) => (l.digital === true ? a : a + Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0) - (l.qtyPacked || 0))), 0);

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
  const [shopZone, setShopZone] = React.useState('UTC');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [missing, setMissing] = React.useState<{ order: BoardOrder; line: any } | null>(null);
  const [shipId, setShipId] = React.useState<string | null>(null);
  const [handId, setHandId] = React.useState<string | null>(null);
  const [showMissing, setShowMissing] = React.useState(false);
  const [banner, setBanner] = React.useState<Banner | null>(null);
  // The order at the box for its second scan, when the shop asks for one.
  const [checking, setChecking] = React.useState<string | null>(null);
  const show = (b: Omit<Banner, 'at'>) => { feel(b.kind !== 'warn'); setBanner({ ...b, at: Date.now() }); };

  React.useEffect(() => {
    if (!fs || !tenantId) return;
    getDoc(doc(fs, 'tenants', tenantId)).then((s) => { setRs((s.data() as any)?.retailSettings || {}); setShopZone(tenantTimeZone(s.data())); }).catch(() => {});
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ACTIVE)),
      (snap) => { setOrders(snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }))); setLoading(false); }, () => setLoading(false));
  }, [fs, tenantId]);

  const byId = React.useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const queue = React.useMemo(() => packQueue(orders, rs, Date.now(), shopZone).filter((o: any) => o.stage === 'paid' && !o.batchId && !o.waveId), [orders, rs, shopZone]);
  const mine = React.useMemo(() => orders.filter((o) => o.stage === 'picking' && (o.claimedBy === staffMember.id || o.assignedTo === staffMember.id)), [orders, staffMember.id]);
  const toFinish = React.useMemo(() => perms.canPack ? orders.filter((o) => o.stage === 'picking' && (!mine.includes(o) || Number(o.toteNo) > 0) && packProgress(o).total > 0 && packProgress(o).done >= packProgress(o).total) : [], [orders, mine, perms.canPack]);
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
    const m = new Map<string, { key: string; name: string; needed: number; scanned: number; nums: string[]; bin: string; overflow: string; totes: number[] }>();
    mine.forEach((o) => (o.lines || []).forEach((l: any) => {
      if (l.digital === true || ['shorted', 'refunded', 'backordered'].includes(l.status)) return;
      const need = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)); if (need <= 0) return;
      const key = `${l.productId}|${l.optionsLabel || ''}`;
      const row = m.get(key) || { key, name: `${l.name}${l.optionsLabel ? ` · ${l.optionsLabel}` : ''}`, needed: 0, scanned: 0, nums: [], bin: info[l.productId]?.bin || '', overflow: info[l.productId]?.overflow || '', totes: [] };
      row.needed += need; row.scanned += Math.min(l.qtyScanned || 0, need); row.nums.push(orderNum(o)); if (toteOf(o) && (l.qtyScanned || 0) < need) row.totes.push(toteOf(o)); m.set(key, row);
    }));
    return [...m.values()].sort((a, b) => Number(a.scanned >= a.needed) - Number(b.scanned >= b.needed) || compareBins(a.bin, b.bin) || a.name.localeCompare(b.name));
  }, [mine, info]);
  const left = shelf.reduce((a, r) => a + Math.max(0, r.needed - r.scanned), 0);
  const totesOn = rs.useTotes !== false && mine.length >= 2;
  const untoted = totesOn ? mine.filter(needsTote) : [];
  const labeled = React.useMemo(() => orders.filter((o) => o.stage === 'packed' && o.method === 'ship' && o.trackingNumber), [orders]);

  const say = (m: string, ok = true) => { feel(ok); setToast(m); };
  const checkOrder = checking ? byId.get(checking) || null : null;
  React.useEffect(() => { if (checking && (!checkOrder || checkOrder.stage !== 'picking')) setChecking(null); }, [checking, checkOrder]);
  const needsCheck = (o: BoardOrder) => rs.requirePackScan === true && !o.waveId && !isPackComplete((o.lines || []) as any);
  const doFinish = async (o: BoardOrder) => {
    const r = await finishPacking(fs, tenantId, o, orders, actor as any, rs);
    say(r.ok ? (o.method === 'ship' ? `${orderNum(o)} packed. It’s ready for a label.` : `${orderNum(o)} is on the shelf${(r as any).slot ? ` at ${(r as any).slot}` : ''}. ${firstName(o.customerName)} has been told.`) : r.message, r.ok);
    return r.ok;
  };
  // Finishing an order picked at the shelf, with the second scan on, starts its scan into the box instead.
  const finish = async (o: BoardOrder) => {
    if (needsCheck(o)) {
      setChecking(o.id); setBanner(null); feel(true);
      return false;
    }
    return doFinish(o);
  };
  const takeNext = async () => {
    if (!fs || busy) return;
    if (mine.length >= perms.claimLimit) { say(`Finish what you have first. Your job holds up to ${perms.claimLimit} at a time.`, false); return; }
    setBusy('take');
    try { const r = await claimNextBatch(fs, tenantId, actor as any, perms.claimLimit - mine.length, fulfilmentPolicy(rs, shopZone)); if ('error' in r) say(r.error, false); else say(`${r.orderIds.length === 1 ? 'An order is' : `${r.orderIds.length} orders are`} yours. Start scanning.`); }
    finally { setBusy(''); }
  };
  const onScan = async (value: string) => {
    if (!fs || busy) return;
    setBusy('scan');
    try {
      const raw = value.trim();
      const tote = parseTote(raw);
      if (tote) {
        const next = untoted[0];
        if (next) {
          const r = await assignTote(fs, tenantId, next, tote, orders, actor);
          if (r.ok) show({ kind: 'tote', tote, title: `Tote ${tote} is ${orderNum(next)}`, sub: untoted.length > 1 ? `Now scan a tote for ${orderNum(untoted[1])}.` : 'All set. Start the walk.' });
          else show({ kind: 'warn', title: 'That tote is in use', sub: r.message });
          return;
        }
        const held = toteBusy(orders, tote);
        if (!held) { show({ kind: 'warn', title: `Tote ${tote} is empty`, sub: 'No order is in it right now.' }); return; }
        const p = packProgress(held);
        if (p.total > 0 && p.done >= p.total && perms.canPack) { if (await finish(held)) show({ kind: 'ok', title: `Tote ${tote}: ${orderNum(held)} finished`, sub: held.method === 'ship' ? 'Box it. It’s ready for a label.' : 'On the pickup shelf. The customer has been told.' }); return; }
        show({ kind: 'tote', tote, title: `Tote ${tote} is ${orderNum(held)}`, sub: `${Math.max(0, p.total - p.done)} more to pick.` });
        return;
      }
      const slip = orderFromSlipScan(raw, orders);
      if (slip) {
        const p = packProgress(slip);
        if (slip.stage === 'picking' && p.total > 0 && p.done >= p.total && perms.canPack) { if (await finish(slip)) show({ kind: 'ok', title: `${orderNum(slip)} finished`, sub: slip.method === 'ship' ? 'Box it. It’s ready for a label.' : 'On the pickup shelf. The customer has been told.' }); return; }
        if (slip.stage === 'packed' && slip.method === 'ship' && perms.canShip) { setShipId(slip.id); return; }
        show({ kind: toteOf(slip) ? 'tote' : 'ok', tote: toteOf(slip) || undefined, title: `${orderNum(slip)} ${firstName(slip.customerName)}`, sub: slip.stage === 'picking' ? `${Math.max(0, p.total - p.done)} more to pick.` : slip.stage === 'packed' ? 'Packed. Waiting for a label.' : 'Ready.' });
        return;
      }
      const labelFor = labeled.length ? orderForLabel(raw, labeled) : null;
      if (labelFor) {
        const r = await markLabelChecked(fs, tenantId, labelFor, actor, raw);
        if (r.total > 1 && !r.done) show({ kind: 'ok', title: `Box ${r.checked} of ${r.total}: ${orderNum(labelFor)}`, sub: `Scan the label on the other box${r.total - r.checked > 1 ? 'es' : ''}.` });
        else show({ kind: 'ok', title: `Right box${r.total > 1 ? 'es' : ''}: ${orderNum(labelFor)}`, sub: r.total > 1 ? `All ${r.total} labels are on. They can go out.` : `${firstName(labelFor.customerName)}’s label is on. It can go out.` });
        return;
      }
      if (looksLikeTracking(raw) && labeled.length) { show({ kind: 'warn', title: 'This label isn’t for any box waiting to ship', sub: 'Check the box and the label before it goes out.' }); return; }
      if (checkOrder && checkOrder.stage === 'picking') {
        const r = await recordPackScan(fs, tenantId, checkOrder.id, value, actor as any);
        if (!r.ok) { show({ kind: 'warn', title: 'That isn’t going in this box', sub: r.message }); return; }
        if (r.packComplete) {
          setChecking(null);
          if (await doFinish(checkOrder)) show({ kind: 'ok', title: `${orderNum(checkOrder)} finished`, sub: checkOrder.method === 'ship' ? 'Box it. It’s ready for a label.' : 'On the pickup shelf. The customer has been told.' });
          return;
        }
        show({ kind: 'ok', title: `${r.name || 'Item'} is in`, sub: `${Math.max(0, toCheck(checkOrder) - 1)} more for ${orderNum(checkOrder)}` });
        return;
      }
      for (const o of mine) {
        const r = await recordItemScan(fs, tenantId, o.id, value, actor as any);
        if (r.ok) {
          const t = toteOf(o);
          if (t) show({ kind: 'tote', tote: t, title: `Put it in Tote ${t}`, sub: `${r.message} · ${orderNum(o)}` });
          else show({ kind: 'ok', title: r.message, sub: `${orderNum(o)} ${firstName(o.customerName)}` });
          if ((r as any).pickComplete && perms.canPack && !t) await finish(o);
          return;
        }
      }
      const atBin = shelf.find((r) => r.scanned < r.needed && binMatches(r.bin, value));
      if (atBin) { show({ kind: 'ok', title: `You’re at ${atBin.bin}`, sub: `Grab ${atBin.needed - atBin.scanned} × ${atBin.name}.` }); return; }
      // A waiting order that needs it: by the codes its lines were sold with (label, id, barcode, SKU, case and others).
      const owner = queue.find((o) => (o.lines || []).some((l: any) => lineMatchesScan(l, raw)));
      if (owner && mine.length < perms.claimLimit) {
        const grab = await claimSpecificOrder(fs, tenantId, owner.id, actor as any);
        if (!('error' in grab)) { const r2 = await recordItemScan(fs, tenantId, owner.id, value, actor as any); if (r2.ok) { show({ kind: 'ok', title: `${orderNum(owner)} is yours`, sub: r2.message }); return; } }
      }
      if (owner) show({ kind: 'warn', title: 'You’re holding as many orders as your job allows', sub: 'Finish one, then scan this again.' });
      else show({ kind: 'warn', title: 'That’s not in this pick', sub: mine.length ? 'None of your orders need it. Put it back where it came from.' : 'None of the waiting orders need it.' });
    } finally { setBusy(''); }
  };

  if (!perms.canPick) return <Empty title="Online orders aren’t part of your job" sub="Ask a manager if you should be packing orders." />;

  return (
    <div className="pb-6" style={{ color: C.ink }}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0"><h2 className="m-0 text-[28px] font-light tracking-[-0.02em]">Orders</h2><p className="m-0 mt-0.5 text-[15px]" style={muted}>{loading ? 'Loading…' : `${queue.length} waiting · you have ${mine.length} of ${perms.claimLimit}`}</p></div>
        <Btn kind="primary" onClick={() => void takeNext()} disabled={busy === 'take' || queue.length === 0 || mine.length >= perms.claimLimit}>{busy === 'take' ? 'Taking…' : 'Take next'}</Btn>
      </div>

      {checkOrder && (
        <section className="cf-anim-rise mt-5 rounded-2xl border-2 p-4" style={{ borderColor: C.ink }}>
          <p className="m-0 text-[17px] font-semibold">{`Scan ${orderNum(checkOrder)} into the box`}</p>
          <p className="m-0 mt-0.5 text-[14px]" style={muted}>{`For ${firstName(checkOrder.customerName)}${toteOf(checkOrder) ? ` · Tote ${toteOf(checkOrder)}` : ''} · ${toCheck(checkOrder)} to go. It was picked at the shelf, so each item is scanned again as it’s packed.`}</p>
          {banner && <ScanBanner b={banner} />}
          <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy === 'scan'} label="Scan each item into the box" cameraFirst={false} /></div>
          <div className="mt-3">
            {(checkOrder.lines || []).filter((l: any) => l.digital !== true && (l.qtyOrdered || 0) - (l.qtyShorted || 0) > 0).map((l: any) => { const owed = (l.qtyOrdered || 0) - (l.qtyShorted || 0); const done = (l.qtyPacked || 0) >= owed; return (
              <div key={l.lineId} className="flex min-h-[56px] items-center gap-3 border-b py-2.5" style={{ borderColor: C.line, opacity: done ? 0.5 : 1 }}>
                <span key={done ? 'd' : 'n'} className={`${done ? 'cf-anim-pop ' : ''}grid h-7 w-7 shrink-0 place-items-center rounded-full border-2`} style={done ? { background: C.ok, borderColor: C.ok } : { borderColor: '#d2d3d7' }}>{done ? Ic.check : null}</span>
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{l.name}{l.optionsLabel ? ` · ${l.optionsLabel}` : ''}</span>
                <span className="shrink-0 text-[15px] font-semibold">{Math.min(l.qtyPacked || 0, owed)}/{owed}</span>
              </div>); })}
          </div>
          <Btn kind="plain" className="mt-2 h-11" onClick={() => setChecking(null)}>Not now</Btn>
        </section>)}

      {mine.length > 0 && !checkOrder && (
        <section className="cf-anim-rise mt-5 rounded-2xl border-2 p-4" style={{ borderColor: C.ink }}>
          <p className="m-0 text-[17px] font-semibold">{left > 0 ? `${left} item${left === 1 ? '' : 's'} to grab` : 'All in'}</p>
          <p className="m-0 mt-0.5 text-[14px]" style={muted}>{mine.map((o) => `${orderNum(o)} ${firstName(o.customerName)}`).join(' · ')}</p>
          {untoted.length > 0 && (
            <div className="cf-anim-rise mt-3 rounded-2xl p-4" style={{ background: C.soft }}>
              <p className="m-0 text-[16px] font-semibold">Set out a tote for each order</p>
              <p className="m-0 mt-0.5 text-[14px]" style={muted}>Scan an empty tote now for {orderNum(untoted[0])} {firstName(untoted[0].customerName)}.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {mine.map((o) => <span key={o.id} className="rounded-full px-3 py-1.5 text-[13px] font-semibold" style={Number(o.toteNo) > 0 ? { background: C.ok, color: '#fff' } : o.id === untoted[0].id ? { background: C.paper, border: `2px solid ${C.ink}` } : { background: C.paper, color: C.muted }}>{Number(o.toteNo) > 0 ? `Tote ${o.toteNo} · ` : ''}{orderNum(o)}</span>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn kind="soft" className="h-10 px-4 text-[14px]" style={{ background: C.paper }} onClick={() => void skipTotes(fs, tenantId, untoted)}>Skip totes this time</Btn>
                <Btn kind="soft" className="h-10 px-4 text-[14px]" style={{ background: C.paper }} onClick={() => { if (!printToteTags(12)) say('Allow pop-ups to print tote tags.', false); }}>Print tote tags</Btn>
              </div>
            </div>)}
          {banner && <ScanBanner b={banner} />}
          <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy === 'scan'} label="Scan each item as it goes in" /></div>
          <div className="mt-3">
            {shelf.map((r) => { const done = r.scanned >= r.needed; return (
              <div key={r.key} className="flex min-h-[56px] items-center gap-3 border-b py-2.5" style={{ borderColor: C.line, opacity: done ? 0.5 : 1 }}>
                <span key={done ? 'd' : 'n'} className={`${done ? 'cf-anim-pop ' : ''}grid h-7 w-7 shrink-0 place-items-center rounded-full border-2`} style={done ? { background: C.ok, borderColor: C.ok } : { borderColor: '#d2d3d7' }}>{done ? Ic.check : null}</span>
                {r.bin ? <span className="shrink-0 rounded-lg px-2 py-1 font-mono text-[13px] font-semibold" style={done ? { background: C.soft, color: C.muted } : { background: C.ink, color: C.paper }}>{r.bin}</span> : null}
                <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold">{r.name}</span><span className="block truncate text-[13px]" style={muted}>{[r.nums.join(' · '), r.overflow ? `Overflow: ${r.overflow}` : ''].filter(Boolean).join(' · ')}</span></span>
                {!done && r.totes.length > 0 ? <span className="flex shrink-0 gap-1">{[...new Set(r.totes)].map((t) => <span key={t} className="rounded-lg border-2 px-1.5 text-[12px] font-bold" style={{ borderColor: C.ink }}>T{t}</span>)}</span> : null}
                <span className="shrink-0 text-[15px] font-semibold">{r.scanned}/{r.needed}</span>
              </div>); })}
          </div>
          <button type="button" onClick={() => setShowMissing((v) => !v)} className="mt-3 h-11 text-[15px] font-semibold" style={muted}>{showMissing ? 'Hide' : 'Something missing?'}</button>
          {showMissing && <div className="cf-anim-rise mt-1 flex flex-wrap gap-2">
            {mine.flatMap((o) => (o.lines || []).filter((l: any) => !l.digital && !['shorted', 'refunded', 'backordered'].includes(l.status) && (l.qtyScanned || 0) < (l.qtyOrdered || 0) - (l.qtyShorted || 0)).map((l: any) => (
              <button key={`${o.id}-${l.lineId}`} type="button" onClick={() => setMissing({ order: o, line: l })} className="cf-press h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: C.soft }}>{l.name} ({orderNum(o)})</button>)))}
          </div>}
        </section>)}

      {mine.length === 0 && !checkOrder && (toFinish.length > 0 || labeled.some((o) => !o.labelCheckedAt)) && (
        <section className="mt-5 rounded-2xl border p-4" style={{ borderColor: C.line }}>
          <p className="m-0 text-[16px] font-semibold">At the bench</p>
          <p className="m-0 mt-0.5 text-[14px]" style={muted}>Scan a tote to finish its order, or scan a label on a box to check it’s the right one.</p>
          {banner && <ScanBanner b={banner} />}
          <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy === 'scan'} label="Scan a tote or a label" cameraFirst={false} /></div>
        </section>)}

      {toFinish.length > 0 && (
        <Section title="Picked, ready to finish">
          {toFinish.map((o) => <ListRow key={o.id} lead={<Initials name={o.customerName} />} title={o.customerName} detail={`${toteOf(o) ? `Tote ${toteOf(o)} · ` : ''}${orderNum(o)} · ${methodLabel(o.method, rs)} · picked by ${firstName(o.claimedByName) || 'someone'}`} trail={<Btn kind="primary" className="h-10 px-4 text-[14px]" onClick={() => void finish(o)}>Finish</Btn>} />)}
        </Section>)}

      {toShip.length > 0 && (
        <Section title="Ready to ship" sub={`${toShip.length}`}>
          {toShip.map((o) => <ListRow key={o.id} onClick={() => setShipId(o.id)} lead={<Initials name={o.customerName} />} title={o.customerName} detail={`${orderNum(o)} · ${o.labelCheckedAt ? 'Label on and checked' : o.labelUrl || o.trackingNumber ? 'Scan the label on the box' : 'Needs a label'}${o.groundOnly ? ' · ground only' : ''}`} trail={<span style={muted}>{Ic.chev}</span>} />)}
        </Section>)}

      {shelfOrders.length > 0 && (
        <Section title="Pickup shelf" sub={`${shelfOrders.length}`}>
          {shelfOrders.map((o) => <ListRow key={o.id} onClick={() => setHandId(o.id)} lead={<Initials name={o.customerName} />} title={o.customerName}
            detail={[o.stage === 'arrived' ? `Outside${o.curbside?.spotOrVehicle ? ` in ${o.curbside.spotOrVehicle}` : ''}` : methodLabel(o.method, rs), o.shelfSlot ? `Shelf ${o.shelfSlot}` : '', `${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            trail={<span className="text-[14px] font-semibold" style={o.stage === 'arrived' ? { color: C.warn } : muted}>{o.stage === 'arrived' ? 'Now' : 'Hand over'}</span>} />)}
        </Section>)}

      <Section title="Waiting to be picked" sub={queue.length ? `${queue.length}` : undefined}>
        {!loading && queue.length === 0 ? <p className="m-0 px-4 py-8 text-center text-[15px]" style={muted}>Nothing waiting. Nice work.</p>
          : queue.slice(0, 12).map((o) => { const d = dueLine(o, rs, Date.now(), shopZone); return <ListRow key={o.id} lead={<Initials name={o.customerName} />} title={o.customerName} detail={`${orderNum(o)} · ${methodLabel(o.method, rs)} · ${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`} trail={<span className="text-[14px]" style={d.late ? { color: C.warn, fontWeight: 600 } : muted}>{d.text}</span>} />; })}
      </Section>

      {missing && <MissingSheet fs={fs} tenantId={tenantId} order={missing.order} line={missing.line} actor={actor as any} autoBelow={Math.max(0, Number(rs?.policies?.refundAutoBelowCents) || 0)} onClose={() => setMissing(null)} onDone={(m) => { setMissing(null); say(m); }} />}
      {shipId && byId.get(shipId) && <ShipSheet fs={fs} tenantId={tenantId} order={byId.get(shipId)} inventory={weights} rs={rs} actor={actor as any} onClose={() => setShipId(null)} onDone={(m) => { setShipId(null); say(m); }} />}
      {handId && byId.get(handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={byId.get(handId)} actor={actor as any} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); say(m); }} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={110} />}
    </div>);
}
