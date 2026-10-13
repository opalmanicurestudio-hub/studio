// src/lib/opportunities-server.ts — OPPORTUNITIES, the server half of lib/opportunities. The daily sweep finds what
// qualifies, hands each one to the right person (never over their limit), and later checks whether the client came
// back. The task screens act through here: an answer (outcome), a text sent in the business's name with every consent
// and limit checked, a different wording, handing it to someone else. Tasks live in tenants/{t}/opportunities —
// server only (firestore.rules), so nobody can make or close one except through these checks.
import { PLAYBOOKS, OUTCOMES, FINDER_KINDS, oppSettingsOf, findCandidates, filterCandidates, isHoldout, assignee, pickVersion, fill, outcomeEffects, cameBack, historyOf, heldForRoom, creditFor, resultState, TOOL_OF, ms, dollars, type OppKind, type OutcomeId, type OppSettings, type Candidate, type Pace, type Mode } from '@/lib/opportunities';
import type { RequestActor } from '@/lib/request-actor';

const T = (t: string) => `tenants/${t}`;
const DAY = 864e5;
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const str = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const nowIso = (n: number) => new Date(n).toISOString();
const CLOSED_CASE = ['closed', 'done', 'checked_back'];
const MAX_NEW = 60;   // per sweep — a first run on a big client list shouldn't bury the team

async function tz(tenant: any) { const { tenantTimeZone } = await import('@/lib/tenant-time'); return tenantTimeZone(tenant); }
async function team(db: any, t: string) { return rows(await db.collection(`${T(t)}/staff`).get()).filter((m: any) => !m.archived && m.isActive !== false); }
const businessName = (tenant: any) => String(tenant?.name || tenant?.businessName || 'us');

async function loadAll(db: any, t: string, now: number) {
  const since = nowIso(now - 400 * DAY);
  const safe = (p: Promise<any>) => p.catch(() => ({ docs: [] }));
  const [ap, cl, qu, gc, cs, rn, op] = await Promise.all([
    safe(db.collection(`${T(t)}/appointments`).where('startTime', '>=', since).get()),
    safe(db.collection(`${T(t)}/clients`).get()),
    safe(db.collection(`${T(t)}/quotes`).where('status', 'in', ['sent', 'viewed']).get()),
    safe(db.collection(`${T(t)}/giftCards`).where('status', '==', 'active').get()),
    safe(db.collection(`${T(t)}/cases`).get()),
    safe(db.collection(`${T(t)}/reconnectNudges`).where('sentAt', '>=', nowIso(now - 14 * DAY)).get()),
    safe(db.collection(`${T(t)}/opportunities`).where('createdAt', '>=', since).get()),
  ]);
  return { appointments: rows(ap), clients: rows(cl), quotes: rows(qu), giftCards: rows(gc), cases: rows(cs), nudges: rows(rn), opps: rows(op) };
}

const openLoad = (opps: any[]) => { const m = new Map<string, number>(); for (const o of opps) if (o.status === 'open' && o.assigneeId) m.set(o.assigneeId, (m.get(o.assigneeId) || 0) + 1); return m; };

export type Sender = (db: any, t: string, to: string, body: string, fallback?: any, meta?: any) => Promise<{ ok: boolean; via?: string; error?: string }>;
const ACTIVE = ['open', 'holdout', 'waiting', 'auto', 'scheduled'];
async function bookLink(tenant: any, t: string, c: { providerId?: string | null; opp?: string | null }) {
  const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, ''); if (!base) return '';
  const q = new URLSearchParams({ ...(c.providerId ? { provider: c.providerId } : {}), ...(c.opp ? { opp: c.opp } : {}) }).toString();   // the task rides the link, so the visit is credited to it
  return `${base}/book/${encodeURIComponent(t)}${q ? `?${q}` : ''}`;
}

/** The daily sweep (after 9 am local, so automatic texts land in texting hours): find; for each, send it automatically,
 * or hand it to a person, or both in turn (the business's choice per kind); move unanswered automatic texts to a person;
 * close what got booked; expire the rest; check who came back; one bell per person. */
export async function opportunitySweep(db: any, t: string, tenant: any, now = Date.now(), o: { force?: boolean; send?: Sender } = {}) {
  const S = oppSettingsOf(tenant); if (!S.on && !o.force) return { ok: true, skipped: 'off' };
  const zone = await tz(tenant); const { dayKey } = await import('@/lib/tenant-time'); const today = dayKey(new Date(now), zone);
  const mark = db.doc(`${T(t)}/private/opportunities`);
  if (!o.force) {
    const last = ((await mark.get()).data() || {}).lastDay; if (last === today) return { ok: true, skipped: 'done today' };
    const { localHour } = await import('@/lib/campaigns'); if (localHour(zone, new Date(now)) < 9) return { ok: true, skipped: 'too early' };
  }
  await mark.set({ lastDay: today, lastRunAt: nowIso(now) }, { merge: true });
  const send: Sender = o.send || (async (...a: any[]) => { const { sendTenantSms } = await import('@/lib/sms'); return (sendTenantSms as any)(...a); });
  const x = await loadAll(db, t, now); const staff = await team(db, t);
  const renterIds = new Set<string>(staff.filter((m: any) => m.role === 'renter' || m.isRenter).map((m: any) => String(m.id)));
  const clients = new Map<string, any>(x.clients.map((c: any) => [String(c.id), c]));
  const cand = filterCandidates(findCandidates({ clients: x.clients, appointments: x.appointments, quotes: x.quotes, giftCards: x.giftCards, settings: S, now, tz: zone, renterStaffIds: renterIds }), {
    existing: x.opps, clients, now,
    openCaseClients: new Set(x.cases.filter((c: any) => c.clientId && !CLOSED_CASE.includes(String(c.status || ''))).map((c: any) => String(c.clientId))),
    recentAutoNudge: new Set(x.nudges.map((n: any) => String(n.clientId || ''))),
  }).slice(0, MAX_NEW);
  const load = openLoad(x.opps); const month = today.slice(0, 7); const fresh: any[] = []; let sent = 0;
  const writes: Array<[any, any, 'set' | 'update']> = [];
  const pace = await paceFor(db, t, now, S, today); const held: Record<string, number> = {};
  const ctx: Ctx = { db, t, tenant, S, staff, clients, opps: x.opps, load, send };
  for (const c of cand) {
    const pb = PLAYBOOKS[c.kind]; const mode = S.modes[c.kind] || 'person'; if (mode === 'off') continue;
    if (heldForRoom(c.kind, c.providerId, pace, S)) { const k = c.providerId || 'business'; held[k] = (held[k] || 0) + 1; continue; }   // no room to see them yet
    const ref = db.collection(`${T(t)}/opportunities`).doc(); const base = baseOf(c, ref.id, mode, tenant, staff, clients, now);
    if (pb.winBack && isHoldout(c.key, month, S.holdoutPct)) { writes.push([ref, { ...base, status: 'holdout', assigneeId: null, assigneeName: null, version: 0, message: '' }, 'set']); fresh.push({ status: 'holdout' }); continue; }
    const r = await launch(ctx, base, now);
    writes.push([ref, r.doc, 'set']); for (const w of r.extra) writes.push([w[0], w[1], 'set']);
    if (r.sent) { sent++; fresh.push({ status: 'auto' }); } else if (r.doc.status === 'open') fresh.push(r.doc);
  }
  if (pace) await db.doc(`${T(t)}/private/opportunities`).set({ pace: { ...pace, held } }, { merge: true });
  try { await resultsPass(db, t, tenant, now); } catch (e) { console.error('[opportunities] results pass', e); }
  // Automatic texts: booked → closed as booked; no reply by the day the business chose → to a person; plain automatic → closes at its end date.
  let toPerson = 0, expired = 0, checked = 0;
  for (const e of x.opps) {
    const ref = db.doc(`${T(t)}/opportunities/${e.id}`);
    if (e.status === 'waiting' || e.status === 'auto') {
      const r = cameBack(e, x.appointments, now);
      if (r.status !== 'none') { writes.push([ref, { status: 'done', outcome: 'booked', closedAt: nowIso(now), result: { ...r, checkedAt: nowIso(now) } }, 'update']); continue; }
      if (e.status === 'auto' && ms(e.expiresAt) < now) { writes.push([ref, { status: 'done', outcome: 'no_answer', closedAt: nowIso(now) }, 'update']); continue; }
      if (e.status === 'waiting' && ms(e.escalateAt) <= now) {
        const pb = PLAYBOOKS[e.kind as OppKind]; const who = assignee(pb.who, e.providerId, staff, load, S.perPersonPerDay); if (who) load.set(who.id, (load.get(who.id) || 0) + 1);
        const d = new Date(ms(e.autoSentAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(zone ? { timeZone: zone } : {}) });
        const doc = { status: 'open', assigneeId: who?.id || null, assigneeName: who?.name || null, dueAt: nowIso(now), expiresAt: nowIso(now + 7 * DAY), why: `${e.why} · received the automatic text on ${d} and has not replied`,
          message: fill(pb.afterAuto || PLAYBOOKS.follow_up.versions[0], { ...(e.facts || {}), business: businessName(tenant), me: first(who?.name) || first(businessName(tenant)) }), escalatedAt: nowIso(now) };
        writes.push([ref, doc, 'update']); fresh.push({ ...e, ...doc }); toPerson++; continue;
      }
    }
    if (e.status === 'open' && ms(e.expiresAt) && ms(e.expiresAt) < now) { writes.push([ref, { status: 'expired', closedAt: nowIso(now) }, 'update']); expired++; continue; }
    // Who came back — checked for 45 days after we reached out (and for the left-alone group, the same way).
    if (!e.clientId || e.result?.status === 'paid' || now - ms(e.createdAt) > 45 * DAY) continue;
    if (!(e.firstContactAt || e.status === 'holdout' || e.outcome === 'booked')) continue;
    const r = cameBack(e, x.appointments, now); if (r.status === (e.result?.status || 'none')) continue;
    writes.push([ref, { result: { ...r, checkedAt: nowIso(now) } }, 'update']); checked++;
  }
  // One bell per person: "3 new tasks for you today".
  const by = new Map<string, any[]>(); for (const f of fresh) if (f.assigneeId) by.set(f.assigneeId, [...(by.get(f.assigneeId) || []), f]);
  for (const [sid, list] of by) { const r = db.collection(`${T(t)}/notifications`).doc();
    writes.push([r, { id: r.id, userId: sid, type: 'task', link: 'today', read: false, createdAt: nowIso(now), message: `You have ${list.length} new task${list.length === 1 ? '' : 's'}: ${list[0].clientName}${list.length > 1 ? ' and others' : ''}.` }, 'set']); }
  for (let i = 0; i < writes.length; i += 400) { const b = db.batch(); for (const [r, v, op] of writes.slice(i, i + 400)) { if (op === 'set') b.set(r, v); else b.update(r, v); } await b.commit(); }
  return { ok: true, created: fresh.filter((f) => f.status === 'open' && !f.escalatedAt).length, sent, toPerson, holdout: fresh.filter((f) => f.status === 'holdout').length, expired, checked };
}
const pickFrom = (n: number, used: number[]) => { for (let i = 0; i < n; i++) if (!used.includes(i)) return i; return used.length ? (Math.max(...used) + 1) % n : 0; };

// ── Starting one: automatic first, or a person ────────────────────────────────────────────────
type Ctx = { db: any; t: string; tenant: any; S: OppSettings; staff: any[]; clients: Map<string, any>; opps: any[]; load: Map<string, number>; send: Sender };
/** The record every task starts from, whatever found it: what it's about (the tool and the person), why, and roughly what it's worth. */
function baseOf(c: Candidate, id: string, mode: Mode, tenant: any, staff: any[], clients: Map<string, any>, now: number): any {
  const cl = c.clientId ? clients.get(c.clientId) : null; const prov = staff.find((m: any) => m.id === c.providerId);
  return { id, kind: c.kind, tool: c.tool, subject: c.subject, key: c.key, clientId: c.clientId, clientName: c.clientName, phone: cl?.phone || cl?.phoneNumber || c.facts.phone || null,
    why: c.why, valueCents: c.valueCents, valueNote: c.valueNote || null, priority: PLAYBOOKS[c.kind].priority, dueAt: c.dueAt, expiresAt: c.expiresAt, refs: c.refs, facts: { ...c.facts, business: businessName(tenant) },
    providerId: c.providerId, providerName: prov?.name || null, mode, tries: 0, attempts: [], createdAt: nowIso(now), createdBy: 'rules', result: { status: 'none' } };
}
/** Automatic first where the business chose it (and the client can be texted); otherwise, or if that can't go, a person. */
async function launch(ctx: Ctx, base: any, now: number): Promise<{ doc: any; extra: Array<[any, any]>; sent: boolean }> {
  const { db, t, tenant, S, staff } = ctx; const pb = PLAYBOOKS[base.kind as OppKind]; const mode: Mode = base.mode || S.modes[base.kind] || 'person';
  const cl = base.clientId ? ctx.clients.get(base.clientId) : null; const prov = staff.find((m: any) => m.id === base.providerId);
  const facts: any = { ...(base.facts || {}), business: businessName(tenant) }; const extra: Array<[any, any]> = [];
  let why = base.why;
  if ((mode === 'auto' || mode === 'auto_then_person') && pb.auto?.length) {
    const usedA = ctx.opps.filter((e: any) => e.clientId && e.clientId === base.clientId && e.kind === base.kind && Number.isInteger(e.autoVersion)).map((e: any) => e.autoVersion);
    const av = pickFrom(pb.auto.length, usedA); const link = await bookLink(tenant, t, { providerId: base.providerId, opp: base.id });
    const body = fill(pb.auto[av], { ...facts, link, me: first(prov?.name) || businessName(tenant) });
    const chk0 = await textCheck(db, t, tenant, base, cl || { phone: base.phone }, now);
    const chk: any = !link && pb.auto[av].includes('{link}') ? { ok: false, error: 'There is no booking link to send yet. Please set the app’s web address first.' } : chk0;
    const r: any = chk.ok ? await ctx.send(db, t, chk.phone, body, cl?.email ? { email: cl.email, subject: businessName(tenant) } : undefined, { kind: 'opportunity', recipientType: 'client', recipientId: base.clientId || undefined, recipientName: base.clientName }).catch(() => ({ ok: false })) : { ok: false, error: chk.error };
    if (r.ok) {
      { const { spendBudget } = await import('@/lib/text-budget'); await spendBudget(db, t, chk.phone, 'opportunity', now).catch(() => {}); }
      if (pb.marketing && base.clientId) extra.push([db.collection(`${T(t)}/opportunityTexts`).doc(), { clientId: base.clientId, at: nowIso(now), channel: 'sms', marketing: true, oppId: base.id }]);
      const auto = { at: nowIso(now), by: 'auto', byName: 'Sent automatically', channel: r.via === 'email' ? 'email' : 'text', note: body };
      return { doc: { ...base, facts, status: mode === 'auto' ? 'auto' : 'waiting', autoVersion: av, autoMessage: body, autoSentAt: nowIso(now), firstContactAt: nowIso(now), lastContactAt: nowIso(now),
        escalateAt: mode === 'auto_then_person' ? nowIso(now + S.afterDays * DAY) : null, attempts: [...(base.attempts || []), auto], assigneeId: null, assigneeName: null, version: 0, message: '' }, extra, sent: true };
    }
    if (mode === 'auto') return { doc: { ...base, facts, status: 'not_sent', notSentWhy: String(r.error || 'The text could not be sent.'), closedAt: nowIso(now), assigneeId: null, assigneeName: null, version: 0, message: '' }, extra, sent: false };
    why = `${base.why} · could not be texted automatically: ${String(r.error || 'the text could not be sent').replace(/\.$/, '').replace(/^./, (z: string) => z.toLowerCase())}`;
  }
  const who = assignee(pb.who, base.providerId, staff, ctx.load, S.perPersonPerDay); if (who) ctx.load.set(who.id, (ctx.load.get(who.id) || 0) + 1);
  const used = ctx.opps.filter((e: any) => e.clientId && e.clientId === base.clientId && e.kind === base.kind && Number.isInteger(e.version)).map((e: any) => e.version);
  const version = pickVersion(base.kind, used);
  return { doc: { ...base, facts, why, status: 'open', assigneeId: who?.id || null, assigneeName: who?.name || null, version, dueAt: nowIso(now),
    message: pb.versions[version] ? fill(pb.versions[version], { ...facts, me: first(who?.name) || first(businessName(tenant)) }) : '' }, extra, sent: false };
}

// ── Room on the schedule (once a day) ────────────────────────────────────────────────────────
/** Each provider's share of bookable start times still open over the next few weeks, from the real booking engine
 * (shifts, breaks, time off, buffers): open times with today's bookings ÷ open times with none. Worked out once a day
 * and kept in private/opportunities, so events during the day can use it too. Never blocks anything if it can't be read. */
export async function paceFor(db: any, t: string, now: number, S: OppSettings, today: string): Promise<Pace | null> {
  if (!S.paceMin) return null;
  const mark = db.doc(`${T(t)}/private/opportunities`); const cur = ((await mark.get()).data() || {}).pace;
  if (cur?.day === today && cur?.days === S.paceDays) return cur;
  let pace: Pace | null = null; try { pace = await computePace(db, t, S.paceDays, today); } catch { pace = null; }
  if (pace) await mark.set({ pace }, { merge: true });
  return pace;
}
const BUDGET_MS = 8000;   // a big team's first run of the day shouldn't hold up the 5-minute job for everyone else
async function computePace(db: any, t: string, days: number, today: string): Promise<Pace | null> {
  const { engineFor, openTimesOn, addDays } = await import('@/lib/rebook'); const e: any = await engineFor(db, t); if (!e) return null;
  const blocks = (e.data?.sb?.docs || []).filter((d: any) => ((d.data?.() || {}) as any).reason !== 'waitlist_hold');
  const empty = { ...e, data: { ...e.data, ap: { docs: [] }, sb: { ...(e.data?.sb || {}), docs: blocks } } };
  const appts = e.raw(e.data?.ap); const t0 = Date.now(); const byStaff: Pace['byStaff'] = {}; let open = 0, all = 0;
  for (const m of e.staff) {
    if (m.role === 'renter' || m.isRenter || m.archived) continue;
    const svc = repService(m.id, appts, e.services); if (!svc) continue;
    let o = 0, a = 0;
    for (let i = 1; i <= days && Date.now() - t0 < BUDGET_MS; i++) { const date = addDays(today, i);
      a += openTimesOn(empty, { date, serviceId: svc, staffId: m.id }).length; o += openTimesOn(e, { date, serviceId: svc, staffId: m.id }).length; }
    if (!a) continue;   // not working in that stretch: no reading, so nothing is held for them
    byStaff[m.id] = { share: Math.round((o / a) * 100) / 100, name: m.name || '' }; open += o; all += a;
  }
  return { day: today, days, byStaff, business: all ? Math.round((open / all) * 100) / 100 : null };
}
/** The service a provider does most (last 90 days), or the first one they offer — used to measure their open time. */
function repService(staffId: string, appts: any[], services: any[]): string | null {
  const since = Date.now() - 90 * DAY; const n = new Map<string, number>();
  for (const a of appts) if (a.staffId === staffId && a.serviceId && ms(a.startTime) >= since) n.set(a.serviceId, (n.get(a.serviceId) || 0) + 1);
  const top = [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (top && services.some((s: any) => s.id === top)) return top;
  const s = services.find((x: any) => !x.archived && x.isActive !== false && x.online !== false && (!Array.isArray(x.staffIds) || !x.staffIds.length || x.staffIds.includes(staffId)));
  return s?.id || null;
}

// ── The moment something happens (every 5 minutes) ─────────────────────────────────────────────
/** When a client should first hear from us after an event: never in the moment. A cancellation gets two hours (the
 * waitlist has the time first); a no-show or a checkout without a next visit, the next morning at 10. */
async function sendAtFor(kind: OppKind, now: number, zone: string): Promise<number> {
  if (kind === 'cancelled') return now + 2 * 3600e3;
  const { dayKey, addDays, wallToUtc } = await import('@/lib/tenant-time');
  return new Date(wallToUtc(addDays(dayKey(new Date(now), zone), 1), 10, 0, zone)).getTime();
}
/** A cancellation (from the visit watcher), a confirmed no-show or a checkout with nothing booked next becomes a task
 * right away, for that one client — not at tomorrow's daily run. It waits as 'scheduled' until its time (opportunityDue). */
export async function opportunityEvents(db: any, t: string, tenant: any, now = Date.now(), cancelled: Array<{ clientId?: string | null; appointmentId?: string }> = []) {
  const S = oppSettingsOf(tenant); if (!S.on) return { ok: true, skipped: 'off' };
  const mark = db.doc(`${T(t)}/private/opportunities`); const m: any = (await mark.get()).data() || {};
  const since = m.eventsAt && now - ms(m.eventsAt) < 2 * DAY ? String(m.eventsAt) : nowIso(now - 15 * 60e3);
  await mark.set({ eventsAt: nowIso(now) }, { merge: true });
  const safe = (p: Promise<any>) => p.catch(() => ({ docs: [] }));
  const [co, ce] = await Promise.all([safe(db.collection(`${T(t)}/appointments`).where('checkedOutAt', '>=', since).get()), safe(db.collection(`${T(t)}/cancellationEvents`).where('createdAt', '>=', since).get())]);
  const ev = new Map<string, Set<OppKind>>(); const add = (c: any, k: OppKind) => { const id = String(c || ''); if (!id) return; (ev.get(id) || ev.set(id, new Set()).get(id)!).add(k); };
  for (const a of rows(co)) if (!a.isRenterBooking && !a.isWalkIn) add(a.clientId, 'no_rebook');
  for (const e of rows(ce)) if (e.actorType === 'no_show') add(e.clientId, 'no_show');
  for (const c of cancelled) add(c.clientId, 'cancelled');
  if (!ev.size) return { ok: true, created: 0 };
  const zone = await tz(tenant); const { dayKey } = await import('@/lib/tenant-time'); const month = dayKey(new Date(now), zone).slice(0, 7);
  const staff = await team(db, t); const renterIds = new Set<string>(staff.filter((x: any) => x.role === 'renter' || x.isRenter).map((x: any) => String(x.id)));
  const pace: Pace | null = m.pace || null; let created = 0;
  for (const [cid, kinds] of ev) {
    const cs = await db.doc(`${T(t)}/clients/${cid}`).get(); if (!cs.exists) continue; const client = { id: cid, ...(cs.data() || {}) };
    const [as, os, ks, ns] = await Promise.all([safe(db.collection(`${T(t)}/appointments`).where('clientId', '==', cid).get()), safe(db.collection(`${T(t)}/opportunities`).where('clientId', '==', cid).get()),
      safe(db.collection(`${T(t)}/cases`).where('clientId', '==', cid).get()), safe(db.collection(`${T(t)}/reconnectNudges`).where('clientId', '==', cid).get())]);
    const cand = findCandidates({ clients: [client], appointments: rows(as), quotes: [], giftCards: [], settings: S, now, tz: zone, renterStaffIds: renterIds, fresh: true }).filter((c) => kinds.has(c.kind));
    const keep = filterCandidates(cand, { existing: rows(os), clients: new Map([[cid, client]]), now,
      openCaseClients: new Set(rows(ks).some((c: any) => !CLOSED_CASE.includes(String(c.status || ''))) ? [cid] : []),
      recentAutoNudge: new Set(rows(ns).some((n: any) => now - ms(n.sentAt) < 14 * DAY) ? [cid] : []) });
    for (const c of keep) {
      const mode = S.modes[c.kind] || 'person'; if (mode === 'off' || heldForRoom(c.kind, c.providerId, pace, S)) continue;
      const ref = db.collection(`${T(t)}/opportunities`).doc(); const base = baseOf(c, ref.id, mode, tenant, staff, new Map([[cid, client]]), now);
      if (PLAYBOOKS[c.kind].winBack && isHoldout(c.key, month, S.holdoutPct)) { await ref.set({ ...base, status: 'holdout', assigneeId: null, assigneeName: null, version: 0, message: '', via: 'event' }); continue; }
      const at = await sendAtFor(c.kind, now, zone);
      await ref.set({ ...base, status: 'scheduled', sendAt: nowIso(at), dueAt: nowIso(at), via: 'event', assigneeId: null, assigneeName: null, version: 0, message: '' }); created++;
    }
  }
  return { ok: true, created };
}
/** Scheduled tasks whose time has come: still relevant (nothing booked since)? Then automatic first, or a person —
 * the same way as the daily run. Automatic texts wait for texting hours. */
export async function opportunityDue(db: any, t: string, tenant: any, now = Date.now(), o: { send?: Sender } = {}) {
  const S = oppSettingsOf(tenant); if (!S.on) return { ok: true, skipped: 'off' };
  const list = rows(await db.collection(`${T(t)}/opportunities`).where('status', '==', 'scheduled').get().catch(() => ({ docs: [] }))).filter((e: any) => ms(e.sendAt) <= now);
  if (!list.length) return { ok: true, launched: 0 };
  const send: Sender = o.send || (async (...a: any[]) => { const { sendTenantSms } = await import('@/lib/sms'); return (sendTenantSms as any)(...a); });
  const zone = await tz(tenant); const { inTextWindow } = await import('@/lib/campaigns'); const textOk = inTextWindow(zone, new Date(now));
  const staff = await team(db, t); const load = openLoad(rows(await db.collection(`${T(t)}/opportunities`).where('status', '==', 'open').get()));
  const bells = new Map<string, any[]>(); let launched = 0, dropped = 0;
  for (const e of list) {
    const ref = db.doc(`${T(t)}/opportunities/${e.id}`); const mode: Mode = S.modes[e.kind] || 'person';
    const appts = e.clientId ? rows(await db.collection(`${T(t)}/appointments`).where('clientId', '==', e.clientId).get()) : [];
    const h = e.clientId ? historyOf(appts, now).get(String(e.clientId)) : null;
    if (mode === 'off' || h?.upcoming) { await ref.update({ status: 'done', outcome: 'no_longer_applies', closedAt: nowIso(now), ...(h?.upcoming ? { closedWhy: 'They booked on their own before we reached out.' } : {}) }); dropped++; continue; }
    if ((mode === 'auto' || mode === 'auto_then_person') && PLAYBOOKS[e.kind as OppKind]?.auto?.length && !textOk) continue;   // texting hours: try again next pass
    const cs = e.clientId ? await db.doc(`${T(t)}/clients/${e.clientId}`).get() : null; const clients = new Map<string, any>(cs?.exists ? [[String(e.clientId), { id: e.clientId, ...(cs.data() || {}) }]] : []);
    const opps = e.clientId ? rows(await db.collection(`${T(t)}/opportunities`).where('clientId', '==', e.clientId).get()) : [];
    const r = await launch({ db, t, tenant, S, staff, clients, opps, load, send }, { ...e, mode, sendAt: null, launchedAt: nowIso(now) }, now);
    await ref.set(r.doc); for (const w of r.extra) await w[0].set(w[1]); launched++;
    if (r.doc.status === 'open' && r.doc.assigneeId) bells.set(r.doc.assigneeId, [...(bells.get(r.doc.assigneeId) || []), r.doc]);
  }
  for (const [sid, l] of bells) { const r = db.collection(`${T(t)}/notifications`).doc();
    await r.set({ id: r.id, userId: sid, type: 'task', link: 'today', read: false, createdAt: nowIso(now), message: `You have ${l.length} new task${l.length === 1 ? '' : 's'}: ${l[0].clientName}${l.length > 1 ? ' and others' : ''}.` }); }
  return { ok: true, launched, dropped };
}

/** A client texted back (lib: /api/sms/inbound). If they're waiting on an automatic text, a person takes it now — with
 * what they said — instead of after the waiting days. */
export async function opportunityReply(db: any, t: string, fromDigits: string, body: string, now = Date.now()) {
  if (!fromDigits) return null; const dg = (v: any) => String(v || '').replace(/\D+/g, '').replace(/^1(\d{10})$/, '$1');
  const list = rows(await db.collection(`${T(t)}/opportunities`).where('status', 'in', ['waiting', 'auto']).get()).filter((e: any) => dg(e.phone) === fromDigits);
  if (!list.length) return null;
  const stop = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b/i.test(body);
  const tenant: any = (await db.doc(T(t)).get()).data() || {}; const S = oppSettingsOf(tenant); const staff = await team(db, t);
  const load = openLoad(rows(await db.collection(`${T(t)}/opportunities`).where('status', '==', 'open').get()));
  for (const e of list) {
    const ref = db.doc(`${T(t)}/opportunities/${e.id}`); const att = [...(e.attempts || []), { at: nowIso(now), by: 'client', byName: e.clientName || 'Client', channel: 'text', note: `Replied: “${body.slice(0, 300)}”` }].slice(-20);
    if (stop) { await ref.update({ status: 'done', outcome: 'stop', closedAt: nowIso(now), attempts: att }); continue; }
    const pb = PLAYBOOKS[e.kind as OppKind]; const who = assignee(pb.who, e.providerId, staff, load, 99); if (who) load.set(who.id, (load.get(who.id) || 0) + 1);
    await ref.update({ status: 'open', assigneeId: who?.id || null, assigneeName: who?.name || null, dueAt: nowIso(now), expiresAt: nowIso(now + 7 * DAY), attempts: att, priority: 'high',
      why: `Replied to the automatic text: “${body.slice(0, 160)}”`, message: '', repliedAt: nowIso(now) });
    if (who) { const r = db.collection(`${T(t)}/notifications`).doc(); await r.set({ id: r.id, userId: who.id, type: 'task', link: 'today', read: false, createdAt: nowIso(now), message: `${e.clientName || 'A client'} has replied: “${body.slice(0, 120)}”. This has been added to your tasks.` }); }
  }
  return list.length;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────
export async function listOpportunities(db: any, t: string, actor: RequestActor, now = Date.now()) {
  const manager = actor.isManager || actor.isOwner;
  const col = db.collection(`${T(t)}/opportunities`);
  const items = manager ? rows(await col.where('createdAt', '>=', nowIso(now - 60 * DAY)).get()) : rows(await col.where('assigneeId', '==', actor.staffId).get());
  const shown = items.filter((o: any) => manager ? o.status !== 'holdout' : (o.status === 'open' || (o.closedAt && now - ms(o.closedAt) < 7 * DAY)))
    .sort((a: any, b: any) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || rank(a) - rank(b) || ms(a.dueAt) - ms(b.dueAt));
  const tenant = (await db.doc(T(t)).get()).data() || {};
  const people = manager ? (await team(db, t)).filter((m: any) => m.role !== 'renter' && !m.isRenter).map((m: any) => ({ id: m.id, name: m.name || 'Team member', role: m.role || '' })) : [];
  const pace = manager ? (((await db.doc(`${T(t)}/private/opportunities`).get()).data() || {}).pace || null) : null;
  return { ok: true as const, items: shown, people, settings: oppSettingsOf(tenant), manager, pace };
}
const rank = (o: any) => ({ high: 0, medium: 1, low: 2 } as any)[o.priority] ?? 1;

// ── Acting ───────────────────────────────────────────────────────────────────────────
async function getOpp(db: any, t: string, id: string) { const s = await db.doc(`${T(t)}/opportunities/${str(id, 80)}`).get(); return s.exists ? { id: s.id, ...(s.data() || {}) } as any : null; }
const canTouch = (o: any, a: RequestActor) => a.isManager || a.isOwner || (o.assigneeId && o.assigneeId === a.staffId);

export async function textCheck(db: any, t: string, tenant: any, o: any, client: any, now: number, opts: { answering?: boolean } = {}): Promise<{ ok: true; phone: string } | { ok: false; error: string }> {
  const pb = PLAYBOOKS[o.kind as OppKind] || PLAYBOOKS.manual;
  const phone = String(client?.phone || client?.phoneNumber || o.phone || '').trim();
  if (!phone) return { ok: false, error: 'There is no mobile number on file. Please call or email this client instead.' };
  if (client?.smsOptOut || client?.smsConsent === false) return { ok: false, error: 'This client has opted out of texts. Please call instead.' };
  if (client?.opportunityOptOut) return { ok: false, error: 'This client has asked not to be contacted in this way.' };
  if (pb.marketing && !opts.answering) {   // answering a client who wrote back is a conversation, not marketing
    if (client?.marketingOptOut || client?.smsMarketingOptIn !== true) return { ok: false, error: 'This client has not agreed to marketing texts, so please call instead.' };
    const { recentMarketingTexts, MARKETING_TEXTS_PER_30_DAYS } = await import('@/lib/campaigns');
    const n = (await recentMarketingTexts(db, t, now)).get(String(o.clientId || '')) || 0;
    if (n >= MARKETING_TEXTS_PER_30_DAYS) return { ok: false, error: `This client has received ${n} texts from you in the last 30 days. Please call, or leave this for now.` };
  }
  const { inTextWindow } = await import('@/lib/campaigns');
  if (!inTextWindow(await tz(tenant), new Date(now))) return { ok: false, error: 'It is outside texting hours (9:00 AM to 8:00 PM). Please send it tomorrow, or call instead.' };
  if (!opts.answering && (o.attempts || []).some((x: any) => x.channel === 'text' && now - ms(x.at) < 2 * DAY)) return { ok: false, error: 'A text was sent in the last two days. Please give the client time to reply.' };
  { const { budgetLeft } = await import('@/lib/text-budget'); if ((await budgetLeft(db, t, phone, 'opportunity', now)) <= 0) return { ok: false, error: 'This client has already received texts from us today. Please try again tomorrow, or call instead.' }; }
  return { ok: true, phone };
}

/** What acting inside a task needs from the request: the booking service (signed internal call), public routes, the app's address. */
export type TaskIO = { internal: (path: string, body: any) => Promise<any>; post: (path: string, body: any) => Promise<any>; origin: string };
export async function actOnOpportunity(db: any, t: string, actor: RequestActor, b: any, now = Date.now(), io?: TaskIO) {
  const action = str(b.action, 20); const manager = actor.isManager || actor.isOwner;
  const tenant: any = (await db.doc(T(t)).get()).data() || {};
  if (action === 'settings') { if (!manager) return { ok: false, error: 'Only managers can do this.' };
    const s = oppSettingsOf({ opportunities: b.settings || {} }); await db.doc(T(t)).set({ opportunities: s }, { merge: true }); return { ok: true, settings: s }; }
  if (action === 'run') { if (!manager) return { ok: false, error: 'Only managers can do this.' }; return opportunitySweep(db, t, tenant, now, { force: true }); }
  if (action === 'results') { if (!manager) return { ok: false, error: 'Only managers can do this.' }; await resultsPass(db, t, tenant, now).catch(() => {}); return { ok: true, ...(await opportunityResults(db, t, now, tenant)) }; }
  if (action === 'create') { if (!manager) return { ok: false, error: 'Only managers can do this.' }; return createManual(db, t, tenant, actor, b, now); }

  const o = await getOpp(db, t, b.id); if (!o) return { ok: false, error: 'This task is no longer available.' };
  const ref = db.doc(`${T(t)}/opportunities/${o.id}`);
  const staff = await team(db, t); const by = { at: nowIso(now), by: actor.staffId, byName: actor.name };

  if (action === 'claim') { if (o.assigneeId) return { ok: false, error: 'This task has already been claimed.' }; if (o.status !== 'open') return { ok: false, error: 'This task is closed.' };
    const m = staff.find((x: any) => x.id === actor.staffId); await ref.update({ assigneeId: actor.staffId, assigneeName: actor.name, message: remsg(o, m?.name || actor.name, tenant) }); return { ok: true }; }
  if (action === 'assign') { if (!manager) return { ok: false, error: 'Only managers can assign tasks.' };
    const to = b.staffId ? staff.find((x: any) => x.id === String(b.staffId)) : null; if (b.staffId && (!to || to.role === 'renter' || to.isRenter)) return { ok: false, error: 'Please choose a team member.' };
    await ref.update({ assigneeId: to?.id || null, assigneeName: to?.name || null, message: remsg(o, to?.name || '', tenant), assignedBy: actor.name, assignedAt: nowIso(now) });
    if (to && to.id !== actor.staffId) { const r = db.collection(`${T(t)}/notifications`).doc(); await r.set({ id: r.id, userId: to.id, type: 'task', link: 'today', read: false, createdAt: nowIso(now), message: `${actor.name.split(' ')[0]} gave you a task: ${o.clientName ? `${o.clientName} — ` : ''}${(PLAYBOOKS[o.kind as OppKind] || PLAYBOOKS.manual).label}` }); }
    return { ok: true }; }
  if (!canTouch(o, actor)) return { ok: false, error: 'This task is assigned to another team member.' };
  if (action === 'escalate') { if (!manager) return { ok: false, error: 'Only managers can do this.' }; if (!['waiting', 'auto'].includes(o.status)) return { ok: false, error: 'This task is already assigned to a team member.' };
    const S = oppSettingsOf(tenant); const pb = PLAYBOOKS[o.kind as OppKind]; const all = rows(await db.collection(`${T(t)}/opportunities`).where('status', '==', 'open').get());
    const to = b.staffId ? staff.find((x: any) => x.id === String(b.staffId)) : assignee(pb.who, o.providerId, staff, openLoad(all), S.perPersonPerDay);
    await ref.update({ status: 'open', assigneeId: to?.id || null, assigneeName: to?.name || null, dueAt: nowIso(now), expiresAt: nowIso(now + 7 * DAY), escalatedAt: nowIso(now),
      why: `${o.why} · received the automatic text; assigned to a team member by ${actor.name.split(' ')[0]}`, message: fill(pb.afterAuto || PLAYBOOKS.follow_up.versions[0], { ...(o.facts || {}), business: businessName(tenant), me: first(to?.name) || first(businessName(tenant)) }) });
    return { ok: true }; }
  if (action === 'dismiss') { if (!manager) return { ok: false, error: 'Only managers can do this.' }; await ref.update({ status: 'dismissed', closedAt: nowIso(now), dismissedBy: actor.name }); return { ok: true }; }
  if (o.status !== 'open') return { ok: false, error: 'This task is already closed.' };
  if (['times', 'book', 'send_times', 'send_link', 'waitlist'].includes(action)) return actInTask(db, t, tenant, actor, o, ref, action, b, now, io);
  if (action === 'reword') { const pb = PLAYBOOKS[o.kind as OppKind]; if (!pb || pb.versions.length < 2) return { ok: false, error: 'There is only one wording available for this message.' };
    const v = ((Number(o.version) || 0) + 1) % pb.versions.length; const m = staff.find((x: any) => x.id === o.assigneeId);
    const message = fill(pb.versions[v], { ...(o.facts || {}), business: businessName(tenant), me: first(m?.name || actor.name) }); await ref.update({ version: v, message }); return { ok: true, message, version: v }; }
  if (action === 'text') {
    const client = o.clientId ? ((await db.doc(`${T(t)}/clients/${o.clientId}`).get()).data() || {}) : {};
    const chk = await textCheck(db, t, tenant, o, client, now); if (!chk.ok) return chk;
    const body = str(o.message, 600); if (!body) return { ok: false, error: 'There is no message for this task.' };
    const { sendTenantSms } = await import('@/lib/sms');
    const r = await sendTenantSms(db, t, chk.phone, body, client?.email ? { email: client.email, subject: businessName(tenant) } : undefined, { kind: 'opportunity', recipientType: 'client', recipientId: o.clientId || undefined, recipientName: o.clientName || undefined } as any);
    if (!r.ok) return { ok: false, error: 'The text could not be sent. Please try again, or call instead.' };
    { const { spendBudget } = await import('@/lib/text-budget'); await spendBudget(db, t, chk.phone, 'opportunity', now).catch(() => {}); }
    const pb = PLAYBOOKS[o.kind as OppKind];
    if (pb?.marketing && o.clientId) await db.collection(`${T(t)}/opportunityTexts`).add({ clientId: o.clientId, at: nowIso(now), channel: 'sms', marketing: true, oppId: o.id });
    await ref.update({ attempts: [...(o.attempts || []), { ...by, channel: r.via === 'email' ? 'email' : 'text', note: 'Sent the message' }].slice(-20), firstContactAt: o.firstContactAt || nowIso(now), lastContactAt: nowIso(now) });
    return { ok: true, via: r.via || 'sms' };
  }
  if (action === 'outcome') {
    const outcome = str(b.outcome, 30) as OutcomeId; if (!OUTCOMES[outcome]) return { ok: false, error: 'Please choose an outcome.' };
    const channel = ['call', 'text', 'in_person'].includes(b.channel) ? b.channel : 'call'; const note = str(b.note, 600);
    const fx = outcomeEffects(o, outcome, now);
    const attempt = { ...by, channel, outcome, note };
    const patch: any = { ...fx.patch, attempts: [...(o.attempts || []), attempt].slice(-20), firstContactAt: o.firstContactAt || nowIso(now), lastContactAt: nowIso(now) };
    if (fx.openCase && o.clientId) {
      try { const { openCase } = await import('@/lib/cases');
        const r: any = await openCase(db, t, actor, { clientId: o.clientId, clientName: o.clientName, words: note || 'Told us about a bad experience when we reached out.', via: channel === 'text' ? 'text' : 'call' });
        if (r?.ok && (r.id || r.caseId)) patch.caseId = r.id || r.caseId; } catch { /* the manager still sees the outcome */ }
    }
    if (fx.optOut && o.clientId) {
      await db.doc(`${T(t)}/clients/${o.clientId}`).set({ opportunityOptOut: true, marketingOptOut: true, smsMarketingOptIn: false, optedOutAt: nowIso(now), optedOutVia: 'opportunity' }, { merge: true });
      const others = rows(await db.collection(`${T(t)}/opportunities`).where('clientId', '==', o.clientId).get()).filter((e: any) => e.id !== o.id && ACTIVE.includes(e.status));
      for (const e of others) await db.doc(`${T(t)}/opportunities/${e.id}`).update({ status: 'done', outcome: 'stop', closedAt: nowIso(now) });
    }
    await ref.update(patch);
    let followUpId: string | null = null;
    if (fx.followUpAt) {
      const f = db.collection(`${T(t)}/opportunities`).doc(); followUpId = f.id; const pb = PLAYBOOKS.follow_up;
      await f.set({ id: f.id, kind: 'follow_up', key: `follow_up:${o.id}`, status: 'open', clientId: o.clientId || null, clientName: o.clientName || '', phone: o.phone || null,
        why: `${OUTCOMES[outcome].label} on ${new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${note ? ` — “${note.slice(0, 120)}”` : ''}`, valueCents: o.valueCents || 0, priority: outcome === 'interested' ? 'high' : 'medium',
        dueAt: fx.followUpAt, expiresAt: nowIso(ms(fx.followUpAt) + pb.expiresDays * DAY), refs: { ...(o.refs || {}), fromId: o.id }, facts: o.facts || {}, providerId: o.providerId || null,
        assigneeId: o.assigneeId || actor.staffId, assigneeName: o.assigneeName || actor.name, version: 0, message: fill(pb.versions[0], { ...(o.facts || {}), me: first(o.assigneeName || actor.name), business: businessName(tenant) }),
        tries: 0, attempts: [], createdAt: nowIso(now), createdBy: actor.staffId, followUpOf: o.id, result: { status: 'none' } });
    }
    return { ok: true, closed: patch.status === 'done', followUpId, caseId: patch.caseId || null };
  }
  return { ok: false, error: 'Unknown action.' };
}

function remsg(o: any, name: string, tenant: any) {
  const pb = PLAYBOOKS[o.kind as OppKind]; if (!pb || !pb.versions[Number(o.version) || 0]) return o.message || '';
  return fill(pb.versions[Number(o.version) || 0], { ...(o.facts || {}), business: businessName(tenant), me: first(name) || first(businessName(tenant)) });
}

async function createManual(db: any, t: string, tenant: any, actor: RequestActor, b: any, now: number) {
  const title = str(b.title, 140); if (!title) return { ok: false, error: 'Please enter a task title.' };
  const staff = await team(db, t); const to = b.staffId ? staff.find((x: any) => x.id === String(b.staffId)) : null;
  let client: any = null; if (b.clientId) { const s = await db.doc(`${T(t)}/clients/${str(b.clientId, 80)}`).get(); if (s.exists) client = { id: s.id, ...(s.data() || {}) }; }
  const due = ms(b.dueAt) || now; const ref = db.collection(`${T(t)}/opportunities`).doc();
  const doc = { id: ref.id, kind: 'manual', key: `manual:${ref.id}`, status: 'open', title, clientId: client?.id || null, clientName: client ? String(client.name || [client.firstName, client.lastName].filter(Boolean).join(' ')) : '',
    phone: client?.phone || client?.phoneNumber || null, why: str(b.why, 400) || title, valueCents: Math.max(0, Math.round(Number(b.valueCents) || 0)), priority: ['high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium',
    dueAt: nowIso(due), expiresAt: nowIso(due + 14 * DAY), refs: {}, facts: { first: String(client?.firstName || String(client?.name || '').split(' ')[0] || '') }, providerId: null,
    assigneeId: to?.id || null, assigneeName: to?.name || null, version: 0, message: str(b.message, 600), tries: 0, attempts: [], createdAt: nowIso(now), createdBy: actor.staffId, createdByName: actor.name, result: { status: 'none' } };
  await ref.set(doc);
  if (to && to.id !== actor.staffId) { const r = db.collection(`${T(t)}/notifications`).doc(); await r.set({ id: r.id, userId: to.id, type: 'task', link: 'today', read: false, createdAt: nowIso(now), message: `${actor.name.split(' ')[0]} gave you a task: ${title}`.slice(0, 240) }); }
  return { ok: true, id: ref.id };
}

// ── Results: the ledger (step 3) ─────────────────────────────────────────────────────────────
// tenants/{t}/results/appt_{appointmentId} — one record per visit, so a visit can only ever be credited once. Rebuilt
// from the records each day (and when a manager opens Results): who reached out, the visit, what it really paid, and
// refunds. Server-only, like the tasks.
export async function resultsPass(db: any, t: string, tenant: any, now = Date.now()) {
  const S = oppSettingsOf(tenant); const since = nowIso(now - 120 * DAY);
  const opps = rows(await db.collection(`${T(t)}/opportunities`).where('createdAt', '>=', since).get());
  const byClient = new Map<string, any[]>(); for (const o of opps) if (o.clientId && (o.firstContactAt || o.status === 'done')) (byClient.get(String(o.clientId)) || byClient.set(String(o.clientId), []).get(String(o.clientId))!).push(o);
  if (!byClient.size) return { ok: true, credited: 0 };
  const safe = (p: Promise<any>) => p.catch(() => ({ docs: [] }));
  const out: Array<{ a: any; c: any }> = [];
  for (const [cid, list] of byClient) {
    const earliest = Math.min(...list.map((o: any) => ms(o.firstContactAt) || ms(o.createdAt)));
    const [as, cs, ns] = await Promise.all([safe(db.collection(`${T(t)}/appointments`).where('clientId', '==', cid).get()), safe(db.collection(`${T(t)}/campaignSends`).where('clientId', '==', cid).get()), safe(db.collection(`${T(t)}/reconnectNudges`).where('clientId', '==', cid).get())]);
    const others = [...rows(cs).map((x: any) => ms(x.at)), ...rows(ns).map((x: any) => ms(x.sentAt))].filter(Boolean);
    for (const a of rows(as)) {
      if (a.isRenterBooking || (ms(a.createdAt) || ms(a.startTime)) < earliest - 3600e3) continue;
      const c = creditFor(a, list, others, S); if (c) out.push({ a, c });
    }
  }
  // Refunds against those visits
  const refunded = new Map<string, number>(); const ids = out.map((x) => String(x.a.id));
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await safe(db.collection(`${T(t)}/transactions`).where('appointmentId', 'in', ids.slice(i, i + 30)).get());
    for (const x of rows(snap)) if (x.taxBucket === 'refund' || x.type === 'refund' || /refund/i.test(String(x.category || ''))) refunded.set(String(x.appointmentId), (refunded.get(String(x.appointmentId)) || 0) + Math.round(Math.abs(Number(x.amountCents) || Number(x.amount) * 100 || 0)));
  }
  const staff = await team(db, t); const nameOf = (id: string | null) => (id ? staff.find((m: any) => m.id === id)?.name || null : null);
  const keep = new Set<string>(); const writes: Array<[any, any]> = []; const oppResult = new Map<string, any>();
  for (const { a, c } of out) {
    const st = resultState(a, refunded.get(String(a.id)) || 0); const id = `appt_${a.id}`; keep.add(id);
    writes.push([db.doc(`${T(t)}/results/${id}`), { id, appointmentId: String(a.id), clientId: String(a.clientId), clientName: a.clientName || null, serviceName: a.serviceName || null, startTime: a.startTime || null,
      oppId: c.oppId, oppKind: c.kind, tool: c.tool, type: c.type, staffId: c.staffId, staffName: nameOf(c.staffId), ...st, refundedCents: refunded.get(String(a.id)) || 0, updatedAt: nowIso(now) }]);
    const prev = oppResult.get(c.oppId); if (!prev || (st.state === 'paid' && prev.status !== 'paid')) oppResult.set(c.oppId, { status: st.state === 'paid' ? 'paid' : st.state === 'booked' ? 'booked' : 'none', appointmentId: String(a.id), paidCents: st.paidCents, credit: c.type, checkedAt: nowIso(now) });
  }
  // A visit that's no longer credited (cancelled tag, moved credit) comes out of the ledger.
  const existing = rows(await safe(db.collection(`${T(t)}/results`).where('updatedAt', '>=', nowIso(now - 400 * DAY)).get()));
  for (const r of existing) if (!keep.has(r.id) && ms(r.startTime) >= now - 120 * DAY) writes.push([db.doc(`${T(t)}/results/${r.id}`), null]);
  for (const [oid, r] of oppResult) writes.push([db.doc(`${T(t)}/opportunities/${oid}`), { __merge: true, result: r }]);
  for (let i = 0; i < writes.length; i += 400) { const b = db.batch(); for (const [r, v] of writes.slice(i, i + 400)) { if (v === null) b.delete(r); else if (v.__merge) { const { __merge, ...rest } = v; b.set(r, rest, { merge: true }); } else b.set(r, v); } await b.commit(); }
  return { ok: true, credited: out.length };
}

/** Results for a month (default this one): paid money by kind of credit and by tool, booked-not-paid, open estimates,
 * by person, the left-alone comparison, and what's holding results back. */
export async function opportunityResults(db: any, t: string, now = Date.now(), tenant?: any) {
  const zone = await tz(tenant || {}); const { dayKey } = await import('@/lib/tenant-time'); const month = dayKey(new Date(now), zone).slice(0, 7);
  const ledger = rows(await db.collection(`${T(t)}/results`).where('updatedAt', '>=', nowIso(now - 120 * DAY)).get().catch(() => ({ docs: [] })))
    .filter((r: any) => String(r.startTime || '').slice(0, 7) === month || (r.state === 'booked'));
  const paid = ledger.filter((r: any) => r.state === 'paid' && String(r.startTime || '').slice(0, 7) === month);
  const sum = (l: any[], f = 'paidCents') => l.reduce((s: number, r: any) => s + (Number(r[f]) || 0), 0);
  const byType = { generated: sum(paid.filter((r: any) => r.type === 'generated')), recovered: sum(paid.filter((r: any) => r.type === 'recovered')), influenced: sum(paid.filter((r: any) => r.type === 'influenced')) };
  const booked = ledger.filter((r: any) => r.state === 'booked');
  const list = rows(await db.collection(`${T(t)}/opportunities`).where('createdAt', '>=', nowIso(now - 30 * DAY)).get());
  const real = list.filter((o: any) => !['holdout', 'not_sent'].includes(o.status)); const openL = real.filter((o: any) => o.status === 'open');
  const tools = [...new Set([...paid.map((r: any) => r.tool), ...openL.map((o: any) => o.tool || TOOL_OF[o.kind as OppKind])])].filter(Boolean);
  const byTool = tools.map((tool: string) => { const p = paid.filter((r: any) => r.tool === tool);
    return { tool, generated: sum(p.filter((r: any) => r.type === 'generated')), recovered: sum(p.filter((r: any) => r.type === 'recovered')), influenced: sum(p.filter((r: any) => r.type === 'influenced')),
      possible: openL.filter((o: any) => (o.tool || TOOL_OF[o.kind as OppKind]) === tool).reduce((s: number, o: any) => s + (Number(o.valueCents) || 0), 0) }; });
  const people = new Map<string, { staffId: string; name: string; paidCents: number; visits: number }>();
  for (const r of paid) { if (!r.staffId) continue; const p = people.get(r.staffId) || { staffId: r.staffId, name: r.staffName || 'Team member', paidCents: 0, visits: 0 }; p.paidCents += Number(r.paidCents) || 0; p.visits++; people.set(r.staffId, p); }
  const kinds = [...FINDER_KINDS, 'follow_up', 'manual'] as OppKind[];
  const byKind = kinds.map((k) => { const l = real.filter((o: any) => o.kind === k);
    return { kind: k, label: PLAYBOOKS[k].label, total: l.length, reached: l.filter((o: any) => o.firstContactAt).length, booked: l.filter((o: any) => ['booked', 'quote_accepted'].includes(o.outcome) || ['booked', 'paid'].includes(o.result?.status)).length,
      paidCents: sum(paid.filter((r: any) => r.oppKind === k)), optOuts: l.filter((o: any) => o.outcome === 'stop').length }; }).filter((r) => r.total || r.paidCents);
  const contacted = real.filter((o: any) => PLAYBOOKS[o.kind as OppKind]?.winBack && o.firstContactAt);
  const held = list.filter((o: any) => o.status === 'holdout');
  const rate = (l: any[]) => (l.length ? Math.round((l.filter((o: any) => ['booked', 'paid'].includes(o.result?.status)).length / l.length) * 100) : null);
  // What's holding it back: clients who can't be sent win-back texts, and tasks that ran out of time.
  let cantText = 0; try { const cl = rows(await db.collection(`${T(t)}/clients`).get()); cantText = cl.filter((c: any) => !c.archived && (c.phone || c.phoneNumber) && c.smsMarketingOptIn !== true && !c.marketingOptOut && !c.smsOptOut).length; } catch { /* unknown */ }
  const expired = list.filter((o: any) => o.status === 'expired');
  const paidCents = byType.generated + byType.recovered + byType.influenced;
  return {
    month, paidCents, paidLabel: dollars(paidCents), byType, bookedWaiting: booked.length, bookedCents: sum(booked, 'bookedCents'),
    stillPossibleCents: openL.reduce((s: number, o: any) => s + (Number(o.valueCents) || 0), 0), open: openL.length, done: real.filter((o: any) => o.status === 'done').length,
    refundedCents: sum(ledger.filter((r: any) => String(r.startTime || '').slice(0, 7) === month), 'refundedCents'),
    complaints: real.filter((o: any) => o.outcome === 'bad_experience').length, optOuts: real.filter((o: any) => o.outcome === 'stop').length,
    byKind, byTool, byPerson: [...people.values()].sort((a, b) => b.paidCents - a.paidCents),
    compare: { contacted: contacted.length, contactedRate: rate(contacted), heldOut: held.length, heldOutRate: rate(held) },
    autoSent: real.filter((o: any) => o.autoSentAt).length, autoBooked: real.filter((o: any) => o.autoSentAt && !o.escalatedAt && !o.repliedAt && (o.outcome === 'booked' || ['booked', 'paid'].includes(o.result?.status))).length,
    toPerson: real.filter((o: any) => o.escalatedAt || o.repliedAt).length, notSent: list.filter((o: any) => o.status === 'not_sent').length,
    holdingBack: { cantText, expired: expired.length },
  };
}


// ── Acting inside the task (step 2) ────────────────────────────────────────────────────────────
// Everything goes through what already owns it: open times and booking through the rebooking helpers the client
// screen and visit link use (same rules, deposits and double-booking guard); prices from the menu; texts through
// the same checks as every other text. The task never builds its own version of booking.
async function rebookCtxFor(db: any, t: string, o: any) {
  if (!o.clientId) return null;
  const appts = rows(await db.collection(`${T(t)}/appointments`).where('clientId', '==', o.clientId).get());
  const last = appts.filter((a: any) => ['completed', 'checked_out', 'paid', 'cancelled', 'canceled', 'no_show'].includes(String(a.status || '')) && a.serviceId && !a.isRenterBooking)
    .sort((x: any, y: any) => ms(y.startTime) - ms(x.startTime))[0];
  if (!last) return null;
  return { tenantId: t, clientId: String(o.clientId), serviceId: String(last.serviceId), staffId: o.providerId || last.staffId || null, addOnIds: Array.isArray(last.addOnIds) ? last.addOnIds : [], appointmentId: String(last.id) };
}
const timeWords = (s: any) => `${String(s.dayLabel || '').replace(/,/g, '')} at ${s.label}`;
async function actInTask(db: any, t: string, tenant: any, actor: RequestActor, o: any, ref: any, action: string, b: any, now: number, io?: TaskIO) {
  const ctx = await rebookCtxFor(db, t, o);
  if (!ctx) return { ok: false, error: 'There is no past visit to work from. Please book in the planner.' };
  const { rebookStart, rebookBook, rebookWaitlist } = await import('@/lib/rebook-actions');
  const r: any = await rebookStart(db, ctx, 'task'); if (!r.ok) return r;
  const plan = r.rebook; const by = { at: nowIso(now), by: actor.staffId, byName: actor.name };
  if (plan.stage === 'already') {
    if (action === 'times') return { ok: true, plan };
    return { ok: false, error: `They already have a visit booked: ${plan.label}.` };
  }
  const svc = (await db.doc(`${T(t)}/services/${plan.serviceId}`).get()).data() || {};
  const price = Number(svc.price) > 0 ? { name: plan.serviceName || svc.name || 'Service', dollars: Number(svc.price), from: svc.priceType === 'from' || svc.priceFrom === true } : null;
  if (action === 'times') return { ok: true, plan, price };
  const client = (await db.doc(`${T(t)}/clients/${o.clientId}`).get()).data() || {};
  const sendText = async (body: string, note: string, extra: any = {}) => {
    const chk = await textCheck(db, t, tenant, o, client, now, { answering: !!o.repliedAt }); if (!chk.ok) return chk;
    const { sendTenantSms } = await import('@/lib/sms');
    const s2 = await sendTenantSms(db, t, chk.phone, body, client?.email ? { email: client.email, subject: businessName(tenant) } : undefined, { kind: 'opportunity', recipientType: 'client', recipientId: o.clientId || undefined, recipientName: o.clientName || undefined } as any);
    if (!s2.ok) return { ok: false, error: 'The text could not be sent. Please try again, or call instead.' };
    { const { spendBudget } = await import('@/lib/text-budget'); await spendBudget(db, t, chk.phone, 'opportunity', now).catch(() => {}); }
    await ref.update({ attempts: [...(o.attempts || []), { ...by, channel: s2.via === 'email' ? 'email' : 'text', note }].slice(-20), firstContactAt: o.firstContactAt || nowIso(now), lastContactAt: nowIso(now), ...extra });
    return { ok: true, via: s2.via || 'sms' };
  };
  const firstName = String(o.facts?.first || client.firstName || String(client.name || o.clientName || '').split(' ')[0] || 'there');
  const me = first(actor.name) || businessName(tenant);
  if (action === 'send_times') {
    const want: string[] = (Array.isArray(b.startIsos) ? b.startIsos : []).map(String).slice(0, 2);
    const picks = (plan.suggestions || []).filter((x: any) => want.includes(x.startIso)); if (!picks.length) return { ok: false, error: 'Those times are no longer open. Please find times again.' };
    const who = plan.staffName ? ` with ${plan.staffName}` : '';
    const list = picks.length === 2 ? `${timeWords(picks[0])} or ${timeWords(picks[1])}` : timeWords(picks[0]);
    const body = `Hi ${firstName}, this is ${me}. I have ${list}${who} for your ${String(plan.serviceName || 'next visit').toLowerCase()}. ${picks.length === 2 ? 'Which would suit you better?' : 'Would that suit you?'} Just reply here.`;
    return sendText(body, `Sent ${picks.length === 2 ? 'two times' : 'a time'}: ${list}`, { offeredTimes: picks.map((x: any) => ({ startIso: x.startIso, staffId: x.staffId, label: timeWords(x) })) });
  }
  if (action === 'send_link') {
    const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, io?.origin || ''); if (!base) return { ok: false, error: 'There is no booking link to send yet. Please set the app’s web address first.' };
    const q = new URLSearchParams({ service: plan.serviceId, ...(plan.staffId ? { provider: plan.staffId } : {}), opp: o.id });
    const link = `${base}/book/${encodeURIComponent(t)}?${q.toString()}`;
    const body = `Hi ${firstName}, this is ${me}. Here is a link to choose a time that suits you for your ${String(plan.serviceName || 'next visit').toLowerCase()}: ${link}`;
    return sendText(body, 'Sent a booking link', { linkSentAt: nowIso(now) });
  }
  if (!io) return { ok: false, error: 'Booking isn’t available here.' };
  if (action === 'waitlist') {
    const w: any = await rebookWaitlist(db, ctx, plan, String(b.note || '').slice(0, 120), io.post); if (!w?.ok) return { ok: false, error: w?.error || 'They could not be added to the waitlist.' };
    await ref.update({ status: 'done', outcome: 'waitlist', closedAt: nowIso(now), attempts: [...(o.attempts || []), { ...by, channel: 'call', outcome: 'waitlist', note: 'Added to the waitlist' }].slice(-20), lastContactAt: nowIso(now) });
    return { ok: true, closed: true };
  }
  if (action === 'book') {
    const dep = Number(plan.depositCents) || 0;
    const allowed = dep === 0 ? ['none'] : [plan.choices?.cardHold && 'card_hold', plan.choices?.cardCharge && 'card_charge', 'later'].filter(Boolean) as string[];
    const deposit = allowed.includes(String(b.deposit)) ? String(b.deposit) : allowed[0];
    const startIso = String(b.startIso || ''); const staffId = b.staffId ? String(b.staffId) : plan.staffId;
    const bk: any = await rebookBook(db, ctx, { ...plan, choices: { ...plan.choices, later: true } }, { startIso, staffId, deposit }, io.internal, io.origin);
    if (!bk?.ok) return { ok: false, error: bk?.error || 'That time was just taken. Please choose another.' };
    const appointmentId = String(bk.rebook?.appointmentId || bk.appointmentId || '');
    if (appointmentId) await db.doc(`${T(t)}/appointments/${appointmentId}`).set({ opportunityId: o.id, opportunityKind: o.kind }, { merge: true }).catch(() => {});
    const zone = await tz(tenant); const label = new Date(startIso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone });
    await ref.update({ status: 'done', outcome: 'booked', closedAt: nowIso(now), refs: { ...(o.refs || {}), appointmentId }, result: { status: 'booked', appointmentId, checkedAt: nowIso(now) },
      attempts: [...(o.attempts || []), { ...by, channel: b.channel === 'text' ? 'text' : b.channel === 'in_person' ? 'in_person' : 'call', outcome: 'booked', note: `Booked ${label}` }].slice(-20),
      firstContactAt: o.firstContactAt || nowIso(now), lastContactAt: nowIso(now) });
    return { ok: true, closed: true, appointmentId, label, depositNote: bk.rebook?.depositNote || null };
  }
  return { ok: false, error: 'Unknown action.' };
}
