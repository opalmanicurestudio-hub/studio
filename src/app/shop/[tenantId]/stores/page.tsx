'use client';
// src/app/shop/[tenantId]/stores/page.tsx — FIND A STORE (design board "The online shop at more than one store";
// api/retail/stores, lib/shop-stores). With two or more stores on the shop: each with its address, whether it's open now
// and until when (or when it opens), and directions. "Find the nearest" sorts them by distance on the customer's own
// phone (where they are is never sent). "Shop this store" picks it for pickup at checkout, remembered on this device.
// One store, or none: the page says so and points to the shop.
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShopHeader } from '@/components/shop/ShopChrome';
import { nearestFirst } from '@/lib/ahead-places';
import { savedStore, saveStore, storeOpenLine, type StoreRow } from '@/lib/shop-stores';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--shop-ink)] focus-visible:ring-offset-2';

export default function StoresPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = React.use(params);
  const router = useRouter();
  const [data, setData] = useState<{ stores: StoreRow[]; tz: string } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [nearState, setNearState] = useState<'idle' | 'finding' | 'denied'>('idle');
  const [mine, setMine] = useState('');
  const load = React.useCallback(() => {
    setState('loading');
    fetch(`/api/retail/stores?tenantId=${encodeURIComponent(tenantId)}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('x')))).then((d) => {
      const list: StoreRow[] = Array.isArray(d?.stores) ? d.stores : [];
      if (!d?.several || list.length < 2) { setState('none'); return; }
      setData({ stores: list, tz: String(d.timeZone || 'UTC') }); setState('ready');
    }).catch(() => setState('error'));
  }, [tenantId]);
  useEffect(() => { load(); setMine(savedStore(tenantId)); }, [load, tenantId]);
  const findNearest = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setNearState('denied'); return; }
    setNearState('finding');
    navigator.geolocation.getCurrentPosition((p) => { setNear({ lat: p.coords.latitude, lng: p.coords.longitude }); setNearState('idle'); }, () => setNearState('denied'), { maximumAge: 300000, timeout: 10000 });
  };
  const shopHere = (id: string) => { saveStore(tenantId, id); setMine(id); router.push(`/shop/${tenantId}/catalog`); };
  const list = data ? nearestFirst(data.stores.map((x) => ({ ...x, coordinates: x.lat !== null && x.lng !== null ? { lat: x.lat, lng: x.lng } : null })), near) : [];
  const btn = `inline-flex min-h-[44px] flex-1 items-center justify-center px-4 text-[14.5px] font-semibold ${FOCUS}`;

  return (
    <>
      <ShopHeader active="stores" />
      <main className="mx-auto w-full max-w-[640px] px-4 pb-16 pt-8 md:pt-12" style={{ color: 'var(--shop-ink)' }}>
        <h1 className="m-0 text-[28px] font-semibold leading-tight" style={{ fontFamily: 'var(--shop-heading-font, inherit)' }}>Find a store</h1>
        <p className="mb-0 mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--shop-muted)' }}>Shop online and pick up at the store you choose. A delivery comes from the nearest store that delivers to you.</p>
        {state === 'loading' && <p role="status" className="mt-6 text-[15px]" style={{ color: 'var(--shop-muted)' }}>Finding the stores…</p>}
        {state === 'error' && (
          <div role="alert" className="mt-6 flex flex-wrap items-center gap-3">
            <span className="text-[15px]">The stores couldn’t be loaded.</span>
            <button type="button" onClick={load} className={`${btn} flex-none underline underline-offset-4`}>Try again</button>
          </div>)}
        {state === 'none' && (
          <p className="mt-6 text-[15px]">Everything is at one place. <Link href={`/shop/${tenantId}`} className="font-semibold underline underline-offset-4">Back to the shop</Link></p>)}
        {state === 'ready' && data && (
          <>
            <button type="button" onClick={findNearest} disabled={nearState === 'finding'} className={`${btn} mt-5 w-full disabled:opacity-50`}
              style={{ border: '1px solid var(--shop-line)', borderRadius: 'var(--shop-radius-control)', background: 'var(--shop-surface)' }}>
              {nearState === 'finding' ? 'Finding you…' : near ? 'Nearest first' : 'Find the nearest'}
            </button>
            {nearState === 'denied' && <p role="status" className="mb-0 mt-2 text-[13.5px]" style={{ color: 'var(--shop-muted)' }}>Your location isn’t shared, so the stores are listed by name.</p>}
            <ul className="m-0 mt-4 list-none space-y-3 p-0">
              {list.map((x) => { const isMine = x.id === mine; return (
                <li key={x.id} className="space-y-1 p-4" style={{ border: `1px solid ${isMine ? 'var(--shop-ink)' : 'var(--shop-line)'}`, borderRadius: 'var(--shop-radius-card)', background: 'var(--shop-card, var(--shop-surface))' }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="m-0 text-[17px] font-semibold">{x.name}</h2>
                    {x.miles !== null && <span className="shrink-0 text-[14px] tabular-nums" style={{ color: 'var(--shop-muted)' }}>{x.miles} mi</span>}
                  </div>
                  {x.address && <p className="m-0 text-[14.5px]" style={{ color: 'var(--shop-muted)' }}>{x.address}</p>}
                  <p className={`m-0 text-[14.5px] ${x.open ? 'font-semibold' : ''}`} style={{ color: x.open ? 'var(--shop-ink)' : 'var(--shop-muted)' }}>{storeOpenLine(x, data.tz)}</p>
                  {isMine && <p className="m-0 text-[13.5px] font-semibold">Your store</p>}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button type="button" onClick={() => shopHere(x.id)} className={btn}
                      style={isMine ? { borderRadius: 'var(--shop-radius-control)', background: 'var(--shop-ink)', color: 'var(--shop-surface)' } : { borderRadius: 'var(--shop-radius-control)', border: '1px solid var(--shop-line)', background: 'var(--shop-surface)' }}>Shop this store</button>
                    {x.directions && <a href={x.directions} target="_blank" rel="noreferrer" className={btn} style={{ borderRadius: 'var(--shop-radius-control)', border: '1px solid var(--shop-line)', background: 'var(--shop-surface)', color: 'inherit', textDecoration: 'none' }}>Directions</a>}
                  </div>
                </li>); })}
            </ul>
          </>)}
      </main>
    </>);
}
