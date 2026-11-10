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
import { endLease, offboardingTodos } from '@/lib/booth-rental-service';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { RentalsHeader, RENTALS_BTN, RENTALS_BTN_DARK } from '@/components/renters/RentalsNav';
import { RentersRoster } from '@/components/renters/RentersRoster';
import Link from 'next/link';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { cn } from '@/lib/utils';
import {
  Users, AlertTriangle, CheckCircle2, Loader, Phone, Mail,
  ArrowRight, Armchair, Moon, ExternalLink,
} from 'lucide-react';
import { RenterProfileDrawer } from '@/components/renters/RenterProfileDrawer';
import { RenterCommsDesk } from '@/components/renters/RenterCommsDesk';
import { staffMirrorFields, mirrorDiffers, publicName } from '@/lib/renter-identity';
import { bookableState } from '@/lib/bookable';
import { PrintLink } from '@/components/shared/PrintLink';

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
  const [reservations, setReservations] = useState<R[]>([]);
  const [amenityRequests, setAmenityRequests] = useState<R[]>([]);
  const [profileRenter, setProfileRenter] = useState<R | null>(null);
  // Their W-9, as the owner may see it (the number masked: /api/booths/w9), for the profile they open.
  const [w9Of, setW9Of] = useState<Record<string, any>>({});
  useEffect(() => {
    const id = profileRenter?.id; if (!id || !tenantId || w9Of[id] !== undefined) return;
    staffAuthHeader().then((h) => fetch(`/api/booths/w9?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(id)}`, { headers: h }))
      // Only a real answer is kept; a failed look leaves it to try again next time the profile opens.
      .then((res) => res.json()).then((d) => { if (d?.ok) setW9Of((m) => ({ ...m, [id]: d.w9 || null })); })
      .catch(() => undefined);
  }, [profileRenter?.id, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState<R | null>(null);
  const [ending, setEnding] = useState<R | null>(null);
  const [busy, setBusy] = useState(false);
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
      sub('boothReservations', setReservations), sub('amenityRequests', setAmenityRequests),
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
    if (rid) { const r = renters.find((x) => x.id === rid); if (r) setProfileRenter(r); }
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
                  : <button type="button" onClick={() => setProfileRenter(r)} className={RENTALS_BTN}>Open</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tenantId && <RentersRoster tenantId={tenantId} locationId={selectedLocationId} refreshKey={rosterKey} onOpen={(id) => { const r = renters.find((x) => x.id === id); if (r) setProfileRenter(r); }} />}

      {tenantId && (
        <div id="renter-desk" className="scroll-mt-20"><RenterCommsDesk tenantId={tenantId} firestore={firestore} tenant={selectedTenant} renters={renters} booths={booths} leases={leases} initialTab={deskTab}
          studioName={selectedTenant?.name || 'The business'} onOpenRenter={(id) => { const r = renters.find((x) => x.id === id); if (r) setProfileRenter(r); }} /></div>
      )}

      {profileRenter && tenantId && (() => {
        const myLease = leases.find((l) => l.renterId === profileRenter.id
          && ['active', 'on_leave', 'pending_signature'].includes(String(l.status)));
        const booth = myLease ? booths.find((b) => b.id === myLease.boothId) : undefined;
        return (
          <RenterProfileDrawer
            renter={profileRenter}
            lease={myLease}
            booth={booth}
            reservations={reservations}
            amenityRequests={amenityRequests}
            w9={w9Of[profileRenter.id]}
            tenantId={tenantId}
            firestore={firestore}
            onClose={() => setProfileRenter(null)}
            onEdit={() => { const r = profileRenter; setProfileRenter(null); setEditing({ ...r }); }}
            onLease={() => { window.location.href = `/booths?lease=${profileRenter.id}`; }}
            onEndLease={() => { const r = profileRenter; setProfileRenter(null); setEnding(r); }}
          />
        );
      })()}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] font-black uppercase tracking-widest">Edit renter</p>
            {([['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
              ['specialty', 'Specialty'], ['businessName', 'Business name']] as [string, string][]).map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
                <input value={editing[k] || ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm font-bold" />
              </label>
            ))}
            <div className="flex gap-2 pt-1">
              <button disabled={busy} onClick={async () => {
                if (!firestore || !tenantId) return;
                setBusy(true);
                try {
                  await updateDoc(doc(firestore, 'tenants', tenantId, 'renters', editing.id), {
                    firstName: editing.firstName || '', lastName: editing.lastName || '',
                    email: editing.email || '', phone: editing.phone || '',
                    specialty: editing.specialty || '', businessName: editing.businessName || '',
                    updatedAt: new Date().toISOString(),
                  });
                  // Their provider record carries the name the booking page
                  // shows. Editing one and not the other is how a renter ends
                  // up publicly listed under a name nobody uses any more.
                  const prov = staff.find((m: any) => m.isRenter && m.renterId === editing.id);
                  if (prov) {
                    const mirror = staffMirrorFields({ ...editing, photoUrl: undefined });
                    if (mirrorDiffers(mirror, prov)) await updateDoc(doc(firestore, 'tenants', tenantId, 'staff', prov.id), mirror);
                  }
                  toast({ title: 'Saved', description: prov ? `${publicName(editing)} — booking page updated too` : `${editing.firstName} ${editing.lastName}` });
                  setEditing(null);
                } catch { toast({ title: 'Could not save', description: 'Try again.' }); }
                setBusy(false);
              }} className="flex-1 rounded-2xl bg-foreground py-3 text-[11px] font-black uppercase tracking-widest text-background disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(null)} className="rounded-2xl bg-muted px-5 py-3 text-[11px] font-black uppercase tracking-widest text-foreground/80">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {ending && (() => {
        const lease = leases.find((l) => l.renterId === ending.id && ['active', 'on_leave', 'pending_signature'].includes(String(l.status)));
        const others = leases.filter((l) => l.renterId === ending.id && l.id !== lease?.id && ['active', 'on_leave', 'pending_signature'].includes(String(l.status)));
        const todos = lease ? offboardingTodos(lease) : [];
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => setEnding(null)}>
            <div className="w-full max-w-md rounded-2xl bg-card p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <p className="text-[11px] font-black uppercase tracking-widest">End lease</p>
              <p className="text-sm font-bold">
                This ends <strong>{ending.firstName} {ending.lastName}</strong>&apos;s lease immediately and frees the booth. It can&apos;t be undone.
              </p>
              {others.length > 0 ? (
                <p className="text-xs font-bold">They still rent {others.length === 1 ? 'another space' : `${others.length} other spaces`}, so they stay an active renter and keep taking bookings.</p>
              ) : (
                <div className="rounded-xl border-2 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest">Also happens</p>
                  <p className="text-xs font-bold">They&apos;re marked Past and stop being bookable, so clients can&apos;t book someone who has left. Re-leasing them later turns it all back on.</p>
                </div>
              )}
              {todos.length > 0 && (
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">Still yours to settle</p>
                  {todos.map((t) => <p key={t} className="text-xs font-bold text-amber-900">{t}</p>)}
                  <p className="text-[10px] font-bold text-amber-700">Not done automatically — money doesn&apos;t move on a status change.</p>
                </div>
              )}
              {lease && (
                <PrintLink path="/api/booths/account-statement" params={{ tenantId: tenantId || '', renterId: ending.id, mode: 'final' }}
                  className="flex items-center justify-between rounded-xl border-2 px-3 py-2.5 text-[11px] font-black uppercase tracking-widest text-foreground/80">
                  <span>Print move-out statement</span><span className="text-muted-foreground">↗</span>
                </PrintLink>
              )}
              <div className="flex gap-2 pt-1">
                <button disabled={busy || !lease} onClick={async () => {
                  if (!firestore || !tenantId || !lease) return;
                  setBusy(true);
                  try {
                    await endLease(firestore, tenantId, lease, ending.id, leases);
                    toast({ title: 'Lease ended', description: `${ending.firstName} ${ending.lastName}` });
                    setEnding(null);
                  } catch { toast({ title: 'Could not end lease', description: 'Try again.' }); }
                  setBusy(false);
                }} className="flex-1 rounded-2xl bg-rose-600 py-3 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                  {busy ? 'Ending…' : lease ? 'End lease' : 'No active lease'}
                </button>
                <button onClick={() => setEnding(null)} className="rounded-2xl bg-muted px-5 py-3 text-[11px] font-black uppercase tracking-widest text-foreground/80">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}
