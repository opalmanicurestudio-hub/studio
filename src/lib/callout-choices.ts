// src/lib/callout-choices.ts — WHEN A PROVIDER CAN'T COME IN: HER CLIENTS CHOOSE FIRST.
//
// Builds on lib/disruptions + /api/appointments/disruption (which records the callout, blocks the provider's
// calendar and tells each client). This adds the choices and the timing:
//   • KEPT TIMES — the provider's next free times (14 days) are held for the affected clients until the
//     choose-by time: hidden from online booking and the waitlist (staffBlocks with `until`, reason 'callout_hold').
//   • ANOTHER PROVIDER — the same time with a colleague who is working, free and does that service. Only if the
//     client picks it; they keep the price they booked.
//   • FIRST IN LINE — cancel (no fee) and go to the top of the waitlist for that provider.
//   • CANCEL — no fee (handled by /api/appt disruption_reply).
//   • CHOOSE-BY — 6:00 PM the evening before (or a set number of hours before; Booking policies), and never later than
//     3 hours before the visit. Visits sooner than that go straight to the desk's call list. Nobody is cancelled by silence.
//   • AFTER THE CHOOSE-BY TIME — the undecided move to the call list; kept times nobody picked go to the waitlist.
//   • BACK AFTER ALL — anyone who hasn't chosen keeps their visit as booked; anyone who moved keeps the new time.
import { tenantTimeZone, wallParts, wallToUtc, addDays } from '@/lib/tenant-time';

export const CALL_WITHIN_H = 3;
const H = 3600e3, DAY = 864e5, MIN = 60000;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: any) => (v ? Date.parse(String(v)) || 0 : 0);
const first = (n: any) => String(n || '').split(' ')[0] || 'there';
const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired', 'rejected', 'completed'];

export type KeptTime = { id: string; start: string; minutes: number; takenBy: string | null };
type Deps = { engine?: (db: any, t: string) => Promise<any>; openTimes?: (e: any, o: { date: string; serviceId: string; staffId?: string | null }) => any[] };
async function deps(d: Deps = {}) {
  const engine = d.engine || (async (db: any, t: string) => { const { engineFor } = await import('@/lib/rebook'); return engineFor(db, t); });
  const openTimes = d.openTimes || ((await import('@/lib/rebook')).openTimesOn as any);
  return { engine, openTimes };
}
const ymd = (n: number, tz: string) => { const p = wallParts(new Date(n), tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
export const whenText = (n: number, tz: string) => new Date(n).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
const durMin = (a: any) => Math.max(15, Math.round((ms(a.endTime) - ms(a.startTime)) / MIN) || Number(a.durationMin || a.duration) || 60);

/** When this client must choose by. 0 = too soon to wait: the desk calls now. */
export function chooseByFor(startMs: number, now: number, tz: string, rule: any): number {
  const latest = startMs - CALL_WITHIN_H * H;
  let at: number;
  const hrs = Number(rule);
  if (Number.isFinite(hrs) && hrs > 0) at = startMs - hrs * H;
  else at = wallToUtc(addDays(ymd(startMs, tz), -1), 18, 0, tz).getTime();   // 6:00 PM the evening before
  at = Math.min(at, latest);
  return at < now + H ? 0 : at;
}

/** Hold the provider's next free times for her clients, find colleagues for each visit, set each choose-by time. */
export async function prepareChoices(db: any, t: string, o: { calloutId: string; staffId: string; toMs: number; now: number }, d: Deps = {}) {
  const T = `tenants/${t}`; const D = await deps(d);
  const tenant: any = (await db.doc(T).get()).data() || {}; const tz = tenantTimeZone(tenant);
  const rule = tenant.bookingPolicies?.calloutChooseBy ?? 'evening';
  const ref = db.doc(`${T}/providerCallouts/${o.calloutId}`); const rec: any = (await ref.get()).data() || {};
  const entries: any[] = Object.values(rec.affected || {}).filter((en: any) => !en.isRenterBooking && en.outcome === 'pending');
  if (!entries.length) return { kept: 0, call: 0 };
  const appts = new Map<string, any>();
  for (const en of entries) appts.set(en.appointmentId, { id: en.appointmentId, ...((await db.doc(`${T}/appointments/${en.appointmentId}`).get()).data() || {}) });
  const e = await D.engine(db, t); const staffAll: any[] = (e?.staff || []).filter((s: any) => s.id !== o.staffId && !s.renterId && !s.isRenter);
  const svcMin = (id: string) => { const s = (e?.services || []).find((x: any) => x.id === id); return Number(s?.duration || s?.durationMinutes) || 0; };

  // Kept times: the provider's next free starts after she's back, longest service first so the times are roomy.
  const serviceIds = Array.from(new Set(Array.from(appts.values()).map((a: any) => String(a.serviceId || '')).filter(Boolean)))
    .sort((x, y) => (svcMin(y) || 0) - (svcMin(x) || 0));
  const need = Math.min(10, entries.length + 2); const kept: KeptTime[] = [];
  const from = Math.max(o.toMs, o.now + 2 * H);
  if (e) for (let i = 0; i <= 14 && kept.length < need; i++) {
    const date = addDays(ymd(from, tz), i); const cand: { s: number; m: number }[] = [];
    for (const sid of serviceIds) for (const sl of D.openTimes(e, { date, serviceId: sid, staffId: o.staffId }) || []) {
      if (sl.staffId && sl.staffId !== o.staffId) continue; const s = ms(sl.startIso || sl.start); if (s >= from) cand.push({ s, m: svcMin(sid) || 60 });
    }
    for (const c of cand.sort((x, y) => x.s - y.s)) {
      if (kept.length >= need) break;
      if (kept.some((k) => ms(k.start) < c.s + c.m * MIN && ms(k.start) + k.minutes * MIN > c.s)) continue;
      kept.push({ id: `k${kept.length}`, start: iso(c.s), minutes: c.m, takenBy: null });
    }
  }

  // Each visit: its choose-by time, and colleagues free at the same time who do that service.
  let holdUntil = 0, call = 0; const upd: Record<string, any> = {};
  for (const en of entries) {
    const a = appts.get(en.appointmentId); const s = ms(a.startTime);
    const by = chooseByFor(s, o.now, tz, rule); holdUntil = Math.max(holdUntil, by);
    const others: { staffId: string; name: string }[] = [];
    if (e && a.serviceId) for (const st of staffAll) {
      const ok = (D.openTimes(e, { date: ymd(s, tz), serviceId: a.serviceId, staffId: st.id }) || []).some((sl: any) => ms(sl.startIso || sl.start) === s && (!sl.staffId || sl.staffId === st.id));
      if (ok) others.push({ staffId: st.id, name: String(st.name || 'A colleague') });
    }
    upd[en.appointmentId] = { chooseBy: by ? iso(by) : null, needsCall: !by, ...(by ? {} : { callListAt: iso(o.now) }), others: others.slice(0, 3) };
    if (!by) call++;
    await db.doc(`${T}/appointments/${en.appointmentId}`).set({ disruption: { chooseBy: by ? iso(by) : null, hasChoices: true } }, { merge: true });
  }
  if (!holdUntil) holdUntil = o.now + H;   // everyone is on the call list: a short hold so the desk can offer the times by phone
  for (const k of kept) await db.doc(`${T}/staffBlocks/co_${o.calloutId}_${k.id}`).set({ staffId: o.staffId, startTime: k.start, duration: k.minutes, reason: 'callout_hold',
    label: 'Kept for clients affected by a callout', calloutId: o.calloutId, until: iso(holdUntil), createdAt: iso(o.now) });
  await ref.set({ affected: upd, choices: { keptTimes: kept, holdUntil: iso(holdUntil), rule, done: false } }, { merge: true });
  if (call) await tellDesk(db, t, `Action needed: ${call} client${call === 1 ? ' is' : 's are'} booked with ${rec.staffName || 'the provider'} within the next few hours. Please call ${call === 1 ? 'them' : 'each of them'} about their appointment. They have also been sent a message.`, o.now);
  return { kept: kept.length, call, holdUntil: iso(holdUntil) };
}

/** What the client can choose right now (rechecked: taken times and busy colleagues drop off). */
export async function optionsFor(db: any, t: string, a: any, now = Date.now()) {
  const T = `tenants/${t}`; const d = a.disruption || {};
  if (d.kind !== 'callout' || d.status !== 'pending' || !d.id) return { ok: false as const };
  const rec: any = (await db.doc(`${T}/providerCallouts/${d.id}`).get()).data(); if (!rec) return { ok: false as const };
  const en: any = rec.affected?.[a.id] || {}; const tz = tenantTimeZone((await db.doc(T).get()).data() || {});
  const { providerFree } = await import('@/lib/provider-availability');
  const s = ms(a.startTime), e = ms(a.endTime) || s + durMin(a) * MIN; const others: any[] = [];
  for (const o of en.others || []) if (await providerFree(db, T, o.staffId, s, e, a.id)) others.push({ staffId: o.staffId, name: first(o.name), when: whenText(s, tz) });
  const open = !rec.choices?.done && ms(rec.choices?.holdUntil) > now;
  const kept = open ? (rec.choices?.keptTimes || []).filter((k: KeptTime) => !k.takenBy && ms(k.start) > now + 2 * H && k.minutes >= durMin(a)).slice(0, 6)
    .map((k: KeptTime) => ({ id: k.id, start: k.start, when: whenText(ms(k.start), tz) })) : [];
  return { ok: true as const, provider: first(rec.staffName), others, kept, chooseBy: en.chooseBy ? whenText(ms(en.chooseBy), tz) : null };
}

async function mirror(db: any, t: string, a: any, f: any) {
  if (!a.checkInToken) return;
  await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}), db.doc(`tenants/${t}/appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {})]);
}
async function bell(db: any, t: string, userId: string | null, message: string, now: number, extra: any = {}) {
  const r = db.collection(`tenants/${t}/notifications`).doc();
  await r.set({ id: r.id, userId, read: false, createdAt: iso(now), type: 'callout', link: 'pos', message, ...extra });
}
async function tellDesk(db: any, t: string, message: string, now: number) {
  const staff = (await db.collection(`tenants/${t}/staff`).get()).docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) }))
    .filter((m: any) => !m.archived && ['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')));
  for (const m of staff) await bell(db, t, m.id, message, now);
}
async function tellClient(db: any, t: string, a: any, subject: string, lines: string[]) {
  try {
    const T = `tenants/${t}`; const tenant: any = (await db.doc(T).get()).data() || {}; const studio = tenant.name || 'Our studio';
    const cl: any = a.clientId ? ((await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}) : {};
    const email = String(cl.email || a.clientEmail || '').trim(), phone = String(cl.phone || a.clientPhone || '').trim();
    const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
    const base = { tenantId: t, kind: 'disruption_followup', appointmentId: a.id, clientId: a.clientId || null, clientName: a.clientName || null };
    if (email.includes('@')) await sendNotification(db, { ...base, channel: 'email', to: email, subject, html: brandedEmailHtml({ studioName: studio, title: subject, bodyLines: [`Hi ${first(a.clientName)},`, ...lines, `Kind regards, ${studio}`] } as any) } as any).catch(() => null);
    if (phone) await sendNotification(db, { ...base, channel: 'sms', to: phone, text: `Hi ${first(a.clientName)}, ${lines.join(' ')}` } as any).catch(() => null);
  } catch (e) { console.error('[callout tell]', e); }
}
const resolved = (d: any, outcome: string) => ({ ...d, status: 'resolved', outcome });

/** The client takes one of the kept times. First to tap gets it. */
export async function takeKeptTime(db: any, t: string, a: any, keptId: string, now = Date.now()) {
  const T = `tenants/${t}`; const d = a.disruption || {}; const cRef = db.doc(`${T}/providerCallouts/${d.id}`);
  const r = await db.runTransaction(async (tx: any) => {
    const rec: any = (await tx.get(cRef)).data(); const list: KeptTime[] = rec?.choices?.keptTimes || [];
    const k = list.find((x) => x.id === keptId);
    if (!rec || rec.choices?.done || ms(rec.choices?.holdUntil) <= now) return { ok: false, error: 'We are sorry, these times are no longer being held. Please choose a new time from your visit link, or call us.' };
    if (!k || ms(k.start) <= now + 2 * H) return { ok: false, error: 'We are sorry, that time is no longer available. Please choose another.' };
    if (k.takenBy && k.takenBy !== a.id) return { ok: false, error: 'We are sorry, that time has just been chosen by another client. Please choose another.' };
    if (k.minutes < durMin(a)) return { ok: false, error: 'We are sorry, that time is too short for your appointment. Please choose another.' };
    tx.set(cRef, { choices: { ...rec.choices, keptTimes: list.map((x) => (x.id === keptId ? { ...x, takenBy: a.id } : x)) } }, { merge: true });
    return { ok: true, k };
  });
  if (!r.ok) return r;
  const s = ms(r.k.start), dur = durMin(a); const tz = tenantTimeZone((await db.doc(T).get()).data() || {});
  const move = { startTime: iso(s), endTime: iso(s + dur * MIN), previousStartTime: a.startTime, originalScheduledTime: a.originalScheduledTime || a.startTime,
    rescheduledAt: iso(now), rescheduledBy: 'client_callout_choice', reminderSentAt: null, disruption: resolved(d, 'rescheduled') };
  await db.doc(`${T}/appointments/${a.id}`).set(move, { merge: true }); await mirror(db, t, a, move);
  await db.doc(`${T}/staffBlocks/co_${d.id}_${keptId}`).delete().catch(() => {});
  await cRef.set({ affected: { [a.id]: { outcome: 'rescheduled', outcomeAt: iso(now), by: 'client', newStartTime: iso(s), needsCall: false } } }, { merge: true });
  await bell(db, t, a.staffId || null, `${a.clientName || 'A client'} has chosen a new time with you: ${whenText(s, tz)}.`, now, { appointmentId: a.id });
  await tellClient(db, t, a, `Your new appointment time: ${whenText(s, tz)}`, [`thank you for choosing a new time. Your ${a.serviceName || 'appointment'} is now booked for ${whenText(s, tz)}. We look forward to seeing you.`]);
  return { ok: true, startTime: iso(s), when: whenText(s, tz) };
}

/** The client keeps their time with a colleague who is free and does that service. They keep the price they booked. */
export async function switchProvider(db: any, t: string, a: any, staffId: string, now = Date.now()) {
  const T = `tenants/${t}`; const d = a.disruption || {}; const cRef = db.doc(`${T}/providerCallouts/${d.id}`);
  const rec: any = (await cRef.get()).data(); const o = (rec?.affected?.[a.id]?.others || []).find((x: any) => x.staffId === staffId);
  if (!o) return { ok: false, error: 'We are sorry, that option is no longer available.' };
  const s = ms(a.startTime), e = ms(a.endTime) || s + durMin(a) * MIN;
  const { providerFree } = await import('@/lib/provider-availability');
  if (!(await providerFree(db, T, staffId, s, e, a.id))) return { ok: false, error: `We are sorry, ${first(o.name)} is no longer available at that time. Please choose another option.` };
  const tz = tenantTimeZone((await db.doc(T).get()).data() || {});
  const hist = Array.isArray(a.providerHistory) ? a.providerHistory : [];
  const f = { staffId, staffName: o.name, originalStaffId: a.originalStaffId || a.staffId || null, originalScheduledTime: a.originalScheduledTime || a.startTime,
    providerHistory: [...hist, { from: a.staffId || null, fromName: rec.staffName || null, to: staffId, toName: o.name, at: iso(now), by: 'client choice (callout)' }],
    disruption: resolved(d, 'reassigned') };
  await db.doc(`${T}/appointments/${a.id}`).set(f, { merge: true }); await mirror(db, t, a, { staffId, staffName: o.name, disruption: f.disruption });
  await cRef.set({ affected: { [a.id]: { outcome: 'reassigned', outcomeAt: iso(now), by: 'client', newStaffId: staffId, needsCall: false } } }, { merge: true });
  await bell(db, t, staffId, `${a.clientName || 'A client'} is now booked with you for ${a.serviceName || 'an appointment'} on ${whenText(s, tz)}, as ${first(rec.staffName)} is unavailable. They keep the price they booked.`, now, { appointmentId: a.id });
  await tellClient(db, t, a, `Your appointment with ${first(o.name)}`, [`thank you. Your ${a.serviceName || 'appointment'} on ${whenText(s, tz)} will now be with ${first(o.name)}, at the price you booked. We look forward to seeing you.`]);
  return { ok: true, staffName: first(o.name), when: whenText(s, tz) };
}

/** After cancelling (no fee), put them first in line for this provider. */
export async function firstInLine(db: any, t: string, a: any, now = Date.now()) {
  const T = `tenants/${t}`; const d = a.disruption || {};
  const rec: any = d.id ? (await db.doc(`${T}/providerCallouts/${d.id}`).get()).data() || {} : {};
  const cl: any = a.clientId ? ((await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}) : {};
  const ref = db.collection(`${T}/waitlist`).doc();
  await ref.set({ id: ref.id, tenantId: t, clientId: a.clientId || null, clientName: a.clientName || null, name: a.clientName || 'Client', phone: cl.phone || a.clientPhone || '', email: cl.email || a.clientEmail || '',
    serviceId: a.serviceId || null, serviceName: a.serviceName || '', staffId: rec.staffId || a.staffId || null, windows: null, noticeHours: 3,
    until: new Date(now + 30 * DAY).toISOString().slice(0, 10), status: 'waiting', source: 'callout', priorityUntil: iso(now + 14 * DAY), missedCount: 0, createdAt: iso(now) });
  if (d.id) await db.doc(`${T}/providerCallouts/${d.id}`).set({ affected: { [a.id]: { firstInLine: true, waitlistEntryId: ref.id } } }, { merge: true });
  return ref.id;
}

/** Every few minutes: the undecided move to the call list; once the choose-by times pass, unpicked kept times go to the waitlist. */
export async function calloutSweep(db: any, t: string, now = Date.now()) {
  const T = `tenants/${t}`; let called = 0, released = 0;
  const recs = (await db.collection(`${T}/providerCallouts`).where('createdAt', '>=', iso(now - 21 * DAY)).get()).docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) }));
  for (const rec of recs) {
    if (!rec.choices || rec.choices.done || rec.withdrawnAt) continue;
    const tz = tenantTimeZone((await db.doc(T).get()).data() || {});
    const upd: Record<string, any> = {}; const names: string[] = [];
    for (const en of Object.values<any>(rec.affected || {})) {
      if (en.isRenterBooking || en.outcome !== 'pending' || en.needsCall || !en.chooseBy || ms(en.chooseBy) > now) continue;
      upd[en.appointmentId] = { needsCall: true, callListAt: iso(now) }; names.push(`${en.clientName || 'A client'} (${whenText(ms(en.startTime), tz)})`); called++;
    }
    if (names.length) await tellDesk(db, t, `Action needed: ${names.length === 1 ? 'this client has' : 'these clients have'} not yet chosen what to do about ${rec.staffName || 'the provider'}’s absence. Please call ${names.length === 1 ? 'them' : 'each of them'}: ${names.join('; ')}. Their appointments remain on the schedule until you have spoken.`, now);
    const allDone = Object.values<any>(rec.affected || {}).every((en: any) => en.isRenterBooking || en.outcome !== 'pending');
    let choices = rec.choices;
    if (ms(rec.choices.holdUntil) <= now || allDone) {
      const { makeOpening } = await import('@/lib/waitlist-server');
      for (const k of (rec.choices.keptTimes || []) as KeptTime[]) {
        if (k.takenBy) continue;
        await db.doc(`${T}/staffBlocks/co_${rec.id}_${k.id}`).delete().catch(() => {});
        if (ms(k.start) > now + H) { await makeOpening(db, t, { id: `op_co_${rec.id}_${k.id}`, staffId: rec.staffId, staffName: rec.staffName || '', start: k.start, end: iso(ms(k.start) + k.minutes * MIN), serviceId: null, serviceName: '', source: 'callout', gapChecked: true }, now); released++; }
      }
      choices = { ...rec.choices, done: true, releasedAt: iso(now) };
    }
    if (Object.keys(upd).length || choices !== rec.choices) await db.doc(`${T}/providerCallouts/${rec.id}`).set({ ...(Object.keys(upd).length ? { affected: upd } : {}), choices }, { merge: true });
  }
  return { called, released };
}

/** The provider can come in after all: the undecided keep their visit as booked; anyone who moved keeps the new time. */
export async function backAfterAll(db: any, t: string, calloutId: string, now = Date.now()) {
  const T = `tenants/${t}`; const ref = db.doc(`${T}/providerCallouts/${calloutId}`); const rec: any = (await ref.get()).data();
  if (!rec) return { ok: false, error: 'That callout was not found.' };
  if (rec.withdrawnAt) return { ok: true, kept: 0 };
  const tz = tenantTimeZone((await db.doc(T).get()).data() || {}); let kept = 0; const upd: Record<string, any> = {};
  for (const en of Object.values<any>(rec.affected || {})) {
    if (en.outcome !== 'pending') continue;
    const aRef = db.doc(`${T}/appointments/${en.appointmentId}`); const a: any = { id: en.appointmentId, ...((await aRef.get()).data() || {}) };
    if (DEAD.includes(String(a.status || ''))) continue;
    const f = { disruption: resolved(a.disruption || {}, 'kept') };
    await aRef.set(f, { merge: true }); await mirror(db, t, a, f);
    upd[en.appointmentId] = { outcome: 'kept', outcomeAt: iso(now), by: 'provider back', needsCall: false }; kept++;
    if (!en.isRenterBooking) await tellClient(db, t, a, 'Your appointment is going ahead', [`we are pleased to let you know that ${first(rec.staffName)} is able to see you after all, so your ${a.serviceName || 'appointment'} on ${whenText(ms(a.startTime), tz)} will go ahead as booked. We apologize for any confusion and look forward to seeing you.`]);
  }
  // Her calendar opens again, and the held times are simply free.
  for (const coll of ['shiftDayOffBlocks', 'staffBlocks']) {
    const snap = await db.collection(`${T}/${coll}`).where('calloutId', '==', calloutId).get();
    for (const x of snap.docs) await x.ref.delete().catch(() => {});
  }
  await ref.set({ affected: upd, withdrawnAt: iso(now), choices: rec.choices ? { ...rec.choices, done: true, releasedAt: iso(now) } : null }, { merge: true });
  return { ok: true, kept };
}
