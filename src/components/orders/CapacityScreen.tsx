'use client';
// src/components/orders/CapacityScreen.tsx — ORDERS → SETUP → CAPACITY. How many orders a day the team can ship, what's
// still to pack on each coming ship day against that, how the shop is doing, and, for a day with more due than the
// team can ship, what would bring it back down (lib/capacity). The suggestions change nothing until someone picks one.
// How capacity is decided is set at the bottom; changes go through the server, so any manager can make them.
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs, limit, onSnapshot, orderBy, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { dayKey, tenantTimeZone } from '@/lib/tenant-time';
import { scheduleFrom, type CapacityRules, type ShipSchedule } from '@/lib/ship-promise';
import { CAPACITY_DAYS, dayLoads, onTimeRate, overDays, overTitle, packedOn, suggestionsFor, teamCapacity, type Over, type Suggestion, type TeamCapacity } from '@/lib/capacity';
import { lateItem, whenWord } from '@/lib/ship-day';
import { Btn, C, Group, Ic, LargeTitle, Row, Sheet, Toggle, UndoBar, feel, muted } from './ui';
import { PhoneShopBar, useWide } from './shell';
import { saveBusy, saveSchedule } from './schedule-save';

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (day: string) => SHORT[new Date(`${day}T12:00:00Z`).getUTCDay()];

/** Still to pack on each coming ship day, as bars, with the day's capacity as a dashed line. */
function Bars({ loads }: { loads: { day: string; due: number; cap: number | null }[] }) {
  const top = Math.max(1, ...loads.map((l) => Math.max(l.due, l.cap || 0))) * 1.1;
  const caps = loads.map((l) => l.cap).filter((c): c is number => c !== null);
  const one = caps.length && caps.every((c) => c === caps[0]) ? caps[0] : null;
  return (
    <div className="relative mt-3 flex h-[150px] items-end gap-2.5" role="img" aria-label={loads.map((l) => `${weekday(l.day)}: ${l.due} to pack${l.cap !== null ? ` of ${l.cap}` : ''}`).join('; ')}>
      {one !== null && <span className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed" style={{ bottom: `${(one / top) * 124 + 22}px`, borderColor: C.muted, opacity: 0.6 }} />}
      {loads.map((l) => {
        const over = l.cap !== null && l.due > l.cap;
        const color = over ? C.warn : l.due ? C.ink : '#c9cacd';
        return (
          <span key={l.day} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[12px] font-semibold" style={{ color: over ? C.warn : C.ink }}>{l.due}</span>
            <span className="w-full max-w-[72px] rounded-lg" style={{ height: `${Math.max(3, (l.due / top) * 124)}px`, background: color }} />
            <span className="text-[12px] font-semibold" style={muted}>{weekday(l.day)}</span>
          </span>);
      })}
    </div>);
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-2xl p-3" style={{ background: C.soft }}>
      <span className="text-[12.5px] font-semibold leading-tight" style={muted}>{label}</span>
      <span className="text-[22px] font-light tracking-[-0.02em]" style={{ color: color || C.ink }}>{value}</span>
    </div>);
}

/** A whole number typed in; saved when you leave it. */
function NumberField({ value, onSave, label, disabled }: { value: number; onSave: (n: number) => void; label: string; disabled?: boolean }) {
  const [v, setV] = React.useState(value ? String(value) : '');
  React.useEffect(() => { setV(value ? String(value) : ''); }, [value]);
  const commit = () => { const n = Math.min(5000, Math.max(0, Math.floor(Number(v) || 0))); if (n !== value) onSave(n); setV(n ? String(n) : ''); };
  return (
    <span className="flex shrink-0 items-center gap-2 text-[15px]" style={muted}>
      <input inputMode="numeric" aria-label={label} value={v} placeholder="0" disabled={disabled} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="h-10 w-16 rounded-xl border-0 text-center text-[17px] outline-none ring-0 focus:ring-0 disabled:opacity-60" style={{ background: C.paper, color: C.ink }} />
      a day
    </span>);
}

/** What would bring an over-capacity day back down; nothing changes until one is picked. */
export function OverSheet({ over, schedule, team, now, tz, tenantId, canEdit, onClose, onDone }: {
  over: Over; schedule: ShipSchedule; team: TeamCapacity | null; now: number; tz: string; tenantId: string; canEdit: boolean; onClose: () => void; onDone: (msg: string) => void;
}) {
  const router = useRouter();
  const today = dayKey(new Date(now), tz);
  const options = React.useMemo(() => suggestionsFor(over, schedule, now, tz, team), [over, schedule, now, tz, team]);
  const [pick, setPick] = React.useState<Suggestion['kind']>(options[0]?.kind || 'packer');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const chosen = options.find((o) => o.kind === pick) || options[0];
  const word = whenWord(over.day, today, tz);
  const radio = (on: boolean) => <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full" style={{ border: on ? `6px solid ${C.ink}` : '2px solid #c9cacd', boxSizing: 'border-box' }} />;
  const doIt = async () => {
    if (!chosen) return;
    if (chosen.kind === 'packer') { onClose(); router.push('/schedule'); return; }
    setBusy(true); setErr('');
    const r = await saveBusy(tenantId, { op: 'upsert', period: chosen.period });
    setBusy(false); feel(r.ok);
    if (r.ok) onDone(chosen.kind === 'more_time' ? 'New orders now get one more day.' : `The cutoff moves to ${chosen.title.replace(/^.* to /, '')}.`);
    else setErr(r.error || 'That didn’t save. Try again.');
  };
  return (
    <Sheet title={overTitle(over, today, tz)} sub={`${over.due} orders are due to ship ${word === 'today' || word === 'tomorrow' ? word : `on ${word}`}. You can ship about ${over.cap}.`} onClose={onClose}>
      <div className="mt-1 flex flex-col gap-2.5" role="radiogroup" aria-label="What to change">
        {options.map((o) => (
          <button key={o.kind} type="button" role="radio" aria-checked={pick === o.kind} onClick={() => setPick(o.kind)} className="flex gap-3 rounded-[18px] p-3.5 text-left"
            style={{ border: pick === o.kind ? `2px solid ${C.ink}` : `1px solid ${C.line}`, background: C.paper, color: C.ink }}>
            {radio(pick === o.kind)}
            <span className="flex flex-col gap-1"><span className="text-[15px] font-semibold">{o.title}</span><span className="text-[14px] leading-snug">{o.detail}</span></span>
          </button>))}
        {over.day === today && <div className="rounded-2xl px-3.5 py-3 text-[14px] leading-snug" style={{ background: C.soft }}>Still over after that? The orders most likely to miss today’s pickup are under At risk, with a one-tap message to each customer.</div>}
        {err && <p className="m-0 text-[14px]" style={{ color: C.bad }}>{err}</p>}
        {canEdit
          ? <Btn kind="primary" className="h-12 w-full text-[16px]" disabled={busy || !chosen} onClick={() => void doIt()}>{busy ? 'One moment…' : chosen?.kind === 'packer' ? 'Open the schedule' : 'Do it'}</Btn>
          : <p className="m-0 rounded-2xl px-3.5 py-3 text-center text-[14px]" style={{ background: C.soft }}>A manager can make one of these changes.</p>}
        <p className="m-0 text-center text-[12.5px] leading-snug" style={muted}>Suggestions come from your orders, your schedule and how fast your team has packed lately. Nothing changes until you choose.</p>
      </div>
    </Sheet>);
}

export function CapacityScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, role } = useTenant() as any;
  const wide = useWide();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant?.retailSettings || {}) as any;
  const tz = tenantTimeZone(selectedTenant);
  const canEdit = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const saved = React.useMemo(() => scheduleFrom(rs), [rs]);
  const [rules, setRules] = React.useState<CapacityRules | null>(null);
  React.useEffect(() => { setRules(null); }, [JSON.stringify(saved.capacity)]);   // the saved rules have caught up
  const schedule: ShipSchedule = rules ? { ...saved, capacity: rules } : saved;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const [open, setOpen] = React.useState<any[]>([]);
  const [packed, setPacked] = React.useState<any[] | null>(null);
  const [shipped, setShipped] = React.useState<any[]>([]);
  const [sheet, setSheet] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState('');

  React.useEffect(() => {
    if (!fs || !tenantId) return;
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ['paid', 'picking', 'packed']), limit(1000)),
      (s) => setOpen(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setOpen([]));
  }, [fs, tenantId]);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const since = new Date(Date.now() - (CAPACITY_DAYS + 1) * 86_400_000).toISOString();
    getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('packedAt', '>=', since), orderBy('packedAt', 'desc'), limit(1500)))
      .then((s) => setPacked(s.docs.map((d) => d.data()))).catch(() => setPacked([]));
    getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('completedAt', '>=', since), orderBy('completedAt', 'desc'), limit(1500)))
      .then((s) => setShipped(s.docs.map((d) => d.data()))).catch(() => setShipped([]));
  }, [fs, tenantId]);
  // ?over=YYYY-MM-DD (from Needs you on the orders screen) opens that day's suggestions.
  React.useEffect(() => { const d = new URLSearchParams(window.location.search).get('over'); if (d) setSheet(d); }, []);

  const team = React.useMemo(() => (packed ? teamCapacity(packed, now, tz) : null), [packed, now, tz]);
  const today = dayKey(new Date(now), tz);
  const packedToday = React.useMemo(() => (packed ? packedOn(packed, today, tz) : 0), [packed, today, tz]);
  const loads = React.useMemo(() => dayLoads(open, rs, tz, schedule, now, team, 5, packedToday), [open, rs, tz, schedule, now, team, packedToday]);
  const overs = overDays(loads);
  const waiting = open.filter((o) => o.method === 'ship' && !o.labelFromOrderId && !o.shippedWithOrderId).length;
  const late = open.filter((o) => lateItem(o, now, tz, schedule, rs)).length;
  const onTime = onTimeRate(shipped, now, tz);
  const cap = loads[0]?.cap ?? (schedule.capacity.mode === 'fixed' ? schedule.capacity.perDay || null : team?.perDay ?? null);
  const fromTeam = schedule.capacity.mode === 'team';
  const periodCap = loads[0] ? schedule.busy.find((b) => b.from <= loads[0].day && loads[0].day <= b.to && (b.capacity || 0) > 0) : null;
  const source = periodCap ? `During ${periodCap.name || 'this busy period'}, the number set for it.` : fromTeam
    ? team ? `From your team’s busier days in the last ${CAPACITY_DAYS} days, with ${team.packers} ${team.packers === 1 ? 'person' : 'people'} packing.` : packed === null ? 'Working it out…' : 'Not enough shipped orders yet to work it out. Set a number below in the meantime.'
    : schedule.capacity.perDay ? 'The number you set below.' : 'Set a number below.';
  const sheetOver = sheet ? overs.find((o) => o.day === sheet) || null : null;
  // Opened for a day (from Needs you) that has since caught up: say so rather than nothing.
  React.useEffect(() => {
    if (sheet && packed !== null && !sheetOver) { setSheet(null); setToast(`${whenWord(sheet, today, tz).replace(/^./, (c) => c.toUpperCase())} isn’t over capacity anymore.`); }
  }, [sheet, packed, sheetOver, today, tz]);

  const saveRules = async (patch: Partial<CapacityRules>, what: string) => {
    if (!canEdit) return;
    const next = { ...schedule.capacity, ...patch };
    setRules(next);
    const r = await saveSchedule(tenantId, { capacity: next });
    if (r.ok) setToast(`${what} saved`); else { setRules(null); setToast(r.error || `${what} didn’t save. Try again.`); }
  };

  return (
    <div className="cf-settings min-h-[100dvh] pb-32" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/retail-orders/setup" aria-label="Back to setup" className="cf-press grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.soft, color: C.ink }}>{Ic.back}</Link>
          <span className="text-[14px]" style={muted}>Setup</span>
          <span className="h-11 w-11" />
        </div>
        <div className="mt-3"><LargeTitle title="Shipping capacity" sub="How many orders a day the team can ship, and what’s coming." /></div>

        <div className="mt-5 flex flex-col gap-1 rounded-[20px] px-4 py-3.5" style={{ border: `1px solid ${C.line}` }}>
          <span className="flex justify-between gap-2.5 text-[15px] font-semibold"><span>You can ship about</span><span className="shrink-0 text-right">{cap ? `${cap} orders a day` : '—'}</span></span>
          <span className="text-[13px] leading-snug" style={muted}>{source}</span>
        </div>

        {overs.map((o) => (
          <button key={o.day} type="button" onClick={() => setSheet(o.day)} className="cf-press mt-2.5 flex w-full items-center gap-3 rounded-[18px] px-4 py-3.5 text-left" style={{ border: `2px solid ${C.warn}`, background: C.paper, color: C.ink }}>
            <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold" style={{ color: C.warn }}>{overTitle(o, today, tz)}</span><span className="block text-[14px]" style={muted}>{o.due} to pack, against about {o.cap}. See what would help.</span></span>
            <span style={muted}>{Ic.chev}</span>
          </button>))}

        <div className="mt-2.5 rounded-[20px] px-4 py-3.5" style={{ border: `1px solid ${C.line}` }}>
          <span className="text-[13px] font-semibold" style={muted}>To pack, by the day it’s due</span>
          <Bars loads={loads} />
          <p className="m-0 mt-2 text-[12.5px]" style={muted}>{cap ? 'Dashed line: what you can ship in a day. ' : ''}Late orders count on the first day{loads[0]?.day === today ? ', and today includes what’s been packed so far' : ''}.</p>
        </div>

        <div className="mt-2.5 flex gap-2">
          <Stat label="Waiting" value={String(waiting)} />
          <Stat label="Late" value={String(late)} color={late ? C.warn : undefined} />
          <Stat label={`On time, ${CAPACITY_DAYS} days`} value={onTime === null ? '—' : `${onTime}%`} color={onTime !== null && onTime >= 95 ? C.ok : undefined} />
        </div>

        <Group title="Daily capacity" foot={canEdit ? undefined : 'Only a manager can change these.'}>
          <Row label="Work it out from my team" note={team ? `Your last ${CAPACITY_DAYS} days: about ${team.perPacker} orders per person packing on a busier day.` : 'From how many shipped orders each person packs on your busier days.'}>
            <Toggle label="Work it out from my team" on={fromTeam} disabled={!canEdit} onChange={(v) => void saveRules({ mode: v ? 'team' : 'fixed' }, 'Capacity')} />
          </Row>
          <Row label="Or use a fixed number" note={fromTeam ? 'Turn the one above off to use this.' : undefined} last>
            <NumberField label="Orders a day" value={schedule.capacity.perDay} disabled={!canEdit || fromTeam} onSave={(n) => void saveRules({ perDay: n }, 'Capacity')} />
          </Row>
        </Group>

        <Group title="When orders pass capacity" foot={<>It also watches for sudden rushes: when orders come in at twice your usual pace, you hear about it before the pile builds (<Link href="/retail-orders/alerts" className="underline underline-offset-2">Alerts</Link>). A busy period can set its own capacity, under <Link href="/retail-orders/policies/shipping" className="underline underline-offset-2">Shipping schedule</Link>.</>}>
          <Row label="Tell me under Needs you" note="With the changes that would fix it.">
            <Toggle label="Tell me under Needs you" on={schedule.capacity.tell} disabled={!canEdit} onChange={(v) => void saveRules({ tell: v }, 'Capacity')} />
          </Row>
          <Row label="Give new orders more time by itself" note="Adds a day to new orders until you’re caught up. Dates already promised stay as they are. Off unless you turn it on." last>
            <Toggle label="Give new orders more time by itself" on={schedule.capacity.autoMoreTime} disabled={!canEdit} onChange={(v) => void saveRules({ autoMoreTime: v }, 'Capacity')} />
          </Row>
        </Group>
      </div>
      {sheetOver && <OverSheet over={sheetOver} schedule={schedule} team={team} now={now} tz={tz} tenantId={tenantId} canEdit={canEdit} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); setToast(m); }} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 96} />}
      {!wide && <PhoneShopBar problems={0} />}
    </div>);
}
