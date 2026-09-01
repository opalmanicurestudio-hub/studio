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
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { createRenter } from '@/lib/booth-rental-service';
import { linkContactRenter } from '@/lib/booth-contacts';
import { nanoid } from 'nanoid';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Users, CalendarClock, AlertTriangle, CheckCircle2, Loader,
  Phone, Mail, Flame,
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

const whenTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'that time';
    const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${day} ${time}`;
  } catch { return 'that time'; }
};

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

  // ── TOUR INVITES ──────────────────────────────────────────────────────────
  // The rental twin of the hiring funnel's interview invites: offer a prospect
  // two or three times, let them pick or counter, then put the answer through
  // the real tour scheduler. Same collection shape, same trust model, same
  // capability-URL pattern as tenants/{t}/interviewInvites.
  const [invites, setInvites] = useState<any[]>([]);
  const [offerFor, setOfferFor] = useState<string>('');
  const [offerSlots, setOfferSlots] = useState<string[]>(['', '', '']);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'tourInvites'),
      (s) => setInvites(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => {});
    return () => unsub();
  }, [firestore, tenantId]);

  // Newest invite per lead — an older, superseded offer must never outrank the
  // one the prospect is actually looking at.
  const inviteByApp = useMemo(() => {
    const m = new Map<string, any>();
    for (const inv of invites) {
      if (!inv.applicationId) continue;
      const prev = m.get(inv.applicationId);
      if (!prev || String(inv.createdAt || '') > String(prev.createdAt || '')) m.set(inv.applicationId, inv);
    }
    return m;
  }, [invites]);

  const sendTourTimes = async (r: Row) => {
    if (!firestore || !tenantId) return;
    const slots = offerSlots
      .map((x) => x.trim()).filter(Boolean)
      .map((x) => { const d = new Date(x); return isNaN(d.getTime()) ? '' : d.toISOString(); })
      .filter(Boolean);
    if (slots.length === 0) {
      toast({ title: 'Pick at least one time', description: 'Offer up to three and let them choose.' });
      return;
    }
    setBusy(r.id);
    try {
      const token = nanoid();
      await setDoc(doc(firestore, 'tenants', tenantId, 'tourInvites', token), {
        id: token,
        applicationId: r.id,
        firstName: String(r.name || 'there').split(' ')[0],
        spaceName: r.boothName || '',
        slots: slots.slice(0, 3),
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/tour-invite/${tenantId}/${token}`;
      try { await navigator.clipboard.writeText(link); } catch { window.prompt('Copy this link:', link); }
      setOfferFor(''); setOfferSlots(['', '', '']);
      toast({ title: 'Link copied', description: `Send it to ${r.name} — they pick a time or send you theirs.` });
    } catch {
      toast({ title: 'Could not create the invite', description: 'Try again in a moment.' });
    }
    setBusy('');
  };

  // Confirming goes through /api/booths/kiosk tour-book — the same scheduler
  // the public tour page uses — so a tour booked from here is clash-checked
  // and lands in /tours like every other one. An invite answer is never a
  // booking on its own.
  const confirmTour = async (r: Row, inv: any, iso: string) => {
    if (!firestore || !tenantId || !iso) return;
    setBusy(r.id);
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'tour-book', tenantId,
          date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
          time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
          name: r.name, phone: r.phone, email: r.email,
          message: r.boothName ? `Interested in ${r.boothName}` : '',
        }),
      });
      const out = await res.json();
      if (!out.ok) {
        toast({ title: res.status === 409 ? 'That time just went' : 'Could not book it',
          description: out.error || 'Offer another time.' });
        setBusy(''); return;
      }
      await updateDoc(doc(firestore, 'tenants', tenantId, 'tourInvites', inv.id), {
        status: 'scheduled', chosenSlot: iso, scheduledAt: new Date().toISOString(),
      });
      toast({ title: 'Tour booked', description: `${r.name} — it is on the tour schedule now.` });
    } catch {
      toast({ title: 'Could not book it', description: 'Try again in a moment.' });
    }
    setBusy('');
  };

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
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Pipeline" />
      <div className="flex-1 w-full max-w-[1000px] mx-auto min-w-0 p-4 sm:p-6 md:p-8 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground opacity-60">
            Booth rental
          </p>
          <h1 className="flex items-center gap-2.5 text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none">
            <span className="grid h-9 w-9 place-items-center rounded-2xl border-2 border-primary/15 bg-primary/5 shrink-0">
              <Users className="h-4 w-4 text-primary" />
            </span>
            Pipeline
          </h1>
          <p className="text-xs font-bold text-muted-foreground max-w-prose">
            Everyone between first enquiry and a signed lease, ordered by who has been waiting longest.
          </p>
        </div>
        <div className="shrink-0"><LocationSwitcher /></div>
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
                    {(() => {
                      const inv = inviteByApp.get(r.id);
                      if (inv && inv.status === 'pending') {
                        return (
                          <span className="rounded-xl border-2 border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-sky-700">
                            Times sent · waiting
                          </span>
                        );
                      }
                      if (inv && inv.status === 'accepted' && inv.chosenSlot) {
                        return (
                          <button onClick={() => confirmTour(r, inv, inv.chosenSlot)} disabled={!!busy}
                            className="rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                            {busy === r.id ? '…' : `Confirm ${whenTime(inv.chosenSlot)}`}
                          </button>
                        );
                      }
                      if (inv && inv.status === 'scheduled') {
                        return (
                          <span className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-emerald-700">
                            Tour booked
                          </span>
                        );
                      }
                      return (
                        <button onClick={() => { setOfferFor(offerFor === r.id ? '' : r.id); setOfferSlots(['', '', '']); }} disabled={!!busy}
                          className="rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-50">
                          Tour times
                        </button>
                      );
                    })()}
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
              </div>

              {(() => {
                const inv = inviteByApp.get(r.id);
                if (!inv || inv.status !== 'countered') return null;
                const theirs: string[] = Array.isArray(inv.proposedSlots) ? inv.proposedSlots : [];
                return (
                  <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-3 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                      None of those worked — they are free at
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {theirs.map((iso) => (
                        <button key={iso} onClick={() => confirmTour(r, inv, iso)} disabled={!!busy}
                          className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black text-white disabled:opacity-50">
                          {whenTime(iso)}
                        </button>
                      ))}
                      {theirs.length === 0 && <p className="text-[11px] font-bold text-amber-800">They did not give times — call them.</p>}
                    </div>
                    {inv.prospectNote && <p className="text-[11px] font-bold text-amber-900">“{inv.prospectNote}”</p>}
                    <button onClick={() => { setOfferFor(r.id); setOfferSlots(['', '', '']); }}
                      className="text-[10px] font-black uppercase tracking-widest text-amber-700 underline">
                      Offer different times instead
                    </button>
                  </div>
                );
              })()}

              {offerFor === r.id && (
                <div className="rounded-2xl border-2 bg-white p-3 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Offer up to three times
                  </p>
                  {offerSlots.map((val, i) => (
                    <input key={i} type="datetime-local" value={val}
                      aria-label={`Tour time option ${i + 1}`}
                      onChange={(e) => setOfferSlots((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                      className="w-full h-11 px-3 rounded-xl border-2 text-sm font-bold" />
                  ))}
                  <div className="flex gap-2">
                    <button onClick={() => sendTourTimes(r)} disabled={!!busy}
                      className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                      {busy === r.id ? '…' : 'Create link'}
                    </button>
                    <button onClick={() => setOfferFor('')}
                      className="h-11 px-4 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest text-slate-600">
                      Cancel
                    </button>
                  </div>
                  <p className="text-[10px] font-bold text-muted-foreground">
                    The link is copied for you to send. They pick one or send back times that work.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] font-bold text-muted-foreground">
        Convert makes someone a renter right here; giving them a lease happens in the Booth Hub, where the booths are.
      </p>
      </div>
    </div>
  );
}
