// src/lib/tidy-server.ts — TIDY MY DAY, the server half of lib/tidy-engine (design canvas TD1).
//   tidyPlans   — a provider's day: the gap, and the ways to close it with no new holes (checked with the real booking
//                 engine — shifts, rooms, buffers — for every move)
//   clearPlans  — light days (one or two visits) whose visits fit exactly into gaps on nearby working days
//   askTidy     — texts only the people in the chosen plan; their target times are HELD (staffBlocks, reason
//                 'tidy_hold', lapsing at the deadline) so neither online booking nor the waitlist takes them
//   tidyAnswer  — the client's yes / keep-my-time; nobody moves until EVERYONE in the plan says yes, then every move
//                 happens in one transaction (checked again first). One no, or no answer in time → nobody moves, the
//                 yeses hear "no change needed", and the provider is told.
//   gapDecision — the business's choice for a new gap (Settings → Tidy my day): offer it to the waitlist, tidy first,
//                 or ask the provider (the default). While the provider decides, the waitlist waits — up to 30 minutes.
// Asks are server-only (tenants/{t}/tidyAsks). Nothing a client sees names another client.
import { randomBytes } from 'crypto';
import { planDay, clearDay, touchOf, planKey, askText, doneText, noChangeText, TIDY_DEFAULTS, type Visit, type Block, type Plan, type Move, type Slot, type TidySettings } from '@/lib/tidy-engine';

const T = (t: string) => `tenants/${t}`;
const MIN = 60000, H = 3600e3, DAY = 864e5;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired', 'rejected'];
const HERE = ['arrived', 'checked_in', 'in_progress', 'in_service', 'in-service', 'completed'];
const HOLDS = ['tidy_hold', 'waitlist_hold'];
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || 'there';

export type Deps = {
  send?: (db: any, t: string, to: string, body: string, fb?: any, meta?: any) => Promise<{ ok: boolean }>;
  engine?: (db: any, t: string) => Promise<any>;
  openTimes?: (e: any, o: { date: string; serviceId: string; staffId?: string | null }) => { startIso: string }[];
};
async function deps(d: Deps = {}) {
  const send = d.send || (async (...a: any[]) => { const { sendTenantSms } = await import('@/lib/sms'); return (sendTenantSms as any)(...a); });
  const engine = d.engine || (async (db: any, t: string) => { const { engineFor } = await import('@/lib/rebook'); return engineFor(db, t); });
  const openTimes = d.openTimes || (await import('@/lib/rebook')).openTimesOn as any;
  return { send, engine, openTimes };
}
async function zoneOf(tenant: any) { const { tenantTimeZone } = await import('@/lib/tenant-time'); return tenantTimeZone(tenant); }
async function dateOf(n: number, tz: string) { const { wallParts } = await import('@/lib/tenant-time'); const p = wallParts(new Date(n), tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }
async function dayStart(date: string, tz: string) { const { wallToUtc } = await import('@/lib/tenant-time'); return wallToUtc(date, 0, 0, tz).getTime(); }
const addDay = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clock = (n: number, tz: string) => new Date(n).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', ' ');
const dayWord = (n: number, tz: string, now: number) => { const d = new Date(n).toLocaleDateString('en-US', { timeZone: tz }); if (d === new Date(now).toLocaleDateString('en-US', { timeZone: tz })) return 'today';
  if (d === new Date(now + DAY).toLocaleDateString('en-US', { timeZone: tz })) return 'tomorrow'; return new Date(n).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }); };
const when = (n: number, tz: string, now: number) => { const w = dayWord(n, tz, now); return w === 'today' ? clock(n, tz) : `${w} at ${clock(n, tz)}`; };

export type TidyConfig = TidySettings & { gapMode: 'ask' | 'waitlist' | 'tidy'; autoAsk: boolean };
/** The business's settings, with any per-provider choice of what happens to a gap. */
export function settingsOf(tenant: any, staffId?: string | null): TidyConfig {
  const s = tenant?.tidy || {}; const mine = (staffId && s.byStaff?.[staffId]) || {};
  const num = (v: any, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  return { maxEarlierMin: num(s.maxEarlierMin, TIDY_DEFAULTS.maxEarlierMin, 15, 480), minNoticeMin: num(s.minNoticeMin, TIDY_DEFAULTS.minNoticeMin, 30, 600), maxAsks: num(s.maxAsks, TIDY_DEFAULTS.maxAsks, 1, 6), lightMax: num(s.lightMax, TIDY_DEFAULTS.lightMax, 1, 3),
    gapMode: (['ask', 'waitlist', 'tidy'].includes(mine.gapMode) ? mine.gapMode : ['ask', 'waitlist', 'tidy'].includes(s.gapMode) ? s.gapMode : 'ask'), autoAsk: false };
}

// ── A provider's day ─────────────────────────────────────────────────────────────────
async function staffAppts(db: any, t: string, staffId: string) { return rows(await db.collection(`${T(t)}/appointments`).where('staffId', '==', staffId).get()).filter((a: any) => !DEAD.includes(String(a.status || ''))); }
async function saidNo(db: any, t: string, date: string) {
  const out = new Set<string>(); for (const a of rows(await db.collection(`${T(t)}/tidyAsks`).where('date', '==', date).get())) for (const m of a.moves || []) if (m.answer === 'no') out.add(m.apptId); return out;
}
function visitOf(a: any, no: Set<string>): Visit {
  const s = ms(a.startTime), e = ms(a.endTime) || s + (Number(a.duration) || 60) * MIN;
  const fixed = HERE.includes(String(a.status || '')) ? 'already here' : a.partyId || a.groupId || a.groupBookingId ? 'part of a group booking' : a.isWalkIn ? 'a walk-in'
    : no.has(a.id) ? 'said no today' : !(a.clientPhone || a.phone) && !a.clientId ? 'no number to ask' : a.isRenterBooking ? 'a renter’s client' : null;
  return { id: a.id, start: s, end: e, name: a.clientName || '', clientId: a.clientId || null, serviceId: a.serviceId || null, padBefore: Number(a.padBefore) || 0, padAfter: Number(a.padAfter) || 0, fixed, keen: a.soonerOn === true };
}
/** The booking engine with these visits taken out (they're moving) and holds ignored — "could this visit go here?" */
function fitsFor(e: any, D: any, date: string, staffId: string) {
  const cache = new Map<string, Set<number>>();
  return (v: Visit, to: number, moving: Set<string>) => {
    if (!e || !v.serviceId) return true;
    const k = `${[...moving].sort().join(',')}|${v.serviceId}`;
    if (!cache.has(k)) {
      const sub = e.data?.ap?.docs ? { ...e, data: { ...e.data, ap: { ...e.data.ap, docs: e.data.ap.docs.filter((d: any) => !moving.has(d.id)) }, sb: e.data.sb ? { ...e.data.sb, docs: e.data.sb.docs.filter((d: any) => !HOLDS.includes((d.data?.() || {}).reason)) } : e.data.sb } } : e;
      cache.set(k, new Set((D.openTimes(sub, { date, serviceId: v.serviceId, staffId }) || []).map((s: any) => ms(s.startIso))));
    }
    return cache.get(k)!.has(to);
  };
}

export async function tidyPlans(db: any, t: string, staffId: string, date: string | null, now = Date.now(), d: Deps = {}) {
  const D = await deps(d); const tenant = (await db.doc(T(t)).get()).data() || {}; const tz = await zoneOf(tenant); const S = settingsOf(tenant, staffId);
  const day = date || (await dateOf(now, tz)); const d0 = await dayStart(day, tz), d1 = await dayStart(addDay(day, 1), tz);
  const no = await saidNo(db, t, day);
  const appts = (await staffAppts(db, t, staffId)).filter((a: any) => ms(a.startTime) >= d0 && ms(a.startTime) < d1).sort((a: any, b: any) => ms(a.startTime) - ms(b.startTime));
  const visits = appts.map((a: any) => visitOf(a, no));
  const blocks: Block[] = rows(await db.collection(`${T(t)}/staffBlocks`).where('staffId', '==', staffId).get())
    .filter((b: any) => !HOLDS.includes(b.reason) && !(b.until && ms(b.until) <= now) && ms(b.startTime) >= d0 && ms(b.startTime) < d1)
    .map((b: any) => ({ start: ms(b.startTime), end: ms(b.startTime) + (Number(b.duration) || 30) * MIN, kind: 'break' as const }));
  const e = await D.engine(db, t);
  const r = planDay({ visits, blocks, now, settings: S, fits: fitsFor(e, D, day, staffId) });
  const live = rows(await db.collection(`${T(t)}/tidyAsks`).where('staffId', '==', staffId).get()).filter((a: any) => a.status === 'asking');
  const label = (p: Plan) => ({ ...p, finishLabel: clock(p.finishTo, tz), fromLabel: clock(p.finishFrom, tz),
    moves: p.moves.map((m) => { const v = visits.find((x: Visit) => x.id === m.id)!; const a = appts.find((x: any) => x.id === m.id); return { ...m, name: first(v.name), service: String(a?.serviceName || ''), fromLabel: clock(m.from, tz), toLabel: clock(m.to, tz), keen: !!v.keen }; }) });
  return { ok: true, date: day, tz, settings: S, gap: r.gap ? { ...r.gap, label: `${clock(r.gap.start, tz)}–${clock(r.gap.end, tz)}`, minutes: Math.round((r.gap.end - r.gap.start) / MIN) } : null, plans: r.plans.map(label), why: r.why,
    day: visits.map((v: Visit) => ({ id: v.id, name: first(v.name), start: v.start, end: v.end, label: clock(v.start, tz), service: String(appts.find((a: any) => a.id === v.id)?.serviceName || ''), fixed: v.fixed })),
    asking: live.filter((a: any) => a.date === day).map(askSummary(tz, now)) };
}

/** Light days in the next two weeks whose visits each fit exactly into a gap on a nearby working day. */
export async function clearPlans(db: any, t: string, staffId: string, now = Date.now(), d: Deps = {}) {
  const D = await deps(d); const tenant = (await db.doc(T(t)).get()).data() || {}; const tz = await zoneOf(tenant); const S = settingsOf(tenant, staffId);
  const e = await D.engine(db, t);
  const appts = (await staffAppts(db, t, staffId)).filter((a: any) => ms(a.startTime) > now + 24 * H && ms(a.startTime) < now + 15 * DAY);
  const byDate = new Map<string, any[]>(); for (const a of appts) { const k = await dateOf(ms(a.startTime), tz); byDate.set(k, [...(byDate.get(k) || []), a]); }
  const out: any[] = [];
  for (const [date, list] of [...byDate.entries()].sort()) {
    if (list.length > S.lightMax) continue;
    const no = await saidNo(db, t, date); const visits = list.map((a: any) => visitOf(a, no)); if (visits.some((v: Visit) => v.fixed)) continue;
    const slots = new Map<string, Slot[]>();
    for (const v of visits) {
      const opts: Slot[] = [];
      for (const [d2, other] of byDate.entries()) {
        if (d2 === date || other.length <= S.lightMax || Math.abs(Date.parse(`${d2}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) > 7 * DAY) continue;
        const dayVisits = other.map((a: any) => visitOf(a, new Set()));
        const sub = e?.data?.ap?.docs ? { ...e, data: { ...e.data, ap: { ...e.data.ap, docs: e.data.ap.docs.filter((x: any) => x.id !== v.id) } } } : e;
        for (const s of (v.serviceId ? D.openTimes(sub, { date: d2, serviceId: v.serviceId, staffId }) : []) as any[]) {
          const st = ms(s.startIso) - (v.padBefore || 0) * MIN, en = st + (v.end - v.start) + ((v.padBefore || 0) + (v.padAfter || 0)) * MIN; if (st < now + 24 * H) continue;
          const f = touchOf(st, en, dayVisits); if (f.touch) opts.push({ id: v.id, date: d2, start: st, end: en, ...f });
        }
      }
      slots.set(v.id, opts);
    }
    const moves = clearDay(visits, slots); if (!moves) continue;
    out.push({ kind: 'clear', date, dayLabel: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }), key: planKey(moves),
      moves: moves.map((m) => { const a = list.find((x: any) => x.id === m.id); const sl = slots.get(m.id)!.find((s) => s.start + ((Number(a.padBefore) || 0) * MIN) === m.to);
        return { ...m, name: first(a.clientName), service: String(a.serviceName || ''), fromLabel: when(m.from, tz, now), toLabel: when(m.to, tz, now), exact: !!sl?.exact }; }) });
  }
  return { ok: true, tz, days: out };
}

// ── Asking ───────────────────────────────────────────────────────────────────────────
const askSummary = (_tz: string, _now: number) => (a: any) => ({ id: a.id, kind: a.kind, date: a.date, status: a.status, why: a.why || null, deadline: a.deadline, finishLabel: a.finishLabel || null,
  moves: (a.moves || []).map((m: any) => ({ name: m.name, fromLabel: m.fromLabel, toLabel: m.toLabel, answer: m.answer })), when: a.createdAt, dayFreed: a.kind === 'clear' ? a.dayLabel : null, blocked: !!a.dayBlocked, staffName: first(a.staffName), staffId: a.staffId });

/** The provider taps "Ask": the plan is worked out again here (never trusted from the browser), then only its people are texted. */
export async function askTidy(db: any, t: string, actor: { staffId: string; name: string }, o: { staffId: string; date?: string | null; key: string; kind?: 'day' | 'clear' }, now = Date.now(), d: Deps = {}) {
  const D = await deps(d); const tenant = (await db.doc(T(t)).get()).data() || {}; const tz = await zoneOf(tenant); const S = settingsOf(tenant, o.staffId);
  let plan: any = null, date = o.date || '';
  if (o.kind === 'clear') { const c = await clearPlans(db, t, o.staffId, now, d); plan = c.days.find((x: any) => x.key === o.key); date = plan?.date || ''; }
  else { const p = await tidyPlans(db, t, o.staffId, o.date || null, now, d); plan = p.plans.find((x: any) => x.key === o.key); date = p.date; }
  if (!plan) return { ok: false, error: 'That plan doesn’t work any more — the day has changed. Here’s what works now.' };
  const live = rows(await db.collection(`${T(t)}/tidyAsks`).where('staffId', '==', o.staffId).get()).find((a: any) => a.status === 'asking' && a.date === date);
  if (live) return { ok: false, error: 'You’re already asking about this day — wait for the answers, or cancel that first.' };
  const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, ''); if (!base) return { ok: false, error: 'Set your app’s web address first (Settings → Business), so the text can carry a link.' };
  const staff = (await db.doc(`${T(t)}/staff/${o.staffId}`).get()).data() || {};
  const earliest = Math.min(...plan.moves.map((m: Move) => m.to));
  // Long enough to answer; short enough that whoever moves still has time to get here.
  const deadline = o.kind === 'clear' ? Math.max(now + 2 * H, Math.min(now + 24 * H, earliest - 12 * H)) : Math.max(now + 10 * MIN, Math.min(now + 30 * MIN, earliest - 45 * MIN));
  const ref = db.collection(`${T(t)}/tidyAsks`).doc(); const moves: any[] = [];
  for (const [i, m] of plan.moves.entries()) {
    const a: any = (await db.doc(`${T(t)}/appointments/${m.id}`).get()).data() || {}; const cl: any = a.clientId ? ((await db.doc(`${T(t)}/clients/${a.clientId}`).get()).data() || {}) : {};
    moves.push({ apptId: m.id, from: iso(m.from), to: iso(m.to), name: a.clientName || '', phone: String(a.clientPhone || cl.phone || cl.phoneNumber || ''), clientId: a.clientId || null, service: String(a.serviceName || ''),
      fromLabel: o.kind === 'clear' ? when(m.from, tz, now) : clock(m.from, tz), toLabel: o.kind === 'clear' ? when(m.to, tz, now) : clock(m.to, tz), token: `${ref.id}.${i}.${randomBytes(9).toString('base64url')}`, answer: null,
      dur: Math.round((ms(a.endTime) - ms(a.startTime)) / MIN) || 60, padBefore: Number(a.padBefore) || 0, padAfter: Number(a.padAfter) || 0, noText: !!(cl.smsOptOut || cl.smsConsent === false) });
  }
  { const { budgetLeft } = await import('@/lib/text-budget'); for (const m of moves) if (m.phone && (await budgetLeft(db, t, m.phone, 'tidy_ask', now)) <= 0) return { ok: false, error: `${first(m.name)} has already had their texts from us today — call them, or pick another plan.` }; }
  if (moves.some((m) => !m.phone || m.noText)) return { ok: false, error: `${first(moves.find((m) => !m.phone || m.noText)!.name)} can’t be texted (no mobile number, or they said no to texts) — call them, or pick another plan.` };
  await ref.set({ id: ref.id, kind: o.kind === 'clear' ? 'clear' : 'day', staffId: o.staffId, staffName: staff.name || '', date, dayLabel: plan.dayLabel || null, moves, status: 'asking', deadline: iso(deadline), createdAt: iso(now), askedBy: actor.name, finishLabel: plan.finishLabel || null });
  // Hold every target time until the deadline, so nobody else books it while they answer.
  for (const [i, m] of moves.entries()) await db.doc(`${T(t)}/staffBlocks/tidy_${ref.id}_${i}`).set({ staffId: o.staffId, startTime: iso(ms(m.to) - m.padBefore * MIN), duration: m.dur + m.padBefore + m.padAfter, reason: 'tidy_hold', label: 'Held — asking a client to move', until: iso(deadline), tidyAskId: ref.id, createdAt: iso(now) });
  const { spendBudget } = await import('@/lib/text-budget');
  for (const m of moves) await spendBudget(db, t, m.phone, 'tidy_ask', now).catch(() => {});
  for (const m of moves) await D.send(db, t, m.phone, askText({ first: first(m.name), provider: first(staff.name), to: m.toLabel, from: m.fromLabel, service: m.service.toLowerCase(), link: `${base}/m/${encodeURIComponent(t)}/${m.token}`, sameDay: o.kind !== 'clear' && dayWord(ms(m.to), tz, now) === 'today' }), undefined, { kind: 'tidy_ask', recipientType: 'client', recipientId: m.clientId || undefined, recipientName: m.name || undefined });
  // A gap the waitlist was waiting on: it's being tidied now.
  for (const op of rows(await db.collection(`${T(t)}/openings`).where('status', '==', 'open').get()).filter((x: any) => x.staffId === o.staffId && moves.some((m) => ms(m.to) < ms(x.end) && ms(m.to) + m.dur * MIN > ms(x.start))))
    await db.doc(`${T(t)}/openings/${op.id}`).set({ decided: 'tidy', tidyAskId: ref.id }, { merge: true });
  return { ok: true, askId: ref.id, deadline: iso(deadline) };
}

async function byToken(db: any, t: string, token: string) {
  const [id, i] = String(token || '').split('.'); if (!/^[\w-]{1,60}$/.test(id || '')) return null;
  const s = await db.doc(`${T(t)}/tidyAsks/${id}`).get(); if (!s.exists) return null; const ask: any = { id: s.id, ...(s.data() || {}) };
  const m = (ask.moves || [])[Number(i)]; return m && m.token === token ? { ask, m, i: Number(i) } : null;
}
export async function tidyView(db: any, t: string, token: string, now = Date.now()) {
  const x = await byToken(db, t, token); if (!x) return { ok: false, error: 'This link isn’t valid any more.' };
  const tenant = (await db.doc(T(t)).get()).data() || {}; const tz = await zoneOf(tenant); const { ask, m } = x;
  const state = ask.status === 'done' ? (m.answer === 'yes' ? 'moved' : 'done') : ask.status !== 'asking' ? 'nochange' : m.answer || (ms(ask.deadline) <= now ? 'nochange' : 'open');
  return { ok: true, state, business: String(tenant.name || ''), provider: first(ask.staffName), service: m.service, to: m.toLabel, from: m.fromLabel, day: dayWord(ms(m.to), tz, now), sameDay: ask.kind !== 'clear', minutes: m.dur };
}
/** Yes / keep my time. Everyone yes → every move at once; any no → nobody moves. */
export async function tidyAnswer(db: any, t: string, token: string, yes: boolean, now = Date.now(), d: Deps = {}) {
  const x = await byToken(db, t, token); if (!x) return { ok: false, error: 'This link isn’t valid any more.' };
  const ref = db.doc(`${T(t)}/tidyAsks/${x.ask.id}`);
  const r = await db.runTransaction(async (tx: any) => { const s = await tx.get(ref); const ask: any = { id: s.id, ...(s.data() || {}) };
    if (ask.status !== 'asking') return { ok: true, closed: ask.status }; if (ms(ask.deadline) <= now) return { ok: true, closed: 'late' };
    const moves = ask.moves.map((m: any, i: number) => (i === x.i ? { ...m, answer: yes ? 'yes' : 'no', answeredAt: iso(now) } : m)); tx.update(ref, { moves }); return { ok: true, ask: { ...ask, moves } }; });
  if ((r as any).closed) return { ok: true, state: (r as any).closed === 'done' ? 'done' : 'nochange' };
  const ask = (r as any).ask;
  if (!yes) { await finish(db, t, ask, 'declined', `${first(x.m.name)} would rather keep their time`, now, d); return { ok: true, state: 'kept' }; }
  if (ask.moves.every((m: any) => m.answer === 'yes')) { const c = await commit(db, t, ask, now, d); return { ok: true, state: c.ok ? 'moved' : 'nochange' }; }
  return { ok: true, state: 'yes' };
}

async function release(db: any, t: string, ask: any) { for (let i = 0; i < (ask.moves || []).length; i++) await db.doc(`${T(t)}/staffBlocks/tidy_${ask.id}_${i}`).delete().catch(() => {}); }
async function tellProvider(db: any, t: string, staffId: string, message: string, now: number) {
  const r = db.collection(`${T(t)}/notifications`).doc(); await r.set({ id: r.id, userId: staffId, type: 'tidy', link: '/tidy', read: false, createdAt: iso(now), message });
}
/** Nobody moves: holds lifted, the yeses thanked, the provider told — and a gap the waitlist was waiting on goes back to them to decide. */
async function finish(db: any, t: string, ask: any, status: string, why: string, now: number, d: Deps) {
  const D = await deps(d); await db.doc(`${T(t)}/tidyAsks/${ask.id}`).set({ status, why, closedAt: iso(now) }, { merge: true }); await release(db, t, ask);
  for (const m of ask.moves.filter((m: any) => m.answer === 'yes')) await D.send(db, t, m.phone, noChangeText({ first: first(m.name), from: m.fromLabel }), undefined, { kind: 'tidy_nochange', recipientType: 'client', recipientId: m.clientId || undefined }).catch(() => null);
  for (const op of rows(await db.collection(`${T(t)}/openings`).where('status', '==', 'open').get()).filter((o: any) => o.tidyAskId === ask.id))
    await db.doc(`${T(t)}/openings/${op.id}`).set({ decided: null, tidyAskId: null, awaitUntil: iso(now + 15 * MIN) }, { merge: true });
  await tellProvider(db, t, ask.staffId, `Couldn’t tidy ${ask.kind === 'clear' ? ask.dayLabel : 'your day'} — ${why}. Nobody was moved.${ask.kind === 'clear' ? '' : ' Leave the gap free, or offer it to the waitlist?'}`, now);
}
async function commit(db: any, t: string, ask: any, now: number, d: Deps) {
  const D = await deps(d);
  const ids = new Set(ask.moves.map((m: any) => m.apptId));
  const ok = await db.runTransaction(async (tx: any) => {
    const cur: any[] = []; for (const m of ask.moves) { const s = await tx.get(db.doc(`${T(t)}/appointments/${m.apptId}`)); cur.push(s.exists ? s.data() : null); }
    if (cur.some((a, i) => !a || DEAD.includes(String(a.status || '')) || ms(a.startTime) !== ms(ask.moves[i].from))) return false;    // something changed meanwhile
    const lo = Math.min(...ask.moves.map((m: any) => ms(m.to))) - DAY, hi = Math.max(...ask.moves.map((m: any) => ms(m.to))) + DAY;
    const near = await tx.get(db.collection(`${T(t)}/appointments`).where('startTime', '>=', iso(lo)).where('startTime', '<=', iso(hi)));
    for (const m of ask.moves) { const s = ms(m.to) - m.padBefore * MIN, e = ms(m.to) + (m.dur + m.padAfter) * MIN;
      for (const doc of near.docs) { if (ids.has(doc.id)) continue; const o: any = doc.data() || {}; if (o.staffId !== ask.staffId || DEAD.includes(String(o.status || ''))) continue;
        const oS = ms(o.startTime) - (Number(o.padBefore) || 0) * MIN, oE = (ms(o.endTime) || ms(o.startTime) + 3600e3) + (Number(o.padAfter) || 0) * MIN; if (s < oE && e > oS) return false; } }
    ask.moves.forEach((m: any, i: number) => { const a = cur[i]; const dur = ms(a.endTime) - ms(a.startTime) || m.dur * MIN;
      const move = { startTime: m.to, endTime: iso(ms(m.to) + dur), previousStartTime: a.startTime, rescheduledAt: iso(now), rescheduledBy: 'tidy_my_day', reminderSentAt: null, tidyAskId: ask.id };
      tx.set(db.doc(`${T(t)}/appointments/${m.apptId}`), move, { merge: true });
      if (a.checkInToken) { tx.set(db.doc(`${T(t)}/appointmentCheckIns/${a.checkInToken}`), move, { merge: true }); tx.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), move, { merge: true }); } });
    return true;
  });
  if (!ok) { await finish(db, t, ask, 'failed', 'the day changed while they were answering', now, d); return { ok: false }; }
  await db.doc(`${T(t)}/tidyAsks/${ask.id}`).set({ status: 'done', closedAt: iso(now) }, { merge: true }); await release(db, t, ask);
  for (const m of ask.moves) await D.send(db, t, m.phone, doneText({ first: first(m.name), to: ask.kind === 'clear' ? m.toLabel : `today at ${m.toLabel}` }), undefined, { kind: 'tidy_done', recipientType: 'client', recipientId: m.clientId || undefined }).catch(() => null);
  for (const op of rows(await db.collection(`${T(t)}/openings`).where('status', '==', 'open').get()).filter((o: any) => o.tidyAskId === ask.id))
    await db.doc(`${T(t)}/openings/${op.id}`).set({ status: 'closed', closedAt: iso(now), closedWhy: 'tidied — clients moved up' }, { merge: true });
  await tellProvider(db, t, ask.staffId, ask.kind === 'clear' ? `${ask.dayLabel} is clear — everyone said yes. Block it off so nobody books it?` : `Tidied — everyone said yes.${ask.finishLabel ? ` You finish at ${ask.finishLabel}.` : ''}`, now);
  return { ok: true };
}

/** From the cron: asks past their deadline end with nobody moved. */
export async function expireTidy(db: any, t: string, now = Date.now(), d: Deps = {}) {
  let n = 0; for (const a of rows(await db.collection(`${T(t)}/tidyAsks`).where('status', '==', 'asking').get())) if (ms(a.deadline) <= now) { await finish(db, t, a, 'expired', 'not everyone answered in time', now, d); n++; }
  return n;
}
export async function cancelTidy(db: any, t: string, askId: string, staffId: string | null, now = Date.now(), d: Deps = {}) {
  const s = await db.doc(`${T(t)}/tidyAsks/${askId}`).get(); const a: any = s.exists ? { id: s.id, ...s.data() } : null;
  if (!a || (staffId && a.staffId !== staffId)) return { ok: false, error: 'That ask is gone.' }; if (a.status !== 'asking') return { ok: true };
  await finish(db, t, a, 'cancelled', 'you cancelled it', now, d); return { ok: true };
}
/** After a light day is cleared: block it so nobody books it. */
export async function blockDay(db: any, t: string, askId: string, staffId: string | null, now = Date.now()) {
  const s = await db.doc(`${T(t)}/tidyAsks/${askId}`).get(); const a: any = s.exists ? s.data() : null;
  if (!a || a.kind !== 'clear' || a.status !== 'done' || (staffId && a.staffId !== staffId)) return { ok: false, error: 'Nothing to block.' };
  const tz = await zoneOf((await db.doc(T(t)).get()).data() || {}); const s0 = await dayStart(a.date, tz); const s1 = await dayStart(addDay(a.date, 1), tz);
  await db.doc(`${T(t)}/staffBlocks/dayoff_${askId}`).set({ staffId: a.staffId, startTime: iso(s0), duration: Math.round((s1 - s0) / MIN), reason: 'day_off', label: 'Day off — cleared with Tidy my day', createdAt: iso(now) });
  await db.doc(`${T(t)}/tidyAsks/${askId}`).set({ dayBlocked: true }, { merge: true }); return { ok: true };
}
export async function recentAsks(db: any, t: string, staffId: string | null, now = Date.now()) {
  const tz = await zoneOf((await db.doc(T(t)).get()).data() || {});
  const list = rows(staffId ? await db.collection(`${T(t)}/tidyAsks`).where('staffId', '==', staffId).get() : await db.collection(`${T(t)}/tidyAsks`).get());
  return list.filter((a: any) => a.status === 'asking' || now - ms(a.closedAt || a.createdAt) < 2 * DAY).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 20).map(askSummary(tz, now));
}

// ── A new gap: whose call is it? ─────────────────────────────────────────────────────
/** For each new opening (from the waitlist sweep): with "ask me" (the default) or "tidy first" and a plan that works,
 * the provider is told and the waitlist waits — up to 30 minutes, and never past the point where nobody could be asked. */
export async function gapDecision(db: any, t: string, op: any, tenant: any, now = Date.now(), d: Deps = {}) {
  const ref = db.doc(`${T(t)}/openings/${op.id}`); const S = settingsOf(tenant, op.staffId);
  if (S.gapMode === 'waitlist' || op.source === 'moveup' || op.source === 'fell_through') { await ref.set({ gapChecked: iso(now) }, { merge: true }); return false; }
  const tz = await zoneOf(tenant); const p: any = await tidyPlans(db, t, op.staffId, await dateOf(ms(op.start), tz), now, d).catch(() => ({ plans: [] }));
  const until = Math.min(now + 30 * MIN, ms(op.start) - S.minNoticeMin * MIN);
  if ((S.gapMode === 'tidy' && !p.plans.length) || until <= now + 5 * MIN) { await ref.set({ gapChecked: iso(now) }, { merge: true }); return false; }
  await ref.set({ gapChecked: iso(now), awaitUntil: iso(until), tidyPlans: p.plans.length, tidyFinish: p.plans[0]?.finishLabel || null }, { merge: true });
  const w = when(ms(op.start), tz, now);
  await tellProvider(db, t, op.staffId, p.plans.length
    ? `${w} is free (a cancellation). Tidy your day — finish at ${p.plans[0].finishLabel} by asking ${p.plans[0].moves.length === 1 ? p.plans[0].moves[0].name : `${p.plans[0].moves.length} clients`} — or offer it to the waitlist? It goes to the waitlist at ${clock(until, tz)} if you don’t choose.`
    : `${w} is free (a cancellation). Nobody can move up to close it without leaving another gap — offer it to the waitlist, or leave it free? It goes to the waitlist at ${clock(until, tz)} if you don’t choose.`, now);
  return true;
}
/** The provider's call on a gap: the waitlist now, or leave it free. */
export async function decideGap(db: any, t: string, openingId: string, choice: 'waitlist' | 'leave', staffId: string | null, now = Date.now()) {
  const s = await db.doc(`${T(t)}/openings/${openingId}`).get(); const op: any = s.exists ? s.data() : null;
  if (!op || op.status !== 'open' || (staffId && op.staffId !== staffId)) return { ok: false, error: 'That gap is already sorted.' };
  await db.doc(`${T(t)}/openings/${openingId}`).set(choice === 'leave' ? { status: 'closed', closedAt: iso(now), closedWhy: 'left free by the provider' } : { decided: 'waitlist', awaitUntil: null }, { merge: true });
  return { ok: true };
}
/** Gaps waiting on this provider's call. */
export async function awaiting(db: any, t: string, staffId: string | null, now = Date.now()) {
  const tz = await zoneOf((await db.doc(T(t)).get()).data() || {});
  return rows(await db.collection(`${T(t)}/openings`).where('status', '==', 'open').get()).filter((o: any) => (!staffId || o.staffId === staffId) && o.awaitUntil && ms(o.awaitUntil) > now && !o.decided && ms(o.start) > now)
    .map((o: any) => ({ id: o.id, staffId: o.staffId, staffName: first(o.staffName), when: when(ms(o.start), tz, now), date: o.start, minutes: o.minutes, until: clock(ms(o.awaitUntil), tz), plans: o.tidyPlans || 0, finish: o.tidyFinish || null }));
}
