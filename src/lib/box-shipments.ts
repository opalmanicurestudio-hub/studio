// src/lib/box-shipments.ts — LABELS FOR AN ORDER'S BOXES. Server only.
// Shippo puts several boxes on one shipment only for UPS and FedEx; USPS takes one box per shipment. So an order in
// several boxes is priced and bought one shipment per box, the same way for every carrier: a service is offered when
// every box can go by it with the same carrier account, at what the boxes cost together (the insurance in that price
// summed too), and buying it buys each box's own label, box 1 first. One box is one shipment, as always.
//   A combined rate is written "boxes:<rate>,<rate>…", one rate per box in box order, so the screens pass it around
// like any rate id. If a box's label doesn't go through after others did, the ones bought are handed back for the caller
// to void (lib/label-void voidUnsavedLabel), so nothing half-bought stays live. A purchase Shippo didn't answer is looked
// up by its rate before it's called failed: it may have gone through.
import { rateInfo } from './label-records';
import type { Parcel, RecordBox } from './label-boxes';

const SHIPPO = 'https://api.goshippo.com';
const timeout = (ms: number): AbortSignal | undefined => { try { return (AbortSignal as any).timeout(ms); } catch { return undefined; } };

/** A rate made of each box's own, one per box in box order. */
export const BOX_RATES = 'boxes:';
export const isBoxRates = (id: unknown): boolean => String(id || '').startsWith(BOX_RATES);
/** Each box's rate: the parts of a combined rate, or the rate itself. */
export const rateIdsOf = (id: unknown): string[] => {
  const s = String(id || '').trim();
  return (isBoxRates(s) ? s.slice(BOX_RATES.length).split(',') : [s]).map((x) => x.trim()).filter(Boolean).slice(0, 10);
};

/** A box as Shippo takes it (length, width, height, distance_unit, weight, mass_unit), with its own extra if any. */
export type ShippoParcel = { [k: string]: any; extra?: Record<string, unknown> };

const cents = (v: unknown) => { const c = Math.round(parseFloat(String(v ?? '')) * 100); return Number.isFinite(c) ? c : NaN; };

async function post(apiKey: string, path: string, payload: any, ms: number): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`${SHIPPO}${path}`, { method: 'POST', headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: timeout(ms) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

const said = (d: any, status: number) => String(d?.detail || (Array.isArray(d?.messages) ? d.messages.map((m: any) => m?.text).filter(Boolean).join('; ') : '') || d?.__all__?.[0] || `HTTP ${status}`).slice(0, 300);

/**
 * Rates for the boxes: one shipment for one box, one per box (in parallel) for several. `extra` is the shipment's own
 * (signature, the order reference); a box's own extra (its share of the insurance, lib/shipment-protection
 * insuredParcels) goes on its shipment. The rates come back shaped as Shippo gives them, a combined one too (object_id,
 * provider, servicelevel, amount, estimated_days, included_insurance_price, carrier_account), with `boxCents`: what each
 * box's label costs.
 */
export async function rateBoxes(apiKey: string, p: { from: any; to: any; parcels: ShippoParcel[]; extra?: Record<string, unknown> | null; ms?: number }): Promise<{ rates: any[]; shipmentIds: string[] }> {
  const ms = p.ms ?? 30000;
  const list = p.parcels.slice(0, 10);
  if (list.length <= 1) {
    const r = await post(apiKey, '/shipments/', { address_from: p.from, address_to: p.to, parcels: list, async: false, ...(p.extra ? { extra: p.extra } : {}) }, ms);
    if (!r.ok) throw new Error(`Shippo: ${said(r.data, r.status)}`);
    const rates = (Array.isArray(r.data?.rates) ? r.data.rates : []).map((x: any) => ({ ...x, boxCents: [cents(x.amount)] }));
    return { rates, shipmentIds: [String(r.data?.object_id || '')] };
  }
  const shipments = await Promise.all(list.map(async ({ extra: own, ...parcel }) => {
    const extra = { ...(p.extra || {}), ...(own || {}) };
    const r = await post(apiKey, '/shipments/', { address_from: p.from, address_to: p.to, parcels: [parcel], async: false, ...(Object.keys(extra).length ? { extra } : {}) }, ms);
    if (!r.ok) throw new Error(`Shippo: ${said(r.data, r.status)}`);
    return r.data;
  }));
  return { rates: combineRates(shipments.map((s) => (Array.isArray(s?.rates) ? s.rates : []))), shipmentIds: shipments.map((s) => String(s?.object_id || '')) };
}

/** One service across every box (same carrier account and service), at the boxes' prices added up; a service a box
 *  can't go by isn't offered. Pure. */
export function combineRates(perBox: any[][]): any[] {
  const key = (r: any) => `${String(r?.carrier_account || r?.provider || '').toLowerCase()}|${String(r?.servicelevel?.token || r?.servicelevel?.name || '').toLowerCase()}`;
  const maps = perBox.map((rates) => {
    const m = new Map<string, any>();
    for (const r of rates || []) {
      const c = cents(r?.amount);
      if (!r?.object_id || !Number.isFinite(c)) continue;
      const k = key(r); const cur = m.get(k);
      if (!cur || c < cents(cur.amount)) m.set(k, r);
    }
    return m;
  });
  if (!maps.length) return [];
  const out: any[] = [];
  for (const [k, first] of maps[0]) {
    const parts = maps.map((m) => m.get(k));
    if (parts.some((x) => !x)) continue;
    const each = parts.map((x) => cents(x.amount));
    const ins = parts.reduce((a, x) => a + Math.max(0, cents(x.included_insurance_price) || 0), 0);
    const days = parts.map((x) => Number(x.estimated_days)).filter((d) => Number.isFinite(d));
    out.push({
      ...first,
      object_id: `${BOX_RATES}${parts.map((x) => String(x.object_id)).join(',')}`,
      amount: (each.reduce((a, c) => a + c, 0) / 100).toFixed(2),
      included_insurance_price: (ins / 100).toFixed(2),
      estimated_days: days.length ? Math.max(...days) : first.estimated_days ?? null,
      boxCents: each,
    });
  }
  return out;
}

/** A label Shippo made for a rate, when a purchase got no answer: it may have gone through all the same. */
async function boughtFor(apiKey: string, rateId: string): Promise<any | null> {
  try {
    const r = await fetch(`${SHIPPO}/transactions/?rate=${encodeURIComponent(rateId)}&results=25`, { headers: { Authorization: `ShippoToken ${apiKey}` }, signal: timeout(15000) });
    const d: any = await r.json().catch(() => ({}));
    return (d?.results || []).find((t: any) => t?.status === 'SUCCESS' && t?.object_id && t?.label_url) || null;
  } catch { return null; }
}

export type Bought = { ok: true; txns: any[] } | { ok: false; error: string; bought: any[]; unanswered?: boolean };

/**
 * Buys a rate: one box's, or each box's of a combined rate, box 1 first. Stops at the first box that doesn't go
 * through and hands back the ones already bought, for the caller to void.
 */
export async function buyBoxes(apiKey: string, rateId: string, fileType: string, ms = 30000): Promise<Bought> {
  const ids = rateIdsOf(rateId);
  if (!ids.length) return { ok: false, error: 'No rate chosen.', bought: [] };
  const txns: any[] = [];
  for (const id of ids) {
    let t: any = null; let error = ''; let unanswered = false;
    try {
      const r = await post(apiKey, '/transactions/', { rate: id, label_file_type: fileType, async: false }, ms);
      const st = String(r.data?.status || '').toUpperCase();
      if (r.ok && st === 'SUCCESS') t = r.data;
      // Still being made, or no real answer: it may finish all the same.
      else if ((r.ok && ['QUEUED', 'WAITING'].includes(st)) || (!r.ok && (r.status >= 500 || r.status === 408))) unanswered = true;
      else error = (Array.isArray(r.data?.messages) ? r.data.messages.map((m: any) => m?.text).filter(Boolean).join('; ') : '') || said(r.data, r.status) || 'Label purchase failed';
    } catch { unanswered = true; }
    // No real answer: the label may have been made anyway. Shippo is asked once before it counts as not bought.
    if (!t && unanswered) { t = await boughtFor(apiKey, id); if (!t) error = 'Shippo didn’t answer. Nothing was charged for this box.'; }
    if (!t) return { ok: false, error: ids.length > 1 ? `Box ${txns.length + 1}: ${error}` : error, bought: txns, unanswered };
    txns.push(t);
  }
  return { ok: true, txns };
}

/** Prices for a rate (or for each box's rate, given as a list), from Shippo: the total, each box's, the insurance in it,
 *  and its carrier and service. */
export async function priceOf(apiKey: string, rate: string | string[]): Promise<{ cents: number; boxCents: number[]; insuranceCents: number; shipment: string; provider: string; service: string; account: string; rateIds: string[] }> {
  const ids = Array.isArray(rate) ? rate.map(String).filter(Boolean) : rateIdsOf(rate);
  const infos = await Promise.all(ids.map((id) => rateInfo(apiKey, id)));
  const first = infos[0] || { cents: 0, shipment: '', provider: '', service: '', insuranceCents: 0, account: '' };
  return {
    cents: infos.reduce((a, i) => a + i.cents, 0), boxCents: infos.map((i) => i.cents), insuranceCents: infos.reduce((a, i) => a + i.insuranceCents, 0),
    shipment: first.shipment, provider: first.provider, service: first.service, account: first.account, rateIds: ids,
  };
}

/** The boxes as a label record keeps them, from each box's own label (box order), with each box's size and price. */
export function boxesFrom(txns: any[], parcels: (Parcel | null)[], prices: number[]): RecordBox[] {
  return txns.map((t, i) => ({
    txn: String(t?.object_id || ''), tracking: String(t?.tracking_number || ''), labelUrl: String(t?.label_url || ''), trackingUrl: String(t?.tracking_url_provider || ''),
    parcel: parcels[i] || null, ...(Number(prices[i]) > 0 ? { cents: Math.round(Number(prices[i])) } : {}),
  }));
}
