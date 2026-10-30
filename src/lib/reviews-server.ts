// src/lib/reviews-server.ts — REVIEWS ON THE SERVER (lib/reviews has the rules). Showing and hiding a review (with its
// reason, by someone whose role runs marketing), the business's review settings, the visit reviews a booking page shows,
// a customer's own reviews on their order page, and the review email after pickup or delivery.
// Reviews are written only here and by the routes that take them (api/retail/reviews, api/checkin/actions): no browser
// can change what a review says, its stars, or whether it shows (firestore.rules).
import { askHours, askVerdict, askWords, isHideReason, receivedAt, reviewableLines, reviewerName, reviewSettings, stateOf, visitState, ASK_STALE_DAYS, type ReviewKind, type ReviewState } from '@/lib/reviews';
import { hasTimeZone, tenantTimeZone } from '@/lib/tenant-time';
import { isFollowUp } from '@/lib/order-family';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';
import { unsubSig } from '@/lib/campaigns';
import { privacyOf } from '@/lib/health-privacy';
import { logAuditAdmin } from '@/lib/audit';

const DAY = 864e5;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const colOf = (kind: ReviewKind) => (kind === 'shop' ? 'retailReviews' : 'reviews');
const OPEN_CLAIM = ['in_review', 'needs_info', 'info_requested', 'open'];
const OPEN_RETURN = ['open', 'received'];

type Who = { id: string; name: string; role?: string };
const whoOf = (actor: any): Who => ({ id: String(actor?.uid || actor?.id || ''), name: String(actor?.name || 'A team member').slice(0, 80), role: String(actor?.role || '') });

/** Show or hide one review. Hiding needs a reason (lib/reviews HIDE_REASONS), kept with the review and its last changes. */
export async function setReviewState(db: any, tenantId: string, actor: any, input: { kind: unknown; id: unknown; to: unknown; reason?: unknown }):
  Promise<{ ok: true; state: ReviewState } | { ok: false; error: string; status: number }> {
  const kind = input.kind === 'visit' ? 'visit' : input.kind === 'shop' ? 'shop' : null;
  const id = String(input.id || '');
  const to = input.to === 'shown' ? 'shown' : input.to === 'hidden' ? 'hidden' : null;
  if (!kind || !ID.test(id) || !to) return { ok: false, error: 'Missing details.', status: 400 };
  if (to === 'hidden' && !isHideReason(input.reason)) return { ok: false, error: 'Choose why you’re hiding it.', status: 400 };
  const reason = to === 'hidden' ? String(input.reason) : null;
  const ref = db.doc(`tenants/${tenantId}/${colOf(kind)}/${id}`);
  const who = whoOf(actor); const at = new Date().toISOString();
  let summary = '';
  const out = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, error: 'That review isn’t there any more.', status: 404 };
    const r: any = snap.data() || {};
    if (stateOf(kind, r) === to && (to === 'shown' || r.hiddenReason === reason)) return { ok: true as const, state: to as ReviewState };
    const log = [...(Array.isArray(r.stateLog) ? r.stateLog : []), { to, reason, at, by: who }].slice(-10);
    const mark = to === 'shown'
      ? { shownAt: at, shownBy: who, hiddenReason: null, hiddenAt: null, hiddenBy: null, stateLog: log }
      : { hiddenReason: reason, hiddenAt: at, hiddenBy: who, stateLog: log, ...(kind === 'visit' ? { pinnedAt: null, pinnedBy: null } : {}) };
    if (kind === 'shop') tx.update(ref, { ...mark, status: to === 'shown' ? 'published' : 'hidden' });
    else tx.update(ref, { ...mark, isPublic: to === 'shown', hidden: to === 'hidden', ...(to === 'hidden' ? { isFeatured: false } : {}) });
    summary = `${to === 'shown' ? 'Showed' : 'Hid'} a ${Math.round(Number(r.rating) || 0)}-star ${kind === 'shop' ? 'shop' : 'visit'} review from ${String(r.author || r.clientName || 'a customer').slice(0, 60)}`;
    return { ok: true as const, state: to as ReviewState };
  });
  if (out.ok && summary) {
    try {
      await logAuditAdmin(db, tenantId, { action: to === 'shown' ? 'review.shown' : 'review.hidden', targetType: 'review', targetId: id, summary: reason ? `${summary} (${reason})` : summary, actor: { type: 'user', id: who.id, name: who.name, role: who.role } } as any);
    } catch { /* the change itself is kept on the review */ }
  }
  return out;
}

/** Pin a shown visit review to the top of the booking page's reviews, or unpin it. */
export async function setReviewPinned(db: any, tenantId: string, actor: any, input: { id: unknown; on: unknown }):
  Promise<{ ok: true; pinned: boolean } | { ok: false; error: string; status: number }> {
  const id = String(input.id || ''); const on = input.on === true;
  if (!ID.test(id)) return { ok: false, error: 'Missing details.', status: 400 };
  const ref = db.doc(`tenants/${tenantId}/reviews/${id}`); const who = whoOf(actor);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, error: 'That review isn’t there any more.', status: 404 };
    const r: any = snap.data() || {};
    if (on && visitState(r) !== 'shown') return { ok: false as const, error: 'Show it first, then pin it.', status: 409 };
    tx.update(ref, { isFeatured: on, pinnedAt: on ? new Date().toISOString() : null, pinnedBy: on ? who : null });
    return { ok: true as const, pinned: on };
  });
}

/** A new review is waiting to be shown: the owner and the people whose role runs marketing hear about it, so nothing
 *  sits unseen (a review left waiting is kept off the page the same as one hidden). */
export async function tellWaiting(db: any, tenantId: string, r: { kind: ReviewKind; rating: number; who: string; what: string; changed?: boolean; hidden?: boolean }) {
  try {
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const { can } = await import('@/lib/permissions');
    const staff = (await db.collection(`tenants/${tenantId}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((s: any) => s.archived !== true && s.isActive !== false && s.role !== 'renter' && can(t, s, 'marketing.manage'));
    const to = [...new Set([t.userId, ...staff.map((s: any) => s.id)].filter(Boolean))].slice(0, 20) as string[];
    if (!to.length) return;
    const b = db.batch(); const now = new Date().toISOString();
    const of = r.what ? ` of ${r.what}` : '';
    const message = r.hidden ? `${r.who} changed the review${of} you hid (now ${Math.round(r.rating)} stars). Look again: the reason you hid it may be gone.`
      : r.changed ? `${r.who} changed their review${of} (now ${Math.round(r.rating)} stars). It shows again once you choose Show.`
      : `${r.who} left a ${Math.round(r.rating)}-star review${of}. It shows once you choose Show.`;
    for (const u of to) { const n = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(n, { id: n.id, userId: u, type: 'review_waiting', title: r.hidden ? 'A hidden review was changed' : r.changed ? 'A changed review is waiting for you' : 'A review is waiting for you', message, link: `/reviews?tab=${r.kind === 'shop' ? 'shop' : 'visits'}`, createdAt: now, read: false }); }
    await b.commit();
  } catch { /* the review itself is saved; the screen shows it waiting */ }
}

/** Change the business's review settings. Turning the ask on starts from now: orders received before then aren't asked. */
export async function saveReviewSettings(db: any, tenantId: string, patch: { shopAutoShow?: unknown; visitAutoShow?: unknown; askOn?: unknown; askDays?: unknown }) {
  const ref = db.doc(`tenants/${tenantId}`);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, error: 'Business not found.' };
    const t: any = snap.data() || {}; const cur = reviewSettings(t); const now = new Date().toISOString();
    const up: Record<string, any> = {};
    if (typeof patch.shopAutoShow === 'boolean') up['retailSettings.reviewsAutoPublish'] = patch.shopAutoShow;
    if (typeof patch.visitAutoShow === 'boolean') up['reviewSettings.visitsAutoShow'] = patch.visitAutoShow;
    if (typeof patch.askOn === 'boolean' || patch.askDays !== undefined) {
      const on = typeof patch.askOn === 'boolean' ? patch.askOn : cur.ask.on;
      const d = Math.round(Number(patch.askDays));
      const days = [1, 3, 7].includes(d) ? d : cur.ask.days;
      up['retailSettings.reviewAsk'] = { on, days, onAt: on ? (cur.ask.on && cur.ask.onAt ? cur.ask.onAt : now) : cur.ask.onAt };
    }
    if (!Object.keys(up).length) return { ok: true as const, settings: cur };
    tx.update(ref, up);
    const next = reviewSettings({
      ...t,
      retailSettings: { ...(t.retailSettings || {}), ...('retailSettings.reviewsAutoPublish' in up ? { reviewsAutoPublish: up['retailSettings.reviewsAutoPublish'] } : {}), ...('retailSettings.reviewAsk' in up ? { reviewAsk: up['retailSettings.reviewAsk'] } : {}) },
      reviewSettings: { ...(t.reviewSettings || {}), ...('reviewSettings.visitsAutoShow' in up ? { visitsAutoShow: up['reviewSettings.visitsAutoShow'] } : {}) },
    });
    return { ok: true as const, settings: next };
  });
}

/** The visit reviews a booking page shows: the ones the business chose to show, pinned ones first, then the newest.
 *  First name and last initial only, and nothing about the client's record. */
export async function publicVisitReviews(db: any, tenantId: string) {
  const snap = await db.collection(`tenants/${tenantId}/reviews`).where('isPublic', '==', true).limit(1000).get();
  // Every shown review counts toward the stars; the ones with words are the ones listed.
  const all = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((r: any) => r.hidden !== true && Number(r.rating) >= 1);
  const rows = all.filter((r: any) => String(r.text || '').trim());
  const count = all.length;
  const average = count ? Math.round((all.reduce((s: number, r: any) => s + Math.min(5, Math.max(1, Number(r.rating))), 0) / count) * 10) / 10 : 0;
  const staffIds = [...new Set(rows.map((r: any) => String(r.staffId || '')).filter((s: string) => ID.test(s)))].slice(0, 40) as string[];
  const names: Record<string, string> = {};
  if (staffIds.length) {
    try {
      const ss = await db.getAll(...staffIds.map((s) => db.doc(`tenants/${tenantId}/staff/${s}`)));
      ss.forEach((s: any, i: number) => { const n = String((s.exists && (s.data()?.preferredName || s.data()?.name)) || '').trim().split(/\s+/)[0]; if (n) names[staffIds[i]] = n; });
    } catch { /* no names, still the reviews */ }
  }
  const reviews = rows
    .sort((a: any, b: any) => Number(b.isFeatured === true) - Number(a.isFeatured === true) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 24)
    .map((r: any) => ({ id: r.id, rating: Math.min(5, Math.max(1, Math.round(Number(r.rating)))), text: String(r.text).slice(0, 1200), name: reviewerName(r.clientName, 'A client'),
      service: String(r.serviceName || '').slice(0, 80), staff: names[String(r.staffId || '')] || '', at: String(r.createdAt || '') }));
  return { average, count, reviews };
}

/** The customer's own reviews of what's on this order, for their order page (what they wrote, so they can change it). */
export async function orderReviews(db: any, tenantId: string, orderId: string, order: any) {
  const lines = reviewableLines(order).slice(0, 30);
  if (!lines.length) return {};
  const snaps = await db.getAll(...lines.map((l) => db.doc(`tenants/${tenantId}/retailReviews/${orderId}__${l.productId}`)));
  const out: Record<string, { rating: number; title: string; body: string }> = {};
  snaps.forEach((s: any, i: number) => { if (s.exists) { const r = s.data() || {}; out[lines[i].productId] = { rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 0))), title: String(r.title || ''), body: String(r.body || '') }; } });
  return out;
}

/* ── THE REVIEW EMAIL ───────────────────────────────────────────────────────────────────────────────────────────── */

/** What decides an order's ask that isn't on the order itself: an open problem report or return, someone who
 *  unsubscribed, and what they've already reviewed. */
async function askContext(db: any, tenantId: string, orderId: string, order: any) {
  const T = `tenants/${tenantId}`;
  const [claims, returns, client, reviews] = await Promise.all([
    db.collection(`${T}/retailClaims`).where('orderId', '==', orderId).limit(20).get().catch(() => ({ docs: [] })),
    db.collection(`${T}/retailReturns`).where('orderId', '==', orderId).limit(20).get().catch(() => ({ docs: [] })),
    order.clientId && ID.test(String(order.clientId)) ? db.doc(`${T}/clients/${order.clientId}`).get().catch(() => null) : null,
    db.collection(`${T}/retailReviews`).where('orderId', '==', orderId).limit(40).get().catch(() => ({ docs: [] })),
  ]);
  const openProblem = claims.docs.some((d: any) => OPEN_CLAIM.includes(String(d.data()?.status || '')))
    || returns.docs.some((d: any) => OPEN_RETURN.includes(String(d.data()?.status || '')));
  const c: any = client && client.exists ? client.data() || {} : {};
  // Unsubscribed (for good), or a client the business archived or deleted (not while they are; campaigns skip them too).
  const optedOut = c.marketingOptOut === true;
  const archived = c.archived === true;
  const reviewed = new Set<string>(reviews.docs.map((d: any) => String(d.data()?.productId || '')).filter(Boolean));
  return { openProblem, optedOut: optedOut || c.deleted === true, archived, reviewed };
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** "Oct 22", where the business is. */
function dayWords(ms: number, zone: string) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).format(new Date(ms)); }
  catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(ms)); }
}

/** The business's address for the email's footer (an email asking for something carries where the sender is). */
function addressOf(t: any): string {
  const a = t?.address && (typeof t.address === 'string' ? t.address.trim() : Object.keys(t.address).length) ? t.address : t?.studioAddressParts;
  if (typeof a === 'string') return a.trim().slice(0, 200);
  if (!a || typeof a !== 'object') return '';
  return [a.street || a.line1, a.line2, a.city, [a.state, a.zip || a.postalCode].filter(Boolean).join(' ')].map((x: any) => String(x || '').trim()).filter(Boolean).join(', ') || String(a.formatted || '').slice(0, 200);
}

/** Ask for reviews of the orders that are due: at most `cap` a run, within `budgetMs`, only during the day where the
 *  business is (and never when it hasn't set where that is). Returns how many were sent. */
export async function sweepReviewAsks(db: any, tenantId: string, tenant: any, origin: string, o: { now?: number; cap?: number; budgetMs?: number } = {}): Promise<number> {
  const now = o.now ?? Date.now(); const cap = o.cap ?? 40; const until = Date.now() + (o.budgetMs ?? 15e3);
  const S = reviewSettings(tenant);
  if (!S.ask.on || !origin) return 0;
  try { if (privacyOf(tenant).discreet) return 0; } catch { /* not discreet */ }
  if (!hasTimeZone(tenant)) return 0;
  const zone = tenantTimeZone(tenant);
  if (!askHours(now, zone)) return 0;
  // Once an hour is plenty (the cron runs every five minutes).
  const markRef = db.doc(`tenants/${tenantId}/counters/reviewAsk`);
  const go = await db.runTransaction(async (tx: any) => {
    const m: any = (await tx.get(markRef)).data() || {};
    if (now - Date.parse(String(m.sweptAt || '')) < 55 * 60e3) return false;
    tx.set(markRef, { sweptAt: new Date(now).toISOString() }, { merge: true });
    return true;
  });
  if (!go) return 0;
  const shop = String(tenant?.businessName || tenant?.name || 'The shop');
  const addr = addressOf(tenant);
  const iso = (ms: number) => new Date(ms).toISOString();
  let sent = 0;

  const one = async (d: any) => {
    const order: any = { ...(d.data() || {}), id: d.id };
    const followUp = isFollowUp(order);
    const held = order.reviewAsk?.state === 'held';
    // Held for a problem: looked at again once a day, wherever it turns up.
    if (held && now - Date.parse(String(order.reviewAsk?.at || '')) <= DAY) return;
    // An order held for a problem that can no longer be asked (too late now, canceled, the ask turned off a while):
    // finished with, so it stops coming back.
    const done = async (why: string) => { if (held) await d.ref.update({ reviewAsk: { state: 'skipped', why, at: iso(now) } }).catch(() => {}); };
    // What the order alone says first: most orders are settled here without another read.
    const first = askVerdict(order, { ask: S.ask, now, timeZone: zone, followUp });
    if ('never' in first) { await done(first.never); return; }
    if (!('send' in first)) return;
    // A lost parcel and its replacement are one purchase, asked about once: the replacement, unless the original turned
    // up and was asked about first, and the original only if its replacement wasn't.
    let originalArrived = false;
    const linked = order.replacementFor === 'lost_in_transit' ? String(order.parentOrderId || '') : String(order.replacementOrderId || '');
    if (ID.test(linked)) {
      const other: any = (await db.doc(`tenants/${tenantId}/retailOrders/${linked}`).get().catch(() => null))?.data?.() || null;
      if (order.replacementFor === 'lost_in_transit') {
        originalArrived = !!other && (!!receivedAt(other) || other.reviewAsk?.state === 'sent');
        if (originalArrived) { await d.ref.update({ reviewAsk: { state: 'skipped', why: 'original_asked', at: iso(now) } }).catch(() => {}); return; }
      }
      else if (other?.reviewAsk?.state === 'sent' || other?.reviewAsk?.state === 'sending') { await d.ref.update({ reviewAsk: { state: 'skipped', why: 'replacement_asked', at: iso(now) } }).catch(() => {}); return; }
    }
    const ctx = await askContext(db, tenantId, d.id, order);
    const v = askVerdict(order, { ask: S.ask, now, timeZone: zone, followUp, originalArrived, ...ctx });
    if ('never' in v) {
      if (v.never === 'unsubscribed' || v.never === 'reviewed') await d.ref.update({ reviewAsk: { state: 'skipped', why: v.never, at: iso(now) } }).catch(() => {});
      else await done(v.never);
      return;
    }
    if ('wait' in v) {
      // Waiting on a problem report or a return: marked (once a day), so the cutoff counts from when it's settled.
      if (v.wait === 'open_problem' && (!held || now - Date.parse(String(order.reviewAsk?.at || '')) > DAY)) await d.ref.update({ reviewAsk: { state: 'held', at: iso(now), tries: Number(order.reviewAsk?.tries || 0) } }).catch(() => {});
      return;
    }
    // Claimed first, so two runs can't both send it.
    const claimed = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(d.ref)).data() || {};
      const again = askVerdict({ ...cur, id: d.id }, { ask: S.ask, now, timeZone: zone, followUp, originalArrived, ...ctx });
      if (!('send' in again)) return null;
      const tries = Number(['failed', 'held'].includes(String(cur.reviewAsk?.state)) ? cur.reviewAsk?.tries || 0 : 0) + 1;
      tx.update(d.ref, { reviewAsk: { state: 'sending', at: iso(now), tries } });
      return { tries };
    });
    if (!claimed) return;
    const items = reviewableLines(order).filter((l) => !ctx.reviewed.has(l.productId)).map((l) => l.name);
    const num = String(order.orderNumber ?? '').padStart(4, '0');
    const how = order.method === 'delivery' || order.method === 'ship' ? 'delivered' as const : 'picked up' as const;
    const w = askWords({ first: String(order.customerName || '').trim().split(/\s+/)[0] || '', shop, orderNumber: num, how, on: dayWords(receivedAt(order), zone), items });
    const link = `${origin}/shop/${encodeURIComponent(tenantId)}/order/${encodeURIComponent(d.id)}?review=1#review`;
    const unsub = `${origin}/api/campaigns/unsubscribe?t=${encodeURIComponent(tenantId)}&c=${encodeURIComponent(String(order.clientId))}&s=${await unsubSig(tenantId, String(order.clientId))}`;
    const list = `<ul style="margin:4px 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#334155;">${items.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
    const small = `<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#64748b;">${esc(w.how)}</p><p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#64748b;">${esc(w.once)} <a href="${esc(unsub)}" style="color:#334155;">Unsubscribe</a> ${esc(w.unsub)}</p>`;
    const foot = `You’re receiving this because you bought from ${shop}.${addr ? ` ${shop}, ${addr}.` : ''}`;
    const html = brandedEmailHtml({ studioName: shop, title: w.title, bodyLines: [w.intro], bodyHtml: list, cta: { label: w.cta, url: link }, afterCtaHtml: small, footerNote: foot });
    const text = [w.intro, '', ...items.map((n) => `- ${n}`), '', `${w.cta}: ${link}`, '', w.how, '', w.once, `Unsubscribe ${w.unsub} ${unsub}`, '', foot].join('\n');
    let ok = false; let error = '';
    try {
      const r: any = await sendNotification(db, { tenantId, channel: 'email', to: String(order.customerEmail), subject: w.subject, html, text, kind: 'review_ask', clientId: String(order.clientId), clientName: String(order.customerName || '') || null, recipientType: 'client' } as any);
      ok = !!r?.ok; if (!ok) error = String(r?.reason || r?.error || 'not sent').slice(0, 120);
    } catch (e: any) { error = String(e?.message || e).slice(0, 120); }
    const at = iso(now);
    // If this last write doesn't land, the order stays "sending" and is never asked again (lib/reviews askVerdict).
    await d.ref.update({ reviewAsk: ok ? { state: 'sent', at, sentAt: at, tries: claimed.tries } : { state: 'failed', at, tries: claimed.tries, error } }).catch(() => {});
    if (ok) {
      sent++;
      try { const ev = d.ref.collection('events').doc(); await ev.set({ id: ev.id, type: 'note', at, actorId: 'system', actorName: 'Automatic', meta: { kind: 'review_ask', text: 'Asked for a review by email' } }); } catch { /* the ask is recorded on the order */ }
    }
  };

  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const seen = new Set<string>();
  const run = async (docs: any[], by = until) => { for (const d of docs) { if (sent >= cap || Date.now() >= by) return; if (seen.has(d.id)) continue; seen.add(d.id); await one(d); } };
  // Held by a problem, however long ago they arrived: each looked at again once a day (the day after it was marked),
  // with no more than a third of the time, so they can't crowd out the orders that are due now.
  const heldDocs = (await col.where('reviewAsk.state', '==', 'held').limit(500).get().catch(() => ({ docs: [] }))).docs
    .filter((d: any) => now - Date.parse(String(d.data()?.reviewAsk?.at || '')) > DAY);
  await run(heldDocs, Date.now() + (until - Date.now()) / 3);
  // Then everything that could be due, newest first, a page at a time: finished (or shipped) between the cutoff and
  // the number of days the business waits.
  const since = iso(now - (ASK_STALE_DAYS + 15) * DAY); const upto = iso(now - S.ask.days * DAY);
  const PAGE = 250; let last: any = null;
  for (let i = 0; i < 12 && sent < cap && Date.now() < until; i++) {
    let q = col.where('completedAt', '>=', since).where('completedAt', '<=', upto).orderBy('completedAt', 'desc').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    await run(snap.docs);
    if (snap.docs.length < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return sent;
}
