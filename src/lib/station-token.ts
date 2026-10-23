// src/lib/station-token.ts — PROOF FOR THE CONCIERGE KIOSK (server only).
//
// The concierge menu can be opened by anyone, so anything it does with someone's money needs proof:
//
//   "This order comes from that station." A renter's station link carries a signature the server made for that space
//   and its current renter (/concierge/{shop}?booth={space}&k={signature}). Charging an order to the renter's saved card,
//   or using the renter's complimentary allowance, needs it. A link made before signatures existed still opens the
//   menu, but can't charge. The owner can make a new link at any time; the old one then stops charging. A new renter in
//   the space gets a new link, because the signature names the renter.
//
//   "This is that guest's phone." A guest who wants something charged to their own card on file, added to their visit,
//   or taken from their club allowance gets a 6-digit code by text at the number the business has for them. The right
//   code gives the kiosk a guest pass for that number, good for four hours (one visit). Codes last ten minutes, take
//   five wrong tries at most, and no more than five are sent to one number in an hour.
//
// Signatures use the same server secret as the order pages (ORDER_PASS_SECRET, else CRON_SECRET, else the server's
// own key). With none of them set, no signature is made or accepted, so nothing can be charged from the kiosk.
// Codes, link versions and kiosk charges live under tenants/{t}/private/…, which only the server can read or write.
import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto';
import { requireCan } from '@/lib/route-guard';
import { sendNotification } from '@/lib/notify';

const MIN = 60000, HOUR = 3600000;
export const CODE_MINUTES = 10, PASS_HOURS = 4, CODE_TRIES = 5, CODES_PER_HOUR = 5;

const secret = () => String(process.env.ORDER_PASS_SECRET || process.env.CRON_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || '');
const sign = (text: string) => { const s = secret(); return s ? createHmac('sha256', s).update(text).digest('base64url').slice(0, 32) : ''; };
const same = (a: string, b: string) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return !!a && x.length === y.length && timingSafeEqual(x, y); };
const last10 = (v: any) => String(v || '').replace(/\D/g, '').slice(-10);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const iso = (n: number) => new Date(n).toISOString();
const linksPath = (t: string) => `tenants/${t}/private/stationLinks`;
const codesPath = (t: string) => `tenants/${t}/private/kiosk/codes`;
const versionField = (boothId: string) => `v_${String(boothId || '').replace(/[^A-Za-z0-9_-]/g, '')}`;

// ── The station's signed link ───────────────────────────────────────────────

/** The signature for a station link: this business, this space, its renter, and the link's current version. */
export function makeStationToken(tenantId: string, boothId: string, renterId: string, version: number): string {
  const v = Math.max(1, Math.floor(Number(version) || 1));
  const sig = sign(`station:${tenantId}:${boothId}:${renterId}:${v}`);
  return sig ? `${v}.${sig}` : '';
}

export function checkStationToken(tenantId: string, boothId: string, renterId: string, token: unknown, version: number): boolean {
  const [v, sig] = String(token || '').split('.');
  if (!renterId || !sig || Number(v) !== Math.max(1, Math.floor(Number(version) || 1))) return false;
  return same(sign(`station:${tenantId}:${boothId}:${renterId}:${Number(v)}`), sig);
}

/** Which version of the space's link is current (1 until the owner makes a new one). */
export async function stationLinkVersion(db: any, tenantId: string, boothId: string): Promise<number> {
  const d: any = (await db.doc(linksPath(tenantId)).get()).data() || {};
  const v = Math.floor(Number(d[versionField(boothId)]) || 0);
  return v >= 1 ? v : 1;
}

/** A new link for the space: the old one stops charging. Returns the new version. */
export async function renewStationLink(db: any, tenantId: string, boothId: string): Promise<number> {
  const ref = db.doc(linksPath(tenantId)); const f = versionField(boothId);
  return db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(ref)).data() || {};
    const next = Math.max(1, Math.floor(Number(d[f]) || 1)) + 1;
    tx.set(ref, { [f]: next, [`${f}_renewedAt`]: new Date().toISOString() }, { merge: true });
    return next;
  });
}

/** The renter whose current lease covers the space, or '' when nobody rents it. */
export async function stationRenterId(db: any, tenantId: string, boothId: string): Promise<string> {
  if (!boothId) return '';
  const snap = await db.collection(`tenants/${tenantId}/leases`).where('boothId', '==', boothId).get();
  const lease = snap.docs.map((d: any) => d.data() || {}).find((l: any) => ['active', 'on_leave'].includes(String(l.status || '')));
  return lease?.renterId ? String(lease.renterId) : '';
}

/** Does this link's signature belong to the space and its current renter? */
export async function stationLinkOk(db: any, tenantId: string, boothId: string, token: unknown): Promise<{ ok: boolean; renterId: string }> {
  const renterId = await stationRenterId(db, tenantId, boothId);
  if (!renterId || !token) return { ok: false, renterId };
  const version = await stationLinkVersion(db, tenantId, boothId);
  return { ok: checkStationToken(tenantId, boothId, renterId, token, version), renterId };
}

/** The front desk signed in on this screen (someone allowed to take payments, and not a renter): it vouches for the
 *  station the screen was opened for, as the station's signed link does. */
export async function deskSignedIn(req: any, tenantId: string): Promise<boolean> {
  if (!/^bearer\s+\S/i.test(String(req?.headers?.get?.('authorization') || ''))) return false;
  const g: any = await requireCan(req, tenantId, 'checkout.take').catch(() => ({ deny: true }));
  return !g?.deny && g?.actor?.isRenter !== true;
}

// ── The guest's phone: a texted code, then a pass for the visit ──────────────

export function makeGuestPass(tenantId: string, phone: string, now = Date.now()): string {
  const exp = now + PASS_HOURS * HOUR; const sig = sign(`kioskpass:${tenantId}:${last10(phone)}:${exp}`);
  return sig ? `${exp}.${sig}` : '';
}

export function checkGuestPass(tenantId: string, phone: string, pass: unknown, now = Date.now()): boolean {
  const p = last10(phone); const [x, sig] = String(pass || '').split('.'); const exp = Number(x);
  if (p.length !== 10 || !sig || !Number.isFinite(exp) || exp < now || exp > now + PASS_HOURS * HOUR + MIN) return false;
  return same(sign(`kioskpass:${tenantId}:${p}:${exp}`), sig);
}

type Send = (db: any, msg: any) => Promise<any>;
const defaultSend: Send = (db, msg) => sendNotification(db, msg);

/** Text a 6-digit code to the number the business has on file (`to`). `phone` is the number the guest typed.
 *  For a number the business doesn't have (to: null), it answers exactly the same and sends nothing, so the answer
 *  never says whether a number belongs to a client; that code can't be confirmed. */
export async function startKioskCode(db: any, tenantId: string, o: { phone: string; to: string | null; name?: string | null; recipientType?: 'client' | 'contact'; recipientId?: string | null; now?: number; send?: Send }) {
  const now = o.now ?? Date.now(); const p = last10(o.phone);
  const deliver = !!o.to;
  if (p.length !== 10 || (deliver && last10(o.to) !== p)) return { ok: false as const, error: 'Enter your mobile number.' };
  if (!secret()) return { ok: false as const, error: 'Codes aren’t available here right now. Please ask the front desk.' };
  const phoneKey = hash(`${tenantId}:${p}`).slice(0, 32);
  const recent = (await db.collection(codesPath(tenantId)).where('phoneKey', '==', phoneKey).get()).docs
    .map((d: any) => d.data() || {}).filter((c: any) => Date.parse(String(c.createdAt || '')) > now - HOUR);
  if (recent.length >= CODES_PER_HOUR) return { ok: false as const, error: 'We’ve sent several codes already. Please wait a little while and try again.' };
  const code = String(randomInt(0, 1000000)).padStart(6, '0'); const ref = db.collection(codesPath(tenantId)).doc();
  // Nothing sent: the stored code is one nobody knows (a random value), so no guess confirms it.
  const codeHash = deliver ? hash(`${ref.id}:${code}`) : hash(`${ref.id}:${randomInt(0, 2 ** 47)}:${randomInt(0, 2 ** 47)}`);
  await ref.set({ id: ref.id, phoneKey, codeHash, createdAt: iso(now), expiresAt: iso(now + CODE_MINUTES * MIN), tries: 0, usedAt: null });
  const sentTo = `the number ending in ${p.slice(-4)}`;
  if (!deliver) return { ok: true as const, codeId: ref.id, sentTo };
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const text = `Your ${tenant.name || 'verification'} code is ${code}. It expires in ${CODE_MINUTES} minutes. If you didn’t ask for this, you can ignore it.`;
  const sent: any = await (o.send || defaultSend)(db, { tenantId, channel: 'sms', to: String(o.to), kind: 'verify_code', text, essential: true,
    recipientType: o.recipientType || 'contact', recipientId: o.recipientId || null, recipientName: o.name || null, ...(o.recipientType === 'client' && o.recipientId ? { clientId: o.recipientId } : {}) }).catch(() => null);
  if (!sent || (sent.status && sent.status !== 'sent') || sent.ok === false) return { ok: false as const, error: 'We couldn’t send a code just now. You can pay when your order arrives, or ask the front desk.' };
  return { ok: true as const, codeId: ref.id, sentTo };
}

/** Check the code. In one step, so wrong guesses sent all at once still count. The right code gives a guest pass. */
export async function checkKioskCode(db: any, tenantId: string, o: { codeId: string; code: string; phone: string; now?: number }) {
  const now = o.now ?? Date.now(); const p = last10(o.phone);
  const id = String(o.codeId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!id || p.length !== 10) return { ok: false as const, error: 'That code has expired. Please ask for a new one.' };
  const ref = db.doc(`${codesPath(tenantId)}/${id}`);
  const out: any = await db.runTransaction(async (tx: any) => {
    const v: any = (await tx.get(ref)).data();
    if (!v || v.usedAt || v.phoneKey !== hash(`${tenantId}:${p}`).slice(0, 32)) return { ok: false, error: 'That code has already been used or has expired. Please ask for a new one.' };
    if (Date.parse(String(v.expiresAt || '')) < now) return { ok: false, error: 'That code has expired. Please ask for a new one.' };
    if ((Number(v.tries) || 0) >= CODE_TRIES) return { ok: false, error: 'Too many tries. Please ask for a new code.' };
    if (hash(`${id}:${String(o.code || '').replace(/\D/g, '')}`) !== v.codeHash) { tx.set(ref, { tries: (Number(v.tries) || 0) + 1 }, { merge: true }); return { ok: false, error: 'That code doesn’t match. Please check it and try again.' }; }
    tx.set(ref, { usedAt: iso(now) }, { merge: true });
    return { ok: true };
  });
  if (!out.ok) return { ok: false as const, error: String(out.error) };
  const pass = makeGuestPass(tenantId, p, now);
  return pass ? { ok: true as const, pass, until: iso(now + PASS_HOURS * HOUR) } : { ok: false as const, error: 'Codes aren’t available here right now. Please ask the front desk.' };
}
