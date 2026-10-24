'use client';
// src/components/orders/SetupScreen.tsx — SETUP FOR THE ONLINE SHOP. Every place that shapes how the shop runs, in a
// few plain groups, so the sidebar can stay at four entries: Orders, Problems, Shoppers, Setup.
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { listedInShop, listingsOf } from '@/lib/variants';
import { setupSteps, showGuided, type SetupStep } from '@/lib/shop-setup';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { Btn, C, Group, LargeTitle, UndoBar, muted, Ic } from './ui';
import { PhoneShopBar, useWide } from './shell';

type Item = [href: string, label: string, note: string];
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Your shop', items: [
    ['/retail-orders/settings', 'Shop settings', 'Pickup, shipping, labels, tax and the products you sell online'],
    ['/retail-orders/policies/shipping', 'Shipping schedule', 'Processing time, cutoff, pickups and holidays'],
    ['/retail-orders/policies', 'Policies', 'Cancelling, returns, restocking fees, refunds'],
    ['/retail-orders/designer', 'Shop designer', 'How your shop page looks'],
    ['/retail-orders/wholesale', 'Wholesale', 'Trade prices and access for businesses'],
  ] },
  { title: 'Customers', items: [
    ['/retail-orders/reviews', 'Reviews', 'What shoppers say, and which ones show'],
    ['/retail-orders/claims', 'Claims', 'Problem reports with photos and the packing record'],
    ['/retail-orders/lost', 'Lost and recovered', 'Claims to file, money back from carriers and insurance, and where losses come from'],
    ['/retail-orders/returns', 'Returns desk', 'Scan returns in at a bench'],
    ['/retail-orders/support', 'Message inbox', 'Every message, with store credit and reply drafts'],
  ] },
  { title: 'Busy days', items: [
    ['/retail-orders/capacity', 'Capacity', 'How many orders a day you can ship, and what to change when more are due'],
    ['/retail-orders/alerts', 'Alerts', 'A big day, the cutoff, missed pickups: which ones buzz your phone'],
    ['/retail-orders/labels', 'Labels', 'Labels to buy or fix, refunds on the way, carrier adjustments'],
    ['/retail-orders/waves', 'Wave picking', 'Pick many orders in one walk'],
    ['/retail-orders/bins', 'Bins and totes', 'Where products live, shelf labels and tote tags'],
    ['/retail-orders/kpis', 'How it’s going', 'Speed, accuracy and who packed what'],
  ] },
];

function Steps({ steps, busy, onAction }: { steps: SetupStep[]; busy: string; onAction: (s: SetupStep) => void }) {
  const next = steps.find((s) => !s.done);
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="mt-6">
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full" style={{ background: C.soft }}><div className="cf-glide h-1.5 rounded-full" style={{ width: `${(done / steps.length) * 100}%`, background: C.mint }} /></div>
        <span className="text-[14px] font-semibold">{done} of {steps.length}</span>
      </div>
      <ol className="m-0 mt-4 list-none space-y-2 p-0">
        {steps.map((s, i) => {
          const isNext = s === next;
          const body = (
            <div className="flex items-start gap-3.5 rounded-2xl p-4" style={isNext ? { border: `2px solid ${C.ink}`, padding: 14 } : { background: C.soft }}>
              <span key={s.done ? 'd' : 'n'} className={`${s.done ? 'cf-anim-pop ' : ''}grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold`} style={s.done ? { background: C.ok, color: '#fff' } : { background: isNext ? C.ink : C.paper, color: isNext ? C.paper : C.ink }}>{s.done ? Ic.check : i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold tracking-[-0.01em]" style={s.done ? { color: C.muted } : undefined}>{s.title}</span>
                <span className="block text-[14px]" style={muted}>{s.note}</span>
                {isNext && s.action && <Btn kind="primary" className="mt-3 w-full" disabled={!!busy || (s.action === 'open' && steps.slice(0, 3).some((x) => !x.done))} onClick={() => onAction(s)}>{busy === s.action ? 'Working…' : s.action === 'test' ? 'Place a test order' : 'Open my shop'}</Btn>}
                {isNext && s.action === 'open' && steps.slice(0, 3).some((x) => !x.done) && <span className="mt-2 block text-[13px]" style={muted}>Finish the first three steps first.</span>}
              </span>
              {!s.action && !s.done && <span className="mt-1.5" style={muted}>{Ic.chev}</span>}
            </div>);
          return <li key={s.id}>{s.href && !s.done ? <Link href={s.href} className="cf-press block">{body}</Link> : s.action === 'test' && s.done ? <button type="button" onClick={() => onAction(s)} className="cf-press block w-full text-left">{body}</button> : body}</li>;
        })}
      </ol>
    </section>);
}

export function SetupScreen() {
  const { selectedTenant } = useTenant() as any;
  const { firestore } = useFirebase() as any;
  const { inventory } = useInventory() as any;
  const router = useRouter();
  const wide = useWide();
  const rs = (selectedTenant as any)?.retailSettings || {};
  const paused = rs.storePaused === true;
  const tenantId = String(selectedTenant?.id || '');
  const liveCount = React.useMemo(() => { const listings = listingsOf(inventory || []); return (inventory || []).filter((i: any) => listedInShop(i, listings)).length; }, [inventory]);
  const guided = showGuided(selectedTenant, liveCount);
  const steps = setupSteps(selectedTenant, liveCount);
  const [busy, setBusy] = React.useState(''); const [toast, setToast] = React.useState('');
  const onAction = async (s: SetupStep) => {
    setBusy(s.action || '');
    try {
      if (s.action === 'test') {
        const r = await fetch('/api/retail/test-order', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) router.push(`/retail-orders?order=${d.orderId}`); else setToast(d.error || 'That didn’t work. Try again.');
      } else if (s.action === 'open') {
        await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { 'retailSettings.storePaused': false, 'retailSettings.shopOpenedAt': new Date().toISOString() });
        setToast('Your shop is open.');
      }
    } catch { setToast('That didn’t work. Try again.'); } finally { setBusy(''); }
  };
  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="h-11" />
        <LargeTitle title="Setup" sub={guided ? 'A few steps and your shop is ready to open.' : paused ? 'Your shop is paused. Shoppers can browse but not buy.' : 'Everything that shapes how your shop runs.'} />
        {guided && <Steps steps={steps} busy={busy} onAction={(s) => void onAction(s)} />}
        {GROUPS.map((g) => (
          <Group key={g.title} title={g.title}>
            {g.items.map(([href, label, note], i) => (
              <Link key={href} href={href} className="cf-press flex min-h-[60px] items-center gap-3 pl-4">
                <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={i === g.items.length - 1 ? undefined : { borderBottom: `1px solid ${C.line}` }}>
                  <span className="min-w-0 flex-1"><span className="block text-[17px] tracking-[-0.01em]">{label}</span><span className="block text-[13px]" style={muted}>{note}</span></span>
                  <span style={muted}>{Ic.chev}</span>
                </span>
              </Link>))}
          </Group>))}
      </div>
      {!guided && (
        <div className="mx-auto max-w-2xl px-4">
          <Group title="Practice">
            <button type="button" onClick={() => void onAction(steps.find((x) => x.id === 'test')!)} disabled={!!busy} className="cf-press flex min-h-[60px] w-full items-center gap-3 px-4 text-left">
              <span className="min-w-0 flex-1"><span className="block text-[17px] tracking-[-0.01em]">{busy === 'test' ? 'Placing a test order…' : 'Place a test order'}</span><span className="block text-[13px]" style={muted}>Free, takes no stock, sends nothing. Good for training someone new.</span></span>
              <span style={muted}>{Ic.chev}</span>
            </button>
          </Group>
        </div>)}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 96} />}
      {!wide && <PhoneShopBar problems={0} />}
    </div>);
}
