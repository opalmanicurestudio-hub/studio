'use client';
// src/app/(app)/mileage/page.tsx — MILEAGE (components/money/MileageScreen; api/mileage). The business's drives, logged
// as they happen or after, with the year's log for the accountant. The owner logs; anyone whose role includes keeping
// the books sees it and downloads it. Reached from Money, Write-offs, and the menu.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { MileageScreen } from '@/components/money/MileageScreen';

/** Where the phone is, once (no following): null when location is off or it takes too long. */
function where(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
}

export default function MileagePage() {
  const { selectedTenant, role, can } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const post = React.useCallback(async (body: any) => {
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    try { const r = await fetch('/api/mileage', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, ...body }) }); return await r.json(); }
    catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const allowed = role && can('money.manage');
  return (
    <div className="flex min-h-screen w-full flex-col" style={{ background: '#f5f5f7' }}>
      <AppHeader title="Mileage" />
      <main className="flex-1">
        {!tenantId || !role ? null
          : allowed ? <MileageScreen key={tenantId} post={post} where={where} business={String(selectedTenant?.name || '')} backHref="/money?tab=writeoffs" />
          : <p className="mx-auto max-w-sm px-6 py-16 text-center text-[15px]" style={{ color: '#6d7075' }}>The owner keeps the mileage log, and people whose role includes keeping the books can see it.</p>}
      </main>
    </div>
  );
}
