// src/lib/referrals-server.ts — REFERRALS, the server half (lib/referrals has the rules). Records live in
// tenants/{t}/referrals (server-only): one per friend, from first sight (an invite, a link, a name) to the reward.
//   setReferralSettings → the program's settings, and the friend's welcome offer as a discount (approved by the
//                         manager who switched it on; prices never change)
//   linkFor / publicInfo / mine / giftFriend → the client's link, the welcome page, the visit-link card, Gift a friend
//   matchOnBooking      → called by the booking service: link, "who recommended you?", or a gifted number
//   referralSweep       → every pass: give credit once a friend's first visit is paid (and a day has passed); hold the few
//                         that need a manager; take back unused credit if the visit is refunded
//   referralOverview / decideReferral → the business view
import { referralSettingsOf, slugFor, last10, firstOf, sameFirst, sameCard, refusal, termsLines, dollars, WELCOME_ID, WELCOME_CODE, layoutOf, type ReferralSettings } from '@/lib/referrals';

const T = (t: string) => `tenants/${t}`;
const DAY = 864e5;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const iso = (n: number) => new Date(n).toISOString();
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const DONE = ['completed', 'checked_out', 'paid'];
const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired', 'rejected'];
const biz = (t: any) => String(t?.name || t?.businessName || 'us');
const rand = () => Math.random().toString(36).slice(2, 6);

async function tenantOf(db: any, t: string) { return ((await db.doc(T(t)).get()).data() as any) || {}; }
async function origin(tenant: any) { const { linkOrigin } = await import('@/lib/app-origin'); return linkOrigin(tenant, ''); }

// ── Settings ──────────────────────────────────────────────────────────────────────────
export async function setReferralSettings(db: any, t: string, raw: any, approver: { id: string; name: string }, now = Date.now()) {
  const S = referralSettingsOf({ referrals: raw });
  await db.doc(T(t)).set({ referrals: S }, { merge: true });
  // The friend's welcome offer: one discount, switched on and off with the program, once per client.
  const ref = db.doc(`${T(t)}/discounts/${WELCOME_ID}`); const cur: any = (await ref.get()).data() || null;
  await ref.set({ id: WELCOME_ID, code: WELCOME_CODE, name: 'Welcome offer (referral)', description: 'A friend’s first visit, from the referral program.', type: 'fixed', value: S.friendCents / 100,
    isActive: S.on && S.friendCents > 0, limitOnePerCustomer: true, source: 'referrals', approvedBy: approver.name, approvedById: approver.id, approvedAt: iso(now), ...(cur ? {} : { createdAt: iso(now), usageCount: 0, usedByClientIds: [] }) }, { merge: true });
  return { ok: true, settings: S };
}

// ── The client's link ─────────────────────────────────────────────────────────────────
export async function linkFor(db: any, t: string, clientId: string): Promise<string> {
  const cRef = db.doc(`${T(t)}/clients/${clientId}`); const c: any = (await cRef.get()).data() || {};
  if (c.referralSlug) return String(c.referralSlug);
  const map = db.doc(`${T(t)}/private/referralCodes`); const used: any = (await map.get()).data() || {};
  let slug = slugFor(c.name || c.firstName, rand()); for (let i = 0; i < 5 && used[slug]; i++) slug = slugFor(c.name || c.firstName, rand());
  await map.set({ [slug]: clientId }, { merge: true }); await cRef.set({ referralSlug: slug }, { merge: true });
  return slug;
}
async function clientOfSlug(db: any, t: string, slug: string): Promise<any | null> {
  const s = String(slug || '').toLowerCase().trim(); if (!/^[a-z0-9-]{3,40}$/.test(s)) return null;
  const id = ((await db.doc(`${T(t)}/private/referralCodes`).get()).data() || {})[s]; if (!id) return null;
  const c = await db.doc(`${T(t)}/clients/${id}`).get(); return c.exists ? { id: c.id, ...(c.data() || {}) } : null;
}
/** Their favorite service (most visits in the last year), for the welcome page: "Hannah's favorite". */
async function favoriteOf(db: any, t: string, clientId: string, now: number) {
  const ap = rows(await db.collection(`${T(t)}/appointments`).where('clientId', '==', clientId).get()).filter((a: any) => DONE.includes(String(a.status || '')) && a.serviceId && !a.isRenterBooking && now - ms(a.startTime) < 365 * DAY);
  const n = new Map<string, number>(); for (const a of ap) n.set(String(a.serviceId), (n.get(String(a.serviceId)) || 0) + 1);
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]; if (!top) return null;
  const s: any = (await db.doc(`${T(t)}/services/${top[0]}`).get()).data(); if (!s || s.isActive === false || s.onlineBooking === false) return null;
  return { id: top[0], name: String(s.name || 'Service'), minutes: Number(s.duration) || null, price: Number(s.price) || null };
}

/** The welcome page and the booking page: who sent them and what they get. First name only. */
export async function publicInfo(db: any, t: string, slug: string, now = Date.now()) {
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant); if (!S.on) return { ok: false as const, error: 'This offer isn’t available right now.' };
  const c = await clientOfSlug(db, t, slug); if (!c || c.archived || c.status === 'archived') return { ok: false as const, error: 'This link isn’t valid.' };
  return { ok: true as const, firstName: firstOf(c.name || c.firstName) || 'A friend', business: biz(tenant), logo: tenant.logoUrl || null, offerCents: S.friendCents, code: WELCOME_CODE, favorite: await favoriteOf(db, t, c.id, now) };
}
/** The welcome page in full (design canvas RF6, RF8): the gift, their friend's favorite with the next open times, who
 * they'll see, the visit in steps, where to go, and real proof. Built only from what the business already has: their
 * own photos when they've added them, never stock photos, never made-up numbers. First names only. */
type Slot2 = { label: string; dayLabel: string; startIso: string; staffId: string };
export async function welcomeFor(db: any, t: string, slug: string, now = Date.now()) {
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant); if (!S.on) return { ok: false as const, error: 'This offer isn’t available right now.' };
  const c = await clientOfSlug(db, t, slug); if (!c || c.archived || c.status === 'archived') return { ok: false as const, error: 'This link isn’t valid.' };
  const first = firstOf(c.name || c.firstName) || 'A friend';
  const ap = rows(await db.collection(`${T(t)}/appointments`).where('clientId', '==', c.id).get()).filter((a: any) => DONE.includes(String(a.status || '')) && a.serviceId && !a.isRenterBooking && now - ms(a.startTime) < 365 * DAY);
  const n = new Map<string, number>(); for (const a of ap) n.set(String(a.serviceId), (n.get(String(a.serviceId)) || 0) + 1);
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const svc: any = top ? (((await db.doc(`${T(t)}/services/${top}`).get()).data() as any) || null) : null;
  const favorite = svc && svc.isActive !== false && svc.onlineBooking !== false ? { id: top, name: String(svc.name || 'Service'), minutes: Number(svc.duration) || null, price: Number(svc.price) || null, image: typeof svc.imageUrl === 'string' && /^https:/.test(svc.imageUrl) ? svc.imageUrl : null } : null;
  // Who they'll see. Their friend's provider for that service comes first (unless the business shows whoever is free
  // first), and anyone else who does it, each with their next open times, so a friend can always choose.
  const lastWith = ap.filter((a: any) => String(a.serviceId) === top && a.staffId).sort((a: any, b: any) => ms(b.startTime) - ms(a.startTime))[0];
  const card = (id: string, st: any) => ({ id, first: firstOf(st.name) || 'Your provider', photo: [st.avatarUrl, st.photoURL].find((u: any) => typeof u === 'string' && /^https:/.test(u)) || null,
    title: String(st.title || st.jobTitle || '').slice(0, 60) || null, specialties: (Array.isArray(st.specialties) ? st.specialties : []).map((x: any) => String(x)).slice(0, 3) });
  const isTeam = (st: any) => st && st.isActive !== false && !st.archived && st.role !== 'renter' && !st.isRenter;
  let providers: { id: string; first: string; photo: string | null; title: string | null; specialties: string[]; theirs: boolean; times: Slot2[] }[] = [];
  let times: Slot2[] = [];
  if (favorite) { try {
    const { engineFor, openTimesOn } = await import('@/lib/rebook'); const { todayIn, addDays } = await import('@/lib/tenant-time'); const { qualifiedFor } = await import('@/lib/availability');
    const e = await engineFor(db, t);
    if (e) { const today = todayIn(e.tz);
      // The next two open times, on different days, for one provider (or anyone who does it).
      const next = (staffId: string | null, horizon: number) => { const out: Slot2[] = [];
        for (let i = 0; i < horizon && out.length < 2; i++) { const s1 = openTimesOn(e, { date: addDays(today, i), serviceId: favorite.id as string, staffId })[0];
          if (s1) out.push({ label: s1.label, dayLabel: s1.dayLabel, startIso: s1.startIso, staffId: s1.staffId }); } return out; };
      const team = qualifiedFor(svc, e.staff).filter(isTeam);
      const theirsId = lastWith?.staffId && team.some((x: any) => String(x.id) === String(lastWith.staffId)) ? String(lastWith.staffId) : null;
      const order = [...team].sort((x: any, y: any) => (String(y.id) === theirsId ? 1 : 0) - (String(x.id) === theirsId ? 1 : 0));
      for (const st of order.slice(0, 6)) { const tt = next(String(st.id), 14); if (tt.length || String(st.id) === theirsId) providers.push({ ...card(String(st.id), st), theirs: String(st.id) === theirsId, times: tt }); }
      times = next(null, 21);
    }
  } catch (err) { console.error('[referrals] welcome times', err); } }
  if (!favorite && lastWith?.staffId) { const st: any = (await db.doc(`${T(t)}/staff/${lastWith.staffId}`).get()).data() || null; if (isTeam(st)) providers = [{ ...card(String(lastWith.staffId), st), theirs: true, times: [] }]; }
  const theirs = providers.find((x) => x.theirs) || null;
  // Who's picked to begin with: their friend's provider when they have open times, else whoever is free first.
  const provider = S.who === 'theirs' && theirs && (theirs.times.length || !favorite) ? theirs : null;
  const anyTimes = times; if (provider && provider.times.length) times = provider.times;
  // The visit, in steps: only what's true for this business.
  const mir = tenant.makingItRight || {}; const care = !!String((top && mir.aftercare?.byService?.[top]) || mir.aftercare?.text || '').trim();
  const steps = [
    { icon: 'arrive', title: 'Arrive', sub: S.arrival || 'A few minutes early is perfect. We’ll take it from there.' },
    { icon: 'chat', title: 'A quick chat', sub: 'What you’d like, talked through together before we start.' },
    ...(favorite ? [{ icon: 'service', title: `Your ${favorite.name.toLowerCase()}`, sub: favorite.minutes ? `About ${favorite.minutes} relaxed minutes.` : 'Relax, we’ve got you.' }] : []),
    ...(care ? [{ icon: 'care', title: 'Caring for it at home', sub: 'A short guide is sent to your phone afterwards.' }] : []),
  ];
  // Where, and the one policy line a first-timer wants to know.
  const parts = tenant.studioAddressParts || {}; const address = String(tenant.studioAddress || [parts.street, [parts.city, parts.state].filter(Boolean).join(', '), parts.zip].filter(Boolean).join(' ') || '').trim() || null;
  let policy: string | null = null; try { const { resolvePolicy } = await import('@/lib/booking-policies'); const p: any = resolvePolicy(tenant, svc || {}); const h = Number(p?.cancel?.windowHours?.value) || 0; if (h > 0) policy = `Move or cancel up to ${h} hours before.`; } catch { /* no line */ }
  // Real proof only: "loved it" answers this year, and one review the business has chosen to show.
  let loved = 0; try { loved = rows(await db.collection(`${T(t)}/appointments`).where('feedback.rating', '==', 'loved').get()).filter((a: any) => now - ms(a.feedback?.at || a.startTime) < 365 * DAY).length; } catch { /* none */ }
  let review: any = null; try { const rv = rows(await db.collection(`${T(t)}/reviews`).where('isPublic', '==', true).get()).filter((r: any) => Number(r.rating) >= 5 && String(r.text || '').trim().length >= 12)
    .sort((a: any, b: any) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0) || ms(b.createdAt) - ms(a.createdAt))[0]; if (rv) review = { text: String(rv.text).trim().slice(0, 220), first: firstOf(rv.clientName) || null }; } catch { /* none */ }
  const photos = [...S.photos, ...(favorite?.image && !S.photos.includes(favorite.image) ? [favorite.image] : [])].slice(0, 3);
  return { ok: true as const, firstName: first, business: biz(tenant), logo: tenant.logoUrl || null, offerCents: S.friendCents, code: WELCOME_CODE, layout: layoutOf(S, favorite?.image ? 1 : 0), sections: S.sections, motion: S.motion, who: S.who, favorite, provider, providers, times, anyTimes, steps, address, policy, loved: loved >= 10 ? loved : 0, review, photos };
}

export async function termsFor(db: any, t: string) { const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant); return { ok: true, on: S.on, business: biz(tenant), lines: termsLines(S, biz(tenant)) }; }

/** The visit-link card: their link, their credit and their friends (first names only). */
export async function mine(db: any, t: string, clientId: string, now = Date.now()) {
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant);
  if (!S.on) { const c0: any = (await db.doc(`${T(t)}/clients/${clientId}`).get()).data() || {};
    const credits0 = (Array.isArray(c0.storeCredits) ? c0.storeCredits : []).filter((x: any) => (x.status || 'available') === 'available' && !x.usedAt && !(x.expiresAt && ms(x.expiresAt) < now));
    return { ok: true, on: false, business: biz(tenant), creditCents: Math.round(credits0.reduce((n: number, x: any) => n + (Number(x.amount) || 0), 0) * 100),
      lines: credits0.map((x: any) => ({ cents: Math.round((Number(x.amount) || 0) * 100), why: String(x.reason || 'Store credit'), referral: false, endsAt: x.expiresAt || null })), wallet: await walletExtras(db, t, clientId, c0, now), friends: [] }; }
  const slug = await linkFor(db, t, clientId); const base = await origin(tenant);
  const c: any = (await db.doc(`${T(t)}/clients/${clientId}`).get()).data() || {};
  const credits = (Array.isArray(c.storeCredits) ? c.storeCredits : []).filter((x: any) => (x.status || 'available') === 'available' && !x.usedAt && !(x.expiresAt && ms(x.expiresAt) < now));
  const refs = rows(await db.collection(`${T(t)}/referrals`).where('referrerId', '==', clientId).get()).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt));
  const friends = refs.filter((r: any) => r.status !== 'unmatched').slice(0, 12).map((r: any) => ({ first: r.friendFirst || 'A friend', status: r.status,
    step: r.status === 'rewarded' ? 4 : r.status === 'booked' || r.status === 'held' ? (r.visitId ? 3 : 2) : r.status === 'invited' ? 1 : 0,
    line: r.status === 'rewarded' ? `${dollars(r.rewardCents)} yours` : r.status === 'booked' ? (S.unlock === 'paid' ? 'After their visit' : 'Booked') : r.status === 'invited' ? 'Not booked yet' : r.status === 'held' ? 'Being checked' : r.status === 'lapsed' ? 'Didn’t come in' : 'No reward',
    when: r.rewardedAt || r.bookedAt || r.createdAt }));
  const soonest = credits.map((x: any) => x.expiresAt).filter(Boolean).sort()[0] || null;
  const lines = credits.slice().sort((a: any, b: any) => ms(a.expiresAt || '9999') - ms(b.expiresAt || '9999')).slice(0, 8).map((x: any) => ({ cents: Math.round((Number(x.amount) || 0) * 100), why: String(x.reason || 'Store credit').replace(/^Referral reward: /, ''), referral: x.source === 'referral_reward', endsAt: x.expiresAt || null }));
  return { ok: true, on: true, lines, wallet: await walletExtras(db, t, clientId, c, now), link: base ? `${base}/ref/${encodeURIComponent(t)}/${slug}` : null, slug, business: biz(tenant), rewardCents: S.rewardCents, friendCents: S.friendCents, unlock: S.unlock, months: S.months,
    creditCents: Math.round(credits.reduce((n: number, x: any) => n + (Number(x.amount) || 0), 0) * 100), creditEndsAt: soonest, friends };
}

/** The rest of the client's wallet (design canvas RF7): gift card balances, package visits, membership visits. */
async function walletExtras(db: any, t: string, clientId: string, c: any, now: number) {
  const gift = rows(await db.collection(`${T(t)}/giftCards`).where('recipient.id', '==', clientId).get().catch(() => ({ docs: [] })))
    .filter((g: any) => g.status === 'active' && Number(g.balanceCents) > 0 && !(g.expiresAt && ms(g.expiresAt) < now))
    .map((g: any) => ({ cents: Number(g.balanceCents) || 0, from: firstOf(g.purchaserName || g.buyer?.name || g.fromName) || null, endsAt: g.expiresAt || null })).slice(0, 4);
  const packages = (Array.isArray(c.activePackages) ? c.activePackages : []).filter((p: any) => Number(p.sessionsRemaining) > 0).map((p: any) => ({ name: String(p.name || 'Package'), left: Number(p.sessionsRemaining) || 0 })).slice(0, 3);
  const sub = c.subscription || {}; let membership: any = null;
  if (sub.status === 'active' && c.activeMembershipId) { const m: any = (await db.doc(`${T(t)}/memberships/${c.activeMembershipId}`).get().catch(() => null))?.data?.() || {};
    membership = { name: String(m.name || 'Membership'), renews: sub.nextBillingDate || null }; }
  return { gift, packages, membership };
}

/** Gift a friend: we never text the friend. The client sends it from their own phone; when that number books, it's matched. */
export async function giftFriend(db: any, t: string, clientId: string, f: { firstName: string; phone: string }, now = Date.now()) {
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant); if (!S.on) return { ok: false, error: 'This offer isn’t available right now.' };
  const first = String(f.firstName || '').trim().slice(0, 40); const ph = last10(f.phone);
  if (!first || ph.length !== 10) return { ok: false, error: 'Please add their first name and a 10-digit mobile number.' };
  const c: any = (await db.doc(`${T(t)}/clients/${clientId}`).get()).data() || {};
  if (last10(c.phone) === ph) return { ok: false, error: 'That’s your own number. Please add your friend’s.' };
  const mineNow = rows(await db.collection(`${T(t)}/referrals`).where('referrerId', '==', clientId).get());
  if (mineNow.filter((r: any) => now - ms(r.createdAt) < DAY).length >= 10) return { ok: false, error: 'That’s a lot of gifts for one day. Please try again tomorrow.' };
  const dup = mineNow.find((r: any) => r.friendPhone === ph && ['invited', 'booked', 'held', 'rewarded'].includes(r.status));
  const slug = await linkFor(db, t, clientId); const base = await origin(tenant);
  if (!dup) { const ref = db.collection(`${T(t)}/referrals`).doc();
    await ref.set({ id: ref.id, referrerId: clientId, referrerName: c.name || null, friendFirst: first, friendPhone: ph, via: 'gift', status: 'invited', createdAt: iso(now) }); }
  const link = base ? `${base}/ref/${encodeURIComponent(t)}/${slug}` : '';
  const text = `Hi ${first}! I love ${biz(tenant)} and thought you would too. Here is ${dollars(S.friendCents)} off your first visit: ${link}`;
  return { ok: true, text, to: `+1${ph}` };
}

// ── Matching, at booking ──────────────────────────────────────────────────────────────
async function clientsByPhone(db: any, t: string, phone: string) {
  const d = last10(phone); if (d.length !== 10) return [];
  const variants = [`+1${d}`, d, `1${d}`, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`];
  return rows(await db.collection(`${T(t)}/clients`).where('phone', 'in', variants).get().catch(() => ({ docs: [] }))).filter((c: any) => !c.ownerRenterId && !c.archived && c.status !== 'archived');
}
async function textTo(db: any, t: string, c: any, text: string, kind: string) {
  if (!c?.phone || c.smsOptOut || c.smsConsent === false) return false;
  try { const { sendNotification } = await import('@/lib/notify'); const r: any = await sendNotification(db, { tenantId: t, channel: 'sms', to: String(c.phone), text, kind, clientId: c.id, clientName: c.name || null, recipientType: 'client', recipientId: c.id } as any); return !!r?.ok; } catch { return false; }
}

export async function matchOnBooking(db: any, t: string, o: { clientId: string; appointmentId: string; slug?: string | null; named?: { firstName: string; phone: string } | null; serviceIds?: string[] }, now = Date.now()) {
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant); if (!S.on) return { ok: true, skipped: 'off' };
  const fSnap = await db.doc(`${T(t)}/clients/${o.clientId}`).get(); if (!fSnap.exists) return { ok: true, skipped: 'no client' };
  const friend: any = { id: fSnap.id, ...(fSnap.data() || {}) }; const col = db.collection(`${T(t)}/referrals`);
  const existing = rows(await col.where('friendClientId', '==', friend.id).get());
  if (existing.some((r: any) => ['booked', 'held', 'rewarded'].includes(r.status))) return { ok: true, skipped: 'already referred' };
  // Who sent them: their link, then "who recommended you?", then a number someone gifted.
  let referrer: any = null; let via: 'link' | 'named' | 'gift' = 'link'; let invite: any = null;
  if (o.slug) referrer = await clientOfSlug(db, t, o.slug);
  if (!referrer && o.named && String(o.named.firstName || '').trim() && last10(o.named.phone).length === 10) {
    const hits = (await clientsByPhone(db, t, o.named.phone)).filter((c: any) => sameFirst(c.name || c.firstName, o.named!.firstName));
    if (hits.length === 1) { referrer = hits[0]; via = 'named'; }
    else {   // no single match: the desk confirms it (nothing is shown to the client either way)
      const ref = col.doc(); await ref.set({ id: ref.id, referrerId: null, friendClientId: friend.id, friendFirst: firstOf(friend.name), friendPhone: last10(friend.phone), via: 'named', status: 'unmatched',
        namedFirst: String(o.named.firstName).trim().slice(0, 40), namedPhoneLast4: last10(o.named.phone).slice(-4), namedPhone: last10(o.named.phone), appointmentId: o.appointmentId, createdAt: iso(now) });
      return { ok: true, unmatched: true };
    }
  }
  if (!referrer && last10(friend.phone).length === 10) {
    invite = rows(await col.where('friendPhone', '==', last10(friend.phone)).get()).filter((r: any) => r.status === 'invited' && now - ms(r.createdAt) < 120 * DAY).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt))[0] || null;
    if (invite) { const rs = await db.doc(`${T(t)}/clients/${invite.referrerId}`).get(); if (rs.exists) { referrer = { id: rs.id, ...(rs.data() || {}) }; via = 'gift'; } }
  }
  if (!referrer) return { ok: true, skipped: 'no referrer' };
  for (const u of existing) if (u.status === 'unmatched') await col.doc(u.id).set({ status: 'declined', reason: 'superseded', decidedAt: iso(now) }, { merge: true });   // an earlier name that didn't match: this one did
  const ref = invite ? db.doc(`${T(t)}/referrals/${invite.id}`) : col.doc();
  const base = { id: ref.id, referrerId: referrer.id, referrerName: referrer.name || null, friendClientId: friend.id, friendFirst: firstOf(friend.name) || invite?.friendFirst || 'A friend', friendPhone: last10(friend.phone), via, appointmentId: o.appointmentId, ...(invite ? {} : { createdAt: iso(now) }) };
  const no = refusal(referrer, friend);
  if (no) { await ref.set({ ...base, status: 'declined', reason: no, decidedAt: iso(now) }, { merge: true }); return { ok: true, declined: no }; }
  // New to us? Any finished visit before this booking means they're already a client: thanked, no reward, no offer.
  const before = rows(await db.collection(`${T(t)}/appointments`).where('clientId', '==', friend.id).get()).filter((a: any) => a.id !== o.appointmentId && DONE.includes(String(a.status || '')));
  if (before.length) { await ref.set({ ...base, status: 'declined', reason: 'existing', decidedAt: iso(now) }, { merge: true }); return { ok: true, declined: 'existing' }; }
  await ref.set({ ...base, status: 'booked', bookedAt: iso(now) }, { merge: true });
  // The welcome offer rides the visit like any offer — unless they already have one on it.
  const aRef = db.doc(`${T(t)}/appointments/${o.appointmentId}`); const a: any = (await aRef.get()).data() || {};
  const patch: any = { referralId: ref.id, referralBookedAt: iso(now) };
  if (S.friendCents > 0 && !a.pendingDiscountCode) {
    const dz: any = (await db.doc(`${T(t)}/discounts/${WELCOME_ID}`).get()).data();
    const { offerProblem } = await import('@/lib/offers');
    if (dz && !offerProblem(dz, { clientId: friend.id, serviceIds: o.serviceIds || [] })) patch.pendingDiscountCode = WELCOME_CODE;
  }
  await aRef.set(patch, { merge: true });
  await textTo(db, t, referrer, `Hi ${firstOf(referrer.name) || 'there'}! ${base.friendFirst} just booked their first visit with us. Thank you so much for sending them our way.${S.unlock === 'paid' ? ` Your ${dollars(S.rewardCents)} will be waiting for you after their appointment.` : ` Your ${dollars(S.rewardCents)} is on its way.`}`, 'referral_update');
  return { ok: true, matched: via, referralId: ref.id };
}

// ── Credit ────────────────────────────────────────────────────────────────────────────
/** Store credit the same shape as everywhere else (client.storeCredits + totalStoreCredit), source referral_reward. */
async function issueCredit(db: any, t: string, clientId: string, cents: number, months: number, reason: string, refId: string, now: number) {
  const cRef = db.doc(`${T(t)}/clients/${clientId}`); const c: any = (await cRef.get()).data() || {};
  const id = `ref_${refId}`; const list = Array.isArray(c.storeCredits) ? c.storeCredits : [];
  if (list.some((x: any) => x.id === id)) return id;   // never twice
  const exp = new Date(now); exp.setMonth(exp.getMonth() + months);
  const entry = { id, tenantId: t, clientId, amountCents: cents, amount: cents / 100, type: 'earned', source: 'referral_reward', reason, createdBy: 'referrals', approvedBy: null, expiresAt: exp.toISOString(), createdAt: iso(now), usedAt: null, usedOnAppointmentId: null, status: 'available', referralId: refId };
  await cRef.set({ storeCredits: [...list, entry], totalStoreCredit: Math.round(((Number(c.totalStoreCredit) || 0) + cents / 100) * 100) / 100 }, { merge: true });
  const a = db.collection(`${T(t)}/auditLog`).doc(); await a.set({ id: a.id, entityType: 'credit_issued', entityId: id, clientId, amountCents: cents, source: 'referral_reward', reason, at: iso(now), by: 'referrals' }).catch(() => {});
  return id;
}
/** Take back unused referral credit (a refunded visit). Returns whether it was still unused. */
async function voidCredit(db: any, t: string, clientId: string, creditId: string, now: number): Promise<boolean> {
  const cRef = db.doc(`${T(t)}/clients/${clientId}`); const c: any = (await cRef.get()).data() || {};
  const list = Array.isArray(c.storeCredits) ? c.storeCredits : []; const e = list.find((x: any) => x.id === creditId);
  if (!e || (e.status && e.status !== 'available') || e.usedAt) return false;
  await cRef.set({ storeCredits: list.map((x: any) => (x.id === creditId ? { ...x, status: 'voided', voidedAt: iso(now), voidReason: 'The friend’s visit was refunded.' } : x)), totalStoreCredit: Math.max(0, Math.round(((Number(c.totalStoreCredit) || 0) - (Number(e.amount) || 0)) * 100) / 100) }, { merge: true });
  return true;
}
async function refundedVisit(db: any, t: string, apptId: string): Promise<boolean> {
  const tx = rows(await db.collection(`${T(t)}/transactions`).where('appointmentId', '==', apptId).get().catch(() => ({ docs: [] })));
  return tx.some((x: any) => x.type === 'reversal' || x.taxBucket === 'refund' || /refund|void/i.test(String(x.category || '')));
}

async function reward(db: any, t: string, tenant: any, S: ReferralSettings, r: any, now: number) {
  const credit = await issueCredit(db, t, r.referrerId, S.rewardCents, S.months, `Referral reward: ${r.friendFirst || 'a friend'}`, r.id, now);
  await db.doc(`${T(t)}/referrals/${r.id}`).set({ status: 'rewarded', rewardedAt: iso(now), rewardCents: S.rewardCents, creditId: credit, holdReason: null }, { merge: true });
  const rc: any = (await db.doc(`${T(t)}/clients/${r.referrerId}`).get()).data() || {};
  await textTo(db, t, { id: r.referrerId, ...rc }, `Hi ${firstOf(rc.name) || 'there'}, ${r.friendFirst || 'your friend'} came in today. Thank you for trusting us with your friend! Your ${dollars(S.rewardCents)} is ready for your next visit.`, 'referral_update');
}

/** Every pass: credit friends' first paid visits; hold the few that need a manager; take back credit for refunds. */
export async function referralSweep(db: any, t: string, tenant: any, now = Date.now()) {
  const S = referralSettingsOf(tenant); if (!S.on) return { ok: true, skipped: 'off' };
  const all = rows(await db.collection(`${T(t)}/referrals`).where('status', 'in', ['booked', 'held', 'rewarded']).get());
  const month = iso(now).slice(0, 7);
  const thisMonth = new Map<string, number>(); for (const r of all) if (r.status === 'rewarded' && String(r.rewardedAt || '').slice(0, 7) === month) thisMonth.set(r.referrerId, (thisMonth.get(r.referrerId) || 0) + 1);
  let rewarded = 0, held = 0, clawed = 0, lapsed = 0;
  for (const r of all) {
    const ref = db.doc(`${T(t)}/referrals/${r.id}`);
    if (r.status === 'rewarded' && r.creditId && !r.endReminderAt) {   // one gentle reminder a month before the credit ends
      const rc: any = (await db.doc(`${T(t)}/clients/${r.referrerId}`).get()).data() || {}; const cr = (rc.storeCredits || []).find((x: any) => x.id === r.creditId);
      if (cr && (cr.status || 'available') === 'available' && !cr.usedAt && ms(cr.expiresAt) > now && ms(cr.expiresAt) - now < 30 * DAY) {
        await ref.set({ endReminderAt: iso(now) }, { merge: true });
        const when = new Date(ms(cr.expiresAt)).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        await textTo(db, t, { id: r.referrerId, ...rc }, `Hi ${firstOf(rc.name) || 'there'}, a friendly reminder that your ${dollars(Math.round((Number(cr.amount) || 0) * 100))} credit ends on ${when}. We would love to see you before then!`, 'referral_update');
      }
    }
    if (r.status === 'rewarded') {   // a refund within 60 days takes unused credit back; spent credit is for a manager to see
      if (r.clawCheckedDone || now - ms(r.rewardedAt) > 60 * DAY || !r.visitId) continue;
      if (await refundedVisit(db, t, r.visitId)) {
        const back = r.creditId ? await voidCredit(db, t, r.referrerId, r.creditId, now) : false;
        await ref.set({ status: 'declined', reason: 'refunded', clawedBack: back, clawCheckedDone: true, decidedAt: iso(now) }, { merge: true }); clawed++;
        if (!back) { const n = db.collection(`${T(t)}/notifications`).doc(); await n.set({ id: n.id, type: 'referral', read: false, createdAt: iso(now), link: '/referrals', message: `${r.friendFirst || 'A referred friend'}’s visit was refunded, and ${firstOf(r.referrerName) || 'the client'} has already used the ${dollars(r.rewardCents)} credit. Nothing was charged to them.` }); }
      }
      continue;
    }
    if (r.status === 'held' && r.holdReason !== 'cap') continue;   // a manager decides
    if (r.holdApproved && r.status === 'held' && r.holdReason !== 'cap') continue;
    // Their first finished visit since the referral (it may not be the one they first booked).
    const ap = rows(await db.collection(`${T(t)}/appointments`).where('clientId', '==', r.friendClientId).get());
    const visit = ap.filter((a: any) => DONE.includes(String(a.status || '')) && ms(a.checkedOutAt || a.startTime) >= ms(r.createdAt) - DAY).sort((a: any, b: any) => ms(a.checkedOutAt || a.startTime) - ms(b.checkedOutAt || b.startTime))[0];
    const live = ap.some((a: any) => !DEAD.includes(String(a.status || '')) && !DONE.includes(String(a.status || '')) && ms(a.startTime) > now);
    if (S.unlock === 'paid') {
      if (!visit) { if (!live && now - ms(r.bookedAt || r.createdAt) > 120 * DAY) { await ref.set({ status: 'lapsed', decidedAt: iso(now) }, { merge: true }); lapsed++; } continue; }
      if (now - ms(visit.checkedOutAt || visit.startTime) < DAY) continue;   // past a day, so a same-day refund or void is seen first
      if (await refundedVisit(db, t, visit.id)) { await ref.set({ status: 'declined', reason: 'refunded', visitId: visit.id, decidedAt: iso(now) }, { merge: true }); continue; }
    } else if (!visit && !live) continue;
    const [rc, fc] = await Promise.all([db.doc(`${T(t)}/clients/${r.referrerId}`).get(), db.doc(`${T(t)}/clients/${r.friendClientId}`).get()]);
    if (!rc.exists) { await ref.set({ status: 'declined', reason: 'no_match', decidedAt: iso(now) }, { merge: true }); continue; }
    if (!r.holdApproved && sameCard(rc.data(), fc.data())) { if (r.status !== 'held') { await ref.set({ status: 'held', holdReason: 'same_card', visitId: visit?.id || null }, { merge: true }); held++; } continue; }
    if ((thisMonth.get(r.referrerId) || 0) >= S.cap) { if (r.status !== 'held') { await ref.set({ status: 'held', holdReason: 'cap', visitId: visit?.id || null }, { merge: true }); held++; } continue; }
    await ref.set({ visitId: visit?.id || null, visitedAt: visit ? (visit.checkedOutAt || visit.startTime) : null }, { merge: true });
    await reward(db, t, tenant, S, { ...r, visitId: visit?.id || null }, now); thisMonth.set(r.referrerId, (thisMonth.get(r.referrerId) || 0) + 1); rewarded++;
  }
  return { ok: true, rewarded, held, clawed, lapsed };
}

// ── The business view ─────────────────────────────────────────────────────────────────
export async function referralOverview(db: any, t: string, now = Date.now()) {
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant);
  const refs = rows(await db.collection(`${T(t)}/referrals`).get());
  const month = iso(now).slice(0, 7);
  const ledger = rows(await db.collection(`${T(t)}/results`).where('source', '==', 'referral').get().catch(() => ({ docs: [] })));
  const paidMonth = ledger.filter((r: any) => r.state === 'paid' && String(r.startTime || '').slice(0, 7) === month).reduce((n: number, r: any) => n + (Number(r.paidCents) || 0), 0);
  const rewardedMonth = refs.filter((r: any) => r.status === 'rewarded' && String(r.rewardedAt || '').slice(0, 7) === month);
  const rewardCents = rewardedMonth.reduce((n: number, r: any) => n + (Number(r.rewardCents) || 0), 0);
  // What referred clients are worth over their first 12 months, beside everyone else's (finished visits).
  const since = iso(now - 365 * DAY);
  const ap = rows(await db.collection(`${T(t)}/appointments`).where('startTime', '>=', since).get()).filter((a: any) => DONE.includes(String(a.status || '')) && !a.isRenterBooking);
  const money = (a: any) => Number(a.revenue ?? a.totalPrice ?? a.price ?? 0) || 0;
  const byClient = new Map<string, number>(); for (const a of ap) if (a.clientId) byClient.set(String(a.clientId), (byClient.get(String(a.clientId)) || 0) + money(a));
  const referred = new Set<string>(refs.filter((r: any) => ['rewarded', 'booked', 'held'].includes(r.status) && r.friendClientId).map((r: any) => String(r.friendClientId)));
  const avg = (ids: string[]) => (ids.length ? Math.round((ids.reduce((n, id) => n + (byClient.get(id) || 0), 0) / ids.length) * 100) : 0);
  const refIds = [...referred].filter((id) => byClient.has(id)); const others = [...byClient.keys()].filter((id) => !referred.has(id));
  const people = new Map<string, any>();
  for (const r of refs) { if (!r.referrerId || r.status === 'unmatched') continue; const p = people.get(r.referrerId) || { clientId: r.referrerId, name: r.referrerName || 'Client', friends: 0, visited: 0, broughtCents: 0, earnedCents: 0 };
    if (['invited', 'booked', 'held', 'rewarded', 'lapsed'].includes(r.status)) p.friends++; if (r.status === 'rewarded') { p.visited++; p.earnedCents += Number(r.rewardCents) || 0; p.broughtCents += Math.round((byClient.get(String(r.friendClientId)) || 0) * 100); }
    people.set(r.referrerId, p); }
  const short = (n: any) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Client'; };
  return {
    ok: true, settings: S, month,
    tiles: { paidCents: paidMonth, rewardCents, rewards: rewardedMonth.length, returnX: rewardCents ? Math.round((paidMonth / rewardCents) * 10) / 10 : null, referredWorthCents: avg(refIds), othersWorthCents: avg(others), referredCount: refIds.length },
    top: [...people.values()].sort((a, b) => b.broughtCents - a.broughtCents || b.friends - a.friends).slice(0, 8).map((p) => ({ ...p, name: short(p.name) })),
    waiting: refs.filter((r: any) => r.status === 'booked').sort((a: any, b: any) => ms(b.bookedAt) - ms(a.bookedAt)).slice(0, 20).map((r: any) => ({ id: r.id, friend: r.friendFirst, referrer: short(r.referrerName), bookedAt: r.bookedAt, via: r.via })),
    review: refs.filter((r: any) => r.status === 'held' || r.status === 'unmatched').sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 30)
      .map((r: any) => ({ id: r.id, status: r.status, holdReason: r.holdReason || null, friend: r.friendFirst, referrer: r.referrerName ? short(r.referrerName) : null, named: r.namedFirst ? `${r.namedFirst}, phone ending ${r.namedPhoneLast4}` : null, createdAt: r.createdAt })),
  };
}

// ── Trying it yourself (managers) ──────────────────────────────────────────────────────
/** Find a client to look at, by name or the last digits of their phone (managers only; the server checks). */
export async function findClients(db: any, t: string, q: string) {
  const qq = String(q || '').trim().toLowerCase(); if (qq.length < 2) return { ok: true, clients: [] };
  const digits = qq.replace(/\D+/g, '');
  const all = rows(await db.collection(`${T(t)}/clients`).get()).filter((c: any) => !c.archived && c.status !== 'archived' && !c.ownerRenterId);
  const hit = all.filter((c: any) => (digits.length >= 4 ? last10(c.phone).endsWith(digits) : String(c.name || '').toLowerCase().includes(qq))).slice(0, 8);
  return { ok: true, clients: hit.map((c: any) => ({ id: c.id, name: c.name || 'Client', phoneLast4: last10(c.phone).slice(-4) || null })) };
}
/** See it as the client does: a private link to their wallet (2 hours), and their welcome link. */
export async function previewFor(db: any, t: string, clientId: string, actor: { name: string }, now = Date.now()) {
  const c = await db.doc(`${T(t)}/clients/${clientId}`).get(); if (!c.exists) return { ok: false, error: 'That client isn’t here any more.' };
  const tenant = await tenantOf(db, t); const base = await origin(tenant); if (!base) return { ok: false, error: 'Please set the app’s web address first (Settings).' };
  const token = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 24);
  await db.doc(`${T(t)}/private/referralPreviews`).set({ [token]: { clientId, exp: now + 2 * 3600e3, by: actor.name } }, { merge: true });
  const slug = await linkFor(db, t, clientId);
  return { ok: true, walletUrl: `${base}/wallet/${encodeURIComponent(t)}?p=${token}`, welcomeUrl: `${base}/ref/${encodeURIComponent(t)}/${slug}`, name: (c.data() || {}).name || 'Client' };
}
/** For the live preview in Settings: the welcome link of a recent real client (their favorite and provider fill it in). */
export async function sampleWelcome(db: any, t: string, now = Date.now()) {
  const ap = rows(await db.collection(`${T(t)}/appointments`).where('status', '==', 'completed').get())
    .filter((a: any) => a.clientId && a.serviceId && !a.isRenterBooking && now - ms(a.startTime) < 365 * DAY).sort((a: any, b: any) => ms(b.startTime) - ms(a.startTime));
  for (const a of ap.slice(0, 20)) { const c: any = (await db.doc(`${T(t)}/clients/${a.clientId}`).get()).data(); if (!c || c.archived || c.status === 'archived') continue;
    return { ok: true, path: `/ref/${encodeURIComponent(t)}/${await linkFor(db, t, String(a.clientId))}`, name: firstOf(c.name || c.firstName) || 'A client' }; }
  return { ok: false, error: 'Once a client has had a visit, the preview shows their welcome page here.' };
}
export async function clientOfPreview(db: any, t: string, token: string, now = Date.now()): Promise<string | null> {
  if (!/^[a-z0-9]{12,30}$/.test(String(token || ''))) return null;
  const e = (((await db.doc(`${T(t)}/private/referralPreviews`).get()).data() || {}) as any)[token]; return e && e.exp > now ? String(e.clientId) : null;
}
/** Give the credit now (a manager skipping the day's wait, e.g. when testing): only once the friend's visit is paid. */
export async function giveNow(db: any, t: string, id: string, actor: { name: string }, now = Date.now()) {
  const ref = db.doc(`${T(t)}/referrals/${String(id || '').slice(0, 80)}`); const r: any = (await ref.get()).data(); if (!r) return { ok: false, error: 'This referral is no longer available.' };
  if (r.status !== 'booked') return { ok: false, error: 'Only a friend who has booked can be given credit.' };
  const ap = rows(await db.collection(`${T(t)}/appointments`).where('clientId', '==', r.friendClientId).get());
  const visit = ap.filter((a: any) => DONE.includes(String(a.status || ''))).sort((a: any, b: any) => ms(a.checkedOutAt || a.startTime) - ms(b.checkedOutAt || b.startTime))[0];
  if (!visit) return { ok: false, error: `${r.friendFirst || 'Their friend'} hasn’t been checked out yet.` };
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant);
  await ref.set({ visitId: visit.id, visitedAt: visit.checkedOutAt || visit.startTime, givenEarlyBy: actor.name }, { merge: true });
  await reward(db, t, tenant, S, { ...r, id: ref.id, visitId: visit.id }, now); return { ok: true };
}

/** A manager's decision: approve a held one (credit now), give no reward, or confirm an unmatched name to a client. */
export async function decideReferral(db: any, t: string, b: { id: string; action: 'approve' | 'decline' | 'confirm'; referrerPhone?: string }, actor: { id: string; name: string }, now = Date.now()) {
  const ref = db.doc(`${T(t)}/referrals/${String(b.id || '').slice(0, 80)}`); const r: any = (await ref.get()).data(); if (!r) return { ok: false, error: 'This referral is no longer available.' };
  const tenant = await tenantOf(db, t); const S = referralSettingsOf(tenant);
  if (b.action === 'decline') { await ref.set({ status: 'declined', reason: 'manager', decidedBy: actor.name, decidedAt: iso(now) }, { merge: true }); return { ok: true }; }
  if (b.action === 'approve') {
    if (r.status !== 'held') return { ok: false, error: 'This one isn’t waiting for a decision.' };
    await reward(db, t, tenant, S, { ...r, id: ref.id }, now); await ref.set({ holdApproved: true, decidedBy: actor.name, decidedAt: iso(now) }, { merge: true }); return { ok: true };
  }
  if (b.action === 'confirm') {
    if (r.status !== 'unmatched') return { ok: false, error: 'This one is already matched.' };
    const hits = await clientsByPhone(db, t, String(b.referrerPhone || '')); if (hits.length !== 1) return { ok: false, error: hits.length ? 'More than one client has that number. Please check it.' : 'No client has that number.' };
    const fc: any = (await db.doc(`${T(t)}/clients/${r.friendClientId}`).get()).data() || {};
    const no = refusal(hits[0], { id: r.friendClientId, ...fc }); if (no) { await ref.set({ referrerId: hits[0].id, referrerName: hits[0].name || null, status: 'declined', reason: no, decidedBy: actor.name, decidedAt: iso(now) }, { merge: true }); return { ok: true, declined: no }; }
    await ref.set({ referrerId: hits[0].id, referrerName: hits[0].name || null, status: 'booked', bookedAt: r.createdAt, confirmedBy: actor.name, decidedAt: iso(now) }, { merge: true });
    if (r.appointmentId) await db.doc(`${T(t)}/appointments/${r.appointmentId}`).set({ referralId: ref.id, referralBookedAt: r.createdAt }, { merge: true }).catch(() => {});
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}
