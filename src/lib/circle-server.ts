// src/lib/circle-server.ts — THE CIRCLE, the server half (lib/circle has the rules; design canvas RF16–RF20).
//   saveCircle            → the business's program (name, tiers, season, what the public page shows, boosts) and a
//                           welcome discount for each friend offer amount (approved by the manager who saves it)
//   codeFor / clientOfCode → each member's typed code ("HANNAH15"; a creator's own, like MAYA20)
//   memberState / afterReward → a client's tier from friends who had a paid first visit (12 months); tiers only move up
//                           until they've been quiet for a while; moving up sends one short text
//   memberView            → the member's card, progress, boost, the Circle (opt-in, first names), their share kit
//   circlePublic / circleJoin / creatorPage → the public Circle page, asking to join, a creator's page
//   circleOverview / circleAction → the business's Circle tab: requests, members, creators, boosts, cash owed
// Client records keep it in client.circle { tier, tierAt, since, optIn, code, creator }. Requests to join live in
// tenants/{t}/private/circleRequests; typed codes in tenants/{t}/private/referralTypedCodes (both server-only).
import { referralSettingsOf, firstOf, last10, dollars, type ReferralSettings } from '@/lib/referrals';
import { circleOf, tierFor, tierById, higher, nextTier, activeBoost, normalizeCode, typedCodeFor, welcomeIdFor, welcomeCodeFor, creatorOf, friendOfferFor, programName, TIER_IDS, type CircleSettings, type TierId } from '@/lib/circle';

const T = (t: string) => `tenants/${t}`;
const DAY = 864e5;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const iso = (n: number) => new Date(n).toISOString();
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const biz = (t: any) => String(t?.name || t?.businessName || 'us');
const short = (n: any) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Client'; };
const KEEP_DAYS = 120;   // a tier is kept at least this long after it's reached, so nobody drops mid-season
async function tenantOf(db: any, t: string) { return ((await db.doc(T(t)).get()).data() as any) || {}; }

// ── Settings ─────────────────────────────────────────────────────────────────────────
export async function ensureWelcome(db: any, t: string, S: ReferralSettings, cents: number, approver: { id?: string; name: string }, now = Date.now(), label?: string) {
  if (!(cents > 0)) return null;
  const id = welcomeIdFor(cents, S.friendCents), code = welcomeCodeFor(cents, S.friendCents);
  const ref = db.doc(`${T(t)}/discounts/${id}`); const cur: any = (await ref.get()).data() || null;
  await ref.set({ id, code, name: label || `Welcome offer (referral, ${dollars(cents)})`, description: 'A friend’s first visit, from the referral program.', type: 'fixed', value: cents / 100,
    isActive: S.on, limitOnePerCustomer: true, source: 'referrals', approvedBy: approver.name, approvedById: approver.id || null, approvedAt: iso(now), ...(cur ? {} : { createdAt: iso(now), usageCount: 0, usedByClientIds: [] }) }, { merge: true });
  return { id, code };
}
export async function saveCircle(db: any, t: string, raw: any, approver: { id?: string; name: string }, now = Date.now()) {
  const C = circleOf({ referrals: { circle: raw } });
  await db.doc(T(t)).set({ referrals: { circle: C } }, { merge: true });
  const S = referralSettingsOf(await tenantOf(db, t));
  if (C.on) for (const tier of C.tiers) await ensureWelcome(db, t, S, tier.friendCents, approver, now);
  return { ok: true, circle: C };
}

// ── Typed codes ──────────────────────────────────────────────────────────────────────
const codesDoc = (t: string) => `${T(t)}/private/referralTypedCodes`;
export async function clientOfCode(db: any, t: string, code: any): Promise<any | null> {
  const k = normalizeCode(code); if (k.length < 3) return null;
  const id = (((await db.doc(codesDoc(t)).get()).data() || {}) as any)[k]; if (!id) return null;
  const c = await db.doc(`${T(t)}/clients/${id}`).get(); return c.exists ? { id: c.id, ...(c.data() || {}) } : null;
}
export async function codeFor(db: any, t: string, clientId: string, S: ReferralSettings, C: CircleSettings): Promise<string> {
  const cRef = db.doc(`${T(t)}/clients/${clientId}`); const c: any = (await cRef.get()).data() || {};
  const creator = creatorOf(c.circle?.creator); if (creator) return creator.code;
  if (c.circle?.code) return String(c.circle.code);
  const map: any = ((await db.doc(codesDoc(t)).get()).data()) || {};
  const tier = (c.circle?.tier || null) as TierId | null;
  const code = typedCodeFor(c.name || c.firstName, friendOfferFor(S, C, tier), (x) => !!map[x]);
  await db.doc(codesDoc(t)).set({ [code]: clientId }, { merge: true }); await cRef.set({ circle: { code } }, { merge: true });
  return code;
}
/** Set a creator's own code (MAYA20). Refused if another client already has it. */
async function claimCode(db: any, t: string, clientId: string, code: string) {
  const k = normalizeCode(code); if (k.length < 3) return { ok: false, error: 'Codes need at least 3 letters or numbers.' };
  const map: any = ((await db.doc(codesDoc(t)).get()).data()) || {};
  if (map[k] && map[k] !== clientId) return { ok: false, error: `${k} already belongs to another client. Try another.` };
  await db.doc(codesDoc(t)).set({ [k]: clientId }, { merge: true }); return { ok: true, code: k };
}

// ── Tiers ────────────────────────────────────────────────────────────────────────────
/** Friends who had a paid first visit in the last 12 months (credit given). */
async function friendsOf(db: any, t: string, clientId: string, now: number) {
  return rows(await db.collection(`${T(t)}/referrals`).where('referrerId', '==', clientId).get()).filter((r: any) => r.status === 'rewarded' && now - ms(r.rewardedAt) < 365 * DAY).length;
}
export async function memberState(db: any, t: string, clientId: string, C: CircleSettings, now = Date.now(), c?: any) {
  const client = c || (((await db.doc(`${T(t)}/clients/${clientId}`).get()).data()) || {});
  const friends = await friendsOf(db, t, clientId, now);
  const earned = tierFor(friends, C)?.id || null; const stored = (client.circle?.tier || null) as TierId | null;
  const keep = stored && (client.circle?.granted || now - ms(client.circle?.tierAt) < KEEP_DAYS * DAY) ? stored : null;
  return { friends, tier: higher(C, earned, keep), earned, stored, creator: creatorOf(client.circle?.creator) };
}
/** After a reward: move them up if they've earned it, with one short text. */
export async function afterReward(db: any, t: string, tenant: any, clientId: string, now = Date.now(), text?: (c: any, body: string) => Promise<any>) {
  const C = circleOf(tenant); if (!C.on) return null;
  const cRef = db.doc(`${T(t)}/clients/${clientId}`); const c: any = (await cRef.get()).data() || {};
  const st = await memberState(db, t, clientId, C, now, c);
  if (!st.tier || st.tier === st.stored) return null;
  const up = !st.stored || TIER_IDS.indexOf(st.tier) > TIER_IDS.indexOf(st.stored);
  await cRef.set({ circle: { tier: st.tier, tierAt: iso(now), ...(c.circle?.since ? {} : { since: iso(now) }) } }, { merge: true });
  if (up && text) { const tier = tierById(C, st.tier)!; const S = referralSettingsOf(tenant);
    await text({ id: clientId, ...c }, `Hi ${firstOf(c.name) || 'there'}! You’re now ${/^[aeiou]/i.test(tier.name) ? 'an' : 'a'} ${tier.name} in ${programName(C, biz(tenant))}. From now on you get ${dollars(tier.rewardCents)} for every friend${tier.friendCents !== S.friendCents ? `, and they get ${dollars(tier.friendCents)} off` : ''}. Thank you for sharing us!`); }
  return st.tier;
}

// ── The member's view (in their visit link) ─────────────────────────────────────────
export async function memberView(db: any, t: string, clientId: string, tenant: any, base: string | null, now = Date.now()) {
  const C = circleOf(tenant); const S = referralSettingsOf(tenant); if (!C.on || !S.on) return null;
  const c: any = (await db.doc(`${T(t)}/clients/${clientId}`).get()).data() || {};
  const st = await memberState(db, t, clientId, C, now, c);
  const code = await codeFor(db, t, clientId, S, C);
  const tier = st.tier ? tierById(C, st.tier) : null; const next = st.creator ? null : nextTier(st.friends, C, st.tier);
  const boost = activeBoost(C, now, st.tier);
  const thisMonth = rows(await db.collection(`${T(t)}/referrals`).where('referrerId', '==', clientId).get()).filter((r: any) => String(r.createdAt || '').slice(0, 7) === iso(now).slice(0, 7));
  const opens = Number((((await db.doc(`${T(t)}/private/referralOpens-${iso(now).slice(0, 7)}`).get()).data() || {}) as any)?.by?.[clientId]) || 0;
  return {
    name: programName(C, biz(tenant)), program: C.name, tier: tier ? { id: tier.id, name: tier.name, perks: tier.perks, rewardCents: tier.rewardCents, friendCents: tier.friendCents } : null,
    creator: st.creator ? { code: st.creator.code, handle: st.creator.handle, page: base ? `${base}/c/${encodeURIComponent(t)}/${st.creator.code}` : null } : null,
    friends: st.friends, next: next ? { name: next.tier.name, need: next.need, at: next.tier.friends, perks: next.tier.perks, rewardCents: next.tier.rewardCents } : null,
    boost: boost ? { name: boost.name, multiplier: boost.multiplier, end: boost.end } : null,
    code, since: c.circle?.since || null, optIn: c.circle?.optIn === true, memberName: String(c.name || '').trim() || null,
    month: { opens, booked: thisMonth.filter((r: any) => ['booked', 'held', 'rewarded'].includes(r.status)).length, earnedCents: thisMonth.filter((r: any) => r.status === 'rewarded').reduce((n: number, r: any) => n + (Number(r.rewardCents) || 0), 0) },
    board: C.show.members ? await board(db, t, C, now, clientId) : [], circleUrl: base ? `${base}/circle/${encodeURIComponent(t)}` : null,
    tiers: C.tiers.map((x) => ({ id: x.id, name: x.name, friends: x.friends })),
  };
}
/** The members who chose to be shown, ranked by friends in the last 12 months (first names, last initial). */
async function board(db: any, t: string, C: CircleSettings, now: number, me?: string) {
  const members = rows(await db.collection(`${T(t)}/clients`).where('circle.optIn', '==', true).get()).filter((c: any) => c.circle?.tier || c.circle?.creator);
  const refs = rows(await db.collection(`${T(t)}/referrals`).where('status', '==', 'rewarded').get()).filter((r: any) => now - ms(r.rewardedAt) < 365 * DAY);
  const count = new Map<string, number>(); for (const r of refs) count.set(r.referrerId, (count.get(r.referrerId) || 0) + 1);
  return members.map((c: any) => ({ id: c.id, name: short(c.name), tier: tierById(C, c.circle?.tier)?.name || (c.circle?.creator ? 'Creator' : null), friends: count.get(c.id) || 0, me: c.id === me, photo: typeof c.avatarUrl === 'string' && /^https:/.test(c.avatarUrl) ? c.avatarUrl : null }))
    .sort((a: any, b: any) => b.friends - a.friends).slice(0, 12).map((x: any, i: number) => ({ ...x, rank: i + 1, id: undefined }));
}

// ── Public: the Circle page, asking to join, a creator's page ───────────────────────
export async function circlePublic(db: any, t: string, now = Date.now()) {
  const tenant = await tenantOf(db, t); const C = circleOf(tenant); const S = referralSettingsOf(tenant);
  if (!C.on || !S.on) return { ok: false as const, error: 'This isn’t open right now.' };
  const members = rows(await db.collection(`${T(t)}/clients`).where('circle.tier', 'in', TIER_IDS).get());
  const yearStart = `${iso(now).slice(0, 4)}-01-01`;
  const refs = rows(await db.collection(`${T(t)}/referrals`).where('status', '==', 'rewarded').get()).filter((r: any) => String(r.rewardedAt || '') >= yearStart);
  const placesLeft = C.season.places != null ? Math.max(0, C.season.places - members.length) : null;
  const S2 = referralSettingsOf(tenant);
  return { ok: true as const, business: biz(tenant), logo: tenant.logoUrl || null, name: programName(C, biz(tenant)), program: C.name, season: C.season.name || null, seasonEnd: C.season.end,
    placesLeft, full: placesLeft === 0, count: C.show.count ? members.length : null,
    faces: C.show.members ? (await board(db, t, C, now)).slice(0, 8).map((x: any) => ({ name: x.name, tier: x.tier, photo: x.photo })) : [],
    totals: C.show.totals && refs.length >= 5 ? { creditCents: refs.reduce((n: number, r: any) => n + (Number(r.rewardCents) || 0), 0), friends: refs.length } : null,
    tiers: C.tiers.map((x) => ({ id: x.id, name: x.name, friends: x.friends, rewardCents: x.rewardCents, friendCents: x.friendCents, perks: x.perks })), base: { rewardCents: S2.rewardCents, friendCents: S2.friendCents },
    photo: S.photos[0] || null, boost: activeBoost(C, now, null) ? { name: activeBoost(C, now, null)!.name, end: activeBoost(C, now, null)!.end } : null };
}
export async function circleJoin(db: any, t: string, f: any, now = Date.now()) {
  const tenant = await tenantOf(db, t); const C = circleOf(tenant); if (!C.on) return { ok: false, error: 'This isn’t open right now.' };
  const name = String(f.name || '').trim().slice(0, 80); const phone = last10(f.phone);
  if (name.length < 2 || phone.length !== 10) return { ok: false, error: 'Please add your name and a 10-digit mobile number.' };
  const ref = db.doc(`${T(t)}/private/circleRequests`); const all: any = ((await ref.get()).data()) || {};
  const open = Object.values(all).filter((r: any) => r && r.status === 'new');
  if ((open as any[]).some((r: any) => r.phone === phone)) return { ok: true, already: true };
  if (open.length >= 300) return { ok: false, error: 'We have a lot of requests right now. Please try again in a few days.' };
  const id = `r${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await ref.set({ [id]: { id, name, phone, email: String(f.email || '').trim().slice(0, 120) || null, handle: String(f.handle || '').trim().slice(0, 60) || null, followers: String(f.followers || '').trim().slice(0, 20) || null,
    why: String(f.why || '').trim().slice(0, 600) || null, status: 'new', createdAt: iso(now) } }, { merge: true });
  return { ok: true };
}
export async function creatorPage(db: any, t: string, code: string, now = Date.now()) {
  const tenant = await tenantOf(db, t); const C = circleOf(tenant); const S = referralSettingsOf(tenant);
  if (!S.on) return { ok: false as const, error: 'This offer isn’t available right now.' };
  const c = await clientOfCode(db, t, code); const cr = creatorOf(c?.circle?.creator);
  const tier = c?.circle?.tier ? tierById(C, c.circle.tier) : null;
  if (!c || (!cr && tier?.id !== 'icon')) return { ok: false as const, error: 'This page isn’t available.' };
  const { linkFor, welcomeFor } = await import('@/lib/referrals-server');
  const slug = await linkFor(db, t, c.id); const w: any = await welcomeFor(db, t, slug, now); if (!w.ok) return w;
  const services = cr?.picks?.length ? rows(await db.collection(`${T(t)}/services`).get()).filter((s: any) => cr.picks.includes(s.id) && s.isActive !== false && s.onlineBooking !== false)
    .map((s: any) => ({ id: s.id, name: String(s.name || 'Service'), minutes: Number(s.duration) || null, price: Number(s.price) || null })) : (w.favorite ? [w.favorite] : []);
  const offer = friendOfferFor(S, C, (c.circle?.tier || null) as TierId | null, cr);
  return { ...w, ok: true as const, creator: { name: cr?.displayName || short(c.name), handle: cr?.handle || null, line: cr?.line || null, code: cr?.code || normalizeCode(c.circle?.code), tier: cr ? 'Creator' : tier?.name || null,
    photo: typeof c.avatarUrl === 'string' && /^https:/.test(c.avatarUrl) ? c.avatarUrl : null, looks: cr?.looks || [], picks: services }, offerCents: offer, slug };
}

// ── The business's Circle tab ──────────────────────────────────────────────────────
export async function circleOverview(db: any, t: string, now = Date.now()) {
  const tenant = await tenantOf(db, t); const C = circleOf(tenant);
  const members = rows(await db.collection(`${T(t)}/clients`).where('circle.tier', 'in', TIER_IDS).get());
  const creators = rows(await db.collection(`${T(t)}/clients`).where('circle.creator.code', '>=', '').get()).filter((c: any) => creatorOf(c.circle?.creator));
  const refs = rows(await db.collection(`${T(t)}/referrals`).get());
  const count = new Map<string, number>(); for (const r of refs) if (r.status === 'rewarded' && now - ms(r.rewardedAt) < 365 * DAY) count.set(r.referrerId, (count.get(r.referrerId) || 0) + 1);
  const opensDoc: any = ((await db.doc(`${T(t)}/private/referralOpens-${iso(now).slice(0, 7)}`).get()).data()) || {};
  const reqs: any = ((await db.doc(`${T(t)}/private/circleRequests`).get()).data()) || {};
  const owed = refs.filter((r: any) => Number(r.cashOwedCents) > 0 && !r.cashPaidAt);
  const card = (c: any) => { const cr = creatorOf(c.circle?.creator); const f = count.get(c.id) || 0; const tier = c.circle?.tier ? tierById(C, c.circle.tier) : null; const nx = cr ? null : nextTier(f, C, tier?.id || null);
    return { clientId: c.id, name: c.name || 'Client', tier: tier?.name || null, tierId: tier?.id || null, friends: f, opens: Number(opensDoc.by?.[c.id]) || 0, toNext: nx ? `${nx.need} to ${nx.tier.name}` : null,
      creator: cr ? { ...cr } : null, earnedCents: refs.filter((r: any) => r.referrerId === c.id && r.status === 'rewarded').reduce((n: number, r: any) => n + (Number(r.rewardCents) || 0), 0),
      owedCents: owed.filter((r: any) => r.referrerId === c.id).reduce((n: number, r: any) => n + (Number(r.cashOwedCents) || 0), 0), optIn: c.circle?.optIn === true }; };
  const byId = new Map<string, any>(); for (const c of [...members, ...creators]) byId.set(c.id, c);
  return { ok: true, circle: C, business: biz(tenant), name: programName(C, biz(tenant)),
    counts: Object.fromEntries(C.tiers.map((x) => [x.id, members.filter((c: any) => c.circle?.tier === x.id).length])) as Record<TierId, number>, creatorsCount: creators.length,
    placesLeft: C.season.places != null ? Math.max(0, C.season.places - members.length) : null,
    members: [...byId.values()].map(card).sort((a, b) => (b.creator ? 1 : 0) - (a.creator ? 1 : 0) || b.friends - a.friends).slice(0, 200),
    requests: Object.values(reqs).filter((r: any) => r && ['new', 'waitlist'].includes(r.status)).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 100),
    owedCents: owed.reduce((n: number, r: any) => n + (Number(r.cashOwedCents) || 0), 0),
    boosts: C.boosts.map((b) => ({ ...b, live: ms(b.start) <= now && now < ms(b.end), ended: ms(b.end) <= now })) };
}

async function clientForRequest(db: any, t: string, r: any, now: number) {
  const all = rows(await db.collection(`${T(t)}/clients`).get()).filter((c: any) => last10(c.phone) === r.phone && !c.archived);
  if (all.length) return all[0];
  const ref = db.collection(`${T(t)}/clients`).doc();
  const c = { id: ref.id, name: r.name, phone: `+1${r.phone}`, ...(r.email ? { email: r.email } : {}), source: 'circle_request', createdAt: iso(now) };
  await ref.set(c); return c;
}
export async function circleAction(db: any, t: string, b: any, actor: { id?: string; name: string }, now = Date.now()) {
  const tenant = await tenantOf(db, t); const C = circleOf(tenant); const S = referralSettingsOf(tenant);
  const a = String(b.do || '');
  if (a === 'request') {   // accept | creator | waitlist | decline a request to join
    const ref = db.doc(`${T(t)}/private/circleRequests`); const all: any = ((await ref.get()).data()) || {}; const r = all[String(b.id || '')];
    if (!r) return { ok: false, error: 'That request is no longer here.' };
    const decision = String(b.decision || '');
    if (decision === 'waitlist' || decision === 'decline') { await ref.set({ [r.id]: { ...r, status: decision === 'waitlist' ? 'waitlist' : 'declined', decidedBy: actor.name, decidedAt: iso(now) } }, { merge: true }); return { ok: true }; }
    if (decision !== 'accept' && decision !== 'creator') return { ok: false, error: 'Unknown choice.' };
    const c = await clientForRequest(db, t, r, now);
    await db.doc(`${T(t)}/clients/${c.id}`).set({ circle: { tier: (c as any).circle?.tier || 'insider', granted: true, tierAt: iso(now), since: (c as any).circle?.since || iso(now) } }, { merge: true });
    await ref.set({ [r.id]: { ...r, status: decision === 'creator' ? 'creator' : 'accepted', clientId: c.id, decidedBy: actor.name, decidedAt: iso(now) } }, { merge: true });
    return { ok: true, clientId: c.id, creatorNext: decision === 'creator' };
  }
  if (a === 'creator') {   // make (or update, or end) a creator
    const id = String(b.clientId || ''); const cRef = db.doc(`${T(t)}/clients/${id}`); const c: any = (await cRef.get()).data(); if (!c) return { ok: false, error: 'That client isn’t here any more.' };
    if (b.end === true) { await cRef.set({ circle: { creator: null } }, { merge: true }); return { ok: true }; }
    const cr = creatorOf({ ...b.creator, since: c.circle?.creator?.since || iso(now) }); if (!cr) return { ok: false, error: 'Please give them a code, like MAYA20.' };
    const claim = await claimCode(db, t, id, cr.code); if (!claim.ok) return claim;
    await ensureWelcome(db, t, S, cr.friendCents, actor, now, `Welcome offer (creator ${cr.code})`);
    await cRef.set({ circle: { creator: cr, since: c.circle?.since || iso(now) } }, { merge: true });
    return { ok: true, creator: cr };
  }
  if (a === 'tier') {   // set a member's tier by hand (or remove them)
    const id = String(b.clientId || ''); const tier = b.tier == null ? null : TIER_IDS.includes(b.tier) ? b.tier : undefined; if (tier === undefined) return { ok: false, error: 'Unknown tier.' };
    await db.doc(`${T(t)}/clients/${id}`).set({ circle: { tier, granted: tier != null, tierAt: iso(now) } }, { merge: true }); return { ok: true };
  }
  if (a === 'boost') {
    const start = b.start ? Date.parse(b.start) : now; const end = Date.parse(b.end || '');
    if (!(end > start) || end - start > 31 * DAY) return { ok: false, error: 'Pick when it ends (up to 31 days).' };
    const boost = { id: `b${now.toString(36)}`, name: String(b.name || '').trim().slice(0, 60) || `${Number(b.multiplier) === 3 ? 'Triple' : 'Double'} credit`, start: iso(start), end: iso(end), multiplier: Math.max(1, Math.min(5, Number(b.multiplier) || 2)), tiers: Array.isArray(b.tiers) && b.tiers.length ? b.tiers : null };
    await db.doc(T(t)).set({ referrals: { circle: { boosts: [...C.boosts.filter((x) => ms(x.end) > now - 60 * DAY), boost] } } }, { merge: true }); return { ok: true, boost };
  }
  if (a === 'end_boost') { await db.doc(T(t)).set({ referrals: { circle: { boosts: C.boosts.map((x) => (x.id === b.id && ms(x.end) > now ? { ...x, end: iso(now) } : x)) } } }, { merge: true }); return { ok: true }; }
  if (a === 'cash_paid') {   // the business paid a creator outside the app: mark what's owed as paid
    const id = String(b.clientId || ''); const how = String(b.method || '').trim().slice(0, 40) || 'paid';
    const owed = rows(await db.collection(`${T(t)}/referrals`).where('referrerId', '==', id).get()).filter((r: any) => Number(r.cashOwedCents) > 0 && !r.cashPaidAt);
    for (const r of owed) await db.doc(`${T(t)}/referrals/${r.id}`).set({ cashPaidAt: iso(now), cashPaidBy: actor.name, cashMethod: how }, { merge: true });
    return { ok: true, paidCents: owed.reduce((n: number, r: any) => n + (Number(r.cashOwedCents) || 0), 0) };
  }
  return { ok: false, error: 'Unknown action.' };
}
/** The member's own choice to be shown on the Circle page (first name, last initial). */
export async function setOptIn(db: any, t: string, clientId: string, on: boolean) { await db.doc(`${T(t)}/clients/${clientId}`).set({ circle: { optIn: !!on } }, { merge: true }); return { ok: true, optIn: !!on }; }
