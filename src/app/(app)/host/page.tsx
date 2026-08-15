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
  addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, query, updateDoc, where,
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
  businessDayFor, freezeUnits, heldUnits, lateVerdict, sessionDecision,
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
    });
    setName(''); setAt('');
  };

  const seatAt = async (party: HostedParty, unitId: string, force = false) => {
    const verdict = canSeat(state, unitId, { id: party.id, size: party.size, needs: party.needs }, { held, vocabulary: hs.vocabulary, allowOverfill: force });
    if (!verdict.allowed) {
      toast({ variant: 'destructive', title: verdict.reason,
        description: `Tap the ${V.unit} again within 5s to seat anyway.` });
      setForceFor(`${party.id}:${unitId}`); setTimeout(() => setForceFor(null), 5000);
      return;
    }
    await write(party.id, { status: 'seated', seatedAt: new Date().toISOString(), unitIds: [unitId] });
    setSelected(null); setProposals([]);
  };
  const [forceFor, setForceFor] = useState<string | null>(null);

  const waiting = parties.filter((p) => ['waiting', 'notified'].includes(p.status))
    .sort((a, b) => String(a.joinedAt || '').localeCompare(String(b.joinedAt || '')));
  const expected = parties.filter((p) => p.status === 'expected')
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

      {/* Add a party — a time makes it a reservation */}
      <div className="p-4 rounded-[2rem] border-2 bg-slate-50 border-slate-200 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[8rem]"><Input placeholder="Name" value={name} onChange={(e: any) => setName(e.target.value)} className="h-11 rounded-2xl border-2 font-bold bg-white" /></div>
        <div className="w-16"><Input inputMode="numeric" value={size} onChange={(e: any) => setSize(e.target.value)} className="h-11 rounded-2xl border-2 font-bold bg-white text-center" /></div>
        <div className="w-24"><Input placeholder="19:30?" value={at} onChange={(e: any) => setAt(e.target.value)} className="h-11 rounded-2xl border-2 font-bold bg-white text-center" /></div>
        <Button onClick={addParty} disabled={!name.trim() || !session} className={CHIP}><Plus className="w-4 h-4 mr-1" />{at.trim() ? 'Book' : 'Add'}</Button>
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
        {/* Expected */}
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

        {/* Waiting */}
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
                {p.status === 'waiting' && (
                  <Button size="sm" variant="outline" className="mt-2 rounded-xl font-black uppercase text-[9px] border-2"
                    onClick={() => write(p.id, { status: 'notified', notifiedAt: new Date().toISOString() })}>
                    <Bell className="w-3 h-3 mr-1" />Notify
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* The floor */}
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

      {/* Seated — finish */}
      <div className="space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Seated</p>
        {parties.filter((p) => p.status === 'seated').map((p) => (
          <div key={p.id} className="flex items-center justify-between p-3 rounded-2xl border-2 border-slate-200 bg-white">
            <p className="text-sm font-black uppercase tracking-tight">{p.name} · {p.size} · {p.unitIds?.map((u) => state.byTable[u]?.name || u).join(' + ')}</p>
            <Button size="sm" variant="outline" className="rounded-xl font-black uppercase text-[9px] border-2"
              onClick={() => write(p.id, { status: 'finished', finishedAt: new Date().toISOString() })}>Done</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
