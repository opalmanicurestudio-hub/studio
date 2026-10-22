// src/lib/label-sweep.ts — POSTAGE NOBODY USED, BACK IN THE SHOP'S POCKET. Server only.
// Shippo refunds an unused label only when someone asks (within 90 days), and a USPS label stops working after 30.
// Every morning (api/cron/shipping-checks), for labels bought in the last 90 days, in this order:
//   1. a void whose outcome isn't known (it was cut off, or Shippo never answered) is finished while the box still
//      isn't going anywhere; otherwise it's listed under Needs you
//   2. a cancelled or refunded order's label is voided
//   3. a label not scanned for a few days is listed under Needs you, so someone looks for the box (never voided)
//   4. a packed order's label the carrier has never scanned after 28 days is voided (it's about to stop working)
// Shipped orders are only ever listed, never voided: the box may well be out there.
//
// NOTHING IS VOIDED ON A GUESS. Before any automatic void the carrier's own tracking must show the label as created
// and nothing more (every status PRE_TRANSIT). "Not found", a lookup that fails, or a carrier we can't look up all
// count as unknown, and unknown is left alone. A label on a USPS form, or one shared by orders shipped together, is
// never voided automatically. A staff member voiding by hand gets the gentler test: refused only if the carrier has
// scanned it, and a shared label comes off every order in its box.
// A void about to start is written down first, and the note comes off as soon as Shippo answers either way, so it's
// only left behind when the outcome isn't known. A void that's turned down (the tracking can't confirm the label is
// unused, or Shippo said no) is tried again after 1, 2 and 4 days, then listed under Needs you for someone to decide.
import { LABEL_CLEARED, SHARED_CLEARED, voidOrderLabels } from '@/lib/label-void';
import { trailStatus } from '@/lib/label-doubt';

const SHIPPO = 'https://api.goshippo.com';
const DAY = 86400e3;
const SCANNED = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];
const GONE = ['shipped', 'handed_off', 'completed'];
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };

// Shippo's codes for the carriers' tracking. A carrier not listed here is never looked up (so never voided by us).
const CODES: [RegExp, string][] = [
  [/\busps\b/i, 'usps'], [/\bups\b/i, 'ups'], [/fedex/i, 'fedex'], [/dhl\s*e-?commerce/i, 'dhl_ecommerce'], [/dhl/i, 'dhl_express'],
  [/ontrac/i, 'ontrac'], [/lasership/i, 'lasership'], [/canada\s*post/i, 'canada_post'], [/purolator/i, 'purolator'],
];
export function trackingCarrier(carrier: unknown): string | null {
  const c = String(carrier || '');
  for (const [re, code] of CODES) if (re.test(c)) return code;
  return null;
}

export type LabelState = 'moving' | 'pre' | 'unknown';

/** What the carrier says about one tracking number: moving (scanned), pre (label created, nothing more), or unknown. */
export async function trackState(apiKey: string, carrier: unknown, number: string): Promise<LabelState> {
  const code = trackingCarrier(carrier);
  if (!apiKey || !number || !code) return 'unknown';
  try {
    const r = await fetch(`${SHIPPO}/tracks/${encodeURIComponent(code)}/${encodeURIComponent(number)}`, { headers: { Authorization: `ShippoToken ${apiKey}` }, signal: timeout(10000) });
    if (!r.ok) return 'unknown';
    const d: any = await r.json().catch(() => null);
    if (!d) return 'unknown';
    const statuses = [d.tracking_status?.status, ...(Array.isArray(d.tracking_history) ? d.tracking_history.map((h: any) => h?.status) : [])]
      .map((s) => String(s || '').toUpperCase()).filter(Boolean);
    if (statuses.some((s) => SCANNED.includes(s))) return 'moving';
    if (statuses.length && statuses.every((s) => s === 'PRE_TRANSIT')) return 'pre';
    return 'unknown';
  } catch { return 'unknown'; }
}

/** Every box of the order: moving if any box was scanned; pre only if every box is label-created and nothing more. */
export async function labelState(apiKey: string, order: any): Promise<LabelState> {
  if (SCANNED.includes(trailStatus(order))) return 'moving';
  if (Object.values(order?.boxStatus || {}).some((s: any) => SCANNED.includes(String(s).toUpperCase()))) return 'moving';
  if (order?.labelSeenMoving) return 'moving';
  const numbers = [order?.trackingNumber, ...(Array.isArray(order?.extraTrackingNumbers) ? order.extraTrackingNumbers : [])].map((x: any) => String(x || '').trim()).filter(Boolean);
  if (!numbers.length) return 'unknown';
  let all = true;
  for (const n of numbers) {
    const s = await trackState(apiKey, order.carrier, n);
    if (s === 'moving') return 'moving';
    if (s !== 'pre') all = false;
  }
  return all ? 'pre' : 'unknown';
}

/** Strict: the carrier shows every box as created and nothing more. */
export async function neverScanned(apiKey: string, order: any): Promise<boolean> {
  return (await labelState(apiKey, order)) === 'pre';
}

const CLOSED = ['cancelled', 'refunded'];
const shared = (o: any) => Array.isArray(o?.shippedWithOrderIds) && o.shippedWithOrderIds.length > 0;
const orderNo = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;
const scannedOnRecord = (o: any) => !!o?.labelSeenMoving || SCANNED.includes(trailStatus(o));

/** Put under Needs you (orders-view needsYou, OrderPanel): `why` says which card. The whole note is written, so nothing
 *  from an earlier one (a dismissal, say) carries over. */
function listed(o: any, at: string, why: 'void_unfinished' | 'void_refused', extra: Record<string, unknown> = {}) {
  return { labelUnscanned: { at, boughtAt: o?.shipmentProtection?.decidedAt || null, why, on: null, error: null, startedAt: null, dismissedAt: null, dismissedBy: null, ...extra }, labelUnscannedOpen: true };
}

/** A cancelled order's label that's never voided automatically: on a USPS form, or shared by a box whose orders are all
 *  cancelled. Listed once, so someone can void it by hand if the box didn't go out. A shared box with an order still
 *  going keeps its label. */
async function listLeftover(db: any, tenantId: string, ref: any, o: any, now: number): Promise<boolean> {
  if (!CLOSED.includes(String(o?.stage)) || ['void_refused', 'void_unfinished'].includes(String(o?.labelUnscanned?.why || '')) || scannedOnRecord(o)) return false;
  if (shared(o)) {
    const col = db.collection(`tenants/${tenantId}/retailOrders`);
    const sibs = await Promise.all(o.shippedWithOrderIds.map(String).filter(Boolean).slice(0, 10).map((id: string) => col.doc(id).get()));
    if (sibs.some((s: any) => s.exists && !CLOSED.includes(String(s.data()?.stage)))) return false;
  }
  await ref.set(listed(o, new Date(now).toISOString(), 'void_refused', { on: o.manifestId ? 'form' : 'shared' }), { merge: true });
  return true;
}

/** On a USPS form made at or after `at`: the box has been handed over, or is about to be. */
export function formSince(o: any, at: unknown): boolean {
  return !!o?.manifestId && (Date.parse(String(o.manifestedAt || '')) || Infinity) >= (Date.parse(String(at || '')) || 0);
}

/** An automatic void that's turned down is tried again after 1, 2, then 4 days; after the fourth try it's left for someone. */
export const AUTO_TRIES = 4;
export function retryDue(tried: any, now: number): boolean {
  const n = Number(tried?.tries) || 0;
  if (n <= 0) return true;
  if (n >= AUTO_TRIES) return false;
  return now - (Date.parse(String(tried?.at || '')) || 0) >= (2 ** (n - 1) - 0.5) * DAY;
}

const SYSTEM = { id: 'system', name: 'Daily check' };
/** Why a label wasn't voided. moving: the carrier scanned it. unsure: the tracking can't confirm it's unused. form: it's on
 *  a USPS form. shared: other orders share it. shipped: part of its box is marked shipped. changed: the order changed
 *  while this ran. shippo: Shippo said no. uncertain: Shippo didn't answer, so the void may have gone through. */
export type Refusal = 'moving' | 'unsure' | 'form' | 'shared' | 'shipped' | 'changed' | 'shippo' | 'uncertain';
/** `note`: what to tell the person when some boxes were voided and Shippo said no to the rest (the label still came off). */
export type VoidOutcome = { ok: boolean; error?: string; voided?: number; refused?: Refusal; note?: string };

/**
 * Void an order's labels if they weren't used, and clear them from the order. Automatic voids (the default) need the
 * strict test and are refused for a label on a USPS form; `byHand` is a staff member standing at the box, refused only
 * when the carrier has scanned it; `finishing` completes a void whose outcome wasn't known (see sweepLabels). A shared
 * label (orders shipped together) is voided only by hand, and then comes off every order in the box. The stage never
 * changes: a shipped order stays shipped.
 */
export async function voidIfUnused(db: any, tenantId: string, ref: any, order: any, apiKey: string, why: string,
  actor = SYSTEM, opts: { byHand?: boolean; finishing?: boolean } = {}): Promise<VoidOutcome> {
  if (!order?.shippoTransactionId) return { ok: true, voided: 0 };
  const txnId = String(order.shippoTransactionId);
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const sibRefs: any[] = (shared(order) ? order.shippedWithOrderIds : []).map(String).filter(Boolean).slice(0, 10).map((id: string) => col.doc(id));
  if (sibRefs.length && !opts.byHand) {
    if (!opts.finishing) await listLeftover(db, tenantId, ref, order, Date.now()).catch(() => false);
    return { ok: false, refused: 'shared', error: 'This label covers other orders in the same box, so it isn’t voided automatically.' };
  }
  // Finishing a void that already passed its checks, and may already be refunded: a scan, or a USPS form since, stops it.
  const careful = !opts.byHand && !opts.finishing;
  if (careful && order.manifestId) {
    await listLeftover(db, tenantId, ref, order, Date.now()).catch(() => false);
    return { ok: false, refused: 'form', error: 'This box is on a USPS form, so it may already have gone out. It was left alone.' };
  }
  if (sibRefs.length) {
    const sibs = await Promise.all(sibRefs.map((r: any) => r.get()));
    const gone = sibs.find((s: any) => s.exists && GONE.includes(String(s.data()?.stage)));
    if (gone) return { ok: false, refused: 'shipped', error: `${orderNo(gone.data())} is in the same box and marked shipped, so this label can’t be voided here.` };
  }
  const state = await labelState(apiKey, order);
  if (state === 'moving') {
    const at = new Date().toISOString(); const tn = String(order.trackingNumber || '');
    // A void of this label was already under way, or some of its boxes were voided: the box is out on a label that may
    // be refunded, or its other boxes need new labels, so the team hears.
    const voidedBoxes = Array.isArray(order.labelVoidIds) ? order.labelVoidIds.length : 0;
    const begun = opts.finishing || String(order.labelVoiding?.txn || '') === txnId || voidedBoxes > 0;
    const told = order.voidedLabelMoving?.trackingNumber === tn && order.voidedLabelMoving?.open === false;
    await ref.set({ labelSeenMoving: at, labelUnscannedOpen: false, labelVoiding: null,
      ...(begun && !told ? { voidedLabelMoving: { open: true, unsure: true, at, trackingNumber: tn, voidedBoxes, unconfirmedBoxes: 0 } } : {}) }, { merge: true }).catch(() => {});
    return { ok: false, refused: 'moving', error: 'The carrier has already scanned this label, so it can’t be voided.' };
  }
  // A packed box can still go out, so finishing its void needs the same proof an automatic void does.
  const strict = careful || (!!opts.finishing && !['cancelled', 'refunded'].includes(String(order.stage)));
  if (strict && state !== 'pre') return { ok: false, refused: 'unsure', error: 'The carrier’s tracking couldn’t confirm this label is unused, so it was left alone.' };

  // Written down first, against the order as it is now: if this stops part way, the next morning's check knows a void
  // may have gone through.
  const now = new Date().toISOString();
  const start: any = await db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(ref)).data() || {};
    if (String(c.shippoTransactionId || '') !== txnId) return { stop: 'The label on this order changed meanwhile, so it was left alone.' };
    if (GONE.includes(String(c.stage))) return { stop: 'This order was marked shipped meanwhile, so its label was left alone.' };
    const prev = String(c.labelVoiding?.txn || '') === txnId ? c.labelVoiding : null;
    const marker = { at: String(prev?.at || now), txn: txnId, why, stage: String(c.stage || ''), tries: (Number(prev?.tries) || 0) + 1, lastAt: now, by: actor.name };
    if (careful && c.manifestId) return { stop: 'This box went on a USPS form meanwhile, so it was left alone.' };
    if (opts.finishing && formSince(c, marker.at)) return { stop: 'This box went on a USPS form after the void began, so it was left alone.' };
    tx.set(ref, { labelVoiding: marker }, { merge: true });
    return { c };
  });
  if (start.stop) return { ok: false, refused: 'changed', error: start.stop };
  const cur: any = start.c;
  const v = await voidOrderLabels(db, tenantId, cur, apiKey, { alreadyVoided: Array.isArray(cur.labelVoidIds) ? cur.labelVoidIds : [] });
  if (v.outcome === 'moving') {
    // Shippo says the carrier already has a box: the label stays (that box is on its way), it's remembered as moving (so
    // the order can be marked shipped), and if other boxes did void, the team hears they need new labels.
    const at = new Date().toISOString(); const tn = String(cur.trackingNumber || '');
    const told = cur.voidedLabelMoving?.trackingNumber === tn && cur.voidedLabelMoving?.open === false;
    const unconfirmed = Number(v.unanswered) || 0;
    await ref.set({ labelSeenMoving: at, labelUnscannedOpen: false, labelVoiding: null, ...(v.voidedIds.length ? { labelVoidIds: v.voidedIds } : {}),
      ...((v.voidedIds.length || unconfirmed) && !told ? { voidedLabelMoving: { open: true, unsure: true, at, trackingNumber: tn, voidedBoxes: v.voidedIds.length, unconfirmedBoxes: unconfirmed } } : {}) }, { merge: true }).catch(() => {});
    return { ok: false, refused: 'moving', error: `The carrier already has ${v.total > 1 ? 'one of these boxes' : 'this box'}, so ${v.total > 1 ? 'its label' : 'the label'} can’t be voided.${v.voidedIds.length ? ` ${v.voidedIds.length} other box label${v.voidedIds.length === 1 ? ' was' : 's were'} voided, so ${v.voidedIds.length === 1 ? 'that box needs' : 'those boxes need'} a new label before going out.` : ''}${unconfirmed ? ` Shippo didn’t answer for ${unconfirmed === 1 ? 'another box' : `${unconfirmed} other boxes`}, so ${unconfirmed === 1 ? 'its label' : 'their labels'} may be voided: check in Shippo before ${unconfirmed === 1 ? 'it goes' : 'they go'} out.` : ''}` };
  }
  if (v.outcome === 'refused' || v.outcome === 'unknown') {
    // Shippo said no and nothing was voided: the label works as before, so the note comes off. No real answer for some
    // box: it may have gone through, so the note stays (the void is finished the next morning or shown to someone, and
    // the label can't ship meanwhile), and boxes that did void are kept, so trying again finishes the job.
    const unknown = v.outcome === 'unknown';
    await ref.set({ ...(v.voidedIds.length ? { labelVoidIds: v.voidedIds } : {}), ...(unknown ? {} : { labelVoiding: null }) }, { merge: true }).catch(() => {});
    if (!unknown) return { ok: false, refused: 'shippo', error: v.error };
    return { ok: false, refused: 'uncertain', error: 'Shippo didn’t answer in time, so this label may already be voided. Try again in a minute, and don’t use it until that goes through.' };
  }
  // Every box voided, or some voided and Shippo said no to the rest. Either way the label can't ship as it is, so it comes
  // off the order (a new one can be bought) and any box Shippo wouldn't refund is named.
  const partial = v.outcome === 'partial';
  const kept = partial ? ` Shippo wouldn’t void the other${v.total - v.voidedIds.length > 1 ? 's' : ''}${v.refusal ? ` (${v.refusal})` : ''}, so that postage isn’t coming back.` : '';
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.runTransaction(async (tx: any) => {
    const c: any = (await tx.get(ref)).data() || {};
    const sibs: any[] = sibRefs.length ? await Promise.all(sibRefs.map((r: any) => tx.get(r))) : [];
    if (String(c.shippoTransactionId || '') !== txnId) return;   // relabelled meanwhile: that label isn't ours to clear
    // The other orders in the box carry a copy of this label; only copies that are still this box's come off.
    const copies = sibs.filter((s: any) => s.exists && [s.data()?.labelFromOrderId, s.data()?.shippedWithOrderId].includes(ref.id));
    tx.set(ref, {
      ...LABEL_CLEARED, labelVoidedAt: now,
      ...(sibRefs.length ? { shippedWithOrderIds: null, shipTogetherAt: null } : {}),
      ...(v.trackingNumbers.length ? { voidedTracking: FieldValue.arrayUnion(...v.trackingNumbers) } : {}),
    }, { merge: true });
    const also = copies.length ? ` It covered ${copies.map((s: any) => orderNo(s.data())).join(', ')} too.` : '';
    const ev = ref.collection('events').doc();
    tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: actor.id, actorName: actor.name, meta: { kind: 'label_voided', text: partial
      ? `${v.voidedIds.length} of ${v.total} labels voided: ${why}.${kept}${also}`
      : `${v.count > 1 ? `${v.count} labels` : 'Label'} voided: ${why}. The postage comes back to the shop.${also}` } });
    for (const s of copies) {
      tx.set(s.ref, SHARED_CLEARED, { merge: true });
      const e = s.ref.collection('events').doc();
      tx.set(e, { id: e.id, type: 'note', at: now, actorId: actor.id, actorName: actor.name, meta: { kind: 'label_voided', text: `The label it shared with ${orderNo(c)} was voided: ${why}` } });
    }
  });
  return { ok: true, voided: v.voidedIds.length, ...(partial ? { note: `${v.voidedIds.length} of ${v.total} labels voided.${kept} The label is off the order, so you can buy a new one.` } : {}) };
}

/** A void that can't be finished here: the note comes off and someone is told. Its first try may have gone through, so
 *  the label may no longer work (whatever Shippo says now). */
async function tellUnfinished(ref: any, o: any, now: number, reason?: string): Promise<void> {
  const at = new Date(now).toISOString(); const tn = String(o.trackingNumber || '');
  const told = o.voidedLabelMoving?.trackingNumber === tn && o.voidedLabelMoving?.open === false;
  await ref.set({
    labelVoiding: null,
    // A person decides from here, so no automatic void runs on this label again.
    autoVoid: { tries: AUTO_TRIES, at, error: String(reason || 'A void didn’t finish').slice(0, 200) },
    ...(scannedOnRecord(o)
      ? (told ? {} : { voidedLabelMoving: { open: true, unsure: true, at, trackingNumber: tn, voidedBoxes: Array.isArray(o.labelVoidIds) ? o.labelVoidIds.length : 0, unconfirmedBoxes: 0 } })
      : listed(o, at, 'void_unfinished', { startedAt: o.labelVoiding?.at || null, error: reason ? reason.slice(0, 200) : null })),
  }, { merge: true });
}

export type SweepResult = { voided: number; flagged: number; checked: number; cutOff: boolean };

/** One shop's morning check. Stops starting new work 20 seconds before `deadline`; `cutOff` says it stopped with work left. */
export async function sweepLabels(db: any, tenantId: string, apiKey: string, opts: { now?: number; deadline?: number; maxLookups?: number } = {}): Promise<SweepResult> {
  const now = opts.now ?? Date.now();
  const deadline = opts.deadline ?? Date.now() + 40000;
  const out: SweepResult = { voided: 0, flagged: 0, checked: 0, cutOff: false };
  if (!apiKey) return out;
  const since = new Date(now - 90 * DAY).toISOString();
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const docs: any[] = []; let cursor: any = null;
  for (let page = 0; page < 20; page++) {
    let q = col.where('shipmentProtection.decidedAt', '>', since).orderBy('shipmentProtection.decidedAt', 'desc').limit(400);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get(); docs.push(...snap.docs);
    if (snap.size < 400) break; cursor = snap.docs[snap.docs.length - 1];
  }
  type Job = { d: any; o: any; kind: 'unfinished' | 'leftover' | 'finish' | 'cancelled' | 'flag' | 'expired'; at: number };
  const jobs: Job[] = [];
  for (const d of docs) {
    const o: any = d.data() || {};
    const stage = String(o.stage || '');
    if (!o.shippoTransactionId || o.deliveredAt || ['completed', 'handed_off'].includes(stage)) continue;
    const bought = Date.parse(String(o.shipmentProtection?.decidedAt || '')) || now;
    const age = (now - bought) / DAY;
    // 1. A void whose outcome isn't known. Finished only while the box isn't going anywhere (packed and on no USPS form
    //    since the void began, cancelled, or refunded) and for at most three tries; otherwise someone is told.
    const mk = String(o.labelVoiding?.txn || '') === String(o.shippoTransactionId) ? o.labelVoiding : null;
    if (mk) {
      const safe = !scannedOnRecord(o) && !shared(o) && ['packed', 'cancelled', 'refunded'].includes(stage) && !formSince(o, mk.at) && (Number(mk.tries) || 0) < 3;
      jobs.push({ d, o, kind: safe ? 'finish' : 'unfinished', at: bought });
      continue;
    }
    if (scannedOnRecord(o)) continue;
    // 2 and 4 are automatic voids: never for a label on a USPS form or a shared one, and only as often as retries allow.
    const auto = !o.manifestId && !shared(o) && retryDue(o.autoVoid, now);
    if (CLOSED.includes(stage)) {
      if (auto) jobs.push({ d, o, kind: 'cancelled', at: bought });
      // Never voided automatically: listed once for someone to void by hand (see listLeftover).
      else if ((o.manifestId || shared(o)) && !['void_refused', 'void_unfinished'].includes(String(o.labelUnscanned?.why || ''))) jobs.push({ d, o, kind: 'leftover', at: bought });
      continue;
    }
    const dismissed = !!o.labelUnscanned?.dismissedAt;
    const shippedAt = Date.parse(String(o.completedAt || '')) || 0;
    const due = stage === 'shipped' ? shippedAt > 0 && now - shippedAt >= 4 * DAY : stage === 'packed' && age >= 3;
    if (stage === 'packed' && age >= 28 && !dismissed && auto) jobs.push({ d, o, kind: 'expired', at: bought });
    else if (due && !dismissed && !o.labelUnscanned?.at) jobs.push({ d, o, kind: 'flag', at: bought });
  }
  const rank = { unfinished: 0, leftover: 1, finish: 2, cancelled: 3, flag: 4, expired: 5 } as const;
  jobs.sort((a, b) => rank[a.kind] - rank[b.kind] || b.at - a.at);
  let lookups = 0; const maxLookups = opts.maxLookups ?? 40;
  for (const j of jobs) {
    if (Date.now() > deadline - 20000) { out.cutOff = true; break; }
    // No carrier lookup needed: taken off the morning's work and put in front of someone.
    if (j.kind === 'unfinished') { await tellUnfinished(j.d.ref, j.o, now); out.flagged++; continue; }
    if (j.kind === 'leftover') { if (await listLeftover(db, tenantId, j.d.ref, j.o, now)) out.flagged++; continue; }
    if (lookups >= maxLookups) break;
    lookups++; out.checked++;
    if (j.kind === 'flag') {
      const s = await labelState(apiKey, j.o);
      if (s === 'moving') { await j.d.ref.set({ labelSeenMoving: new Date(now).toISOString() }, { merge: true }); continue; }
      await j.d.ref.set({ labelUnscanned: { at: new Date(now).toISOString(), boughtAt: j.o.shipmentProtection?.decidedAt || null }, labelUnscannedOpen: true }, { merge: true });
      out.flagged++;
      continue;
    }
    if (j.kind === 'finish') {
      const r = await voidIfUnused(db, tenantId, j.d.ref, j.o, apiKey, String(j.o.labelVoiding?.why || 'finishing a void that was interrupted'), SYSTEM, { finishing: true });
      if (r.ok) { if (r.voided) out.voided++; }
      // Turned down (the tracking can't confirm it's unused, or Shippo said no): a person decides. The first try may
      // still have gone through, so it's listed as a void that didn't finish. No answer again: the note stays for
      // another morning.
      else if (r.refused === 'unsure' || r.refused === 'shippo') { await tellUnfinished(j.d.ref, j.o, now, r.error); out.flagged++; }
      continue;
    }
    const why = j.kind === 'cancelled' ? 'the order was cancelled' : 'the carrier never scanned it, and USPS labels stop working after 30 days';
    const r = await voidIfUnused(db, tenantId, j.d.ref, j.o, apiKey, why);
    if (r.ok) { if (r.voided) out.voided++; continue; }
    if (r.refused === 'unsure' || r.refused === 'shippo') {
      // Tried again later; after the last try it goes under Needs you, where someone can void it by hand or leave it.
      const tries = (Number(j.o.autoVoid?.tries) || 0) + 1;
      const at = new Date(now).toISOString(); const error = String(r.error || '').slice(0, 200);
      const last = tries >= AUTO_TRIES;
      await j.d.ref.set({ autoVoid: { tries, at, error }, ...(last ? listed(j.o, at, 'void_refused', { error }) : {}) }, { merge: true });
      if (last) out.flagged++;
    }
  }
  return out;
}
