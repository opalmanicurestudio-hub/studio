'use client';
// src/components/pos/desk/DeskPOS.tsx — THE NEW FRONT DESK.
//
// Runs entirely on usePosEngine (the same state and actions as the classic
// POS) and reuses the classic POS's dialogs — check-in confirmation, provider
// review, "start early?", details, till, scan, quick book — so behaviour is
// identical. What's new is the layout: one guest model, four views
// (Timeline · Lanes · Stations · Mix), the business's tools deciding what shows,
// and checkout/selling in a side drawer.
//
//   Arriving   booked today, not checked in         → Check in (confirmation dialog)
//   Waiting    checked in / walk-in waiting          → Start  (walk-in without a provider → Assign)
//   In service with a provider                       → Finish (provider review → ready to pay)
//   Ready      ready for checkout                    → Check out (checkout drawer)

import { useInventory } from '@/context/InventoryContext';
import { Stations } from '@/components/pos/desk/Stations';
import { stationReadiness, needsAttention } from '@/lib/readiness';
import { CollectTuition } from '@/components/pos/desk/CollectTuition';
import { CollectRent } from '@/components/pos/desk/CollectRent';
import { OrderPickup } from '@/components/pos/desk/OrderPickup';
import { AddWalkIn } from '@/components/pos/desk/AddWalkIn';
import { openVisit, registerVisitActions } from '@/lib/visit-client';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useClientScreen, ClientScreenPanel } from '@/components/pos/ClientScreen';
import { TodaysSales } from '@/components/pos/desk/TodaysSales';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { LayoutGroup } from 'framer-motion';
import { format, isToday, parseISO } from 'date-fns';
import { moduleEnabled } from '@/lib/modules';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { DeskFrame, Btn, Seg, Pill, GuestCard, Empty, Panel, Drawer, Menu } from './kit';
import { doc } from 'firebase/firestore';
import { updateDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { collection } from 'firebase/firestore';
import { resourceDowntime } from '@/lib/availability';
import type { ReactNode } from 'react';
import { Counter } from './Counter';
import { DeskDelay } from './DeskDelay';
import { DeskReschedule } from './DeskReschedule';
import { DeskFollowUp } from './DeskFollowUp';
import { DeskCancel } from './DeskCancel';
import { DeskPayGate } from './DeskPayGate';
import { OpsBoard, opsAttentionCount } from '@/components/ops/OpsBoard';
import { OverrunPanel } from '@/components/ops/OverrunPanel';
import { placeOf, skipsCheckIn } from '@/lib/service-place';
import { usePendingCallbacks, overdueCallbacks } from '@/components/ops/CallbackQueue';
import { LogCallSheet, useOpenCalls, callsNeedingAttention } from '@/components/ops/CallLog';
import { serviceOverrun, overrunImpact, overrunMode } from '@/lib/appointment-ops';
import { opsStatus, paymentOutstanding } from '@/lib/appointment-ops';
import { resolvePolicy } from '@/lib/booking-policies';
import { query, where } from 'firebase/firestore';

type Stage = 'arriving' | 'waiting' | 'service' | 'ready' | 'done';
type View = 'timeline' | 'lanes' | 'stations' | 'mix';
type Guest = { awaitingDeposit?: boolean; key: string; kind: 'appt' | 'walkin'; appt?: any; walkIn?: any; name: string; service: string; staffId: string | null; staffName: string | null; at: Date | null; stage: Stage; lateMin: number };

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const STAGES: [Exclude<Stage, 'done'>, string][] = [['arriving', 'Arriving'], ['waiting', 'Waiting'], ['service', 'In service'], ['ready', 'Ready to pay']];
const VIEW_KEY = 'cf.desk.view';
const lateLabel = (m: number) => (m >= 90 ? `${Math.round(m / 60)} hr late` : `${m} min late`);

export function DeskPOS({ e, tools }: { e: any; tools?: { team?: ReactNode; waitlist?: ReactNode; spaces?: ReactNode } }) {
  const tenant = e.selectedTenant;
  const accent = tenant?.bookingPageSettings?.cfPageConfig?.accentColor || null;
  const staffList: any[] = (e.staff || []).filter((s: any) => s.isActive !== false && !s.isStudent);
  const solo = staffList.length <= 1;
  const recommended: View = solo ? 'timeline' : 'lanes';
  const [view, setView] = useState<View>(recommended);
  useEffect(() => { try { const v = localStorage.getItem(VIEW_KEY) as View | null; if (v && ['timeline', 'lanes', 'stations', 'mix'].includes(v)) setView(v); } catch { /* per-device memory is a nicety */ } }, []);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payFor, setPayFor] = useState<any>(null); // arrived — payment required
  // Operations lives here: today's cases that need attention (late, overdue, payment, provider delays, offers).
  const [attnOpen, setAttnOpen] = useState(false);
  useEffect(() => { try { if (new URLSearchParams(window.location.search).get('attention') === '1') setAttnOpen(true); } catch { /* ignore */ } }, []);
  const todaysAppts = useMemo(() => { const d = new Date().toDateString(); return (e.appointmentsFromInventory || []).filter((a: any) => { const t = toDate(a.startTime); return t && t.toDateString() === d; }); }, [e.appointmentsFromInventory]);
  const opsBase = opsAttentionCount(todaysAppts, e.selectedTenant);
  const callbacks = usePendingCallbacks(e.tenantId);                       // overdue call-backs count too
  const openCalls = useOpenCalls(e.tenantId);                              // urgent / overdue / unacknowledged calls count too
  const opsCount = { ...opsBase, attention: opsBase.attention + overdueCallbacks(callbacks) + callsNeedingAttention(openCalls.calls) };
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false); const [tuitionOpen, setTuitionOpen] = useState(false);
  const [stationsOpen, setStationsOpen] = useState(false);
  const { resources: allResources } = useInventory() as any;
  const [pickupOpen, setPickupOpen] = useState(false); const [pickupScan, setPickupScan] = useState<string | null>(null);
  useEffect(() => { const on = (ev: any) => { setPickupScan(String(ev?.detail?.value || '') || null); setPickupOpen(true); }; window.addEventListener('cf:order-pickup', on); return () => window.removeEventListener('cf:order-pickup', on); }, []);
  useBarcodeScanner((code) => e.handlePosScan?.(code), !!e.handlePosScan);
  useEffect(() => { const open = () => { setMode('desk'); setCheckoutOpen(true); }; window.addEventListener('cf:open-checkout', open); return () => window.removeEventListener('cf:open-checkout', open); }, []);
  const clientScreen = useClientScreen(e.tenantId);
  // The visit ticket can use the POS's own actions while you're here.
  const actRef = useRef<any>(null);
  actRef.current = {
    checkout: (id: string) => { if (!e.selectedAppointmentIds?.has?.(id)) e.handleSelectAppointment?.(id); setMode('desk'); setCheckoutOpen(true); },
    cancel: (id: string) => e.handleCancelAction?.(id, false),
    details: (id: string) => { const a = (e.appointmentsFromInventory || []).find((x: any) => x.id === id); if (a) { e.setSelectedAppointment(a); e.setIsDetailsOpen(true); } },
    bookNext: (_id: string, clientId?: string | null, serviceId?: string | null) => window.dispatchEvent(new CustomEvent('cf:resume-callback', { detail: { fromCheckout: true, snapshotKind: 'staff_book_sheet', snapshot: { clientId: clientId || undefined, serviceId: serviceId || undefined } } })),
  };
  useEffect(() => registerVisitActions({ checkout: (id) => actRef.current.checkout(id), cancel: (id) => actRef.current.cancel(id), details: (id) => actRef.current.details(id), bookNext: (id, c, sv) => actRef.current.bookNext(id, c, sv) }), []);
  // Opened from another page ("Take payment" on a ticket elsewhere) → /pos?checkout=<visit>
  useEffect(() => { try { const q = new URLSearchParams(window.location.search); const id = q.get('checkout'); const vid = q.get('visit');
    if (id) { const withTab = q.get('tab') === '1'; window.history.replaceState(null, '', window.location.pathname);
      // A table's tab (Host Stand → Check out): wait for the visit to load, then put it and its tab lines in checkout.
      let tries = 0; let t: any = null;
      const go = () => { const a = (e.appointmentsFromInventory || []).find((x: any) => x.id === id);
        if (!a && tries++ < 16) { t = setTimeout(go, 500); return; }
        if (withTab && a && Array.isArray(a.tab)) for (const l of a.tab) { const src = l.itemType === 'service' ? (e.services || []) : (e.inventory || []); const item = src.find((x: any) => x.id === l.itemId);
          if (item) for (let n = 0; n < Math.max(1, Number(l.quantity) || 1); n++) e.handleAddToCart?.(item); }
        actRef.current.checkout(id); };
      t = setTimeout(go, 600); return () => clearTimeout(t); }
    if (vid) { const t = setTimeout(() => openVisit(vid), 500); window.history.replaceState(null, '', window.location.pathname); return () => clearTimeout(t); } } catch { /* */ } }, []);
  const hadTill = useRef<boolean>(!!e.activeTill);   // closing the till → the client screen goes back to the logo
  useEffect(() => { if (hadTill.current && !e.activeTill && clientScreen.connected) clientScreen.ask('idle'); hadTill.current = !!e.activeTill; }, [e.activeTill]); // eslint-disable-line react-hooks/exhaustive-deps   // USB / Bluetooth scanners, anywhere on the desk
  const [overFor, setOverFor] = useState<any>(null); // a service running over → tell the next guests
  const [mode, setMode] = useState<'desk' | 'counter'>('desk');
  const [about, setAbout] = useState<Guest | null>(null);
  const [lateFor, setLateFor] = useState<Guest | null>(null);
  const [moveAppt, setMoveAppt] = useState<any | null>(null);
  const [followFor, setFollowFor] = useState<any | null>(null);
  // "Also today" — interviews and tours, each only if the business uses that tool.
  const hiringOn = moduleEnabled(tenant, 'team'), rentalsOn = moduleEnabled(tenant, 'booth_rental'), academyOn = moduleEnabled(tenant, 'academy');
  const ivQ = useMemoFirebase(() => (hiringOn && e.firestore && e.tenantId ? query(collection(e.firestore, 'tenants', e.tenantId, 'interviewInvites'), where('status', '==', 'accepted')) : null), [hiringOn, e.firestore, e.tenantId]);
  const toursQ = useMemoFirebase(() => ((rentalsOn || academyOn) && e.firestore && e.tenantId ? query(collection(e.firestore, 'tenants', e.tenantId, 'tours'), where('date', '==', format(new Date(), 'yyyy-MM-dd'))) : null), [rentalsOn, academyOn, e.firestore, e.tenantId]);
  const { data: interviews } = useCollection<any>(ivQ); const { data: tours } = useCollection<any>(toursQ);
  const [moreOpen, setMoreOpen] = useState(false); const [moreTab, setMoreTab] = useState<'team' | 'waitlist' | 'spaces'>('waitlist');
  // Maintenance & disruptions — only for businesses with the maintenance tool.
  const maintOn = moduleEnabled(tenant, 'maintenance');
  const ticketsQ = useMemoFirebase(() => (maintOn && e.firestore && e.tenantId ? collection(e.firestore, 'tenants', e.tenantId, 'tickets') : null), [maintOn, e.firestore, e.tenantId]);
  const plansQ = useMemoFirebase(() => (maintOn && e.firestore && e.tenantId ? collection(e.firestore, 'tenants', e.tenantId, 'maintenancePlans') : null), [maintOn, e.firestore, e.tenantId]);
  const interQ = useMemoFirebase(() => (e.firestore && e.tenantId ? collection(e.firestore, 'tenants', e.tenantId, 'interruptions') : null), [e.firestore, e.tenantId]);
  const { data: tickets } = useCollection<any>(ticketsQ); const { data: plans } = useCollection<any>(plansQ); const { data: interruptions } = useCollection<any>(interQ);
  const [todayOpen, setTodayOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem('cf.desk.today') === 'closed') setTodayOpen(false); } catch { /* ignore */ } }, []);
  const toggleToday = () => { const v = !todayOpen; setTodayOpen(v); try { localStorage.setItem('cf.desk.today', v ? 'open' : 'closed'); } catch { /* ignore */ } };
  const [assigning, setAssigning] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Exclude<Stage, 'done'>>('all');
  const [now, setNow] = useState(() => new Date());
  const stationRows = useMemo(() => stationReadiness(allResources || [], todaysAppts, e.services || [], now.getTime()), [allResources, todaysAppts, e.services, now]);   // the desk's clock keeps the count fresh
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  // Time-based text ("now", minutes late) is drawn in the browser only — the
  // server's clock and the browser's can differ by a minute (hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const retailOn = moduleEnabled(tenant, 'retail'), kioskOn = moduleEnabled(tenant, 'kiosk'), membershipsOn = moduleEnabled(tenant, 'memberships');
  const canSell = retailOn || membershipsOn;

  const svcName = (id: string) => (e.services || []).find((s: any) => s.id === id)?.name || '';
  const staffName = (id: string | null) => (id ? (e.staff || []).find((s: any) => s.id === id)?.name || null : null);

  // ── One guest model for every view ─────────────────────────────────────
  const guests: Guest[] = useMemo(() => {
    const out: Guest[] = [];
    // Only real guests: not calendar blocks, holds, placeholders or drafts, and
    // not expired/declined bookings. Requests awaiting approval are counted
    // separately (they aren't booked yet). Unpaid holds show until their deadline.
    const NOT_GUEST = ['cancelled', 'canceled', 'no_show', 'expired', 'declined', 'draft', 'held', 'requested', 'skipped'];
    const appts = (e.appointmentsFromInventory || []).filter((a: any) => {
      const d = toDate(a.startTime); if (!d || !isToday(d)) return false;
      if (a.isBlock || a.blockType || a.isHold || a.isPlaceholder || ['blocked', 'personal'].includes(String(a.type || ''))) return false;
      const st = String(a.status || ''); if (NOT_GUEST.includes(st)) return false;
      if ((st === 'pending_payment' || st === 'deposit_pending') && a.paymentDueAt && Date.parse(a.paymentDueAt) < now.getTime()) return false;
      return true;
    });
    const mirrors = new Set(appts.map((a: any) => a.id));
    // T3: walk-ins are visits from arrival. While they're still waiting, the queue entry leads (assign, skip, remove,
    // notify) with the visit attached; once service starts, the visit leads like any other.
    const PRE = ['waiting', 'notified', 'arrived', 'held'];   // held (called, didn't come up) stays out of sight, as before
    const rowOf = (a: any) => (a?.isWalkIn && a?.walkInId ? (e.walkIns || []).find((w: any) => w.id === a.walkInId) : null);
    const queued = (a: any) => { const w: any = rowOf(a); return !!w && PRE.includes(String(w.status || '')) && !['servicing', 'in_service', 'ready_for_checkout', 'completed'].includes(String(a.status || '')); };
    const apptById = new Map<string, any>(appts.map((a: any) => [a.id, a]));
    for (const a of appts) {
      if (queued(a)) continue;   // shown below as a walk-in, with this visit attached
      const st = String(a.status || ''), ci = String(a.checkInStatus || '');
      const stage: Stage = st === 'completed' ? 'done' : st === 'ready_for_checkout' ? 'ready' : st === 'servicing' || st === 'in_service' ? 'service' : ci === 'arrived' || st === 'waiting' ? 'waiting' : 'arriving';
      const at = toDate(a.startTime); const late = stage === 'arriving' && at ? Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000)) : 0;
      out.push({ awaitingDeposit: st === 'pending_payment' || st === 'deposit_pending', key: `a:${a.id}`, kind: 'appt', appt: a, name: a.clientName || 'Guest', service: svcName(a.serviceId) || a.serviceName || 'Service', staffId: a.staffId || null, staffName: staffName(a.staffId || null), at, stage, lateMin: ci === 'running_late' ? Math.max(late, 1) : late > 10 ? late : 0 });
    }
    for (const w of e.walkIns || []) {
      const st = String(w.status || '');
      const mirror = apptById.get(`apt-walkin-${w.id}`);
      if (!['waiting', 'notified', 'arrived', 'servicing', 'in_service'].includes(st) || (mirror && !queued(mirror))) continue;
      const wd = toDate(w.checkInTime || w.createdAt); if (!wd || !isToday(wd)) continue; // yesterday's walk-ins aren't here today
      const sid = w.staffId || w.assignedStaffId || null;
      out.push({ key: `w:${w.id}`, kind: 'walkin', walkIn: w, ...(mirror ? { appt: mirror } : {}), name: w.clientName || w.customerName || 'Walk-in', service: (w.serviceIds || []).map(svcName).filter(Boolean).join(' + ') || 'Walk-in', staffId: sid, staffName: staffName(sid), at: toDate(w.createdAt || w.checkInTime), stage: st === 'servicing' || st === 'in_service' ? 'service' : 'waiting', lateMin: 0 });
    }
    return out.sort((x, y) => (x.at?.getTime() || 0) - (y.at?.getTime() || 0));
  }, [e.appointmentsFromInventory, e.walkIns, e.services, e.staff, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = guests.filter((g) => g.stage !== 'done');
  const requests = (e.appointmentsFromInventory || []).filter((a: any) => a.status === 'requested').length;
  // ── At-a-glance facts ────────────────────────────────────────────────
  const staffOf = (id: string | null) => (id ? (e.staff || []).find((s: any) => s.id === id) : null);
  const minsOf = (g: Guest) => { const a = g.appt || {}; const svc = (e.services || []).find((x: any) => x.id === a.serviceId); const add = (a.addOnIds || []).map((id: string) => (e.services || []).find((x: any) => x.id === id)?.duration || 0).reduce((x: number, y: number) => x + y, 0);
    const end = toDate(a.endTime), st = toDate(a.startTime); return Number(svc?.duration || 0) + add || (end && st ? Math.round((end.getTime() - st.getTime()) / 60000) : 60); };
  const startedAt = (g: Guest) => toDate(g.appt?.actualStartTime || g.appt?.serviceStartTime || g.walkIn?.serviceStartTime);
  const arrivedAt = (g: Guest) => toDate(g.appt?.checkInStatusTimestamp || g.walkIn?.checkInTime || g.walkIn?.createdAt);
  const endsAt = (g: Guest) => { const s0 = startedAt(g); return s0 ? new Date(s0.getTime() + minsOf(g) * 60000) : null; };
  /** When each provider is next free: now, or when their current guest finishes. */
  const freeAt = (sid: string): Date | null => { const cur = active.filter((g) => g.staffId === sid && g.stage === 'service').map(endsAt).filter(Boolean) as Date[]; return cur.length ? new Date(Math.max(...cur.map((d) => d.getTime()))) : null; };
  const estWait = () => { const t = staffList.map((s) => freeAt(s.id)); if (t.some((x) => !x)) return 0; const soonest = Math.min(...(t as Date[]).map((d) => d.getTime())); return Math.max(0, Math.round((soonest - now.getTime()) / 60000)); };
  const flagsFor = (g: Guest) => {
    const a = g.appt || {}; const c = (e.clients || []).find((x: any) => x.id === (a.clientId || g.walkIn?.clientId));
    const visits = c ? (e.appointmentsFromInventory || []).filter((x: any) => x.clientId === c.id && x.status === 'completed').length : 0;
    const bd = c?.birthday ? String(c.birthday).slice(5, 10) : null; const soon = bd ? [0, 1, 2, 3, 4, 5, 6].some((i) => { const d = new Date(now.getTime() + i * 864e5); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === bd; }) : false;
    const out: [string, 'soft' | 'warn' | 'ok' | 'accent'][] = [];
    // What the client told us from their visit link — first, while they're on their way.
    if (g.stage === 'arriving' || g.stage === 'waiting') {
      // The shared real-time status (same words as the planner, portal and Operations).
      const ops = opsStatus(a, now, { graceMinutes: Number(resolvePolicy(e.selectedTenant).late.graceMinutes.value) || 0 });
      if (!['on_time', 'finished', 'in_service', 'checked_in', 'payment_required'].includes(ops.status)) out.push([ops.label, ops.tone === 'alert' || ops.tone === 'warn' ? 'warn' : ops.tone === 'info' ? 'soft' : 'ok']);
    }
    if (g.stage === 'service' && g.appt) {
      const ov = serviceOverrun(g.appt, minsOf(g), now);
      if (ov && ov.overMin >= 1) { const hit = overrunImpact(todaysAppts, g.appt, Math.max(10, ov.overMin), now)[0];
        if (hit) out.push([`Running over · affects ${String(hit.appt.clientName || 'next guest').split(' ')[0]} ${format(new Date(hit.appt.startTime), 'h:mm')}`, 'warn']); }
    }
    if (!c || visits === 0) out.push(['New client', 'accent']);
    if (a.completionStatus && a.completionStatus !== 'completed') out.push(['Forms not done', 'warn']);
    if ((c?.unpaidFees || []).length) out.push(['Owes', 'warn']);
    if (c?.activeMembershipId) out.push(['Member', 'ok']);
    if (a.sensoryNeeds || a.notes || c?.alertNote) out.push(['Note', 'soft']);
    if ((a.inspirationPhotos || []).length || a.inspirationPhotoUrl) out.push(['Photos', 'soft']);
    if (soon) out.push(['Birthday this week', 'accent']);
    return out;
  };
  // Automatic mode (Booking policies): once a service is 10+ min over and a later guest is affected, tell them — once.
  const autoSent = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (overrunMode(e.selectedTenant) !== 'auto' || !e.tenantId) return;
    for (const a of todaysAppts) {
      const ov = serviceOverrun(a, minsOf({ appt: a } as any), now);
      if (!ov || ov.overMin < 10 || a.overrunNotifiedAt || autoSent.current.has(a.id) || !overrunImpact(todaysAppts, a, 10, now).length) continue;
      autoSent.current.add(a.id);
      (async () => { const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
        await fetch('/api/appointments/provider-late', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
          body: JSON.stringify({ tenantId: e.tenantId, staffId: a.staffId, minutes: 10, reason: 'overrun', inServiceId: a.id }) }).catch(() => {}); })();
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const timerFor = (g: Guest): { text: string; tone?: 'warn'; sub?: string } | null => {
    if (g.stage === 'arriving' && g.at) { const m = Math.round((g.at.getTime() - now.getTime()) / 60000); return m > 0 ? { text: m < 90 ? `in ${m} min` : `at ${format(g.at, 'h:mm a')}` } : g.lateMin ? { text: lateLabel(g.lateMin), tone: 'warn' } : { text: 'due now' }; }
    if (g.stage === 'waiting') { const a0 = arrivedAt(g); const w = a0 ? Math.max(0, Math.round((now.getTime() - a0.getTime()) / 60000)) : null; if (g.kind === 'walkin' && !g.staffId) return { text: w !== null ? `waiting ${w} min` : 'waiting', tone: w !== null && w > 15 ? 'warn' : undefined, sub: (() => { const est = estWait(); return est ? `About ${est} min until someone’s free` : 'Someone’s free now'; })() }; return w !== null ? { text: `waiting ${w} min`, tone: w > 15 ? 'warn' : undefined } : null; }
    if (g.stage === 'service') { const s0 = startedAt(g); const tot = minsOf(g); if (!s0) return { text: `${tot} min` }; const done = Math.round((now.getTime() - s0.getTime()) / 60000); const e0 = endsAt(g)!; return { text: done > tot ? `${done - tot} min over` : `done ~${format(e0, 'h:mm')}`, tone: done > tot + 5 ? 'warn' : undefined }; }
    if (g.stage === 'ready') { const r = toDate(g.appt?.actualEndTime); return r ? { text: `ready ${Math.max(0, Math.round((now.getTime() - r.getTime()) / 60000))} min` } : { text: 'ready to pay' }; }
    return null;
  };
  // Stations/rooms out of service today (same rule the booking engine uses) + business disruptions.
  const todayStr = format(now, 'yyyy-MM-dd');
  const down = maintOn ? resourceDowntime(todayStr, tickets || [], plans || []) : {};
  const outages = Object.entries(down).map(([rid, why]) => { const r = (e.resources || []).find((x: any) => x.id === rid); const affected = active.filter((g) => (g.appt?.requiredResourceIds || []).includes(rid) || g.appt?.resourceId === rid).length; return { rid, name: r?.name || 'A station', why: String(why).replace(/\s+/g, ' '), affected }; });
  const disruptions = (interruptions || []).filter((r: any) => r.status !== 'resolved' && r.status !== 'closed' && String(r.startDate || '').slice(0, 10) <= todayStr && (!r.endDate || String(r.endDate).slice(0, 10) >= todayStr));
  const moreTabs = ([['waitlist', 'Waitlist', tools?.waitlist], ['team', 'Team', !solo && moduleEnabled(tenant, 'team') ? tools?.team : null], ['spaces', 'Spaces', moduleEnabled(tenant, 'booth_rental') ? tools?.spaces : null]] as [string, string, ReactNode][]).filter(([, , n]) => !!n);
  const doneCount = guests.length - active.length;
  const takings = useMemo(() => (e.transactions || []).filter((t: any) => t.type === 'income' && !t.voided && toDate(t.date) && isToday(toDate(t.date)!)).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0), [e.transactions]);
  const next = active.find((g) => g.stage === 'arriving');
  // "Today" — everyone, booked and walk-in (the classic tiles counted walk-ins only).
  const today = useMemo(() => {
    const waits: number[] = [];
    for (const g of guests) {
      const a = g.appt; if (!a) continue;
      const arrived = toDate(a.checkInStatusTimestamp), started = toDate(a.actualStartTime || a.serviceStartTime);
      if (arrived && started && started > arrived) waits.push((started.getTime() - arrived.getTime()) / 60000);
    }
    const walk = e.kpiData?.avgWaitTime || 0; const walkN = (e.walkIns || []).filter((w: any) => w.serviceStartTime && toDate(w.checkInTime) && isToday(toDate(w.checkInTime)!)).length;
    const all = [...waits, ...Array(walkN).fill(walk)];
    const avgWait = all.length ? all.reduce((x, y) => x + y, 0) / all.length : null;
    return { avgWait, avgTicket: doneCount ? takings / doneCount : null, walkinsServed: e.kpiData?.totalWalkIns ? Math.round(e.kpiData.conversionRate) : null };
  }, [guests, e.kpiData, e.walkIns, doneCount, takings]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions: the classic POS's own ─────────────────────────────────────
  const open = (g: Guest) => { if (g.appt?.id) { openVisit(g.appt.id); return; }   // any visit record (booked, or a walk-in once it has one) opens its ticket
    if (g.appt) { e.setSelectedAppointment(g.appt); e.setIsDetailsOpen(true); } };   // a booked visit opens its ticket
  const checkIn = (g: Guest) => e.setPendingCheckInItem(g.appt);
  const start = (g: Guest) => e.handleStartService(g.kind === 'appt' ? g.appt.id : g.walkIn.id);
  const finish = (g: Guest) => { e.setAppointmentToReview(g.appt); e.setIsTechnicianReviewOpen(true); };
  const checkout = (g: Guest) => { if (!e.selectedAppointmentIds?.has?.(g.appt.id)) e.handleSelectAppointment(g.appt.id); setCheckoutOpen(true); };
  const assign = (g: Guest, staffId: string) => { e.handleAssignStaff(g.walkIn, staffId); setAssigning(null); };

  const actionFor = (g: Guest) => {
    if (g.stage === 'arriving') {
      // Video, phone and at-home visits never arrive at your door — start them directly.
      if (g.kind === 'appt' && skipsCheckIn(placeOf((e.services || []).find((x: any) => x.id === g.appt?.serviceId), g.appt).kind)) return <Btn quiet onClick={() => start(g)}>Start</Btn>;
      return <Btn quiet onClick={() => checkIn(g)}>Check in</Btn>;
    }
    if (g.stage === 'waiting') {
      if (g.kind === 'walkin' && !g.staffId) return assigning === g.key
        ? <div className="flex flex-wrap justify-end gap-1">{staffList.map((s) => <Btn key={s.id} quiet onClick={() => assign(g, s.id)}>{String(s.name).split(' ')[0]}</Btn>)}<Btn quiet onClick={() => setAssigning(null)} label="Cancel">✕</Btn></div>
        : <Btn quiet onClick={() => setAssigning(g.key)}>Assign</Btn>;
      if (g.kind === 'appt' && paymentOutstanding(g.appt)) return <Btn onClick={() => setPayFor(g.appt)}>Payment required</Btn>;
      return <Btn quiet onClick={() => start(g)}>Start</Btn>;
    }
    if (g.stage === 'service') return g.appt ? <Btn quiet onClick={() => finish(g)}>Finish</Btn> : null;
    if (g.stage === 'ready') return <Btn onClick={() => checkout(g)}>Check out</Btn>;
    return null;
  };
  const phoneOf = (g: Guest) => { const c = (e.clients || []).find((x: any) => x.id === (g.appt?.clientId || g.walkIn?.clientId)); return (c?.phone || g.walkIn?.phone || g.appt?.clientPhone || '').replace(/[^\d+]/g, ''); };
  const setWalkIn = (g: Guest, patch: any) => { if (e.firestore && e.tenantId) updateDocumentNonBlocking(doc(e.firestore, 'tenants', e.tenantId, 'walkIns', g.walkIn.id), patch); };
  const menuFor = (g: Guest) => { const ph = phoneOf(g); const aboutItem = { label: 'About this entry…', hint: 'What it is, where it came from — and remove it', onSelect: () => setAbout(g) }; return g.kind === 'appt' ? [
      aboutItem,
      g.stage === 'service' && g.appt && (serviceOverrun(g.appt, minsOf(g), now)?.overMin || 0) >= 1 && { label: 'Running over — tell next guests…', hint: 'See who’s affected and what they’ll be told', onSelect: () => setOverFor(g) },
      (g.stage === 'service' || g.stage === 'ready') && { label: 'Book next visit…', hint: 'Same service & time — 2, 4, 6 or 8 weeks on', onSelect: () => setFollowFor(g.appt) },
      g.stage !== 'service' && g.stage !== 'ready' && { label: 'Reschedule…', onSelect: () => setMoveAppt(g.appt) },
      { label: 'Details', onSelect: () => open(g) },
      (() => { const pl = placeOf((e.services || []).find((x: any) => x.id === g.appt?.serviceId), g.appt);   // online visit → join from here
        return pl.meetingLink ? { label: 'Join the call', hint: pl.ownLink ? 'This booking’s own link' : 'The service’s shared link', onSelect: () => { window.open(pl.meetingLink!, '_blank', 'noopener'); } } : null; })(),
      g.stage === 'waiting' && g.appt?.studioAskedToMove && { label: 'Decide — arrived after reschedule offer…', hint: 'Keep it, shorten it, switch or reschedule — they’re told', onSelect: () => setLateFor(g) },
      g.stage === 'arriving' && { label: 'Running late…', hint: 'See what it affects and choose — nothing is charged automatically', onSelect: () => setLateFor(g) },
      ph && { label: 'Call', onSelect: () => { window.location.href = `tel:${ph}`; } },
      ph && { label: 'Text', onSelect: () => { window.location.href = `sms:${ph}`; } },
      (g.stage === 'arriving' || g.stage === 'waiting') && { label: 'Cancel or no-show…', tone: 'danger' as const, onSelect: () => e.handleCancelAction(g.appt.id, false) },
    ] : [
      aboutItem,
      ph && { label: 'Text', onSelect: () => { window.location.href = `sms:${ph}`; } },
      { label: 'Skip for now', hint: 'Leaves the queue; they can be returned later', onSelect: () => setWalkIn(g, { status: 'skipped' }) },
      { label: 'Remove from the queue…', tone: 'danger' as const, onSelect: () => e.handleCancelAction(g.walkIn.id, true) },
    ]; };
  const Face = ({ sid, size = 22 }: { sid: string | null; size?: number }) => { const s0 = staffOf(sid); if (!s0) return <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px]" style={{ width: size, height: size, background: 'var(--soft)', color: 'var(--muted)' }}>?</span>;
    return s0.avatarUrl || s0.photoUrl ? <img src={s0.avatarUrl || s0.photoUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} /> : <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ width: size, height: size, background: 'var(--soft)' }}>{String(s0.name || '?').charAt(0)}</span>; };
  const card = (g: Guest, compact = false, hideTime = false) => { const tm = timerFor(g); const fl = flagsFor(g); return (
    <GuestCard key={g.key} id={g.key} compact={compact} name={g.name} onOpen={() => open(g)}
      line={<span className="inline-flex max-w-full items-center gap-1.5"><Face sid={g.staffId} size={18} /><span className="truncate">{g.service}{g.staffName ? ` · ${String(g.staffName).split(' ')[0]}` : g.kind === 'walkin' ? ' · anyone' : ''}</span></span>}
      time={tm ? tm.text : (!hideTime && g.at ? format(g.at, 'h:mm a') : undefined)} timeTone={tm?.tone}
      progress={g.stage === 'service' && startedAt(g) ? (now.getTime() - startedAt(g)!.getTime()) / 60000 / Math.max(1, minsOf(g)) : null}
      meta={tm?.sub}
      flags={[...(g.kind === 'walkin' ? [{ label: 'Walk-in' }] : []), ...(g.awaitingDeposit ? [{ label: 'Awaiting deposit', tone: 'warn' as const }] : []), ...fl.map(([label, tone]) => ({ label, tone }))]}
      badge={<Menu items={menuFor(g)} label={`More for ${g.name}`} />} action={actionFor(g)} />
  ); };

  // ── Views ──────────────────────────────────────────────────────────────
  const timeline = (
    <div className="space-y-3">
      <Seg label="Show" value={filter} onChange={setFilter} options={[['all', 'Everyone'], ['arriving', 'Arriving'], ['waiting', 'Waiting'], ['service', 'In service'], ['ready', 'Ready to pay']]} />
      {(() => {
        const list = active.filter((g) => filter === 'all' || g.stage === filter); if (!list.length) return <Empty>{filter === 'all' ? 'No one else today — a quiet moment.' : 'No one here right now.'}</Empty>;
        let placed = false;
        return <div className="space-y-2">{list.map((g) => { const showNow = !placed && g.at && g.at > now && g.stage === 'arriving'; if (showNow) placed = true;
          return <div key={g.key}>{showNow && <div className="my-2 flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--accent)' }}><span>now · {format(now, 'h:mm a')}</span><span className="h-0.5 flex-1 rounded" style={{ background: 'var(--accent)' }} /></div>}
            <div className="flex items-start gap-3"><span className="w-16 shrink-0 pt-3.5 text-right text-[12px]" style={{ color: 'var(--muted)' }}>{g.at ? format(g.at, 'h:mm a') : ''}</span><div className="min-w-0 flex-1">{card(g, false, true)}</div></div></div>; })}</div>;
      })()}
    </div>
  );
  const lanes = (
    <div className="grid snap-x grid-flow-col gap-3 overflow-x-auto pb-2 lg:grid-flow-row lg:grid-cols-4" style={{ gridAutoColumns: 'minmax(240px, 1fr)' }}>
      {STAGES.map(([k, l]) => { const list = active.filter((g) => g.stage === k); return <Panel key={k} title={l} count={list.length} className="min-h-[320px] snap-start">{list.length ? list.map((g) => card(g, true)) : <Empty>No one here</Empty>}</Panel>; })}
    </div>
  );
  const stations = (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{staffList.map((s) => {
        const withThem = active.filter((g) => g.staffId === s.id && (g.stage === 'service' || g.stage === 'ready')).sort((a, b) => (a.stage === 'service' ? -1 : 1) - (b.stage === 'service' ? -1 : 1));
        const cur = withThem[0];
        const nxt = active.filter((g) => g.staffId === s.id && (g.stage === 'waiting' || g.stage === 'arriving'))[0];
        const seat = !cur ? (active.find((g) => g.kind === 'walkin' && g.stage === 'waiting' && !g.staffId) || null) : null;
        return (
          <section key={s.id} aria-label={s.name} className="space-y-3 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
            <header className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>{String(s.name || '?').charAt(0)}</span>
              <div className="min-w-0"><p className="truncate font-semibold">{s.name}</p><p className="text-[12px]" style={{ color: 'var(--muted)' }}>{cur ? (cur.stage === 'service' ? 'With a guest' : 'Ready to pay') : 'Free now'}</p></div></header>
            {cur ? <div className="space-y-2">{withThem.map((g) => card(g, true))}</div> : <div className="rounded-2xl p-4 text-center text-[13px]" style={{ border: '2px dashed var(--line)', color: 'var(--muted)' }}>Free now{seat && <div className="mt-2"><Btn onClick={() => assign(seat, s.id)}>Seat {seat.name.split(' ')[0]}</Btn></div>}</div>}
            <p className="border-t pt-2 text-[13px]" style={{ borderColor: 'var(--line)' }}>{nxt ? <>Next: <b>{nxt.name}</b>{nxt.at ? ` · ${format(nxt.at, 'h:mm a')}` : ''}</> : <span style={{ color: 'var(--muted)' }}>Nothing else booked today</span>}</p>
          </section>
        );
      })}</div>
      {(() => { const waiting = active.filter((g) => g.stage === 'arriving' || (g.stage === 'waiting' && !g.staffId)); return waiting.length > 0 && <Panel title="Arriving & unassigned" count={waiting.length}><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{waiting.map((g) => card(g, true))}</div></Panel>; })()}
    </div>
  );

  const views: [View, string][] = solo ? [['timeline', 'Timeline'], ['lanes', 'Lanes']] : [['timeline', 'Timeline'], ['lanes', 'Lanes'], ['stations', 'Stations'], ['mix', 'Mix']];
  const shown: View = solo && (view === 'stations' || view === 'mix') ? 'timeline' : view;
  const readyIds: string[] = Array.from(e.selectedAppointmentIds || []);

  if (!mounted) return <DeskFrame accent={accent}><div className="p-8 text-[14px]" style={{ color: 'var(--muted)' }}>Opening the front desk…</div></DeskFrame>;

  return (
    <DeskFrame accent={accent}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 md:px-8">
        <div><p className="text-[22px] font-light tracking-tight">Front desk <span style={{ color: 'var(--muted)' }}>· {format(now, 'h:mm a')}</span></p>
          <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{active.length} today{doneCount ? ` · ${doneCount} done` : ''} · ${Math.round(takings)} taken{next ? ` · next: ${next.name.split(' ')[0]} at ${next.at ? format(next.at, 'h:mm a') : '—'}` : ''}{requests > 0 && <> · <a href="/appointments/requests" className="font-semibold underline underline-offset-2" style={{ color: 'var(--accent)' }}>{requests} request{requests === 1 ? '' : 's'} to answer</a></>}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="Mode" value={mode} onChange={setMode} options={[['desk', 'Desk'], ['counter', 'Counter']]} />
          {mode === 'desk' && <Seg label="View" value={shown} onChange={pickView} options={views.map(([k, l]) => [k, k === recommended ? `${l} ★` : l]) as [View, string][]} />}
          {kioskOn && <Btn quiet onClick={() => e.setIsScanLookupOpen?.(true)}>Scan / find</Btn>}
          <Btn quiet onClick={() => e.setIsQuickBookOpen(true)}>Book</Btn>
          <Btn quiet onClick={() => setLogCallOpen(true)}>Log a call</Btn>
          <Btn quiet onClick={() => setWalkInOpen(true)}>+ Walk-in</Btn>
          {(allResources || []).length > 0 && <Btn quiet onClick={() => setStationsOpen(true)}>Stations{needsAttention(stationRows) ? ` · ${needsAttention(stationRows)}` : ''}</Btn>}
          {retailOn && <Btn quiet onClick={() => { setPickupScan(null); setPickupOpen(true); }}>Pickups</Btn>}
          {moduleEnabled(tenant, 'booth_rental') && <Btn quiet onClick={() => setRentOpen(true)}>Collect rent</Btn>}
          {moduleEnabled(tenant, 'academy') && <Btn quiet onClick={() => setTuitionOpen(true)}>Tuition</Btn>}
          <Btn quiet onClick={() => setSalesOpen(true)}>Today’s sales</Btn>
          <Btn quiet onClick={() => setScreenOpen(true)}><span aria-hidden style={{ color: clientScreen.connected ? (clientScreen.online ? 'var(--ok)' : 'var(--warn)') : 'var(--muted)' }}>●</span> Client screen</Btn>
          <Btn quiet={!opsCount.attention} onClick={() => setAttnOpen(true)}>{opsCount.decisions ? `Needs a decision · ${opsCount.decisions}` : `Needs attention${opsCount.attention ? ` · ${opsCount.attention}` : ''}`}</Btn>
          {mode === 'desk' && readyIds.length > 0 && <Btn onClick={() => setCheckoutOpen(true)}>Checkout · {readyIds.length}</Btn>}
          <Btn quiet onClick={() => e.setIsTillManagementOpen(true)}>Till</Btn>
          {moreTabs.length > 0 && <Btn quiet onClick={() => setMoreOpen(true)}>More</Btn>}
        </div>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 md:px-8">
        {mode === 'desk' && <section aria-label="Today" className="mb-4">
          <button type="button" onClick={toggleToday} aria-expanded={todayOpen} className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>Today {todayOpen ? '▴' : '▾'}</button>
          {todayOpen && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{([
            ['Taken today', `$${Math.round(takings).toLocaleString()}`],
            ['Guests', `${doneCount} of ${guests.length} done`],
            ['Average wait', today.avgWait === null ? '—' : `${Math.round(today.avgWait)} min`],
            ['Average ticket', today.avgTicket === null ? '—' : `$${Math.round(today.avgTicket)}`],
            ['Walk-ins served', today.walkinsServed === null ? '—' : `${today.walkinsServed}%`],
          ] as [string, string][]).map(([l, v]) => <div key={l} className="rounded-2xl px-4 py-3" style={{ background: 'var(--card)' }}><p className="text-[12px]" style={{ color: 'var(--muted)' }}>{l}</p><p className="text-[20px] font-light tracking-tight">{v}</p></div>)}</div>}
        </section>}
        {mode === 'desk' && (outages.length > 0 || disruptions.length > 0) && <section aria-label="Disruptions" className="mb-4 space-y-2 rounded-3xl p-4" style={{ background: 'color-mix(in srgb, var(--warn) 9%, var(--card))' }}>
          <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>Heads up today</p>
          {disruptions.map((d: any) => <p key={d.id} className="text-[14px]"><b>{String(d.type || 'Disruption').replace(/_/g, ' ')}</b>{d.title || d.reason ? ` — ${d.title || d.reason}` : ''}{d.endDate ? ` · until ${String(d.endDate).slice(0, 10)}` : ''}</p>)}
          {outages.map((o) => <p key={o.rid} className="text-[14px]"><b>{o.name}</b> — {o.why}{o.affected ? <> · <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{o.affected} booking{o.affected === 1 ? '' : 's'} today use it</span></> : ' · nothing booked on it today'}</p>)}
          {maintOn && <a href="/maintenance" className="inline-block text-[13px] underline underline-offset-2">Open maintenance</a>}
        </section>}
        {mode === 'desk' && !solo && <section aria-label="Team now" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">{staffList.map((s) => { const busy = active.filter((g) => g.staffId === s.id && g.stage === 'service'); const f = freeAt(s.id); const nx = active.filter((g) => g.staffId === s.id && (g.stage === 'arriving' || g.stage === 'waiting'))[0];
          return <div key={s.id} className="flex shrink-0 items-center gap-2.5 rounded-2xl py-2 pl-2 pr-4" style={{ background: 'var(--card)' }}><Face sid={s.id} size={34} /><div className="text-[12px] leading-tight"><p className="text-[13px] font-semibold">{String(s.name).split(' ')[0]}</p>
            <p style={{ color: busy.length ? 'var(--ink)' : 'var(--ok)' }}>{busy.length ? `${busy.length > 1 ? `${busy.length} guests at once · ` : ''}free ~${f ? format(f, 'h:mm') : '—'}` : 'Free now'}</p>{nx?.at && <p style={{ color: 'var(--muted)' }}>next {format(nx.at, 'h:mm')}</p>}</div></div>; })}</section>}
        {mode === 'counter' ? <Counter e={e} onFollowUp={(v: any) => setFollowFor(v)} /> : <LayoutGroup>
          {shown === 'timeline' && timeline}
          {shown === 'lanes' && lanes}
          {shown === 'stations' && stations}
          {shown === 'mix' && <div className="space-y-6">{stations}<div><p className="mb-2 text-[14px] font-semibold">The day</p>{timeline}</div></div>}
        </LayoutGroup>}
        {mode === 'desk' && (() => {
          const items = [
            ...((interviews || []).filter((iv: any) => { const d = toDate(iv.chosenSlot); return d && isToday(d); }).map((iv: any) => ({ id: `iv-${iv.id}`, at: toDate(iv.chosenSlot)!, kind: 'Interview', who: iv.applicantName || iv.name || 'Applicant', what: iv.listingTitle || iv.roleTitle || iv.role || 'Job interview', href: '/applicants', phone: iv.applicantPhone || iv.phone || '' }))),
            ...((tours || []).filter((t: any) => !['cancelled', 'canceled', 'declined'].includes(String(t.status)) && (t.purpose === 'school' ? academyOn : rentalsOn)).map((t: any) => ({ id: `t-${t.id}`, at: new Date(`${t.date}T${t.time || '00:00'}`), kind: t.purpose === 'school' ? 'Academy tour' : 'Rental tour', who: t.name || 'Visitor', what: t.status === 'requested' ? 'Requested — needs confirming' : `${t.durationMins || 30} min visit`, href: t.purpose === 'school' ? '/academy?section=admissions' : '/pipeline', phone: t.phone || '' }))),
          ].sort((a, b) => a.at.getTime() - b.at.getTime());
          return items.length > 0 && <section aria-label="Also today" className="mt-6"><p className="mb-2 text-[14px] font-semibold">Also today</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{items.map((x) => <div key={x.id} className="flex items-center justify-between gap-3 rounded-2xl p-3" style={{ background: 'var(--card)' }}>
              <a href={x.href} className="min-w-0"><p className="truncate text-[14px] font-semibold">{x.who} <Pill tone="accent">{x.kind}</Pill></p><p className="truncate text-[12px]" style={{ color: 'var(--muted)' }}>{format(x.at, 'h:mm a')} · {x.what}</p></a>
              {x.phone && <Btn quiet onClick={() => { window.location.href = `tel:${String(x.phone).replace(/[^\d+]/g, '')}`; }}>Call</Btn>}</div>)}</div></section>;
        })()}
        {mode === 'desk' && <p className="mt-6 text-center text-[12px]" style={{ color: 'var(--muted)' }}>★ recommended for {solo ? 'a solo business' : 'your team'} · this device remembers your view</p>}
      </main>
      <DeskDelay e={e} appt={lateFor?.appt || null} accent={accent} onClose={() => setLateFor(null)} onReschedule={(a) => setMoveAppt(a)} />
      <DeskReschedule e={e} appt={moveAppt} accent={accent} onClose={() => setMoveAppt(null)} />
      <DeskFollowUp e={e} visit={followFor} accent={accent} onClose={() => setFollowFor(null)} />
      <DeskPayGate e={e} appt={payFor} accent={accent} onClose={() => setPayFor(null)} />
      <Drawer accent={accent} open={!!overFor} onClose={() => setOverFor(null)} title="Running over">
        {overFor && (() => { const ov = serviceOverrun(overFor.appt, minsOf(overFor), now); return <OverrunPanel tenant={e.selectedTenant} tenantId={e.tenantId} role={e.role} inService={overFor.appt} today={todaysAppts} overMin={ov?.overMin || 0} plannedEnd={ov?.plannedEnd || null} providerName={staffName(overFor.appt.staffId || null)} />; })()}
      </Drawer>
      <TodaysSales open={salesOpen} onClose={() => setSalesOpen(false)} tenantId={e.tenantId} tenant={e.selectedTenant} transactions={e.transactions || []} staff={e.staff || []} role={(e as any).role || null} />
      <LogCallSheet open={logCallOpen} onClose={() => setLogCallOpen(false)} tenantId={e.tenantId} tenant={e.selectedTenant} clients={e.clients || []} staff={e.staff || []} appointments={e.appointmentsFromInventory || []} uid={e.currentUser?.uid || null} />
      <Drawer accent={accent} open={!!e.variantChoice} onClose={() => e.setVariantChoice?.(null)} title={`Which ${e.variantChoice?.parent?.name || 'one'}?`}>
        <div className="grid grid-cols-2 gap-2">{(e.variantChoice?.variants || []).map((v: any) => <button key={v.id} type="button" onClick={() => { e.addProductChecked?.(v); e.setVariantChoice?.(null); }} className="rounded-2xl p-4 text-left" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
          <span className="block text-[15px] font-semibold">{v.name}</span><span className="block text-[14px] tabular-nums">${Number(v.msrp || v.costPerUnit || 0).toFixed(2)}</span>
          <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>{Math.max(0, (Number(v.totalStock) || 0) - (Number(v.stockReserved) || 0))} on the shelf</span></button>)}</div>
      </Drawer>
      <Drawer accent={accent} open={pickupOpen} onClose={() => setPickupOpen(false)} title="Order pickup"><OrderPickup firestore={e.firestore} tenantId={e.tenantId} actor={{ id: getAuth().currentUser?.uid || 'desk', name: getAuth().currentUser?.displayName || 'Front desk' }} scanned={pickupScan}
        screen={clientScreen.connected ? { connected: true, name: clientScreen.name, ask: clientScreen.ask, response: clientScreen.response } : null} /></Drawer>
      <Drawer accent={accent} open={tuitionOpen} onClose={() => setTuitionOpen(false)} title="Tuition"><CollectTuition tenantId={e.tenantId} onTake={(x) => { e.setSelectedClientId?.(x.clientId); e.addTuitionToCart?.({ planId: x.planId, name: x.name, program: x.program, amount: x.amount }); setTuitionOpen(false); setMode('desk'); setCheckoutOpen(true); }} /></Drawer>
      <Drawer accent={accent} open={stationsOpen} onClose={() => setStationsOpen(false)} title="Stations"><Stations firestore={e.firestore} tenantId={e.tenantId} resources={allResources || []} appts={todaysAppts} services={e.services || []} /></Drawer>
      <Drawer accent={accent} open={rentOpen} onClose={() => setRentOpen(false)} title="Collect rent"><CollectRent tenantId={e.tenantId} onTake={(x) => { e.setSelectedClientId?.(x.clientId); e.addRentToCart?.({ renterId: x.renterId, name: x.name, amount: x.amount }); setRentOpen(false); setMode('desk'); setCheckoutOpen(true); }} /></Drawer>
      <Drawer accent={accent} open={walkInOpen} onClose={() => setWalkInOpen(false)} title="Add a walk-in"><AddWalkIn tenantId={e.tenantId} tenant={tenant} services={e.services || []} staff={e.staff || []} onDone={() => setWalkInOpen(false)} /></Drawer>
      <Drawer accent={accent} open={screenOpen} onClose={() => setScreenOpen(false)} title="Client screen"><ClientScreenPanel tenantId={e.tenantId} /></Drawer>
      <Drawer accent={accent} open={attnOpen} onClose={() => setAttnOpen(false)} title="Needs attention">
        {attnOpen && <OpsBoard appts={todaysAppts} staff={(e.staff || []).filter((s: any) => s.isActive !== false)} tenant={e.selectedTenant} tenantId={e.tenantId} role={e.role} uid={e.currentUser?.uid} />}
      </Drawer>
      <DeskCancel e={e} accent={accent} onReschedule={(a: any) => setMoveAppt(a)} onOfferSlot={() => { setMoreTab('waitlist'); setMoreOpen(true); }} />
      <Drawer accent={accent} open={!!about} onClose={() => setAbout(null)} title="About this entry">
        {about && (() => { const r = about.appt || about.walkIn || {}; const created = toDate(r.createdAt || r.checkInTime); const paid = r.depositStatus === 'paid' || Number(r.amountPaid) > 0;
          const rows: [string, string][] = [['What it is', about.kind === 'appt' ? 'A booking' : 'A walk-in'], ['Name on it', r.clientName || r.customerName || '— none —'], ['Service', about.service], ['With', about.staffName || '— anyone —'],
            ['Status', `${r.status || '—'}${r.checkInStatus ? ` · check-in: ${r.checkInStatus}` : ''}`], ['Came from', r.source || r.createdVia || (about.kind === 'walkin' ? 'kiosk / front desk' : '—')], ['Created', created ? format(created, 'MMM d, h:mm a') : '—'], ['Reference', r.id || '—']];
          const remove = async () => {
            if (!window.confirm(`Remove ${r.clientName || r.customerName || 'this entry'} from today? It will be marked ${about.kind === 'appt' ? 'cancelled (removed at the desk)' : 'removed'} and recorded in the activity log.`)) return;
            const nowIso = new Date().toISOString();
            if (about.kind === 'appt') updateDocumentNonBlocking(doc(e.firestore, 'tenants', e.tenantId, 'appointments', r.id), { status: 'cancelled', cancellationReason: 'removed_at_desk', cancelledAt: nowIso });
            else { updateDocumentNonBlocking(doc(e.firestore, 'tenants', e.tenantId, 'walkIns', r.id), { status: 'removed', removedAt: nowIso });
              const mv = (e.appointmentsFromInventory || []).find((a: any) => a.id === `apt-walkin-${r.id}`);   // THE VISIT (T3): leaving the queue cancels it
              if (mv) updateDocumentNonBlocking(doc(e.firestore, 'tenants', e.tenantId, 'appointments', mv.id), { status: 'cancelled', stage: 'cancelled', cancelledAt: nowIso, cancelReason: 'Left the queue', timeline: [...(Array.isArray(mv.timeline) ? mv.timeline : []), { at: nowIso, kind: 'stage', stage: 'cancelled', text: 'Left the queue — removed at the desk', by: 'Desk', via: 'walk-in' }].slice(-60) }); }
            await logAuditClient(e.firestore, e.tenantId, { action: about.kind === 'appt' ? 'appointment.removed_at_desk' : 'walkin.removed', targetType: about.kind === 'appt' ? 'appointment' : 'walkIn', targetId: r.id, summary: `Removed ${r.clientName || r.customerName || 'an unnamed entry'} from today at the front desk`, actor: { type: 'user', id: e.currentUser?.uid || null, name: e.currentUser?.displayName || 'Front desk', role: e.role || 'staff', via: 'front desk' } } as any);
            setAbout(null);
          };
          return <div className="space-y-4">
            <dl className="grid grid-cols-[7.5rem_1fr] gap-y-2 text-[14px]">{rows.flatMap(([k, v]) => [<dt key={`k-${k}`} style={{ color: 'var(--muted)' }}>{k}</dt>, <dd key={`v-${k}`} className="break-all">{v}</dd>])}</dl>
            {paid ? <p className="rounded-2xl p-3 text-[13px]" style={{ background: 'var(--soft)' }}>Money has been paid on this entry, so it can’t be removed here — use <b>Cancel or no-show</b> so any refund or credit is handled.</p>
              : <div className="space-y-2"><Btn onClick={remove}>Remove from today</Btn><p className="text-[12px]" style={{ color: 'var(--muted)' }}>For test entries, duplicates and anything that shouldn’t be on the desk. Nothing is deleted — it’s marked removed and noted in the activity log.</p></div>}
          </div>; })()}
      </Drawer>
      <Drawer accent={accent} wide open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        {moreTabs.length > 1 && <div className="mb-4"><Seg label="More" value={(moreTabs.some(([k]) => k === moreTab) ? moreTab : moreTabs[0][0]) as any} onChange={(v) => setMoreTab(v as any)} options={moreTabs.map(([k, l]) => [k, l]) as any} /></div>}
        {(moreTabs.find(([k]) => k === moreTab) || moreTabs[0])?.[2]}
      </Drawer>
      <Drawer accent={accent} wide open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Checkout">
        {(() => { const ids: string[] = Array.from(e.selectedAppointmentIds || []); const v = ids.length === 1 ? (e.appointmentsFromInventory || []).find((a: any) => a.id === ids[0]) : null;
          return v ? <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl p-3" style={{ background: 'var(--card)' }}><span className="text-[14px]">Before they go — <b>book their next visit?</b></span><Btn quiet onClick={() => setFollowFor(v)}>Book next visit</Btn></div> : null; })()}
        <CheckoutHub {...e.checkoutHubProps} onDone={() => setCheckoutOpen(false)} /></Drawer>

    </DeskFrame>
  );
}

