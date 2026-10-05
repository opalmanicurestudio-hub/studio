'use client';
// src/components/visit/VisitTicketHost.tsx — mounted once in the app shell: any page opens a visit's ticket with
// openVisit(appointmentId) (lib/visit-client). Staff only (it's inside the signed-in app).
import * as React from 'react';
import { Drawer } from '@/components/pos/desk/kit';
import { useTenant } from '@/context/TenantContext';
import { VisitTicket } from '@/components/visit/VisitTicket';

export function VisitTicketHost() {
  const { selectedTenant } = useTenant() as any;
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(() => { const open = (e: any) => setId(String(e?.detail?.appointmentId || '') || null); window.addEventListener('cf:open-visit', open); return () => window.removeEventListener('cf:open-visit', open); }, []);
  const tenantId = selectedTenant?.id || null;
  const accent = selectedTenant?.bookingPageSettings?.cfPageConfig?.accentColor || selectedTenant?.brandColor || null;
  return <Drawer accent={accent} open={!!id && !!tenantId} onClose={() => setId(null)} title="Visit ticket">
    {id && tenantId ? <>
      {/* The full Visit (every detail, in five tabs) lives on the planner; this quick ticket links to it. */}
      {typeof window !== 'undefined' && !window.location.pathname.startsWith('/planner') && <a href={`/planner?visit=${encodeURIComponent(id)}`} className="mb-3 flex h-11 items-center justify-center rounded-full text-[14px] font-semibold" style={{ background: '#1c1917', color: '#fff' }}>Open the full visit</a>}
      <VisitTicket key={id} tenantId={tenantId} appointmentId={id} onClose={() => setId(null)} />
    </> : null}
  </Drawer>;
}
