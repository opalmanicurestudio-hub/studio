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

import { useEffect, useMemo, useState } from 'react';
import { LayoutGroup } from 'framer-motion';
import { format, isToday, parseISO } from 'date-fns';
import { moduleEnabled } from '@/lib/modules';
import { CheckoutHub } from '@/components/pos/CheckoutHub';
import { RetailCatalog } from '@/components/pos/RetailCatalog';
import { DeskFrame, Btn, Seg, Pill, GuestCard, Empty, Panel, Drawer } from './kit';

type Stage = 'arriving' | 'waiting' | 'service' | 'ready' | 'done';
type View = 'timeline' | 'lanes' | 'stations' | 'mix';
type Guest = { key: string; kind: 'appt' | 'walkin'; appt?: any; walkIn?: any; name: string; service: string; staffId: string | null; staffName: string | null; at: Date | null; stage: Stage; lateMin: number };

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const STAGES: [Exclude<Stage, 'done'>, string][] = [['arriving', 'Arriving'], ['waiting', 'Waiting'], ['service', 'In service'], ['ready', 'Ready to pay']];
const VIEW_KEY = 'cf.desk.view';
const lateLabel = (m: number) => (m >= 90 ? `${Math.round(m / 60)} hr late` : `${m} min late`);

export function DeskPOS({ e, onClassic }: { e: any; onClassic: () => void }) {
  const tenant = e.selectedTenant;
  const accent = tenant?.bookingPageSettings?.cfPageConfig?.accentColor || null;
  const staffList: any[] = (e.staff || []).filter((s: any) => s.isActive !== false && !s.isStudent);
  const solo = staffList.length <= 1;
  const recommended: View = solo ? 'timeline' : 'lanes';
  const [view, setView] = useState<View>(recommended);
  useEffect(() => { try { const v = localStorage.getItem(VIEW_KEY) as View | null; if (v && ['timeline', 'lanes', 'stations', 'mix'].includes(v)) setView(v); } catch { /* per-device memory is a nicety */ } }, []);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Exclude<Stage, 'done'>>('all');
  const [now, setNow] = useState(() => new Date());
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
    const appts = (e.appointmentsFromInventory || []).filter((a: any) => { const d = toDate(a.startTime); return d && isToday(d) && !['cancelled', 'canceled', 'no_show'].includes(String(a.status || '')); });
    const mirrors = new Set(appts.map((a: any) => a.id));
    for (const a of appts) {
      const st = String(a.status || ''), ci = String(a.checkInStatus || '');
      const stage: Stage = st === 'completed' ? 'done' : st === 'ready_for_checkout' ? 'ready' : st === 'servicing' || st === 'in_service' ? 'service' : ci === 'arrived' || st === 'waiting' ? 'waiting' : 'arriving';
      const at = toDate(a.startTime); const late = stage === 'arriving' && at ? Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000)) : 0;
      out.push({ key: `a:${a.id}`, kind: 'appt', appt: a, name: a.clientName || 'Guest', service: svcName(a.serviceId) || a.serviceName || 'Service', staffId: a.staffId || null, staffName: staffName(a.staffId || null), at, stage, lateMin: ci === 'running_late' ? Math.max(late, 1) : late > 10 ? late : 0 });
    }
    for (const w of e.walkIns || []) {
      const st = String(w.status || '');
      if (!['waiting', 'notified', 'arrived', 'servicing', 'in_service'].includes(st) || mirrors.has(`apt-walkin-${w.id}`)) continue;
      const sid = w.staffId || w.assignedStaffId || null;
      out.push({ key: `w:${w.id}`, kind: 'walkin', walkIn: w, name: w.clientName || w.customerName || 'Walk-in', service: (w.serviceIds || []).map(svcName).filter(Boolean).join(' + ') || 'Walk-in', staffId: sid, staffName: staffName(sid), at: toDate(w.createdAt || w.checkInTime), stage: st === 'servicing' || st === 'in_service' ? 'service' : 'waiting', lateMin: 0 });
    }
    return out.sort((x, y) => (x.at?.getTime() || 0) - (y.at?.getTime() || 0));
  }, [e.appointmentsFromInventory, e.walkIns, e.services, e.staff, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = guests.filter((g) => g.stage !== 'done');
  const doneCount = guests.length - active.length;
  const takings = useMemo(() => (e.transactions || []).filter((t: any) => t.type === 'income' && !t.voided && toDate(t.date) && isToday(toDate(t.date)!)).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0), [e.transactions]);
  const next = active.find((g) => g.stage === 'arriving');

  // ── Actions: the classic POS's own ─────────────────────────────────────
  const open = (g: Guest) => { if (g.appt) { e.setSelectedAppointment(g.appt); e.setIsDetailsOpen(true); } };
  const checkIn = (g: Guest) => e.setPendingCheckInItem(g.appt);
  const start = (g: Guest) => e.handleStartService(g.kind === 'appt' ? g.appt.id : g.walkIn.id);
  const finish = (g: Guest) => { e.setAppointmentToReview(g.appt); e.setIsTechnicianReviewOpen(true); };
  const checkout = (g: Guest) => { if (!e.selectedAppointmentIds?.has?.(g.appt.id)) e.handleSelectAppointment(g.appt.id); setCheckoutOpen(true); };
  const assign = (g: Guest, staffId: string) => { e.handleAssignStaff(g.walkIn, staffId); setAssigning(null); };

  const actionFor = (g: Guest) => {
    if (g.stage === 'arriving') return <Btn quiet onClick={() => checkIn(g)}>Check in</Btn>;
    if (g.stage === 'waiting') {
      if (g.kind === 'walkin' && !g.staffId) return assigning === g.key
        ? <div className="flex flex-wrap justify-end gap-1">{staffList.map((s) => <Btn key={s.id} quiet onClick={() => assign(g, s.id)}>{String(s.name).split(' ')[0]}</Btn>)}<Btn quiet onClick={() => setAssigning(null)} label="Cancel">✕</Btn></div>
        : <Btn quiet onClick={() => setAssigning(g.key)}>Assign</Btn>;
      return <Btn quiet onClick={() => start(g)}>Start</Btn>;
    }
    if (g.stage === 'service') return g.appt ? <Btn quiet onClick={() => finish(g)}>Finish</Btn> : null;
    if (g.stage === 'ready') return <Btn onClick={() => checkout(g)}>Check out</Btn>;
    return null;
  };
  const card = (g: Guest, compact = false, hideTime = false) => (
    <GuestCard key={g.key} id={g.key} compact={compact} name={g.name} onOpen={() => open(g)}
      line={`${g.service}${g.staffName ? ` · ${String(g.staffName).split(' ')[0]}` : g.kind === 'walkin' ? ' · anyone' : ''}`}
      meta={<>{!hideTime && g.at ? format(g.at, 'h:mm a') : ''}{g.lateMin > 0 && <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{!hideTime ? ' · ' : ''}{lateLabel(g.lateMin)}</span>}</>}
      badge={g.kind === 'walkin' ? <Pill>Walk-in</Pill> : undefined} action={actionFor(g)} />
  );

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
          <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{active.length} today{doneCount ? ` · ${doneCount} done` : ''} · ${Math.round(takings)} taken{next ? ` · next: ${next.name.split(' ')[0]} at ${next.at ? format(next.at, 'h:mm a') : '—'}` : ''}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="View" value={shown} onChange={pickView} options={views.map(([k, l]) => [k, k === recommended ? `${l} ★` : l]) as [View, string][]} />
          {kioskOn && <Btn quiet onClick={() => e.setIsScanLookupOpen?.(true)}>Scan / find</Btn>}
          <Btn quiet onClick={() => e.setIsQuickBookOpen(true)}>Book</Btn>
          {canSell && <Btn quiet onClick={() => setSellOpen(true)}>Sell</Btn>}
          {readyIds.length > 0 && <Btn onClick={() => setCheckoutOpen(true)}>Checkout · {readyIds.length}</Btn>}
          <Btn quiet onClick={() => e.setIsTillManagementOpen(true)}>Till</Btn>
          <button type="button" onClick={onClassic} className="text-[12px] underline underline-offset-2" style={{ color: 'var(--muted)' }}>Classic POS</button>
        </div>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 md:px-8">
        <LayoutGroup>
          {shown === 'timeline' && timeline}
          {shown === 'lanes' && lanes}
          {shown === 'stations' && stations}
          {shown === 'mix' && <div className="space-y-6">{stations}<div><p className="mb-2 text-[14px] font-semibold">The day</p>{timeline}</div></div>}
        </LayoutGroup>
        <p className="mt-6 text-center text-[12px]" style={{ color: 'var(--muted)' }}>★ recommended for {solo ? 'a solo business' : 'your team'} · this device remembers your view</p>
      </main>
      <Drawer open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Checkout"><CheckoutHub {...e.checkoutHubProps} /></Drawer>
      {canSell && <Drawer wide open={sellOpen} onClose={() => setSellOpen(false)} title="Sell">
        <p className="mb-3 text-[13px]" style={{ color: 'var(--muted)' }}>Add products, then take payment below. Choose the client in checkout so the sale stays on their record.</p>
        {/* Exactly what the classic POS passes — each part only if the business uses that tool. */}
        <RetailCatalog services={e.services || []} inventory={retailOn ? e.inventory || [] : []} memberships={membershipsOn ? e.memberships || [] : []} packages={membershipsOn ? e.packages || [] : []}
          onAddToCart={e.handleAddToCart} onScanClick={() => { e.setScanMode?.('retail'); e.setIsCameraScanOpen?.(true); }} />
        <div className="mt-6"><CheckoutHub {...e.checkoutHubProps} /></div>
      </Drawer>}
    </DeskFrame>
  );
}
