// src/lib/label-void.ts — VOID AN ORDER'S LABELS, every box's, so the postage comes back. Server only. Used when the
// address changes after the label was bought, when a label lands after the address changed, and by the label route's
// own "void" and "replace" actions. An order shipped in several boxes has one label per box: the order keeps each
// box's label (labelTxns, lib/label-boxes); a label bought before that is found through its rate, since its boxes were
// bought together on one.
//   All or nothing, honestly: if the other boxes can't be found, nothing is voided; if some boxes void and others
//   don't, it says so and returns the ones that did (callers keep them, so trying again picks up where it stopped).
//   A label the carrier already refunded counts as voided, so a retry after an interruption finishes the job.
//   Each box voided is written on its label record as a refund asked for (lib/label-records); the money goes into the
//   books when Shippo confirms it, not before.
import { labelKey, labelSlots, slotsKnown, type RecordBox } from '@/lib/label-boxes';
import { claimLabelBuy, newLabelRecord, noteRefundId, noteRefundRequests, rateInfo, releaseLabelBuy, type LabelHow } from '@/lib/label-records';
import { recordPostage } from '@/lib/postage';
import { labelsFor } from '@/lib/box-shipments';

const SHIPPO = 'https://api.goshippo.com';
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };
// "Already refunded" means our earlier void went through. "Already used" (scanned by the carrier) means it can't be voided.
export const ALREADY = /already (been )?refunded|refund[^.]{0,40}already exists|already (has|have) a refund|refund (was|has been) already requested/i;
export const NOT_VOIDABLE = /used|scanned|in transit|not eligible|cannot be refunded|can't be refunded|can’t be refunded/i;
// Turned down because the carrier already has the box: it's on its way, so its label must stay on the order. ("Not
// eligible" is left out: it doesn't say why.)
export const IN_USE = /\bused\b|scanned|in transit/i;

/** What an order looks like once its labels are voided: no label, no tracking, nothing checked at the bench. */
export const LABEL_CLEARED = {
  trackingNumber: '', carrier: '', trackingUrl: '', labelUrl: '', shippoTransactionId: '',
  extraLabelUrls: [] as string[], extraTrackingNumbers: [] as string[], extraTrackingUrls: [] as string[], labelsChecked: [] as string[], labelCheckedAt: null,
  labelVoidIds: [] as string[], labelTxns: [] as string[], labelRecs: [] as string[], relabelOpen: false,
  // A voided label isn't waiting for a scan any more (lib/label-sweep), and it's on no carrier form (api/retail/close-day).
  // What the morning check knew about it (seen moving, voids turned down) goes with it: a new label starts fresh.
  labelUnscanned: null, labelUnscannedOpen: false, manifestId: null, manifestedAt: null, manifestTxns: [] as string[], labelVoiding: null,
  labelSeenMoving: null, autoVoid: null,
};

/** An order that went in another order's box (lib/ship-together), once that box's label is voided: its copy goes too. */
export const SHARED_CLEARED = {
  trackingNumber: '', carrier: '', trackingUrl: '', labelUrl: '',
  extraLabelUrls: [] as string[], extraTrackingNumbers: [] as string[], extraTrackingUrls: [] as string[], labelsChecked: [] as string[], labelCheckedAt: null,
  labelTxns: [] as string[], labelVoidIds: [] as string[],
  labelFromOrderId: null, shippedWithOrderId: null, shipTogetherAt: null,
};

/** How it ended. voided: every box. moving: Shippo said a box was already used (the carrier has it), so the label stays
 *  on the order. partial: some boxes voided and Shippo said no to the rest, so the label can't ship as it is. refused:
 *  nothing voided, so the label works as before. unknown: some box got no real answer (no response, a timeout, or a
 *  server error that may have come after Shippo made the refund), so it may or may not have gone through. `refusal` is
 *  Shippo's own words for a box it turned down; `total` is how many boxes the label has. `boxTxns`: each box's Shippo
 *  label in box order, when they had to be looked up (an order bought before the order kept them), for the caller to
 *  keep on the order. */
export type VoidResult = { ok: boolean; outcome: 'voided' | 'moving' | 'partial' | 'refused' | 'unknown'; error?: string; refusal?: string; status?: string; count: number; total: number; voidedIds: string[]; trackingNumbers: string[]; uncertain?: boolean;
  /** Boxes that got no real answer, so may or may not be voided. */
  unanswered?: number; boxTxns?: string[];
  /** The refunds asked for in this go, with Shippo's id for each when it gave one. */
  asked?: { txn: string; refundId: string | null }[] };

export async function voidOrderLabels(db: any, tenantId: string, order: any, apiKey: string,
  opts: { alreadyVoided?: string[]; orderId?: string; why?: string } = {}): Promise<VoidResult> {
  const master = String(order?.shippoTransactionId || '').trim();
  const trackingNumbers = [order?.trackingNumber, ...(Array.isArray(order?.extraTrackingNumbers) ? order.extraTrackingNumbers : [])].map((x: any) => String(x || '').trim()).filter(Boolean);
  if (!master) return { ok: true, outcome: 'voided', count: 0, total: 0, voidedIds: [], trackingNumbers: [] };
  if (!apiKey) return { ok: false, outcome: 'refused', error: 'Shippo isn’t connected, so the label can’t be voided here.', count: 0, total: 0, voidedIds: [], trackingNumbers };
  const auth = { Authorization: `ShippoToken ${apiKey}` };
  let ids = [master];
  let boxTxns: string[] | undefined;
  if (slotsKnown(order)) {
    ids = labelSlots(order).map((s) => s.txn);
  } else {
    const extra = Array.isArray(order?.extraLabelUrls) ? order.extraLabelUrls.length : 0;
    if (extra > 0) {
      const found: any[] = [];
      try {
        const t: any = await fetch(`${SHIPPO}/transactions/${encodeURIComponent(master)}`, { headers: auth, signal: timeout(15000) }).then((r) => r.json());
        const rate = typeof t?.rate === 'string' ? t.rate : t?.rate?.object_id;
        if (rate) {
          const list: any = await fetch(`${SHIPPO}/transactions/?rate=${encodeURIComponent(rate)}&results=25`, { headers: auth, signal: timeout(15000) }).then((r) => r.json());
          for (const x of list?.results || []) if (x?.status === 'SUCCESS' && x.object_id && !ids.includes(String(x.object_id))) { ids.push(String(x.object_id)); found.push(x); }
        }
      } catch { /* counted below */ }
      if (ids.length < 1 + extra) return { ok: false, outcome: 'refused', error: 'Couldn’t find every box’s label to void, so none were voided. Try again in a minute.', count: 0, total: 1 + extra, voidedIds: [], trackingNumbers };
      // Each box's label in box order, matched by its tracking number, so the order can keep them from now on.
      const extras = (Array.isArray(order?.extraTrackingNumbers) ? order.extraTrackingNumbers : []).map((x: any) => String(x || '').trim());
      const matched = extras.map((n: string) => String(found.find((x) => String(x?.tracking_number || '').trim() === n && n)?.object_id || ''));
      if (extras.length === extra && matched.every(Boolean) && new Set(matched).size === matched.length) boxTxns = [master, ...matched];
    }
  }
  const done = new Set((opts.alreadyVoided || []).map(String));
  const before = new Set(done);
  const failed: string[] = []; const said4xx: { txn: string; said: string }[] = []; let noAnswer = 0; let inUse = 0; let refusal = '';
  const asked: { txn: string; refundId: string | null }[] = [];
  let status = done.has(master) ? 'PENDING' : '';
  for (const id of ids) {
    if (done.has(id)) continue;
    const r = await fetch(`${SHIPPO}/refunds/`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: id, async: false }), signal: timeout(15000) }).catch(() => null);
    const d: any = r ? await r.json().catch(() => ({})) : {};
    const said = String(d?.detail || d?.__all__?.[0] || d?.transaction?.[0] || JSON.stringify(d || {})).slice(0, 300);
    if (r && r.ok) { done.add(id); asked.push({ txn: id, refundId: d?.object_id ? String(d.object_id) : null }); if (id === master) status = String(d.status || 'PENDING'); continue; }
    if (r && ALREADY.test(said) && !NOT_VOIDABLE.test(said)) { done.add(id); asked.push({ txn: id, refundId: null }); if (id === master) status = 'PENDING'; continue; }
    // Too many requests at once is no answer either: Shippo didn't look at it, so it's asked again, never written off.
    if (!r || r.status >= 500 || r.status === 408 || r.status === 429) noAnswer++;
    else { if (IN_USE.test(said)) inUse++; else said4xx.push({ txn: id, said }); if (!refusal) refusal = said; }
    failed.push(id);
  }
  // The refunds asked for in this go, on their label records (a box voided in an earlier go was written then).
  if (opts.orderId && asked.length) await noteRefundRequests(db, tenantId, boxTxns ? { ...order, labelTxns: boxTxns } : order, opts.orderId, asked.filter((a) => !before.has(a.txn)), opts.why || '').catch(() => {});
  const voidedIds = ids.filter((id) => done.has(id));
  if (failed.length) {
    // A box the carrier has is a fact, whatever else happened; then no answer; then what Shippo said.
    const outcome = inUse > 0 ? 'moving' : noAnswer > 0 ? 'unknown' : voidedIds.length ? 'partial' : 'refused';
    // Some voided and Shippo said no to the rest: the label comes off the order, so the boxes Shippo wouldn't refund are
    // written on its record, as postage that isn't coming back.
    if (outcome === 'partial' && opts.orderId && said4xx.length) await noteRefundRequests(db, tenantId, boxTxns ? { ...order, labelTxns: boxTxns } : order, opts.orderId, said4xx.map((x) => ({ txn: x.txn, refused: x.said })), opts.why || '').catch(() => {});
    return { ok: false, outcome, error: voidedIds.length ? `${voidedIds.length} of ${ids.length} labels voided; the rest didn’t go through. Try again in a minute.` : 'The label couldn’t be voided. Try again in a minute.', refusal: refusal.slice(0, 160), count: voidedIds.length, total: ids.length, voidedIds, trackingNumbers, uncertain: noAnswer > 0, unanswered: noAnswer, asked, ...(boxTxns ? { boxTxns } : {}) };
  }
  return { ok: true, outcome: 'voided', status, count: ids.length, total: ids.length, voidedIds, trackingNumbers, asked, ...(boxTxns ? { boxTxns } : {}) };
}

/** voidUnsavedLabel's answer: how the void went, and whether the label is kept on record with its refunds written down
 *  (`tracked`), so a void that didn't go through is followed. */
export type UnsavedVoid = VoidResult & { tracked: boolean };

/**
 * A label bought for an order that changed while it was being bought (the address, or another label landed first):
 * voided straight away. It was paid for, so it's kept like any label: its record, its postage in the books, and every
 * box's refund written down before Shippo is asked, so a void that doesn't go through (no answer, or Shippo says no) is
 * asked for again by the morning follow-up (lib/label-records followRefunds) instead of leaving a live label nobody
 * knows about. Shippo is asked whatever happens to the record: a live label nobody uses is postage spent for nothing.
 * The postage goes into the books only once its record is there, so its refund can always be matched to it.
 */
export async function voidUnsavedLabel(db: any, tenantId: string, apiKey: string, p: {
  orderId: string; order: any; boxes: RecordBox[]; cents: number; carrier: string; service?: string; rateId?: string; rateIds?: string[];
  by: { id: string; name: string }; how: LabelHow;
  /** Why it's voided, for its record (the order changed meanwhile, when not said). */
  why?: string;
}): Promise<UnsavedVoid | null> {
  const first = p.boxes[0];
  const id = labelKey(first?.txn);
  if (!id) return null;
  const why = p.why || 'voided straight away: the order changed while it was being bought';
  const at = new Date().toISOString();
  const recRef = db.doc(`tenants/${tenantId}/shippingLabels/${id}`);
  const label = {
    shippoTransactionId: first.txn, trackingNumber: first.tracking, labelUrl: first.labelUrl, trackingUrl: first.trackingUrl,
    extraTrackingNumbers: p.boxes.slice(1).map((b) => b.tracking), extraLabelUrls: p.boxes.slice(1).map((b) => b.labelUrl), extraTrackingUrls: p.boxes.slice(1).map((b) => b.trackingUrl),
    labelTxns: p.boxes.map((b) => b.txn), labelRecs: p.boxes.map(() => id),
  };
  const txns = label.labelTxns.filter(Boolean);
  // Its record (once), its postage, and every box's refund asked for. True once the record carries every box's refund.
  const keep = async (): Promise<boolean> => {
    try {
      if (!(await recRef.get()).exists) await recRef.set(newLabelRecord({ id, order: p.order, orderId: p.orderId, carrier: p.carrier, service: p.service, rateId: p.rateId, rateIds: p.rateIds, boxes: p.boxes, amountCents: p.cents, at, by: p.by, how: p.how }));
    } catch { return false; }
    await recordPostage(db, tenantId, { id: p.orderId, orderNumber: p.order?.orderNumber }, id, p.cents, p.carrier);
    await noteRefundRequests(db, tenantId, label, p.orderId, txns.map((txn) => ({ txn, refundId: null })), why);
    try { const r: any = (await recRef.get()).data() || {}; return txns.every((t) => !!r.refunds?.[t]); } catch { return false; }
  };
  let tracked = await keep().catch(() => false);
  // No order named: the refunds are written down already, and each gets Shippo's id once it answers.
  let v: VoidResult;
  try { v = await voidOrderLabels(db, tenantId, label, apiKey); }
  catch { v = { ok: false, outcome: 'unknown', count: 0, total: txns.length, voidedIds: [], trackingNumbers: [], uncertain: true, unanswered: txns.length }; }
  if (!tracked) tracked = await keep().catch(() => false);
  for (const a of v.asked || []) if (a.refundId) await noteRefundId(db, tenantId, label, a.txn, a.refundId).catch(() => {});
  return { ...v, tracked };
}

/**
 * Rates an earlier purchase for this order was buying when it was cut off or got no answer (lib/label-records
 * claimLabelBuy's `doubt`): any label Shippo made on them was never saved, so it's voided now, kept on record with its
 * postage and its refund followed like any other, and written on the order's history. Called under the order's claim,
 * before another label is bought, and by the morning check. A rate Shippo is still making a label on, or couldn't be
 * asked about, stays in doubt, and `wait` says not to buy another label until it's settled. `note` is for the person.
 */
export async function settleDoubtfulBuy(db: any, tenantId: string, apiKey: string, ref: any, orderId: string, order: any, rates: string[], by: { id: string; name: string }): Promise<{ note: string; wait: boolean }> {
  if (!rates.length || !apiKey) return { note: '', wait: false };
  // Read fresh: a label saved after all is on the order, and isn't voided.
  const cur: any = (await ref.get().catch(() => null))?.data?.() || order || {};
  const onOrder = new Set([String(cur?.shippoTransactionId || ''), ...(Array.isArray(cur?.labelTxns) ? cur.labelTxns.map(String) : [])].filter(Boolean));
  const keep: string[] = []; const loose: { rate: string; t: any }[] = [];
  for (const rate of [...new Set(rates.map(String))].slice(0, 20)) {
    const l = await labelsFor(apiKey, rate);
    if (!l.asked || l.pending.length) keep.push(rate);
    for (const t of l.made) if (!onOrder.has(String(t.object_id))) loose.push({ rate, t });
  }
  let note = '';
  if (loose.length) {
    const prices = await Promise.all(loose.map((f) => rateInfo(apiKey, f.rate)));
    const boxes: RecordBox[] = loose.map((f, i) => ({ txn: String(f.t.object_id), tracking: String(f.t.tracking_number || ''), labelUrl: String(f.t.label_url || ''), trackingUrl: String(f.t.tracking_url_provider || ''), parcel: null, ...(prices[i].cents > 0 ? { cents: prices[i].cents } : {}) }));
    const v = await voidUnsavedLabel(db, tenantId, apiKey, {
      orderId, order: cur, boxes, cents: prices.reduce((a, p) => a + p.cents, 0), carrier: prices[0]?.provider || String(cur?.carrier || 'Carrier'), service: prices[0]?.service || '',
      rateId: loose[0].rate, rateIds: [...new Set(loose.map((f) => f.rate))], by, how: 'single', why: 'voided: an earlier purchase that was cut off had bought it',
    }).catch(() => null);
    const end = String(boxes[0].tracking || '').replace(/\s+/g, '').slice(-4);
    note = v?.outcome === 'voided' ? `A label an earlier try had bought without saving${end ? ` (tracking ending ${end})` : ''} was voided, so its postage comes back.` : `An earlier try had bought a label without saving it; ${unsavedNote(v, boxes[0].tracking)}.`;
    // Neither voided nor kept on record: asked about again next time, so it isn't forgotten.
    if (v?.outcome !== 'voided' && !v?.tracked) keep.push(...loose.map((f) => f.rate));
    const at = new Date().toISOString();
    const ev = ref.collection('events').doc();
    await ev.set({ id: ev.id, type: 'note', at, actorId: by.id || 'shippo', actorName: by.name || 'Shippo', meta: { kind: 'label_cut_off', text: note } }).catch(() => {});
  }
  const left = [...new Set(keep)];
  await ref.set(left.length ? { labelBuyDoubt: { rates: left, at: cur?.labelBuyDoubt?.at || new Date().toISOString() }, labelBuyDoubtOpen: true } : { labelBuyDoubt: null, labelBuyDoubtOpen: false }, { merge: true }).catch(() => {});
  return { note, wait: left.length > 0 };
}

/** The morning check (api/cron/label-money): every order with a purchase in doubt (cut off, or no answer from Shippo)
 *  that nobody is buying a label for right now gets its doubt settled, so a label made and never saved doesn't wait for
 *  someone to buy that order another one. */
export async function settleDoubts(db: any, tenantId: string, apiKey: string, deadline: number): Promise<number> {
  const snap = await db.collection(`tenants/${tenantId}/retailOrders`).where('labelBuyDoubtOpen', '==', true).limit(20).get().catch(() => null);
  let settled = 0;
  for (const d of snap?.docs || []) {
    if (Date.now() > deadline - 10000) break;
    const claim = await claimLabelBuy(db, d.ref, 'Morning check', Date.now(), undefined, 'void');
    if ('error' in claim) continue;
    try {
      if (claim.doubt.length) { await settleDoubtfulBuy(db, tenantId, apiKey, d.ref, d.id, d.data() || {}, claim.doubt, { id: 'shippo', name: 'Morning check' }); settled++; }
      else await d.ref.set({ labelBuyDoubtOpen: false }, { merge: true }).catch(() => {});
    } finally { await releaseLabelBuy(db, d.ref, claim.token); }
  }
  return settled;
}

/** What to tell the person about a label voided straight away, to finish "…so ___." */
export function unsavedNote(v: UnsavedVoid | null, tracking: string): string {
  if (v?.outcome === 'voided') return 'that label was voided straight away';
  if (v?.tracked) return 'it wasn’t saved. Voiding it hasn’t gone through yet: it’s tried again over the next few days, and it shows under Labels until it’s refunded';
  const end = String(tracking || '').replace(/\s+/g, '').slice(-4);
  return `it wasn’t saved, and it couldn’t be voided here. Void it in Shippo${end ? ` (tracking ending ${end})` : ''} so the postage comes back`;
}

/** After a save that failed part way (the database didn't answer), whether the order carries the label just bought:
 *  the save went through after all. Null when even that can't be read. */
export async function carriesLabel(ref: any, txn: string): Promise<boolean | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const o: any = (await ref.get()).data() || {};
      return String(o.shippoTransactionId || '') === txn || (Array.isArray(o.labelTxns) && o.labelTxns.includes(txn));
    } catch { await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  return null;
}
