'use client';
// src/components/pos/desk/DeskFollowUp.tsx — BOOK THEIR NEXT VISIT.
//
// From a visit (checkout, a card, or the client's card in Counter): the same
// service, add-ons, provider and usual time, 2 · 4 · 6 · 8 weeks on.
// Each preset is checked for real (the reschedule route's staff-side 'range',
// same engine, no online booking horizon), shown as "same time" or the nearest
// free. Booking goes through /api/appointments/book as a front-desk booking
// (with the staff member's sign-in), so confirmations, check-in link and the
// planner all behave like any other booking.

import { useEffect, useMemo, useState } from 'react';
import { format, addDays, addMonths, parseISO, startOfMonth, endOfMonth, isBefore, isSameDay, startOfDay } from 'date-fns';
import { getAuth } from 'firebase/auth';
import { Drawer, Btn, Seg } from './kit';

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
const WEEKS = [2, 4, 6, 8];

async function staffPost(url: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); return { status: r.status, ...(d || {}) };
}

export function DeskFollowUp({ e, visit, accent, onClose }: { e: any; visit: any | null; accent?: string | null; onClose: () => void }) {
  const base = toDate(visit?.startTime) || new Date();
  const usual = format(base, 'HH:mm');
  const [staffId, setStaffId] = useState<string>(visit?.staffId || '');
  const [times, setTimes] = useState<Record<string, string[] | null>>({}); // `${staffId}|date` → times (null = loading)
  const [pick, setPick] = useState<{ date: string; time: string } | null>(null);
  const [otherDate, setOtherDate] = useState(''); const [month, setMonth] = useState(() => startOfMonth(addDays(new Date(), 14))); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const presets = useMemo(() => WEEKS.map((w) => ({ w, d: addDays(base, w * 7) })), [visit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (visit) { setStaffId(visit.staffId || ''); setTimes({}); setPick(null); setOtherDate(''); setMsg(null); } }, [visit?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = async (date: string, sid = staffId) => {
    const k = `${sid}|${date}`; if (times[k] !== undefined || !visit) return;
    setTimes((t) => ({ ...t, [k]: null }));
    const d = await staffPost('/api/appointments/reschedule', { action: 'range', tenantId: e.tenantId, appointmentId: visit.id, date, days: 1, staffId: sid });
    setTimes((t) => ({ ...t, [k]: d.ok ? (d.days?.[0]?.times || []) : [] }));
  };
  useEffect(() => { if (visit && staffId) presets.forEach((p) => void load(ymd(p.d))); }, [visit?.id, staffId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The month calendar: one request fills the whole month's dots.
  const loadMonth = async (m: Date, sid = staffId) => {
    if (!visit || !sid) return; const first = isBefore(startOfMonth(m), startOfDay(new Date())) ? startOfDay(new Date()) : startOfMonth(m);
    const k = `${sid}|month|${ymd(first)}`; if (times[k] !== undefined) return; setTimes((t) => ({ ...t, [k]: [] }));
    const days = Math.round((endOfMonth(m).getTime() - first.getTime()) / 864e5) + 1;
    const d = await staffPost('/api/appointments/reschedule', { action: 'range', tenantId: e.tenantId, appointmentId: visit.id, date: ymd(first), days: Math.min(31, days), staffId: sid });
    if (d.ok) setTimes((t) => { const n = { ...t }; for (const x of d.days || []) if (n[`${sid}|${x.date}`] === undefined || n[`${sid}|${x.date}`] === null) n[`${sid}|${x.date}`] = x.times || []; return n; });
  };
  useEffect(() => { if (visit && staffId) void loadMonth(month); }, [visit?.id, staffId, month]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visit) return <Drawer accent={accent} open={false} onClose={onClose} title="Book next visit">{null}</Drawer>;
  const svc = (id: string) => (e.services || []).find((s: any) => s.id === id);
  const first = String(visit.clientName || 'the client').split(' ')[0];
  const providers = (e.staff || []).filter((s: any) => s.isActive !== false && !s.isStudent && !(s.isRenter && s.bookingOptOut === true));
  const tf = (date: string) => times[`${staffId}|${date}`];
  const best = (list: string[]) => (list.includes(usual) ? usual : [...list].sort((a, b) => Math.abs(mins(a) - mins(usual)) - Math.abs(mins(b) - mins(usual)))[0]);
  const shownDate = pick?.date || otherDate;
  const dayList = shownDate ? tf(shownDate) : undefined;

  const book = async () => {
    if (!pick) return; setBusy(true); setMsg(null);
    try {
      const start = new Date(`${pick.date}T${pick.time}:00`);
      const d = await staffPost('/api/appointments/book', { tenantId: e.tenantId, source: 'front_desk', serviceId: visit.serviceId, addOnIds: visit.addOnIds || [], staffId: staffId || 'any',
        startTime: start.toISOString(), client: visit.clientId ? { id: visit.clientId } : { name: visit.clientName, email: visit.clientEmail, phone: visit.clientPhone }, notes: `Follow-up booked at the front desk after ${format(base, 'MMM d')}` });
      if (!d.ok) { setMsg({ ok: false, text: d.error || 'That time was just taken — pick another.' }); setTimes((t) => { const n = { ...t }; delete n[`${staffId}|${pick.date}`]; return n; }); void load(pick.date); return; }
      setMsg({ ok: true, text: `Booked ${first} · ${format(start, 'EEE, MMM d · h:mm a')}${d.staffName ? ` with ${String(d.staffName).split(' ')[0]}` : ''}` });
    } finally { setBusy(false); }
  };

  const Card = ({ children }: { children: React.ReactNode }) => <section className="space-y-2.5 rounded-3xl p-4" style={{ background: 'var(--card)' }}>{children}</section>;
  return (
    <Drawer accent={accent} open={!!visit} onClose={onClose} title={`Book ${first}’s next visit`}>
      {msg?.ok ? <div className="space-y-4 py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-[28px]" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>✓</div>
        <p className="text-[18px] font-semibold">{msg.text}</p><p className="text-[13px]" style={{ color: 'var(--muted)' }}>They’ll get the usual confirmation. It’s in the planner now.</p><Btn onClick={onClose}>Done</Btn></div> : (
      <div className="space-y-3">
        <Card><p className="text-[12px]" style={{ color: 'var(--muted)' }}>Same as this visit</p>
          <p className="text-[16px] font-semibold">{[svc(visit.serviceId)?.name || visit.serviceName, ...((visit.addOnIds || []) as string[]).map((id) => svc(id)?.name)].filter(Boolean).join(' + ') || 'Their service'}</p>
          <p className="text-[13px]" style={{ color: 'var(--muted)' }}>usually {clock(usual)}</p>
          {providers.length > 1 && <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{providers.map((s: any) => { const on = s.id === staffId; return (
            <button key={s.id} type="button" aria-pressed={on} onClick={() => { setStaffId(s.id); setPick(null); presets.forEach((p) => void load(ymd(p.d), s.id)); }} className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-[13px] font-semibold" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)' }}>
              {s.avatarUrl ? <img src={s.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px]" style={{ background: on ? 'rgba(255,255,255,.25)' : 'var(--card)' }}>{String(s.name).charAt(0)}</span>}{String(s.name).split(' ')[0]}</button>); })}</div>}
        </Card>
        <Card><p className="text-[14px] font-semibold">When?</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{presets.map(({ w, d }) => { const k = ymd(d); const list = tf(k); const t = list?.length ? best(list) : null; const on = pick?.date === k && pick.time === t; return (
            <button key={w} type="button" disabled={!list?.length} onClick={() => t && setPick({ date: k, time: t })} aria-pressed={on} className="rounded-2xl p-3 text-left transition active:scale-[.98] disabled:opacity-50"
              style={on ? { background: 'color-mix(in srgb, var(--accent) 14%, var(--card))', boxShadow: 'inset 0 0 0 2px var(--accent)' } : { background: 'var(--soft)' }}>
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>In {w} weeks</p><p className="text-[14px] font-semibold">{format(d, 'EEE, MMM d')}</p>
              <p className="text-[12px]" style={{ color: list === undefined || list === null ? 'var(--muted)' : !list.length ? 'var(--muted)' : t === usual ? 'var(--ok)' : 'var(--warn)' }}>{list === undefined || list === null ? 'Checking…' : !list.length ? 'No times that day' : t === usual ? `✓ ${clock(t!)} · same time` : `${clock(t!)} · nearest free`}</p></button>); })}</div>
        </Card>
        <Card>
          <div className="flex items-center justify-between"><p className="text-[14px] font-semibold">Or pick a day · {format(month, 'MMMM yyyy')}</p>
            <div className="flex gap-1"><Btn quiet label="Previous month" disabled={!isBefore(startOfMonth(new Date()), month)} onClick={() => setMonth(addMonths(month, -1))}>‹</Btn><Btn quiet label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</Btn></div></div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px]" style={{ color: 'var(--muted)' }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-1">{[...Array(startOfMonth(month).getDay()).fill(null), ...Array.from({ length: endOfMonth(month).getDate() }, (_, i) => addDays(startOfMonth(month), i))].map((d: Date | null, i: number) => {
            if (!d) return <span key={`b${i}`} />; const k = ymd(d); const list = tf(k); const past = isBefore(d, startOfDay(new Date())); const on = otherDate === k || pick?.date === k; const has = !!list?.length;
            return <button key={k} type="button" disabled={past} aria-pressed={on} aria-label={`${format(d, 'EEEE MMMM d')}${has ? `, ${list!.length} times` : ''}`} onClick={() => { setOtherDate(k); setPick(null); void load(k); }}
              className="relative flex h-10 items-center justify-center rounded-xl text-[14px] disabled:opacity-30" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 } : isSameDay(d, base) ? { boxShadow: 'inset 0 0 0 1.5px var(--line)' } : undefined}>
              {d.getDate()}{!past && Array.isArray(list) && <span className="absolute bottom-1 h-1 w-1 rounded-full" style={{ background: has ? (on ? 'var(--accent-ink)' : 'var(--accent)') : 'transparent' }} />}</button>; })}</div>
        </Card>
        {shownDate && <Card><p className="text-[14px] font-semibold">{format(new Date(`${shownDate}T12:00`), 'EEEE, MMM d')}</p>
          {dayList === undefined || dayList === null ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Checking…</p> : !dayList.length ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No open times that day.</p>
            : <div className="flex flex-wrap gap-1.5">{dayList.map((t) => <Btn key={t} quiet={!(pick?.date === shownDate && pick.time === t)} onClick={() => setPick({ date: shownDate, time: t })}>{clock(t)}</Btn>)}</div>}</Card>}
        {msg && !msg.ok && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>{msg.text}</p>}
        <div className="sticky bottom-0 -mx-5 px-5 pb-1 pt-3" style={{ background: 'var(--paper)' }}><Btn big onClick={book} disabled={!pick || busy} className="w-full">{busy ? 'Booking…' : pick ? `Book ${format(new Date(`${pick.date}T${pick.time}`), 'EEE, MMM d · h:mm a')}` : 'Pick a time'}</Btn></div>
      </div>)}
    </Drawer>
  );
}
