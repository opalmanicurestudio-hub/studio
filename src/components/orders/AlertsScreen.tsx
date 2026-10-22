'use client';
// src/components/orders/AlertsScreen.tsx — ORDERS → SETUP → ALERTS: each person picks which order alerts they get
// (lib/order-alerts): a big day, orders coming in fast, the cutoff in an hour, orders that missed the pickup. Saved on
// their own staff record. Until they choose, whoever packed shipped orders lately gets the cutoff, and the owner,
// admins and the managers who run the shop get the rest; the one person packing, when only one is, gets all four.
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, getDocs, limit, orderBy, query, updateDoc, where, type Firestore } from 'firebase/firestore';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { ORDER_ALERTS, PACKERS_DAYS, packersOf, wantsAlert, type OrderAlertKind } from '@/lib/order-alerts';
import { C, Group, Ic, LargeTitle, Row, Toggle, UndoBar, muted } from './ui';
import { PhoneShopBar, useWide } from './shell';

export function AlertsScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, staffId } = useTenant() as any; const { user } = useUser() as any;
  const { staff } = useInventory() as any;
  const wide = useWide();
  const tenantId = String(selectedTenant?.id || '');
  const team = React.useMemo(() => (staff || []).filter((m: any) => m && m.archived !== true), [staff]);
  const me = team.find((m: any) => m.id === staffId || (user?.uid && (m.id === user.uid || m.authUid === user.uid))) || null;
  // Who packed online orders lately: the defaults follow what people actually do, not what the app lets them do.
  const [packedBy, setPackedBy] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const since = new Date(Date.now() - PACKERS_DAYS * 86_400_000).toISOString();
    getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('packedAt', '>=', since), orderBy('packedAt', 'desc'), limit(1000)))
      .then((s) => setPackedBy(s.docs.map((d) => d.data() as any).filter((o) => o?.method === 'ship').map((o) => String(o?.claimedBy || ''))))
      .catch(() => setPackedBy([]));
  }, [fs, tenantId]);
  const packers = React.useMemo(() => packersOf(team, packedBy || []), [team, packedBy]);
  const mePacks = !!me && packers.has(String(me.id));
  const [own, setOwn] = React.useState<Partial<Record<OrderAlertKind, boolean>>>({});
  const [toast, setToast] = React.useState('');
  const on = (k: OrderAlertKind) => (typeof own[k] === 'boolean' ? !!own[k] : !!me && wantsAlert(k, me, packers));

  const set = async (k: OrderAlertKind, v: boolean) => {
    if (!me) return;
    setOwn((o) => ({ ...o, [k]: v }));
    try { await updateDoc(doc(fs, `tenants/${tenantId}/staff`, me.id), { [`notificationPrefs.orderAlerts.${k}`]: v, updatedAt: new Date().toISOString() }); }
    catch { setOwn((o) => ({ ...o, [k]: !v })); setToast('That didn’t save. Check your connection and try again.'); }
  };

  return (
    <div className="cf-settings min-h-[100dvh] pb-32" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/retail-orders/setup" aria-label="Back to setup" className="cf-press grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.soft, color: C.ink }}>{Ic.back}</Link>
          <span className="text-[14px]" style={muted}>Setup</span>
          <span className="h-11 w-11" />
        </div>
        <div className="mt-3"><LargeTitle title="Alerts" sub="What buzzes your phone about online orders. Each goes out once a day at most." /></div>
        {me && packedBy === null ? (
          <p className="m-0 mt-8 text-[15px]" style={muted}>One moment…</p>
        ) : me ? (
          <Group title="Your alerts" foot={<>They show in the app’s alerts and buzz your phone where you’ve turned alerts on in the staff app, outside your quiet hours. Until you choose, whoever packed shipped orders in the last two weeks gets the cutoff, and the owner, admins and managers who pack get a big day, coming in fast and missed the pickup{mePacks && packers.size === 1 ? '. You’re the only one packing lately, so you get all four' : ''}.</>}>
            {ORDER_ALERTS.map((a, i) => (
              <Row key={a.kind} label={a.label} note={a.hint} last={i === ORDER_ALERTS.length - 1}>
                <Toggle on={on(a.kind)} onChange={(v) => void set(a.kind, v)} label={a.label} />
              </Row>))}
          </Group>
        ) : (
          <p className="m-0 mt-8 text-[15px] leading-snug" style={muted}>Alerts go to the people on your team list. Add yourself under Staff, and your alerts can be chosen here.</p>
        )}
      </div>
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 96} />}
      {!wide && <PhoneShopBar problems={0} />}
    </div>);
}
