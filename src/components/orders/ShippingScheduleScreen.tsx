'use client';
// src/components/orders/ShippingScheduleScreen.tsx — WHEN ORDERS SHIP. Processing time, ship days and the daily cutoff,
// carrier pickups, holidays and closures, and the transit time of the shop's own shipping. All of it feeds one
// calculation (lib/ship-promise), so the dates customers see before they pay, the dates in their email and the due
// times the team works to always agree. Each change saves on its own path the moment it's made, so nothing here can
// overwrite a setting changed somewhere else.
import * as React from 'react';
import Link from 'next/link';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { dayKey, formatTime, hasTimeZone, tenantTimeZone, zoneLabel } from '@/lib/tenant-time';
import {
  arrivalLabel, carrierHolidays, carrierKey, clockLabel, dayLabel, productPromise, scheduleFrom, startsReason,
  type Closure, type PickupRule, type ShipSchedule,
} from '@/lib/ship-promise';
import { Btn, C, Group, LargeTitle, Row, Seg, Sheet, Toggle, UndoBar, muted, Ic } from './ui';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const LETTER: Record<number, string> = { 0: 'S', 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S' };
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL'] as const;

/** 'Mon–Fri', 'Tue, Fri', 'Every day'. */
function daysLabel(days: number[]): string {
  const set = [...new Set(days)].sort();
  const k = set.join();
  if (k === '0,1,2,3,4,5,6') return 'Every day';
  if (k === '1,2,3,4,5') return 'Mon–Fri';
  if (k === '1,2,3,4,5,6') return 'Mon–Sat';
  return ORDER.filter((d) => set.includes(d)).map((d) => SHORT[d]).join(', ') || 'No days';
}

const minutes = (hhmm: string) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hoursText = (mins: number) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return `${h} h ${m} min`;
  return h ? `${h} hour${h === 1 ? '' : 's'}` : `${m} minutes`;
};

function DayPills({ value, onChange, disabled, label }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-1.5">
      {ORDER.map((d) => {
        const on = value.includes(d);
        return (
          <button key={d} type="button" aria-pressed={on} aria-label={PLURAL[d]} disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
            className="cf-press grid h-8 w-8 place-items-center rounded-full text-[13px] font-semibold disabled:opacity-50"
            style={on ? { background: C.ink, color: C.paper } : { background: C.paper, color: C.muted }}>{LETTER[d]}</button>);
      })}
    </div>);
}

/** A time of day. Saves when you leave it; `live` passes every complete change straight up (inside a sheet, where
 *  the sheet's own Save button is what saves). */
function TimeField({ value, onSave, label, disabled, live }: { value: string; onSave: (v: string) => void; label: string; disabled?: boolean; live?: boolean }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { setV(value); }, [value]);
  const ok = (t: string) => /^\d{2}:\d{2}$/.test(t);
  const commit = () => { if (ok(v) && v !== value) onSave(v); else if (!ok(v)) setV(value); };
  return (
    <input type="time" aria-label={label} value={v} disabled={disabled} step={900}
      onChange={(e) => { setV(e.target.value); if (live && ok(e.target.value)) onSave(e.target.value); }} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="h-10 shrink-0 rounded-xl border-0 px-3 text-[17px] outline-none ring-0 focus:ring-0 disabled:opacity-60" style={{ background: C.paper, color: C.ink }} />);
}

function Stepper({ value, min, max, onChange, label, disabled }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}
        className="cf-press grid h-9 w-9 place-items-center rounded-full text-[19px] disabled:opacity-40" style={{ background: C.paper, color: C.ink }}>−</button>
      <span className="min-w-[22px] text-center text-[17px] font-semibold" aria-live="polite">{value}</span>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}
        className="cf-press grid h-9 w-9 place-items-center rounded-full text-[19px] disabled:opacity-40" style={{ background: C.paper, color: C.ink }}>+</button>
    </span>);
}

function SmallNumber({ value, onSave, label, disabled, min, max }: { value: number; onSave: (n: number) => void; label: string; disabled?: boolean; min: number; max: number }) {
  const [v, setV] = React.useState(String(value));
  React.useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => { const n = Math.min(max, Math.max(min, Math.floor(Number(v) || 0))); if (n !== value) onSave(n); setV(String(n)); };
  return (
    <input inputMode="numeric" aria-label={label} value={v} disabled={disabled} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="h-10 w-12 shrink-0 rounded-xl border-0 text-center text-[17px] outline-none ring-0 focus:ring-0 disabled:opacity-60" style={{ background: C.paper, color: C.ink }} />);
}

function RowButton({ label, note, value, onClick, last }: { label: string; note?: string; value?: string; onClick: () => void; last?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="cf-press flex min-h-[56px] w-full items-center gap-3 pl-4 text-left" style={{ color: C.ink }}>
      <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={last ? undefined : { borderBottom: `1px solid ${C.line}` }}>
        <span className="min-w-0 flex-1"><span className="block text-[17px] tracking-[-0.01em]">{label}</span>{note ? <span className="mt-0.5 block text-[13px] leading-snug" style={muted}>{note}</span> : null}</span>
        {value ? <span className="shrink-0 text-[15px]" style={muted}>{value}</span> : null}
        <span style={muted}>{Ic.chev}</span>
      </span>
    </button>);
}

function Timeline({ rows }: { rows: { head: string; when: string; note: string; dot: string }[] }) {
  return (
    <ol className="m-0 list-none p-0">
      {rows.map((r, i) => (
        <li key={r.head} className="flex gap-3">
          <span className="flex w-3.5 flex-col items-center">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: r.dot }} />
            {i < rows.length - 1 ? <span className="my-0.5 w-0.5 flex-1" style={{ background: C.line }} /> : null}
          </span>
          <span className={`min-w-0 flex-1 ${i < rows.length - 1 ? 'pb-3.5' : ''}`}>
            <span className="flex justify-between gap-2 text-[15px] font-semibold"><span>{r.head}</span><span className="text-right">{r.when}</span></span>
            <span className="mt-0.5 block text-[13px] leading-snug" style={muted}>{r.note}</span>
          </span>
        </li>))}
    </ol>);
}

type PickupDraft = { index: number; carrier: string; other: string; kind: 'pickup' | 'dropoff'; days: number[]; time: string };
type ClosureDraft = { index: number; label: string; from: string; to: string };

export function ShippingScheduleScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, role } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant?.retailSettings || {}) as any;
  const canEdit = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const tz = tenantTimeZone(selectedTenant);
  const zoneSet = hasTimeZone(selectedTenant);
  const saved = React.useMemo(() => scheduleFrom(rs), [rs]);
  const savedJson = JSON.stringify(saved);
  const [over, setOver] = React.useState<Partial<ShipSchedule>>({});
  // A change shows at once; it is dropped from here as soon as the saved schedule says the same thing.
  React.useEffect(() => {
    setOver((o) => {
      const s = JSON.parse(savedJson);
      const next: any = {};
      for (const [k, v] of Object.entries(o)) if (JSON.stringify(s[k]) !== JSON.stringify(v)) next[k] = v;
      return Object.keys(next).length === Object.keys(o).length ? o : next;
    });
  }, [savedJson]);
  const s: ShipSchedule = { ...saved, ...over };
  const [toast, setToast] = React.useState('');
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const [pickup, setPickup] = React.useState<PickupDraft | null>(null);
  const [closure, setClosure] = React.useState<ClosureDraft | null>(null);
  const [dayCutoff, setDayCutoff] = React.useState<{ day: number; time: string } | null>(null);
  const lastDays = React.useRef(Math.max(1, saved.processingDays));
  if (s.processingDays > 0) lastDays.current = s.processingDays;

  const save = async (patch: Partial<ShipSchedule>, what: string) => {
    if (!canEdit || !fs || !tenantId) return;
    setOver((o) => ({ ...o, ...patch }));
    const at = new Date().toISOString();
    // The first save writes the whole schedule, so what the shop sees here (including what the old "ship within
    // hours" setting meant) is exactly what is kept. After that, each change goes on its own path.
    const update: Record<string, any> = rs.shipSchedule && typeof rs.shipSchedule === 'object'
      ? Object.fromEntries([...Object.entries(patch).map(([k, v]) => [`retailSettings.shipSchedule.${k}`, v]), ['retailSettings.shipSchedule.savedAt', at]])
      : { 'retailSettings.shipSchedule': JSON.parse(JSON.stringify({ ...s, ...patch, savedAt: at })) };
    try { await updateDoc(doc(fs, 'tenants', tenantId), update); setToast(`${what} saved`); }
    catch {
      setOver((o) => { const n: any = { ...o }; for (const k of Object.keys(patch)) delete n[k]; return n; });
      setToast(`${what} didn’t save. Try again.`);
    }
  };

  const today = dayKey(now, tz);
  const preview = productPromise({}, now, tz, s);
  const pickupNote = (() => {
    const rule = s.pickups.find((p) => p.days.length && (!preview.carrier || carrierKey(p.carrier) === carrierKey(preview.carrier) || p.carrier === preview.carrier));
    return rule ? `, then your ${rule.carrier} ${rule.kind === 'dropoff' ? 'drop-off' : 'pickup'} at ${clockLabel(rule.time)}` : '';
  })();
  const shipsNote = (s.processingDays === 0 ? 'The same day' : `${s.processingDays} business day${s.processingDays === 1 ? '' : 's'}`)
    + pickupNote + '.' + (preview.busy ? ` Includes ${preview.busy}.` : '');
  const firstPickup = s.pickups.length ? Math.min(...s.pickups.map((p) => minutes(p.time))) : null;
  const gap = firstPickup === null ? null : firstPickup - minutes(s.cutoff);
  const upcoming = React.useMemo(() => {
    const y = Number(today.slice(0, 4));
    return [...carrierHolidays(y), ...carrierHolidays(y + 1)].filter((h) => h.day >= today).slice(0, 2);
  }, [today]);
  const zoneName = (() => {
    try {
      const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' as any }).formatToParts(now).find((p) => p.type === 'timeZoneName');
      return part?.value || zoneLabel(tz, now);
    } catch { return zoneLabel(tz, now); }
  })();
  const closures = s.closures.map((c, i) => ({ ...c, i })).filter((c) => c.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1));
  const overrides = Object.entries(s.cutoffByDay).map(([d, t]) => ({ day: Number(d), time: t })).sort((a, b) => ORDER.indexOf(a.day) - ORDER.indexOf(b.day));
  const freeDays = s.shipDays.filter((d) => !(String(d) in s.cutoffByDay));
  const addCutoff = canEdit && freeDays.length > 0;

  const savePickup = () => {
    if (!pickup) return;
    const name = pickup.carrier === 'Other' ? pickup.other.trim().slice(0, 40) : pickup.carrier;
    if (!name) { setToast('Give the carrier a name.'); return; }
    if (!pickup.days.length) { setToast('Choose at least one day.'); return; }
    const rule: PickupRule = { carrier: name, days: pickup.days, time: pickup.time, kind: pickup.kind };
    const list = [...s.pickups];
    if (pickup.index >= 0) list[pickup.index] = rule; else list.push(rule);
    void save({ pickups: list }, 'Pickups');
    setPickup(null);
  };
  const saveClosure = () => {
    if (!closure) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closure.from)) { setToast('Choose the first day you’re closed.'); return; }
    const to = /^\d{4}-\d{2}-\d{2}$/.test(closure.to) ? closure.to : closure.from;
    const c: Closure = { from: closure.from <= to ? closure.from : to, to: closure.from <= to ? to : closure.from, ...(closure.label.trim() ? { label: closure.label.trim().slice(0, 60) } : {}) };
    // Closures that ended over a month ago are dropped as the list is saved, so it never grows forever.
    const keep = s.closures.filter((x, i) => i !== closure.index && x.to >= dayKey(new Date(now.getTime() - 31 * 86_400_000), tz));
    void save({ closures: [...keep, c] }, 'Closures');
    setClosure(null);
  };

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <Link href="/retail-orders/policies" className="inline-flex h-11 items-center gap-1 text-[17px]" style={{ color: C.ink }}>{Ic.back}Policies</Link>
        <LargeTitle title="Shipping schedule" sub={canEdit ? 'Changes save as you make them.' : 'Only a manager can change these.'} />

        {!zoneSet && (
          <div className="mt-5 rounded-2xl p-4 text-[15px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
            Your business time zone isn’t set, so these times are UTC. Set it in Settings, under Time zone, before you rely on the cutoff.
          </div>)}

        <Group foot="Your team sees due times from this schedule either way.">
          <Row label="Show ship-by dates to customers" note="On product pages, at checkout, in their email and on their order page." last>
            <Toggle label="Show ship-by dates to customers" on={s.showDates} disabled={!canEdit} onChange={(v) => void save({ showDates: v }, v ? 'Dates are on' : 'Dates are off')} />
          </Row>
        </Group>

        <Group title="Processing">
          <Row label="Ship the same day" note="Orders before the cutoff go out that day." last={s.processingDays === 0}>
            <Toggle label="Ship the same day" on={s.processingDays === 0} disabled={!canEdit} onChange={(v) => void save({ processingDays: v ? 0 : lastDays.current }, 'Processing time')} />
          </Row>
          {s.processingDays > 0 && (
            <Row label="Orders ship within" note="Business days after the order comes in. A product can take longer, in its Ships in setting." last>
              <Stepper label="Business days" value={s.processingDays} min={1} max={30} disabled={!canEdit} onChange={(n) => void save({ processingDays: n }, 'Processing time')} />
            </Row>)}
        </Group>

        <Group title="Ship days and cutoff" foot={`Times are ${zoneName}, your business time zone.`}>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3 pl-4 pr-4" style={{ borderBottom: `1px solid ${C.line}` }}>
            <p className="m-0 text-[17px] tracking-[-0.01em]">Ship days</p>
            <DayPills label="Ship days" value={s.shipDays} disabled={!canEdit} onChange={(v) => { if (!v.length) { setToast('Keep at least one ship day.'); return; } void save({ shipDays: v }, 'Ship days'); }} />
          </div>
          <Row label="Daily cutoff" note="Orders after this start on the next ship day." last={!overrides.length && !addCutoff}>
            <TimeField label="Daily cutoff" value={s.cutoff} disabled={!canEdit} onSave={(v) => void save({ cutoff: v }, 'Cutoff')} />
          </Row>
          {overrides.map((o, i) => (
            <Row key={o.day} label={PLURAL[o.day]} note={s.shipDays.includes(o.day) ? 'Its own cutoff.' : 'Not a ship day, so not used.'} last={i === overrides.length - 1 && !addCutoff}>
              <TimeField label={`${PLURAL[o.day]} cutoff`} value={o.time} disabled={!canEdit} onSave={(v) => void save({ cutoffByDay: { ...s.cutoffByDay, [String(o.day)]: v } }, 'Cutoff')} />
              {canEdit && <button type="button" onClick={() => { const n = { ...s.cutoffByDay }; delete n[String(o.day)]; void save({ cutoffByDay: n }, 'Cutoff'); }} className="cf-press h-10 shrink-0 px-1 text-[15px]" style={{ color: C.muted }}>Remove</button>}
            </Row>))}
          {addCutoff && <RowButton label="A different cutoff for one day" note="An earlier Friday, say." onClick={() => setDayCutoff({ day: freeDays.includes(5) ? 5 : freeDays[freeDays.length - 1], time: '12:00' })} last />}
        </Group>

        <section className="mt-7 rounded-2xl p-4" style={{ background: C.soft }}>
          <p className="m-0 pb-3 text-[13px] font-semibold" style={muted}>Right now</p>
          <Timeline rows={[
            { head: 'Order comes in', when: `${SHORT[new Date(`${today}T12:00:00Z`).getUTCDay()]} ${formatTime(now, tz)}`, note: startsReason(preview, s), dot: C.line },
            { head: 'Ships by', when: dayLabel(preview.shipBy, tz), note: shipsNote, dot: C.ink },
            { head: 'Arrives', when: arrivalLabel(preview, tz), note: `Your own shipping, ${s.standardTransit.min}–${s.standardTransit.max} days. Carrier rates at checkout use the carrier’s estimate.`, dot: C.mint },
          ]} />
        </section>

        <Group title="Carrier pickups" foot={gap === null ? 'Add the carriers that collect from you, or the time you drop boxes off. Ship-by dates land on those days, and the team’s due time is that pickup.' : gap > 0 ? `Your cutoff should leave time to pack before the first pickup. ${clockLabel(s.cutoff)} leaves ${hoursText(gap)}.` : <span style={{ color: C.warn }}>Your cutoff is at or after your first pickup, so a same-day order can miss it. An earlier cutoff gives the team time to pack.</span>}>
          {s.pickups.map((p, i) => (
            <RowButton key={`${p.carrier}-${i}`} label={p.carrier} value={daysLabel(p.days)} last={!canEdit && i === s.pickups.length - 1}
              note={p.kind === 'dropoff' ? `Drop off by ${clockLabel(p.time)}` : `${daysLabel(p.days) === 'Mon–Fri' ? 'Daily pickup' : 'Pickup'}, about ${clockLabel(p.time)}`}
              onClick={() => canEdit && setPickup({ index: i, carrier: (CARRIERS as readonly string[]).includes(p.carrier) ? p.carrier : 'Other', other: (CARRIERS as readonly string[]).includes(p.carrier) ? '' : p.carrier, kind: p.kind === 'dropoff' ? 'dropoff' : 'pickup', days: p.days, time: p.time })} />))}
          {canEdit
            ? <RowButton label="Add a carrier" onClick={() => setPickup({ index: -1, carrier: CARRIERS.find((c) => !s.pickups.some((p) => p.carrier === c)) || 'Other', other: '', kind: 'pickup', days: [...s.shipDays], time: '15:00' })} last />
            : s.pickups.length === 0 ? <Row label="No pickups yet" last /> : null}
        </Group>

        <Group title="Holidays and closures" foot="Orders that come in while you’re closed start on your first day back, and customers see that before they pay.">
          <Row label="Carrier holidays" last={!canEdit && closures.length === 0} note={`Days USPS, UPS and FedEx don’t pick up or deliver.${upcoming.length ? ` Next: ${upcoming.map((h) => `${h.name}, ${dayLabel(h.day, tz).replace(/^\w+, /, '')}`).join('; ')}.` : ''}`}>
            <Toggle label="Carrier holidays" on={s.carrierHolidays} disabled={!canEdit} onChange={(v) => void save({ carrierHolidays: v }, 'Carrier holidays')} />
          </Row>
          {closures.map((c, i) => (
            <RowButton key={`${c.from}-${c.i}`} label={c.label || 'Closed'} last={!canEdit && i === closures.length - 1} value={c.from === c.to ? dayLabel(c.from, tz) : `${dayLabel(c.from, tz).replace(/^\w+, /, '')} – ${dayLabel(c.to, tz).replace(/^\w+, /, '')}`}
              onClick={() => canEdit && setClosure({ index: c.i, label: c.label || '', from: c.from, to: c.to })} />))}
          {canEdit && <RowButton label="Add a closure" note="Inventory day, a trade show, a vacation." onClick={() => setClosure({ index: -1, label: '', from: '', to: '' })} last />}
        </Group>

        <Group title="Your own shipping" foot="For flat-rate shipping and the arrival dates on product pages. Carrier rates at checkout use the carrier’s own estimate.">
          <Row label="Arrives in" note="Days in transit after it ships." last>
            <span className="flex shrink-0 items-center gap-2 text-[15px]" style={muted}>
              <SmallNumber label="Fewest days in transit" value={s.standardTransit.min} min={1} max={60} disabled={!canEdit} onSave={(n) => void save({ standardTransit: { min: n, max: Math.max(n, s.standardTransit.max) } }, 'Transit time')} />
              to
              <SmallNumber label="Most days in transit" value={s.standardTransit.max} min={1} max={90} disabled={!canEdit} onSave={(n) => void save({ standardTransit: { min: Math.min(n, s.standardTransit.min), max: n } }, 'Transit time')} />
              days
            </span>
          </Row>
        </Group>

        <Group title="Shop page" foot="Only shown when ordering before the cutoff gets an earlier ship date, and only on days you ship.">
          <Row label="Cutoff countdown" note="“Order in the next 2 h 13 min” on product pages." last>
            <Toggle label="Cutoff countdown" on={s.countdown} disabled={!canEdit || !s.showDates} onChange={(v) => void save({ countdown: v }, 'Countdown')} />
          </Row>
        </Group>
      </div>

      {pickup && (
        <Sheet title={pickup.index >= 0 ? pickup.carrier === 'Other' ? pickup.other || 'Carrier' : pickup.carrier : 'Add a carrier'} onClose={() => setPickup(null)}>
          <div className="space-y-4 pt-2">
            <Seg value={pickup.carrier} onChange={(v) => setPickup({ ...pickup, carrier: v })} options={[...CARRIERS, 'Other'].map((c) => ({ id: c, label: c }))} />
            {pickup.carrier === 'Other' && (
              <input aria-label="Carrier name" placeholder="Carrier name" value={pickup.other} onChange={(e) => setPickup({ ...pickup, other: e.target.value })}
                className="block h-12 w-full rounded-xl border-0 px-4 text-[17px] outline-none ring-0 focus:ring-0" style={{ background: C.soft, color: C.ink }} />)}
            <Seg value={pickup.kind} onChange={(v) => setPickup({ ...pickup, kind: v })} options={[{ id: 'pickup', label: 'They pick up' }, { id: 'dropoff', label: 'We drop off' }]} />
            <div className="rounded-2xl" style={{ background: C.soft }}>
              <div className="flex flex-wrap items-center justify-between gap-3 py-3 pl-4 pr-4" style={{ borderBottom: `1px solid ${C.line}` }}>
                <p className="m-0 text-[17px]">Days</p>
                <DayPills label="Pickup days" value={pickup.days} onChange={(v) => setPickup({ ...pickup, days: v })} />
              </div>
              <Row label={pickup.kind === 'dropoff' ? 'Drop off by' : 'About'} note={pickup.kind === 'dropoff' ? 'The last time the team can drop boxes off.' : 'When they usually come.'} last>
                <TimeField live label="Pickup time" value={pickup.time} onSave={(v) => setPickup((p) => (p ? { ...p, time: v } : p))} />
              </Row>
            </div>
            <Btn kind="primary" className="w-full" onClick={savePickup}>Save</Btn>
            {pickup.index >= 0 && <Btn kind="danger" className="w-full" onClick={() => { void save({ pickups: s.pickups.filter((_, i) => i !== pickup.index) }, 'Pickups'); setPickup(null); }}>Remove this carrier</Btn>}
          </div>
        </Sheet>)}

      {closure && (
        <Sheet title={closure.index >= 0 ? 'Closure' : 'Add a closure'} sub="Orders that come in while you’re closed start on your first day back." onClose={() => setClosure(null)}>
          <div className="space-y-4 pt-2">
            <input aria-label="What it’s for" placeholder="Closed for the holidays" value={closure.label} onChange={(e) => setClosure({ ...closure, label: e.target.value })}
              className="block h-12 w-full rounded-xl border-0 px-4 text-[17px] outline-none ring-0 focus:ring-0" style={{ background: C.soft, color: C.ink }} />
            <div className="rounded-2xl" style={{ background: C.soft }}>
              <Row label="From">
                <input type="date" aria-label="First day closed" value={closure.from} min={today} onChange={(e) => setClosure({ ...closure, from: e.target.value, to: closure.to && closure.to < e.target.value ? e.target.value : closure.to })}
                  className="h-10 shrink-0 rounded-xl border-0 px-3 text-[17px] outline-none ring-0 focus:ring-0" style={{ background: C.paper, color: C.ink }} />
              </Row>
              <Row label="To" note="The last day closed. Leave it for one day." last>
                <input type="date" aria-label="Last day closed" value={closure.to} min={closure.from || today} onChange={(e) => setClosure({ ...closure, to: e.target.value })}
                  className="h-10 shrink-0 rounded-xl border-0 px-3 text-[17px] outline-none ring-0 focus:ring-0" style={{ background: C.paper, color: C.ink }} />
              </Row>
            </div>
            <Btn kind="primary" className="w-full" onClick={saveClosure}>Save</Btn>
            {closure.index >= 0 && <Btn kind="danger" className="w-full" onClick={() => { void save({ closures: s.closures.filter((_, i) => i !== closure.index) }, 'Closures'); setClosure(null); }}>Remove this closure</Btn>}
          </div>
        </Sheet>)}

      {dayCutoff && (
        <Sheet title="A different cutoff" sub="For one day of the week, like an earlier Friday." onClose={() => setDayCutoff(null)}>
          <div className="space-y-4 pt-2">
            <Seg value={String(dayCutoff.day)} onChange={(v) => setDayCutoff({ ...dayCutoff, day: Number(v) })} options={freeDays.map((d) => ({ id: String(d), label: SHORT[d] }))} />
            <div className="rounded-2xl" style={{ background: C.soft }}>
              <Row label={`${PLURAL[dayCutoff.day]} cutoff`} last>
                <TimeField live label="Cutoff" value={dayCutoff.time} onSave={(v) => setDayCutoff((d) => (d ? { ...d, time: v } : d))} />
              </Row>
            </div>
            <Btn kind="primary" className="w-full" onClick={() => { void save({ cutoffByDay: { ...s.cutoffByDay, [String(dayCutoff.day)]: dayCutoff.time } }, 'Cutoff'); setDayCutoff(null); }}>Save</Btn>
          </div>
        </Sheet>)}

      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={32} />}
    </div>);
}
