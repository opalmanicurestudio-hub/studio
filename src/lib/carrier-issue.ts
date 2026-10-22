// src/lib/carrier-issue.ts — A PARCEL THE CARRIER IS HAVING TROUBLE WITH, as the shipping webhook hears it: going back to
// the sender, or a delivery that failed. It's raised once per carrier event (that box, that status, at that time), so a
// retry or a re-read of one already raised never brings it back, even after someone marked it sorted or another box of
// the order had a problem since; a second failed delivery does. It clears itself when that box is delivered, or when a
// quiet one (flagged by the nightly check, lib/retail-sweeps) is scanned again after the scan it was flagged on.
// Shown under Carrier on Today and under Needs you (lib/ship-day carrierItem). Pure.
import { carrierName } from './ship-promise';

/** The fields to write on the order for this scan; empty when nothing changes. */
export function carrierIssueUpdate(order: any, trackingNumber: string, status: string, update: { statusAt?: string | null; detail?: string | null; carrier?: string | null }, now: number): Record<string, any> {
  const st = String(status || '');
  const statusAtMs = Date.parse(String(update?.statusAt || ''));
  const key = `${trackingNumber}|${st}|${Number.isFinite(statusAtMs) ? new Date(statusAtMs).toISOString() : ''}`;
  const raised: string[] = Array.isArray(order?.carrierIssueKeys) ? order.carrierIssueKeys.map(String) : [];
  const prev = order?.carrierIssue || null;
  const newer = (at: unknown) => Number.isFinite(statusAtMs) && statusAtMs > (Date.parse(String(at || '')) || 0);
  if (st === 'RETURNED' || st === 'FAILURE') {
    const seen = raised.includes(key) || (prev?.tracking === trackingNumber && prev?.status === st && !newer(prev?.at));
    if (seen) return {};
    return {
      // Every field written, so nothing from an earlier problem (who saw it, when it closed) carries over.
      carrierIssue: { open: true, status: st, detail: String(update?.detail || ''), carrier: carrierName(order?.carrier || update?.carrier), tracking: trackingNumber, at: update?.statusAt || null, key,
        quietDays: null, unscanned: null, customerTold: null, toldAt: null, snoozeUntil: null, outcome: null, seenAt: null, seenBy: null, closedAt: null, closedBy: null },
      carrierIssueKeys: [...raised, key].slice(-20),
    };
  }
  const clears = prev?.open === true && prev.tracking === trackingNumber
    && (st === 'DELIVERED' || (prev.status === 'STALLED' && ['TRANSIT', 'OUT_FOR_DELIVERY'].includes(st) && newer(prev.at)));
  return clears ? { carrierIssue: { ...prev, open: false, closedAt: new Date(now).toISOString(), closedBy: 'carrier' } } : {};
}
