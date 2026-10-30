// src/lib/device-limit-server.ts — COUNTING A BUYER'S DEVICES AS THEY OPEN A DOWNLOAD (server), for lib/device-limit.
// The device is known by a random id the browser keeps (a cookie only the server reads, with a copy in the page's own
// storage in case the cookie is cleared or blocked). Only a hash of it is stored, tied to the shop, so the shop's list
// never holds anything that could be used to pass as that device. One transaction per open, so two new devices at
// once can't both take the last place.
import { createHash, randomBytes } from 'crypto';
import { devicesOf, deviceStep, type Device } from './device-limit';

export const DEVICE_COOKIE = 'cf_dv';
const OK_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The device's id: the cookie, else the page's copy, else a new one (a device seen for the first time). */
export function deviceIdFrom(cookie: unknown, fromPage: unknown): { id: string; fresh: boolean } {
  const c = String(cookie || ''); if (OK_ID.test(c)) return { id: c, fresh: false };
  const p = String(fromPage || ''); if (OK_ID.test(p)) return { id: p, fresh: false };
  return { id: randomBytes(18).toString('base64url'), fresh: true };
}

/**
 * What's stored for a device: a hash of its id and its browser (Safari, Chrome...), for this shop only. An id copied
 * into another browser is a different device; asking for a desktop site, which changes how the device describes
 * itself but not the browser, is not.
 */
export const deviceKey = (tenantId: string, id: string, browser = '') => createHash('sha256').update(`device:${tenantId}:${id}:${browser}`).digest('base64url').slice(0, 22);

/**
 * Counts one open from a device on a buyer's record, or refuses a new device once the list is full. A refusal is
 * counted on the record (how many, the last one and on what), so the shop can see a list being outgrown or shared.
 */
export async function useDevice(db: any, tenantId: string, entId: string, key: string, label: string, cap: number): Promise<{ ok: boolean; devices: Device[] }> {
  const ref = db.doc(`tenants/${tenantId}/entitlements/${entId}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new Error('access record missing');
    const e: any = s.data();
    const now = new Date().toISOString();
    const r = deviceStep(devicesOf(e), key, label, cap, now);
    if (r.changed) tx.set(ref, { devices: r.devices }, { merge: true });
    if (!r.ok) tx.set(ref, { deviceRefused: { count: Math.max(0, Math.floor(Number(e?.deviceRefused?.count) || 0)) + 1, at: now, label: String(label || 'A device').slice(0, 60) } }, { merge: true });
    return { ok: r.ok, devices: r.devices };
  });
}
