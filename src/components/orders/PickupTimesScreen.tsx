'use client';
// src/components/orders/PickupTimesScreen.tsx — PICKUP TIMES (Phase C; the rules are lib/pickup-slots). When customers
// can collect an online order: opening hours for pickup, closed days, how long each pickup window is and how many orders
// it can take (a set number, or so many for each person on shift through it), the time an order takes to get ready,
// the same-day cutoff and how far ahead to show. The settings save together with Save changes; pausing online pickup
// happens at once, on its own. Beside them, what customers see at checkout right now, worked out by the same rules
// checkout uses, with the orders already booked and the team's shifts. Opened from Shop settings.
import * as React from 'react';
import Link from 'next/link';
import { useTenant } from '@/context/TenantContext';
import { staffAuthHeader } from '@/lib/staff-fetch';
import {
  closureOn, hasHours, isPaused, noPickupReason, pauseEndWords, pickupWindows, readyBy, shiftLookup, whenLabel,
  type PickupPlan, type ShiftSpan, type Stretch,
} from '@/lib/pickup-slots';
import { dayKey } from '@/lib/tenant-time';
import { Btn, C, Ic, LargeTitle, Sheet, Toggle, UndoBar, muted } from './ui';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WINDOW_SIZES = [30, 60, 120];
const PREP = [15, 30, 45, 60, 90, 120, 180, 240, 1440, 2880];
const prepWords = (m: number) => {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} minute${r === 1 ? '' : 's'}`;
  return r ? `${h} h ${r} min` : `${h} hour${h === 1 ? '' : 's'}`;
};
/** "18:00" → "6 pm", "24:00" → "midnight": problems read in the shop's words, not a 24-hour clock. */
const clock = (hm: string) => {
  if (hm === '24:00' || hm === '00:00') return 'midnight';
  const n = mins(hm); if (!Number.isFinite(n)) return hm;
  const h = Math.floor(n / 60), m = n % 60, h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
};
const sizeWords = (m: number) => (m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? '' : 's'}`);
const mins = (hm: string) => { if (hm === '24:00') return 1440; const m = /^(\d{2}):(\d{2})$/.exec(hm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

type Settings = Pick<PickupPlan, 'hours' | 'closures' | 'windowMinutes' | 'perWindow' | 'perPerson' | 'prepMinutes' | 'sameDayCutoff' | 'daysAhead'>;
const settingsOf = (p: PickupPlan): Settings => ({ hours: p.hours, closures: p.closures, windowMinutes: p.windowMinutes, perWindow: p.perWindow, perPerson: p.perPerson, prepMinutes: p.prepMinutes, sameDayCutoff: p.sameDayCutoff, daysAhead: p.daysAhead });

const card: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 20, background: C.paper };
const field = 'h-11 rounded-xl border px-3 text-[15px] outline-none focus-visible:ring-2';
const fieldStyle: React.CSSProperties = { borderColor: C.line, background: C.paper, color: C.ink };
const linkCls = 'cf-press inline-flex min-h-11 min-w-11 items-center justify-center text-[14px] font-semibold underline underline-offset-4 disabled:opacity-50';

/**
 * A time of day. Only a whole time reaches the settings: while a part of it is being retyped, the last whole time
 * stays, and leaving it half-typed puts that back. A closing time of midnight is kept as 24:00 and shown as 12:00 am.
 */
function TimeInput({ value, onChange, label, disabled, closing }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean; closing?: boolean }) {
  const shown = closing && value === '24:00' ? '00:00' : value;
  const [v, setV] = React.useState(shown);
  React.useEffect(() => { setV(shown); }, [shown]);
  const whole = (t: string) => /^\d{2}:\d{2}$/.test(t);
  return <input type="time" step={900} aria-label={label} disabled={disabled} value={v}
    onChange={(e) => { setV(e.target.value); if (whole(e.target.value)) onChange(closing && e.target.value === '00:00' ? '24:00' : e.target.value); }}
    onBlur={() => { if (!whole(v)) setV(shown); }}
    className={`${field} w-[7.25rem] min-w-0 px-2 text-[15px] sm:w-[8.5rem] max-sm:[&::-webkit-calendar-picker-indicator]:hidden`} style={fieldStyle} />;
}

/** One row of the settings card: what it is, a line on what it does, and its control. */
function SetRow({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t py-3" style={{ borderColor: C.line }}>
      <div className="min-w-[12rem] flex-1"><p className="m-0 text-[15px] font-medium">{label}</p>{note ? <p className="m-0 mt-0.5 text-[13px] leading-snug" style={muted}>{note}</p> : null}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>);
}

export function PickupTimesScreen() {
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const [loaded, setLoaded] = React.useState<{ tenantId: string; plan: PickupPlan; zoneSet: boolean; timeZone: string; booked: Record<string, number>; shifts: ShiftSpan[]; canEdit: boolean } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [draft, setDraft] = React.useState<Settings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [closure, setClosure] = React.useState<{ from: string; to: string; note: string; error?: string } | null>(null);
  const [note, setNote] = React.useState('');
  const [personEach, setPersonEach] = React.useState(3);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  // Everything on screen belongs to one business: switching business clears it, and an answer for another one (a slow
  // load from before the switch) is ignored, so one shop's draft can never be saved into another.
  const reqFor = React.useRef('');
  const load = React.useCallback(async () => {
    reqFor.current = tenantId;
    dirtyRef.current = false;
    setLoaded(null); setDraft(null); setFailed(false);
    if (!tenantId) return;
    try {
      const r = await fetch(`/api/retail/pickup-plan?tenantId=${encodeURIComponent(tenantId)}`, { headers: await staffAuthHeader(), cache: 'no-store' });
      const d = await r.json();
      if (reqFor.current !== tenantId) return;
      if (!r.ok) { setFailed(true); return; }
      setLoaded({ ...d, tenantId }); setDraft(settingsOf(d.plan)); setNote(d.plan.pauseNote || '');
      if (d.plan.perPerson) setPersonEach(d.plan.perPerson);
    } catch { if (reqFor.current === tenantId) setFailed(true); }
  }, [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  // What's booked and who's on keep the preview current, without touching what's being edited.
  React.useEffect(() => {
    if (!tenantId) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/retail/pickup-plan?tenantId=${encodeURIComponent(tenantId)}`, { headers: await staffAuthHeader(), cache: 'no-store' });
        const d = await r.json();
        if (r.ok && reqFor.current === tenantId) setLoaded((l) => (l && l.tenantId === tenantId ? { ...l, booked: d.booked, shifts: d.shifts } : l));
      } catch { /* the next minute tries again */ }
    }, 60_000);
    return () => clearInterval(t);
  }, [tenantId]);
  const dirtyRef = React.useRef(false);
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  if (failed) return (
    <div className="mx-auto max-w-2xl px-4 pt-10" style={{ color: C.ink }}>
      <p className="text-[17px]">Pickup times couldn’t be loaded.</p>
      <Btn kind="soft" className="mt-3" onClick={() => void load()}>Try again</Btn>
    </div>);
  if (!loaded || !draft || loaded.tenantId !== tenantId) return <div role="status" className="mx-auto max-w-2xl px-4 pt-10 text-[15px]" style={muted}>Loading pickup times…</div>;

  const { canEdit, zoneSet, timeZone: tz } = loaded;
  const saved = loaded.plan;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settingsOf(saved));
  dirtyRef.current = dirty;
  const set = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setDay = (day: number, list: Stretch[]) => set({ hours: { ...draft.hours, [String(day)]: list } });

  // What's wrong before it can be saved, said in the shop's words (the server would quietly drop these otherwise).
  const problems: string[] = [];
  for (const d of ORDER) {
    const list = draft.hours[String(d)] || [];
    list.forEach((s, i) => {
      if (!(mins(s.close) > mins(s.open))) problems.push(`${NAME[d]}: closing has to be after opening.`);
      else if (i > 0 && mins(s.open) < mins(list[i - 1].close)) problems.push(`${NAME[d]}: the second hours start before the first ones end.`);
      else if (mins(s.close) - mins(s.open) < draft.windowMinutes) problems.push(`${NAME[d]}: ${sizeWords(draft.windowMinutes)} windows don’t fit in ${clock(s.open)} to ${clock(s.close)}.`);
    });
  }
  if (draft.closures.length > 60) problems.push('Up to 60 closed days can be kept. Remove some that are far off.');

  // The preview: the plan as it stands on this screen, with the orders already booked and the shifts on the schedule.
  const plan: PickupPlan = { ...saved, ...draft };
  const usePeople = plan.perPerson !== null;
  const onShift = usePeople ? shiftLookup(loaded.shifts, tz) : undefined;
  const windows = pickupWindows(plan, now, tz, loaded.booked, onShift);
  const rb = readyBy(plan, now, tz, windows);
  const today = dayKey(new Date(now), tz);
  // From the first day a customer could pick, that day and the next day with times: where "Ready by" points.
  const firstOpenDay = windows.find((w) => !w.full)?.day;
  const from = firstOpenDay ? windows.findIndex((w) => w.day === firstOpenDay) : 0;
  const daysShown = [...new Set(windows.slice(from).map((w) => w.day))].slice(0, 2);
  const shownAll = windows.filter((w) => daysShown.includes(w.day));
  const shown = shownAll.slice(0, 12);
  // Times after the last one shown (full ones before the first open day aren't "more").
  const more = shown.length ? windows.length - (windows.indexOf(shown[shown.length - 1]) + 1) : 0;
  const fullCount = windows.filter((w) => w.full).length;
  // Days with pickup times but no shifts on the schedule, when windows are sized by who's working.
  const shiftDays = new Set(loaded.shifts.map((s) => s.date));
  const unstaffed = usePeople ? [...new Set(windows.map((w) => w.day))].filter((d) => !shiftDays.has(d)) : [];
  const dayShort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const paused = isPaused(saved, now);
  const nowWords = whenLabel(now, tz, today);

  const save = async () => {
    if (!canEdit || saving || problems.length) return;
    setSaving(true);
    try {
      if (loaded.tenantId !== tenantId) return;
      // Prep time is shared with Shop settings: sent only when it was changed here, so saving hours never puts back an
      // older prep time someone set there meanwhile.
      const { prepMinutes, ...rest } = draft;
      const body = { tenantId, plan: prepMinutes === saved.prepMinutes ? rest : draft };
      const r = await fetch('/api/retail/pickup-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      // Switched to another business while it saved: nothing of this one lands on that one's screen.
      if (reqFor.current !== tenantId) return;
      if (!r.ok) { setToast(d.error || 'That didn’t save. Try again.'); return; }
      setLoaded((l) => (l && l.tenantId === tenantId ? { ...l, plan: d.plan } : l)); setDraft(settingsOf(d.plan));
      setToast(!hasHours(d.plan) ? 'Saved. Add opening hours to offer pickup times.' : !zoneSet ? 'Saved. Set your time zone to offer these times at checkout.' : 'Saved. Checkout offers these times now.');
    } catch { setToast('That didn’t save. Check your connection and try again.'); }
    finally { setSaving(false); }
  };
  const pause = async (forWhat: 'hour' | 'today' | 'manual' | 'off' | 'keep') => {
    if (!canEdit) return;
    try {
      const r = await fetch('/api/retail/pickup-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, pause: { for: forWhat, note } }) });
      const d = await r.json().catch(() => ({}));
      if (reqFor.current !== tenantId) return;
      if (!r.ok) { setToast(d.error || 'That didn’t save. Try again.'); return; }
      setLoaded((l) => (l && l.tenantId === tenantId ? { ...l, plan: { ...l.plan, pausedUntil: d.plan.pausedUntil, pauseNote: d.plan.pauseNote } } : l));
      setToast(forWhat === 'off' ? 'Online pickup is on again.' : forWhat === 'keep' ? 'Message saved.' : 'Online pickup is paused.');
    } catch { setToast('That didn’t save. Check your connection and try again.'); }
  };
  const addClosure = () => {
    if (!closure) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closure.from)) { setClosure({ ...closure, error: 'Choose the first day you’re closed.' }); return; }
    const to = /^\d{4}-\d{2}-\d{2}$/.test(closure.to) && closure.to >= closure.from ? closure.to : closure.from;
    // Closed days that ended over a month ago go as the list is saved, so it never grows forever.
    const keep = draft.closures.filter((c) => c.to >= dayKey(new Date(now - 31 * 864e5), tz));
    set({ closures: [...keep, { from: closure.from, to, ...(closure.note.trim() ? { note: closure.note.trim().slice(0, 80) } : {}) }].sort((a, b) => (a.from < b.from ? -1 : 1)) });
    setClosure(null);
  };
  const dayRange = (c: { from: string; to: string }) => {
    const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return c.from === c.to ? f(c.from) : `${f(c.from).replace(/^\w+, /, '')} to ${f(c.to).replace(/^\w+, /, '')}`;
  };
  const upcoming = draft.closures.filter((c) => c.to >= today);
  const prepOptions = PREP.includes(draft.prepMinutes) ? PREP : [...PREP, draft.prepMinutes].sort((a, b) => a - b);
  const sizes = WINDOW_SIZES.includes(draft.windowMinutes) ? WINDOW_SIZES : [...WINDOW_SIZES, draft.windowMinutes].sort((a, b) => a - b);

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-6xl px-4 pt-3">
        <Link href="/retail-orders/settings" onClick={(e) => { if (dirty && !window.confirm('Leave without saving your changes to pickup times?')) e.preventDefault(); }} className="inline-flex h-11 items-center gap-1 text-[17px]" style={{ color: C.ink }}>{Ic.back}Shop settings</Link>
        <LargeTitle title="Pickup times" sub={canEdit ? 'When customers can collect online orders.' : 'Only a manager can change these.'}
          right={canEdit ? <Btn kind="primary" disabled={!dirty || saving || problems.length > 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Btn> : undefined} />
        {!zoneSet && (
          <p role="alert" className="m-0 mt-5 rounded-2xl p-4 text-[15px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
            Your business time zone isn’t set, so checkout won’t offer pickup times yet: they’d land hours off. Set it in Settings, under Time zone.
          </p>)}
        {problems.length > 0 && (
          <ul role="alert" className="m-0 mt-5 list-none space-y-1 rounded-2xl p-4 text-[14px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
            {problems.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}
          </ul>)}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0 space-y-5">
            <section aria-labelledby="hours-h" className="p-5" style={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="hours-h" className="m-0 text-[17px] font-semibold">Opening hours for pickup</h2>
                  <p className="m-0 mt-0.5 text-[13px] leading-snug" style={muted}>Customers can only choose a time inside these.</p>
                </div>
                {canEdit && (draft.hours['1'] || []).length > 0 && (
                  <button type="button" className={linkCls} onClick={() => set({ hours: { ...draft.hours, ...Object.fromEntries([2, 3, 4, 5].map((d) => [String(d), draft.hours['1'].map((s) => ({ ...s }))])) } })}>Copy Monday to every weekday</button>)}
              </div>
              <div className="mt-2">
                {ORDER.map((d) => {
                  const list = draft.hours[String(d)] || [];
                  return (
                    // On a phone: the day and its actions on one line, its hours beneath (the order they're read in). Wider: the
                    // day, its hours, then its actions, on one line.
                    <div key={d} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-2.5" style={{ borderColor: C.line }}>
                      <span className="min-w-0 flex-1 text-[15px] font-medium sm:w-28 sm:flex-none">{NAME[d]}</span>
                      {canEdit && (
                        <span className="flex shrink-0 gap-3 sm:order-3">
                          {list.length === 0 && <button type="button" className={linkCls} aria-label={`Open ${NAME[d]} for pickup`} onClick={() => setDay(d, [{ open: '10:00', close: '18:00' }])}>Open</button>}
                          {list.length === 1 && mins(list[0].close) <= 22 * 60 && <button type="button" className={linkCls} aria-label={`Add more hours on ${NAME[d]}`} onClick={() => setDay(d, [...list, (() => {
                            // A second stretch an hour after the first closes, for up to three hours, never past midnight.
                            const o = mins(list[0].close) + 60, c = Math.min(1440, o + 180);
                            const hm = (n: number) => (n >= 1440 ? '24:00' : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`);
                            return { open: hm(o), close: hm(c) };
                          })()])}>Add hours</button>}
                          {list.length > 1 && <button type="button" className={linkCls} aria-label={`Remove the second hours on ${NAME[d]}`} onClick={() => setDay(d, list.slice(0, 1))}>Remove</button>}
                          {list.length > 0 && <button type="button" className={linkCls} aria-label={`Close ${NAME[d]} for pickup`} onClick={() => setDay(d, [])}>Close</button>}
                        </span>)}
                      <span className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:order-2 sm:w-auto sm:flex-1">
                        {list.length === 0 ? <span className="text-[15px]" style={muted}>Closed for pickup</span> : list.map((st, i) => (
                          <React.Fragment key={i}>
                          {i > 0 && <span className="text-[14px]" style={muted}>and</span>}
                          <span className="flex flex-nowrap items-center gap-2">
                            <TimeInput label={`${NAME[d]} opens${i ? ' again' : ''}`} value={st.open} disabled={!canEdit} onChange={(v) => setDay(d, list.map((x, j) => (j === i ? { ...x, open: v } : x)))} />
                            <span className="text-[14px]" style={muted}>to</span>
                            <TimeInput closing label={`${NAME[d]} closes${i ? ' again' : ''}`} value={st.close} disabled={!canEdit} onChange={(v) => setDay(d, list.map((x, j) => (j === i ? { ...x, close: v } : x)))} />
                          </span>
                          </React.Fragment>))}
                      </span>
                    </div>);
                })}
              </div>
            </section>

            <section aria-labelledby="closed-h" className="p-5" style={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="closed-h" className="m-0 text-[17px] font-semibold">Closed days</h2>
                  <p className="m-0 mt-0.5 text-[13px] leading-snug" style={muted}>Holidays, a staff day, a stocktake. No pickup times are offered on these days.</p>
                </div>
                {canEdit && <Btn kind="soft" className="h-11" onClick={() => setClosure({ from: '', to: '', note: '' })}>Add a closed day</Btn>}
              </div>
              <div className="mt-2">
                {upcoming.length === 0 ? <p className="m-0 border-t py-3 text-[15px]" style={{ ...muted, borderColor: C.line }}>None coming up.</p> : upcoming.map((c, i) => (
                  <div key={`${i}-${c.from}-${c.to}`} className="flex items-center justify-between gap-3 border-t py-2" style={{ borderColor: C.line }}>
                    <span className="min-w-0 text-[15px]"><span className="font-medium">{dayRange(c)}</span>{c.note ? <span style={muted}> · {c.note}</span> : null}</span>
                    {canEdit && <button type="button" className={linkCls} aria-label={`Remove ${dayRange(c)}`} onClick={() => set({ closures: draft.closures.filter((x) => x !== c) })}>Remove</button>}
                  </div>))}
              </div>
            </section>

            <section aria-labelledby="windows-h" className="p-5" style={card}>
              <h2 id="windows-h" className="m-0 text-[17px] font-semibold">Pickup windows</h2>
              <div className="mt-2">
                <SetRow label="Each window is" note="How long a customer’s pickup time is. Orders already placed keep the time they chose.">
                  <span role="group" aria-label="Window length" className="flex gap-2">
                    {sizes.map((m) => (
                      <button key={m} type="button" aria-pressed={draft.windowMinutes === m} disabled={!canEdit} onClick={() => set({ windowMinutes: m })}
                        className="cf-press h-11 rounded-full border px-4 text-[14px] font-semibold disabled:opacity-60"
                        style={draft.windowMinutes === m ? { background: C.ink, color: C.paper, borderColor: C.ink } : { borderColor: C.line, background: C.paper, color: C.ink }}>{sizeWords(m)}</button>))}
                  </span>
                </SetRow>
                <SetRow label="Orders each window can take" note={draft.perWindow === null ? 'No limit: every window stays open' : 'A full window shows as full at checkout'}>
                  {draft.perWindow !== null && <input inputMode="numeric" aria-label="Orders each window can take" disabled={!canEdit} value={String(draft.perWindow)}
                    onChange={(e) => set({ perWindow: Math.max(1, Math.min(500, Number(e.target.value.replace(/\D/g, '')) || 1)) })} className={`${field} w-20 text-right`} style={fieldStyle} />}
                  {canEdit && <button type="button" className={linkCls} onClick={() => set({ perWindow: draft.perWindow === null ? 6 : null })}>{draft.perWindow === null ? 'Set a limit' : 'No limit'}</button>}
                </SetRow>
                <SetRow label="Size windows by who’s working" note={`From the schedule: ${draft.perPerson ?? personEach} order${(draft.perPerson ?? personEach) === 1 ? '' : 's'} for each person on shift through the window${draft.perWindow !== null ? ', never more than the limit above' : ''}. A day with no shifts on the schedule isn’t sized by who’s working.`}>
                  {draft.perPerson !== null && <input inputMode="numeric" aria-label="Orders for each person on shift" disabled={!canEdit} value={String(draft.perPerson)}
                    onChange={(e) => { const n = Math.max(1, Math.min(500, Number(e.target.value.replace(/\D/g, '')) || 1)); setPersonEach(n); set({ perPerson: n }); }} className={`${field} w-20 text-right`} style={fieldStyle} />}
                  <Toggle label="Size windows by who’s working" on={draft.perPerson !== null} disabled={!canEdit} onChange={(v) => set({ perPerson: v ? personEach : null })} />
                </SetRow>
                <SetRow label="Time to get an order ready" note="A window is offered only if the order can be ready before it starts. Also used for Pickup ready in, in Shop settings.">
                  <select aria-label="Time to get an order ready" disabled={!canEdit} value={draft.prepMinutes} onChange={(e) => set({ prepMinutes: Number(e.target.value) })} className={field} style={fieldStyle}>
                    {prepOptions.map((m) => <option key={m} value={m}>{prepWords(m)}</option>)}
                  </select>
                </SetRow>
                <SetRow label="Same-day orders close at" note={draft.sameDayCutoff ? 'After this, the first time offered is the next open day' : 'No cutoff: same-day times while the order can still be ready'}>
                  {draft.sameDayCutoff !== null && <TimeInput label="Same-day orders close at" value={draft.sameDayCutoff} disabled={!canEdit} onChange={(v) => set({ sameDayCutoff: v })} />}
                  {canEdit && <button type="button" className={linkCls} onClick={() => set({ sameDayCutoff: draft.sameDayCutoff === null ? '15:00' : null })}>{draft.sameDayCutoff === null ? 'Set a cutoff' : 'No cutoff'}</button>}
                </SetRow>
                <SetRow label="Show times for the next">
                  <input inputMode="numeric" aria-label="Show times for the next, in days" disabled={!canEdit} value={String(draft.daysAhead)}
                    onChange={(e) => set({ daysAhead: Math.max(1, Math.min(30, Number(e.target.value.replace(/\D/g, '')) || 1)) })} className={`${field} w-20 text-right`} style={fieldStyle} />
                  <span className="text-[15px]">days</span>
                </SetRow>
              </div>
            </section>
          </div>

          <div className="min-w-0 space-y-5">
            <section aria-labelledby="pause-h" className="p-5" style={card}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="pause-h" className="m-0 text-[17px] font-semibold">Online pickup</h2>
                  <p className="m-0 mt-0.5 text-[13px]" style={paused ? { color: C.warn } : muted}>
                    {paused ? (saved.pausedUntil === 'manual' ? 'Paused until you turn it back on' : `Paused until ${pauseEndWords(String(saved.pausedUntil), tz, today)}`) : 'Taking pickup orders now'}
                  </p>
                </div>
                <Toggle label="Taking online pickup orders" on={!paused} disabled={!canEdit} onChange={(v) => void pause(v ? 'off' : 'manual')} />
              </div>
              <p className="m-0 mt-3 rounded-2xl px-3.5 py-3 text-[14px] leading-snug" style={{ background: C.soft }}>
                Pause it for an hour, the rest of today, or until you turn it back on. Shipping keeps going, and orders already placed keep their times.
              </p>
              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn kind="soft" className="h-11" onClick={() => void pause('hour')}>1 hour</Btn>
                  <Btn kind="soft" className="h-11" onClick={() => void pause('today')}>Rest of today</Btn>
                  <Btn kind="soft" className="h-11" onClick={() => void pause('manual')}>Until I turn it on</Btn>
                </div>)}
              <label className="mt-4 block">
                <span className="text-[13px] font-semibold" style={muted}>Message while paused</span>
                <input value={note} maxLength={120} disabled={!canEdit} placeholder="Short-staffed today. Back tomorrow at 10."
                  onChange={(e) => setNote(e.target.value)} onBlur={() => { if (paused && note.trim() !== (saved.pauseNote || '')) void pause('keep'); }}
                  className={`${field} mt-1.5 w-full`} style={fieldStyle} />
              </label>
            </section>

            <section aria-labelledby="see-h" className="p-5" style={card}>
              <h2 id="see-h" className="m-0 text-[17px] font-semibold">What customers see right now</h2>
              <p className="m-0 mt-0.5 text-[13px]" style={muted}>{nowWords.charAt(0).toUpperCase() + nowWords.slice(1)}, at checkout{dirty ? ', with your changes' : ''}</p>
              {paused ? (
                <p className="m-0 mt-3 text-[15px] leading-snug">{noPickupReason(plan, now, tz)} Customers can’t choose pickup until it’s on again.</p>
              ) : !hasHours(plan) ? (
                <p className="m-0 mt-3 text-[15px] leading-snug">No pickup times yet, so checkout works as it does today. Add opening hours to offer real times.</p>
              ) : !zoneSet ? (
                <p className="m-0 mt-3 text-[15px] leading-snug">Nothing is offered until your time zone is set.</p>
              ) : windows.some((w) => !w.full) ? (<>
                {rb && <p className="m-0 mt-3 text-[14px] font-semibold" style={{ color: C.ok }}>{rb.label}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {shown.map((w) => (
                    <span key={w.key} className="inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold"
                      style={w.full ? { background: C.soft, borderColor: C.soft, color: C.muted } : { borderColor: C.line }}>{w.label}{w.full ? ' · full' : ''}</span>))}
                </div>
                <p className="m-0 mt-3 text-[13px] leading-snug" style={muted}>
                  {[more > 0 ? `${more} more time${more === 1 ? '' : 's'} after these` : '', `${windows.length} window${windows.length === 1 ? '' : 's'} over the next ${plan.daysAhead} day${plan.daysAhead === 1 ? '' : 's'}`, fullCount ? `${fullCount} full` : '', closureOn(plan, today) ? 'closed today' : ''].filter(Boolean).join(' · ')}.
                </p>
              </>) : (
                <p className="m-0 mt-3 text-[15px] leading-snug">{noPickupReason(plan, now, tz)}</p>
              )}
              {unstaffed.length > 0 && hasHours(plan) && <p className="m-0 mt-3 rounded-2xl px-3.5 py-3 text-[14px] leading-snug" style={{ background: C.warnSoft, color: C.warn }}>
                No shifts on the schedule for {unstaffed.length > 3 ? `${unstaffed.length} of these days` : unstaffed.map(dayShort).join(', ')}, so {plan.perWindow === null ? 'those days have no limit' : `those days take up to ${plan.perWindow} order${plan.perWindow === 1 ? '' : 's'} a window`} until shifts are added.
              </p>}
            </section>
          </div>
        </div>
      </div>

      {closure && (
        <Sheet title="Add a closed day" sub="No pickup times are offered on these days. Orders already placed keep their times." onClose={() => setClosure(null)}>
          <div className="space-y-4 pt-2">
            <label className="block"><span className="text-[13px] font-semibold" style={muted}>What it’s for (customers may see this)</span>
              <input placeholder="Thanksgiving" value={closure.note} maxLength={80} onChange={(e) => setClosure({ ...closure, note: e.target.value })}
                className="mt-1.5 block h-12 w-full rounded-xl border-0 px-4 text-[17px] outline-none" style={{ background: C.soft, color: C.ink }} /></label>
            <div className="flex flex-wrap gap-3">
              <label className="min-w-[9rem] flex-1"><span className="text-[13px] font-semibold" style={muted}>First day closed</span>
                <input type="date" min={today} value={closure.from} onChange={(e) => setClosure({ ...closure, error: undefined, from: e.target.value, to: closure.to && closure.to < e.target.value ? e.target.value : closure.to })} className={`${field} mt-1.5 w-full`} style={fieldStyle} /></label>
              <label className="min-w-[9rem] flex-1"><span className="text-[13px] font-semibold" style={muted}>Last day closed (leave for one day)</span>
                <input type="date" min={closure.from || today} value={closure.to} onChange={(e) => setClosure({ ...closure, to: e.target.value })} className={`${field} mt-1.5 w-full`} style={fieldStyle} /></label>
            </div>
            {closure.error && <p role="alert" className="m-0 rounded-xl px-3 py-2 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>{closure.error}</p>}
            <Btn kind="primary" className="w-full" onClick={addClosure}>Add</Btn>
            <p className="m-0 text-[13px]" style={muted}>Then Save changes to offer it at checkout.</p>
          </div>
        </Sheet>)}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={32} />}
    </div>);
}
