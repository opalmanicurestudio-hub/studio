// src/lib/opportunities-server.ts — OPPORTUNITIES, the server half of lib/opportunities. The daily sweep finds what
// qualifies, hands each one to the right person (never over their limit), and later checks whether the client came
// back. The task screens act through here: an answer (outcome), a text sent in the business's name with every consent
// and limit checked, a different wording, handing it to someone else. Tasks live in tenants/{t}/opportunities —
// server only (firestore.rules), so nobody can make or close one except through these checks.
import { PLAYBOOKS, OUTCOMES, FINDER_KINDS, oppSettingsOf, findCandidates, filterCandidates, isHoldout, assignee, pickVersion, fill, outcomeEffects, cameBack, ms, dollars, type OppKind, type OutcomeId } from '@/lib/opportunities';
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
const ACTIVE = ['open', 'holdout', 'waiting', 'auto'];
async function bookLink(tenant: any, t: string, c: { providerId?: string | null }) {
  const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, ''); if (!base) return '';
  return `${base}/book/${encodeURIComponent(t)}${c.providerId ? `?provider=${encodeURIComponent(c.providerId)}` : ''}`;
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
  for (const c of cand) {
    const pb = PLAYBOOKS[c.kind]; const mode = S.modes[c.kind] || 'person'; if (mode === 'off') continue;
    const hold = pb.winBack && isHoldout(c.key, month, S.holdoutPct);
    const cl = c.clientId ? clients.get(c.clientId) : null; const prov = staff.find((m: any) => m.id === c.providerId);
    const facts: any = { ...c.facts, business: businessName(tenant) };
    const ref = db.collection(`${T(t)}/opportunities`).doc();
    const base: any = { id: ref.id, kind: c.kind, key: c.key, clientId: c.clientId, clientName: c.clientName, phone: cl?.phone || cl?.phoneNumber || c.facts.phone || null,
      why: c.why, valueCents: c.valueCents, valueNote: c.valueNote || null, priority: pb.priority, dueAt: c.dueAt, expiresAt: c.expiresAt, refs: c.refs, facts,
      providerId: c.providerId, providerName: prov?.name || null, mode, tries: 0, attempts: [], createdAt: nowIso(now), createdBy: 'rules', result: { status: 'none' } };
    if (hold) { writes.push([ref, { ...base, status: 'holdout', assigneeId: null, assigneeName: null, version: 0, message: '' }, 'set']); fresh.push({ status: 'holdout' }); continue; }
    let why = c.why;
    // 1) Automatic first, where the business chose it.
    if ((mode === 'auto' || mode === 'auto_then_person') && pb.auto?.length) {
      const usedA = x.opps.filter((e: any) => e.clientId && e.clientId === c.clientId && e.kind === c.kind && Number.isInteger(e.autoVersion)).map((e: any) => e.autoVersion);
      const av = pickFrom(pb.auto.length, usedA); const link = await bookLink(tenant, t, { providerId: c.providerId });
      const body = fill(pb.auto[av], { ...facts, link, me: first(prov?.name) || businessName(tenant) });
      const chk0 = await textCheck(db, t, tenant, { ...base, kind: c.kind }, cl || { phone: base.phone }, now);
      const chk: any = !link && pb.auto[av].includes('{link}') ? { ok: false, error: 'There is no booking link to send yet. Please set the app’s web address first.' } : chk0;
      let r: any = chk.ok ? await send(db, t, chk.phone, body, cl?.email ? { email: cl.email, subject: businessName(tenant) } : undefined, { kind: 'opportunity', recipientType: 'client', recipientId: c.clientId || undefined, recipientName: c.clientName }).catch(() => ({ ok: false })) : { ok: false, error: (chk as any).error };
      if (r.ok) {
        sent++; { const { spendBudget } = await import('@/lib/text-budget'); await spendBudget(db, t, chk.phone, 'opportunity', now).catch(() => {}); }
        if (pb.marketing && c.clientId) writes.push([db.collection(`${T(t)}/opportunityTexts`).doc(), { clientId: c.clientId, at: nowIso(now), channel: 'sms', marketing: true, oppId: ref.id }, 'set']);
        const auto = { at: nowIso(now), by: 'auto', byName: 'Sent automatically', channel: r.via === 'email' ? 'email' : 'text', note: body };
        writes.push([ref, { ...base, status: mode === 'auto' ? 'auto' : 'waiting', autoVersion: av, autoMessage: body, autoSentAt: nowIso(now), firstContactAt: nowIso(now), lastContactAt: nowIso(now),
          escalateAt: mode === 'auto_then_person' ? nowIso(now + S.afterDays * DAY) : null, attempts: [auto], assigneeId: null, assigneeName: null, version: 0, message: '' }, 'set']);
        fresh.push({ status: 'auto' }); continue;
      }
      if (mode === 'auto') { writes.push([ref, { ...base, status: 'not_sent', notSentWhy: String(r.error || 'The text could not be sent.'), closedAt: nowIso(now), assigneeId: null, assigneeName: null, version: 0, message: '' }, 'set']); continue; }
      why = `${c.why} · could not be texted automatically: ${String(r.error || 'the text could not be sent').replace(/\.$/, '').replace(/^./, (z: string) => z.toLowerCase())}`;
    }
    // 2) A person.
    const who = assignee(pb.who, c.providerId, staff, load, S.perPersonPerDay); if (who) load.set(who.id, (load.get(who.id) || 0) + 1);
    const used = x.opps.filter((e: any) => e.clientId && e.clientId === c.clientId && e.kind === c.kind && Number.isInteger(e.version)).map((e: any) => e.version);
    const version = pickVersion(c.kind, used);
    const doc = { ...base, why, status: 'open', assigneeId: who?.id || null, assigneeName: who?.name || null, version,
      message: pb.versions[version] ? fill(pb.versions[version], { ...facts, me: first(who?.name) || first(businessName(tenant)) }) : '' };
    writes.push([ref, doc, 'set']); fresh.push(doc);
  }
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
  return { ok: true as const, items: shown, people, settings: oppSettingsOf(tenant), manager };
}
const rank = (o: any) => ({ high: 0, medium: 1, low: 2 } as any)[o.priority] ?? 1;

// ── Acting ───────────────────────────────────────────────────────────────────────────
async function getOpp(db: any, t: string, id: string) { const s = await db.doc(`${T(t)}/opportunities/${str(id, 80)}`).get(); return s.exists ? { id: s.id, ...(s.data() || {}) } as any : null; }
const canTouch = (o: any, a: RequestActor) => a.isManager || a.isOwner || (o.assigneeId && o.assigneeId === a.staffId);

export async function textCheck(db: any, t: string, tenant: any, o: any, client: any, now: number): Promise<{ ok: true; phone: string } | { ok: false; error: string }> {
  const pb = PLAYBOOKS[o.kind as OppKind] || PLAYBOOKS.manual;
  const phone = String(client?.phone || client?.phoneNumber || o.phone || '').trim();
  if (!phone) return { ok: false, error: 'There is no mobile number on file. Please call or email this client instead.' };
  if (client?.smsOptOut || client?.smsConsent === false) return { ok: false, error: 'This client has opted out of texts. Please call instead.' };
  if (client?.opportunityOptOut) return { ok: false, error: 'This client has asked not to be contacted in this way.' };
  if (pb.marketing) {
    if (client?.marketingOptOut || client?.smsMarketingOptIn !== true) return { ok: false, error: 'This client has not agreed to marketing texts, so please call instead.' };
    const { recentMarketingTexts, MARKETING_TEXTS_PER_30_DAYS } = await import('@/lib/campaigns');
    const n = (await recentMarketingTexts(db, t, now)).get(String(o.clientId || '')) || 0;
    if (n >= MARKETING_TEXTS_PER_30_DAYS) return { ok: false, error: `This client has received ${n} texts from you in the last 30 days. Please call, or leave this for now.` };
  }
  const { inTextWindow } = await import('@/lib/campaigns');
  if (!inTextWindow(await tz(tenant), new Date(now))) return { ok: false, error: 'It is outside texting hours (9:00 AM to 8:00 PM). Please send it tomorrow, or call instead.' };
  if ((o.attempts || []).some((x: any) => x.channel === 'text' && now - ms(x.at) < 2 * DAY)) return { ok: false, error: 'A text was sent in the last two days. Please give the client time to reply.' };
  { const { budgetLeft } = await import('@/lib/text-budget'); if ((await budgetLeft(db, t, phone, 'opportunity', now)) <= 0) return { ok: false, error: 'This client has already received texts from us today. Please try again tomorrow, or call instead.' }; }
  return { ok: true, phone };
}

export async function actOnOpportunity(db: any, t: string, actor: RequestActor, b: any, now = Date.now()) {
  const action = str(b.action, 20); const manager = actor.isManager || actor.isOwner;
  const tenant: any = (await db.doc(T(t)).get()).data() || {};
  if (action === 'settings') { if (!manager) return { ok: false, error: 'Only managers can do this.' };
    const s = oppSettingsOf({ opportunities: b.settings || {} }); await db.doc(T(t)).set({ opportunities: s }, { merge: true }); return { ok: true, settings: s }; }
  if (action === 'run') { if (!manager) return { ok: false, error: 'Only managers can do this.' }; return opportunitySweep(db, t, tenant, now, { force: true }); }
  if (action === 'results') { if (!manager) return { ok: false, error: 'Only managers can do this.' }; return { ok: true, ...(await opportunityResults(db, t, now)) }; }
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

/** Results, last 30 days: what came back (paid, kept apart from estimates), by finder, and the left-alone comparison. */
export async function opportunityResults(db: any, t: string, now = Date.now()) {
  const list = rows(await db.collection(`${T(t)}/opportunities`).where('createdAt', '>=', nowIso(now - 30 * DAY)).get());
  const kinds = [...FINDER_KINDS, 'follow_up', 'manual'] as OppKind[];
  const real = list.filter((o: any) => !['holdout', 'not_sent'].includes(o.status));
  const byKind = kinds.map((k) => { const l = real.filter((o: any) => o.kind === k);
    return { kind: k, label: PLAYBOOKS[k].label, total: l.length, reached: l.filter((o: any) => o.firstContactAt).length, booked: l.filter((o: any) => ['booked', 'quote_accepted'].includes(o.outcome) || ['booked', 'paid'].includes(o.result?.status)).length,
      paidCents: l.reduce((s: number, o: any) => s + (o.result?.status === 'paid' ? Number(o.result.paidCents) || 0 : 0), 0), optOuts: l.filter((o: any) => o.outcome === 'stop').length }; }).filter((r) => r.total);
  const contacted = real.filter((o: any) => PLAYBOOKS[o.kind as OppKind]?.winBack && o.firstContactAt);
  const held = list.filter((o: any) => o.status === 'holdout');
  const rate = (l: any[]) => (l.length ? Math.round((l.filter((o: any) => ['booked', 'paid'].includes(o.result?.status)).length / l.length) * 100) : null);
  return {
    paidCents: real.reduce((s: number, o: any) => s + (o.result?.status === 'paid' ? Number(o.result.paidCents) || 0 : 0), 0),
    bookedWaiting: real.filter((o: any) => o.result?.status === 'booked').length,
    stillPossibleCents: real.filter((o: any) => o.status === 'open').reduce((s: number, o: any) => s + (Number(o.valueCents) || 0), 0),
    open: real.filter((o: any) => o.status === 'open').length, done: real.filter((o: any) => o.status === 'done').length,
    complaints: real.filter((o: any) => o.outcome === 'bad_experience').length, optOuts: real.filter((o: any) => o.outcome === 'stop').length,
    byKind, compare: { contacted: contacted.length, contactedRate: rate(contacted), heldOut: held.length, heldOutRate: rate(held) },
    autoSent: real.filter((o: any) => o.autoSentAt).length, autoBooked: real.filter((o: any) => o.autoSentAt && !o.escalatedAt && !o.repliedAt && (o.outcome === 'booked' || ['booked', 'paid'].includes(o.result?.status))).length,
    toPerson: real.filter((o: any) => o.escalatedAt || o.repliedAt).length, notSent: list.filter((o: any) => o.status === 'not_sent').length,
    paidLabel: dollars(real.reduce((s: number, o: any) => s + (o.result?.status === 'paid' ? Number(o.result.paidCents) || 0 : 0), 0)),
  };
}
