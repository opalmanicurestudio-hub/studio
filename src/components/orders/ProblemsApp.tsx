'use client';
// src/components/orders/ProblemsApp.tsx — PROBLEMS. One row per order that needs a person, whatever the reasons:
// a message, a problem report, a return to check in, a refund to send, a held order, someone outside. Open the order
// and every problem is there with its own next step. On a phone the order opens full screen; on a computer, beside the
// list. Live from Firestore; the gathering rules are lib/problems-view.
import * as React from 'react';
import Link from 'next/link';
import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useFulfilmentPerms } from '@/hooks/use-fulfilment-perms';
import { ACTIVE_STAGES } from '@/lib/orders-view';
import { buildProblems, waitLabel, type ProblemGroup } from '@/lib/problems-view';
import type { Actor } from '@/lib/retail-fulfill';
import { C, Empty, Initials, LargeTitle, ListRow, UndoBar, muted } from './ui';
import { PhoneShopBar, useWide } from './shell';
import { ProblemPanel } from './ProblemPanel';

export function ProblemsApp() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, can } = useTenant() as any; const { user } = useUser() as any;
  const perms = useFulfilmentPerms();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant as any)?.retailSettings || {};
  const actor: Actor = React.useMemo(() => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user]);
  const wide = useWide();
  const canRefund = typeof can === 'function' ? can('checkout.refund') : false;

  const [orders, setOrders] = React.useState<any[]>([]);
  const [refundOrders, setRefundOrders] = React.useState<any[]>([]);
  const [tickets, setTickets] = React.useState<any[]>([]);
  const [claims, setClaims] = React.useState<any[]>([]);
  const [returns, setReturns] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  React.useEffect(() => { const id = new URLSearchParams(window.location.search).get('order'); if (id) setOpenId(id); }, []);
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

  const groups = React.useMemo(() => buildProblems({ orders, refundOrders, tickets, claims, returns, now, staleHours: Math.max(1, Number(rs.readyStaleHours) || 48) }), [orders, refundOrders, tickets, claims, returns, now, rs.readyStaleHours]);
  React.useEffect(() => { if (wide && !openId && groups.length) setOpenId(groups[0].orderId); }, [wide, openId, groups]);
  const open = openId ? groups.find((g) => g.orderId === openId) || null : null;
  React.useEffect(() => { if (openId && !open && !loading && !wide) setOpenId(null); }, [openId, open, loading, wide]);

  const row = (g: ProblemGroup) => {
    const more = g.items.length - 1;
    return <ListRow key={g.orderId} onClick={() => setOpenId(g.orderId)} active={wide && openId === g.orderId} lead={<Initials name={g.customerName} />}
      title={g.customerName} detail={`${g.items[0].title}${more > 0 ? ` and ${more} more` : ''}`}
      trail={<span className="shrink-0 text-[14px]" style={g.urgent ? { color: C.warn, fontWeight: 600 } : muted}>{g.urgent ? 'Now' : waitLabel(g.at, now)}</span>} />;
  };
  const panel = open && <ProblemPanel key={open.orderId} fs={fs} tenantId={tenantId} group={open} actor={actor} rs={rs} canRefund={canRefund} canManage={!!perms.canManage} inline={wide} onClose={() => setOpenId(null)} onToast={setToast} />;
  const header = (
    <div className="px-4 pt-3">
      <div className="h-11 lg:hidden" />
      <LargeTitle title="Problems" sub={loading ? 'Loading…' : groups.length ? `${groups.length} order${groups.length === 1 ? '' : 's'} need${groups.length === 1 ? 's' : ''} you` : 'All clear'} />
    </div>);
  const list = loading ? <p className="px-4 py-10 text-center text-[15px]" style={muted}>Loading…</p>
    : groups.length === 0 ? <Empty title="Nothing needs you" sub="Messages, problem reports, returns and refunds show up here the moment they come in." action={<Link href="/retail-orders" className="text-[17px] font-semibold" style={{ color: C.ink }}>Back to orders</Link>} />
    : <div className="cf-stagger mt-3">{groups.map(row)}</div>;

  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      {wide ? (
        <div className="flex h-[100dvh]">
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-8">{header}{list}</div>
          <div className="w-[480px] shrink-0 overflow-y-auto border-l" style={{ borderColor: C.line }}>{panel || <Empty title="Pick an order" sub="Every problem on it, with what to do next." />}</div>
        </div>
      ) : <div className="pb-32">{header}{list}</div>}
      {!wide && !open && <PhoneShopBar problems={groups.length} />}
      {!wide && panel}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 96} />}
    </div>);
}

