"use client";

// ─── PIPELINE ────────────────────────────────────────────────────────────────
// Every prospect, from first enquiry to signed lease, on one screen.
//
// This used to be a zone inside the booth hub, sharing a chip row with rentals,
// maintenance and the people directory. That put a WEEKLY job — chasing leads —
// next to a DAILY one, and the weekly job always lost.
//
// The organising idea here is not stage, it is ATTENTION. A pipeline sorted by
// stage looks tidy and tells you nothing: the lead about to go cold sits
// politely in its column while you read the ones that are fine. So the default
// view is "needs you", ordered by how long somebody has been waiting, and the
// stage is a filter rather than the structure.
//
// Nothing here duplicates the hub's tour scorecard or application detail. This
// answers one question — who is waiting on me — and hands off for the rest.

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { createRenter } from '@/lib/booth-rental-service';
import { linkContactRenter } from '@/lib/booth-contacts';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Users, CalendarClock, AlertTriangle, CheckCircle2, Loader,
  Phone, Mail, ArrowRight, Flame,
} from 'lucide-react';

type Row = {
  id: string; name: string; phone: string; email: string;
  kind: 'tour' | 'application' | 'question' | 'waitlist';
  status: string; createdAt: string;
  tourStartIso: string | null; tourDate: string | null;
  outcome: any; followUpNeeded: boolean;
  rentalType: string | null; message: string;
  specialty: string | null; boothName: string | null; locationId: string | null;
};

const OPEN_STATUSES = ['new', 'in_review'];

const daysSince = (iso: string) => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};
const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
};

/**
 * Why this row is on screen, and how loudly.
 *
 * Ranked so the most perishable thing wins: a tour that already happened and
 * was never written up is the most expensive lead in the business going cold,
 * and it outranks a fresh enquiry that can still be answered today.
 */
function urgencyOf(r: Row, todayIso: string): { rank: number; label: string; tone: string } | null {
  if (!OPEN_STATUSES.includes(r.status)) return null;
  const tourDay = (r.tourStartIso || r.tourDate || '').slice(0, 10);

  if (r.kind === 'tour' && tourDay && tourDay < todayIso && !r.outcome) {
    return { rank: 0, label: 'Toured — outcome never recorded', tone: 'rose' };
  }
  if (r.kind === 'tour' && r.outcome && daysSince(r.createdAt) >= 7) {
    return { rank: 1, label: 'Toured, went quiet', tone: 'amber' };
  }
  if (r.kind === 'application' && daysSince(r.createdAt) >= 3) {
    return { rank: 1, label: `Waiting ${daysSince(r.createdAt)} days`, tone: 'amber' };
  }
  if (r.kind === 'tour' && tourDay && tourDay >= todayIso) {
    return { rank: 3, label: `Tour ${when(tourDay)}`, tone: 'slate' };
  }
  return { rank: 2, label: r.kind === 'application' ? 'New application' : 'New enquiry', tone: 'slate' };
}

export default function PipelinePage() {
  const { firestore } = useFirebase() as any;
  const { selectedLocationId } = useLocation();
  const { toast } = useToast();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const [apps, setApps] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'attention' | 'tours' | 'open' | 'done'>('attention');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'boothApplications'),
      (s) => {
        setApps(s.docs.map((d) => {
          const a: any = d.data() || {};
          return {
            id: d.id,
            name: a.name || 'Someone',
            phone: a.phone || '', email: a.email || '',
            kind: (a.kind || 'application') as Row['kind'],
            status: String(a.status || 'new'),
            createdAt: a.createdAt || '',
            tourStartIso: a.tourStartIso || null,
            tourDate: a.tourDate || null,
            outcome: a.tourOutcome || null,
            followUpNeeded: a.followUpNeeded === true,
            rentalType: a.rentalType || null,
            message: a.message || '',
            specialty: a.specialty || null,
            boothName: a.boothName || null,
            locationId: a.locationId || null,
            _locationId: a.locationId || null,
          } as any;
        }));
        setLoading(false);
      }, () => setLoading(false));
    return () => unsub();
  }, [firestore, tenantId]);

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const scoped = useMemo(() => apps.filter((a: any) =>
    !a._locationId || !selectedLocationId || a._locationId === selectedLocationId), [apps, selectedLocationId]);

  const withUrgency = useMemo(() => scoped
    .map((r) => ({ r, u: urgencyOf(r, todayIso) }))
    .filter((x) => x.u !== null) as { r: Row; u: NonNullable<ReturnType<typeof urgencyOf>> }[],
    [scoped, todayIso]);

  const stats = useMemo(() => ({
    attention: withUrgency.filter((x) => x.u.rank <= 1).length,
    upcoming: withUrgency.filter((x) => x.u.rank === 3).length,
    open: withUrgency.length,
    converted: scoped.filter((r) => r.status === 'converted').length,
  }), [withUrgency, scoped]);

  const visible = useMemo(() => {
    let list = withUrgency;
    if (filter === 'attention') list = list.filter((x) => x.u.rank <= 1);
    if (filter === 'tours') list = list.filter((x) => x.r.kind === 'tour');
    if (filter === 'done') {
      return scoped.filter((r) => !OPEN_STATUSES.includes(r.status))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 40)
        .map((r) => ({ r, u: { rank: 9, label: r.status.replace(/_/g, ' '), tone: 'slate' } }));
    }
    return list.slice().sort((a, b) =>
      a.u.rank - b.u.rank || String(a.r.createdAt).localeCompare(String(b.r.createdAt)));
  }, [withUrgency, filter, scoped]);

  // ── Convert: the moment a lead becomes a renter ───────────────────────────
  // Deliberately the SAME semantics as the hub's convert (renter created with
  // the application's context, the People-directory contact linked, the
  // application stamped converted) — copied, not reinvented, so a lead
  // converted here and one converted in the hub produce identical records.
  // What stays in the hub: giving the new renter a lease. That is a booth
  // decision, and this page doesn't know booths.
  const convert = async (r: Row) => {
    if (!firestore || !tenantId) return;
    if (!r.name.trim() && !r.phone && !r.email) {
      toast({ title: 'Not enough detail', description: 'A renter needs at least a name, phone, or email.' });
      return;
    }
    setBusy(r.id);
    try {
      const parts = r.name.trim().split(' ');
      const res: any = await createRenter(firestore, {
        tenantId,
        locationId: r.locationId || selectedLocationId,
        firstName: parts[0] || 'New',
        lastName: parts.slice(1).join(' ') || 'Renter',
        email: r.email || '',
        phone: r.phone || undefined,
        specialty: r.specialty || undefined,
        notes: `Converted from ${r.kind === 'tour' ? 'a tour' : 'an application'}${r.boothName ? ` for ${r.boothName}` : ''} (via Pipeline)`,
        sourceApplicationId: r.id,
        appliedAt: r.createdAt || null,
      } as any);
      const rid: string | null = res?.id || res?.renterId || (typeof res === 'string' ? res : null);
      if (rid) {
        await linkContactRenter(firestore, tenantId, { name: r.name, phone: r.phone, email: r.email }, rid)
          .catch(() => {});
      }
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', r.id), {
        status: 'converted', convertedAt: new Date().toISOString(),
        followUpNeeded: false,
        ...(rid ? { convertedRenterId: rid } : {}),
      });
      toast({ title: 'Now a renter', description: `${r.name} — give them a lease from the Booth Hub when ready.` });
    } catch {
      toast({ title: 'Convert failed', description: 'Try again in a moment.' });
    }
    setBusy('');
  };

  const setStatus = async (r: Row, status: string, note: string) => {
    if (!firestore || !tenantId) return;
    setBusy(r.id);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', r.id), {
        status,
        followUpNeeded: false,
        [`${status}At`]: new Date().toISOString(),
      });
      toast({ title: note, description: r.name });
    } catch {
      toast({ title: 'That did not save', description: 'Try again in a moment.' });
    }
    setBusy('');
  };

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
    ['attention', 'Needs you'],
    ['tours', 'Tours'],
    ['open', 'All open'],
    ['done', 'Closed'],
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1000px] mx-auto w-full">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight">
          <Users className="h-5 w-5 text-primary shrink-0" /> Pipeline
        </h1>
        <p className="text-xs font-bold text-muted-foreground">
          Everyone between first enquiry and a signed lease, ordered by who has been waiting longest.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={AlertTriangle} label="Needs you" value={stats.attention}
          tone={stats.attention > 0 ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-slate-200'} />
        <Stat icon={CalendarClock} label="Tours ahead" value={stats.upcoming} tone="border-slate-200" />
        <Stat icon={Users} label="Open leads" value={stats.open} tone="border-slate-200" />
        <Stat icon={CheckCircle2} label="Converted" value={stats.converted} tone="border-slate-200" />
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
          <span className="text-[11px] font-black uppercase tracking-widest">Loading the pipeline…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-8 text-center">
          <p className="text-sm font-black">
            {filter === 'attention' ? 'Nobody is waiting on you.' : 'Nothing here.'}
          </p>
          <p className="text-xs font-bold text-muted-foreground mt-1">
            {filter === 'attention'
              ? 'Every open lead has been answered and every tour written up.'
              : 'Leads arrive from the public listings, the tour page and the booking kiosk.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(({ r, u }) => (
            <div key={r.id} className={cn('rounded-2xl border-2 p-4 space-y-3',
              u.tone === 'rose' ? 'border-rose-300 bg-rose-50'
                : u.tone === 'amber' ? 'border-amber-300 bg-amber-50' : 'border-slate-200')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-sm truncate">{r.name}</p>
                  <p className="text-[11px] font-bold text-muted-foreground mt-0.5">
                    {r.kind === 'tour' ? 'Tour' : r.kind === 'application' ? 'Application' : r.kind}
                    {r.rentalType ? ` · ${r.rentalType === 'lease' ? 'long-term' : 'day rental'}` : ''}
                    {r.createdAt ? ` · came in ${when(r.createdAt)}` : ''}
                  </p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest',
                  u.tone === 'rose' ? 'bg-rose-200 text-rose-900'
                    : u.tone === 'amber' ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-600')}>
                  {u.label}
                </span>
              </div>

              {r.outcome?.interest && (
                <p className="flex items-center gap-1.5 text-[11px] font-bold">
                  <Flame className="h-3.5 w-3.5 shrink-0" /> Interest: {r.outcome.interest}
                </p>
              )}
              {r.message && <p className="text-[11px] font-bold text-muted-foreground line-clamp-2">{r.message}</p>}

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
                {OPEN_STATUSES.includes(r.status) && (
                  <>
                    {r.status === 'new' && (
                      <button onClick={() => setStatus(r, 'in_review', 'Marked contacted')} disabled={!!busy}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                        {busy === r.id ? '…' : 'Contacted'}
                      </button>
                    )}
                    <button onClick={() => setStatus(r, 'closed', 'Closed out')} disabled={!!busy}
                      className="rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-50">
                      Close
                    </button>
                    {r.kind === 'tour' && (
                      <button onClick={() => setStatus(r, 'no_show', 'Marked no-show')} disabled={!!busy}
                        className="rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-50">
                        No-show
                      </button>
                    )}
                    <button onClick={() => convert(r)} disabled={!!busy}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                      {busy === r.id ? '…' : 'Convert'}
                    </button>
                  </>
                )}
                <a href="/booths?tab=ops#ops-apps"
                  className="ml-auto flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Full detail <ArrowRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] font-bold text-muted-foreground">
        Convert makes someone a renter right here; giving them a lease happens in the Booth Hub, where the booths are.
      </p>
    </div>
  );
}
