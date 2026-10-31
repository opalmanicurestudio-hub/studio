'use client';
// src/components/orders/ProblemsApp.tsx — PROBLEMS. One row per order that needs a person, whatever the reasons:
// a message, a problem report, a return to check in, a refund to send, a held order, someone outside. Open the order
// and every problem is there with its own next step; a problem report is decided right there (ClaimCard). One queue
// with a filter for each kind (mockup 10F), and what waits for the customer kept apart under Waiting on them. On a
// phone the order opens full screen; on a computer, beside the list. Live from Firestore; the gathering rules are
// lib/problems-view.
import * as React from 'react';
import Link from 'next/link';
import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useLabelFlagOrders } from './use-label-flags';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useFulfilmentPerms } from '@/hooks/use-fulfilment-perms';
import { ACTIVE_STAGES } from '@/lib/orders-view';
import { PROBLEM_SHOWS, buildProblems, isShow, showProblems, waitLabel, type ProblemGroup, type ProblemShow } from '@/lib/problems-view';
import { tenantTimeZone } from '@/lib/tenant-time';
import type { Actor } from '@/lib/retail-fulfill';
import { C, Empty, Initials, LargeTitle, ListRow, UndoBar, muted } from './ui';
import { PhoneShopBar, useWide } from './shell';
import { ProblemPanel } from './ProblemPanel';

export function ProblemsApp() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, can, staffId, role } = useTenant() as any; const { user } = useUser() as any;
  const perms = useFulfilmentPerms();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant as any)?.retailSettings || {};
  const actor: Actor = React.useMemo(() => ({ id: staffId || user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user, staffId]);
  const wide = useWide();
  const canRefund = typeof can === 'function' ? can('checkout.refund') : false;
  // Deciding on a report, and asking the customer about one: the same test as the server's (api/retail/fulfil 'claims').
  const canDecideClaims = canRefund || ['owner', 'admin', 'manager'].includes(String(role || ''));

  const [orders, setOrders] = React.useState<any[]>([]);
  const [refundOrders, setRefundOrders] = React.useState<any[]>([]);
  const [tickets, setTickets] = React.useState<any[]>([]);
  const [claims, setClaims] = React.useState<any[]>([]);
  const [returns, setReturns] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());
  const [show, setShowState] = React.useState<ProblemShow>('all');

  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  React.useEffect(() => { const q = new URLSearchParams(window.location.search); const id = q.get('order'); if (id) setOpenId(id); const sh = q.get('show'); if (isShow(sh)) setShowState(sh); }, []);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const col = (n: string) => collection(fs, `tenants/${tenantId}/${n}`);
    const rows = (s: any) => s.docs.map((d: any) => ({ ...(d.data() as any), id: d.id }));
    const subs = [
      onSnapshot(query(col('retailOrders'), where('stage', 'in', ACTIVE_STAGES)), (s) => { setOrders(rows(s)); setLoading(false); }, () => setLoading(false)),
      onSnapshot(query(col('retailOrders'), where('pendingRefundCents', '>', 0)), (s) => setRefundOrders(rows(s)), () => setRefundOrders([])),
      onSnapshot(query(col('retailSupport'), where('status', '==', 'open')), (s) => setTickets(rows(s)), () => setTickets([])),
      onSnapshot(query(col('retailClaims'), where('status', '==', 'in_review')), (s) => setClaims(rows(s)), () => setClaims([])),
      onSnapshot(query(col('retailReturns'), where('status', 'in', ['open', 'received'])), (s) => setReturns(rows(s)), () => setReturns([])),
    ];
    return () => subs.forEach((u) => u());
  }, [fs, tenantId]);

  const shopZone = tenantTimeZone(selectedTenant);
  // Orders a label has put under Needs you, whatever their stage (shipped and closed ones too).
  const flagged = useLabelFlagOrders(fs, tenantId);
  const all = React.useMemo(() => [...orders, ...flagged.filter((f) => !orders.some((o) => o.id === f.id))], [orders, flagged]);
  const groups = React.useMemo(() => buildProblems({ orders: all, refundOrders, tickets, claims, returns, now, staleHours: Math.max(1, Number(rs.readyStaleHours) || 24), timeZone: shopZone }), [all, refundOrders, tickets, claims, returns, now, rs.readyStaleHours, shopZone]);
  const shown = React.useMemo(() => showProblems(groups, show), [groups, show]);
  const counts = React.useMemo(() => Object.fromEntries(PROBLEM_SHOWS.map((x) => [x.id, x.id === show ? shown.length : showProblems(groups, x.id).length])) as Record<ProblemShow, number>, [groups, show, shown]);
  // On a computer the first in the view is open beside it, and takes over from one that's been sorted; on a phone a
  // sorted order closes. Only once the open order has been seen in the list: the lists load one after another, so an
  // order opened from a link (?order=) may not be in it yet.
  const seenOpen = React.useRef(false);
  // The order that takes over from one just sorted waits a moment before it takes a tap, so a second tap meant for the
  // one just decided never lands on another customer's.
  const [settling, setSettling] = React.useState(false);
  React.useEffect(() => { if (!settling) return; const k = setTimeout(() => setSettling(false), 700); return () => clearTimeout(k); }, [settling]);
  React.useEffect(() => {
    const here = !!openId && groups.some((g) => g.orderId === openId);
    if (here) { seenOpen.current = true; return; }
    const gone = !!openId && seenOpen.current;
    if (gone) seenOpen.current = false;
    if (wide && shown.length && (!openId || gone)) { setOpenId(shown[0].orderId); if (gone) setSettling(true); }
    else if (gone) setOpenId(null);
  }, [wide, openId, shown, groups]);
  // The filter stays in the address, so a link (the two-day reminder: ?show=claims) and a reload open the same view. On
  // a computer, an order that isn't in the new view gives way to the first one that is.
  const setShow = (v: ProblemShow) => {
    setShowState(v);
    const next = showProblems(groups, v);
    if (wide && next.length && !next.some((g) => g.orderId === openId)) setOpenId(next[0].orderId);
    try { const u = new URL(window.location.href); if (v === 'all') u.searchParams.delete('show'); else u.searchParams.set('show', v); window.history.replaceState(window.history.state, '', u.toString()); } catch { /* the view still changes */ }
  };
  // The panel always has every problem on the order, whatever the filter.
  const open = openId ? groups.find((g) => g.orderId === openId) || null : null;

  const row = (g: ProblemGroup) => {
    const more = g.items.length - 1;
    return <ListRow key={g.orderId} onClick={() => setOpenId(g.orderId)} active={wide && openId === g.orderId} lead={<Initials name={g.customerName} />}
      title={g.customerName} detail={`${g.items[0].title}${more > 0 ? ` and ${more} more` : ''}`}
      trail={<span className="shrink-0 text-[14px]" style={g.urgent ? { color: C.warn, fontWeight: 600 } : muted}>{g.urgent ? 'Now' : waitLabel(g.at, now)}</span>} />;
  };
  const panel = open && <ProblemPanel key={open.orderId} fs={fs} tenantId={tenantId} group={open} actor={actor} rs={rs} canRefund={canRefund} canManage={!!perms.canManage} canDecideClaims={canDecideClaims} settling={settling} inline={wide} onClose={() => setOpenId(null)} onToast={setToast} />;
  const needs = counts.all;
  const header = (
    <div className="px-4 pt-3">
      <div className="h-11 lg:hidden" />
      <LargeTitle title="Problems" sub={loading ? 'Loading…' : needs ? `${needs} order${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you` : counts.waiting ? 'Nothing needs you. Some are waiting on customers.' : 'All clear'} />
      {!loading && groups.length > 0 && (
        <div role="group" aria-label="Show" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
          {PROBLEM_SHOWS.filter((x) => x.id === 'all' || x.id === show || counts[x.id] > 0).map((x) => (
            <button key={x.id} type="button" aria-pressed={show === x.id} onClick={() => setShow(x.id)}
              className="cf-press inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[14px] font-semibold"
              style={show === x.id ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{x.label} · {counts[x.id]}</button>))}
        </div>)}
    </div>);
  const EMPTY: Record<ProblemShow, [string, string]> = {
    all: ['Nothing needs you', 'Messages, problem reports, returns and refunds show up here the moment they come in.'],
    claims: ['No problem reports to decide', 'When a customer reports something wrong with an order, it shows here with the packing record.'],
    returns: ['No returns to check in', 'Returns on their way back show here until they’re checked in.'],
    messages: ['No messages to answer', 'Customer messages about an order land here.'],
    refunds: ['No refunds to send', 'Approved refunds wait here for someone allowed to send them.'],
    waiting: ['Nothing waiting on customers', 'When you ask a customer for something, it waits here until they answer.'],
  };
  const list = loading ? <p className="px-4 py-10 text-center text-[15px]" style={muted}>Loading…</p>
    : shown.length === 0 ? <Empty title={EMPTY[show][0]} sub={EMPTY[show][1]} action={show === 'all' ? <Link href="/retail-orders" className="text-[17px] font-semibold" style={{ color: C.ink }}>Back to orders</Link> : <button type="button" onClick={() => setShow('all')} className="cf-press text-[17px] font-semibold" style={{ color: C.ink }}>Show all</button>} />
    : <div className="cf-stagger mt-3">{shown.map(row)}</div>;

  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      {wide ? (
        <div className="flex h-[100dvh]">
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-8">{header}{list}</div>
          <div className="w-[480px] shrink-0 overflow-y-auto border-l" style={{ borderColor: C.line }}>{panel || <Empty title="Pick an order" sub="Every problem on it, with what to do next." />}</div>
        </div>
      ) : <div className="pb-32">{header}{list}</div>}
      {!wide && !open && <PhoneShopBar problems={needs} />}
      {!wide && panel}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 96} />}
    </div>);
}

