// src/lib/claim-view.ts — A CUSTOMER'S REPORT, AS PEOPLE SEE IT (mockups 10A to 10C). What the order's record shows,
// as plain facts with no score; why the shop's rules didn't approve it on their own; the carrier claim to file if it's
// approved; where it is for the customer (Being checked, We need something from you, Approved, Declined). Pure, so the
// decide sheet, Problems and the customer's order page say the same thing.
import { coverFor, fileBy } from './lost-recovered';
import { effectiveUnitCents } from './restocking';

const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
const money = (c: number) => `$${(Math.max(0, Number(c) || 0) / 100).toFixed(2)}`;
export const OPEN_CLAIM_STATUSES = ['in_review', 'needs_info', 'info_requested', 'open'];
export const isOpenClaim = (c: any) => OPEN_CLAIM_STATUSES.includes(String(c?.status || ''));

/** The shop asked for something and hasn't had the answer (it waits under Waiting on them, not in front of you). */
export function claimWaiting(c: any): boolean {
  if (!isOpenClaim(c) || !c?.infoRequestText) return false;
  // An appeal after the question brings it back to the shop, answered or not.
  if (ms(c.appealedAt) > ms(c.infoRequestAt)) return false;
  return !c.infoResponseText || ms(c.infoResponseAt) < ms(c.infoRequestAt);
}

/** The carrier marked it delivered: the order's own date, or the carrier's delivered scan. One test for the facts, the
 *  carrier claim and the loss record, so they never disagree. */
export function deliveredAt(order: any): string | null {
  if (!order) return null;
  if (order.deliveredAt) return String(order.deliveredAt);
  const t = order.carrierTrail || {};
  // The carrier's own status first (lib/label-doubt reads it the same way); with no scan time, only that it was ('yes'),
  // never another date standing in for it.
  return String(t.carrierStatus || t.status || '').toUpperCase() === 'DELIVERED' ? String(t.carrierStatusAt || '') || 'yes' : null;
}

/** Units of a line still the customer's to be put right for: ordered, less any shorted, returned, refunded on their own,
 *  or settled by another report. One count for the decide sheet, the server's three ways of putting it right, and a
 *  replacement for a lost parcel. */
export const unitsOpen = (l: any): number => { const n = (v: any) => Math.max(0, Math.round(Number(v) || 0)); return Math.max(0, n(l?.qtyOrdered) - n(l?.qtyShorted) - n(l?.qtyReturned) - n(l?.qtyRefunded) - n(l?.qtyClaimed)); };

/** What putting a report right can be worth, as the server works it out (lib/claim-decide, lib/claim-settle). An item:
 *  units since returned, refunded or settled another way aren't paid again, so only part of it left is that share of the
 *  amount. A whole order: what's still theirs now against what was when they reported it (openAtFiling), so anything
 *  settled since isn't paid twice. Without the order (or a report filed before that was kept), the report's own amount. */
export function claimRefundable(c: any, order: any | null): { cents: number; units: number; all: boolean } {
  const n = (v: any) => Math.max(0, Number(v) || 0);
  const asked = n(c?.claimValueCents); const want = Math.max(1, n(c?.qty));
  const lines: any[] | null = Array.isArray(order?.lines) ? order.lines : null;
  if (c?.lineId) {
    const line = lines ? lines.find((l: any) => l?.lineId === c.lineId) : null;
    if (!line) return { cents: asked, units: want, all: true };
    const units = Math.min(want, unitsOpen(line));
    return { cents: units < want ? Math.round((asked * units) / want) : asked, units, all: units >= want };
  }
  if (!lines || !lines.some((l: any) => l?.lineId)) return { cents: asked, units: 1, all: true };
  // Each unit at what it was really paid (after a line discount and its share of a promo code).
  const price = (l: any) => effectiveUnitCents(l || {});
  const stamped = c?.openAtFiling && typeof c.openAtFiling === 'object' ? c.openAtFiling : null;
  // A report filed before that was kept: what's open now against the same, counting what's since been put right through
  // another report as still open then (a return or a refund before they reported it was already left out of the amount).
  const was = stamped || Object.fromEntries(lines.filter((l: any) => l?.lineId).map((l: any) => [String(l.lineId), unitsOpen(l) + n(l.qtyClaimed)]));
  let then = 0; let now = 0; let unitsThen = 0; let unitsNow = 0;
  for (const l of lines) {
    if (l?.digital === true && !stamped) continue;
    const w = n(was[String(l?.lineId)]); if (!w) continue;
    const left = Math.min(w, unitsOpen(l));
    then += price(l) * w; now += price(l) * left; unitsThen += w; unitsNow += left;
  }
  // Nothing was still theirs (everything returned, refunded or put right already): nothing to put right now.
  if (unitsThen <= 0 || unitsNow <= 0) return { cents: 0, units: 0, all: false };
  // Free items only: their units still count, the amount is what the report says.
  if (then <= 0) return { cents: asked, units: 1, all: true };
  return { cents: now >= then ? asked : Math.round((asked * now) / then), units: unitsNow > 0 ? 1 : 0, all: now >= then };
}
/** When it last came back to the shop: reported, appealed, or answered. A reminder counts from here. */
export const claimSince = (c: any): number => Math.max(ms(c?.openedAt), ms(c?.appealedAt), claimWaiting(c) ? 0 : ms(c?.infoResponseAt));

export type Fact = { ok: boolean | null; text: string };
/** What the order's record shows about it, as facts to weigh (never a verdict). */
export function recordFacts(c: any, order: any | null, priorReports: number | null = null): Fact[] {
  const ev = c?.evidence || {};
  const out: Fact[] = [];
  const item = String(c?.lineName || 'the item');
  if (ev.lineScanned != null) out.push(ev.lineScanComplete ? { ok: true, text: `${item} was scanned into the bag at packing (${ev.lineScanned})` } : { ok: false, text: `${item} wasn’t scanned in full at packing (${ev.lineScanned})` });
  else if (ev.allScanned != null) out.push(ev.allScanned ? { ok: true, text: 'Everything was scanned into the bag at packing' } : { ok: false, text: 'Not everything was scanned at packing' });
  const photos = Number(ev.photoCount) || 0;
  out.push(photos > 0 ? { ok: true, text: `${photos} packing photo${photos === 1 ? '' : 's'}` } : { ok: false, text: 'No packing photo' });
  if (order?.method === 'ship') {
    const delivered = !!deliveredAt(order);
    out.push(delivered ? { ok: true, text: 'The carrier says it was delivered' } : ev.hasCarrier || order.trackingNumber ? { ok: null, text: 'Shipped with tracking; no delivered scan' } : { ok: false, text: 'Shipped without tracking' });
  } else if (order?.handoff) {
    // How the pickup was checked (lib/pickup-pass HANDOFF_WORDS).
    const how = String(order.handoff.method || '');
    out.push({ ok: how === 'qr' || how === 'pin' ? true : null, text: `Picked up${how === 'qr' ? ', QR code scanned' : how === 'pin' ? ', pickup code checked' : how === 'checked' ? ', name and phone checked' : ''}${order.handoff.collectedBy === 'someone_else' && order.handoff.collectorName ? ` by ${order.handoff.collectorName}` : ''}` });
  }
  if (c?.photosRequired && !(Array.isArray(c.photoUrls) && c.photoUrls.length)) out.push({ ok: false, text: 'No photo from them yet' });
  // Only when their history could be read: an unknown is never shown as a clean record.
  if (priorReports != null) out.push(priorReports > 0 ? { ok: null, text: `${priorReports} earlier report${priorReports === 1 ? '' : 's'} from them` } : { ok: null, text: 'First report from them' });
  return out;
}

/** Why the shop's rules didn't approve it on their own: the first reason that applies. */
export function whyNotAuto(c: any, rs: any, order?: any): string {
  const max = Math.max(0, Math.floor(Number(rs?.claimAutoResolveMaxCents) || 0));
  const after = Math.max(0, Math.floor(Number(rs?.policies?.claimReviewAfter) || 0));
  if (c?.appealedAt) return 'An appeal is always decided by a person.';
  if (!max) return 'Your claim policy doesn’t approve any on their own.';
  if (!(Number(c?.claimValueCents) > 0)) return 'Not approved on its own: nothing is left to refund on it.';
  if (Number(c?.claimValueCents) > max) return `Not approved on its own: ${money(c.claimValueCents)} is over your ${money(max)} automatic limit.`;
  if (c?.photosRequired) return 'Not approved on its own: your policy asks for a photo first.';
  if (c?.needsReview) return `Not approved on its own: your policy has a person look after ${after || 'a few'} reports from the same customer.`;
  if (!['missing', 'wrong_item'].includes(String(c?.type))) return 'Damage and parcels that never came are always decided by a person.';
  if (c?.evidence?.lineScanComplete) return 'Not approved on its own: the packing record shows it went in the bag.';
  if (!c?.lineId) return 'Not approved on its own: it’s about the whole order, not one item.';
  // What the report was checked against when it came in (api/retail/claims riskFactors), in plain words.
  const said = (Array.isArray(c?.riskFactors) ? c.riskFactors : []).map((f: any) => String(f || '')).map((f: string) => {
    if (f === 'High value') return 'it’s $100 or more';
    const prior = /^(\d+) prior claims/.exec(f); if (prior) return `they’ve made ${prior[1]} earlier reports`;
    if (f === 'Packing photo exists') return 'there’s a packing photo of the bag';
    if (f === 'Carrier reported delivered') return 'the carrier says it was delivered';
    return '';
  }).filter(Boolean);
  if (said.length) return `Not approved on its own: ${said.slice(0, 2).join(', and ')}.`;
  if (order?.replacementOrderId) return 'Not approved on its own: the order already has a replacement.';
  return 'Not approved on its own: something on it needed a person.';
}

/** A damaged or never-arrived parcel: the claim to file with whoever covers it, and by when, if it's approved. */
export function carrierLine(c: any, order: any | null, day: (iso: string) => string, tz = 'UTC'): string | null {
  if (!order || order.method !== 'ship' || !['damaged', 'not_received'].includes(String(c?.type))) return null;
  const dAt = deliveredAt(order);
  const exc = { reason: c.type === 'damaged' ? 'carrier_damaged' : (dAt ? 'stolen_after_delivery' : 'carrier_lost'), carrier: order.carrier, insuredCents: order.shipmentProtection ? Number(order.shipmentProtection.insuranceCents) || 0 : 0, shippedAt: order.completedAt || order.shippedAt || null, deliveredAt: dAt && dAt !== 'yes' ? dAt : null };
  // Shipped with no carrier, no tracking and no insurance on record: there's no claim to make.
  if (!order.carrier && !order.trackingNumber && !exc.insuredCents) return null;
  const cover = coverFor(exc, order);
  // Gone from the porch after the delivered scan: only insurance pays for that.
  if (exc.reason === 'stolen_after_delivery' && !cover.theft) return `${cover.line} doesn’t pay for a parcel gone after its delivered scan, so there’s no claim to file.`;
  const by = fileBy(exc, order, tz);
  return `${cover.line}: if you approve it, file with ${cover.who.replace(/^The /, 'the ')}${by ? ` by ${day(by)}` : ''}. It’s listed under Lost and recovered.`;
}

/** Where it is, for the customer's order page. */
export function customerClaimStatus(c: any): { label: string; line: string; tone: 'wait' | 'ask' | 'ok' | 'no' } {
  const st = String(c?.status || '');
  if (st === 'resolved' || st === 'auto_resolved') return { label: 'Approved', tone: 'ok',
    line: c?.resolution === 'replacement' ? (c?.replacementMethod === 'ship' ? 'Another is on its way to you, at no charge.' : c?.replacementMethod === 'delivery' ? 'Another is coming to you, at no charge. You’ll hear when it’s out for delivery.' : 'We’re getting another ready for you, at no charge. You’ll hear when it’s ready to collect.')
      : c?.resolution === 'store_credit' ? `${money(c.creditCents ?? c.resolutionCents)} store credit, ready to use at checkout.`
      : Number(c?.resolutionCents) > 0 ? `A ${money(c.resolutionCents)} refund, back to how you paid.` : '' };
  if (st === 'declined') return { label: 'Declined', tone: 'no', line: c?.declineReason ? String(c.declineReason) : '' };
  if (claimWaiting(c)) return { label: 'We need something from you', tone: 'ask', line: 'Your report waits for your answer.' };
  return { label: c?.appealedAt ? 'Being checked again' : 'Being checked', tone: 'wait', line: c?.appealedAt ? 'A person is looking at it again.' : 'The shop is looking at it with the packing record.' };
}
