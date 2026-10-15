// src/lib/passkeys.ts — FACE ID / FINGERPRINT SIGN-IN on a person's own phone (passkeys, WebAuthn). Server only.
// A team member who signed in with their PIN can add this phone; next time the phone's own lock (Face ID, Touch ID,
// fingerprint, or the phone's passcode) signs them in instead of the PIN. The phone keeps the private key; we keep only
// the public key, so nothing here can be used to sign in elsewhere.
// Stored with the other server-only staff records (tenants/{t}/staffSecrets — the database rules let no app read them):
//   staffSecrets/{staffId}.passkeys[]      — their phones: id, publicKey, counter, transports, name, createdAt, lastUsedAt
//   staffSecrets/pk_{hash of credential}   — which person a passkey belongs to (so sign-in needs no name typed)
//   staffSecrets/ch_{random}               — a one-time challenge, 5 minutes
import { createHash, randomBytes } from 'crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const S = (t: string) => `tenants/${t}/staffSecrets`;
const pkKey = (credId: string) => `pk_${createHash('sha256').update(credId).digest('hex').slice(0, 40)}`;
const CH_MIN = 5;
export const rpFrom = (req: { headers: { get(k: string): string | null }; nextUrl: { origin: string; hostname: string } }) => {
  const host = String(req.headers.get('x-forwarded-host') || req.nextUrl.hostname).split(',')[0].trim().split(':')[0];
  const proto = String(req.headers.get('x-forwarded-proto') || (req.nextUrl.origin.startsWith('https') ? 'https' : 'http')).split(',')[0].trim();
  const port = /^localhost$/.test(host) ? `:${new URL(req.nextUrl.origin).port || '3000'}` : '';
  return { rpID: host, origin: `${proto}://${host}${port}` };
};
async function saveChallenge(db: any, tenantId: string, challenge: string, staffId: string | null, kind: 'reg' | 'auth') {
  const id = `ch_${randomBytes(12).toString('hex')}`;
  await db.doc(`${S(tenantId)}/${id}`).set({ challenge, staffId, kind, until: new Date(Date.now() + CH_MIN * 60000).toISOString() });
  return id;
}
async function takeChallenge(db: any, tenantId: string, id: string, kind: 'reg' | 'auth') {
  if (!/^ch_[a-f0-9]{24}$/.test(String(id || ''))) return null; const ref = db.doc(`${S(tenantId)}/${id}`);
  const c: any = (await ref.get()).data(); await ref.delete().catch(() => {});
  return c && c.kind === kind && Date.parse(c.until) > Date.now() ? c : null;
}

export async function registrationOptions(db: any, tenantId: string, staff: { id: string; name: string }, rp: { rpID: string }, businessName: string) {
  const mine: any[] = ((await db.doc(`${S(tenantId)}/${staff.id}`).get()).data() as any)?.passkeys || [];
  const options = await generateRegistrationOptions({ rpName: businessName || 'Team sign-in', rpID: rp.rpID, userName: `${staff.name || 'Team member'}`, userDisplayName: staff.name || 'Team member',
    userID: new Uint8Array(Buffer.from(`${tenantId}:${staff.id}`)) as Uint8Array<ArrayBuffer>, attestationType: 'none',
    excludeCredentials: mine.map((p) => ({ id: p.id, transports: p.transports || undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' } });
  return { options, challengeId: await saveChallenge(db, tenantId, options.challenge, staff.id, 'reg') };
}
export async function registrationVerify(db: any, tenantId: string, staffId: string, challengeId: string, response: any, rp: { rpID: string; origin: string }, name: string) {
  const c = await takeChallenge(db, tenantId, challengeId, 'reg'); if (!c || c.staffId !== staffId) return { ok: false as const, error: 'That took too long. Try again.' };
  let v: any; try { v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true }); } catch (e: any) { return { ok: false as const, error: 'This phone couldn’t be added. Try again.' }; }
  if (!v?.verified || !v.registrationInfo) return { ok: false as const, error: 'This phone couldn’t be added. Try again.' };
  const cred = v.registrationInfo.credential; const now = new Date().toISOString();
  const entry = { id: cred.id, publicKey: Buffer.from(cred.publicKey).toString('base64url'), counter: cred.counter || 0, transports: cred.transports || [], name: String(name || 'This phone').slice(0, 60), createdAt: now, lastUsedAt: null };
  const ref = db.doc(`${S(tenantId)}/${staffId}`); const cur: any[] = ((await ref.get()).data() as any)?.passkeys || [];
  await ref.set({ passkeys: [...cur.filter((p) => p.id !== cred.id), entry].slice(-10) }, { merge: true });
  await db.doc(`${S(tenantId)}/${pkKey(cred.id)}`).set({ staffId, credId: cred.id, createdAt: now });
  return { ok: true as const, id: cred.id };
}
export async function authenticationOptions(db: any, tenantId: string, rp: { rpID: string }) {
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', allowCredentials: [] });
  return { options, challengeId: await saveChallenge(db, tenantId, options.challenge, null, 'auth') };
}
/** The person this phone's passkey belongs to, once it checks out. */
export async function authenticationVerify(db: any, tenantId: string, challengeId: string, response: any, rp: { rpID: string; origin: string }) {
  const c = await takeChallenge(db, tenantId, challengeId, 'auth'); if (!c) return { ok: false as const, error: 'That took too long. Try again.' };
  const credId = String(response?.id || ''); if (!credId) return { ok: false as const, error: 'Sign-in didn’t finish.' };
  const link: any = (await db.doc(`${S(tenantId)}/${pkKey(credId)}`).get()).data(); if (!link?.staffId) return { ok: false as const, error: 'This phone isn’t set up for Face ID here any more. Sign in with your PIN.' };
  const ref = db.doc(`${S(tenantId)}/${link.staffId}`); const list: any[] = ((await ref.get()).data() as any)?.passkeys || []; const pk = list.find((p) => p.id === credId);
  if (!pk) return { ok: false as const, error: 'This phone isn’t set up for Face ID here any more. Sign in with your PIN.' };
  let v: any; try { v = await verifyAuthenticationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
    credential: { id: pk.id, publicKey: new Uint8Array(Buffer.from(pk.publicKey, 'base64url')), counter: Number(pk.counter) || 0, transports: pk.transports || undefined } }); } catch { return { ok: false as const, error: 'Face ID sign-in didn’t check out. Use your PIN.' }; }
  if (!v?.verified) return { ok: false as const, error: 'Face ID sign-in didn’t check out. Use your PIN.' };
  await ref.set({ passkeys: list.map((p) => (p.id === credId ? { ...p, counter: v.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() } : p)) }, { merge: true });
  return { ok: true as const, staffId: String(link.staffId) };
}
export async function listPasskeys(db: any, tenantId: string, staffId: string) {
  const list: any[] = ((await db.doc(`${S(tenantId)}/${staffId}`).get()).data() as any)?.passkeys || [];
  return list.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt || null }));
}
export async function removePasskey(db: any, tenantId: string, staffId: string, credId: string) {
  const ref = db.doc(`${S(tenantId)}/${staffId}`); const list: any[] = ((await ref.get()).data() as any)?.passkeys || [];
  await ref.set({ passkeys: list.filter((p) => p.id !== credId) }, { merge: true }); await db.doc(`${S(tenantId)}/${pkKey(credId)}`).delete().catch(() => {});
  return { ok: true as const };
}
