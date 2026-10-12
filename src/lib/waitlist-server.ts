// src/lib/waitlist-server.ts — THE WAITLIST, v2, the server half of lib/waitlist-engine. Every few minutes (the
// no-shows cron): a cancelled visit's time becomes an OPENING; each opening is matched against the list with the real
// booking engine (shifts, breaks, buffers, rooms — lib/rebook openTimesOn), and offered the way its lead time calls for.
// The person taps the link in the text (/w/{tenant}/{token}) and it books there and then — through the booking engine
// for someone new, or by moving their own visit up for "come in sooner" — and the time they leave becomes the next
// opening. Openings are server-only (tenants/{t}/openings); the desk reads them through /api/waitlist.
import { randomBytes } from 'crypto';
import { offerModeFor, fitFor, moveUpOk, rank, nextOffers, offerText, isWaiting, serviceOf, windowFits, HOLD_ONE_MIN, HOLD_FIRST_MIN, type Entry, type Opening, type Mode } from '@/lib/waitlist-engine';

const T = (t: string) => `tenants/${t}`;
const H = 3600e3, DAY = 864e5;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired', 'rejected'];
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || 'there';
const money = (n: any) => { const v = Number(n) || 0; return v ? `$${v % 1 ? v.toFixed(2) : v}` : ''; };

export type Deps = {
  send?: (db: any, t: string, to: string, body: string, fb?: any, meta?: any) => Promise<{ ok: boolean; via?: string; error?: string }>;
  book?: (tenant: any, body: any) => Promise<any>;
  engine?: (db: any, t: string) => Promise<any>;
  openTimes?: (e: any, o: { date: string; serviceId: string; staffId?: string | null }) => { startIso: string }[];
};
async function deps(d: Deps = {}) {
  const send = d.send || (async (...a: any[]) => { const { sendTenantSms } = await import('@/lib/sms'); return (sendTenantSms as any)(...a); });
  const book = d.book || (async (tenant: any, body: any) => { const { internalPost, internalOrigin } = await import('@/lib/message-policy');
    const r = await internalPost(internalOrigin(tenant), '/api/appointments/book', body, { retries: 0 }); return r.data || { ok: false, error: r.transportError || 'Couldn’t reach the booking service.' }; });
  const engine = d.engine || (async (db: any, t: string) => { const { engineFor } = await import('@/lib/rebook'); return engineFor(db, t); });
  const openTimes = d.openTimes || (await import('@/lib/rebook')).openTimesOn as any;
  return { send, book, engine, openTimes };
}
async function zoneOf(tenant: any) { const { tenantTimeZone } = await import('@/lib/tenant-time'); return tenantTimeZone(tenant); }
async function wall(startMs: number, tz: string) { const { wallParts } = await import('@/lib/tenant-time'); const p = wallParts(new Date(startMs), tz);
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; return { date, hour: p.hour, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() }; }
const whenLabel = (startMs: number, tz: string, now: number) => { const d = new Date(startMs); const sameDay = d.toLocaleDateString('en-US', { timeZone: tz }) === new Date(now).toLocaleDateString('en-US', { timeZone: tz });
  const t = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  return sameDay ? `Today at ${t}` : `${d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' })} at ${t}`; };

// ── Openings ─────────────────────────────────────────────────────────────────────────
/** A cancelled visit (an hour or more away, within 30 days) becomes an opening — once. */
export async function detectOpenings(db: any, t: string, now: number) {
  const snap = await db.collection(`${T(t)}/appointments`).where('startTime', '>=', iso(now + H)).where('startTime', '<=', iso(now + 30 * DAY)).get();
  const all = rows(snap); const made: string[] = [];
  for (const a of all) {
    if (!['cancelled', 'canceled'].includes(String(a.status || '')) || a.waitlistOpeningId || a.isRenterBooking || a.isWalkIn || !a.staffId) continue;
    const when = ms(a.cancelledAt) || ms(a.updatedAt) || now; if (now - when > 3 * DAY) continue;
    const s = ms(a.startTime), e = ms(a.endTime) || s + (Number(a.duration) || 60) * 60000;
    const refilled = all.some((o: any) => o.id !== a.id && o.staffId === a.staffId && !DEAD.includes(String(o.status || '')) && ms(o.startTime) < e && (ms(o.endTime) || ms(o.startTime) + 3600e3) > s);
    const id = `op_${a.id}`;
    if (!refilled) await makeOpening(db, t, { id, staffId: a.staffId, staffName: a.staffName || '', start: iso(s), end: iso(e), serviceId: a.serviceId || null, serviceName: a.serviceName || '', source: 'cancel', sourceAppointmentId: a.id, chainDepth: 0 }, now);
    await db.doc(`${T(t)}/appointments/${a.id}`).set({ waitlistOpeningId: refilled ? 'refilled' : id }, { merge: true });
    if (!refilled) made.push(id);
  }
  return made;
}
export async function makeOpening(db: any, t: string, o: any, now: number) {
  const ref = db.doc(`${T(t)}/openings/${o.id}`); if ((await ref.get()).exists) return o.id;
  await ref.set({ ...o, minutes: Math.round((ms(o.end) - ms(o.start)) / 60000), status: 'open', offers: [], createdAt: iso(now) }); return o.id;
}

/** Everyone on the list for this opening: who fits (best first), and who doesn't and why. */
export async function matchesFor(db: any, t: string, op: any, now: number, d: Deps = {}, cache: any = {}) {
  const D = await deps(d); const tenant = cache.tenant || (await db.doc(T(t)).get()).data() || {}; const tz = await zoneOf(tenant);
  const e = cache.engine || (cache.engine = await D.engine(db, t)); if (!e) return { fits: [], not: [] };
  const entries: Entry[] = cache.entries || (cache.entries = rows(await db.collection(`${T(t)}/waitlist`).get()));
  const appts: any[] = cache.appts || (cache.appts = rows(await db.collection(`${T(t)}/appointments`).where('startTime', '>=', iso(now - DAY)).where('startTime', '<=', iso(now + 60 * DAY)).get()));
  const clients: Map<string, any> = cache.clients || (cache.clients = new Map());
  const services: any[] = e.services || []; const svc = (id: string) => services.find((s: any) => s.id === id);
  const durOf = (s: any) => (s ? Number(s.duration || s.durationMinutes || 0) || null : null);
  const shortest = Math.min(...services.filter((s: any) => s.isActive !== false && s.type !== 'addon' && !s.isAddOn && durOf(s)).map((s: any) => durOf(s) as number), 30);
  const w = await wall(ms(op.start), tz); const offered = new Set((op.offers || []).map((f: any) => f.entryId));
  const bookableCache = new Map<string, boolean>();
  const bookable = (serviceId: string) => { if (!serviceId) return false; if (!bookableCache.has(serviceId)) bookableCache.set(serviceId, D.openTimes(e, { date: w.date, serviceId, staffId: op.staffId }).some((s: any) => ms(s.startIso) === ms(op.start))); return bookableCache.get(serviceId)!; };
  const fits: any[] = [], not: any[] = [];
  for (const en of entries) {
    if (offered.has(en.id) || !isWaiting(en)) continue;
    if (en.status === 'offered' && now - ms((en as any).lastOfferAt) < 30 * 60000) { not.push({ e: en, why: 'has another offer right now' }); continue; }
    let ent: Entry = { ...en };
    if (ent.clientId && !clients.has(ent.clientId)) clients.set(ent.clientId, ((await db.doc(`${T(t)}/clients/${ent.clientId}`).get()).data() || {}));
    const cl = ent.clientId ? clients.get(ent.clientId) : null;
    if (cl && (Number(cl.noShowCount) || 0) >= 2) ent.reliability = 'misses';
    ent.visits = Number(cl?.visitCount || cl?.totalVisits || 0);
    let mine: any = null;
    if (ent.kind === 'sooner') { mine = appts.find((a: any) => a.id === ent.appointmentId); if (!mine || DEAD.includes(String(mine.status || ''))) continue; ent = { ...ent, serviceId: mine.serviceId, staffId: ent.staffId === 'any' ? null : mine.staffId }; }
    const sid = serviceOf(ent);
    const sameDay = appts.some((a: any) => ent.clientId && a.clientId === ent.clientId && a.id !== mine?.id && !DEAD.includes(String(a.status || '')) && new Date(ms(a.startTime)).toLocaleDateString('en-US', { timeZone: tz }) === new Date(ms(op.start)).toLocaleDateString('en-US', { timeZone: tz }));
    const f = fitFor(ent, op as Opening, { now, tz: w, serviceMinutes: durOf(svc(sid)), shortest, bookable: bookable(sid), sameDayBooked: sameDay });
    if (!f.ok) { not.push({ e: ent, why: f.why }); continue; }
    if (ent.kind === 'sooner') {
      const freed = ms(mine.startTime); let newcomer = false;
      if (freed - now < 3 * DAY) { const fw = await wall(freed, tz); newcomer = entries.some((x: any) => x.kind !== 'sooner' && isWaiting(x) && serviceOf(x) && (!x.staffId || x.staffId === mine.staffId) && windowFits(x.windows, fw.weekday, fw.hour)); }
      const mv = moveUpOk(op as Opening, freed, now, newcomer); if (!mv.ok) { not.push({ e: ent, why: mv.why }); continue; }
      fits.push({ e: ent, leftover: f.leftover, appt: mine });
    } else fits.push({ e: ent, leftover: f.leftover });
  }
  return { fits: rank(fits), not, service: svc, tz, tenant };
}

// ── The sweep ────────────────────────────────────────────────────────────────────────
/** Every few minutes: new openings; offers out (or the desk told); holds that ran out move on; old entries expire. */
export async function waitlistSweep(db: any, t: string, tenant: any, now = Date.now(), d: Deps = {}) {
  if (tenant?.waitlistAuto === false) return { ok: true, skipped: 'off' };
  await detectOpenings(db, t, now);
  const ops = rows(await db.collection(`${T(t)}/openings`).where('status', '==', 'open').get());
  let sent = 0, desk = 0; const cache: any = { tenant };
  const { inTextWindow } = await import('@/lib/campaigns'); const tz = await zoneOf(tenant); const canText = inTextWindow(tz, new Date(now));
  for (const op of ops) {
    const ref = db.doc(`${T(t)}/openings/${op.id}`);
    if (ms(op.start) <= now) { await ref.update({ status: 'expired', closedAt: iso(now) }); continue; }
    const mode: Mode = offerModeFor(ms(op.start), now);
    const offers = (op.offers || []).map((f: any) => (f.status === 'sent' && ms(f.holdUntil) <= now ? { ...f, status: 'lapsed' } : f));
    if (mode === 'desk') { if (!op.deskAt) { await tellDesk(db, t, op, tz, now); desk++; } await ref.update({ mode, offers, deskAt: op.deskAt || iso(now) }); continue; }
    const fresh = JSON.stringify(offers) !== JSON.stringify(op.offers || []);
    if (!canText) { if (fresh) await ref.update({ offers }); continue; }
    const m = await matchesFor(db, t, { ...op, offers }, now, d, cache);
    const n = nextOffers(mode, offers, m.fits, now);
    const out: any[] = [];
    for (const c of m.fits.slice(0, n)) { const r = await sendOffer(db, t, op, c, mode, now, d, m); if (r) out.push(r); }
    sent += out.length;
    if (fresh || out.length || op.mode !== mode || !op.checkedAt || now - ms(op.checkedAt) > 30 * 60000)
      await ref.update({ mode, offers: [...offers, ...out], checkedAt: iso(now), fitCount: m.fits.length, nobodyFits: m.fits.length === 0 && !offers.some((f: any) => f.status === 'sent') });
  }
  // The list stays fresh: past the date they gave (or 60 days), it closes.
  const ents = rows(await db.collection(`${T(t)}/waitlist`).get());
  for (const e of ents) { if (!isWaiting(e)) continue; const until = e.until ? ms(`${String(e.until).slice(0, 10)}T23:59:59Z`) : ms(e.createdAt || e.addedAt) + 60 * DAY;
    if (until && until < now) await db.doc(`${T(t)}/waitlist/${e.id}`).set({ status: 'expired', closedAt: iso(now) }, { merge: true }); }
  return { ok: true, openings: ops.length, sent, desk };
}

async function sendOffer(db: any, t: string, op: any, c: any, mode: Mode, now: number, d: Deps, m: any) {
  const D = await deps(d); const e: Entry = c.e; const tenant = m.tenant; const tz = m.tz;
  const cl = e.clientId ? ((await db.doc(`${T(t)}/clients/${e.clientId}`).get()).data() || {}) : {};
  const phone = String(e.phone || cl.phone || cl.phoneNumber || '').trim(); if (!phone || cl.smsOptOut || cl.smsConsent === false) return null;
  const token = `${op.id}.${randomBytes(12).toString('base64url')}`;
  const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, ''); if (!base) return null;
  const s = m.service(serviceOf(e)); const hold = mode === 'one' ? HOLD_ONE_MIN : HOLD_FIRST_MIN;
  const body = offerText({ first: first(e.name || cl.firstName || cl.name), provider: first(op.staffName), when: whenLabel(ms(op.start), tz, now), service: String(s?.name || 'visit').toLowerCase(), price: money(s?.price), link: `${base}/w/${encodeURIComponent(t)}/${token}`, mode, holdMin: hold,
    sooner: c.appt ? { was: whenLabel(ms(c.appt.startTime), tz, now).replace(/ at /, ' at ') } : null, business: String(tenant.name || '') });
  const r = await D.send(db, t, phone, body, undefined, { kind: 'waitlist_offer', recipientType: 'client', recipientId: e.clientId || undefined, recipientName: e.name || undefined });
  if (!r?.ok) return null;
  await db.doc(`${T(t)}/waitlist/${e.id}`).set({ status: 'offered', lastOfferAt: iso(now), offerCount: (Number((e as any).offerCount) || 0) + 1 }, { merge: true });
  return { token, entryId: e.id, kind: e.kind === 'sooner' ? 'sooner' : 'new', appointmentId: c.appt?.id || null, clientId: e.clientId || null, name: e.name || cl.name || '', phone, serviceId: serviceOf(e), sentAt: iso(now), holdUntil: iso(now + hold * 60000), status: 'sent', mode };
}

async function tellDesk(db: any, t: string, op: any, tz: string, now: number) {
  const staff = rows(await db.collection(`${T(t)}/staff`).get()).filter((m: any) => !m.archived && ['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')));
  const b = db.batch(); const when = new Date(ms(op.start)).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  for (const m of staff) { const r = db.collection(`${T(t)}/notifications`).doc();
    b.set(r, { id: r.id, userId: m.id, type: 'waitlist_desk', link: '/waitlist', read: false, createdAt: iso(now), message: `${when} with ${first(op.staffName)} is open and under an hour away — anyone in the building, on the walk-in list, or the next client who could come early?` }); }
  await b.commit();
}

// ── The person's link ────────────────────────────────────────────────────────────────
async function byToken(db: any, t: string, token: string) {
  const id = String(token || '').split('.')[0]; if (!/^op_[\w-]+$/.test(id)) return null;
  const s = await db.doc(`${T(t)}/openings/${id}`).get(); if (!s.exists) return null; const op = { id: s.id, ...(s.data() || {}) } as any;
  const offer = (op.offers || []).find((f: any) => f.token === token); return offer ? { op, offer } : null;
}
export async function viewOffer(db: any, t: string, token: string, now = Date.now()) {
  const x = await byToken(db, t, token); if (!x) return { ok: false, error: 'This link isn’t valid any more.' };
  const tenant = (await db.doc(T(t)).get()).data() || {}; const tz = await zoneOf(tenant); const { op, offer } = x;
  const svc = offer.serviceId ? ((await db.doc(`${T(t)}/services/${offer.serviceId}`).get()).data() || {}) : {};
  const state = op.status === 'filled' ? (op.filledBy?.token === token ? 'yours' : 'taken') : op.status !== 'open' || ms(op.start) <= now ? 'gone'
    : offer.status === 'declined' ? 'passed' : offer.mode === 'one' && ms(offer.holdUntil) <= now && (op.offers || []).some((f: any) => f.token !== token && f.status === 'sent' && ms(f.holdUntil) > now) ? 'held_for_other' : 'open';
  return { ok: true, state, business: String(tenant.name || ''), logo: tenant.logoUrl || null, when: whenLabel(ms(op.start), tz, now), staffName: first(op.staffName), service: String(svc.name || op.serviceName || 'Your visit'), minutes: Number(svc.duration || op.minutes || 60), price: money(svc.price),
    holdUntil: offer.mode === 'one' ? offer.holdUntil : null, mode: offer.mode, sooner: offer.kind === 'sooner', payUrl: op.filledBy?.token === token ? op.filledBy.payUrl || null : null };
}

/** "Take it": first tap wins, checked inside a transaction; then booked through the engine (or their visit moved up). */
export async function takeOffer(db: any, t: string, token: string, now = Date.now(), d: Deps = {}) {
  const D = await deps(d); const x = await byToken(db, t, token); if (!x) return { ok: false, error: 'This link isn’t valid any more.' };
  const ref = db.doc(`${T(t)}/openings/${x.op.id}`);
  const lock = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const op: any = { id: s.id, ...(s.data() || {}) };
    const offer = (op.offers || []).find((f: any) => f.token === token);
    if (!offer) return { ok: false, error: 'This link isn’t valid any more.' };
    if (op.status === 'filled') return { ok: false, taken: true, error: 'Someone just took it — sorry! You’re still on the list.' };
    if (op.status !== 'open' || ms(op.start) <= now + 15 * 60000) return { ok: false, error: 'This time isn’t available any more.' };
    if (op.claiming && now - ms(op.claiming.at) < 60000) return { ok: false, taken: true, error: 'Someone just took it — sorry! You’re still on the list.' };
    if (offer.mode === 'one' && ms(offer.holdUntil) <= now && (op.offers || []).some((f: any) => f.token !== token && f.status === 'sent' && ms(f.holdUntil) > now)) return { ok: false, error: 'It’s being held for someone else right now — you’re still on the list.' };
    tx.update(ref, { claiming: { token, at: iso(now) } }); return { ok: true, op, offer };
  });
  if (!lock.ok) return lock;
  const { op, offer } = lock as any; const tenant = (await db.doc(T(t)).get()).data() || {};
  const release = async (why: string) => { await ref.update({ claiming: null, offers: (op.offers || []).map((f: any) => (f.token === token ? { ...f, status: 'lost', lostWhy: why } : f)) }); };
  let appointmentId = '', payUrl: string | null = null;
  if (offer.kind === 'sooner') {
    const r = await moveUp(db, t, offer.appointmentId, ms(op.start), now); if (!r.ok) { await release(r.error); return r; }
    appointmentId = offer.appointmentId;
    await makeOpening(db, t, { id: `op_${offer.appointmentId}_${ms(r.freedStart)}`, staffId: r.staffId, staffName: r.staffName, start: r.freedStart, end: r.freedEnd, serviceId: r.serviceId, serviceName: r.serviceName, source: 'moveup', sourceAppointmentId: offer.appointmentId, chainDepth: (Number(op.chainDepth) || 0) + 1 }, now);
  } else {
    const entry = (await db.doc(`${T(t)}/waitlist/${offer.entryId}`).get()).data() || {};
    const r: any = await D.book(tenant, { tenantId: t, source: 'waitlist', serviceId: offer.serviceId, staffId: op.staffId, startTime: op.start, notes: 'From the waitlist',
      client: entry.clientId ? { id: entry.clientId } : { name: entry.name || entry.clientName || offer.name, phone: entry.phone || offer.phone, email: entry.email || '' } });
    if (!r?.ok) { await release(r?.error || 'not bookable'); return { ok: false, error: 'That time was just taken — sorry! You’re still on the list.' }; }
    appointmentId = r.appointmentId;
    if (r.status === 'pending_payment' && r.checkInToken) { const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, ''); payUrl = base ? `${base}/check-in/${r.checkInToken}` : null; }
  }
  await ref.update({ status: 'filled', claiming: null, filledAt: iso(now), filledBy: { token, entryId: offer.entryId, kind: offer.kind, appointmentId, name: offer.name, payUrl },
    offers: (op.offers || []).map((f: any) => (f.token === token ? { ...f, status: 'taken', takenAt: iso(now) } : f.status === 'sent' ? { ...f, status: 'lost' } : f)) });
  await db.doc(`${T(t)}/waitlist/${offer.entryId}`).set({ status: 'booked', bookedAt: iso(now), appointmentId }, { merge: true });
  if (appointmentId) await db.doc(`${T(t)}/appointments/${appointmentId}`).set({ fromWaitlist: { openingId: op.id, kind: offer.kind, at: iso(now) } }, { merge: true }).catch(() => {});
  return { ok: true, appointmentId, payUrl, sooner: offer.kind === 'sooner' };
}

export async function passOffer(db: any, t: string, token: string, now = Date.now()) {
  const x = await byToken(db, t, token); if (!x) return { ok: false, error: 'This link isn’t valid any more.' };
  await db.doc(`${T(t)}/openings/${x.op.id}`).update({ offers: (x.op.offers || []).map((f: any) => (f.token === token ? { ...f, status: 'declined', holdUntil: iso(now) } : f)) });
  await db.doc(`${T(t)}/waitlist/${x.offer.entryId}`).set({ status: 'waiting', lastPassAt: iso(now) }, { merge: true });
  return { ok: true };
}

/** Their own visit moves to the earlier time — same provider; only if that time is still free (in a transaction). */
export async function moveUp(db: any, t: string, apptId: string, newStartMs: number, now: number) {
  const ref = db.doc(`${T(t)}/appointments/${apptId}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return { ok: false, error: 'We couldn’t find your visit.' }; const a: any = s.data() || {};
    if (DEAD.includes(String(a.status || ''))) return { ok: false, error: 'That visit isn’t booked any more.' };
    const dur = Math.max(15 * 60000, ms(a.endTime) - ms(a.startTime) || 3600e3); const newEnd = newStartMs + dur;
    const near = await tx.get(db.collection(`${T(t)}/appointments`).where('startTime', '>=', iso(newStartMs - DAY)).where('startTime', '<=', iso(newEnd + DAY)));
    for (const d of near.docs) { if (d.id === apptId) continue; const o: any = d.data() || {};
      if (o.staffId !== a.staffId || DEAD.includes(String(o.status || ''))) continue;
      const oS = ms(o.startTime) - (Number(o.padBefore) || 0) * 60000, oE = (ms(o.endTime) || ms(o.startTime)) + (Number(o.padAfter) || 0) * 60000;
      if (newStartMs < oE && newEnd > oS) return { ok: false, error: 'That time was just taken — sorry! Your visit stays as it was.' }; }
    const move = { startTime: iso(newStartMs), endTime: iso(newEnd), previousStartTime: a.startTime, rescheduledAt: iso(now), rescheduledBy: 'waitlist_move_up', reminderSentAt: null };
    tx.set(ref, move, { merge: true });
    if (a.checkInToken) { tx.set(db.doc(`${T(t)}/appointmentCheckIns/${a.checkInToken}`), move, { merge: true }); tx.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), move, { merge: true }); }
    return { ok: true, freedStart: a.startTime, freedEnd: a.endTime || iso(ms(a.startTime) + dur), staffId: a.staffId, staffName: a.staffName || '', serviceId: a.serviceId || null, serviceName: a.serviceName || '' };
  });
}

// ── Joining, and "come in sooner" ───────────────────────────────────────────────────
export function cleanWindows(w: any): Record<string, string[]> | null {
  if (!w || typeof w !== 'object') return null; const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(w)) { if (!/^[0-6]$/.test(k) || !Array.isArray(v)) continue; const p = v.filter((x) => ['morning', 'afternoon', 'evening'].includes(String(x))).map(String); if (p.length) out[k] = [...new Set(p)]; }
  return Object.keys(out).length ? out : null;
}
export async function soonerFor(db: any, t: string, token: string, on: boolean, anyone = false, now = Date.now()) {
  const snap = await db.collection(`${T(t)}/appointments`).where('checkInToken', '==', String(token || '').slice(0, 80)).get(); const a: any = snap.docs[0] ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null;
  if (!a || DEAD.includes(String(a.status || '')) || ms(a.startTime) < now) return { ok: false, error: 'We couldn’t find an upcoming visit for this link.' };
  const col = db.collection(`${T(t)}/waitlist`); const mine = rows(await col.where('appointmentId', '==', a.id).get()).filter((e: any) => e.kind === 'sooner' && isWaiting(e));
  const flag = async (v: boolean) => { const f = { soonerOn: v }; await db.doc(`${T(t)}/appointments/${a.id}`).set(f, { merge: true }); if (a.checkInToken) { await db.doc(`${T(t)}/appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}); await db.doc(`appointmentCheckIns/${a.checkInToken}`).set(f, { merge: true }).catch(() => {}); } };
  if (!on) { for (const e of mine) await col.doc(e.id).set({ status: 'closed', closedAt: iso(now) }, { merge: true }); await flag(false); return { ok: true, on: false }; }
  if (mine.length) { await flag(true); return { ok: true, on: true }; }
  const cl = a.clientId ? ((await db.doc(`${T(t)}/clients/${a.clientId}`).get()).data() || {}) : {};
  const ref = col.doc(); await ref.set({ id: ref.id, kind: 'sooner', appointmentId: a.id, clientId: a.clientId || null, name: a.clientName || cl.name || '', phone: cl.phone || a.clientPhone || '', email: cl.email || '',
    serviceId: a.serviceId || null, serviceName: a.serviceName || '', staffId: anyone ? 'any' : a.staffId, noticeHours: 3, until: String(a.startTime).slice(0, 10), status: 'waiting', source: 'come_in_sooner', createdAt: iso(now) });
  await flag(true); return { ok: true, on: true };
}

// ── The desk ─────────────────────────────────────────────────────────────────────────
export async function deskView(db: any, t: string, now = Date.now(), d: Deps = {}) {
  const tenant = (await db.doc(T(t)).get()).data() || {}; const tz = await zoneOf(tenant);
  const ops = rows(await db.collection(`${T(t)}/openings`).where('createdAt', '>=', iso(now - 30 * DAY)).get()).sort((a: any, b: any) => ms(a.start) - ms(b.start));
  const live = ops.filter((o: any) => o.status === 'open' && ms(o.start) > now); const cache: any = { tenant };
  const withMatches = [] as any[];
  for (const o of live.slice(0, 12)) { const m = await matchesFor(db, t, o, now, d, cache); withMatches.push({ ...o, mode: offerModeFor(ms(o.start), now), when: whenLabel(ms(o.start), tz, now),
    fits: m.fits.slice(0, 6).map((f: any) => ({ id: f.e.id, name: f.e.name, kind: f.e.kind || 'new', leftover: f.leftover, wanted: f.e.staffId && f.e.staffId !== 'any' ? 'asked for them' : 'anyone', waitedDays: Math.round((now - ms(f.e.createdAt || f.e.addedAt)) / DAY), freed: f.appt ? whenLabel(ms(f.appt.startTime), tz, now) : null })),
    not: m.not.slice(0, 6).map((x: any) => ({ id: x.e.id, name: x.e.name, why: x.why })),
    offers: (o.offers || []).map((f: any) => ({ name: f.name, status: f.status === 'sent' && ms(f.holdUntil) <= now ? 'lapsed' : f.status, sentAt: f.sentAt, holdUntil: f.holdUntil, kind: f.kind, mode: f.mode })) }); }
  const done = ops.filter((o: any) => o.status === 'filled'); const filledCents = 0;
  const entries = rows(await db.collection(`${T(t)}/waitlist`).get()).sort((a: any, b: any) => ms(b.createdAt || b.addedAt) - ms(a.createdAt || a.addedAt));
  const { demandOf } = await import('@/lib/waitlist-engine');
  const avgMin = done.length ? Math.round(done.reduce((s: number, o: any) => s + (ms(o.filledAt) - ms(o.createdAt)), 0) / done.length / 60000) : null;
  return { ok: true, tz, live: withMatches, recent: ops.filter((o: any) => o.status !== 'open').slice(-20).reverse().map((o: any) => ({ id: o.id, when: whenLabel(ms(o.start), tz, now), staffName: o.staffName, status: o.status, filledBy: o.filledBy?.name || null, kind: o.filledBy?.kind || null, source: o.source })),
    entries: entries.filter((e: any) => isWaiting(e)).slice(0, 200), stats: { openings: ops.length, filled: done.length, avgMinutes: avgMin, moveUps: done.filter((o: any) => o.filledBy?.kind === 'sooner').length, filledCents },
    demand: demandOf(entries, now).slice(0, 6), auto: tenant.waitlistAuto !== false };
}

/** The desk offers it to one particular person (from the fits list) — the same text and link. */
export async function offerTo(db: any, t: string, openingId: string, entryId: string, now = Date.now(), d: Deps = {}) {
  const s = await db.doc(`${T(t)}/openings/${openingId}`).get(); if (!s.exists) return { ok: false, error: 'That opening is gone.' };
  const op: any = { id: s.id, ...(s.data() || {}) }; if (op.status !== 'open') return { ok: false, error: 'It’s already filled or closed.' };
  const m = await matchesFor(db, t, op, now, d); const c = m.fits.find((f: any) => f.e.id === entryId);
  if (!c) { const n = m.not.find((x: any) => x.e.id === entryId); return { ok: false, error: n ? `It doesn’t fit them: ${n.why}.` : 'They’re not on the list for this.' }; }
  const mode: Mode = offerModeFor(ms(op.start), now) === 'first' ? 'first' : 'one';
  const r = await sendOffer(db, t, op, c, mode, now, d, m); if (!r) return { ok: false, error: 'The text didn’t go — no mobile number, or they said no to texts.' };
  await db.doc(`${T(t)}/openings/${openingId}`).update({ offers: [...(op.offers || []), { ...r, byDesk: true }] });
  return { ok: true };
}
