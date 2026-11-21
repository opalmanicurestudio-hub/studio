'use client';
// src/components/settings/ShopStoresCard.tsx — YOUR STORES, on Shop settings under How customers get orders (design board
// "The online shop at more than one store"; lib/shop-stores-server). Only with more than one location: whether each is a
// store on the shop, delivers from there, its opening hours (the same ones ordering ahead uses), its own shop link and
// code, and the Find a store page's link. Saved by a manager through api/menu ('places', 'aheadPlace').
import { useEffect, useState } from 'react';
import { PlacesCard, type PlaceSettings } from '@/components/menu/PlacesCard';
import { staffAuthHeader } from '@/lib/staff-fetch';

export function ShopStoresCard({ tenantId }: { tenantId: string }) {
  const [places, setPlaces] = useState<PlaceSettings[] | null>(null);
  const [storesLink, setStoresLink] = useState('');
  const call = async (body: any) => {
    try {
      const r = await fetch('/api/menu', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false }));
    } catch { return { ok: false, error: 'That didn’t go through. Check the connection and try again.' }; }
  };
  useEffect(() => {
    if (!tenantId) return;
    let off = false;
    void call({ action: 'places' }).then((d) => { if (!off && d?.ok) { setPlaces(d.places || []); setStoresLink(String(d.storesLink || '')); } });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);
  if (!places || places.length < 2) return null;
  return <PlacesCard mode="shop" places={places} storesLink={storesLink} call={call} onSaved={(a) => { if (Array.isArray(a?.places)) setPlaces(a.places); }} />;
}
