// src/lib/client-verify.ts — "IS THIS YOU?" A 6-DIGIT CODE, AND PHONES THE CLIENT HAS CONFIRMED.
//
// A link proves only that someone has the link. Before anything private opens on a phone (message history, health and
// consent answers, payments, notifications, moving on to the next appointment), the client confirms a code sent to the
// phone or email on their record. That phone is then trusted for 90 days (tenants/{t}/clientDevices/{deviceId}).
// The same code confirms a contact when it's entered: online booking, the desk ("read me the code"), or the portal.
// A confirmed contact is stamped on the client (phoneVerifiedAt / emailVerifiedAt); until then messages stay discreet.
// "Not you?" (notMe): a stranger who got someone's messages turns them off in one tap: texts to that number stop, the
// links on that number stop working, and the desk is asked to fix it.
import { createHash, randomInt, randomBytes } from 'crypto';

const MIN = 60000, DAY = 864e5;
export const CODE_MIN = 10, DEVICE_DAYS = 90, MAX_TRIES = 5;
const iso = (n: number) => new Date(n).toISOString();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const last10 = (v: any) => String(v || '').replace(/\D/g, '').slice(-10);
export const cleanDevice = (d: any) => String(d || '').replace(/[^\w-]/g, '').slice(0, 80);
export function maskPhone(p: any) { const d = last10(p); return d.length >= 4 ? `ending in ${d.slice(-4)}` : 'on your record'; }
export function maskEmail(e: any) { const s = String(e || ''); const [u, dom] = s.split('@'); return dom ? `${u.slice(0, 1)}•••@${dom}` : 'on your record'; }

type Send = (m: any) => Promise<any>;
const defaultSend: Send = async (m) => { const { sendNotification } = await import('@/lib/notify'); return sendNotification(m.db, m.msg); };

/** Send a code to the client's phone (or email) on record. Returns where it went, masked. */
export async function startVerify(db: any, t: string, clientId: string, o: { channel?: 'sms' | 'email'; purpose?: string; now?: number; send?: Send } = {}) {
  const now = o.now ?? Date.now(); const T = `tenants/${t}`;
  const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data(); if (!c) return { ok: false, error: 'We couldn’t find your details.' };
  if (c.phoneReportedWrongAt && (o.channel || 'sms') === 'sms') return { ok: false, error: 'We can’t send a code to this number. Please call us so we can update your details.' };
  const ch: 'sms' | 'email' = o.channel === 'email' ? 'email' : c.phone && c.smsOptOut !== true ? 'sms' : 'email';
  const to = ch === 'sms' ? String(c.phone || '') : String(c.email || '');
  if (!to || (ch === 'email' && !to.includes('@'))) return { ok: false, error: 'There’s no phone number or email on your record. Please call us.' };
  // At most 5 codes an hour for a client.
  const recent = (await db.collection(`${T}/clientVerifications`).where('clientId', '==', clientId).limit(50).get()).docs.map((d: any) => d.data())
    .filter((v: any) => Date.parse(v.createdAt) > now - 60 * MIN);
  if (recent.length >= 5) return { ok: false, error: 'We’ve sent several codes already. Please wait a little while and try again.' };
  const code = String(randomInt(0, 1000000)).padStart(6, '0'); const ref = db.collection(`${T}/clientVerifications`).doc();
  await ref.set({ id: ref.id, clientId, channel: ch, codeHash: hash(`${ref.id}:${code}`), createdAt: iso(now), expiresAt: iso(now + CODE_MIN * MIN), tries: 0, usedAt: null, purpose: o.purpose || 'device' });
  const tenant: any = (await db.doc(T).get()).data() || {};
  const text = `Your ${tenant.name || 'verification'} code is ${code}. It expires in ${CODE_MIN} minutes. If you didn’t ask for this, you can ignore it.`;
  await (o.send || defaultSend)({ db, msg: { tenantId: t, channel: ch, to, kind: 'verify_code', text, subject: `Your code: ${code}`, clientId, recipientType: 'client', recipientId: clientId, recipientName: c.name || null, essential: true } });
  return { ok: true, verificationId: ref.id, sentTo: ch === 'sms' ? `the number ${maskPhone(to)}` : `the email ${maskEmail(to)}`, channel: ch };
}

/** Check the code. On success: this device is trusted for 90 days, and the contact is marked confirmed. */
export async function checkVerify(db: any, t: string, o: { verificationId: string; code: string; device?: string; platform?: string; now?: number }) {
  const now = o.now ?? Date.now(); const T = `tenants/${t}`;
  const ref = db.doc(`${T}/clientVerifications/${String(o.verificationId || '').replace(/[^\w-]/g, '')}`); const v: any = (await ref.get()).data();
  if (!v || v.usedAt) return { ok: false, error: 'That code has already been used or has expired. Please ask for a new one.' };
  if (Date.parse(v.expiresAt) < now) return { ok: false, error: 'That code has expired. Please ask for a new one.' };
  if ((Number(v.tries) || 0) >= MAX_TRIES) return { ok: false, error: 'Too many tries. Please ask for a new code.' };
  if (hash(`${ref.id}:${String(o.code || '').replace(/\D/g, '')}`) !== v.codeHash) { await ref.set({ tries: (Number(v.tries) || 0) + 1 }, { merge: true }); return { ok: false, error: 'That code doesn’t match. Please check it and try again.' }; }
  await ref.set({ usedAt: iso(now) }, { merge: true });
  await db.doc(`${T}/clients/${v.clientId}`).set(v.channel === 'sms' ? { phoneVerifiedAt: iso(now) } : { emailVerifiedAt: iso(now) }, { merge: true });
  let device: string | null = null;
  if (o.device !== undefined) {
    device = cleanDevice(o.device) || randomBytes(18).toString('base64url');
    await db.doc(`${T}/clientDevices/${device}`).set({ id: device, clientId: v.clientId, verifiedAt: iso(now), expiresAt: iso(now + DEVICE_DAYS * DAY), via: v.channel, platform: String(o.platform || '').slice(0, 40) || null, revokedAt: null });
  }
  return { ok: true, clientId: v.clientId, device };
}

/** Is this device trusted for this client? */
export async function deviceTrusted(db: any, t: string, clientId: string, device: string, now = Date.now()): Promise<boolean> {
  const id = cleanDevice(device); if (!id || !clientId) return false;
  try { const v: any = (await db.doc(`tenants/${t}/clientDevices/${id}`).get()).data(); return !!v && v.clientId === clientId && !v.revokedAt && Date.parse(v.expiresAt || '') > now; } catch { return false; }
}

/** "Not you?" Stops messages to that contact, turns off the links that went to it, and asks the desk to fix it. */
export async function notMe(db: any, t: string, o: { clientId: string; via: 'link' | 'text'; phone?: string | null; now?: number }) {
  const now = o.now ?? Date.now(); const T = `tenants/${t}`;
  const cRef = db.doc(`${T}/clients/${o.clientId}`); const c: any = (await cRef.get()).data(); if (!c) return { ok: false };
  if (!c.phoneReportedWrongAt) await cRef.set({ phoneReportedWrongAt: iso(now), phoneReportedWrongVia: o.via, phoneVerifiedAt: null }, { merge: true });
  // The links that went to that number stop working (the visit page says so); trusted devices for this client are kept.
  const appts = (await db.collection(`${T}/appointments`).where('clientId', '==', o.clientId).limit(100).get()).docs;
  let off = 0;
  for (const d of appts) { const a: any = d.data() || {}; if (Date.parse(a.startTime) > now - DAY && !a.linkRevokedAt) { await d.ref.set({ linkRevokedAt: iso(now), linkRevokedWhy: 'reported_wrong_number' }, { merge: true }); off++; } }
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((x: any) => ({ id: x.id, ...(x.data() || {}) })).filter((m: any) => !m.archived && ['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')));
  for (const m of staff) { const n = db.collection(`${T}/notifications`).doc();
    await n.set({ id: n.id, userId: m.id, type: 'client_message', read: false, createdAt: iso(now), link: `/clients/${o.clientId}`, clientId: o.clientId,
      message: `Action needed: someone who received ${c.name || 'a client'}’s messages says they aren’t ${String(c.name || 'them').split(' ')[0]}. Texts to ${maskPhone(c.phone)} have stopped and ${off} appointment link${off === 1 ? ' has' : 's have'} been turned off. Please check the number with the client and send a new link.` }); }
  return { ok: true, linksOff: off };
}
export const reportedWrong = (c: any) => !!c?.phoneReportedWrongAt;
