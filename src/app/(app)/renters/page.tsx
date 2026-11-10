"use client";

// ─── RENTERS ─────────────────────────────────────────────────────────────────
// Every renter relationship on one screen — revived as its own page after two
// years folded into the booth hub (the v49 consolidation that made sense at
// three features and stopped making sense at nine).
//
// Same organising idea as Pipeline: ATTENTION, not alphabet. The renter who is
// leased, paying rent, and still invisible to clients because they never set
// hours is quietly losing money every week — theirs and yours. That person
// belongs at the top of this list, not buried in a directory sorted A→Z.
//
// This page decides who needs you. The deep work — leases, documents, money,
// the full card — still lives in the hub until its zone moves here too.

import React, { useEffect, useMemo, useState } from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { collection, doc, onSnapshot, updateDoc, setDoc, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { RentalsHeader, RENTALS_BTN, RENTALS_BTN_DARK } from '@/components/renters/RentalsNav';
import { RentersRoster } from '@/components/renters/RentersRoster';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { cn } from '@/lib/utils';
import {
  Users, AlertTriangle, CheckCircle2, Loader, Phone, Mail,
  ArrowRight, Armchair, Moon, ExternalLink,
} from 'lucide-react';
import { RenterCommsDesk } from '@/components/renters/RenterCommsDesk';
import { staffMirrorFields, mirrorDiffers, publicName } from '@/lib/renter-identity';
import { bookableState } from '@/lib/bookable';

type R = any;

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const FREQ_LABEL: Record<string, string> = {
  weekly: 'wk', biweekly: '2wk', monthly: 'mo', daily: 'day', hourly: 'hr',
};

/**
 * Can clients actually book this renter through the studio?
 *
 * Mirrors the renter portal's own checklist rule exactly (hours must exist,
 * be enabled, and have a start and an end) so this page and their portal can
 * never disagree about whether setup is finished. An 'own'-mode renter runs
 * their own system and is finished by definition.
 */
const OCCUPYING = ['active', 'on_leave', 'pending_signature'];

export default function RentersPage() {
  const { firestore } = useFirebase() as any;
  const { selectedLocationId } = useLocation();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const [renters, setRenters] = useState<R[]>([]);
  const [leases, setLeases] = useState<R[]>([]);
  const [staff, setStaff] = useState<R[]>([]);
  const [booths, setBooths] = useState<R[]>([]);
  const router = useRouter();
  // Each renter has their own page (app/(app)/renters/[renterId]): the list, the messages desk and links all open it.
  const openRenter = (id: string, tab?: string) => router.push(`/renters/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`);
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [renterServices, setRenterServices] = useState<any[]>([]);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const sub = (name: string, set: any, done?: boolean) =>
      onSnapshot(collection(firestore, 'tenants', tenantId, name),
        (s) => { set(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))); if (done) setLoading(false); },
        () => { if (done) setLoading(false); });
    const unsubs = [sub('renters', setRenters, true), sub('leases', setLeases),
      sub('staff', setStaff), sub('booths', setBooths),
      sub('renterServices', setRenterServices)];
    return () => unsubs.forEach((u) => u());
  }, [firestore, tenantId]);

  // /renters?renter=<id> opens that renter (the Rentals home's "Open" and "Message"); ?desk=inbox|concerns opens the
  // messages desk on that tab. Once per link, after the renters have loaded.
  const [deskTab, setDeskTab] = useState<'inbox' | 'concerns' | 'everyone' | undefined>(undefined);
  // Unread messages from renters, for the Messages button.
  // Only from renters still on the books (here, at this location), as the messages desk shows them.
  const [unreadIds, setUnreadIds] = useState<string[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(query(collection(firestore, 'tenants', tenantId, 'renterThreads'), where('unreadForOwner', '==', true)), (s) => setUnreadIds(s.docs.map((d) => String((d.data() as any).renterId || d.id))), () => setUnreadIds([]));
  }, [firestore, tenantId]);
  const unreadThreads = useMemo(() => unreadIds.filter((id) => renters.some((r) => r.id === id && r.status !== 'archived' && (!r.locationId || !selectedLocationId || r.locationId === selectedLocationId))).length, [unreadIds, renters, selectedLocationId]);
  const linked = React.useRef(false);
  useEffect(() => {
    if (linked.current || loading || typeof window === 'undefined') return;
    linked.current = true;
    const q = new URLSearchParams(window.location.search);
    const rid = q.get('renter'); const desk = q.get('desk');
    if (rid) { router.replace(`/renters/${encodeURIComponent(rid)}`); return; }   // older links to a renter
    if (desk === 'inbox' || desk === 'concerns') {
      setDeskTab(desk);
      setTimeout(() => document.getElementById('renter-desk')?.scrollIntoView({ block: 'start' }), 50);
    }
  }, [loading, renters]);

  // ── Turning bookings on ───────────────────────────────────────────────
  // Everything a renter can run from their portal — menu, hours, booking
  // link, their book, their clients, their payouts — hangs off one staff
  // record with isRenter set. Without it their portal is rent and nothing
  // else, and the only place to create it was a card on another page. The
  // flag that says it is missing is right here, so the fix is too.
  const [enabling, setEnabling] = useState('');
  const enableBookings = async (r: any) => {
    if (!firestore || !tenantId) return;
    setEnabling(r.id);
    try {
      const existing = staff.find((s: any) => s.isRenter && s.renterId === r.id);
      const staffId = existing?.id || doc(collection(firestore, 'tenants', tenantId, 'staff')).id;
      await setDoc(doc(firestore, 'tenants', tenantId, 'staff', staffId), {
        id: staffId, tenantId, role: 'staff',
        isRenter: true, renterId: r.id, payStructure: 'none',
        isActive: true, active: false, onBreak: false, status: 'idle',
        ...staffMirrorFields(r),
      }, { merge: true });
      toast({ title: 'Bookings on', description: `${r.firstName} can now set their menu, hours and booking link from their portal. They still need hours before anyone can book them.` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not turn that on', description: 'Try again in a moment.' });
    } finally { setEnabling(''); }
  };

  const rows = useMemo(() => {
    const boothName = new Map(booths.map((b) => [b.id, b.name || 'Space']));
    const staffByRenter = new Map(staff.filter((s) => s.isRenter && s.renterId)
      .map((s) => [s.renterId, s]));
    return renters
      .filter((r) => !r.locationId || !selectedLocationId || r.locationId === selectedLocationId)
      .map((r) => {
        const myLeases = leases.filter((l) => l.renterId === r.id && OCCUPYING.includes(String(l.status)));
        const unsigned = myLeases.some((l) => l.status === 'pending_signature');
        const spaces = myLeases.map((l) => boothName.get(l.boothId) || 'Space');
        const rent = myLeases.reduce((sum, l) => sum + (Number(l.rentAmountCents) || 0), 0);
        const freq = myLeases[0]?.frequency || 'monthly';
        const ownMode = r.bookingMode === 'own';
        const st = staffByRenter.get(r.id);
        const book = bookableState({
          staff: st || null, isRenter: true, bookingMode: r.bookingMode,
          serviceCount: (renterServices || []).filter((sv: any) => st && sv.staffId === st.id && sv.isActive !== false).length,
        });
        const needsSetup = ['active', 'on_leave'].includes(String(r.status))
          && myLeases.length > 0 && !book.ok && !book.byDesign;
        const noPortal = r.portalInviteStatus !== 'accepted';
        return { r, myLeases, unsigned, spaces, rent, freq, ownMode, book, needsSetup, noPortal };
      });
  }, [renters, leases, staff, booths, selectedLocationId, renterServices]);

  // Renters who have a lease but can't be booked yet (no hours, or no booking record at all), with the fix.
  const needsSetup = useMemo(() => rows.filter((x) => x.needsSetup).sort((a, b) => `${a.r.firstName} ${a.r.lastName}`.localeCompare(`${b.r.firstName} ${b.r.lastName}`)), [rows]);
  // The roster reads again when a renter or lease changes here.
  const rosterKey = useMemo(() => [...renters, ...leases].map((x: any) => `${x.id}:${x.status || ''}:${x.updatedAt || ''}:${x.portalInviteStatus || ''}`).join('|'), [renters, leases]);
  // Cleared first, so asking for the same tab again switches back to it.
  const openDesk = (t: 'inbox' | 'concerns' | 'everyone') => { setDeskTab(undefined); setTimeout(() => { setDeskTab(t); document.getElementById('renter-desk')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 30); };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader title="Renters" />
      <div className="flex-1 w-full max-w-[1200px] mx-auto min-w-0 px-4 py-6 sm:px-6 space-y-5">
      <RentalsHeader businessName={selectedTenant?.name || ''} current="/renters" actions={<>
        <LocationSwitcher />
        <button type="button" className={RENTALS_BTN} onClick={() => openDesk('inbox')}>Messages{unreadThreads > 0 && <span className="text-[#b45309]">· {unreadThreads}</span>}</button>
        <button type="button" className={RENTALS_BTN} onClick={() => openDesk('everyone')}>Message everyone</button>
        <Link href="/booths?addRenter=1" className={RENTALS_BTN_DARK}>Add renter</Link>
      </>} />

      {needsSetup.length > 0 && (
        <section aria-labelledby="not-bookable" className="rounded-[20px] border border-[#ececee] bg-white px-5 pb-3 pt-4">
          <h2 id="not-bookable" className="text-[17px] font-bold leading-6 text-[#16171a]">Can’t be booked yet <span className="font-medium text-[#6d7075]">· {needsSetup.length}</span></h2>
          <p className="text-[13px] leading-snug text-[#6d7075]">They have a lease, but clients can’t book them until this is done.</p>
          <ul className="mt-1">
            {needsSetup.map(({ r, book }, i) => (
              <li key={r.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 ${i ? 'border-t border-[#ececee]' : ''}`}>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[#16171a]">{r.firstName} {r.lastName}</p>
                  <p className="text-[13px] leading-snug text-[#b45309]">{book.label}</p>
                </div>
                {book.reason === 'no_provider'
                  ? <button type="button" onClick={() => void enableBookings(r)} disabled={enabling === r.id} className={RENTALS_BTN_DARK}>{enabling === r.id ? 'Turning on…' : 'Turn on bookings'}</button>
                  : <button type="button" onClick={() => openRenter(r.id)} className={RENTALS_BTN}>Open</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tenantId && <RentersRoster tenantId={tenantId} locationId={selectedLocationId} refreshKey={rosterKey} onOpen={(id) => openRenter(id)} />}

      {tenantId && (
        <div id="renter-desk" className="scroll-mt-20"><RenterCommsDesk tenantId={tenantId} firestore={firestore} tenant={selectedTenant} renters={renters} booths={booths} leases={leases} initialTab={deskTab}
          studioName={selectedTenant?.name || 'The business'} onOpenRenter={(id) => openRenter(id, 'messages')} /></div>
      )}

      </div>
    </div>
  );
}
