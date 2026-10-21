// src/lib/address-flow-server.ts — the server half of lib/address-flow.
//   A signed check: the carrier check made while the customer was still choosing travels back with their order, so
//   checkout (and an address change) uses it instead of paying the carrier for the same answer twice. It's bound to the
//   shop and to the address it was made for (or the carrier's version of it), and lasts two hours.
//   A limit on checks: they cost the shop a little each, so one visitor can't run up the bill.
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { addressKey, type Address } from '@/lib/address-flow';
import type { AddressCheck } from '@/lib/address-validation';

const secret = () => process.env.RETAIL_QR_SECRET || process.env.STRIPE_SECRET_KEY || 'dev-secret';
const TTL_MS = 2 * 3600e3;
const sign = (body: string) => createHmac('sha256', secret()).update(`addr.${body}`).digest('base64url');

export function signCheck(tenantId: string, typed: Address, check: AddressCheck): string {
  const body = Buffer.from(JSON.stringify({ t: tenantId, k: addressKey(typed), ck: check.carrier ? addressKey(check.carrier) : '', c: check, at: Date.now() })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The check made for this exact address: the one they typed, or the carrier's version they picked. Null when the token
 *  is missing, altered, old, for another shop, or for a different address. */
export function checkFromToken(tenantId: string, token: unknown, submitted: Address | null | undefined): { check: AddressCheck; picked: 'typed' | 'suggested' } | null {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !submitted) return null;
  const want = sign(body);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  let p: any; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p?.t !== tenantId || !(Date.now() - Number(p.at) < TTL_MS) || !p.c) return null;
  const k = addressKey(submitted);
  if (k === p.k) return { check: p.c as AddressCheck, picked: 'typed' };
  // The carrier's own version is, by definition, one the carrier knows.
  if (p.ck && k === p.ck) return { check: { ...(p.c as AddressCheck), verdict: 'valid', suggestion: null, carrier: null, unitMissing: false }, picked: 'suggested' };
  return null;
}

/** Up to 12 checks per visitor per shop every 15 minutes. */
export async function checkAllowed(db: any, tenantId: string, who: string): Promise<boolean> {
  const key = `addr_${createHash('sha256').update(String(who || 'anon')).digest('hex').slice(0, 24)}`;
  const ref = db.doc(`tenants/${tenantId}/counters/${key}`);
  try {
    return await db.runTransaction(async (tx: any) => {
      const d: any = (await tx.get(ref)).data() || {}; const now = Date.now();
      const fresh = !d.windowStart || now - Date.parse(d.windowStart) > 15 * 60000;
      const count = fresh ? 1 : (Number(d.count) || 0) + 1;
      if (count > 12) return false;
      tx.set(ref, { windowStart: fresh ? new Date(now).toISOString() : d.windowStart, count }, { merge: true });
      return true;
    });
  } catch { return true; }
}
