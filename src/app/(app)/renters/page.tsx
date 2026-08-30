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
import { collection, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useLocation } from '@/context/LocationContext';
import { cn } from '@/lib/utils';
import {
  Users, AlertTriangle, CheckCircle2, Loader, Phone, Mail,
  ArrowRight, Armchair, Moon, ExternalLink,
} from 'lucide-react';
import { RenterProfileDrawer } from '@/components/renters/RenterProfileDrawer';

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
function bookableThroughStudio(staffDoc: any): { ok: boolean; why: string } {
  if (!staffDoc) return { ok: false, why: 'No provider record yet' };
  if (staffDoc.bookingOptOut === true) return { ok: false, why: 'Booking switched off' };
  const week = staffDoc.availability?.week || staffDoc.week || {};
  const hasHours = Object.keys(week).some(
    (k: string) => week[k]?.enabled && week[k]?.start && week[k]?.end
  );
  if (!hasHours) return { ok: false, why: 'No hours set — nobody can book them' };
  return { ok: true, why: '' };
}

const OCCUPYING = ['active', 'on_leave', 'pending_signature'];

export default function RentersPage() {
  const { firestore, user } = useFirebase() as any;
  const { selectedLocationId } = useLocation();
  const tenantId = user?.tenantId || (user as any)?.uid || null;

  const [renters, setRenters] = useState<R[]>([]);
  const [leases, setLeases] = useState<R[]>([]);
  const [staff, setStaff] = useState<R[]>([]);
  const [booths, setBooths] = useState<R[]>([]);
  const [reservations, setReservations] = useState<R[]>([]);
  const [amenityRequests, setAmenityRequests] = useState<R[]>([]);
  const [profileRenter, setProfileRenter] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'setup' | 'leave' | 'past'>('active');

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const sub = (name: string, set: any, done?: boolean) =>
      onSnapshot(collection(firestore, 'tenants', tenantId, name),
        (s) => { set(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))); if (done) setLoading(false); },
        () => { if (done) setLoading(false); });
    const unsubs = [sub('renters', setRenters, true), sub('leases', setLeases),
      sub('staff', setStaff), sub('booths', setBooths),
      sub('boothReservations', setReservations), sub('amenityRequests', setAmenityRequests)];
    return () => unsubs.forEach((u) => u());
  }, [firestore, tenantId]);

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
        const book = ownMode ? { ok: true, why: '' } : bookableThroughStudio(staffByRenter.get(r.id));
        const needsSetup = ['active', 'on_leave'].includes(String(r.status))
          && myLeases.length > 0 && !ownMode && !book.ok;
        const noPortal = r.portalInviteStatus !== 'accepted';
        return { r, myLeases, unsigned, spaces, rent, freq, ownMode, book, needsSetup, noPortal };
      });
  }, [renters, leases, staff, booths, selectedLocationId]);

  const stats = useMemo(() => ({
    active: rows.filter((x) => x.r.status === 'active').length,
    setup: rows.filter((x) => x.needsSetup).length,
    leave: rows.filter((x) => x.r.status === 'on_leave').length,
    past: rows.filter((x) => x.r.status === 'past').length,
  }), [rows]);

  const visible = useMemo(() => {
    let list = rows;
    if (filter === 'active') list = rows.filter((x) => ['active', 'on_leave'].includes(String(x.r.status)));
    if (filter === 'setup') list = rows.filter((x) => x.needsSetup);
    if (filter === 'leave') list = rows.filter((x) => x.r.status === 'on_leave');
    if (filter === 'past') list = rows.filter((x) => x.r.status === 'past');
    // Attention first: unfinished setup outranks everything, an unsigned lease
    // outranks a healthy one, then names — because a sorted-by-name list is
    // only useful once nothing on it is on fire.
    return list.slice().sort((a, b) =>
      Number(b.needsSetup) - Number(a.needsSetup)
      || Number(b.unsigned) - Number(a.unsigned)
      || `${a.r.firstName} ${a.r.lastName}`.localeCompare(`${b.r.firstName} ${b.r.lastName}`));
  }, [rows, filter]);

  const Stat = ({ icon: Icon, label, value, tone }: any) => (
    <div className={cn('rounded-2xl border-2 p-4', tone)}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-2xl font-black mt-1 leading-none">{value}</p>
    </div>
  );

  const FILTERS: [typeof filter, string][] = [
    ['active', 'Renting now'], ['setup', 'Needs setup'], ['leave', 'On leave'], ['past', 'Past'],
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1000px] mx-auto w-full">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight">
          <Users className="h-5 w-5 text-primary shrink-0" /> Renters
        </h1>
        <p className="text-xs font-bold text-muted-foreground">
          Everyone renting from you — with the ones losing bookable days sorted to the top.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Users} label="Renting now" value={stats.active} tone="border-slate-200" />
        <Stat icon={AlertTriangle} label="Needs setup" value={stats.setup}
          tone={stats.setup > 0 ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-slate-200'} />
        <Stat icon={Moon} label="On leave" value={stats.leave} tone="border-slate-200" />
        <Stat icon={CheckCircle2} label="Past" value={stats.past} tone="border-slate-200" />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={cn('px-3.5 py-2 rounded-xl text-[11px] font-black border-2 transition-all',
              filter === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200')}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader className="h-4 w-4 animate-spin" />
          <span className="text-[11px] font-black uppercase tracking-widest">Loading renters…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-8 text-center">
          <p className="text-sm font-black">
            {filter === 'setup' ? 'Everyone is fully set up.' : 'Nobody here.'}
          </p>
          <p className="text-xs font-bold text-muted-foreground mt-1">
            {filter === 'setup'
              ? 'Every leased renter can be booked — or runs their own system on purpose.'
              : 'Renters appear here when a lead converts or you add one in the Booth Hub.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(({ r, unsigned, spaces, rent, freq, ownMode, book, needsSetup, noPortal }) => (
            <div key={r.id} className={cn('rounded-2xl border-2 p-4 space-y-3',
              needsSetup ? 'border-rose-300 bg-rose-50' : unsigned ? 'border-amber-300 bg-amber-50' : 'border-slate-200')}>
              <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setProfileRenter(r)}>
                <div className="min-w-0">
                  <p className="font-black text-sm truncate">{r.firstName} {r.lastName}</p>
                  <p className="text-[11px] font-bold text-muted-foreground mt-0.5 truncate">
                    {r.specialty || 'Renter'}
                    {spaces.length > 0 ? <> · <Armchair className="inline h-3 w-3 -mt-0.5" /> {spaces.join(', ')}</> : ' · no space assigned'}
                    {rent > 0 ? ` · ${money(rent)}/${FREQ_LABEL[freq] || freq}` : ''}
                  </p>
                </div>
                <span className="flex flex-wrap justify-end gap-1 shrink-0">
                  {needsSetup && (
                    <span className="rounded-full bg-rose-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-rose-900">
                      {book.why}
                    </span>
                  )}
                  {!needsSetup && ownMode && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600">
                      Own booking system
                    </span>
                  )}
                  {unsigned && (
                    <span className="rounded-full bg-amber-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-amber-900">
                      Lease unsigned
                    </span>
                  )}
                  {noPortal && r.status !== 'past' && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
                      No portal yet
                    </span>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {r.phone && (
                  <a href={`tel:${r.phone}`} className="flex items-center gap-1.5 rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black">
                    <Phone className="h-3 w-3" /> Call
                  </a>
                )}
                {r.email && (
                  <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black">
                    <Mail className="h-3 w-3" /> Email
                  </a>
                )}
                {ownMode && r.externalBookingUrl && (
                  <a href={r.externalBookingUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black">
                    <ExternalLink className="h-3 w-3" /> Their booking page
                  </a>
                )}
                <a href="/booths?tab=ops#ops-people"
                  className="ml-auto flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Full card <ArrowRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] font-bold text-muted-foreground">
        Tap anyone for their full card — leases, money, documents and activity, right here.
        Editing details, new leases and offboarding still start in the Booth Hub.
      </p>

      {profileRenter && (() => {
        const myLease = leases.find((l) => l.renterId === profileRenter.id
          && ['active', 'on_leave', 'pending_signature'].includes(String(l.status)));
        const booth = myLease ? booths.find((b) => b.id === myLease.boothId) : undefined;
        const toHub = () => { window.location.href = '/booths?tab=ops#ops-people'; };
        return (
          <RenterProfileDrawer
            renter={profileRenter}
            lease={myLease}
            booth={booth}
            reservations={reservations}
            amenityRequests={amenityRequests}
            w9={undefined}
            tenantId={tenantId}
            firestore={firestore}
            onClose={() => setProfileRenter(null)}
            onEdit={toHub}
            onLease={toHub}
            onEndLease={toHub}
          />
        );
      })()}
    </div>
  );
}
