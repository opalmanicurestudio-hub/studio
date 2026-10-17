'use client';
// src/components/orders/SetupScreen.tsx — SETUP FOR THE ONLINE SHOP. Every place that shapes how the shop runs, in a
// few plain groups, so the sidebar can stay at four entries: Orders, Problems, Shoppers, Setup.
import * as React from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { C, Group, LargeTitle, muted, Ic } from './ui';
import { PhoneShopBar, useWide } from './shell';

type Item = [href: string, label: string, note: string];
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Your shop', items: [
    ['/retail-orders/settings', 'Shop settings', 'Pickup, shipping, labels, tax and the products you sell online'],
    ['/retail-orders/policies', 'Policies', 'Cancelling, returns, restocking fees, refunds'],
    ['/retail-orders/designer', 'Shop designer', 'How your shop page looks'],
    ['/retail-orders/wholesale', 'Wholesale', 'Trade prices and access for businesses'],
  ] },
  { title: 'Customers', items: [
    ['/retail-orders/reviews', 'Reviews', 'What shoppers say, and which ones show'],
    ['/retail-orders/claims', 'Claims', 'Problem reports with photos and the packing record'],
    ['/retail-orders/returns', 'Returns desk', 'Scan returns in at a bench'],
    ['/retail-orders/support', 'Message inbox', 'Every message, with store credit and reply drafts'],
  ] },
  { title: 'Busy days', items: [
    ['/retail-orders/waves', 'Wave picking', 'Pick many orders in one walk'],
    ['/retail-orders/bench', 'Pack bench', 'A station screen for packing all day'],
    ['/retail-orders/kpis', 'How it’s going', 'Speed, accuracy and who packed what'],
  ] },
  { title: 'More', items: [
    ['/retail-orders/classic', 'Classic orders board', 'The previous orders screen, while you settle in'],
  ] },
];

export function SetupScreen() {
  const { selectedTenant } = useTenant() as any;
  const wide = useWide();
  const rs = (selectedTenant as any)?.retailSettings || {};
  const paused = rs.storePaused === true;
  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="h-11" />
        <LargeTitle title="Setup" sub={paused ? 'Your shop is paused. Shoppers can browse but not buy.' : 'Everything that shapes how your shop runs.'} />
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
      {!wide && <PhoneShopBar problems={0} />}
    </div>);
}
