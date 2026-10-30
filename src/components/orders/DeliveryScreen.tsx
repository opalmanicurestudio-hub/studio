'use client';
// src/components/orders/DeliveryScreen.tsx — WAYS TO GET AN ORDER (Phase D, round 1; the rules are lib/delivery-plan).
// Which ways checkout offers (pickup, curbside, local delivery, "within N minutes", shipping), and local delivery
// itself: the zones (by distance from the shop, or by postal code) with each one's fee, order minimum, free-delivery
// amount and express charge; the delivery windows, how many orders each can take and who drives; the same-day cutoff.
// Everything saves together with Save changes, except where distance is measured from, which is looked up and kept at
// once. Opened from Shop settings.
import * as React from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { staffAuthHeader } from '@/lib/staff-fetch';
import {
  ASAP_MINUTES, MAX_CODES, MAX_SLOTS, MAX_ZONES, areaWords, asapOffer, deliveryWindows, driverLookup, driversOnDay, driversOnNow, money, nextSlot, notReady, planErrors, rings, slotWords, zip5,
  type DeliveryPlan, type DeliverySlot, type DeliveryZone,
} from '@/lib/delivery-plan';
import { closureOn, hasHours, type PickupPlan, type ShiftSpan } from '@/lib/pickup-slots';
import { dayKey } from '@/lib/tenant-time';
import { Btn, C, Ic, LargeTitle, Sheet, Toggle, UndoBar, muted } from './ui';

type Ways = { pickup: boolean; curbside: boolean; shipping: boolean; curbsideName: string };
type Place = { id: string; name: string; address: string };
type Loaded = { tenantId: string; plan: DeliveryPlan; shop: PickupPlan; ways: Ways; mapsReady: boolean; places: Place[]; team: { id: string; name: string }[]; shifts: ShiftSpan[]; booked: Record<string, number>; timeZone: string; zoneSet: boolean; canEdit: boolean };
type Settings = Omit<DeliveryPlan, 'origin'>;
type Draft = { s: Settings; ways: Omit<Ways, 'curbsideName'> };

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const settingsOf = (p: DeliveryPlan): Settings => { const { origin, ...rest } = p; void origin; return JSON.parse(JSON.stringify(rest)); };
const waysOf = (w: Ways) => ({ pickup: w.pickup, curbside: w.curbside, shipping: w.shipping });
const mins = (hm: string) => { if (hm === '24:00') return 1440; const m = /^(\d{2}):(\d{2})$/.exec(hm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const prepWords = (m: number) => {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} minutes`;
  return r ? `${h} h ${r} min` : `${h} hour${h === 1 ? '' : 's'}`;
};
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const card: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 20, background: C.paper };
const field = 'h-11 rounded-xl border px-3 text-[15px] outline-none focus-visible:ring-2';
const fieldStyle: React.CSSProperties = { borderColor: C.line, background: C.paper, color: C.ink };
const linkCls = 'cf-press inline-flex min-h-11 min-w-11 items-center justify-center text-[14px] font-semibold underline underline-offset-4 disabled:opacity-50';
const pill = (on: boolean): React.CSSProperties => (on ? { background: C.ink, color: C.paper, borderColor: C.ink } : { borderColor: C.line, background: C.paper, color: C.ink });

/** A time of day; only a whole time reaches the settings (as on Pickup times). */
function TimeInput({ value, onChange, label, disabled, closing }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean; closing?: boolean }) {
  const shown = closing && value === '24:00' ? '00:00' : value;
  const [v, setV] = React.useState(shown);
  React.useEffect(() => { setV(shown); }, [shown]);
  const whole = (t: string) => /^\d{2}:\d{2}$/.test(t);
  return <input type="time" step={900} aria-label={label} disabled={disabled} value={v}
    onChange={(e) => { setV(e.target.value); if (whole(e.target.value)) onChange(closing && e.target.value === '00:00' ? '24:00' : e.target.value); }}
    onBlur={() => { if (!whole(v)) setV(shown); }}
    className={`${field} w-[7.25rem] min-w-0 px-2 sm:w-[8.5rem] max-sm:[&::-webkit-calendar-picker-indicator]:hidden`} style={fieldStyle} />;
}

/**
 * A typed amount: what's typed stays as typed while the field is in use, and is read when it's left (or Enter). Left
 * empty or unreadable, the saved amount comes back.
 */
function useDraft<T>(shown: string, parse: (t: string) => T | null, apply: (x: T) => void) {
  const [v, setV] = React.useState(shown);
  const [left, setLeft] = React.useState(0);
  const editing = React.useRef(false); const start = React.useRef(shown);
  // Shown as saved, except while it's being typed in; tidied (5 → 5.00) once it's left.
  React.useEffect(() => { if (!editing.current) setV(shown); }, [shown, left]);
  return {
    value: v,
    onFocus: () => { editing.current = true; start.current = shown; },
    // Each readable amount is kept as it's typed, so Save is ready at once; what's on screen stays as typed.
    onChange: (t: string) => { setV(t); const x = parse(t); if (x !== null) apply(x); },
    // Left empty or unreadable: back to what it was before.
    onBlur: () => { editing.current = false; if (parse(v) === null) { const x = parse(start.current); if (x !== null) apply(x); } setLeft((n) => n + 1); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); },
  };
}

/** Dollars typed, cents kept. */
function MoneyInput({ cents, onChange, label, disabled }: { cents: number; onChange: (c: number) => void; label: string; disabled?: boolean }) {
  const d = useDraft((cents / 100).toFixed(2), (t) => { const n = Number(t); return t.trim() === '' || t === '.' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100); }, onChange);
  return (
    <span className="relative inline-flex items-center">
      <span aria-hidden="true" className="pointer-events-none absolute left-3 text-[15px]" style={muted}>$</span>
      <input inputMode="decimal" aria-label={label} disabled={disabled} value={d.value} onFocus={d.onFocus} onBlur={d.onBlur} onKeyDown={d.onKeyDown}
        onChange={(e) => d.onChange(e.target.value.replace(/[^\d.]/g, ''))} className={`${field} w-28 pl-6 text-right`} style={fieldStyle} />
    </span>);
}

/** A whole number from 1 to `max`. */
function CountInput({ n, onChange, label, disabled, max = 500 }: { n: number; onChange: (n: number) => void; label: string; disabled?: boolean; max?: number }) {
  const d = useDraft(String(n), (t) => { const x = Math.floor(Number(t)); return !t.trim() || !Number.isFinite(x) || x < 1 ? null : Math.min(max, x); }, onChange);
  return <input inputMode="numeric" aria-label={label} disabled={disabled} value={d.value} onFocus={d.onFocus} onBlur={d.onBlur} onKeyDown={d.onKeyDown}
    onChange={(e) => d.onChange(e.target.value.replace(/\D/g, '').slice(0, 3))} className={`${field} w-20 text-right`} style={fieldStyle} />;
}

function SetRow({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t py-3" style={{ borderColor: C.line }}>
      <div className="min-w-[12rem] flex-1"><p className="m-0 text-[15px] font-medium">{label}</p>{note ? <p className="m-0 mt-0.5 text-[13px] leading-snug" style={muted}>{note}</p> : null}</div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{children}</div>
    </div>);
}

/** One way to get an order, on the left card. */
function WayRow({ title, note, on, onChange, disabled, label, children }: { title: string; note: React.ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; children?: React.ReactNode }) {
  return (
    <div className="border-t py-3.5" style={{ borderColor: C.line }}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1"><p className="m-0 text-[16px] font-semibold">{title}</p><p className="m-0 mt-0.5 text-[13px] leading-snug" style={muted}>{note}</p></div>
        <Toggle label={label} on={on} disabled={disabled} onChange={onChange} />
      </div>
      {children}
    </div>);
}

const newZone = (list: DeliveryZone[], by: 'distance' | 'postal'): DeliveryZone => {
  const edges = list.map((z) => z.upToMiles || 0);
  const out = edges.length ? Math.max(...edges) : 0;
  const names = ['North', 'East', 'South', 'West', 'Downtown', 'Outer'];
  return {
    id: `z${Date.now().toString(36)}`, name: names.find((n) => !list.some((z) => z.name === n)) || `Zone ${list.length + 1}`,
    upToMiles: by === 'distance' ? (out ? out + 3 : 3) : null, postalCodes: [],
    feeCents: 500, minimumCents: 0, freeOverCents: null, expressCents: null, on: true,
  };
};

export function DeliveryScreen() {
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [zoneEdit, setZoneEdit] = React.useState<{ z: DeliveryZone; isNew: boolean; codes: string; miles: string; error?: string } | null>(null);
  const [slotEdit, setSlotEdit] = React.useState<{ i: number | null; s: DeliverySlot; error?: string } | null>(null);
  const [originOpen, setOriginOpen] = React.useState<{ address: string; busy: boolean; error?: string } | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  // Everything on screen belongs to one business: switching business clears it, and an answer for another one is
  // ignored, so one shop's draft can never be saved into another.
  const reqFor = React.useRef('');
  const dirtyRef = React.useRef(false);
  const load = React.useCallback(async () => {
    reqFor.current = tenantId;
    dirtyRef.current = false;
    setLoaded(null); setDraft(null); setFailed(false);
    if (!tenantId) return;
    try {
      const r = await fetch(`/api/retail/delivery-plan?tenantId=${encodeURIComponent(tenantId)}`, { headers: await staffAuthHeader(), cache: 'no-store' });
      const d = await r.json();
      if (reqFor.current !== tenantId) return;
      if (!r.ok) { setFailed(true); return; }
      setLoaded({ ...d, tenantId }); setDraft({ s: settingsOf(d.plan), ways: waysOf(d.ways) });
    } catch { if (reqFor.current === tenantId) setFailed(true); }
  }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  if (failed) return (
    <div className="mx-auto max-w-2xl px-4 pt-10" style={{ color: C.ink }}>
      <p className="text-[17px]">Delivery settings couldn’t be loaded.</p>
      <Btn kind="soft" className="mt-3" onClick={() => void load()}>Try again</Btn>
    </div>);
  if (!loaded || !draft || loaded.tenantId !== tenantId) return <div role="status" className="mx-auto max-w-2xl px-4 pt-10 text-[15px]" style={muted}>Loading delivery settings…</div>;

  const { canEdit, timeZone: tz, shop, mapsReady } = loaded;
  const s = draft.s;
  const dirty = JSON.stringify(draft) !== JSON.stringify({ s: settingsOf(loaded.plan), ways: waysOf(loaded.ways) });
  dirtyRef.current = dirty;
  const set = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, s: { ...d.s, ...patch } } : d));
  const setWay = (k: keyof Draft['ways'], v: boolean) => setDraft((d) => (d ? { ...d, ways: { ...d.ways, [k]: v } } : d));

  const plan: DeliveryPlan = { ...s, origin: loaded.plan.origin };
  // Zones or windows that contradict each other can't be saved; what's still missing stops only delivery that's on (a
  // half-set plan can be kept, off, while it's being worked on).
  const errors = planErrors(plan);
  const missing = notReady(plan, { mapsReady });
  const blocking = s.on ? [...errors, ...missing] : errors;
  const distance = s.by === 'distance';
  const zonesShown = distance ? [...rings(plan), ...s.zones.filter((z) => z.upToMiles === null)] : s.zones;
  const teamName = (id: string) => loaded.team.find((t) => t.id === id)?.name || 'Former team member';
  const driverSpans = loaded.shifts.filter((x) => s.drivers.includes(x.staffId));
  const byDrivers = s.perDriver !== null && s.drivers.length > 0;
  const lookup = byDrivers ? driverLookup(loaded.shifts, s.drivers, tz) : undefined;
  const windows = deliveryWindows(plan, shop, now, tz, loaded.booked, lookup);
  const today = dayKey(new Date(now), tz);
  // The day the window cards describe: the first day a customer could choose, else the next day deliveries run.
  const showDay = windows.find((w) => !w.full)?.day || windows[0]?.day || (() => {
    for (let i = 0; i < 14; i++) { const d = new Date(Date.parse(`${today}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10); if (s.days.includes(new Date(`${d}T12:00:00Z`).getUTCDay()) && !closureOn(shop, d)) return d; }
    return today;
  })();
  const slotOn = (sl: DeliverySlot) => {
    const a = mins(sl.start), b = mins(sl.end);
    const w = windows.find((x) => x.key === `${showDay}D${sl.start}`);
    const on = driverSpans.filter((x) => x.date === showDay && x.start < (b || 1440) && x.end > a);
    const names = [...new Set(on.map((x) => teamName(x.staffId).split(' ')[0]))];
    const n = byDrivers ? driversOnDay(loaded.shifts, s.drivers, showDay, a, b) : null;
    const cap = n === null || s.perDriver === null ? s.perWindow : Math.min(s.perWindow ?? Infinity, n * s.perDriver);
    return { label: slotWords(sl), w, names, cap };
  };
  const dayWords = showDay === today ? 'today' : new Date(`${showDay}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const asapZones = s.zones.filter((z) => z.on && z.expressCents !== null).map((z) => z.name);
  const asapNow = asapOffer(plan, shop, null, now, tz, s.drivers.length ? driversOnNow(driverSpans, now, tz) : null, 0);

  const save = async () => {
    if (!canEdit || saving || blocking.length) return;
    setSaving(true);
    try {
      if (loaded.tenantId !== tenantId) return;
      // Only what changed is sent, so saving here never puts back something changed elsewhere meanwhile.
      const before = settingsOf(loaded.plan); const planPatch: Record<string, any> = {};
      for (const k of Object.keys(s) as (keyof Settings)[]) if (JSON.stringify(s[k]) !== JSON.stringify(before[k])) planPatch[k] = s[k];
      const w0 = waysOf(loaded.ways); const waysPatch: Record<string, boolean> = {};
      for (const k of Object.keys(draft.ways) as (keyof Draft['ways'])[]) if (draft.ways[k] !== w0[k]) waysPatch[k] = draft.ways[k];
      const body: any = { tenantId };
      if (Object.keys(planPatch).length) body.plan = planPatch;
      if (Object.keys(waysPatch).length) body.ways = waysPatch;
      const r = await fetch('/api/retail/delivery-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (reqFor.current !== tenantId) return;
      if (!r.ok) { setToast(d.error || 'That didn’t save. Try again.'); return; }
      setLoaded((l) => (l && l.tenantId === tenantId ? { ...l, plan: d.plan, ways: d.ways } : l));
      setDraft({ s: settingsOf(d.plan), ways: waysOf(d.ways) });
      setToast(d.plan.on ? (loaded.zoneSet ? 'Saved. Checkout offers delivery now.' : 'Saved. Set your time zone to offer delivery times at checkout.') : 'Saved.');
    } catch { setToast('That didn’t save. Check your connection and try again.'); }
    finally { setSaving(false); }
  };

  const setOrigin = async (body: { address?: string; placeId?: string }) => {
    if (!canEdit || !originOpen) return;
    setOriginOpen({ ...originOpen, busy: true, error: undefined });
    try {
      const r = await fetch('/api/retail/delivery-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, origin: body }) });
      const d = await r.json().catch(() => ({}));
      if (reqFor.current !== tenantId) return;
      if (!r.ok) { setOriginOpen((o) => (o ? { ...o, busy: false, error: d.error || 'That didn’t save. Try again.' } : o)); return; }
      // Only where it's measured from changes on screen: the rest of what's being edited stays as it is.
      setLoaded((l) => (l && l.tenantId === tenantId ? { ...l, plan: { ...l.plan, origin: d.plan.origin } } : l));
      setOriginOpen(null); setToast(`Deliveries are measured from ${d.plan.origin?.label || 'there'} now.`);
    } catch { setOriginOpen((o) => (o ? { ...o, busy: false, error: 'That didn’t save. Check your connection and try again.' } : o)); }
  };

  const applyZone = () => {
    if (!zoneEdit) return;
    const z = { ...zoneEdit.z, name: zoneEdit.z.name.trim().slice(0, 40) || 'Zone' };
    if (!distance) {
      const parts = zoneEdit.codes.split(/[\s,;]+/).filter(Boolean);
      const codes = [...new Set(parts.map(zip5).filter(Boolean))];
      const badOnes = parts.filter((p) => !zip5(p));
      if (badOnes.length) { setZoneEdit({ ...zoneEdit, error: `${listWords(badOnes.slice(0, 3))} ${badOnes.length === 1 ? 'isn’t a' : 'aren’t'} five-digit ZIP code${badOnes.length === 1 ? '' : 's'}.` }); return; }
      if (!codes.length) { setZoneEdit({ ...zoneEdit, error: 'Add at least one ZIP code.' }); return; }
      if (codes.length > MAX_CODES) { setZoneEdit({ ...zoneEdit, error: `Up to ${MAX_CODES} codes a zone. Split them into two zones.` }); return; }
      z.postalCodes = codes;
    } else {
      const m = Number(zoneEdit.miles.replace(/[^\d.]/g, ''));
      if (!(m > 0)) { setZoneEdit({ ...zoneEdit, error: 'Say how far this zone reaches, in miles.' }); return; }
      if (m > 100) { setZoneEdit({ ...zoneEdit, error: 'Zones reach up to 100 miles.' }); return; }
      z.upToMiles = Math.round(m * 10) / 10;
    }
    set({ zones: zoneEdit.isNew ? [...s.zones, z] : s.zones.map((x) => (x.id === z.id ? z : x)) });
    setZoneEdit(null);
  };
  const applySlot = () => {
    if (!slotEdit) return;
    const { i, s: sl } = slotEdit;
    if (!(mins(sl.end) > mins(sl.start))) { setSlotEdit({ ...slotEdit, error: 'The window has to end after it starts.' }); return; }
    const others = s.slots.filter((_, j) => j !== i);
    if (others.some((o) => mins(sl.start) < mins(o.end) && mins(o.start) < mins(sl.end))) { setSlotEdit({ ...slotEdit, error: 'That overlaps another window. Change the times so they don’t.' }); return; }
    set({ slots: [...others, sl].sort((a, b) => mins(a.start) - mins(b.start)) });
    setSlotEdit(null);
  };

  const zoneCount = s.zones.filter((z) => z.on).length;

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-6xl px-4 pt-3">
        <Link href="/retail-orders/settings" onClick={(e) => { if (dirty && !window.confirm('Leave without saving your changes?')) e.preventDefault(); }} className="inline-flex h-11 items-center gap-1 text-[17px]" style={{ color: C.ink }}>{Ic.back}Shop settings</Link>
        <LargeTitle title="Ways to get an order" sub={canEdit ? 'What checkout offers, and where and when you deliver.' : 'Only a manager can change these.'}
          right={canEdit ? <Btn kind="primary" disabled={!dirty || saving || blocking.length > 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Btn> : undefined} />
        {!loaded.zoneSet && (
          <p role="alert" className="m-0 mt-5 rounded-2xl p-4 text-[15px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
            Your business time zone isn’t set, so checkout won’t offer delivery times yet: they’d land hours off. Set it in Settings, under Time zone.
          </p>)}
        {blocking.length > 0 && (
          <ul role="alert" className="m-0 mt-5 list-none space-y-1 rounded-2xl p-4 text-[14px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
            {blocking.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}
          </ul>)}
        {!s.on && missing.length > 0 && s.zones.length + s.slots.length > 0 && (
          <div className="m-0 mt-5 rounded-2xl p-4 text-[14px] leading-snug" style={{ background: C.soft }}>
            <p className="m-0 font-semibold">Before delivery can be turned on</p>
            <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5">{missing.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}</ul>
          </div>)}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)] lg:items-start">
          <section aria-labelledby="ways-h" className="min-w-0 p-5" style={card}>
            <h2 id="ways-h" className="m-0 mb-1 text-[13px] font-semibold" style={muted}>Offered at checkout</h2>
            <WayRow title="Pickup in the shop" label="Offer pickup in the shop" on={draft.ways.pickup} disabled={!canEdit} onChange={(v) => setWay('pickup', v)}
              note={<>Ready in {prepWords(shop.prepMinutes)}{hasHours(shop) ? ' · during pickup hours' : ''} · <Link href="/retail-orders/policies/pickup" className="underline underline-offset-2">Pickup times</Link></>} />
            <WayRow title={loaded.ways.curbsideName} label={`Offer ${loaded.ways.curbsideName.toLowerCase()}`} on={draft.ways.curbside} disabled={!canEdit} onChange={(v) => setWay('curbside', v)}
              note="We bring it out to the car" />
            <WayRow title="Local delivery" label="Offer local delivery" on={s.on} disabled={!canEdit} onChange={(v) => set({ on: v })}
              note={s.on ? `By your team · ${zoneCount} zone${zoneCount === 1 ? '' : 's'} · ${s.slots.length} window${s.slots.length === 1 ? '' : 's'} a day` : 'Off. Set zones and windows, then turn it on.'} />
            <WayRow title={`Within ${s.asap.minutes} minutes`} label={`Offer delivery within ${s.asap.minutes} minutes`} on={s.asap.on} disabled={!canEdit} onChange={(v) => set({ asap: { ...s.asap, on: v } })}
              note={!s.drivers.length ? <span style={{ color: C.warn }}>Choose who drives first, below</span> : `Only when a driver is free${asapZones.length ? ` · ${listWords(asapZones)}` : ' · no zone offers it yet'}`}>
              {s.asap.on && (
                <label className="mt-2 flex items-center gap-2 text-[14px]"><span style={muted}>Arrives within</span>
                  <select aria-label="Arrives within" disabled={!canEdit} value={s.asap.minutes} onChange={(e) => set({ asap: { ...s.asap, minutes: Number(e.target.value) } })} className={field} style={fieldStyle}>
                    {ASAP_MINUTES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </select></label>)}
            </WayRow>
            <WayRow title="Shipping" label="Offer shipping" on={draft.ways.shipping} disabled={!canEdit} onChange={(v) => setWay('shipping', v)} note="Labels from Orders" />
            <WayRow title="Delivery providers" label="Delivery providers (coming later)" on={false} disabled onChange={() => {}} note="Later: a courier service when no one’s free" />
          </section>

          <div className="min-w-0 space-y-5">
            <section aria-labelledby="zones-h" className="p-5" style={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="zones-h" className="m-0 text-[13px] font-semibold" style={muted}>Delivery zones · {distance ? 'by distance from the shop' : 'by postal code'}</h2>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Btn kind="soft" className="h-11" onClick={() => set({ by: distance ? 'postal' : 'distance' })}>{distance ? 'Use postal codes instead' : 'Use distance instead'}</Btn>
                    <Btn kind="soft" className="h-11" disabled={s.zones.length >= MAX_ZONES} onClick={() => { const z = newZone(s.zones, s.by); setZoneEdit({ z, isNew: true, codes: '', miles: z.upToMiles === null ? '' : String(z.upToMiles) }); }}>Add a zone</Btn>
                  </div>)}
              </div>
              {distance && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-3.5 py-2.5 text-[14px]" style={{ background: C.soft }}>
                  {!mapsReady ? <span style={{ color: C.warn }}>Distance zones aren’t available yet. Use postal codes for now.</span>
                    : plan.origin ? <span className="min-w-0 flex-1">Measured in a straight line from <span className="font-semibold">{plan.origin.label}</span></span>
                      : <span className="min-w-0 flex-1" style={{ color: C.warn }}>Set where deliveries start from, so distance can be measured.</span>}
                  {mapsReady && canEdit && <button type="button" className={linkCls} onClick={() => setOriginOpen({ address: loaded.places[0]?.address || '', busy: false })}>{plan.origin ? 'Change' : 'Set it'}</button>}
                </div>)}
              {zonesShown.length === 0 ? (
                <p className="m-0 mt-3 border-t py-3 text-[15px]" style={{ ...muted, borderColor: C.line }}>No zones yet. Add one for each area you deliver to{distance ? ', from the nearest out' : ''}.</p>
              ) : (<>
                <div className="mt-3 hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left text-[14px]">
                    <thead><tr style={muted} className="text-[13px]">
                      {['Zone', 'Area', 'Delivery fee', 'Order minimum', 'Free over', `Within ${s.asap.minutes} min`, 'On'].map((h) => <th key={h} scope="col" className="border-b px-2 py-2 font-medium first:pl-0" style={{ borderColor: C.line }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {zonesShown.map((z) => (
                        <tr key={z.id} className="border-b" style={{ borderColor: C.line, opacity: z.on ? 1 : 0.55 }}>
                          <th scope="row" className="py-1 pr-2 font-semibold">
                            {canEdit ? <button type="button" className="cf-press min-h-11 text-left underline-offset-4 hover:underline" aria-label={`Edit ${z.name}`} onClick={() => setZoneEdit({ z: { ...z }, isNew: false, codes: z.postalCodes.join(', '), miles: z.upToMiles === null ? '' : String(z.upToMiles) })}>{z.name}</button> : z.name}
                          </th>
                          <td className="px-2">{areaWords(plan, z)}</td>
                          <td className="px-2">{money(z.feeCents)}</td>
                          <td className="px-2">{z.minimumCents ? money(z.minimumCents) : 'None'}</td>
                          <td className="px-2">{z.freeOverCents === null ? 'None' : money(z.freeOverCents)}</td>
                          <td className="px-2">{z.expressCents === null ? 'Not offered' : `+${money(z.expressCents)}`}</td>
                          <td className="px-2">{z.on ? 'Yes' : 'No'}</td>
                        </tr>))}
                    </tbody>
                  </table>
                </div>
                <ul className="m-0 mt-2 list-none p-0 md:hidden">
                  {zonesShown.map((z) => (
                    <li key={z.id} className="border-t" style={{ borderColor: C.line, opacity: z.on ? 1 : 0.55 }}>
                      <button type="button" disabled={!canEdit} onClick={() => setZoneEdit({ z: { ...z }, isNew: false, codes: z.postalCodes.join(', '), miles: z.upToMiles === null ? '' : String(z.upToMiles) })} className="cf-press flex min-h-14 w-full items-center gap-3 py-2.5 text-left disabled:opacity-100">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{z.name}{z.on ? '' : ' · off'}</span>
                          <span className="block text-[13px] leading-snug" style={muted}>{areaWords(plan, z)} · {money(z.feeCents)}{z.minimumCents ? ` · ${money(z.minimumCents)} minimum` : ''}{z.freeOverCents !== null ? ` · free over ${money(z.freeOverCents)}` : ''}{z.expressCents !== null ? ` · +${money(z.expressCents)} within ${s.asap.minutes} min` : ''}</span>
                        </span>
                        {canEdit && <span style={muted}>{Ic.chev}</span>}
                      </button>
                    </li>))}
                </ul>
              </>)}
              <p className="m-0 mt-3 text-[13px] leading-snug" style={muted}>Fees are what the customer pays. {distance ? 'An address farther than the last zone sees that you don’t deliver there yet.' : 'An address with a code that isn’t listed sees that you don’t deliver there yet.'}</p>
            </section>

            <section aria-labelledby="win-h" className="p-5" style={card}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 id="win-h" className="m-0 text-[13px] font-semibold" style={muted}>Delivery windows and how many each can take</h2>
                <span className="text-[13px]" style={muted}>{byDrivers ? 'Worked out from who’s on the schedule to drive' : s.perWindow === null ? 'No limit' : `Up to ${s.perWindow} orders each`}</span>
              </div>
              <p className="m-0 mt-2 text-[13px]" style={muted}>{s.slots.length ? `For ${dayWords}` : 'No windows yet.'}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {s.slots.map((sl, i) => {
                  const o = slotOn(sl);
                  const sub = [byDrivers ? (o.names.length ? listWords(o.names) : 'No driver on the schedule') : '', o.cap === null ? 'no limit' : `${o.cap} order${o.cap === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
                  const state = !o.w ? (s.days.includes(new Date(`${showDay}T12:00:00Z`).getUTCDay()) ? 'too late to choose now' : '') : o.w.full ? 'full' : o.w.left !== null && o.w.left < (o.cap ?? 0) ? `${o.w.left} left` : '';
                  return (
                    <button key={`${sl.start}-${i}`} type="button" disabled={!canEdit} onClick={() => setSlotEdit({ i, s: { ...sl } })}
                      className="cf-press min-h-14 rounded-xl px-3 py-2 text-left disabled:opacity-100" style={{ background: C.soft }} aria-label={`Edit the ${o.label} window`}>
                      <span className="block text-[15px] font-semibold">{o.label}</span>
                      <span className="block text-[13px] leading-snug" style={muted}>{sub.charAt(0).toUpperCase() + sub.slice(1)}{state ? ` · ${state}` : ''}</span>
                    </button>);
                })}
                {canEdit && s.slots.length < MAX_SLOTS && (
                  <button type="button" onClick={() => setSlotEdit({ i: null, s: nextSlot(s.slots) })} className="cf-press min-h-14 rounded-xl border border-dashed px-3 text-[15px] font-semibold" style={{ borderColor: C.line }}>Add a window</button>)}
              </div>
              <div className="mt-3">
                <SetRow label="Delivery days">
                  <span role="group" aria-label="Delivery days" className="flex flex-wrap gap-1.5">
                    {DAY_ORDER.map((d) => (
                      <button key={d} type="button" aria-pressed={s.days.includes(d)} disabled={!canEdit} onClick={() => set({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort() })}
                        className="cf-press h-11 min-w-11 rounded-full border px-3 text-[14px] font-semibold disabled:opacity-60" style={pill(s.days.includes(d))}>{DAY_SHORT[d]}</button>))}
                  </span>
                </SetRow>
                <SetRow label="Same-day orders close at" note={s.sameDayCutoff ? 'After this, the first window offered is on the next delivery day' : 'No cutoff: same-day windows while the order can still be ready'}>
                  {s.sameDayCutoff !== null && <TimeInput label="Same-day orders close at" value={s.sameDayCutoff} disabled={!canEdit} onChange={(v) => set({ sameDayCutoff: v })} />}
                  {canEdit && <button type="button" className={linkCls} onClick={() => set({ sameDayCutoff: s.sameDayCutoff === null ? '15:00' : null })}>{s.sameDayCutoff === null ? 'Set a cutoff' : 'No cutoff'}</button>}
                </SetRow>
                <SetRow label="Orders each window can take" note={s.perWindow === null ? 'No limit' : 'A full window shows as full at checkout'}>
                  {s.perWindow !== null && <CountInput label="Orders each window can take" disabled={!canEdit} n={s.perWindow} onChange={(n) => set({ perWindow: n })} />}
                  {canEdit && <button type="button" className={linkCls} onClick={() => set({ perWindow: s.perWindow === null ? 6 : null })}>{s.perWindow === null ? 'Set a limit' : 'No limit'}</button>}
                </SetRow>
                <SetRow label="Size windows by who’s driving" note={`From the schedule: ${s.perDriver ?? 4} order${(s.perDriver ?? 4) === 1 ? '' : 's'} for each driver on shift through the window${s.perWindow !== null ? ', never more than the limit above' : ''}. A day with no shifts posted uses the limit above; a day with shifts but no driver on has no windows.`}>
                  {s.perDriver !== null && <CountInput label="Orders for each driver on shift" disabled={!canEdit} n={s.perDriver} onChange={(n) => set({ perDriver: n })} />}
                  <Toggle label="Size windows by who’s driving" on={s.perDriver !== null} disabled={!canEdit} onChange={(v) => set({ perDriver: v ? 4 : null })} />
                </SetRow>
                <SetRow label="Who drives" note={loaded.team.length ? 'Their shifts size the windows, and decide when “within minutes” can be offered.' : 'Add your team in Staff first.'}>
                  <span role="group" aria-label="Who drives" className="flex max-w-full flex-wrap gap-1.5">
                    {loaded.team.map((t) => (
                      <button key={t.id} type="button" aria-pressed={s.drivers.includes(t.id)} disabled={!canEdit} onClick={() => set({ drivers: s.drivers.includes(t.id) ? s.drivers.filter((x) => x !== t.id) : [...s.drivers, t.id] })}
                        className="cf-press h-11 rounded-full border px-3.5 text-[14px] font-semibold disabled:opacity-60" style={pill(s.drivers.includes(t.id))}>{t.name}</button>))}
                    {s.drivers.filter((id) => !loaded.team.some((t) => t.id === id)).length > 0 && <span className="text-[13px]" style={muted}>Former team members come off the list when you save.</span>}
                  </span>
                </SetRow>
                <SetRow label="Show windows for the next">
                  <CountInput label="Show windows for the next, in days" disabled={!canEdit} n={s.daysAhead} max={30} onChange={(n) => set({ daysAhead: n })} />
                  <span className="text-[15px]">days</span>
                </SetRow>
              </div>
              <p className="m-0 mt-2 text-[13px] leading-snug" style={muted}>
                A window is offered only if the order can be ready before it starts ({prepWords(shop.prepMinutes)} to get ready). Closed days in Pickup times have no deliveries either.
                {s.asap.on ? (asapNow.ok ? ` Within ${s.asap.minutes} minutes is on offer right now.` : asapNow.why === 'prep' ? ` Within ${s.asap.minutes} minutes isn’t offered: orders take longer than that to get ready.` : '') : ''}
              </p>
            </section>

            <section aria-labelledby="door-h" className="p-5" style={card}>
              <h2 id="door-h" className="m-0 text-[13px] font-semibold" style={muted}>At the door</h2>
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#16171a]" checked={s.dropoffNotes} disabled={!canEdit} onChange={(e) => set({ dropoffNotes: e.target.checked })} />
                <span>Customers may say where it can be left<span className="block text-[13px]" style={muted}>A note at checkout for the driver: a gate code, leave it at the door, hand it to me.</span></span>
              </label>
            </section>
          </div>
        </div>
      </div>

      {zoneEdit && (
        <Sheet title={zoneEdit.isNew ? 'Add a zone' : `Edit ${zoneEdit.z.name}`} sub={distance ? 'A ring around the shop, from the edge of the zone inside it.' : 'The ZIP codes this zone covers.'} onClose={() => setZoneEdit(null)}>
          <div className="space-y-4 pt-2">
            <label className="block"><span className="block text-[13px] font-semibold" style={muted}>Name (customers don’t see it)</span>
              <input value={zoneEdit.z.name} maxLength={40} onChange={(e) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, name: e.target.value } })} className={`${field} mt-1.5 w-full`} style={fieldStyle} /></label>
            {distance ? (
              <label className="block"><span className="block text-[13px] font-semibold" style={muted}>Reaches up to (miles from the shop)</span>
                <input inputMode="decimal" value={zoneEdit.miles} onChange={(e) => setZoneEdit({ ...zoneEdit, error: undefined, miles: e.target.value.replace(/[^\d.]/g, '').slice(0, 5) })} className={`${field} mt-1.5 w-32`} style={fieldStyle} /></label>
            ) : (
              <label className="block"><span className="block text-[13px] font-semibold" style={muted}>ZIP codes, separated by commas</span>
                <textarea rows={3} value={zoneEdit.codes} placeholder="97204, 97205, 97209" onChange={(e) => setZoneEdit({ ...zoneEdit, error: undefined, codes: e.target.value })} className="mt-1.5 w-full rounded-xl border px-3 py-2 text-[15px] outline-none focus-visible:ring-2" style={fieldStyle} /></label>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="block text-[13px] font-semibold" style={muted}>Delivery fee</span>
                <span className="mt-1.5 block"><MoneyInput label="Delivery fee" cents={zoneEdit.z.feeCents} onChange={(c) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, feeCents: Math.min(50_000, c) } })} /></span></label>
              <label className="block"><span className="block text-[13px] font-semibold" style={muted}>Order minimum (0 for none)</span>
                <span className="mt-1.5 block"><MoneyInput label="Order minimum" cents={zoneEdit.z.minimumCents} onChange={(c) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, minimumCents: Math.min(100_000, c) } })} /></span></label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="m-0 text-[15px] font-medium">Free delivery over an amount</p><p className="m-0 text-[13px]" style={muted}>Items worth this much or more deliver free</p></div>
              <span className="flex items-center gap-2">
                {zoneEdit.z.freeOverCents !== null && <MoneyInput label="Free delivery over" cents={zoneEdit.z.freeOverCents} onChange={(c) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, freeOverCents: Math.min(1_000_000, c) } })} />}
                <Toggle label="Free delivery over an amount" on={zoneEdit.z.freeOverCents !== null} onChange={(v) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, freeOverCents: v ? 7500 : null } })} />
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="m-0 text-[15px] font-medium">Within {s.asap.minutes} minutes here</p><p className="m-0 text-[13px]" style={muted}>The extra charge, added to the fee</p></div>
              <span className="flex items-center gap-2">
                {zoneEdit.z.expressCents !== null && <MoneyInput label="Extra for delivery within minutes" cents={zoneEdit.z.expressCents} onChange={(c) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, expressCents: Math.min(50_000, c) } })} />}
                <Toggle label={`Offer delivery within ${s.asap.minutes} minutes in this zone`} on={zoneEdit.z.expressCents !== null} onChange={(v) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, expressCents: v ? 600 : null } })} />
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><p className="m-0 text-[15px] font-medium">Delivering here</p><p className="m-0 text-[13px]" style={muted}>Off: addresses in this zone see that you don’t deliver there yet</p></div>
              <Toggle label="Delivering to this zone" on={zoneEdit.z.on} onChange={(v) => setZoneEdit({ ...zoneEdit, z: { ...zoneEdit.z, on: v } })} />
            </div>
            {zoneEdit.error && <p role="alert" className="m-0 rounded-xl px-3 py-2 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>{zoneEdit.error}</p>}
            <Btn kind="primary" className="w-full" onClick={applyZone}>{zoneEdit.isNew ? 'Add' : 'Done'}</Btn>
            {!zoneEdit.isNew && <Btn kind="danger" className="w-full" onClick={() => { set({ zones: s.zones.filter((x) => x.id !== zoneEdit.z.id) }); setZoneEdit(null); }}>Remove this zone</Btn>}
            <p className="m-0 text-[13px]" style={muted}>Then Save changes. Orders already placed keep the fee they paid.</p>
          </div>
        </Sheet>)}

      {slotEdit && (
        <Sheet title={slotEdit.i === null ? 'Add a delivery window' : 'Edit the window'} sub="The same windows run on every delivery day." onClose={() => setSlotEdit(null)}>
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <TimeInput label="Window starts" value={slotEdit.s.start} onChange={(v) => setSlotEdit({ ...slotEdit, error: undefined, s: { ...slotEdit.s, start: v } })} />
              <span className="text-[14px]" style={muted}>to</span>
              <TimeInput closing label="Window ends" value={slotEdit.s.end} onChange={(v) => setSlotEdit({ ...slotEdit, error: undefined, s: { ...slotEdit.s, end: v } })} />
            </div>
            {slotEdit.error && <p role="alert" className="m-0 rounded-xl px-3 py-2 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>{slotEdit.error}</p>}
            <Btn kind="primary" className="w-full" onClick={applySlot}>{slotEdit.i === null ? 'Add' : 'Done'}</Btn>
            {slotEdit.i !== null && <Btn kind="danger" className="w-full" onClick={() => { set({ slots: s.slots.filter((_, j) => j !== slotEdit.i) }); setSlotEdit(null); }}>Remove this window</Btn>}
            <p className="m-0 text-[13px]" style={muted}>Then Save changes. Orders already placed keep the window they chose.</p>
          </div>
        </Sheet>)}

      {originOpen && (
        <Sheet title="Where deliveries start" sub="Distance to each address is measured in a straight line from here." onClose={() => setOriginOpen(null)}>
          <div className="space-y-4 pt-2">
            {loaded.places.map((p) => (
              <Btn key={p.id} kind="soft" className="h-auto min-h-12 w-full justify-start py-2 text-left" disabled={originOpen.busy} onClick={() => void setOrigin({ placeId: p.id })}>
                <span className="block"><span className="block font-semibold">Use {p.name}</span>{p.address ? <span className="block text-[13px] font-normal" style={muted}>{p.address}</span> : null}</span>
              </Btn>))}
            <label className="block"><span className="text-[13px] font-semibold" style={muted}>{loaded.places.length ? 'Or type the street address' : 'The shop’s street address'}</span>
              <input value={originOpen.address} maxLength={200} placeholder="12 Main St, Portland, OR 97204" onChange={(e) => setOriginOpen({ ...originOpen, address: e.target.value, error: undefined })}
                onKeyDown={(e) => { if (e.key === 'Enter' && originOpen.address.trim().length >= 5) void setOrigin({ address: originOpen.address }); }}
                className={`${field} mt-1.5 w-full`} style={fieldStyle} /></label>
            {originOpen.error && <p role="alert" className="m-0 rounded-xl px-3 py-2 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>{originOpen.error}</p>}
            <Btn kind="primary" className="w-full" disabled={originOpen.busy || originOpen.address.trim().length < 5} onClick={() => void setOrigin({ address: originOpen.address })}>{originOpen.busy ? 'Finding it…' : 'Find it and use it'}</Btn>
            <p className="m-0 text-[13px]" style={muted}>This saves at once. Orders already placed keep the fee they paid.</p>
          </div>
        </Sheet>)}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={32} />}
    </div>);
}
