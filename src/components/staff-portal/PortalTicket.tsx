'use client';
// src/components/staff-portal/PortalTicket.tsx — the FULL VISIT TICKET in the staff app (the same ticket the desk uses:
// stage and next step on top; Visit · Payment · Timeline · More below), and SCAN: the QR on a printed ticket by camera, a
// USB/Bluetooth scanner, or the short code typed in — it opens that visit's ticket.
import * as React from 'react';
import { VisitTicket } from '@/components/visit/VisitTicket';
import { ScanCheckInDialog } from '@/components/planner/ScanCheckInDialog';

const VARS = { ['--card' as any]: '#ffffff', ['--line' as any]: '#ececee', ['--soft' as any]: '#f3f3f5', ['--muted' as any]: '#6d7075', ['--ink' as any]: '#16171a', ['--ok' as any]: '#1f7a4d', ['--warn' as any]: '#b45309' } as React.CSSProperties;

export function PortalTicket({ tenantId, appointmentId, accent, onClose }: { tenantId: string; appointmentId: string | null; accent: string; onClose: () => void }) {
  if (!appointmentId) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#fafafa]" role="dialog" aria-modal="true" aria-label="Visit ticket" style={{ ...VARS, ['--accent' as any]: accent, ['--accent-ink' as any]: '#ffffff' }}>
      <div className="flex items-center justify-between border-b border-[#ececee] bg-white px-4 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <button onClick={onClose} className="text-[15px] font-semibold text-[#6d7075]">‹ Back</button>
        <p className="text-[16px] font-bold">Visit</p><span className="w-12" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        <div className="mx-auto max-w-lg"><VisitTicket key={appointmentId} tenantId={tenantId} appointmentId={appointmentId} onClose={onClose} tabs /></div>
      </div>
    </div>);
}

export function PortalScan({ open, onOpenChange, firestore, tenantId, appointments, services, staff, onFound }: { open: boolean; onOpenChange: (o: boolean) => void; firestore: any; tenantId: string; appointments: any[]; services: any[]; staff: any[]; onFound: (apt: any) => void }) {
  return <ScanCheckInDialog open={open} onOpenChange={onOpenChange} firestore={firestore} tenantId={tenantId} appointments={appointments} services={services} staff={staff} onSelect={(a: any) => { onOpenChange(false); onFound(a); }} />;
}
