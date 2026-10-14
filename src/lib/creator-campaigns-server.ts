// src/lib/creator-campaigns-server.ts — CREATOR CAMPAIGNS, the server half (lib/creator-campaigns has the rules).
// Campaigns live in tenants/{t}/creatorCampaigns/{id} (server-only): the campaign, plus `hands` (each creator's hand-in
// for each piece) and `opens` (link opens per piece). Referrals a campaign brings carry campaignId / pieceId.
//   listCampaigns / getCampaign / saveCampaign → the business's Campaigns tab and editor (with the planner's inputs)
//   creatorCampaigns / handIn                  → the creator's Campaigns, from their own visit link
//   reviewHand                                 → approve a piece (its fee becomes owed) or ask for a change
//   campaignOffer                              → the guarded offer for a creator's friend during a live campaign
//   campaignSweep                              → reminders before pieces are due, late marks, and the cost guard
//   scorecards                                 → every creator judged by paid first visits, return, and who comes back
import { campaignOf, plan, scoreTag, handKey, pieceLabel, daysLabel, type Campaign, type Hand } from '@/lib/creator-campaigns';
import { creatorOf } from '@/lib/circle';
import { referralSettingsOf, firstOf, dollars } from '@/lib/referrals';

const T = (t: string) => `tenants/${t}`;
const COL = (t: string) => `${T(t)}/creatorCampaigns`;
const DAY = 864e5;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const iso = (n: number) => new Date(n).toISOString();
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const DONE = ['completed', 'checked_out', 'paid'];
const money = (a: any) => Number(a.revenue ?? a.totalPrice ?? a.price ?? 0) || 0;
const short = (n: any) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Client'; };
async function tenantOf(db: any, t: string) { return ((await db.doc(T(t)).get()).data() as any) || {}; }
const liveNow = (c: Campaign, now: number) => c.status === 'live' && !c.paused && (!c.start || ms(c.start) <= now + DAY) && (!c.end || ms(c.end) + DAY > now);

// ── The planner's inputs, from the business's own history ─────────────────────────────
export async function planInputs(db: any, t: string, now = Date.now()) {
  const tenant = await tenantOf(db, t);
  const ap = rows(await db.collection(`${T(t)}/appointments`).where('startTime', '>=', iso(now - 730 * DAY)).get()).filter((a: any) => DONE.includes(String(a.status || '')) && a.clientId && !a.isRenterBooking);
  const by = new Map<string, any[]>(); for (const a of ap) { const k = String(a.clientId); if (!by.has(k)) by.set(k, []); by.get(k)!.push(a); }
  const firsts: number[] = [], year: number[] = []; let newOld = 0, rebooked = 0;
  for (const list of by.values()) { list.sort((x, y) => ms(x.startTime) - ms(y.startTime)); const f = list[0]; const t0 = ms(f.startTime);
    if (now - t0 < 365 * DAY) { firsts.push(money(f)); if (now - t0 > 90 * DAY) { newOld++; if (list.some((x) => ms(x.startTime) > t0 + DAY && ms(x.startTime) - t0 < 90 * DAY)) rebooked++; } }
    if (now - t0 >= 365 * DAY) year.push(list.filter((x) => ms(x.startTime) - t0 < 365 * DAY).reduce((n, x) => n + money(x), 0)); }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);
  const allYear = [...by.values()].map((l) => l.filter((x) => now - ms(x.startTime) < 365 * DAY).reduce((n, x) => n + money(x), 0)).filter((x) => x > 0);
  const camps = rows(await db.collection(COL(t)).get()).map((c: any) => campaignOf(c, c.id)).filter((c: Campaign) => c.status !== 'draft');
  const refs = rows(await db.collection(`${T(t)}/referrals`).where('status', '==', 'rewarded').get());
  const per: number[] = camps.map((c: Campaign) => (c.creators.length ? refs.filter((r: any) => r.campaignId === c.id).length / c.creators.length : 0)).filter((x: number) => x >= 0);
  const margin = Number(tenant.referrals?.margin); const S = referralSettingsOf(tenant);
  return { firstVisitCents: Math.round(avg(firsts) * 100) || 5000, yearValueCents: Math.round((year.length >= 5 ? avg(year) : avg(allYear) || 300) * 100), rebook: newOld >= 5 ? rebooked / newOld : null,
    margin: Number.isFinite(margin) && margin > 0 ? margin : 0.6, marginSet: Number.isFinite(margin) && margin > 0, expectedPerCreator: per.length ? Math.round((per.reduce((n: number, x: number) => n + x, 0) / per.length) * 10) / 10 : 3, historyKnown: per.length > 0,
    friendCents: S.friendCents };
}

// ── The business's side ──────────────────────────────────────────────────────────────
async function creatorsById(db: any, t: string, ids: string[]) {
  const out = new Map<string, any>(); for (const id of ids) { const c = await db.doc(`${T(t)}/clients/${id}`).get(); if (c.exists) out.set(id, { id, ...(c.data() || {}) }); } return out;
}
function stats(c: Campaign, doc: any, refs: any[]) {
  const mine = refs.filter((r: any) => r.campaignId === c.id);
  const hands: Record<string, Hand> = doc.hands || {}; const total = c.creators.length * c.pieces.length;
  const approved = Object.values(hands).filter((h) => h.status === 'approved');
  const opens = Object.values(doc.opens || {}).reduce((n: number, x: any) => n + (Number(x) || 0), 0);
  const fees = approved.reduce((n, h) => n + (Number(h.feeCents) || 0), 0);
  const paid = mine.filter((r: any) => r.status === 'rewarded');
  const cost = fees + paid.reduce((n: number, r: any) => n + (Number(r.rewardCents) || 0) + (Number(r.cashOwedCents) || 0) + (Number(r.offerCents) || 0), 0);
  return { pieces: total, approved: approved.length, waiting: Object.values(hands).filter((h) => h.status === 'submitted').length, opens, booked: mine.filter((r: any) => ['booked', 'held', 'rewarded'].includes(r.status)).length, paidFirst: paid.length, costCents: cost, feesCents: fees };
}
export async function listCampaigns(db: any, t: string, now = Date.now()) {
  const docs = rows(await db.collection(COL(t)).get()); const refs = rows(await db.collection(`${T(t)}/referrals`).get());
  return { ok: true, campaigns: docs.map((d: any) => { const c = campaignOf(d, d.id); return { ...c, live: liveNow(c, now), stats: stats(c, d, refs) }; }).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt)) };
}
export async function getCampaign(db: any, t: string, id: string, now = Date.now()) {
  const tenant = await tenantOf(db, t);
  const snap = id === 'new' ? null : await db.doc(`${COL(t)}/${id}`).get(); if (snap && !snap.exists) return { ok: false, error: 'That campaign isn’t here any more.' };
  const raw = snap ? snap.data() : {}; const c = campaignOf(raw, snap ? id : undefined);
  const refs = rows(await db.collection(`${T(t)}/referrals`).get());
  const creators = rows(await db.collection(`${T(t)}/clients`).where('circle.creator.code', '>=', '').get()).map((x: any) => ({ id: x.id, name: x.name || 'Client', creator: creatorOf(x.circle?.creator) })).filter((x: any) => x.creator);
  const services = rows(await db.collection(`${T(t)}/services`).get()).filter((s: any) => s.isActive !== false && !s.renterId && !s.renterProviderId).map((s: any) => ({ id: s.id, name: String(s.name || 'Service'), price: Number(s.price) || 0 }));
  const per = c.creators.map((cid) => { const cr = creators.find((x: any) => x.id === cid); const mine = refs.filter((r: any) => r.campaignId === c.id && r.referrerId === cid);
    return { id: cid, name: cr?.name || 'Creator', code: cr?.creator?.code || null, booked: mine.filter((r: any) => ['booked', 'held', 'rewarded'].includes(r.status)).length, paidFirst: mine.filter((r: any) => r.status === 'rewarded').length,
      pieces: c.pieces.map((p, i) => ({ id: p.id, label: pieceLabel(p, i), due: p.due, hand: (raw?.hands || {})[handKey(cid, p.id)] || null, opens: Number((raw?.opens || {})[`${cid}.${p.id}`]) || 0,
        booked: mine.filter((r: any) => r.pieceId === p.id).length })) }; });
  return { ok: true, campaign: c, live: liveNow(c, now), creators, services, per, stats: stats(c, raw || {}, refs), inputs: await planInputs(db, t, now), business: String(tenant.name || '') };
}
export async function saveCampaign(db: any, t: string, raw: any, actor: { id?: string; name: string }, now = Date.now()) {
  const c = campaignOf({ ...raw, createdAt: raw?.createdAt || iso(now) }, raw?.id && raw.id !== 'new' ? raw.id : undefined);
  if (c.status === 'live' && !c.creators.length) return { ok: false, error: 'Add at least one creator before sending it.' };
  if (c.status === 'live' && !c.pieces.length) return { ok: false, error: 'Add at least one piece they’ll post.' };
  const ref = db.doc(`${COL(t)}/${c.id}`); const cur: any = (await ref.get()).data() || {};
  const wasLive = cur.status === 'live';
  await ref.set({ ...c, paused: raw?.resume ? null : (cur.paused || null), hands: cur.hands || {}, opens: cur.opens || {}, updatedBy: actor.name, updatedAt: iso(now) }, { merge: false });
  await syncOffers(db, t, c, actor, now);
  if (c.status === 'live' && !wasLive) {   // let each creator know there's a brief waiting, in their link
    const { linkOrigin } = await import('@/lib/app-origin'); const tenant = await tenantOf(db, t);
    for (const id of c.creators) { const cl: any = (await db.doc(`${T(t)}/clients/${id}`).get()).data(); if (!cl?.phone || cl.smsOptOut || cl.smsConsent === false) continue;
      try { const { sendNotification } = await import('@/lib/notify'); await sendNotification(db, { tenantId: t, channel: 'sms', to: String(cl.phone), kind: 'referral_update', clientId: id, clientName: cl.name || null, recipientType: 'client', recipientId: id,
        text: `Hi ${firstOf(cl.name) || 'there'}! Your brief for “${c.name}” with ${tenant.name || 'us'} is ready. Open your visit link and tap Campaigns to see it.` } as any); } catch { /* the brief is still in their link */ } }
    void linkOrigin;
  }
  return { ok: true, id: c.id };
}
/** During a live campaign, each creator's offer gets its own approved discount with the campaign's guard rails. */
async function syncOffers(db: any, t: string, c: Campaign, actor: { id?: string; name: string }, now: number) {
  const creators = await creatorsById(db, t, c.creators);
  for (const [id, cl] of creators) { const cr = creatorOf(cl.circle?.creator); if (!cr || !(cr.friendCents > 0)) continue;
    const did = `ccamp_${c.id}_${id}`.slice(0, 120); const ref = db.doc(`${T(t)}/discounts/${did}`); const cur: any = (await ref.get()).data() || null;
    await ref.set({ id: did, code: `${cr.code}-${c.id.slice(-4).toUpperCase()}`, name: `${cr.code} · ${c.name}`, description: `A creator campaign offer (${c.name}).`, type: 'fixed', value: cr.friendCents / 100,
      isActive: liveNow(c, now), limitOnePerCustomer: true, source: 'referrals', campaignId: c.id, creatorId: id, daysOfWeek: c.guard.days.length && c.guard.days.length < 7 ? c.guard.days : null,
      usageLimit: c.guard.maxUses || null, validFrom: c.start, validUntil: c.end ? iso(ms(c.end) + DAY - 1) : null, approvedBy: actor.name, approvedById: actor.id || null, approvedAt: iso(now),
      ...(cur ? {} : { createdAt: iso(now), usageCount: 0, usedByClientIds: [] }) }, { merge: true }); }
}
/** The offer for a friend of this creator right now: the live campaign's guarded discount, and which campaign it was. */
export async function campaignOffer(db: any, t: string, creatorId: string, cp?: string | null, now = Date.now()) {
  const docs = rows(await db.collection(COL(t)).where('creators', 'array-contains', creatorId).get()).map((d: any) => ({ c: campaignOf(d, d.id), d }));
  const [cid, pid] = String(cp || '').split('.');
  const pick = docs.find((x: any) => x.c.id === cid && liveNow(x.c, now)) || docs.filter((x: any) => liveNow(x.c, now)).sort((a: any, b: any) => ms(b.c.createdAt) - ms(a.c.createdAt))[0];
  if (!pick) return null;
  return { campaignId: pick.c.id, pieceId: pick.c.id === cid && pick.c.pieces.some((p: any) => p.id === pid) ? pid : null, discountId: `ccamp_${pick.c.id}_${creatorId}`.slice(0, 120), days: pick.c.guard.days };
}
/** A link open for a piece ("…/c/t/MAYA20?p=campaign.piece"). */
export async function countPieceOpen(db: any, t: string, creatorId: string, cp: string) {
  const [cid, pid] = String(cp || '').split('.'); if (!cid || !pid) return;
  const ref = db.doc(`${COL(t)}/${cid}`); const d: any = (await ref.get()).data(); if (!d || !(d.creators || []).includes(creatorId)) return;
  const k = `${creatorId}.${pid}`; await ref.set({ opens: { [k]: (Number(d.opens?.[k]) || 0) + 1 } }, { merge: true });
}

// ── The creator's side ───────────────────────────────────────────────────────────────
export async function creatorCampaigns(db: any, t: string, creatorId: string, base: string | null, now = Date.now()) {
  const cl: any = (await db.doc(`${T(t)}/clients/${creatorId}`).get()).data() || {}; const cr = creatorOf(cl.circle?.creator); if (!cr) return { ok: true, campaigns: [] };
  const docs = rows(await db.collection(COL(t)).where('creators', 'array-contains', creatorId).get()).map((d: any) => ({ c: campaignOf(d, d.id), d }))
    .filter((x: any) => x.c.status !== 'draft' && (!x.c.end || ms(x.c.end) + 30 * DAY > now)).sort((a: any, b: any) => ms(b.c.createdAt) - ms(a.c.createdAt));
  return { ok: true, campaigns: docs.map(({ c, d }: any) => ({ id: c.id, name: c.name, status: c.status, end: c.end, brief: c.brief, days: daysLabel(c.guard.days),
    earn: { feeCents: c.pay.feeCents, rewardCents: cr.rewardCents, cashCents: cr.pay === 'cash' ? cr.cashCents : 0, contentVisit: c.pay.contentVisit },
    code: cr.code, pieces: c.pieces.map((p: any, i: number) => ({ id: p.id, kind: p.kind, label: pieceLabel(p, i), due: p.due, hand: (d.hands || {})[handKey(creatorId, p.id)] || null,
      link: base ? `${base}/c/${encodeURIComponent(t)}/${cr.code}?p=${c.id}.${p.id}` : null })) })) };
}
export async function handIn(db: any, t: string, creatorId: string, b: any, now = Date.now()) {
  const ref = db.doc(`${COL(t)}/${String(b.campaignId || '').slice(0, 60)}`); const d: any = (await ref.get()).data(); if (!d) return { ok: false, error: 'That campaign isn’t here any more.' };
  const c = campaignOf(d, ref.id); if (!c.creators.includes(creatorId)) return { ok: false, error: 'This campaign isn’t yours.' };
  const p = c.pieces.find((x) => x.id === b.pieceId); if (!p) return { ok: false, error: 'That piece isn’t part of the campaign.' };
  const url = String(b.url || '').trim().slice(0, 600); if (!/^https:\/\/\S+\.\S+/.test(url)) return { ok: false, error: 'Please paste the link to your post.' };
  if (b.ad !== true) return { ok: false, error: 'Please confirm the post says it’s a paid partnership (#ad, or the partnership label).' };
  const k = handKey(creatorId, p.id); const cur: Hand | undefined = (d.hands || {})[k];
  if (cur?.status === 'approved') return { ok: false, error: 'This one is already approved.' };
  const hand: Hand = { status: 'submitted', url, shot: /^https:\/\//.test(String(b.shot || '')) ? String(b.shot) : (cur?.shot || null), clip: /^https:\/\//.test(String(b.clip || '')) ? String(b.clip).slice(0, 600) : null,
    views: Number.isFinite(Number(b.views)) && Number(b.views) > 0 ? Math.round(Number(b.views)) : null, ad: true, rights: b.rights === true, note: null, at: iso(now), late: !!p.due && now > ms(p.due) + DAY };
  await ref.set({ hands: { [k]: hand } }, { merge: true }); return { ok: true, hand };
}
export async function reviewHand(db: any, t: string, b: any, actor: { name: string }, now = Date.now()) {
  const ref = db.doc(`${COL(t)}/${String(b.campaignId || '').slice(0, 60)}`); const d: any = (await ref.get()).data(); if (!d) return { ok: false, error: 'That campaign isn’t here any more.' };
  const c = campaignOf(d, ref.id); const k = handKey(String(b.creatorId || ''), String(b.pieceId || '')); const h: Hand | undefined = (d.hands || {})[k]; if (!h) return { ok: false, error: 'Nothing has been handed in for this yet.' };
  const ok = b.decision === 'approve'; const note = String(b.note || '').trim().slice(0, 400) || null;
  if (!ok && !note) return { ok: false, error: 'Please say what to change, so they know.' };
  await ref.set({ hands: { [k]: { ...h, status: ok ? 'approved' : 'changes', note, decidedAt: iso(now), decidedBy: actor.name, ...(ok ? { feeCents: c.pay.feeCents, paidAt: c.pay.feeCents > 0 ? null : iso(now) } : {}) } } }, { merge: true });
  const cl: any = (await db.doc(`${T(t)}/clients/${b.creatorId}`).get()).data();
  if (cl?.phone && !cl.smsOptOut && cl.smsConsent !== false) { const p = c.pieces.find((x) => x.id === b.pieceId); const label = p ? pieceLabel(p, c.pieces.indexOf(p)) : 'your piece';
    try { const { sendNotification } = await import('@/lib/notify'); await sendNotification(db, { tenantId: t, channel: 'sms', to: String(cl.phone), kind: 'referral_update', clientId: b.creatorId, clientName: cl.name || null, recipientType: 'client', recipientId: b.creatorId,
      text: ok ? `Hi ${firstOf(cl.name) || 'there'}, your ${label.toLowerCase()} for “${c.name}” is approved. Thank you!${c.pay.feeCents ? ` ${dollars(c.pay.feeCents)} is on its way to you.` : ''}` : `Hi ${firstOf(cl.name) || 'there'}, one small change on your ${label.toLowerCase()} for “${c.name}”: ${note} You can hand it in again from your visit link.` } as any); } catch { /* it shows in their link either way */ } }
  return { ok: true };
}
/** Approved piece fees not paid yet, per creator (shown with cash owed; marked paid together). */
export async function feesOwed(db: any, t: string) {
  const out = new Map<string, number>();
  for (const d of rows(await db.collection(COL(t)).get())) for (const [k, h] of Object.entries(d.hands || {}) as [string, Hand][]) if (h.status === 'approved' && Number(h.feeCents) > 0 && !h.paidAt) { const id = k.split('__')[0]; out.set(id, (out.get(id) || 0) + Number(h.feeCents)); }
  return out;
}
export async function markFeesPaid(db: any, t: string, creatorId: string, method: string, actor: { name: string }, now = Date.now()) {
  let paid = 0;
  for (const d of rows(await db.collection(COL(t)).where('creators', 'array-contains', creatorId).get())) { const patch: any = {};
    for (const [k, h] of Object.entries(d.hands || {}) as [string, Hand][]) if (k.startsWith(`${creatorId}__`) && h.status === 'approved' && Number(h.feeCents) > 0 && !h.paidAt) { patch[k] = { ...h, paidAt: iso(now), paidBy: actor.name, paidMethod: method }; paid += Number(h.feeCents); }
    if (Object.keys(patch).length) await db.doc(`${COL(t)}/${d.id}`).set({ hands: patch }, { merge: true }); }
  return paid;
}

// ── Every pass: reminders, late marks, and the cost guard ────────────────────────────
export async function campaignSweep(db: any, t: string, tenant: any, now = Date.now()) {
  let reminded = 0, paused = 0;
  const refs = rows(await db.collection(`${T(t)}/referrals`).get());
  for (const d of rows(await db.collection(COL(t)).where('status', '==', 'live').get())) {
    const c = campaignOf(d, d.id); const sent: Record<string, boolean> = d.reminded || {}; const patch: any = {};
    for (const cid of c.creators) for (const p of c.pieces) { if (!p.due) continue; const h: Hand | undefined = (d.hands || {})[handKey(cid, p.id)]; if (h && h.status !== 'changes') continue;
      const left = ms(p.due) - now; const which = left < 0 ? null : left <= 1.2 * DAY ? '1' : left <= 3.2 * DAY ? '3' : null; const key = `${cid}.${p.id}.${which}`;
      if (!which || sent[key]) continue; patch[key] = true;
      const cl: any = (await db.doc(`${T(t)}/clients/${cid}`).get()).data(); if (!cl?.phone || cl.smsOptOut || cl.smsConsent === false) continue;
      try { const { sendNotification } = await import('@/lib/notify'); await sendNotification(db, { tenantId: t, channel: 'sms', to: String(cl.phone), kind: 'referral_update', clientId: cid, clientName: cl.name || null, recipientType: 'client', recipientId: cid,
        text: `Hi ${firstOf(cl.name) || 'there'}, a friendly reminder: your ${pieceLabel(p, c.pieces.indexOf(p)).toLowerCase()} for “${c.name}” is due ${which === '1' ? 'tomorrow' : 'in 3 days'}. Hand it in from your visit link when it’s up.` } as any); reminded++; } catch { /* next pass */ } }
    if (Object.keys(patch).length) await db.doc(`${COL(t)}/${c.id}`).set({ reminded: patch }, { merge: true });
    // The guard: past the top cost per new client (after 2+ paid first visits) or over budget, the offer pauses.
    const st = stats(c, d, refs);
    const over = (c.guard.capCents && st.paidFirst >= 2 && st.costCents / st.paidFirst > c.guard.capCents) ? `Cost per new client reached ${dollars(Math.round(st.costCents / st.paidFirst))}, past your ${dollars(c.guard.capCents)}.`
      : (c.guard.budgetCents && st.costCents >= c.guard.budgetCents) ? `It reached its ${dollars(c.guard.budgetCents)} budget.` : null;
    if (over && !c.paused) { await db.doc(`${COL(t)}/${c.id}`).set({ paused: { at: iso(now), why: over } }, { merge: true });
      for (const cid of c.creators) await db.doc(`${T(t)}/discounts/${`ccamp_${c.id}_${cid}`.slice(0, 120)}`).set({ isActive: false }, { merge: true }); paused++; }
    if (c.end && ms(c.end) + 7 * DAY < now) await db.doc(`${COL(t)}/${c.id}`).set({ status: 'done' }, { merge: true });
  }
  void tenant; return { ok: true, reminded, paused };
}

// ── Scorecards: every creator judged like an ad channel ─────────────────────────────
export async function scorecards(db: any, t: string, months = 6, now = Date.now()) {
  const since = now - months * 30 * DAY;
  const refs = rows(await db.collection(`${T(t)}/referrals`).get());
  const creators = rows(await db.collection(`${T(t)}/clients`).where('circle.creator.code', '>=', '').get()).filter((x: any) => creatorOf(x.circle?.creator));
  const creatorIds = new Set(creators.map((x: any) => x.id));
  const ap = rows(await db.collection(`${T(t)}/appointments`).where('startTime', '>=', iso(now - 400 * DAY)).get()).filter((a: any) => DONE.includes(String(a.status || '')) && a.clientId && !a.isRenterBooking);
  const visits = new Map<string, any[]>(); for (const a of ap) { const k = String(a.clientId); if (!visits.has(k)) visits.set(k, []); visits.get(k)!.push(a); }
  for (const l of visits.values()) l.sort((x, y) => ms(x.startTime) - ms(y.startTime));
  const camps = rows(await db.collection(COL(t)).get());
  const fees = new Map<string, number>(); const onTime = new Map<string, [number, number]>();
  for (const d of camps) { const c = campaignOf(d, d.id); for (const cid of c.creators) for (const p of c.pieces) { if (!p.due || ms(p.due) > now) continue; const h: Hand | undefined = (d.hands || {})[handKey(cid, p.id)];
    const ot = onTime.get(cid) || [0, 0]; ot[1]++; if (h && !h.late && ms(h.at) <= ms(p.due) + DAY) ot[0]++; onTime.set(cid, ot);
    if (h?.status === 'approved' && ms(h.decidedAt) >= since) fees.set(cid, (fees.get(cid) || 0) + (Number(h.feeCents) || 0)); } }
  const sixMonthSpend = (cid: string) => { const l = visits.get(cid) || []; if (!l.length) return null; const t0 = ms(l[0].startTime); return Math.round(l.filter((x) => ms(x.startTime) - t0 < 183 * DAY).reduce((n, x) => n + money(x), 0) * 100); };
  const cards = creators.map((cl: any) => { const cr = creatorOf(cl.circle?.creator)!; const mine = refs.filter((r: any) => r.referrerId === cl.id && r.status === 'rewarded' && ms(r.rewardedAt) >= since);
    const friends = mine.map((r: any) => String(r.friendClientId)).filter(Boolean);
    const settled = friends.filter((f: string) => { const l = visits.get(f) || []; return l.length && now - ms(l[0].startTime) > 30 * DAY; });
    const back = settled.length ? settled.filter((f: string) => (visits.get(f) || []).length >= 2).length / settled.length : null;
    const spend = friends.reduce((n: number, f: string) => n + Math.round((visits.get(f) || []).reduce((m: number, x: any) => m + money(x), 0) * 100), 0);
    const cost = (fees.get(cl.id) || 0) + mine.reduce((n: number, r: any) => n + (Number(r.rewardCents) || 0) + (Number(r.cashOwedCents) || 0) + (Number(r.offerCents) || cr.friendCents), 0);
    const ot = onTime.get(cl.id);
    const s = { paidFirst: mine.length, costCents: cost, comeBack: back, spendCents: spend, onTime: ot && ot[1] ? ot[0] / ot[1] : null };
    return { clientId: cl.id, name: cl.name || 'Creator', code: cr.code, handle: cr.handle, ...s, perClientCents: mine.length ? Math.round(cost / mine.length) : null, returnX: cost > 0 ? Math.round((spend / cost) * 10) / 10 : null, ...scoreTag(s) }; })
    .sort((a: any, b: any) => (b.returnX || 0) - (a.returnX || 0) || b.paidFirst - a.paidFirst);
  // Which pieces brought clients.
  const pieces: any[] = [];
  for (const d of camps) { const c = campaignOf(d, d.id); for (const [k, h] of Object.entries(d.hands || {}) as [string, Hand][]) { if (h.status !== 'approved') continue; const [cid, pid] = k.split('__'); const p = c.pieces.find((x) => x.id === pid); if (!p) continue;
    const cl = creators.find((x: any) => x.id === cid); pieces.push({ campaign: c.name, creator: short(cl?.name), label: pieceLabel(p, c.pieces.indexOf(p)), url: h.url, shot: h.shot, views: h.views, rights: h.rights,
      opens: Number((d.opens || {})[`${cid}.${pid}`]) || 0, clients: refs.filter((r: any) => r.campaignId === c.id && r.pieceId === pid && r.referrerId === cid && r.status === 'rewarded').length }); } }
  // Are they good clients? Spend over a first 6 months, by how they found you (people who started 6–12 months ago).
  const firstOf2 = new Map<string, number>(); for (const [k, l] of visits) firstOf2.set(k, ms(l[0].startTime));
  const cohort = (pred: (cid: string) => boolean) => { const xs = [...firstOf2.entries()].filter(([k, t0]) => now - t0 > 183 * DAY && now - t0 < 365 * DAY && pred(k)).map(([k]) => sixMonthSpend(k) || 0); return xs.length ? { cents: Math.round(xs.reduce((n, x) => n + x, 0) / xs.length), n: xs.length } : null; };
  const friendOf = new Map<string, string>(); for (const r of refs) if (r.status === 'rewarded' && r.friendClientId) friendOf.set(String(r.friendClientId), String(r.referrerId));
  const sources = [{ label: 'Friend referrals', v: cohort((k) => friendOf.has(k) && !creatorIds.has(friendOf.get(k)!)) }, { label: 'Creators', v: cohort((k) => friendOf.has(k) && creatorIds.has(friendOf.get(k)!)) }, { label: 'Everyone else', v: cohort((k) => !friendOf.has(k)) }].filter((x) => x.v);
  const tot = cards.reduce((a: any, c: any) => ({ cost: a.cost + c.costCents, paid: a.paid + c.paidFirst, spend: a.spend + c.spendCents }), { cost: 0, paid: 0, spend: 0 });
  return { ok: true, months, totals: { costCents: tot.cost, paidFirst: tot.paid, perClientCents: tot.paid ? Math.round(tot.cost / tot.paid) : null, spendCents: tot.spend, returnX: tot.cost ? Math.round((tot.spend / tot.cost) * 10) / 10 : null },
    cards, pieces: pieces.sort((a, b) => b.clients - a.clients || b.opens - a.opens).slice(0, 12), sources };
}
export { plan };
