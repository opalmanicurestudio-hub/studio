// src/components/auth/BusinessClosedGate.tsx — for the kiosk and wall screens that run on their own, outside the owner's
// app (floor, kitchen display, lobby, concierge, housekeeping); the team app shows the same card from its own layout
// (app/staff-portal/[tenantId]/layout). A paused or closed business (lib/tenant-access) gets one plain card instead of
// the screen; an open one gets the screen. Read on the server on every request (the layouts using it are
// force-dynamic), so a lock or unlock shows on the next load.
import type { ReactNode } from 'react';
import { getAdminDb } from '@/lib/firebase-admin';
import { accessLockOf } from '@/lib/tenant-access';

export async function BusinessClosedGate({ tenantId, line, fallbackTitle, children }: { tenantId: string; line: string; fallbackTitle: string; children: ReactNode }) {
  let t: any = null;
  try { t = (await getAdminDb().doc(`tenants/${String(tenantId)}`).get()).data() || null; } catch { t = null; }
  if (!accessLockOf(t).locked) return <>{children}</>;
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7', padding: 20, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#16171a' }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#ffffff', border: '1px solid #ececee', borderRadius: 24, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{String(t?.name || fallbackTitle)}</h1>
        <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.5, color: '#4a4c52' }}>{line}</p>
      </div>
    </main>
  );
}
