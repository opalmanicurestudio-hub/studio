'use client';
import { staffAuthHeader } from '@/lib/staff-fetch';
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

import { HereNow } from '@/components/pos/desk/HereNow';
import { buildHereNow } from '@/lib/here-now';
import { RunningBehind, useDelays } from '@/components/pos/desk/RunningBehind';
import { ScanSheet, useScanSheet } from '@/components/pos/desk/ScanSheet';
import { delaySettings } from '@/lib/delay';
import { extraMinutesFor } from '@/lib/client-timing';
import { TakePayment } from '@/components/pos/desk/TakePayment';
import { AssistQueue, AskForHelp, useAssistQueue } from '@/components/pos/desk/AssistQueue';
import { openCount } from '@/lib/assist';
import { useInventory } from '@/context/InventoryContext';
import { Stations } from '@/components/pos/desk/Stations';
import { Kits } from '@/components/pos/desk/Kits';
import { kitKey, secondsLeft } from '@/lib/kits';
import { Linens } from '@/components/pos/desk/Linens';
import { Sterilisation } from '@/components/pos/desk/Sterilisation';
import { Disinfection } from '@/components/pos/desk/Disinfection';
import { Housekeeping, useHousekeeping } from '@/components/pos/desk/Housekeeping';
import { stationReadiness, needsAttention } from '@/lib/readiness';
import { CollectTuition } from '@/components/pos/desk/CollectTuition';
import { CollectRent } from '@/components/pos/desk/CollectRent';
import { OrderPickup } from '@/components/pos/desk/OrderPickup';
import { AddWalkIn } from '@/components/pos/desk/AddWalkIn';
import { openVisit, registerVisitActions } from '@/lib/visit-client';
import { LeftOpen, useLeftOpen } from '@/components/ops/LeftOpen';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useClientScreen, ClientScreenPanel } from '@/components/pos/ClientScreen';
import { TodaysSales } from '@/components/pos/desk/TodaysSales';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCompletedVisitCounts } from '@/hooks/use-appointments';
import { getAuth } from 'firebase/auth';
import { LayoutGroup, motion } from 'framer-motion';
import { format, isToday, parseISO } from 'date-fns';
import { moduleEnabled } from '@/lib/modules';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { businessLocations, worksAt, atLocation } from '@/lib/business-locations';
import { DeskFrame, Btn, Seg, Pill, GuestCard, Empty, Panel, Drawer, Menu, Icon, Ring, LiveDot, Toggle, ThemeSwitch } from './kit';
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
type View = 'day' | 'timeline' | 'lanes' | 'stations' | 'mix';
type Guest = { awaitingDeposit?: boolean; key: string; kind: 'appt' | 'walkin'; appt?: any; walkIn?: any; name: string; service: string; staffId: string | null; staffName: string | null; at: Date | null; stage: Stage; lateMin: number };

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const STAGES: [Exclude<Stage, 'done'>, string][] = [['arriving', 'Arriving'], ['waiting', 'Waiting'], ['service', 'In service'], ['ready', 'Ready to pay']];
const VIEW_KEY = 'cf.desk.view2';   // new key: everyone starts on the Day view once
const first = (n: any) => String(n || '').split(' ')[0];
const initials = (n: string) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
const STEPS: [Stage, string][] = [['arriving', 'Booked'], ['waiting', 'Here'], ['service', 'In service'], ['ready', 'Ready to pay'], ['done', 'Paid']];
const lateLabel = (m: number) => (m >= 90 ? `${Math.round(m / 60)} hr late` : `${m} min late`);

export function DeskPOS({ e, tools }: { e: any; tools?: { team?: ReactNode; waitlist?: ReactNode; spaces?: ReactNode } }) {
  const tenant = e.selectedTenant;
  const accent = tenant?.bookingPageSettings?.cfPageConfig?.accentColor || null;
  // Which location this desk is looking at (multi-location businesses; remembered per device). '' = every location.
  const { locations: allLocations } = useInventory() as any;
  const places = businessLocations(allLocations);
  const [deskLoc, setDeskLoc] = useState<string>('');
  useEffect(() => { try { const v = localStorage.getItem('cf.desk.location') || ''; if (v && places.some((p: any) => p.id === v)) setDeskLoc(v); } catch { /* per-device nicety */ } }, [places.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickLoc = (v: string) => { setDeskLoc(v); try { localStorage.setItem('cf.desk.location', v); } catch { /* ignore */ } };
  const loc = places.length > 1 ? deskLoc : '';
  const staffList: any[] = (e.staff || []).filter((s: any) => s.isActive !== false && !s.isStudent && worksAt(s, loc));
  const solo = staffList.length <= 1;
  const recommended: View = 'day';
  const [view, setView] = useState<View>(recommended);
  useEffect(() => { try { const v = localStorage.getItem(VIEW_KEY) as View | null; if (v && ['day', 'timeline', 'lanes', 'stations', 'mix'].includes(v)) setView(v); } catch { /* per-device memory is a nicety */ } }, []);
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
  const leftOpen = useLeftOpen(e.firestore, e.tenantId);
  const opsCount = { ...opsBase, attention: opsBase.attention + overdueCallbacks(callbacks) + callsNeedingAttention(openCalls.calls) + leftOpen.length };
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);   // Take a payment — anyone, everything they owe
  const [takeFor, setTakeFor] = useState<{ clientId?: string; renterId?: string; planId?: string } | null>(null);
  // Any screen can open it for a person: window.dispatchEvent(new CustomEvent('cf:take-payment', { detail: { clientId } }))
  useEffect(() => { const on = (ev: any) => { setTakeFor(ev?.detail || null); setPayOpen(true); }; window.addEventListener('cf:take-payment', on); return () => window.removeEventListener('cf:take-payment', on); }, []);
  const [rentOpen, setRentOpen] = useState(false); const [tuitionOpen, setTuitionOpen] = useState(false);
  const [stationsOpen, setStationsOpen] = useState(false); const [kitsOpen, setKitsOpen] = useState(false); const [hkOpen, setHkOpen] = useState(false); const [assistOpen, setAssistOpen] = useState(false);
  const [askFor, setAskFor] = useState<any>(null);   // "Ask for help" from a busy station
  const { resources: allResources, inventory: allInventory } = useInventory() as any;
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
  useEffect(() => { try { const q = new URLSearchParams(window.location.search); const id = q.get('checkout') || q.get('checkout_id'); const vid = q.get('visit');
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
  // Front door (K7): arrivals from the kiosk that aren't appointments or walk-ins — pickups, renter visits, tours, "I need help".
  const doorQ = useMemoFirebase(() => (e.firestore && e.tenantId ? query(collection(e.firestore, 'tenants', e.tenantId, 'frontDoor'), where('status', '==', 'waiting')) : null), [e.firestore, e.tenantId]);
  const { data: doorWaiting } = useCollection<any>(doorQ);
  const protoQ = useMemoFirebase(() => (e.firestore && e.tenantId ? collection(e.firestore, 'tenants', e.tenantId, 'protocols') : null), [e.firestore, e.tenantId]);
  const { data: protocols } = useCollection<any>(protoQ);   // cleaning protocols (O7) — turnover checklists + quarantine
  const kitsQ = useMemoFirebase(() => (e.firestore && e.tenantId ? collection(e.firestore, 'tenants', e.tenantId, 'kits') : null), [e.firestore, e.tenantId]);
  const { data: kits } = useCollection<any>(kitsQ);   // kits (O5)
  const isMgr = ['owner', 'admin', 'manager'].includes(String(e.role || ''));
  // Housekeeping for stations, kits and linens (reminders, closing out finished visits) — asked for by this open desk
  // every few minutes, so it happens even where the scheduled job runs rarely. The server ignores repeats.
  useEffect(() => { if (!e.tenantId) return; const run = () => { staffAuthHeader().then((h) => fetch('/api/desk/tick', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ tenantId: e.tenantId }) })).catch(() => undefined); };
    const first = setTimeout(run, 8000); const every = setInterval(run, 5 * 60000); return () => { clearTimeout(first); clearInterval(every); }; }, [e.tenantId]);
  const hk = useHousekeeping(e.tenantId || null, todaysAppts, e.services || [], e.staff || [], e.selectedTenant, e.appointmentsFromInventory || []);   // the housekeeping queue (badge)
  const kitsToClean = (kits || []).filter((k: any) => k.status === 'dirty' || k.status === 'out' || (k.status === 'cleaning' && Number(e.selectedTenant?.kitCapacity?.[kitKey(k.name)]?.cleanMinutes) > 0 && secondsLeft(k.at, Number(e.selectedTenant.kitCapacity[kitKey(k.name)].cleanMinutes), Date.now()) <= 0)).length;   // to clean, pulled out, or cleaning time is up
  const assistItems = useAssistQueue(e.firestore, e.tenantId || null);   // Station Assist (O4): station requests + lounge orders + restocks
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
  // The Day view: the selected guest's ticket on the right (a drawer on phones), one search-and-scan box.
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [wide, setWide] = useState(true);
  const [phone, setPhone] = useState(false);
  useEffect(() => { const mq = window.matchMedia('(min-width: 1024px)'), mp = window.matchMedia('(max-width: 639px)');
    const f = () => { setWide(mq.matches); setPhone(mp.matches); }; f(); mq.addEventListener?.('change', f); mp.addEventListener?.('change', f);
    return () => { mq.removeEventListener?.('change', f); mp.removeEventListener?.('change', f); }; }, []);
  const [now, setNow] = useState(() => new Date());
  const stationRows = useMemo(() => stationReadiness(allResources || [], todaysAppts, e.services || [], now.getTime(), e.staff || [], protocols || []), [allResources, todaysAppts, e.services, now]);   // the desk's clock keeps the count fresh
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
      // A late deposit the system kept for the desk to decide (lib/deposit-release) stays on the list all day.
      if ((st === 'pending_payment' || st === 'deposit_pending') && a.paymentDueAt && Date.parse(a.paymentDueAt) < now.getTime() && a.depositDeskHold !== true) return false;
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
    return out.filter((g) => atLocation(g.walkIn || g.appt, e.staff || [], allLocations || [], loc)).sort((x, y) => (x.at?.getTime() || 0) - (y.at?.getTime() || 0));
  }, [e.appointmentsFromInventory, e.walkIns, e.services, e.staff, now, loc, allLocations]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = guests.filter((g) => g.stage !== 'done');
  const selectedGuest = sel ? guests.find((g) => g.key === sel) || null : null;
  // K7: who's here and what's outstanding — checked-in guests not yet started + people at the front door, one list.
  const scanner = useScanSheet();   // one scanner for kits, bundles, sterilisers and stations (USB scanners open it too)
  const delays = useDelays(todaysAppts, e.services || [], e.selectedTenant || tenant);
  const delayMargin = delaySettings(e.selectedTenant || tenant).marginMin;
  const pushedBack = (id: string) => { let m = 0; for (const d of delays) for (const k of d.next) if (k.id === id && k.lateMin > m) m = k.lateMin; return m >= delayMargin ? m : 0; };
  const hereNow = useMemo(() => buildHereNow({ guests, door: doorWaiting || [], clients: e.clients || [], services: e.services || [], now, extraMinutesFor, kits: kits || [], lateFor: pushedBack, setAsideFor: (id: string) => { const v = hk.plan?.visits.find((x: any) => x.visitId === id); const codes = (v?.items || []).filter((i: any) => i.code && (i.state === 'ready' || i.state === 'in_time')).map((i: any) => i.code); return codes.length ? `Set aside: ${codes.join(' · ')}` : null; } }), [hk.plan, delays, guests, doorWaiting, e.clients, e.services, now, kits]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Completed visits for the people on the floor, counted on the server (the shared list only reaches six weeks back).
  const guestClientIds = useMemo(() => guests.map((g: any) => String(g.appt?.clientId || g.walkIn?.clientId || '')).filter(Boolean), [guests]);
  const visitCounts = useCompletedVisitCounts(guestClientIds);
  const flagsFor = (g: Guest) => {
    const a = g.appt || {}; const c = (e.clients || []).find((x: any) => x.id === (a.clientId || g.walkIn?.clientId));
    const recent = c ? (e.appointmentsFromInventory || []).filter((x: any) => x.clientId === c.id && x.status === 'completed').length : 0;
    const visits = !c ? 0 : c.id in visitCounts ? Math.max(visitCounts[c.id], recent) : (recent || -1);   // -1: still counting, so not "new" yet
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
        if (hit) out.push([`Running over · affects ${String(hit.appt.clientName || 'next guest').split(' ')[0]} ${isNaN(Date.parse(String(hit.appt.startTime))) ? '' : format(new Date(hit.appt.startTime), 'h:mm')}`, 'warn']); }
    }
    if (!c || visits === 0) out.push(['New client', 'accent']);
    if (a.completionStatus && a.completionStatus !== 'completed') out.push(['Forms not done', 'warn']);
    if ((c?.unpaidFees || []).length) out.push(['Owes', 'warn']);
    if (c?.activeMembershipId) out.push(['Member', 'ok']);
    if (c?.managerPresent) out.push(['Manager on site', 'warn']);
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
        ? <div className="flex flex-wrap justify-end gap-1">{staffList.map((s) => <Btn key={s.id} quiet onClick={() => assign(g, s.id)}>{String(s.name).split(' ')[0]}</Btn>)}<Btn quiet onClick={() => setAssigning(null)} label="Cancel"><Icon name="close" size={14} /></Btn></div>
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
      flags={[...(g.kind === 'walkin' ? [{ label: 'Walk-in' }] : []), ...(g.awaitingDeposit ? [{ label: g.appt?.depositDeskHold ? 'Deposit not paid — your call' : 'Awaiting deposit', tone: 'warn' as const }] : []), ...fl.map(([label, tone]) => ({ label, tone }))]}
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


  // ── The Day view ───────────────────────────────────────────────────────
  // Walk-in turns, the same rule the engine's "assign next" uses: the business's
  // order (ordered list) or whoever has gone longest without a walk-in (fair play).
  const lastServed = (s: any) => toDate(s.lastWalkInCompletedAt || s.lastServedTimestamp)?.getTime() || 0;
  const rotation = staffList.filter((s) => s.acceptingWalkIns !== false).sort((a, b) => (e.assignmentMode === 'fair_play' ? lastServed(a) - lastServed(b) : (a.turnOrder || 999) - (b.turnOrder || 999)));
  const turnOf = (sid: string) => rotation.findIndex((s) => s.id === sid) + 1;
  const busyNow = (sid: string) => active.some((g) => g.staffId === sid && g.stage === 'service');
  const walkQueue = active.filter((g) => g.kind === 'walkin' && g.stage === 'waiting');
  const kioskTaking = tenant?.walkInKiosk?.enabled === true;
  // Who each unassigned walk-in would go to: first free provider in turn, else whoever frees up first.
  // A guest who chose to wait for one provider is only ever suggested that provider.
  const suggested = new Map<string, { staff: any; when: Date | null }>();
  { const taken = new Set<string>();
    for (const g of walkQueue) {
      if (g.staffId) continue;
      const w = g.walkIn || {}; const req = w.requestedStaffId || w.preferredStaffId || null; const hold = !!req && (w.waitForPreferred === true || w.waitingForRequested === true);
      let pool = rotation.filter((s) => !s.onBreak && !taken.has(s.id)); if (hold) pool = pool.filter((s) => String(s.id) === String(req));
      if (!pool.length) continue;
      const free = pool.find((s) => !busyNow(s.id));
      const pk = free || [...pool].sort((a, b) => (freeAt(a.id)?.getTime() || 0) - (freeAt(b.id)?.getTime() || 0))[0];
      taken.add(pk.id); suggested.set(g.key, { staff: pk, when: free ? null : freeAt(pk.id) });
    } }
  const nextUp = rotation.find((s) => !s.onBreak && !busyNow(s.id)) || null;
  const progressOf = (g: Guest) => { const s0 = startedAt(g); return s0 ? (now.getTime() - s0.getTime()) / 60000 / Math.max(1, minsOf(g)) : 0; };
  const setTaking = (s: any, v: boolean) => { if (e.firestore && e.tenantId) updateDocumentNonBlocking(doc(e.firestore, 'tenants', e.tenantId, 'staff', s.id), { acceptingWalkIns: v }); };
  const setKioskTaking = (v: boolean) => { if (e.firestore && e.tenantId) updateDocumentNonBlocking(doc(e.firestore, 'tenants', e.tenantId), { walkInKiosk: { ...(tenant?.walkInKiosk || {}), enabled: v } }); };
  // NOW FIRST (solo): the one guest who needs you now leads the day — with you, ready to pay, here, or next to arrive.
  const heroGuest: Guest | null = solo ? (active.find((g) => g.stage === 'service') || active.find((g) => g.stage === 'ready') || active.find((g) => g.stage === 'waiting') || active.find((g) => g.stage === 'arriving') || null) : null;
  const matches = (g: Guest) => { const t = q.trim().toLowerCase(); if (!t && heroGuest && g.key === heroGuest.key) return false; return !t || `${g.name} ${g.service} ${g.staffName || ''} ${g.walkIn?.shortCode || ''}`.toLowerCase().includes(t); };
  const pick = (g: Guest) => setSel((cur) => (cur === g.key && wide ? null : g.key));
  const lead = (g: Guest, size = 40) => g.stage === 'service'
    ? <Ring progress={progressOf(g)} size={size} stroke={size > 44 ? 4 : 3}><span className="font-semibold" style={{ fontSize: size > 44 ? 15 : 12 }}>{initials(g.name)}</span></Ring>
    : <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size > 44 ? 15 : 12, background: g.stage === 'ready' ? 'color-mix(in srgb, var(--ok) 14%, transparent)' : 'var(--soft)', color: g.stage === 'ready' ? 'var(--ok)' : 'var(--ink)' }}>
        {g.stage === 'ready' ? <Icon name="check" size={size > 44 ? 22 : 18} /> : g.kind === 'walkin' && !g.walkIn?.clientName && !g.walkIn?.customerName ? <Icon name="walk" size={size > 44 ? 22 : 18} /> : initials(g.name)}</span>;
  const stop = (ev: any) => ev.stopPropagation();
  // What's still outstanding for a guest who's here (forms, deposit, balance, kit, set-aside items) — the Here-now rules.
  const owedOf = (g: Guest) => (hereNow.find((r) => r.kind === 'guest' && (r.key === `g:${g.appt?.id || g.walkIn?.id}` || (!!g.appt?.id && r.appointmentId === g.appt.id)))?.outstanding || []).filter((o) => o.key !== 'provider');
  const row = (g: Guest, i: number) => { const tm = timerFor(g); const on = sel === g.key; const sug = suggested.get(g.key); const w = g.walkIn || {};
    const code = w.shortCode || w.ticketCode || null; const queued = g.kind === 'walkin' && g.stage === 'waiting';
    return (
      <motion.div layout="position" key={g.key} transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        role="button" tabIndex={0} aria-pressed={on} aria-label={`Open ${g.name}`} onClick={() => pick(g)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(g); } }}
        className="d-row d-rise flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5"
        style={{ animationDelay: `${Math.min(i, 8) * 35}ms`, background: on ? 'var(--soft)' : undefined, border: `1px ${queued ? 'dashed' : 'solid'} ${on ? 'var(--ink)' : queued ? 'color-mix(in srgb, var(--ok) 50%, transparent)' : 'transparent'}` }}>
        {lead(g)}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-[14.5px] font-semibold"><span className="truncate">{g.name}</span>
            {code && <span className="shrink-0 rounded-md px-1.5 text-[11px] font-semibold tabular-nums" style={{ background: 'var(--soft)', color: 'var(--muted)' }}>{code}</span>}
            {g.awaitingDeposit && <Pill tone="warn">Deposit</Pill>}
            {(() => { const o = owedOf(g).find((x) => x.tone !== 'info'); return o && !g.awaitingDeposit ? <Pill tone="warn">{o.label}</Pill> : null; })()}</p>
          <p className="truncate text-[12.5px]" style={{ color: 'var(--muted)' }}>{g.service}{solo ? '' : g.staffName ? ` · ${first(g.staffName)}` : g.kind === 'walkin' ? ' · anyone' : ''}</p>
          {sug && <p className="mt-0.5 truncate text-[12px] font-medium" style={{ color: 'var(--ok)' }}>{sug.when ? `Next free: ${first(sug.staff.name)} ~${format(sug.when, 'h:mm')}` : `Next in turn: ${first(sug.staff.name)}, free now`}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {tm && <span className="text-[12px] tabular-nums" style={tm.tone === 'warn' ? { color: 'var(--warn)', fontWeight: 600 } : { color: 'var(--muted)' }}>{tm.text}</span>}
          {sug ? <span onClick={stop}><Btn onClick={() => assign(g, sug.staff.id)}>Assign</Btn></span>
            : g.stage === 'ready' ? <span onClick={stop}><Btn onClick={() => checkout(g)}>Check out</Btn></span> : null}
        </div>
      </motion.div>
    ); };
  const dayGroups: { key: string; title: string; icon: string; list: Guest[]; note?: ReactNode; always?: boolean; empty?: string }[] = [
    { key: 'ready', title: 'Ready to pay', icon: 'card', list: active.filter((g) => g.stage === 'ready' && matches(g)) },
    { key: 'walkins', title: 'Walk-ins', icon: 'walk', list: walkQueue.filter(matches), always: kioskOn || walkQueue.length > 0 || (e.walkIns || []).length > 0,
      note: walkQueue.length ? (() => { const est = estWait(); return est ? `about ${est} min wait` : 'someone is free now'; })() : kioskOn && !kioskTaking ? 'Kiosk paused' : null,
      empty: nextUp ? `No one waiting. The next walk-in goes to ${first(nextUp.name)}.` : 'No one waiting.' },
    { key: 'service', title: 'In service', icon: 'clock', list: active.filter((g) => g.stage === 'service' && matches(g)) },
    { key: 'here', title: 'Here', icon: 'user', list: active.filter((g) => g.stage === 'waiting' && g.kind !== 'walkin' && matches(g)) },
    { key: 'arriving', title: 'Arriving', icon: 'calendar', list: active.filter((g) => g.stage === 'arriving' && matches(g)) },
  ];
  const anyShown = dayGroups.some((gr) => gr.list.length);
  const dayList = (
    <div className="space-y-6">
      {dayGroups.filter((gr) => gr.list.length || (gr.always && !q)).map((gr) => (
        <section key={gr.key} aria-label={gr.title}>
          <h3 className="mb-1.5 flex items-center gap-2 px-1 text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>
            <Icon name={gr.icon} size={16} /><span style={{ color: 'var(--ink)' }}>{gr.title}</span><span className="tabular-nums">{gr.list.length}</span>
            {gr.key === 'service' && gr.list.length > 0 && <LiveDot />}
            {gr.note && <span className="ml-auto truncate text-[12px] font-normal">{gr.note}</span>}
          </h3>
          {gr.list.length ? <div className="space-y-1">{gr.list.map(row)}</div>
            : <p className="rounded-2xl px-4 py-3 text-[13px]" style={{ border: '1px dashed var(--line)', color: 'var(--muted)' }}>{gr.empty}</p>}
        </section>
      ))}
      {!anyShown && <Empty>{q ? `No one today matches “${q}”. Press Enter to look it up as a code.` : 'No one else today. A quiet moment.'}</Empty>}
    </div>
  );
  const bigAction = (g: Guest): { label: string; icon: string; run: () => void } | null => {
    if (g.stage === 'arriving') return g.kind === 'appt' && skipsCheckIn(placeOf((e.services || []).find((x: any) => x.id === g.appt?.serviceId), g.appt).kind) ? { label: 'Start', icon: 'arrow', run: () => start(g) } : { label: 'Check in', icon: 'check', run: () => checkIn(g) };
    if (g.stage === 'waiting') { if (g.kind === 'walkin' && !g.staffId) return null; if (g.kind === 'appt' && paymentOutstanding(g.appt)) return { label: 'Payment required', icon: 'card', run: () => setPayFor(g.appt) }; return { label: 'Start service', icon: 'arrow', run: () => start(g) }; }
    if (g.stage === 'service') return g.appt ? { label: 'Finish service', icon: 'check', run: () => finish(g) } : null;
    if (g.stage === 'ready') return { label: 'Check out', icon: 'card', run: () => checkout(g) };
    return null;
  };
  const ticket = (g: Guest) => { const tm = timerFor(g); const fl = flagsFor(g); const w = g.walkIn || {}; const sug = suggested.get(g.key); const act = bigAction(g);
    const idx = STEPS.findIndex(([k]) => k === g.stage); const ph = phoneOf(g); const asked = w.requestedStaffId || w.preferredStaffId || null;
    const flags: { label: string; tone?: 'soft' | 'warn' | 'ok' | 'accent' }[] = [...(g.kind === 'walkin' ? [{ label: 'Walk-in' }] : []), ...(g.awaitingDeposit ? [{ label: g.appt?.depositDeskHold ? 'Deposit not paid, your call' : 'Awaiting deposit', tone: 'warn' as const }] : []), ...fl.map(([label, tone]) => ({ label, tone }))];
    const facts: [string, ReactNode][] = [];
    if (g.at) facts.push([g.kind === 'walkin' ? 'Came in' : 'Booked for', format(g.at, 'h:mm a')]);
    if (tm) facts.push(['Now', <span key="t" style={tm.tone === 'warn' ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{tm.text}</span>]);
    facts.push(['With', g.staffName || (g.kind === 'walkin' ? 'Anyone, next in turn' : 'Not set')]);
    if (w.shortCode || w.ticketCode) facts.push(['Ticket', w.shortCode || w.ticketCode]);
    if (g.kind === 'walkin' && g.stage === 'waiting') facts.push(['In line', `${walkQueue.findIndex((x) => x.key === g.key) + 1} of ${walkQueue.length}`]);
    if (asked) facts.push(['Asked for', `${first(staffName(asked)) || 'a provider'}${w.waitForPreferred || w.waitingForRequested ? ', will wait' : ''}`]);
    if (ph) { const d = ph.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); facts.push(['Phone', d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ph]); }
    return (
      <div key={g.key} className="d-rise space-y-5">
        <header className="flex items-start gap-3.5">
          {lead(g, 56)}
          <div className="min-w-0 flex-1 pt-0.5"><p className="truncate text-[24px] font-light leading-tight tracking-tight">{g.name}</p><p className="truncate text-[13px]" style={{ color: 'var(--muted)' }}>{g.service}</p></div>
          <Menu items={menuFor(g)} label={`More for ${g.name}`} />
        </header>
        {flags.length > 0 && <div className="flex flex-wrap gap-1.5">{flags.map((f) => <Pill key={f.label} tone={f.tone}>{f.label}</Pill>)}</div>}
        {owedOf(g).length > 0 && <section aria-label="Before they start" className="space-y-1.5 rounded-2xl p-3.5" style={{ background: 'color-mix(in srgb, var(--warn) 8%, transparent)' }}>
          <p className="text-[12px] font-semibold" style={{ color: 'var(--warn)' }}>Still to do</p>
          {owedOf(g).map((o) => <p key={o.key + o.label} className="flex items-center gap-2 text-[13.5px]"><Icon name={o.tone === 'info' ? 'clock' : 'alert'} size={15} style={{ color: o.tone === 'info' ? 'var(--muted)' : 'var(--warn)' }} />{o.label}</p>)}</section>}
        <ol className="flex gap-1.5" aria-label="Where they are">{STEPS.map(([k, l], i) => (
          <li key={k} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={i === idx ? 'step' : undefined}>
            <span className={`h-1 rounded-full ${i === idx ? 'd-breathe' : ''}`} style={{ background: i <= idx ? 'var(--ok)' : 'var(--line)' }} />
            <span className="truncate text-[11px]" style={{ color: i === idx ? 'var(--ink)' : 'var(--muted)', fontWeight: i === idx ? 600 : 400 }}>{l}</span></li>))}</ol>
        <dl className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--line)' }}>{facts.map(([k, v], i) => (
          <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]" style={i ? { borderTop: '1px solid var(--line)' } : undefined}><dt style={{ color: 'var(--muted)' }}>{k}</dt><dd className="truncate text-right font-medium">{v}</dd></div>))}</dl>
        {g.kind === 'walkin' && g.stage === 'waiting' && !g.staffId && <section aria-label="Assign" className="space-y-3 rounded-2xl p-4" style={{ border: '1px dashed color-mix(in srgb, var(--ok) 50%, transparent)' }}>
          <p className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="walk" size={18} style={{ color: 'var(--ok)' }} />
            {sug ? (sug.when ? `Next free: ${first(sug.staff.name)}, about ${format(sug.when, 'h:mm')}` : `Next in turn: ${first(sug.staff.name)}, free now`) : 'No one on the floor is taking walk-ins'}</p>
          {sug && <Btn big className="w-full" onClick={() => assign(g, sug.staff.id)}>Assign to {first(sug.staff.name)}</Btn>}
          <div className="flex flex-wrap gap-1.5">{staffList.filter((s) => !sug || s.id !== sug.staff.id).map((s) => (
            <Btn key={s.id} quiet onClick={() => assign(g, s.id)}>{first(s.name)}{turnOf(s.id) ? ` · turn ${turnOf(s.id)}` : ''}{busyNow(s.id) ? ' · busy' : ''}</Btn>))}</div>
        </section>}
        {act && <Btn big className="w-full" onClick={act.run}><Icon name={act.icon} size={18} />{act.label}</Btn>}
        {g.appt?.id && <button type="button" onClick={() => open(g)} className="d-row flex w-full items-center justify-between rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ border: '1px solid var(--line)' }}>Open the full visit ticket<Icon name="chevron" size={16} /></button>}
      </div>
    ); };
  const alsoItems = [
    ...((interviews || []).filter((iv: any) => { const d = toDate(iv.chosenSlot); return d && isToday(d); }).map((iv: any) => ({ id: `iv-${iv.id}`, at: toDate(iv.chosenSlot)!, kind: 'Interview', icon: 'users', who: iv.applicantName || iv.name || 'Applicant', what: iv.listingTitle || iv.roleTitle || iv.role || 'Job interview', href: '/applicants', phone: iv.applicantPhone || iv.phone || '' }))),
    ...((tours || []).filter((t: any) => !['cancelled', 'canceled', 'declined'].includes(String(t.status)) && (t.purpose === 'school' ? academyOn : rentalsOn)).map((t: any) => ({ id: `t-${t.id}`, at: new Date(`${t.date}T${t.time || '00:00'}`), kind: t.purpose === 'school' ? 'Academy tour' : 'Rental tour', icon: t.purpose === 'school' ? 'school' : 'home', who: t.name || 'Visitor', what: t.status === 'requested' ? 'Requested, needs confirming' : `${t.durationMins || 30} min visit`, href: t.purpose === 'school' ? '/academy?section=admissions' : '/pipeline', phone: t.phone || '' }))),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const alsoToday = (narrow: boolean) => alsoItems.length > 0 && <section aria-label="Also today" className={narrow ? '' : 'mt-8'}><p className="mb-2 text-[14px] font-semibold">Also today</p>
    <div className={narrow ? 'space-y-2' : 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3'}>{alsoItems.map((x) => <div key={x.id} className="flex items-center justify-between gap-3 rounded-2xl p-3" style={{ border: '1px solid var(--line)' }}>
      <a href={x.href} className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--soft)' }}><Icon name={x.icon} size={17} /></span>
        <span className="min-w-0"><span className="block truncate text-[14px] font-semibold">{x.who}</span><span className="block truncate text-[12px]" style={{ color: 'var(--muted)' }}>{x.kind} · {format(x.at, 'h:mm a')} · {x.what}</span></span></a>
      {x.phone && <Btn quiet onClick={() => { window.location.href = `tel:${String(x.phone).replace(/[^\d+]/g, '')}`; }} label={`Call ${x.who}`}><Icon name="phone" size={16} /></Btn>}</div>)}</div></section>;
  const tiles: [string, string][] = [
    ['Guests', `${doneCount} of ${guests.length} done`],
    ['Average wait', today.avgWait === null ? '—' : `${Math.round(today.avgWait)} min`],
    ['Average ticket', today.avgTicket === null ? '—' : `$${Math.round(today.avgTicket)}`],
    ['Walk-ins served', today.walkinsServed === null ? '—' : `${today.walkinsServed}%`],
  ];
  const daySummary = (
    <div className="d-rise space-y-5">
      <div><p className="text-[13px]" style={{ color: 'var(--muted)' }}>Taken today</p><p className="text-[44px] font-light leading-none tracking-tight tabular-nums">${Math.round(takings).toLocaleString()}</p></div>
      <div className="grid grid-cols-2 gap-2">{tiles.map(([l, v]) => <div key={l} className="rounded-2xl px-4 py-3" style={{ background: 'var(--soft)' }}><p className="text-[12px]" style={{ color: 'var(--muted)' }}>{l}</p><p className="text-[18px] font-light tracking-tight">{v}</p></div>)}</div>
      {next && <button type="button" onClick={() => setSel(next.key)} className="d-row flex w-full items-center gap-3 rounded-2xl p-3 text-left" style={{ border: '1px solid var(--line)' }}>
        {lead(next)}<span className="min-w-0 flex-1"><span className="block text-[12px]" style={{ color: 'var(--muted)' }}>Next to arrive</span><span className="block truncate text-[14px] font-semibold">{next.name}{next.at ? ` · ${format(next.at, 'h:mm a')}` : ''}</span></span><Icon name="chevron" size={16} /></button>}
      {alsoToday(true)}
      <p className="text-center text-[12px]" style={{ color: 'var(--muted)' }}>Select a guest to see their ticket here.</p>
    </div>
  );
  const views: [View, string][] = solo ? [['day', 'Day'], ['timeline', 'Timeline'], ['lanes', 'Lanes']] : [['day', 'Day'], ['lanes', 'Lanes'], ['stations', 'Team'], ['timeline', 'Timeline'], ['mix', 'Mix']];
  const shown: View = solo && (view === 'stations' || view === 'mix') ? 'day' : view;
  const heroLabel: Record<string, string> = { service: 'With you now', ready: 'Ready to pay', waiting: 'Here and waiting', arriving: 'Next to arrive' };
  const heroAct = (g: Guest): { label: string; icon: string; run: () => void } | null => {
    if (g.kind === 'walkin' && g.stage === 'waiting' && !g.staffId && staffList[0]) return { label: 'Take them now', icon: 'arrow', run: () => assign(g, staffList[0].id) };
    return bigAction(g);
  };
  const heroCard = solo && mode === 'desk' && shown === 'day' && !q && (() => {
    const g = heroGuest;
    const then = g ? active.find((x) => x.key !== g.key && (x.stage === 'arriving' || x.stage === 'waiting')) : null;
    if (!g) return (
      <section aria-label="Now" className="d-rise mb-6 rounded-[28px] p-6" style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: 'var(--shade)' }}>
        <p className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ok)' }}><LiveDot />Free now</p>
        <p className="mt-1 text-[28px] font-light tracking-tight">No one else today.</p>
        <p className="text-[14px]" style={{ color: 'var(--muted)' }}>Take a walk-in, book someone in, or sell from the shelf.</p>
        <div className="mt-4 flex flex-wrap gap-2"><Btn big onClick={() => setWalkInOpen(true)}><Icon name="plus" size={18} />Walk-in</Btn><Btn big quiet onClick={() => e.setIsQuickBookOpen(true)}><Icon name="calendar" size={18} />Book</Btn></div>
      </section>);
    const e0 = g.stage === 'service' ? endsAt(g) : null; const left = e0 ? Math.round((e0.getTime() - now.getTime()) / 60000) : null;
    const tm = timerFor(g); const act = heroAct(g);
    return (
      <section aria-label="Now" className="d-rise mb-6 overflow-hidden rounded-[28px] p-5 sm:p-6" style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: 'var(--shade)' }}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <button type="button" onClick={() => setSel(g.key)} className="flex min-w-0 flex-1 items-center gap-4 text-left" aria-label={`Open ${g.name}’s ticket`}>
            {g.stage === 'service'
              ? <Ring progress={progressOf(g)} size={phone ? 84 : 104} stroke={5}><span className="block text-center"><span className="block text-[26px] font-light leading-none tabular-nums" style={left !== null && left < 0 ? { color: 'var(--warn)' } : undefined}>{left === null ? minsOf(g) : Math.abs(left)}</span><span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{left !== null && left < 0 ? 'min over' : 'min left'}</span></span></Ring>
              : lead(g, phone ? 64 : 76)}
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[13px]" style={{ color: g.stage === 'ready' || g.stage === 'service' ? 'var(--ok)' : tm?.tone === 'warn' ? 'var(--warn)' : 'var(--muted)' }}>{(g.stage === 'service' || g.stage === 'waiting') && <LiveDot tone={g.stage === 'waiting' ? 'warn' : 'ok'} />}{heroLabel[g.stage]}{tm ? ` · ${tm.text}` : ''}</span>
              <span className="block truncate text-[30px] font-light leading-tight tracking-tight">{g.name}</span>
              <span className="block truncate text-[14px]" style={{ color: 'var(--muted)' }}>{g.service}{g.at && g.stage === 'arriving' ? ` · ${format(g.at, 'h:mm a')}` : ''}</span>
            </span>
          </button>
          <div className="flex gap-2 sm:w-56 sm:flex-col">
            {act && <Btn big className="flex-1 sm:w-full sm:flex-none" onClick={act.run}><Icon name={act.icon} size={18} />{act.label}</Btn>}
            <Btn big quiet className="sm:w-full" onClick={() => setSel(g.key)} label="Open the ticket"><Icon name="ticket" size={18} /><span className={act ? 'hidden sm:inline' : ''}>Ticket</span></Btn>
          </div>
        </div>
        {then && <button type="button" onClick={() => setSel(then.key)} className="d-row mt-5 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left" style={{ background: 'var(--soft)' }}>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>Then</span>
          <span className="min-w-0 flex-1 truncate text-[14px]"><b className="font-semibold">{then.name}</b> · {then.service}</span>
          <span className="shrink-0 text-[12.5px] tabular-nums" style={{ color: 'var(--muted)' }}>{timerFor(then)?.text || (then.at ? format(then.at, 'h:mm a') : '')}</span></button>}
      </section>);
  })();
  const dayView = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_430px]">
      <div className="min-w-0">{heroCard}{dayList}</div>
      {wide && <aside aria-label={selectedGuest ? `${selectedGuest.name}’s ticket` : 'Today'} className="sticky top-0 self-start rounded-[28px] p-5" style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: 'var(--shade)' }}>
        {selectedGuest ? ticket(selectedGuest) : daySummary}</aside>}
    </div>
  );
  const teamStrip = !solo && (
    <section aria-label="Team now" className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
      {kioskOn && <div className="flex shrink-0 items-center gap-3 rounded-2xl px-4 py-2" style={{ border: '1px solid var(--line)' }}>
        <div className="text-[12px] leading-tight"><p className="text-[13px] font-semibold">Walk-ins</p><p style={{ color: kioskTaking ? 'var(--ok)' : 'var(--muted)' }}>{kioskTaking ? 'Kiosk is taking them' : 'Kiosk paused'}</p></div>
        <Toggle on={kioskTaking} disabled={!isMgr} label="Take walk-ins at the kiosk" onChange={setKioskTaking} /></div>}
      {staffList.map((s) => { const busy = active.filter((g) => g.staffId === s.id && g.stage === 'service'); const f = freeAt(s.id); const nx = active.filter((g) => g.staffId === s.id && (g.stage === 'arriving' || g.stage === 'waiting'))[0];
        const t = turnOf(s.id); const taking = s.acceptingWalkIns !== false;
        return <div key={s.id} className="flex shrink-0 items-center gap-2.5 rounded-2xl py-2 pl-2 pr-2.5" style={{ border: '1px solid var(--line)', background: 'var(--card)' }}>
          {busy[0] ? <Ring progress={progressOf(busy[0])} size={40}><Face sid={s.id} size={30} /></Ring>
            : <span className="relative"><Face sid={s.id} size={40} />{!s.onBreak && <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full" style={{ background: 'var(--ok)', border: '2px solid var(--card)' }} />}</span>}
          <div className="text-[12px] leading-tight"><p className="flex items-center gap-1.5 text-[13px] font-semibold">{first(s.name)}{t > 0 && <span className="rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums" style={{ background: 'var(--soft)', color: 'var(--muted)' }} title="Walk-in turn">turn {t}</span>}</p>
            <p style={{ color: s.onBreak ? 'var(--warn)' : busy.length ? 'var(--ink)' : 'var(--ok)' }}>{s.onBreak ? 'On a break' : busy.length ? `${busy.length > 1 ? `${busy.length} guests · ` : ''}free ~${f ? format(f, 'h:mm') : '—'}` : 'Free now'}</p>
            {nx?.at && <p style={{ color: 'var(--muted)' }}>next {format(nx.at, 'h:mm')}</p>}</div>
          <button type="button" aria-pressed={taking} disabled={!isMgr} onClick={() => setTaking(s, !taking)} title={taking ? 'Taking walk-ins' : 'Not taking walk-ins'} aria-label={`${first(s.name)} ${taking ? 'is taking walk-ins' : 'is not taking walk-ins'}`}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-default" style={{ background: taking ? 'color-mix(in srgb, var(--ok) 14%, transparent)' : 'var(--soft)', color: taking ? 'var(--ok)' : 'var(--muted)', opacity: taking ? 1 : 0.7 }}>
            <Icon name="walk" size={16} /></button>
        </div>; })}
    </section>
  );
  const toolItems = [
    { label: 'Log a call', icon: 'phone', onSelect: () => setLogCallOpen(true) },
    { label: 'Take a payment', icon: 'card', hint: 'Anyone, for anything they owe', onSelect: () => { setTakeFor(null); setPayOpen(true); } },
    kioskOn && { label: 'Find a client', icon: 'search', onSelect: () => e.setIsScanLookupOpen?.(true) },
    retailOn && { label: 'Order pickups', icon: 'box', onSelect: () => { setPickupScan(null); setPickupOpen(true); } },
    rentalsOn && { label: 'Collect rent', icon: 'home', onSelect: () => setRentOpen(true) },
    academyOn && { label: 'Tuition', icon: 'school', onSelect: () => setTuitionOpen(true) },
    { label: 'Assist', icon: 'bell', count: openCount(assistItems), hint: 'Station requests, lounge orders, restocks', onSelect: () => setAssistOpen(true) },
    { label: 'Housekeeping', icon: 'broom', count: hk.tasks.length, onSelect: () => setHkOpen(true) },
    (allResources || []).length > 0 && { label: 'Stations', icon: 'station', count: needsAttention(stationRows), onSelect: () => setStationsOpen(true) },
    { label: 'Kits & linens', icon: 'box', count: kitsToClean, onSelect: () => setKitsOpen(true) },
    { label: 'Today’s sales', icon: 'receipt', onSelect: () => setSalesOpen(true) },
    { label: 'Client screen', icon: 'screen', hint: clientScreen.connected ? (clientScreen.online ? 'Connected' : 'Connected, offline') : 'Not connected', onSelect: () => setScreenOpen(true) },
    { label: 'Till', icon: 'till', onSelect: () => e.setIsTillManagementOpen(true) },
    ...moreTabs.map(([k, l]) => ({ label: l, icon: k === 'team' ? 'users' : k === 'spaces' ? 'home' : 'list', onSelect: () => { setMoreTab(k as any); setMoreOpen(true); } })),
  ];
  const toolCount = (Number(openCount(assistItems)) || 0) + hk.tasks.length + kitsToClean + ((allResources || []).length ? Number(needsAttention(stationRows)) || 0 : 0);
  const readyIds: string[] = Array.from(e.selectedAppointmentIds || []);
  // Phones: the view switch lives in Tools, and Walk-in / Book / Sell / Scan sit in a bar at the bottom, in thumb reach.
  const menuItems = phone && mode === 'desk' ? [...views.filter(([k]) => k !== shown).map(([k, l]) => ({ label: `Show as ${l}`, icon: k === 'day' ? 'list' : k === 'lanes' ? 'columns' : k === 'stations' ? 'users' : k === 'mix' ? 'grid' : 'clock', onSelect: () => pickView(k) })), ...toolItems] : toolItems;

  if (!mounted) return <DeskFrame accent={accent}><div className="p-8 text-[14px]" style={{ color: 'var(--muted)' }}>Opening the front desk…</div></DeskFrame>;

  return (
    <DeskFrame accent={accent}>
      <header className="space-y-3 px-4 pb-4 pt-4 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><p className="text-[22px] font-light tracking-tight sm:text-[26px]">Front desk <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{format(now, 'h:mm a')}</span></p>
            <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{active.length} today{doneCount ? ` · ${doneCount} done` : ''} · ${Math.round(takings).toLocaleString()} taken{next ? ` · next: ${first(next.name)} at ${next.at ? format(next.at, 'h:mm a') : '—'}` : ''}{requests > 0 && <> · <a href="/appointments/requests" className="font-semibold underline underline-offset-2" style={{ color: 'var(--ink)' }}>{requests} request{requests === 1 ? '' : 's'} to answer</a></>}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            {places.length > 1 && <Menu label="Location" width={240} trigger={<><Icon name="home" size={16} />{loc ? (places.find((p: any) => p.id === loc)?.name || 'Location') : 'All locations'}</>}
              items={[{ label: 'All locations', icon: loc ? 'grid' : 'check', onSelect: () => pickLoc('') }, ...places.map((p: any) => ({ label: p.name || 'Location', icon: loc === p.id ? 'check' : 'home', onSelect: () => pickLoc(p.id) }))]} />}
            {mode === 'desk' && !phone && <Seg label="View" value={shown} onChange={pickView} options={views} />}
            <Btn quiet={!opsCount.attention && !opsCount.decisions} onClick={() => setAttnOpen(true)} label={opsCount.decisions ? `Needs a decision, ${opsCount.decisions}` : `Needs attention${opsCount.attention ? `, ${opsCount.attention}` : ''}`}><Icon name="alert" size={16} />{phone ? (opsCount.decisions || opsCount.attention || null) : opsCount.decisions ? `Needs a decision · ${opsCount.decisions}` : `Needs attention${opsCount.attention ? ` · ${opsCount.attention}` : ''}`}</Btn>
            {mode === 'desk' && readyIds.length > 0 && <Btn onClick={() => setCheckoutOpen(true)}><Icon name="card" size={16} />Checkout · {readyIds.length}</Btn>}
            <ThemeSwitch />
            <Menu label="More tools" width={290} items={menuItems} trigger={<><Icon name="grid" size={16} />{phone ? null : 'Tools'}{toolCount > 0 && <span className="rounded-full px-1.5 text-[11px] tabular-nums" style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>{toolCount}</span>}</>} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'counter' && <Btn quiet big className="!h-11 !px-4" onClick={() => setMode('desk')}><Icon name="back" size={18} /><span className="hidden sm:inline">Desk</span></Btn>}
          <label className="flex h-11 min-w-0 flex-[1_1_100%] items-center gap-2.5 rounded-full px-4 sm:flex-[1_1_0%]" style={{ background: 'var(--soft)', border: '1px solid var(--line)' }}>
            <Icon name="search" size={18} style={{ color: 'var(--muted)' }} />
            <input value={q} placeholder="Find a guest, or scan a code" aria-label="Find a guest, or scan a code" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              onChange={(ev) => { setQ(ev.target.value); if (mode !== 'desk') setMode('desk'); if (shown !== 'day') setView('day'); }}
              onKeyDown={(ev) => { if (ev.key === 'Escape') setQ('');
                if (ev.key === 'Enter' && q.trim()) { const hit = active.filter(matches); if (hit.length === 1) setSel(hit[0].key); else if (!hit.length) { e.handlePosScan?.(q.trim()); setQ(''); } } }} />
            {q && <button type="button" aria-label="Clear the search" onClick={() => setQ('')} style={{ color: 'var(--muted)' }}><Icon name="close" size={16} /></button>}
          </label>
          {!phone && <>
          <button type="button" aria-label="Scan kits, stations and bundles" title="Scan kits, stations and bundles" onClick={scanner.show} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--soft)', border: '1px solid var(--line)' }}><Icon name="scan" size={18} /></button>
          <Btn big className="!h-11 !px-4" onClick={() => setWalkInOpen(true)} label="Add a walk-in"><Icon name="plus" size={18} />Walk-in</Btn>
          <Btn big quiet className="!h-11 !px-4" onClick={() => e.setIsQuickBookOpen(true)} label="Book"><Icon name="calendar" size={18} />Book</Btn>
          <Btn big quiet className="!h-11 !px-4" onClick={() => setMode(mode === 'counter' ? 'desk' : 'counter')} label="Sell"><Icon name="bag" size={18} />Sell</Btn></>}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 md:px-8" style={{ paddingBottom: phone ? 'calc(env(safe-area-inset-bottom,0px) + 104px)' : 40 }}>
        <RunningBehind tenantId={e.tenantId} margin={delayMargin} delays={delays} appts={todaysAppts} staff={e.staff || []} onOpenVisit={(id: string) => openVisit(id)} />
        <HereNow rows={mode === 'desk' && shown === 'day' ? hereNow.filter((r) => r.kind === 'door') : hereNow} onOpenVisit={(id: string) => openVisit(id)} onOpenPickups={() => { setPickupScan(null); setPickupOpen(true); }}
          onDoorDone={(id: string) => updateDocumentNonBlocking(doc(e.firestore, 'tenants', e.tenantId, 'frontDoor', id), { status: 'handled', handledAt: new Date().toISOString(), handledBy: (e as any).currentUserName || (e as any).currentStaffName || 'Front desk' })} />
        {mode === 'desk' && shown !== 'day' && <section aria-label="Today" className="mb-4">
          <button type="button" onClick={toggleToday} aria-expanded={todayOpen} className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--muted)' }}><span className="inline-flex items-center gap-1">Today<Icon name="chevron" size={14} className={`transition-transform ${todayOpen ? '-rotate-90' : 'rotate-90'}`} /></span></button>
          {todayOpen && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{([
            ['Taken today', `$${Math.round(takings).toLocaleString()}`],
            ['Guests', `${doneCount} of ${guests.length} done`],
            ['Average wait', today.avgWait === null ? '—' : `${Math.round(today.avgWait)} min`],
            ['Average ticket', today.avgTicket === null ? '—' : `$${Math.round(today.avgTicket)}`],
            ['Walk-ins served', today.walkinsServed === null ? '—' : `${today.walkinsServed}%`],
          ] as [string, string][]).map(([l, v]) => <div key={l} className="rounded-2xl px-4 py-3" style={{ border: '1px solid var(--line)' }}><p className="text-[12px]" style={{ color: 'var(--muted)' }}>{l}</p><p className="text-[20px] font-light tracking-tight">{v}</p></div>)}</div>}
        </section>}
        {mode === 'desk' && (outages.length > 0 || disruptions.length > 0) && <section aria-label="Disruptions" className="mb-4 space-y-2 rounded-3xl p-4" style={{ background: 'color-mix(in srgb, var(--warn) 9%, var(--card))' }}>
          <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>Heads up today</p>
          {disruptions.map((d: any) => <p key={d.id} className="text-[14px]"><b>{String(d.type || 'Disruption').replace(/_/g, ' ')}</b>{d.title || d.reason ? ` — ${d.title || d.reason}` : ''}{d.endDate ? ` · until ${String(d.endDate).slice(0, 10)}` : ''}</p>)}
          {outages.map((o) => <p key={o.rid} className="text-[14px]"><b>{o.name}</b> — {o.why}{o.affected ? <> · <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{o.affected} booking{o.affected === 1 ? '' : 's'} today use it</span></> : ' · nothing booked on it today'}</p>)}
          {maintOn && <a href="/maintenance" className="inline-block text-[13px] underline underline-offset-2">Open maintenance</a>}
        </section>}
        {mode === 'desk' && teamStrip}
        {mode === 'counter' ? <Counter e={e} onFollowUp={(v: any) => setFollowFor(v)} /> : <LayoutGroup>
          {shown === 'day' && dayView}
          {shown === 'timeline' && timeline}
          {shown === 'lanes' && lanes}
          {shown === 'stations' && stations}
          {shown === 'mix' && <div className="space-y-6">{stations}<div><p className="mb-2 text-[14px] font-semibold">The day</p>{timeline}</div></div>}
        </LayoutGroup>}
        {mode === 'desk' && (shown !== 'day' || !wide) && alsoToday(false)}
      </main>
      {phone && <nav aria-label="Front desk actions" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 gap-1.5 px-3 pt-2"
        style={{ background: 'color-mix(in srgb, var(--paper) 90%, transparent)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid var(--line)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 8px)' }}>
        {([['Walk-in', 'plus', () => setWalkInOpen(true), true], ['Book', 'calendar', () => e.setIsQuickBookOpen(true), false], [mode === 'counter' ? 'Desk' : 'Sell', mode === 'counter' ? 'back' : 'bag', () => setMode(mode === 'counter' ? 'desk' : 'counter'), false], ['Scan', 'scan', scanner.show, false]] as [string, string, () => void, boolean][]).map(([l, ic, run, primary]) => (
          <button key={l} type="button" onClick={run} className="flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11.5px] font-semibold transition active:scale-[.96]"
            style={primary ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { color: 'var(--ink)' }}><Icon name={ic} size={20} />{l}</button>))}
      </nav>}
      <Drawer accent={accent} open={!wide && mode === 'desk' && shown === 'day' && !!selectedGuest} onClose={() => setSel(null)} title="Ticket">{selectedGuest && ticket(selectedGuest)}</Drawer>
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
      <Drawer accent={accent} open={stationsOpen} onClose={() => setStationsOpen(false)} title="Stations"><Stations firestore={e.firestore} tenantId={e.tenantId} resources={allResources || []} appts={todaysAppts} services={e.services || []} staff={e.staff || []} protocols={protocols || []} onAsk={(ctx: any) => { setStationsOpen(false); setAskFor(ctx); }} /></Drawer>
      <Drawer accent={accent} open={kitsOpen} onClose={() => setKitsOpen(false)} title="Kits & linens"><div className="space-y-8"><Kits firestore={e.firestore} tenantId={e.tenantId} kits={kits || []} services={e.services || []} manager={isMgr} appts={todaysAppts} inventory={allInventory || []} staff={e.staff || []} resources={allResources || []} /><section><p className="mb-2 text-[15px] font-semibold">Sterilization records</p><Sterilisation tenantId={e.tenantId} tenant={e.selectedTenant} kits={(kits || []) as any} manager={isMgr} /></section><section><p className="mb-2 text-[15px] font-semibold">Disinfection guide</p><Disinfection tenantId={e.tenantId} tenant={e.selectedTenant} manager={isMgr} /></section><section><p className="mb-2 text-[15px] font-semibold">Linens & laundry</p><Linens tenantId={e.tenantId} services={e.services || []} appts={todaysAppts} inventory={allInventory || []} manager={isMgr} staff={e.staff || []} /></section></div></Drawer>
      <ScanSheet open={scanner.open} onClose={scanner.hide} pending={scanner.pending} tenantId={e.tenantId} tenant={e.selectedTenant || tenant} appts={todaysAppts} services={e.services || []} staff={e.staff || []} manager={isMgr} inventory={e.inventory || []} />
      <Drawer accent={accent} open={hkOpen} onClose={() => setHkOpen(false)} title="Housekeeping"><Housekeeping tenantId={e.tenantId} tenant={e.selectedTenant} appts={todaysAppts} services={e.services || []} staff={e.staff || []} manager={isMgr} allAppts={e.appointmentsFromInventory || []} onGo={(w) => { setHkOpen(false); if (w === 'stations') setStationsOpen(true); else if (w === 'assist') setAssistOpen(true); else setKitsOpen(true); }} /></Drawer>
      <Drawer accent={accent} open={assistOpen} onClose={() => setAssistOpen(false)} title="Assist"><AssistQueue firestore={e.firestore} tenantId={e.tenantId} inventory={allInventory || []} user={getAuth().currentUser} /></Drawer>
      <Drawer accent={accent} open={!!askFor} onClose={() => setAskFor(null)} title="Ask for help">{askFor && <AskForHelp tenantId={e.tenantId} context={askFor} onDone={() => setAskFor(null)} />}</Drawer>
      <Drawer accent={accent} open={payOpen} onClose={() => setPayOpen(false)} title="Take a payment">{payOpen && <TakePayment e={e} preselect={takeFor} onDone={() => { setPayOpen(false); setTakeFor(null); }} />}</Drawer>
      <Drawer accent={accent} open={rentOpen} onClose={() => setRentOpen(false)} title="Collect rent"><CollectRent tenantId={e.tenantId} onTake={(x) => { e.setSelectedClientId?.(x.clientId); e.addRentToCart?.({ renterId: x.renterId, name: x.name, amount: x.amount }); setRentOpen(false); setMode('desk'); setCheckoutOpen(true); }} /></Drawer>
      <Drawer accent={accent} open={walkInOpen} onClose={() => setWalkInOpen(false)} title="Add a walk-in"><AddWalkIn tenantId={e.tenantId} tenant={tenant} services={e.services || []} staff={staffList} locationId={loc || null} onDone={() => setWalkInOpen(false)} /></Drawer>
      <Drawer accent={accent} open={screenOpen} onClose={() => setScreenOpen(false)} title="Client screen"><ClientScreenPanel tenantId={e.tenantId} /></Drawer>
      <Drawer accent={accent} open={attnOpen} onClose={() => setAttnOpen(false)} title="Needs attention">
        {attnOpen && leftOpen.length > 0 && <section aria-label="Left open from earlier days" className="mb-5 space-y-2"><p className="text-[16px] font-bold">Left open from earlier days · {leftOpen.length}</p><LeftOpen firestore={e.firestore} tenantId={e.tenantId} items={leftOpen} staff={e.staff || []} who={e.currentUser?.displayName || 'Front desk'} /></section>}
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
