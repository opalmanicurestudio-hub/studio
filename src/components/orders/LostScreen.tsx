'use client';
// src/components/orders/LostScreen.tsx — ORDERS → SETUP → LOST AND RECOVERED, a month at a time (lib/lost-recovered):
// what parcels lost the shop, what came back from carriers and insurance, the net, open claims and the ones due this
// week, postage refunded for labels nobody used, where the losses came from, and one change worth making. Every open
// claim opens its sheet (file it, or follow it to paid). Stock write-offs and supplier losses stay in the loss ledger.
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { dayKey, tenantTimeZone } from '@/lib/tenant-time';
import { money, orderNum } from '@/lib/orders-view';
import { protectionPolicy } from '@/lib/shipment-protection';
import { RECOVERABLE, claimStage, claimsToFile, coverFor, isOpenClaim, monthLoss } from '@/lib/lost-recovered';
import { C, Ic, LargeTitle, ListRow, UndoBar, muted } from './ui';
import { PhoneShopBar, useWide } from './shell';
import { ClaimSheet, monthDay } from './LossSheets';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const whole = (c: number) => (Math.round(Math.abs(c)) % 100 === 0 ? `${c < 0 ? '−' : ''}$${Math.round(Math.abs(c)) / 100}` : `${c < 0 ? '−' : ''}${money(Math.abs(c))}`);
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const monthStart = (m: string) => `${m}-01`;

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-2xl p-3" style={{ background: C.soft }}>
      <span className="text-[12.5px] font-semibold" style={muted}>{label}</span>
      <span className="text-[22px] font-light tracking-[-0.02em]" style={{ color: color || C.ink }}>{value}</span>
    </div>);
}

export function LostScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { user } = useUser() as any;
  const { selectedTenant, role } = useTenant() as any;
  const wide = useWide();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant?.retailSettings || {}) as any;
  const tz = tenantTimeZone(selectedTenant);
  const canFile = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const actor = React.useMemo(() => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user]);
  const thisMonth = dayKey(new Date(), tz).slice(0, 7);
  const [month, setMonth] = React.useState(thisMonth);
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [orders, setOrders] = React.useState<Map<string, any>>(() => new Map());
  const [shippedValues, setShippedValues] = React.useState<number[]>([]);
  const [refunded, setRefunded] = React.useState(0);
  const [open, setOpen] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState('');
  const monthOf = React.useCallback((iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? dayKey(new Date(t), tz).slice(0, 7) : ''; }, [tz]);

  // The last 13 months of losses, live: a month's own, plus open claims and payments from any of them.
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const since = new Date(Date.now() - 400 * 86400e3).toISOString();
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/inventoryExceptions`), where('at', '>=', since), orderBy('at', 'desc'), limit(1500)),
      (s) => setRows(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setRows([]));
  }, [fs, tenantId]);
  // The orders behind the month's losses and every open claim (names, delivery times), read once each.
  const wanted = React.useMemo(() => [...new Set((rows || []).filter((r) => r.orderId && (isOpenClaim(r) || monthOf(String(r.at || '')) === month)).map((r) => String(r.orderId)))].slice(0, 80), [rows, month, monthOf]);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const missing = wanted.filter((id) => !orders.has(id));
    if (!missing.length) return;
    let stop = false;
    void Promise.all(missing.map((id) => getDoc(doc(fs, `tenants/${tenantId}/retailOrders`, id)).then((s) => [id, s.exists() ? { ...(s.data() as any), id } : null] as const).catch(() => [id, null] as const)))
      .then((pairs) => { if (!stop) setOrders((m) => { const n = new Map(m); pairs.forEach(([id, o]) => n.set(id, o)); return n; }); });
    return () => { stop = true; };
  }, [fs, tenantId, wanted.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // The month's shipped orders (what insuring more would have cost) and postage refunded for labels nobody used.
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const start = new Date(Date.parse(`${monthStart(month)}T00:00:00Z`) - 86400e3).toISOString();
    const end = new Date(Date.parse(`${monthStart(shiftMonth(month, 1))}T00:00:00Z`) + 86400e3).toISOString();
    getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('completedAt', '>=', start), where('completedAt', '<', end), limit(1500)))
      .then((s) => setShippedValues(s.docs.map((d) => d.data() as any).filter((o) => o.method === 'ship' && monthOf(String(o.completedAt || '')) === month)
        .map((o) => (o.lines || []).reduce((a: number, l: any) => a + (Number(l.unitPriceCents) || 0) * Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0)), 0))))
      .catch(() => setShippedValues([]));
    const voidSince = new Date(Date.parse(`${monthStart(month)}T00:00:00Z`) - 50 * 86400e3).toISOString();
    getDocs(query(collection(fs, `tenants/${tenantId}/shippingLabels`), where('voidedAt', '>=', voidSince), limit(800)))
      .then((s) => setRefunded(s.docs.map((d) => d.data() as any).filter((r) => /never scanned|was cancelled/i.test(String(r.voidWhy || '')))
        .reduce((a, r) => a + Object.values(r.refunds || {}).filter((e: any) => e?.status === 'refunded' && monthOf(String(e.doneAt || '')) === month).reduce((s2: number, e: any) => s2 + (Number(e.cents) || 0), 0), 0)))
      .catch(() => setRefunded(0));
  }, [fs, tenantId, month, monthOf]);

  const pol = protectionPolicy(rs);
  const m = rows ? monthLoss(rows, month, { monthOf, unusedRefundedCents: refunded, shippedValues, insuranceOn: pol.insuranceEnabled, insureOverCents: pol.insuranceOverCents, requireScan: rs.requireScan === true, ordersById: orders, tz }) : null;
  const toFile = rows ? claimsToFile(rows, orders, (v) => monthDay(v, tz), Date.now(), tz, { all: true }) : [];
  const following = (rows || []).filter((r) => RECOVERABLE.has(String(r.reason)) && ['filed', 'approved'].includes(claimStage(r)));
  const closedThisMonth = (rows || []).filter((r) => RECOVERABLE.has(String(r.reason)) && ['paid', 'denied'].includes(claimStage(r)) && monthOf(String(r.recovery?.events?.slice(-1)?.[0]?.at || r.at || '')) === month);
  const openExc = open ? (rows || []).find((r) => r.id === open) || null : null;
  const [y, mo] = month.split('-').map(Number);

  return (
    <div className="cf-settings min-h-[100dvh] pb-32" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/retail-orders/setup" aria-label="Back to setup" className="cf-press grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.soft, color: C.ink }}>{Ic.back}</Link>
          <span className="text-[14px]" style={muted}>Setup</span>
          <span className="h-11 w-11" />
        </div>
        <div className="mt-3"><LargeTitle title="Lost and recovered" sub={
          <span className="inline-flex items-center gap-1">
            <button type="button" aria-label="Month before" onClick={() => setMonth((x) => shiftMonth(x, -1))} className="grid h-9 w-9 place-items-center rounded-full" style={{ color: C.ink }}><span className="inline-block rotate-180">{Ic.chev}</span></button>
            <span>{MONTHS[mo - 1]}{y !== Number(thisMonth.slice(0, 4)) ? ` ${y}` : ''}</span>
            <button type="button" aria-label="Month after" disabled={month >= thisMonth} onClick={() => setMonth((x) => shiftMonth(x, 1))} className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-30" style={{ color: C.ink }}>{Ic.chev}</button>
          </span>} /></div>

        {!m ? <p className="mt-8 text-center text-[15px]" style={muted}>Loading…</p> : (<>
          <div className="mt-4 flex gap-2">
            <Stat label="Lost" value={whole(m.lostCents)} />
            <Stat label="Recovered" value={whole(m.recoveredCents)} color={m.recoveredCents ? C.ok : undefined} />
            <Stat label="Net" value={whole(m.netCents)} />
          </div>
          <div className="mt-3 flex flex-col gap-1.5 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.soft }}>
            <span className="flex justify-between gap-2.5 font-semibold"><span>Open claims</span><span>{m.openClaims}</span></span>
            <span className="flex justify-between gap-2.5" style={m.dueSoon ? { color: C.warn } : undefined}><span>Due in the next week</span><span>{m.dueSoon}</span></span>
            <span className="flex justify-between gap-2.5"><span>Unused labels refunded</span><span>{money(m.unusedRefundedCents)}</span></span>
          </div>
          {m.where.length > 0 && (
            <div className="mt-5 flex flex-col gap-3">
              <p className="m-0 text-[13px] font-semibold" style={muted}>Where it went</p>
              {m.where.map((w) => (
                <div key={w.kind} className="flex flex-col gap-1.5">
                  <span className="flex justify-between gap-2.5 text-[15px]"><span>{w.kind}</span><span>{whole(w.cents)}</span></span>
                  <span className="block h-2 overflow-hidden rounded-full" style={{ background: C.soft }}><span className="block h-full rounded-full" style={{ width: `${Math.max(4, w.pct)}%`, background: w.mistake ? C.warn : C.ink }} /></span>
                </div>))}
              {m.uncosted > 0 && <p className="m-0 text-[13px]" style={muted}>{m.uncosted === 1 ? 'One item has' : `${m.uncosted} items have`} no cost set, so {m.uncosted === 1 ? 'its' : 'their'} sale price is used.</p>}
            </div>)}
          {m.lostCents === 0 && m.recoveredCents === 0 && <p className="mt-5 text-[15px]" style={muted}>Nothing lost this month.</p>}
          {m.worth.length > 0 && (
            <div className="mt-5 flex flex-col gap-1 rounded-2xl px-4 py-3 text-[15px] leading-snug" style={{ background: C.soft }}>
              <span className="font-semibold">Worth changing</span>
              {m.worth.map((w) => <span key={w}>{w}</span>)}
              {m.worth.some((w) => /insur/i.test(w)) && <Link href="/retail-orders/policies" className="mt-1 text-[14px] font-semibold underline" style={{ color: C.ink }}>Change it in Policies</Link>}
            </div>)}

          {(toFile.length > 0 || following.length > 0 || closedThisMonth.length > 0) && (
            <section className="mt-6">
              <p className="m-0 px-1 pb-1 text-[13px] font-semibold" style={muted}>Claims</p>
              {toFile.map((c) => <ListRow key={c.exc.id} onClick={() => setOpen(c.exc.id)} title={c.title} detail={c.detail} trail={<span style={c.due === 'soon' || c.due === 'overdue' ? { color: C.warn } : muted}>{Ic.chev}</span>} />)}
              {following.map((r) => { const o = orders.get(String(r.orderId)); const cover = coverFor(r, o); return <ListRow key={r.id} onClick={() => setOpen(r.id)} title={`${o?.customerName || orderNum(o || r)}’s claim`} detail={`${claimStage(r) === 'approved' ? 'Approved' : 'Filed'}${r.recovery?.refNumber ? ` · ${r.recovery.refNumber}` : ''} · ${cover.who} · ${money(Number(r.recovery?.claimAmountCents) || cover.amountCents)}`} trail={<span style={muted}>{Ic.chev}</span>} />; })}
              {closedThisMonth.map((r) => { const o = orders.get(String(r.orderId)); return <ListRow key={r.id} onClick={() => setOpen(r.id)} title={`${o?.customerName || orderNum(o || r)}’s claim`} detail={claimStage(r) === 'paid' ? `Paid ${money(Number(r.recovery?.recoveredCents) || 0)}` : 'Turned down'} trail={<span style={muted}>{Ic.chev}</span>} />; })}
            </section>)}
          <p className="m-0 mt-6 text-center text-[13px]" style={muted}>Stock write-offs and supplier losses are in the <Link href="/retail-orders/exceptions" className="underline" style={{ color: C.ink }}>loss ledger</Link>.</p>
        </>)}
      </div>
      {openExc && <ClaimSheet fs={fs} tenantId={tenantId} exc={openExc} order={orders.get(String(openExc.orderId)) || null} tz={tz} canFile={canFile} actor={actor} onClose={() => setOpen(null)} onToast={setToast} />}
      {!wide && <PhoneShopBar problems={0} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 150} />}
    </div>);
}
