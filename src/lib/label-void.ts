// src/lib/label-void.ts — VOID AN ORDER'S LABELS, every box's, so the postage comes back. Server only. Used when the
// address changes after the label was bought, when a label lands after the address changed, and by the label route's
// own "void" action. An order shipped in several boxes has one label per box; they were bought together on one rate,
// so they're found through that rate.
//   All or nothing, honestly: if the other boxes can't be found, nothing is voided; if some boxes void and others
//   don't, it says so and returns the ones that did (callers keep them, so trying again picks up where it stopped).
//   A label the carrier already refunded counts as voided, so a retry after an interruption finishes the job.
import { reversePostage } from '@/lib/postage';

const SHIPPO = 'https://api.goshippo.com';
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };
// "Already refunded" means our earlier void went through. "Already used" (scanned by the carrier) means it can't be voided.
const ALREADY = /already (been )?refunded|refund[^.]{0,40}already exists|already (has|have) a refund|refund (was|has been) already requested/i;
const NOT_VOIDABLE = /used|scanned|in transit|not eligible|cannot be refunded|can't be refunded|can’t be refunded/i;
// Turned down because the carrier already has the box: it's on its way, so its label must stay on the order. ("Not
// eligible" is left out: it doesn't say why.)
const IN_USE = /\bused\b|scanned|in transit/i;

/** What an order looks like once its labels are voided: no label, no tracking, nothing checked at the bench. */
export const LABEL_CLEARED = {
  trackingNumber: '', carrier: '', trackingUrl: '', labelUrl: '', shippoTransactionId: '',
  extraLabelUrls: [] as string[], extraTrackingNumbers: [] as string[], extraTrackingUrls: [] as string[], labelsChecked: [] as string[], labelCheckedAt: null,
  labelVoidIds: [] as string[],
  // A voided label isn't waiting for a scan any more (lib/label-sweep), and it's on no carrier form (api/retail/close-day).
  // What the morning check knew about it (seen moving, voids turned down) goes with it: a new label starts fresh.
  labelUnscanned: null, labelUnscannedOpen: false, manifestId: null, manifestedAt: null, labelVoiding: null,
  labelSeenMoving: null, autoVoid: null,
};

/** An order that went in another order's box (lib/ship-together), once that box's label is voided: its copy goes too. */
export const SHARED_CLEARED = {
  trackingNumber: '', carrier: '', trackingUrl: '', labelUrl: '',
  extraLabelUrls: [] as string[], extraTrackingNumbers: [] as string[], extraTrackingUrls: [] as string[], labelsChecked: [] as string[], labelCheckedAt: null,
  labelFromOrderId: null, shippedWithOrderId: null, shipTogetherAt: null,
};

/** How it ended. voided: every box. moving: Shippo said a box was already used (the carrier has it), so the label stays
 *  on the order. partial: some boxes voided and Shippo said no to the rest, so the label can't ship as it is. refused:
 *  nothing voided, so the label works as before. unknown: some box got no real answer (no response, a timeout, or a
 *  server error that may have come after Shippo made the refund), so it may or may not have gone through. `refusal` is
 *  Shippo's own words for a box it turned down; `total` is how many boxes the label has. */
export type VoidResult = { ok: boolean; outcome: 'voided' | 'moving' | 'partial' | 'refused' | 'unknown'; error?: string; refusal?: string; status?: string; count: number; total: number; voidedIds: string[]; trackingNumbers: string[]; uncertain?: boolean;
  /** Boxes that got no real answer, so may or may not be voided. */
  unanswered?: number };

export async function voidOrderLabels(db: any, tenantId: string, order: any, apiKey: string, opts: { alreadyVoided?: string[] } = {}): Promise<VoidResult> {
  const master = String(order?.shippoTransactionId || '').trim();
  const trackingNumbers = [order?.trackingNumber, ...(Array.isArray(order?.extraTrackingNumbers) ? order.extraTrackingNumbers : [])].map((x: any) => String(x || '').trim()).filter(Boolean);
  if (!master) return { ok: true, outcome: 'voided', count: 0, total: 0, voidedIds: [], trackingNumbers: [] };
  if (!apiKey) return { ok: false, outcome: 'refused', error: 'Shippo isn’t connected, so the label can’t be voided here.', count: 0, total: 0, voidedIds: [], trackingNumbers };
  const auth = { Authorization: `ShippoToken ${apiKey}` };
  const ids = [master];
  const extra = Array.isArray(order?.extraLabelUrls) ? order.extraLabelUrls.length : 0;
  if (extra > 0) {
    try {
      const t: any = await fetch(`${SHIPPO}/transactions/${encodeURIComponent(master)}`, { headers: auth, signal: timeout(15000) }).then((r) => r.json());
      const rate = typeof t?.rate === 'string' ? t.rate : t?.rate?.object_id;
      if (rate) {
        const list: any = await fetch(`${SHIPPO}/transactions/?rate=${encodeURIComponent(rate)}&results=25`, { headers: auth, signal: timeout(15000) }).then((r) => r.json());
        for (const x of list?.results || []) if (x?.status === 'SUCCESS' && x.object_id && !ids.includes(String(x.object_id))) ids.push(String(x.object_id));
      }
    } catch { /* counted below */ }
    if (ids.length < 1 + extra) return { ok: false, outcome: 'refused', error: 'Couldn’t find every box’s label to void, so none were voided. Try again in a minute.', count: 0, total: 1 + extra, voidedIds: [], trackingNumbers };
  }
  const done = new Set((opts.alreadyVoided || []).map(String));
  const failed: string[] = []; let noAnswer = 0; let inUse = 0; let refusal = '';
  let status = done.has(master) ? 'PENDING' : '';
  for (const id of ids) {
    if (done.has(id)) continue;
    const r = await fetch(`${SHIPPO}/refunds/`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: id, async: false }), signal: timeout(15000) }).catch(() => null);
    const d: any = r ? await r.json().catch(() => ({})) : {};
    const said = String(d?.detail || d?.__all__?.[0] || d?.transaction?.[0] || JSON.stringify(d || {})).slice(0, 300);
    if (r && r.ok) { done.add(id); if (id === master) status = String(d.status || 'PENDING'); continue; }
    if (r && ALREADY.test(said) && !NOT_VOIDABLE.test(said)) { done.add(id); if (id === master) status = 'PENDING'; continue; }
    if (!r || r.status >= 500 || r.status === 408) noAnswer++;
    else { if (IN_USE.test(said)) inUse++; if (!refusal) refusal = said; }
    failed.push(id);
  }
  const voidedIds = ids.filter((id) => done.has(id));
  if (failed.length) {
    // A box the carrier has is a fact, whatever else happened; then no answer; then what Shippo said.
    const outcome = inUse > 0 ? 'moving' : noAnswer > 0 ? 'unknown' : voidedIds.length ? 'partial' : 'refused';
    // Some boxes voided and nothing left in doubt: their share of the postage comes back, into the books now.
    if ((outcome === 'partial' || outcome === 'moving') && voidedIds.length) await reversePostage(db, tenantId, master, voidedIds.length / ids.length).catch(() => {});
    return { ok: false, outcome, error: voidedIds.length ? `${voidedIds.length} of ${ids.length} labels voided; the rest didn’t go through. Try again in a minute.` : 'The label couldn’t be voided. Try again in a minute.', refusal: refusal.slice(0, 160), count: voidedIds.length, total: ids.length, voidedIds, trackingNumbers, uncertain: noAnswer > 0, unanswered: noAnswer };
  }
  await reversePostage(db, tenantId, master).catch(() => {});
  return { ok: true, outcome: 'voided', status, count: ids.length, total: ids.length, voidedIds, trackingNumbers };
}
