// src/lib/label-boxes.ts — ONE LABEL PER BOX. Pure, so the server and the screens agree on which box is which.
// An order shipped in several boxes keeps each box's label in the same position across its fields: box 1 is
// trackingNumber / labelUrl / trackingUrl, box 2 onward are extraTrackingNumbers / extraLabelUrls / extraTrackingUrls,
// and labelTxns holds each box's Shippo label (labelRecs: the label record it was bought on, lib/label-records).
// A box whose label was voided while the others weren't (the carrier already had one of them, or one box's label was
// replaced) stays in its place, listed in labelVoidIds, until it gets a new label or is taken off the order. Orders
// whose labels were bought before labelTxns existed can't tell their boxes apart, so none of them counts as voided here.

export type LabelSlot = {
  slot: number; txn: string; tracking: string; labelUrl: string; trackingUrl: string; record: string;
  /** Its label was voided and it needs a new one (or to come off the order) before it goes out. */
  voided: boolean;
};

/** One box as a label record keeps it. `parcel` is the size and weight the label was bought for, when known. */
export type RecordBox = { txn: string; tracking: string; labelUrl: string; trackingUrl: string; parcel?: Parcel | null; replacedBy?: string | null };
export type Parcel = { lengthIn: number; widthIn: number; heightIn: number; weightOz: number };

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()) : []);

/** Every box on the order, in order. Empty when the order has no label and no tracking. */
export function labelSlots(o: any): LabelSlot[] {
  const tracking = [String(o?.trackingNumber || '').trim(), ...list(o?.extraTrackingNumbers)];
  const urls = [String(o?.labelUrl || '').trim(), ...list(o?.extraLabelUrls)];
  const links = [String(o?.trackingUrl || '').trim(), ...list(o?.extraTrackingUrls)];
  const txns = list(o?.labelTxns);
  const recs = list(o?.labelRecs);
  if (!tracking[0] && !urls[0] && !txns[0] && !String(o?.shippoTransactionId || '')) return [];
  const n = Math.max(1, tracking.length, urls.length, txns.length);
  const known = txns.length === n;
  const voidIds = new Set(list(o?.labelVoidIds));
  return Array.from({ length: n }, (_, i) => {
    const txn = txns[i] || (i === 0 ? String(o?.shippoTransactionId || '') : '');
    return { slot: i, txn, tracking: tracking[i] || '', labelUrl: urls[i] || '', trackingUrl: links[i] || '', record: recs[i] || '', voided: known && !!txn && voidIds.has(txn) };
  });
}

/** Whether each box's own label is known (labelTxns lines up with the boxes), so one box can be told from another. */
export function slotsKnown(o: any): boolean {
  const txns = list(o?.labelTxns).filter(Boolean);
  return txns.length > 0 && txns.length === labelSlots(o).length;
}

export const voidedSlots = (o: any): LabelSlot[] => labelSlots(o).filter((s) => s.voided);
export const liveSlots = (o: any): LabelSlot[] => labelSlots(o).filter((s) => !s.voided);
/** The tracking numbers of boxes whose labels still work: what the customer, the bench and the carrier's updates use. */
export const liveTracking = (o: any): string[] => liveSlots(o).map((s) => s.tracking).filter(Boolean);
/** The label record each box was bought on. An order bought before labelRecs existed bought every box on one label,
 *  whose record is its first box's. */
export function recordOf(o: any, slot: number): string {
  const slots = labelSlots(o);
  const s = slots[slot];
  if (!s) return '';
  return s.record || labelKey(String(o?.shippoTransactionId || slots[0]?.txn || ''));
}

/** Where a box's label sits on the order now, found by its Shippo label (positions move when a box comes off). */
export const slotOfTxn = (o: any, txn: string): number => (txn ? labelSlots(o).findIndex((s) => s.txn === txn) : -1);

/** What the carrier last said about box `slot`, from the scans the shipping webhook keeps: its status (TRANSIT,
 *  DELIVERED…), when, and where. Empty when nothing has been scanned for that box's current label. */
export function boxTrail(o: any, slot: number): { status: string; at: string; where: string } {
  const s = labelSlots(o)[slot];
  if (!s || !s.tracking) return { status: '', at: '', where: '' };
  const main = o?.carrierTrail && (!o.carrierTrail.trackingNumber || String(o.carrierTrail.trackingNumber) === s.tracking) ? o.carrierTrail : null;
  const t = o?.boxTrails?.[s.tracking] || (slot === 0 ? main : null);
  const status = String(o?.boxStatus?.[s.tracking] || t?.carrierStatus || t?.status || (slot === 0 && main ? o?.carrierStatus : '') || '').toUpperCase();
  return { status, at: String(t?.carrierStatusAt || ''), where: String(t?.carrierLocation || '') };
}

/** A label record's id: its first box's Shippo label. */
export const labelKey = (txn: unknown): string => String(txn || '').replace(/[^\w-]/g, '');

/** Box `i` of `n`'s share of a label's price, in cents. The shares always add up to the whole. */
export function boxShare(totalCents: number, n: number, i: number): number {
  const total = Math.max(0, Math.round(Number(totalCents) || 0)); const k = Math.max(1, Math.floor(n) || 1);
  return Math.floor(total / k) + (i < total % k ? 1 : 0);
}

export type SlotLabel = { txn: string; tracking: string; labelUrl: string; trackingUrl: string; record: string };

/**
 * The order's label fields once box `slot` has a new label (`next`), or once it's taken off the order (`next` null,
 * only for a box whose label was voided, and never the last box). Every field moves together, so box numbers stay
 * lined up. A new label isn't checked at the bench yet, so the order isn't counted as checked until it is.
 */
export function slotPatch(o: any, slot: number, next: SlotLabel | null): Record<string, any> | null {
  const slots = labelSlots(o);
  const old = slots[slot];
  if (!old || !slotsKnown(o)) return null;
  if (!next && (!old.voided || slots.length < 2)) return null;
  const rows: SlotLabel[] = slots.map((s) => ({ txn: s.txn, tracking: s.tracking, labelUrl: s.labelUrl, trackingUrl: s.trackingUrl, record: s.record || labelKey(slots[0].txn) }));
  if (next) rows[slot] = next; else rows.splice(slot, 1);
  const voidIds = list(o?.labelVoidIds).filter((t) => t && t !== old.txn && rows.some((r) => r.txn === t));
  const checked = list(o?.labelsChecked).filter((t) => t && t !== old.tracking && rows.some((r) => r.tracking === t));
  const allChecked = rows.every((r) => !r.tracking || checked.includes(r.tracking));
  return {
    trackingNumber: rows[0].tracking, labelUrl: rows[0].labelUrl, trackingUrl: rows[0].trackingUrl, shippoTransactionId: rows[0].txn,
    extraTrackingNumbers: rows.slice(1).map((r) => r.tracking), extraLabelUrls: rows.slice(1).map((r) => r.labelUrl), extraTrackingUrls: rows.slice(1).map((r) => r.trackingUrl),
    labelTxns: rows.map((r) => r.txn), labelRecs: rows.map((r) => r.record), packageCount: rows.length,
    labelVoidIds: voidIds, labelsChecked: checked, ...(next || !allChecked ? { labelCheckedAt: null } : {}),
    relabelOpen: voidIds.length > 0,
  };
}

/** Why a label was replaced, as the person chose it. */
export const REPLACE_REASONS = [
  { id: 'size', title: 'Wrong box size or weight', sub: 'The box changed after the label was bought.' },
  { id: 'damaged', title: 'The label is damaged or won’t scan', sub: 'Same box, same service: just a fresh label.' },
  { id: 'service', title: 'A different service', sub: 'Faster, cheaper, or what the customer paid for.' },
  { id: 'other', title: 'Something else', sub: 'Add a note so the record says why.' },
] as const;
export type ReplaceReason = { kind: string; note?: string };

/** Why a label was voided by hand without a new one. */
export const VOID_REASONS = [
  { id: 'not_shipping', title: 'It isn’t going out' },
  { id: 'mistake', title: 'Bought by mistake' },
  { id: 'other', title: 'Something else' },
] as const;

export function reasonLine(r: ReplaceReason | null | undefined): string {
  if (!r) return '';
  const found = REPLACE_REASONS.find((x) => x.id === r.kind);
  const note = String(r.note || '').trim();
  if (!found) return note;
  if (r.kind === 'other') return note || found.title;
  return note ? `${found.title}: ${note}` : found.title;
}

/** The end of a tracking number, enough to tell boxes apart: "…4471". */
export const tail = (n: unknown): string => { const s = String(n || '').replace(/\s+/g, ''); return s ? `…${s.slice(-4)}` : ''; };

/** "2 lb 6 oz", "14 oz". */
export function weightLabel(oz: unknown): string {
  const v = Math.max(0, Math.round(Number(oz) || 0));
  const lb = Math.floor(v / 16); const rest = v % 16;
  return lb ? (rest ? `${lb} lb ${rest} oz` : `${lb} lb`) : `${rest} oz`;
}
