'use client';
// src/components/visit/VisitTicketHost.tsx — mounted once in the app shell: any page opens a visit with
// openVisit(appointmentId) (lib/visit-client). Staff only (it's inside the signed-in app).
// ONE VISIT EVERYWHERE: the full Visit (five tabs — Now · Client · Service · Money · History) opens wherever you are.
// Start and waiving a fee happen in place; actions that need the planner's own dialogs (Finish → the hand-off review,
// edit, cancel, rebook, print) take you to the planner with this visit open. A walk-in, or a visit too old to be
// loaded here, opens the quick visit ticket instead.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/pos/desk/kit';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase } from '@/firebase';
import { doc, writeBatch, increment } from 'firebase/firestore';
import { VisitTicket } from '@/components/visit/VisitTicket';
import dynamic from 'next/dynamic';
// Loaded only when a visit is opened — the host sits on every page, the full Visit is large.
const AppointmentDetailsSheet: any = dynamic(() => import('@/components/planner/AppointmentDetailsSheet').then((m) => m.AppointmentDetailsSheet), { ssr: false });

export function VisitTicketHost() {
  const { selectedTenant } = useTenant() as any;
  const { appointments, clients, services, transactions } = useInventory() as any;
  const { firestore } = useFirebase() as any;
  const router = useRouter();
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(() => { const open = (e: any) => setId(String(e?.detail?.appointmentId || '') || null); window.addEventListener('cf:open-visit', open); return () => window.removeEventListener('cf:open-visit', open); }, []);
  const tenantId = selectedTenant?.id || null;
  const accent = selectedTenant?.bookingPageSettings?.cfPageConfig?.accentColor || selectedTenant?.brandColor || null;
  const onPlanner = typeof window !== 'undefined' && window.location.pathname.startsWith('/planner');
  const appt: any = id ? (appointments || []).find((a: any) => a.id === id) : null;
  // On the planner itself, the planner's own Visit handles it (it reads ?visit=).
  React.useEffect(() => { if (id && onPlanner && appt) { router.push(`/planner?visit=${encodeURIComponent(id)}`); setId(null); } }, [id, onPlanner, appt, router]);
  const toPlanner = () => { if (!id) return; const v = id; setId(null); router.push(`/planner?visit=${encodeURIComponent(v)}`); };

  if (appt && !onPlanner && !String(appt.id).startsWith('apt-walkin-')) {
    return <AppointmentDetailsSheet
      open={!!id} onOpenChange={(o: boolean) => { if (!o) setId(null); }} appointment={appt}
      client={(clients || []).find((c: any) => c.id === appt.clientId) || null} service={(services || []).find((s: any) => s.id === appt.serviceId) || null}
      tmhr={selectedTenant?.tmhr || 50} transactions={transactions || []}
      onStartService={(aid: string) => { if (!firestore || !tenantId) return; const a: any = (appointments || []).find((x: any) => x.id === aid); if (!a) return; const now = new Date().toISOString(); const b = writeBatch(firestore);
        b.update(doc(firestore, 'tenants', tenantId, 'appointments', aid), { status: 'servicing', actualStartTime: now }); if (a.checkInToken) b.update(doc(firestore, 'appointmentCheckIns', a.checkInToken), { status: 'servicing', tenantId });
        if (a.staffId) b.set(doc(firestore, 'tenants', tenantId, 'staff', a.staffId), { status: 'busy' }, { merge: true }); void b.commit(); }}
      onFinishService={toPlanner} onEdit={toPlanner} onDelete={toPlanner} onCancel={toPlanner} onRebook={toPlanner} onBookNewForClient={toPlanner} onPrintTicket={toPlanner} onOverride={toPlanner}
      onWaiveFee={(aid: string, aut: any, res: string) => { if (!firestore || !tenantId) return; const a: any = (appointments || []).find((x: any) => x.id === aid); if (!a) return; const b = writeBatch(firestore);
        b.update(doc(firestore, `tenants/${tenantId}/appointments`, aid), { cancellationFeeWaived: true, waivedBy: aut?.id || null, waivedReason: res, waivedAt: new Date().toISOString() });
        b.update(doc(firestore, `tenants/${tenantId}/clients`, a.clientId), { outstandingBalance: increment(-(a.cancellationFeeApplied || 0)) }); void b.commit(); }}
    />;
  }
  return <Drawer accent={accent} open={!!id && !!tenantId && !(onPlanner && appt)} onClose={() => setId(null)} title="Visit">
    {id && tenantId ? <VisitTicket key={id} tenantId={tenantId} appointmentId={id} onClose={() => setId(null)} /> : null}
  </Drawer>;
}
