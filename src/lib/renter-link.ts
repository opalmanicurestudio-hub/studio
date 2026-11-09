// src/lib/renter-link.ts — A RENTER'S PERSONAL PORTAL LINK, the one that signs them straight in.
// Every email or text that carries a link gets a fresh one, made from 24 random bytes. Only a hash of it is kept
// (tenants/{t}/private/renterLinks/links/{hash}), never the link itself, so nobody reading the business's records
// can sign in as a renter. A link works for 30 days. The owner can turn off every link a renter has been sent
// (and sign them out) in one step; the next link sent works as usual.
import { createHash, randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

export const RENTER_LINK_DAYS = 30;
const LINK_MS = RENTER_LINK_DAYS * 86_400_000;
const KEEP = 10;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const linksOf = (db: any, tenantId: string) => db.collection(`tenants/${tenantId}/private/renterLinks/links`);

/**
 * A fresh personal portal link for one renter, or null when the business has no web address yet.
 * `query` adds to the link (for example 'tab=rent'). Older links keep working until they run out, up to the newest ten.
 */
export async function mintRenterLink(db: any, tenantId: string, renterId: string, base: string, opts: { query?: string; renter?: any; now?: number } = {}): Promise<string | null> {
  if (!base || !tenantId || !renterId) return null;
  const now = opts.now ?? Date.now();
  const token = randomBytes(24).toString('base64url');
  await linksOf(db, tenantId).doc(sha(token)).set({ renterId, createdAt: new Date(now).toISOString(), expiresAt: now + LINK_MS });
  try {
    const mine = (await linksOf(db, tenantId).where('renterId', '==', renterId).get()).docs
      .map((d: any) => ({ ref: d.ref, at: Number((d.data() || {}).expiresAt) || 0 }))
      .sort((a: any, b: any) => b.at - a.at);
    for (let i = 0; i < mine.length; i++) if (mine[i].at <= now || i >= KEEP) await mine[i].ref.delete();
  } catch { /* tidying is a nicety */ }
  // The old plain link stopped working; it shouldn't sit on a record the team can read.
  if (opts.renter?.portalToken) {
    try { await db.doc(`tenants/${tenantId}/renters/${renterId}`).update({ portalToken: FieldValue.delete() }); } catch { /* harmless */ }
  }
  const q = String(opts.query || '').replace(/^[?&]+/, '');
  return `${base}/rent/${tenantId}?rt=${token}${q ? `&${q}` : ''}`;
}

/** The renter a link belongs to, or null when it's unknown, turned off or out of time. */
export async function renterFromLink(db: any, tenantId: string, token: unknown, now = Date.now()): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const snap = await linksOf(db, tenantId).doc(sha(token)).get();
  const d: any = snap.exists ? snap.data() : null;
  if (!d?.renterId || !(Number(d.expiresAt) > now)) return null;
  return String(d.renterId);
}

/** Who a renter portal session belongs to (private/renterSessions), or null. */
export async function renterSession(db: any, tenantId: string, token: unknown, now = Date.now()): Promise<{ renterId: string | null; contactKey: string; name: string | null } | null> {
  if (typeof token !== 'string' || !token) return null;
  const snap = await db.doc(`tenants/${tenantId}/private/renterSessions`).get();
  const e: any = (((snap.data() as any) || {})[sha(token)]) || null;
  if (!e || !(Number(e.expiresAt) > now)) return null;
  return { renterId: e.renterId || null, contactKey: String(e.contactKey || ''), name: e.name || null };
}

/** The contact keys the portal signs a renter in under: email lowercased, phone as digits. */
export function renterContactKeys(r: any): string[] {
  const out: string[] = [];
  const email = String(r?.email || '').trim().toLowerCase(); if (email.includes('@')) out.push(email);
  const phone = String(r?.phone || '').replace(/\D/g, ''); if (phone.length >= 7) out.push(phone);
  return out;
}

/** Turns off every link this renter has been sent and signs them out of the portal. Returns how many links went. */
export async function revokeRenterLinks(db: any, tenantId: string, renterId: string, renter: any): Promise<number> {
  const mine = (await linksOf(db, tenantId).where('renterId', '==', renterId).get()).docs;
  for (const d of mine) await d.ref.delete();
  const keys = new Set(renterContactKeys(renter));
  const ref = db.doc(`tenants/${tenantId}/private/renterSessions`);
  await db.runTransaction(async (tx: any) => {
    const all: any = ((await tx.get(ref)).data() as any) || {};
    const kept: any = {};
    for (const [k, v] of Object.entries<any>(all)) {
      if (!v || v.renterId === renterId || (v.contactKey && keys.has(String(v.contactKey)))) continue;
      kept[k] = v;
    }
    tx.set(ref, kept);
  });
  const patch: any = { portalLinksOffAt: new Date().toISOString() };
  if (renter?.portalToken) patch.portalToken = FieldValue.delete();
  await db.doc(`tenants/${tenantId}/renters/${renterId}`).set(patch, { merge: true });
  return mine.length;
}

/** Clears the plain links once kept on renter records (they no longer sign anyone in). Returns how many it cleared. */
export async function clearOldPortalTokens(db: any, tenantId: string): Promise<number> {
  const docs = (await db.collection(`tenants/${tenantId}/renters`).where('portalToken', '!=', null).get()).docs;
  for (const d of docs) await d.ref.update({ portalToken: FieldValue.delete() }).catch(() => {});
  return docs.length;
}
