'use client';

/**
 * /host — the screen a host stares at all shift.
 *
 * In plain terms, it answers four questions, top to bottom:
 *   1. Is anything wrong right now?          (the alerts strip)
 *   2. Who is booked and are they late?      (Expected)
 *   3. Who is waiting and how long?          (Waiting, with honest quotes)
 *   4. What does the floor look like?        (units: free / seated / held)
 *
 * Seating is tap–tap: tap a party, tap a unit. The engine says yes or no —
 * capacity and holds are RULES here, with the reason shown, and an explicit
 * "seat anyway" for the times the human knows better.
 *
 * The session opens itself: loading this screen is a front-of-house action,
 * so if today's session doesn't exist it is created from the floor-plan
 * template, and a stale one from yesterday is closed at its last activity.
 * Nobody has to remember to press start.
 */

import { Drawer } from '@/components/pos/desk/kit';
import { TableTab } from '@/components/host/TableTab';
import { ReadyToRun, useReadyToRun } from '@/components/kitchen/ReadyToRun';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { tenantTimeZone } from '@/lib/tenant-time';
import {
  autoSeatPlan, canSeat, floorAlerts, quoteWait, resolveVocabulary, seatingState,
  type HeldMap, type TableLike,
} from '@/lib/hosting';
import {
  businessDayFor, freezeUnits, heldUnits, lateVerdict, partiesFromEventGuests, partyFromAppointment, partyFromWalkIn, sessionDecision,
  type HostedParty, type ServiceSession,
} from '@/lib/hosting-sessions';
import { resolveHostingSettings, starterTemplate } from '@/lib/floor-plans';
import { AlertCircle, Bell, Plus, Sparkles } from 'lucide-react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN_TINT = '#ecf6f0';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;

export default function HostScreen() {
  const { firestore, user } = useFirebase() as any;
  const { selectedTenant } = useTenant();
  const [tabFor, setTabFor] = useState<any>(null);   // the table whose tab is open
  const [tableFor, setTableFor] = useState<string | null>(null);   // a seated table tapped: its party, tab and "they've left"
  const [adding, setAdding] = useState(false);
  const tenantId = selectedTenant?.id ?? null;
  const readyToRun = useReadyToRun(firestore, tenantId);   // "Order up": food and drink ready to carry to a table
  const { toast } = useToast();

  const [session, setSession] = useState<ServiceSession | null>(null);
  const [parties, setParties] = useState<HostedParty[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [size, setSize] = useState('2');
  const [at, setAt] = useState('');           // optional HH:MM → reservation
  const [phone, setPhone] = useState('');     // optional — enables the ready text
  const [now, setNow] = useState(new Date());
  const [proposals, setProposals] = useState<ReturnType<typeof autoSeatPlan>>([]);

  const hs = resolveHostingSettings((selectedTenant as any)?.hostingSettings);
  const V = resolveVocabulary(hs.vocabulary);
  const tz = tenantTimeZone(selectedTenant as any);
  const holdOpts = { holdBeforeMinutes: hs.holdBeforeMinutes, holdGraceMinutes: hs.holdGraceMinutes };

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  // ── Session bootstrap: reuse today's, or close stale + open fresh ────────
  useEffect(() => {
    if (!firestore || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const openSnap = await getDocs(query(
          collection(firestore, `tenants/${tenantId}/serviceSessions`),
          where('status', '==', 'open'), limit(5),
        ));
        const open = openSnap.docs[0];
        const d = sessionDecision(open ? (open.data() as any) : null, new Date(), tz, hs.dayCutoverHour);
        if (d.action === 'reuse' && open) {
          if (!cancelled) setSession({ id: open.id, ...(open.data() as any) });
          return;
        }
        if (d.action === 'close_then_open' && open) {
          await updateDoc(open.ref, { status: 'closed', closesAt: d.closeStaleAt, autoClosedAt: new Date().toISOString() });
        }
        // Freeze the template — sessions copy, never link.
        const plan = await getDoc(doc(firestore, `tenants/${tenantId}/floorPlans`, 'default'));
        const template: TableLike[] = plan.exists() ? ((plan.data() as any).units || []) : starterTemplate();
        const fresh = {
          locationId: null, businessDay: d.businessDay, opensAt: new Date().toISOString(),
          closesAt: null, status: 'open' as const, eventId: null,
          units: freezeUnits(template), openedBy: null,
          vocabulary: hs.vocabulary || null, lastActivityAt: new Date().toISOString(),
        };
        const ref = await addDoc(collection(firestore, `tenants/${tenantId}/serviceSessions`), fresh);
        if (!cancelled) setSession({ id: ref.id, ...(fresh as any) });
      } catch (e) {
        toast({ variant: 'destructive', title: 'Could not open the session', description: e instanceof Error ? e.message : undefined });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, tenantId]);

  // ── THE WALK-IN QUEUE, MIRRORED LIVE ──────────────────────────────────────
  // Read-side strangler: today's queue rows appear here through the tested
  // partyFromWalkIn mapping WITHOUT writing anything — the queue stays the
  // sole owner of its data, and if this mirror vanished tomorrow the lobby
  // would not notice. A mirrored row only becomes a real party doc the moment
  // the host SEATS it (materialise-on-touch), so nothing is stored twice.
  const [queueMirror, setQueueMirror] = useState<HostedParty[]>([]);
  const [rowMeta, setRowMeta] = useState<Record<string, { token: string | null; appointmentOwned: boolean; open: boolean }>>({});
  useEffect(() => {
    if (!firestore || !tenantId || !session?.id) return;
    return onSnapshot(collection(firestore, `tenants/${tenantId}/walkIns`), (snap) => {
      const out: HostedParty[] = [];
      const meta: Record<string, { token: string | null; appointmentOwned: boolean; open: boolean }> = {};
      for (const d of snap.docs) {
        const w = { id: d.id, ...(d.data() as any) };
        meta[d.id] = {
          token: w.checkInToken ? String(w.checkInToken) : null,
          appointmentOwned: !!w.appointmentId,
          open: ['waiting', 'notified', 'arrived', 'held', 'confirmed'].includes(String(w.status || 'waiting').toLowerCase()),
        };
        const mapped = partyFromWalkIn(w, session.id);
        if (!mapped || !['waiting', 'notified'].includes(mapped.status)) continue;
        if (mapped.joinedAt && businessDayFor(new Date(mapped.joinedAt), tz, hs.dayCutoverHour) !== session.businessDay) continue;
        out.push({ ...mapped, id: `walkin:${d.id}`, guestIds: [`walkin:${d.id}`] });
      }
      setQueueMirror(out);
      setRowMeta(meta);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, tenantId, session?.id]);

  // ── Live parties for this session ─────────────────────────────────────────
  useEffect(() => {
    if (!firestore || !tenantId || !session?.id) return;
    return onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/parties`), where('sessionId', '==', session.id)),
      (snap) => setParties(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
    );
  }, [firestore, tenantId, session?.id]);

  const units: TableLike[] = session?.units || [];
  const seatedGuests = useMemo(
    () => parties.filter((p) => p.status === 'seated')
      .flatMap((p) => (p.unitIds || []).map((u, i) => ({ id: `${p.id}:${i}`, tableId: u }))
        .concat(Array.from({ length: Math.max(0, p.size - (p.unitIds?.length ? 1 : 0)) },
          (_, i) => ({ id: `${p.id}+${i}`, tableId: p.unitIds?.[0] || '' })).filter((g) => g.tableId))),
    [parties]);
  const state = useMemo(() => seatingState(units, seatedGuests), [units, seatedGuests]);
  const held: HeldMap = useMemo(() => heldUnits(parties, now, holdOpts), [parties, now, hs.holdBeforeMinutes, hs.holdGraceMinutes]);
  const seatedRows = useMemo(
    () => parties.filter((p) => p.status === 'seated' && p.seatedAt && p.unitIds?.length)
      .map((p) => ({ tableId: p.unitIds[0], seatedAt: p.seatedAt, turnMinutes: p.turnMinutes ?? undefined })),
    [parties]);
  const alerts = floorAlerts(state, [], V ? hs.vocabulary : undefined);

  const write = useCallback(async (id: string, patch: any) => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/parties`, id), patch);
  }, [firestore, tenantId]);

  /** OPAL BECOMES A HOSTING TENANT HERE. Pull today's appointment book onto
   *  the floor as expected parties. Idempotent: each imported party carries
   *  its appointment id in guestIds, and anything already carried is skipped —
   *  pressing the button twice imports nothing twice. Only bookings on THIS
   *  session's business day come across. */
  const importBookings = async () => {
    if (!firestore || !tenantId || !session) return;
    try {
      const have = new Set(parties.flatMap((p) => p.guestIds || []));
      const snap = await getDocs(query(
        collection(firestore, `tenants/${tenantId}/appointments`),
        where('startTime', '>=', session.businessDay),
      ));
      let added = 0;
      for (const d of snap.docs) {
        const a = { id: d.id, ...(d.data() as any) };
        if (have.has(`appt:${d.id}`)) continue;
        if (businessDayFor(new Date(a.startTime), tz, hs.dayCutoverHour) !== session.businessDay) continue;
        const party = partyFromAppointment(a, session.id);
        if (!party) continue; // cancelled / no-show / malformed — never guessed at
        await addDoc(collection(firestore, `tenants/${tenantId}/parties`),
          { ...party, guestIds: [`appt:${d.id}`] });
        added += 1;
      }
      toast({ title: added ? `${added} booking${added === 1 ? '' : 's'} imported` : 'Nothing new to import' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Import failed', description: e instanceof Error ? e.message : undefined });
    }
  };

  /** BOOTH DAY-USE, MIRRORED LIVE. Today's hourly/daily boothReservations
   *  appear as expected parties the moment they exist — read-side only, the
   *  booth module stays sole owner of its rows (payments, agreements, kiosk
   *  check-in untouched). A mirrored row becomes a real party doc only when
   *  the host seats it (materialise-on-touch, deduped by booth:{id}).
   *  Monthly LEASES are deliberately absent: a lease is tenancy, not
   *  hosting — nobody seats a renter who has keys. Units are not pinned:
   *  booth ids live in their own module, not on this floor template. */
  const [boothMirror, setBoothMirror] = useState<HostedParty[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId || !session?.id) return;
    return onSnapshot(query(
      collection(firestore, `tenants/${tenantId}/boothReservations`),
      where('startDate', '==', session.businessDay),
    ), (snap) => {
      const out: HostedParty[] = [];
      for (const d of snap.docs) {
        const r = { id: d.id, ...(d.data() as any) };
        if (['cancelled', 'canceled'].includes(String(r.status || ''))) continue;
        const startIso = r.startTime
          ? new Date(`${session.businessDay}T${String(r.startTime).slice(0, 5)}:00`).toISOString()
          : new Date(`${session.businessDay}T09:00:00`).toISOString();
        out.push({
          id: `booth:${d.id}`,
          sessionId: session.id,
          name: `${String(r.name || 'Day use').trim()}${r.boothName ? ` (${r.boothName})` : ''}`,
          size: 1, needs: [], source: 'booking',
          status: 'expected',
          arrivesAt: startIso, joinedAt: null, quotedMinutes: null,
          notifiedAt: null, seatedAt: null, finishedAt: null,
          turnMinutes: null, unitIds: [], guestIds: [`booth:${d.id}`],
        } as HostedParty);
      }
      setBoothMirror(out);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, tenantId, session?.id]);

  /** THE EVENT, MIRRORED LIVE. The active event's guest manifest flows
   *  through the tested partiesFromEventGuests mapping continuously — every
   *  RSVP wave appears without anyone pressing anything. Same discipline:
   *  the event module owns its guests; a mirror row materialises only on
   *  seat (all member ids carried as event:{guestId}). Guests the event has
   *  already checked in and seated are left to the event's own surfaces —
   *  a read-side mirror refuses to write a seat it did not give. */
  const [activeEvent, setActiveEvent] = useState<any | null>(null);
  const [eventMirror, setEventMirror] = useState<HostedParty[]>([]);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(query(
      collection(firestore, `tenants/${tenantId}/studioEvents`),
      where('status', '==', 'active'), limit(1),
    ), (snap) => {
      setActiveEvent(snap.empty ? null : { id: snap.docs[0].id, ...(snap.docs[0].data() as any) });
    });
  }, [firestore, tenantId]);
  useEffect(() => {
    if (!firestore || !tenantId || !session?.id || !activeEvent?.id) { setEventMirror([]); return; }
    const evUnits: TableLike[] = Array.isArray(activeEvent.seatingTables) ? activeEvent.seatingTables : units;
    return onSnapshot(query(
      collection(firestore, `tenants/${tenantId}/eventGuests`),
      where('eventId', '==', activeEvent.id),
    ), (snap) => {
      const guests = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const out: HostedParty[] = [];
      for (const p of partiesFromEventGuests(guests, session.id, evUnits)) {
        if (p.status === 'seated') continue; // checked in by the event itself — not ours to re-seat
        const keys = (p.guestIds || []).map((g) => `event:${g}`);
        out.push({ ...p, id: `event:${keys[0] || Math.random().toString(36).slice(2)}`, guestIds: keys } as HostedParty);
      }
      setEventMirror(out);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, tenantId, session?.id, activeEvent?.id]);

  /** READY TEXT. The server claims the notification (a double-tap cannot send
   *  twice), texts the party if a phone is on file, and marks them notified
   *  either way — walking over IS notifying. If the route is unreachable the
   *  board still moves: mark locally and say the text did not go. Mirrored
   *  queue rows never reach this — the walk-in queue keeps its own SMS. */
  const notifyParty = async (p: HostedParty) => {
    try {
      const res = await fetch('/api/host/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, partyId: p.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d?.ok !== true) throw new Error(d?.error || 'Notify failed');
      toast({ title: d.sent ? `Text sent to ${p.name}` : (d.message || 'Marked as notified') });
    } catch {
      await write(p.id, { status: 'notified', notifiedAt: new Date().toISOString() });
      toast({ title: 'Marked as notified — the text could not be sent' });
    }
  };

  /** THE WHITEBOARD TALKS BACK. Every party carries where it came from
   *  (walkin:{id} in guestIds), so a host action on a kiosk guest can advance
   *  the queue's OWN row instead of leaving two modules disagreeing about one
   *  person. Two guards, both load-bearing: a row carrying an appointmentId
   *  belongs to the appointment flow (the queue's complete action refuses it
   *  for the same reason), and a row the queue already closed is never
   *  resurrected — the meta sidecar tells us both without an extra read.
   *  Failure is non-fatal by design: the host board must move even when the
   *  queue write can't, so we seat first and report the sync honestly. */
  const walkInIdOf = (p: HostedParty): string | null => {
    const key = (p.guestIds || []).find((g) => g.startsWith('walkin:'))
      || (p.id.startsWith('walkin:') ? p.id : null);
    return key ? key.slice('walkin:'.length) : null;
  };

  const syncQueueSeated = async (p: HostedParty) => {
    const wid = walkInIdOf(p);
    if (!wid || !firestore || !tenantId) return;
    const meta = rowMeta[wid];
    if (!meta || meta.appointmentOwned || !meta.open) return;
    try {
      const nowIso = new Date().toISOString();
      await setDoc(doc(firestore, `tenants/${tenantId}/walkIns`, wid),
        { status: 'servicing', serviceStartTime: nowIso, needsFrontDesk: false, updatedAt: nowIso },
        { merge: true });
      if (meta.token) {
        const st = { status: 'servicing', tenantId, updatedAt: nowIso };
        await setDoc(doc(firestore, `tenants/${tenantId}/appointmentCheckIns`, meta.token), st, { merge: true });
        await setDoc(doc(firestore, 'appointmentCheckIns', meta.token), st, { merge: true });
      }
    } catch {
      toast({ title: 'Seated — the lobby queue could not be updated' });
    }
  };

  const finishParty = async (p: HostedParty) => {
    await write(p.id, { status: 'finished', finishedAt: new Date().toISOString() });
    const wid = walkInIdOf(p);
    if (!wid || rowMeta[wid]?.appointmentOwned) return;
    try {
      const res = await fetch('/api/walkins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', tenantId, walkInId: wid }),
      });
      if (res.status === 404) return;
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d?.ok !== true) throw new Error(d?.error || 'sync failed');
    } catch {
      toast({ title: 'Finished here — please also close them on the queue board' });
    }
  };

  const addParty = async (): Promise<boolean> => {
    if (!firestore || !tenantId || !session || !name.trim()) return false;
    const isRes = /^\d{2}:\d{2}$/.test(at.trim());
    const arrives = isRes ? new Date(`${session.businessDay}T${at.trim()}:00`) : null;
    const added = await addDoc(collection(firestore, `tenants/${tenantId}/parties`), {
      sessionId: session.id, name: name.trim(),
      size: Math.max(1, Math.floor(Number(size) || 1)), needs: [],
      source: isRes ? 'reservation' : 'walk_in',
      status: isRes ? 'expected' : 'waiting',
      arrivesAt: arrives ? arrives.toISOString() : null,
      joinedAt: isRes ? null : new Date().toISOString(),
      quotedMinutes: null, notifiedAt: null, seatedAt: null, finishedAt: null,
      turnMinutes: null, unitIds: [], guestIds: [],
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    }).then(() => true, () => false);
    if (!added) { toast({ variant: 'destructive', title: 'That didn’t save. Try again.' }); return false; }
    setName(''); setAt(''); setPhone('');
    return true;
  };

  const seatAt = async (party: HostedParty, unitId: string, force = false) => {
    // Seating ANY mirrored row (walk-in, booth, event) materialises it as a
    // real party first — skipped if a prior touch already did (the dedupe
    // keys are the source ids carried in guestIds).
    if (/^(walkin|booth|event):/.test(party.id) && firestore && tenantId && session) {
      const carried = parties.find((x) => (x.guestIds || []).some((g) => (party.guestIds || []).includes(g)));
      if (carried) party = carried;   // already on the list here (an earlier tap): seat that one
      else {
        const { id: _drop, ...body } = party;
        const ref = await addDoc(collection(firestore, `tenants/${tenantId}/parties`), body);
        party = { ...party, id: ref.id };
      }
      setSelected(party.id);   // the choice stays on them (and "seat anyway" works on the second tap)
    }
    const verdict = canSeat(state, unitId, { id: party.id, size: party.size, needs: party.needs }, { held, vocabulary: hs.vocabulary, allowOverfill: force });
    if (!verdict.allowed) {
      toast({ variant: 'destructive', title: verdict.reason,
        description: `Tap the ${V.unit} again within 5s to seat anyway.` });
      setForceFor(`${party.id}:${unitId}`); setTimeout(() => setForceFor(null), 5000);
      return;
    }
    await write(party.id, { status: 'seated', seatedAt: new Date().toISOString(), unitIds: [unitId] });
    await syncQueueSeated(party);
    /* SEAT → GUEST DOC WRITE-BACK (the last one-way seam). When the party
     * came from the event, the seat the host just gave is written back to
     * each guest's own doc as the unit NAME — the same convention
     * SeatingChartTab writes — so the floor screen, allergy alerts, and the
     * seating chart all see the host's decision instead of a stale blank.
     * Guards mirror H8's: only event-owned members, non-fatal (the party is
     * seated either way; a sync miss gets an honest toast, never a rollback). */
    const evKeys = (party.guestIds || []).filter((g) => g.startsWith('event:'));
    if (evKeys.length > 0 && firestore && tenantId) {
      const unitName = units.find((u) => u.id === unitId)?.name || unitId;
      try {
        await Promise.all(evKeys.map((k) =>
          setDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, k.slice('event:'.length)),
            { tableNumber: unitName }, { merge: true })
        ));
      } catch {
        toast({ title: 'Seated — chart sync missed', description: `They're seated here; the event chart may still show the old ${V.unit}.` });
      }
    }
    setSelected(null); setProposals([]);
  };
  const [forceFor, setForceFor] = useState<string | null>(null);

  const notCarried = (m: HostedParty) =>
    !parties.some((x) => (x.guestIds || []).some((g) => (m.guestIds || []).includes(g)));
  const mirrored = queueMirror.filter(notCarried);
  const mirroredExpected = [...boothMirror, ...eventMirror].filter(notCarried);
  const waiting = [...parties, ...mirrored, ...mirroredExpected].filter((p) => ['waiting', 'notified'].includes(p.status))
    .sort((a, b) => String(a.joinedAt || '').localeCompare(String(b.joinedAt || '')));
  const expected = [...parties, ...mirroredExpected].filter((p) => p.status === 'expected')
    .sort((a, b) => String(a.arrivesAt || '').localeCompare(String(b.arrivesAt || '')));
  const sel = [...parties, ...mirrored, ...mirroredExpected].find((p) => p.id === selected) || null;
  const at12 = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '');
  const minsSince = (iso: string | null | undefined) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 60000)) : null; };
  const seatedAt = (tableId: string) => parties.find((p) => p.status === 'seated' && (p.unitIds || []).includes(tableId)) || null;
  const nextFree = quoteWait(units, seatedGuests, seatedRows, { id: '__next', size: 2, needs: [] }, { now, held, vocabulary: hs.vocabulary });
  const Unit = V.units.charAt(0).toUpperCase() + V.units.slice(1);
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const openTable = tableFor ? state.tables.find((t) => t.tableId === tableFor) || null : null;
  const openParty = openTable ? seatedAt(openTable.tableId) : null;
  const pick = (id: string) => { setSelected(selected === id ? null : id); setTableFor(null); };

  return (
    <div className="min-h-dvh text-left" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b bg-[#fff] px-4 py-4 sm:px-6" style={{ borderColor: LINE }}>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Host stand</h1>
          <p className="text-[14px]" style={{ color: MUTED }}>{now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })}, {at12(now.toISOString())}</p>
        </div>
        <dl className="flex flex-wrap gap-x-7 gap-y-2">
          {[
            ['Seated', `${state.totalSeated}`, `of ${state.totalCapacity} ${V.seats}`],
            ['Waiting', `${waiting.length}`, waiting.length === 1 ? V.party : V.parties],
            ['Booked still to come', `${expected.length}`, ''],
            [`Next free ${V.unit} for 2`, nextFree.immediate ? 'Now' : nextFree.minutes !== null ? `about ${nextFree.minutes} min` : 'Not known', nextFree.immediate ? nextFree.tableName : ''],
          ].map(([k, v, sub]) => (
            <div key={k}><dt className="text-[13px]" style={{ color: MUTED }}>{k}</dt><dd className="text-[20px] font-semibold tabular-nums leading-tight">{v}{sub ? <span className="ml-1.5 text-[13px] font-normal" style={{ color: MUTED }}>{sub}</span> : null}</dd></div>
          ))}
        </dl>
        <button type="button" onClick={() => setAdding(true)} disabled={!session} className={`${BTN} inline-flex items-center gap-2`} style={{ background: INK, color: '#fff' }}><Plus className="h-4 w-4" aria-hidden />Add a {V.party}</button>
      </header>

      {alerts.length > 0 && <div className="px-4 pt-4 sm:px-6"><div className="space-y-1 rounded-2xl px-4 py-3" style={{ background: AMBER_TINT, color: AMBER }}>
        {alerts.map((a, i) => <p key={i} className="flex items-start gap-2 text-[14px] font-medium"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{a}</p>)}
      </div></div>}

      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="units" className="min-w-0 space-y-4 self-start rounded-3xl border bg-[#fff] p-4 sm:p-5" style={{ borderColor: LINE }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="units" className="text-[17px] font-semibold">{Unit}</h2>
            <div className="flex flex-wrap gap-4 text-[13px]" style={{ color: '#4b4e54' }} aria-hidden>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: GREEN }} />Free</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: INK }} />Seated</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full box-border" style={{ border: `2px dashed ${INK}` }} />Held</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: AMBER }} />Over</span>
            </div>
          </div>
          {sel && <div className="flex items-center gap-3 rounded-2xl py-1.5 pl-4 pr-1.5" style={{ background: INK, color: '#fff' }}>
            <p className="flex-1 text-[15px] font-medium">Tap a {V.unit} for {sel.name}, {sel.size}</p>
            <button type="button" onClick={() => setSelected(null)} className={`${BTN} px-3`} style={{ background: 'rgba(255,255,255,0.14)' }}>Cancel</button>
          </div>}
          {state.tables.length === 0
            ? <p className="py-10 text-center text-[15px]" style={{ color: MUTED }}>No {V.units} yet. Add them in the floor plan settings.</p>
            : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {state.tables.map((t) => {
                const hold = held[t.tableId]; const holder = hold ? [...parties, ...mirroredExpected].find((p) => p.id === hold.partyId) : null;
                const who = seatedAt(t.tableId); const m = minsSince(who?.seatedAt);
                const fits = !!sel && t.free >= sel.size && !hold;
                const free = t.seated === 0;
                const tone = t.overfilled ? { border: `2px solid ${AMBER}`, background: AMBER_TINT }
                  : hold && free ? { border: `2px dashed ${INK}`, background: '#fff' }
                  : free ? { border: `1px solid ${GREEN}`, background: GREEN_TINT }
                  : { border: `1px solid ${LINE}`, background: '#fff' };
                const line = t.overfilled ? `More than it ${V.seats === 'seats' ? 'seats' : 'holds'}` : who ? `${who.name}${m !== null ? `, seated ${m} min` : ''}`
                  : hold ? `Held${holder ? ` for ${holder.name}${holder.arrivesAt ? ` at ${at12(holder.arrivesAt)}` : ''}` : ''}` : 'Free';
                return (
                  <button key={t.tableId} type="button" aria-disabled={!sel && !who}
                    onClick={() => (sel ? seatAt(sel, t.tableId, forceFor === `${sel.id}:${t.tableId}`) : who ? setTableFor(t.tableId) : undefined)}
                    aria-label={`${t.name}: ${line}, ${t.seated} of ${t.capacity}`}
                    className={`flex min-h-[96px] flex-col justify-between gap-2 rounded-2xl p-3 text-left ${RING}`}
                    style={{ ...tone, ...(sel ? { opacity: fits ? 1 : 0.5, outline: fits ? `2px solid ${GREEN}` : undefined, outlineOffset: 2 } : {}) }}>
                    <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[16px] font-semibold">{t.name}</span><span className="shrink-0 text-[13px] tabular-nums" style={{ color: MUTED }}>{free ? `${cap(V.seats)} ${t.capacity}` : `${t.seated} of ${t.capacity}`}</span></span>
                    <span className="text-[13.5px] leading-snug" style={{ color: t.overfilled ? AMBER : free && !hold ? GREEN : MUTED, fontWeight: t.overfilled ? 600 : 400 }}>{line}</span>
                  </button>
                );
              })}
            </div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => setProposals(autoSeatPlan(units, waiting.map((p) => ({ id: p.id, size: p.size, needs: p.needs })), seatedGuests, { held, vocabulary: hs.vocabulary }))} disabled={!waiting.length}
              className={`${BTN} inline-flex items-center gap-2`} style={{ background: '#fff', border: `1px solid ${LINE}` }}><Sparkles className="h-4 w-4" aria-hidden />Suggest {V.units} for everyone waiting</button>
            <button type="button" onClick={importBookings} disabled={!session} className={BTN} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Bring in today’s bookings</button>
          </div>
          {proposals.length > 0 && <ul className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}>
            {proposals.map((p) => {
              const party = [...parties, ...waiting].find((x) => x.id === p.partyId);
              return (
                <li key={p.partyId} className="flex items-center justify-between gap-3">
                  <p className="min-w-0 text-[14.5px]"><b className="font-semibold">{party?.name}, {p.partySize}</b>{p.tableId ? ` at ${p.tableName}` : `: no ${V.unit} fits yet`}<span className="block text-[13px]" style={{ color: MUTED }}>{p.rationale}</span></p>
                  {p.tableId && party && <button type="button" onClick={() => seatAt(party, p.tableId!)} className={BTN} style={{ background: INK, color: '#fff' }}>Seat</button>}
                </li>);
            })}
          </ul>}
        </section>

        <div className="min-w-0 space-y-5">
          {firestore && tenantId && readyToRun.length > 0 && <section className="rounded-3xl border bg-[#fff] p-4" style={{ borderColor: LINE }}><ReadyToRun tenantId={tenantId} list={readyToRun} /></section>}

          <section aria-labelledby="waiting" className="space-y-3">
            <div className="flex items-center justify-between"><h2 id="waiting" className="text-[17px] font-semibold">Waiting</h2><span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{waiting.length}</span></div>
            {waiting.length === 0 && <p className="rounded-2xl border border-dashed bg-[#fff] px-4 py-5 text-center text-[15px]" style={{ borderColor: LINE, color: MUTED }}>Nobody waiting.</p>}
            {waiting.map((p) => {
              const q = quoteWait(units, seatedGuests, seatedRows, { id: p.id, size: p.size, needs: p.needs }, { now, held, vocabulary: hs.vocabulary });
              const waited = minsSince(p.joinedAt); const texted = minsSince(p.notifiedAt);
              return (
                <article key={p.id} className="space-y-2 rounded-2xl bg-[#fff] p-4" style={{ border: selected === p.id ? `2px solid ${INK}` : `1px solid ${LINE}` }}>
                  <div className="flex items-baseline justify-between gap-3"><p className="text-[16px] font-semibold">{p.name}, {p.size}</p>{waited !== null && <span className="text-[13.5px] tabular-nums" style={{ color: MUTED }}>{waited} min</span>}</div>
                  <p className="text-[14px]" style={{ color: q.immediate ? GREEN : MUTED }}>{q.text}</p>
                  {p.status === 'notified' && <p className="text-[13.5px] font-medium" style={{ color: GREEN }}>Told it’s ready{texted !== null ? `, ${texted} min ago` : ''}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => pick(p.id)} aria-pressed={selected === p.id} className={`${BTN} flex-1`} style={{ background: INK, color: '#fff' }}>{selected === p.id ? 'Choosing…' : 'Seat'}</button>
                    {p.status === 'waiting' && !p.id.startsWith('walkin:') && <button type="button" onClick={() => notifyParty(p)} className={`${BTN} inline-flex items-center gap-2`} style={{ background: '#fff', border: `1px solid ${LINE}` }}><Bell className="h-4 w-4" aria-hidden />Text: ready</button>}
                  </div>
                </article>);
            })}
          </section>

          <section aria-labelledby="expected" className="space-y-3">
            <div className="flex items-center justify-between"><h2 id="expected" className="text-[17px] font-semibold">Booked, still to come</h2><span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{expected.length}</span></div>
            {expected.length === 0 && <p className="rounded-2xl border border-dashed bg-[#fff] px-4 py-5 text-center text-[15px]" style={{ borderColor: LINE, color: MUTED }}>Nothing else booked today.</p>}
            {expected.map((p) => {
              const late = lateVerdict(p, now, holdOpts);
              return (
                <article key={p.id} className="flex items-center gap-3 rounded-2xl bg-[#fff] p-3 pl-4" style={{ border: selected === p.id ? `2px solid ${INK}` : `1px solid ${LINE}` }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15.5px] font-semibold">{p.name}, {p.size}</p>
                    <p className="text-[13.5px]" style={{ color: late.holdReleased ? AMBER : late.late ? AMBER : MUTED, fontWeight: late.late ? 600 : 400 }}>{at12(p.arrivesAt)}{late.holdReleased ? `, ${late.minutesLate} min late. Their ${V.unit} isn’t held now` : late.late ? `, ${late.minutesLate} min late` : ''}</p>
                  </div>
                  <button type="button" onClick={() => pick(p.id)} aria-pressed={selected === p.id} className={BTN} style={{ background: '#fff', border: `1px solid ${LINE}` }}>{selected === p.id ? 'Choosing…' : 'Seat'}</button>
                </article>);
            })}
          </section>
        </div>
      </div>

      <Drawer accent={null} open={adding} onClose={() => setAdding(false)} title={`Add a ${V.party}`}>
        <form onSubmit={(e) => { e.preventDefault(); void addParty().then((ok) => { if (ok) setAdding(false); }); }} className="space-y-4" style={{ color: INK }}>
          <label className="block"><span className="text-[14px] font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className="mt-1.5 w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
          <div><span className="text-[14px] font-medium">How many</span>
            <div className="mt-1.5 flex items-center gap-3">
              <button type="button" aria-label="One fewer" onClick={() => setSize(String(Math.max(1, (Number(size) || 1) - 1)))} className={`${BTN} w-12 px-0 text-[20px]`} style={{ border: `1px solid ${LINE}` }}>−</button>
              <span className="w-10 text-center text-[20px] font-semibold tabular-nums" aria-live="polite">{Math.max(1, Number(size) || 1)}</span>
              <button type="button" aria-label="One more" onClick={() => setSize(String(Math.min(40, (Number(size) || 1) + 1)))} className={`${BTN} w-12 px-0 text-[20px]`} style={{ border: `1px solid ${LINE}` }}>+</button>
            </div></div>
          <label className="block"><span className="text-[14px] font-medium">Coming later? The time</span><span className="block text-[13px]" style={{ color: MUTED }}>Leave it empty for someone here now.</span>
            <input type="time" value={at} onChange={(e) => setAt(e.target.value)} className="mt-1.5 w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
          <label className="block"><span className="text-[14px] font-medium">Mobile number</span><span className="block text-[13px]" style={{ color: MUTED }}>So you can text them when their {V.unit} is ready.</span>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5 w-full min-h-[44px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
          <button type="submit" disabled={!name.trim() || !session} className={`${BTN} w-full`} style={{ background: INK, color: '#fff' }}>{at.trim() ? `Book for ${at.trim()}` : 'Add to the waiting list'}</button>
        </form>
      </Drawer>

      <Drawer accent={null} open={!!openTable && !!openParty} onClose={() => setTableFor(null)} title={openTable?.name || ''}>
        {openTable && openParty && <div className="space-y-4" style={{ color: INK }}>
          <div><p className="text-[18px] font-semibold">{openParty.name}, {openParty.size}</p>
            <p className="text-[14px]" style={{ color: MUTED }}>Seated {at12(openParty.seatedAt)}{minsSince(openParty.seatedAt) !== null ? `, ${minsSince(openParty.seatedAt)} min ago` : ''}</p></div>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => { setTabFor(openParty); setTableFor(null); }} className={`${BTN} w-full`} style={{ background: INK, color: '#fff' }}>Open their tab</button>
            <button type="button" onClick={() => { void finishParty(openParty); setTableFor(null); }} className={`${BTN} w-full`} style={{ background: '#fff', border: `1px solid ${LINE}` }}>They’ve left, free the {V.unit}</button>
          </div>
        </div>}
      </Drawer>
      <Drawer accent={null} open={!!tabFor} onClose={() => setTabFor(null)} title="Tab">
        {tabFor && firestore && tenantId ? <TableTab key={tabFor.id} firestore={firestore as any} tenantId={tenantId} party={tabFor} tableName={(tabFor.unitIds || []).map((u: string) => state.byTable[u]?.name || u).join(' + ') || 'Table'} by={String(user?.displayName || 'Host').slice(0, 60)} /> : null}
      </Drawer>
    </div>
  );
}
