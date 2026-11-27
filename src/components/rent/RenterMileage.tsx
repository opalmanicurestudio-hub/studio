'use client';
// src/components/rent/RenterMileage.tsx — A RENTER'S OWN MILEAGE LOG (Money, Your business, Mileage; included in rent).
// The same screen the business uses (components/money/MileageScreen), against /api/portal/renter-mileage: their drives for
// their own business, kept apart from the business's books and seen only by them. The print names their business.
import * as React from 'react';
import { MileageScreen } from '@/components/money/MileageScreen';

/** Where the phone is, once (no following): null when location is off or it takes too long. */
function where(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
}

export function RenterMileage({ tenantId, token, business }: { tenantId: string; token: string; business: string }) {
  const post = React.useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/portal/renter-mileage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, tenantId, token }) });
      return await r.json();
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId, token]);
  return <div className="-mx-4"><MileageScreen key={`${tenantId}_${token.slice(0, 8)}`} renter post={post} where={where} business={business} /></div>;
}
