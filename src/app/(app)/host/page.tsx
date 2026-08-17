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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Bell, Check, Plus, Sparkles, UserRound } from 'lucide-react';

const CHIP = 'h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest';

export default function HostScreen() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
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

  const addParty = async () => {
    if (!firestore || !tenantId || !session || !name.trim()) return;
    const isRes = /^\d{2}:\d{2}$/.test(at.trim());
    const arrives = isRes ? new Date(`${session.businessDay}T${at.trim()}:00`) : null;
    await addDoc(collection(firestore, `tenants/${tenantId}/parties`), {
      sessionId: session.id, name: name.trim(),
      size: Math.max(1, Math.floor(Number(size) || 1)), needs: [],
      source: isRes ? 'reservation' : 'walk_in',
      status: isRes ? 'expected' : 'waiting',
      arrivesAt: arrives ? arrives.toISOString() : null,
      joinedAt: isRes ? null : new Date().toISOString(),
      quotedMinutes: null, notifiedAt: null, seatedAt: null, finishedAt: null,
      turnMinutes: null, unitIds: [], guestIds: [],
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    });
    setName(''); setAt(''); setPhone('');
  };

  const seatAt = async (party: HostedParty, unitId: string, force = false) => {
    // Seating ANY mirrored row (walk-in, booth, event) materialises it as a
    // real party first — skipped if a prior touch already did (the dedupe
    // keys are the source ids carried in guestIds).
    if (/^(walkin|booth|event):/.test(party.id) && firestore && tenantId && session) {
      if (parties.some((x) => (x.guestIds || []).some((g) => (party.guestIds || []).includes(g)))) return;
      const { id: _drop, ...body } = party;
      const ref = await addDoc(collection(firestore, `tenants/${tenantId}/parties`), body);
      party = { ...party, id: ref.id };
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
  const sel = parties.find((p) => p.id === selected) || null;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4 text-left">
      <div>
        <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Module Operational</p>
        <h1 className="text-base font-black uppercase tracking-tighter text-slate-900">
          Host {session ? `· ${session.businessDay}` : ''}
        </h1>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 space-y-1">
          {alerts.map((a, i) => (
            <p key={i} className="flex items-start gap-2 text-[10px] font-black uppercase tracking-widest text-amber-800">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{a}
            </p>
          ))}
        </div>
      )}

      <div className="p-4 rounded-[2rem] border-2 bg-slate-50 border-slate-200 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[8rem]"><Input placeholder="Name" value={name} onChange={(e: any) => setName(e.target.value)} className="h-11 rounded-2xl border-2 font-bold bg-white" /></div>
        <div className="w-16"><Input inputMode="numeric" value={size} onChange={(e: any) => setSize(e.target.value)} className="h-11 rounded-2xl border-2 font-bold bg-white text-center" /></div>
        <div className="w-24"><Input placeholder="19:30?" value={at} onChange={(e: any) => setAt(e.target.value)} className="h-11 rounded-2xl border-2 font-bold bg-white text-center" /></div>
        <div className="w-32"><Input type="tel" inputMode="tel" placeholder="Phone?" value={phone} onChange={(e: any) => setPhone(e.target.value)} className="h-11 rounded-2xl border-2 font-bold bg-white text-center" /></div>
        <Button onClick={addParty} disabled={!name.trim() || !session} className={CHIP}><Plus className="w-4 h-4 mr-1" />{at.trim() ? 'Book' : 'Add'}</Button>
        <Button variant="outline" className={`${CHIP} border-2 bg-white`} onClick={importBookings} disabled={!session}>
          Import bookings
        </Button>
        <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground self-center">
          Booths{activeEvent ? ` + ${activeEvent.name || activeEvent.title || 'event'}` : ''} mirror in live
        </span>
        <Button variant="outline" className={`${CHIP} border-2 bg-white`}
          onClick={() => setProposals(autoSeatPlan(units, waiting.map((p) => ({ id: p.id, size: p.size, needs: p.needs })), seatedGuests, { held, vocabulary: hs.vocabulary }))}>
          <Sparkles className="w-4 h-4 mr-1" />Auto-seat
        </Button>
      </div>

      {proposals.length > 0 && (
        <div className="p-4 rounded-[2rem] border-2 border-primary/30 bg-primary/5 space-y-2">
          {proposals.map((p) => {
            const party = parties.find((x) => x.id === p.partyId);
            return (
              <div key={p.partyId} className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-800 min-w-0 truncate">
                  {party?.name} ({p.partySize}) → {p.tableId ? p.tableName : '—'} <span className="opacity-60 normal-case font-bold">{p.rationale}</span>
                </p>
                {p.tableId && party && (
                  <Button size="sm" className="rounded-xl font-black uppercase text-[9px]" onClick={() => seatAt(party, p.tableId!)}>
                    <Check className="w-3.5 h-3.5 mr-1" />Use
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Expected</p>
          {expected.length === 0 && <p className="text-xs text-muted-foreground ml-1">Nothing booked.</p>}
          {expected.map((p) => {
            const late = lateVerdict(p, now, holdOpts);
            return (
              <button key={p.id} onClick={() => setSelected(selected === p.id ? null : p.id)}
                className={`w-full p-3 rounded-2xl border-2 bg-white text-left ${selected === p.id ? 'border-primary' : 'border-slate-200'}`}>
                <p className="text-sm font-black uppercase tracking-tight">{p.name} · {p.size}</p>
                <p className={`text-[9px] font-black uppercase tracking-widest ${late.holdReleased ? 'text-red-600' : late.late ? 'text-amber-600' : 'text-muted-foreground'}`}>
                  {p.arrivesAt ? new Date(p.arrivesAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : ''}
                  {late.holdReleased ? ` · ${late.minutesLate}m late — hold released` : late.late ? ` · ${late.minutesLate}m late` : ''}
                </p>
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Waiting</p>
          {waiting.length === 0 && <p className="text-xs text-muted-foreground ml-1">Empty list.</p>}
          {waiting.map((p) => {
            const q = quoteWait(units, seatedGuests, seatedRows, { id: p.id, size: p.size, needs: p.needs }, { now, held, vocabulary: hs.vocabulary });
            return (
              <div key={p.id} className={`p-3 rounded-2xl border-2 bg-white ${selected === p.id ? 'border-primary' : 'border-slate-200'}`}>
                <button onClick={() => setSelected(selected === p.id ? null : p.id)} className="w-full text-left">
                  <p className="text-sm font-black uppercase tracking-tight flex items-center gap-1.5">
                    <UserRound className="w-3.5 h-3.5" />{p.name} · {p.size}{p.status === 'notified' ? ' · notified' : ''}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{q.text}</p>
                </button>
                {p.status === 'waiting' && !p.id.startsWith('walkin:') && (
                  <Button size="sm" variant="outline" className="mt-2 rounded-xl font-black uppercase text-[9px] border-2"
                    onClick={() => notifyParty(p)}>
                    <Bell className="w-3 h-3 mr-1" />Notify
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">
        {sel ? `Tap a ${V.unit} to seat ${sel.name}` : `The floor · ${state.totalSeated}/${state.totalCapacity} ${V.seats}`}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {state.tables.map((t) => {
          const hold = held[t.tableId];
          const holder = hold ? parties.find((p) => p.id === hold.partyId) : null;
          const tone = t.overfilled ? 'border-red-400 bg-red-50'
            : hold ? 'border-blue-300 bg-blue-50'
            : t.seated > 0 ? 'border-slate-300 bg-slate-100'
            : 'border-green-300 bg-green-50';
          return (
            <button key={t.tableId} disabled={!sel}
              onClick={() => sel && seatAt(sel, t.tableId, forceFor === `${sel.id}:${t.tableId}`)}
              className={`p-3 rounded-2xl border-2 text-left ${tone} ${sel ? 'active:scale-95' : ''}`}>
              <p className="text-sm font-black uppercase tracking-tight truncate">{t.name}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                {t.seated}/{t.capacity}{hold ? ` · held${holder ? ` · ${holder.name}` : ''}` : ''}
              </p>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Seated</p>
        {parties.filter((p) => p.status === 'seated').map((p) => (
          <div key={p.id} className="flex items-center justify-between p-3 rounded-2xl border-2 border-slate-200 bg-white">
            <p className="text-sm font-black uppercase tracking-tight">{p.name} · {p.size} · {p.unitIds?.map((u) => state.byTable[u]?.name || u).join(' + ')}</p>
            <Button size="sm" variant="outline" className="rounded-xl font-black uppercase text-[9px] border-2"
              onClick={() => finishParty(p)}>Done</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
