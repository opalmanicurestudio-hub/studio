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
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { createRenter } from '@/lib/booth-rental-service';
import { linkContactRenter } from '@/lib/booth-contacts';
import { buildGuestBook, guestMatches, STAGE_LABEL, type GuestBookEntry } from '@/lib/guest-book';
import { CommsTrail } from '@/components/shared/CommsTrail';
import { TourManagerDialog } from '@/components/booths/TourManagerDialog';
import { resolveActiveStaffId } from '@/lib/staff-identity';
import { nanoid } from 'nanoid';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Users, CalendarClock, AlertTriangle, CheckCircle2, Loader,
  Phone, Mail, Flame, Search, Star, ChevronDown, ClipboardCheck, History as HistoryIcon,
} from 'lucide-react';

type Row = {
  id: string; name: string; phone: string; email: string;
  kind: 'tour' | 'application' | 'question' | 'waitlist';
  status: string; createdAt: string;
  tourStartIso: string | null; tourDate: string | null; tourId: string | null;
  outcome: any; followUpNeeded: boolean;
  decidedAt: string | null; convertedAt: string | null;
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

type HistoryLine = { at: string; text: string; tone?: 'good' | 'bad' };

function historyFor(r: Row, tour: any, invites: any[]): HistoryLine[] {
  const out: HistoryLine[] = [];
  const push = (at: any, text: string, tone?: 'good' | 'bad') => {
    if (at) out.push({ at: String(at), text, tone });
  };

  push(r.createdAt, r.kind === 'tour' ? 'Asked to visit' : r.kind === 'application' ? 'Applied' : 'Got in touch');

  if (tour) {
    const slot = tour.date && tour.time ? whenTime(`${tour.date}T${tour.time}:00`) : '';
    push(tour.createdAt, tour.status === 'requested' && !tour.decidedAt
      ? `Requested ${slot}`
      : `Booked ${slot}`);
    if (tour.hostAssignedAt) {
      push(tour.hostAssignedAt,
        `${tour.hostName || 'Someone'} assigned to host${tour.hostAssignedBy ? ` by ${tour.hostAssignedBy}` : ''}`);
    }
    if (tour.checkedInAt) push(tour.checkedInAt, 'They arrived — checked in', 'good');
    if (tour.decidedAt) {
      push(tour.decidedAt,
        tour.status === 'confirmed' ? `Confirmed ${slot}`
          : tour.status === 'declined' ? `You declined ${slot}`
          : `Decision recorded`,
        tour.status === 'declined' ? 'bad' : 'good');
    }
    if (tour.cancelledAt) push(tour.cancelledAt, `Tour cancelled${slot ? ` (was ${slot})` : ''}`, 'bad');
    if (tour.rescheduledAt) push(tour.rescheduledAt, `Moved to ${slot}`, 'good');
  }

  for (const inv of invites) {
    const offered = Array.isArray(inv.slots) ? inv.slots.length : 0;
    push(inv.createdAt, `Offered ${offered} time${offered === 1 ? '' : 's'}`);
    if (inv.sentAt) push(inv.sentAt, inv.sendStatus === 'sent' ? 'Times emailed' : `Times not emailed (${inv.sendStatus || 'unknown'})`,
      inv.sendStatus === 'sent' ? undefined : 'bad');
    if (inv.respondedAt) {
      push(inv.respondedAt,
        inv.status === 'accepted' ? `They picked ${whenTime(inv.chosenSlot || '')}`
          : inv.status === 'countered' ? 'They sent times of their own'
          : 'They asked for different times',
        inv.status === 'accepted' ? 'good' : undefined);
    }
    if (inv.scheduledAt) push(inv.scheduledAt, 'You booked their pick', 'good');
  }

  if (r.outcome) {
    push(r.outcome.at || r.decidedAt || r.createdAt,
      `Outcome recorded: ${r.outcome.interest || (r.outcome.showed === false ? 'no-show' : 'noted')}${r.outcome.by ? ` by ${r.outcome.by}` : ''}`);
  }
  if (r.convertedAt) push(r.convertedAt, 'Became a renter', 'good');
  if (r.status === 'declined' && r.decidedAt) push(r.decidedAt, 'Lead declined', 'bad');

  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** The label a destructive button shows once it has been tapped once. */
const armedLabel = (isArmed: boolean, idle: string, sure: string) => (isArmed ? sure : idle);

const whenTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'that time';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    const day = d.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${day} · ${time}`;
  } catch { return 'that time'; }
};

export default function PipelinePage() {
  const { firestore, user } = useFirebase() as any;
  const { selectedLocationId } = useLocation();
  const { toast } = useToast();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const [apps, setApps] = useState<Row[]>([]);
  const [appDocs, setAppDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'attention' | 'tours' | 'open' | 'done' | 'people'>('attention');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'boothApplications'),
      (s) => {
        setAppDocs(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
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
            tourId: a.tourId || null,
            tourDate: a.tourDate || null,
            outcome: a.tourOutcome || null,
            decidedAt: a.decidedAt || null,
            convertedAt: a.convertedAt || null,
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
  // With auto-confirm off, a tour arrives as 'requested' and sits there. The
  // application row shows the enquiry; the TOUR doc holds the state that
  // decides whether anyone is actually expected. Read it so the row can ask
  // for the decision instead of the owner having to notice.
  const [tours, setTours] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [offerFor, setOfferFor] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState<string>('');
  // The tour manager — check-in, no-show, notes, printed prep sheet and the
  // outcome that decides whether this lead is hot. It already existed, mounted
  // only in the booth hub, which is not where anyone follows a lead any more.
  const [managingTour, setManagingTour] = useState<any>(null);

  // Which destructive button is currently asking "are you sure?" — keyed by
  // lead id + action so only ONE can be armed at a time. Arms for 5 seconds.
  const [armed, setArmed] = useState<string>('');
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(''), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  const arm = (key: string, run: () => void) => {
    if (armed === key) { setArmed(''); run(); }
    else setArmed(key);
  };
  const [tasks, setTasks] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [offerSlots, setOfferSlots] = useState<string[]>(['', '', '']);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsubStaff = onSnapshot(collection(firestore, 'tenants', tenantId, 'staff'),
      (s) => setStaff(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => setStaff([]));
    const unsubTasks = onSnapshot(collection(firestore, 'tenants', tenantId, 'tasks'),
      (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => setTasks([]));
    const unsubTours = onSnapshot(collection(firestore, 'tenants', tenantId, 'tours'),
      (s) => setTours(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => {});
    const unsub = onSnapshot(collection(firestore, 'tenants', tenantId, 'tourInvites'),
      (s) => setInvites(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => {});
    return () => { unsub(); unsubTours(); unsubTasks(); unsubStaff(); };
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

  // Open follow-ups, keyed by the lead they belong to.
  const followUpsByLead = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const t of tasks) {
      if (t.done || !t.relatedTourId) continue;
      const list = m.get(t.relatedTourId) || [];
      list.push(t);
      m.set(t.relatedTourId, list);
    }
    return m;
  }, [tasks]);

  const completeTask = async (taskId: string) => {
    if (!firestore || !tenantId) return;
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'tasks', taskId), {
        done: true, doneAt: new Date().toISOString(),
      });
    } catch {
      toast({ title: 'Could not tick that off', description: 'Try again in a moment.' });
    }
  };

  // Anyone still with the business can host a visit.
  const hosts = useMemo(() => staff
    .filter((m: any) => m.status !== 'terminated' && m.archived !== true)
    .map((m: any) => ({
      id: m.id,
      name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || m.displayName || 'Team member',
    }))
    .sort((a, b) => a.name.localeCompare(b.name)), [staff]);

  // WHO is doing this. The team shares one studio login and identifies
  // individually by PIN, so the signed-in uid is the fallback, not the answer:
  // resolveActiveStaffId prefers the PIN identity held for this tab. Falls
  // back to the business name only when nobody can be resolved, which on a
  // solo shop is still true rather than merely convenient.
  const actorName = useMemo(() => {
    const staffId = resolveActiveStaffId(user?.uid || null);
    const me = staffId ? staff.find((m: any) => m.id === staffId) : null;
    const named = me
      ? `${me.firstName || ''} ${me.lastName || ''}`.trim() || me.name || me.displayName
      : '';
    return named || user?.displayName || (selectedTenant as any)?.name || null;
  }, [staff, user, selectedTenant]);

  const tourById = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of tours) m.set(t.id, t);
    return m;
  }, [tours]);

  // Approve or decline in one tap. The tour doc is the record the calendar and
  // the slot checker read, so it moves first; the lead row follows it; the
  // prospect is told last but always — a decision nobody hears about is the
  // same as no decision.
  const decideTour = async (r: Row, tourId: string, decision: 'approve' | 'decline') => {
    if (!firestore || !tenantId) return;
    // A request whose time has already passed cannot be approved into the
    // past — it can only be declined, which sends them the rebook link.
    if (decision === 'approve') {
      const t = tourById.get(tourId);
      const start = t?.date && t?.time ? new Date(`${t.date}T${t.time}:00`) : null;
      if (start && !isNaN(start.getTime()) && start.getTime() < Date.now()) {
        toast({ title: 'That time has already passed', description: 'Decline it — they get a link to pick a fresh time.' });
        return;
      }
    }
    setBusy(r.id);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'tours', tourId), {
        status: decision === 'approve' ? 'confirmed' : 'declined',
        decidedAt: new Date().toISOString(),
      });
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', r.id), {
        status: decision === 'approve' ? 'approved' : 'declined',
        decidedAt: new Date().toISOString(),
      });
      let mail: any = null;
      try {
        const res = await fetch('/api/booths/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tour-decision', tenantId, tourId, decision }),
        });
        mail = await res.json();
      } catch { /* reported below */ }
      toast({
        title: decision === 'approve' ? 'Tour confirmed' : 'Tour declined',
        description: mail?.ok
          ? `${r.name} has been emailed.`
          : `Saved${mail?.status === 'skipped_no_email' ? ' — no email on file, so tell them yourself.' : ' — the email did not go out.'}`,
      });
    } catch {
      toast({ title: 'Could not save that', description: 'Try again in a moment.' });
    }
    setBusy('');
  };

  const cancelTour = async (r: Row, tourId: string) => {
    if (!firestore || !tenantId) return;
    setBusy(r.id);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'tours', tourId), {
        status: 'cancelled', cancelledAt: new Date().toISOString(),
      });
      let mail: any = null;
      try {
        const res = await fetch('/api/booths/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tour-cancelled', tenantId, tourId }),
        });
        mail = await res.json();
      } catch { /* reported below */ }
      toast({
        title: 'Tour cancelled',
        description: mail?.ok ? `${r.name} has been told.` : 'Saved — but the message did not go out.',
      });
    } catch {
      toast({ title: 'Could not cancel', description: 'Try again in a moment.' });
    }
    setBusy('');
  };

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
      // Retire any earlier offer still open for this lead. The old link keeps
      // resolving, but it can no longer be answered — its status is no longer
      // 'pending', which is the only state the rules let a prospect update.
      const stale = invites.filter((i) => i.applicationId === r.id && i.status === 'pending');
      await Promise.all(stale.map((i) => updateDoc(doc(firestore, 'tenants', tenantId, 'tourInvites', i.id), {
        status: 'superseded', supersededAt: new Date().toISOString(), supersededBy: token,
      }).catch(() => { /* best-effort */ })));
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
      try { await navigator.clipboard.writeText(link); } catch { /* the email below is the real delivery */ }
      setOfferFor(''); setOfferSlots(['', '', '']);

      // Email it. Logged, policy-governed and delivery-tracked like every
      // other message — a link sitting on a clipboard reaches nobody.
      let sent: any = null;
      try {
        const res = await fetch('/api/booths/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tour-invite', tenantId, inviteId: token }),
        });
        sent = await res.json();
      } catch { /* reported below */ }

      if (sent?.ok) {
        toast({ title: `Times sent to ${r.name}`, description: 'Emailed, and the link is on your clipboard too.' });
      } else if (sent?.error) {
        toast({ title: 'Link copied — not emailed', description: sent.error });
      } else {
        toast({ title: 'Link copied', description: `Send it to ${r.name} — they pick a time or send you theirs.` });
      }
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
    if (new Date(iso).getTime() < Date.now()) {
      toast({ title: 'That time has already passed', description: 'Offer them new times instead.' });
      return;
    }
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

      // tour-book only emails the visitor when the shop has prospect emails
      // switched on, which leaves someone who just picked a time hearing
      // nothing. A confirmation they asked for is not marketing — send it.
      let mail: any = null;
      try {
        const res2 = await fetch('/api/booths/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tour-decision', tenantId, tourId: out.tourId || out.id, decision: 'approve' }),
        });
        mail = await res2.json();
      } catch { /* the booking stands */ }
      toast({
        title: 'Tour booked',
        description: mail?.ok ? `${r.name} has been confirmed by email.` : `${r.name} — it is on the tour schedule now.`,
      });
    } catch {
      toast({ title: 'Could not book it', description: 'Try again in a moment.' });
    }
    setBusy('');
  };

  // ── PEOPLE (the CRM view) ─────────────────────────────────────────────────
  // A lead, a day guest and a renter are the same human seen at three moments.
  // These four collections are what it takes to say so: stays, enquiries and
  // tours, leases (with the renter records that hold the contact details a
  // lease does not), and the managed overlay. The merge itself lives in
  // src/lib/guest-book.ts so this page and the hub can't drift apart.
  const [stays, setStays] = useState<any[]>([]);
  const [leases, setLeases] = useState<any[]>([]);
  const [renters, setRenters] = useState<any[]>([]);
  const [contactDocs, setContactDocs] = useState<any[]>([]);
  const [peopleSearch, setPeopleSearch] = useState('');

  useEffect(() => {
    if (!firestore || !tenantId) return;
    // Bounded where growth is unbounded. Bookings are the one collection here
    // that grows every single day; everything the People view derives from
    // them — visits, spend, recency, tier — is about the last two years at
    // most, so that is all we load. Leases, renters and contacts are roster-
    // sized and stay whole. If the window ever needs widening, it is one
    // number, here.
    const horizon = new Date();
    horizon.setFullYear(horizon.getFullYear() - 2);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const stayQuery = query(
      collection(firestore, 'tenants', tenantId, 'bookings'),
      where('startDate', '>=', horizonIso),
    );
    const subs = [
      [stayQuery, setStays],
      [collection(firestore, 'tenants', tenantId, 'leases'), setLeases],
      [collection(firestore, 'tenants', tenantId, 'renters'), setRenters],
      [collection(firestore, 'tenants', tenantId, 'contacts'), setContactDocs],
    ].map(([src, set]: any) => onSnapshot(
      src,
      (snap: any) => set(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))),
      () => {},
    ));
    return () => subs.forEach((u) => u());
  }, [firestore, tenantId]);

  const renterById = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of renters) m.set(r.id, r);
    return m;
  }, [renters]);

  const contactByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of contactDocs) if (c.key) m.set(c.key, c);
    return m;
  }, [contactDocs]);

  const people = useMemo(() => buildGuestBook({
    reservations: stays, applications: apps, leases, renterById, contactByKey,
  }), [stays, apps, leases, renterById, contactByKey]);

  const visiblePeople = useMemo(
    () => people.filter((g) => guestMatches(g, peopleSearch)),
    [people, peopleSearch]);

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
      const now = new Date().toISOString();
      await updateDoc(doc(firestore, 'tenants', tenantId, 'boothApplications', r.id), {
        status,
        followUpNeeded: false,
        [`${status}At`]: now,
        // A no-show from the row is the same fact as a no-show from the tour
        // manager; write it the same way so the history and the outcome agree.
        ...(status === 'no_show' ? { tourOutcome: { showed: false, at: now, by: actorName || null } } : {}),
      });
      // A closed or declined lead must not leave a confirmed visit sitting on
      // the calendar with nobody attached to it. The tour follows the lead.
      const live = r.tourId ? tourById.get(r.tourId) : null;
      if (live && ['confirmed', 'requested'].includes(String(live.status)) && ['closed', 'declined', 'no_show'].includes(status)) {
        await updateDoc(doc(firestore, 'tenants', tenantId, 'tours', live.id), {
          status: status === 'no_show' ? 'no_show' : 'cancelled',
          ...(status === 'no_show' ? { decidedAt: now } : { cancelledAt: now }),
        }).catch(() => { /* the lead change stands */ });
      }
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
    ['people', 'People'],
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

      {filter === 'people' ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={peopleSearch} onChange={(e) => setPeopleSearch(e.target.value)}
              placeholder="Search by name, phone or email"
              aria-label="Search people"
              className="w-full h-12 pl-9 pr-3 rounded-2xl border-2 bg-white text-sm font-bold" />
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {visiblePeople.length} {visiblePeople.length === 1 ? 'person' : 'people'} · everyone who has enquired, toured, booked a day or rented
          </p>

          {visiblePeople.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-8 text-center">
              <p className="text-sm font-black">Nobody matches that.</p>
            </div>
          ) : visiblePeople.slice(0, 200).map((g: GuestBookEntry) => (
            <div key={g.key} className="rounded-2xl border-2 bg-white p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-sm truncate">{g.name}</p>
                  <p className="text-[11px] font-bold text-muted-foreground mt-0.5 truncate">
                    {[g.phone, g.email].filter(Boolean).join(' · ') || 'No contact details'}
                  </p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest',
                  g.stage === 'renter' ? 'bg-emerald-200 text-emerald-900'
                    : g.stage === 'repeat' ? 'bg-indigo-200 text-indigo-900'
                    : g.stage === 'guest' ? 'bg-sky-100 text-sky-800'
                    : 'bg-slate-100 text-slate-600')}>
                  {STAGE_LABEL[g.stage]}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-muted-foreground">
                {g.visits > 0 && <span>{g.visits} {g.visits === 1 ? 'stay' : 'stays'}</span>}
                {g.totalCents > 0 && <span>${(g.totalCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} spent</span>}
                {g.monthlyRentCents > 0 && <span>${(g.monthlyRentCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo rent</span>}
                {g.lastRating ? (
                  <span className="flex items-center gap-1"><Star className="h-3 w-3" />{g.lastRating}</span>
                ) : null}
                {g.firstDate && <span>since {when(g.firstDate)}</span>}
                {g.lastDate && <span>last {when(g.lastDate)}</span>}
              </div>

              {(g.tags.length > 0 || g.tier !== 'new') && (
                <div className="flex flex-wrap gap-1.5">
                  {g.tier !== 'new' && (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">
                      {g.tier}
                    </span>
                  )}
                  {g.tags.map((t) => (
                    <span key={t} className="rounded-full border-2 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {g.phone && (
                  <a href={`tel:${g.phone}`} className="flex items-center gap-1.5 rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black">
                    <Phone className="h-3 w-3" /> Call
                  </a>
                )}
                {g.email && (
                  <a href={`mailto:${g.email}`} className="flex items-center gap-1.5 rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black">
                    <Mail className="h-3 w-3" /> Email
                  </a>
                )}
                {g.convertedRenterId && (
                  <a href="/renters" className="rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600">
                    Renter card
                  </a>
                )}
              </div>

              {g.ownerNotes && <p className="text-[11px] font-bold text-muted-foreground">{g.ownerNotes}</p>}

              <CommsTrail
                recipientType="contact"
                recipientId={g.convertedRenterId || g.key}
                contactPhone={g.phone}
                contactEmail={g.email}
                title="Messages to them"
              />
            </div>
          ))}

          {visiblePeople.length > 200 && (
            <p className="text-[10px] font-bold text-muted-foreground text-center">
              Showing the 200 most recently active — search to narrow.
            </p>
          )}
        </div>
      ) : loading ? (
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

              {(() => {
                const t = r.tourId ? tourById.get(r.tourId) : null;
                if (!t) return null;
                const slot = t.date && t.time ? whenTime(`${t.date}T${t.time}:00`) : 'time to confirm';
                const map: Record<string, [string, string]> = {
                  confirmed: ['Confirmed', 'border-emerald-200 bg-emerald-50 text-emerald-800'],
                  requested: ['Awaiting your OK', 'border-amber-200 bg-amber-50 text-amber-900'],
                  declined: ['Declined', 'border-red-200 bg-red-50 text-red-700'],
                  cancelled: ['Cancelled', 'border-slate-200 bg-slate-50 text-slate-500'],
                };
                const [label, tone] = map[String(t.status)] || ['Booked', 'border-slate-200 bg-slate-50 text-slate-600'];
                return (
                  <div className={cn('flex items-center gap-2 rounded-xl border-2 px-3 py-2', tone)}>
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
                    <span className="text-[11px] font-bold">{slot}</span>
                    {t.hostName && (
                      <span className="ml-auto text-[10px] font-bold opacity-80">with {t.hostName}</span>
                    )}
                  </div>
                );
              })()}

              {r.outcome?.interest && (
                <p className="flex items-center gap-1.5 text-[11px] font-bold">
                  <Flame className="h-3.5 w-3.5 shrink-0" /> Interest: {r.outcome.interest}
                </p>
              )}
              {r.message && <p className="text-[11px] font-bold text-muted-foreground line-clamp-2">{r.message}</p>}

              {(followUpsByLead.get(r.id) || []).map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2">
                  <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <span className="min-w-0 flex-1 text-[11px] font-bold text-amber-900 truncate">
                    {t.title || 'Follow up'}
                    {t.createdAt ? <span className="font-medium opacity-70"> · set {when(t.createdAt)}</span> : null}
                  </span>
                  <button onClick={() => completeTask(t.id)}
                    className="shrink-0 rounded-lg bg-amber-700 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-white">
                    Done
                  </button>
                </div>
              ))}

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
                {(() => {
                  const t = r.tourId ? tourById.get(r.tourId) : null;
                  if (!t || t.status !== 'requested') return null;
                  return (
                    <>
                      <button onClick={() => decideTour(r, t.id, 'approve')} disabled={!!busy}
                        className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                        {busy === r.id ? '…' : 'Approve tour'}
                      </button>
                      <button onClick={() => arm(`${r.id}:decline-tour`, () => decideTour(r, t.id, 'decline'))} disabled={!!busy}
                        aria-live="polite"
                        className={cn('rounded-xl border-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-50',
                          armed === `${r.id}:decline-tour` ? 'bg-red-600 border-red-600 text-white' : 'border-red-200 bg-white text-red-600')}>
                        {armedLabel(armed === `${r.id}:decline-tour`, 'Decline', 'Tap again to decline')}
                      </button>
                    </>
                  );
                })()}
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
                      const t = r.tourId ? tourById.get(r.tourId) : null;
                      if (t && t.status === 'confirmed') {
                        return (
                          <>
                            <button onClick={() => { setOfferFor(offerFor === r.id ? '' : r.id); setOfferSlots(['', '', '']); }} disabled={!!busy}
                              className="rounded-xl border-2 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-50">
                              Reschedule
                            </button>
                            <button onClick={() => arm(`${r.id}:cancel-tour`, () => cancelTour(r, t.id))} disabled={!!busy}
                              aria-live="polite"
                              className={cn('rounded-xl border-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-50',
                                armed === `${r.id}:cancel-tour` ? 'bg-red-600 border-red-600 text-white' : 'border-red-200 bg-white text-red-600')}>
                              {armedLabel(armed === `${r.id}:cancel-tour`, 'Cancel tour', 'Tap again to cancel')}
                            </button>
                          </>
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
                    {(() => {
                      const live = r.tourId ? tourById.get(r.tourId) : null;
                      const hasLive = !!live && ['confirmed', 'requested'].includes(String(live.status));
                      const on = armed === `${r.id}:close`;
                      return (
                        <button onClick={() => arm(`${r.id}:close`, () => setStatus(r, 'closed', 'Closed out'))} disabled={!!busy}
                          aria-live="polite"
                          className={cn('rounded-xl border-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-50',
                            on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white text-slate-600')}>
                          {on ? (hasLive ? 'Tap again — also cancels their tour' : 'Tap again to close') : 'Close'}
                        </button>
                      );
                    })()}
                    {r.kind === 'tour' && (
                  <button onClick={() => setManagingTour(appDocs.find((a: any) => a.id === r.id) || null)}
                    className={cn('rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest',
                      !r.outcome && (r.tourStartIso || '').slice(0, 10) < todayIso && (r.tourStartIso || '')
                        ? 'bg-rose-600 text-white'
                        : 'border-2 bg-white text-slate-600')}>
                    {r.outcome ? 'Tour notes' : 'Record outcome'}
                  </button>
                )}
                {r.kind === 'tour' && (
                      <button onClick={() => arm(`${r.id}:no-show`, () => setStatus(r, 'no_show', 'Marked no-show'))} disabled={!!busy}
                        aria-live="polite"
                        className={cn('rounded-xl border-2 px-3 py-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-50',
                          armed === `${r.id}:no-show` ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white text-slate-600')}>
                        {armedLabel(armed === `${r.id}:no-show`, 'No-show', 'Tap again — no-show')}
                      </button>
                    )}
                    <button onClick={() => arm(`${r.id}:convert`, () => convert(r))} disabled={!!busy}
                      aria-live="polite"
                      className={cn('rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-50',
                        armed === `${r.id}:convert` ? 'bg-emerald-800' : 'bg-emerald-600')}>
                      {busy === r.id ? '…' : armedLabel(armed === `${r.id}:convert`, 'Convert', 'Tap again — make them a renter')}
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

              <CommsTrail
                recipientType="contact"
                recipientId={r.id}
                contactPhone={r.phone}
                contactEmail={r.email}
                title="Messages to them"
              />

              {(() => {
                const lines = historyFor(r, r.tourId ? tourById.get(r.tourId) : null,
                  invites.filter((i) => i.applicationId === r.id));
                if (lines.length === 0) return null;
                const isOpen = historyOpen === r.id;
                return (
                  <div className="rounded-2xl border-2 overflow-hidden">
                    <button type="button" onClick={() => setHistoryOpen(isOpen ? '' : r.id)}
                      aria-expanded={isOpen}
                      className="w-full px-3 py-2.5 flex items-center justify-between gap-2 bg-white">
                      <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
                        <HistoryIcon className="h-3 w-3 text-primary" /> History
                        <span className="rounded-full border-2 px-1.5 text-[8px]">{lines.length}</span>
                      </span>
                      <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-1.5 bg-white">
                        {lines.map((l, i) => (
                          <div key={`${l.at}-${i}`} className="flex items-start gap-2">
                            <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                              l.tone === 'good' ? 'bg-emerald-500' : l.tone === 'bad' ? 'bg-red-500' : 'bg-slate-300')} />
                            <p className="text-[11px] font-bold leading-snug">
                              {l.text}
                              <span className="ml-1.5 font-medium text-muted-foreground">{when(l.at)}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] font-bold text-muted-foreground">
        Convert makes someone a renter right here; giving them a lease happens in the Booth Hub, where the booths are.
      </p>

      {managingTour && tenantId && (
        <TourManagerDialog
          open={!!managingTour}
          onOpenChange={(o) => { if (!o) setManagingTour(null); }}
          firestore={firestore}
          tenantId={tenantId}
          tour={managingTour}
          tourId={managingTour.tourId || null}
          actorName={actorName}
          hosts={hosts}
          studioName={(selectedTenant as any)?.name || null}
          studioPhone={(selectedTenant as any)?.phone || null}
          studioEmail={(selectedTenant as any)?.email || null}
          studioAddress={(selectedTenant as any)?.address || null}
          printConfig={(selectedTenant as any)?.tourPrintoutConfig || null}
          onConvert={(t) => { const row = apps.find((x) => x.id === t.id); setManagingTour(null); if (row) void convert(row); }}
        />
      )}
      </div>
    </div>
  );
}
