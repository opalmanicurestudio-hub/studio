// src/lib/pro-license.ts — A LICENSE ON FILE, for products sold to licensed pros only (a product's prosOnly; "Pros
// only" on the window board and in the shop). A customer sends their license once from the shop
// (shop/[tenantId]/pro, api/retail/pro-license): their name, email, the license's number, state and expiry, and a photo
// of it. The team looks at it and approves it, with the expiry it shows, or declines it with a reason
// (retail-orders/licenses, api/retail/pro-licenses). From then on the shop sells pros-only products to that email until
// the license expires, the register says whether a customer has one, and the order keeps the license it was sold on.
//   • One per email per business (the document's id is the email's own fingerprint). A second send replaces the first
//     while it's waiting; one sent while a license is good today waits beside it (`pending`) and takes its place only
//     when the team approves it, so a renewal (or anyone typing that email) never cuts off a license that's good.
//   • Bought only with the email proven theirs (a sign-in link emailed to it, lib/retail-account): checkout asks for
//     that before it looks at the license, so typing someone else's email neither buys on their license nor says
//     whether they have one.
//   • Valid: approved, and its expiry not before today on the business's own calendar.
//   • The photo is saved by the server (lib/claim-photo-upload, folder pro-licenses) and opened only by the team.
// Nothing here sends anything: the routes do.
import { createHash } from 'crypto';

export type LicenseStatus = 'waiting' | 'approved' | 'declined' | 'revoked';
export type ProLicense = {
  id: string; email: string; name: string; phone: string; number: string; state: string; expiresOn: string;
  fileUrl: string; fileName: string; status: LicenseStatus; note: string;
  sentAt: string; decidedAt: string | null; decidedBy: string | null;
  /** A newer one sent while this one is good, waiting for the team (see above). */
  pending?: { name: string; phone: string; number: string; state: string; expiresOn: string; fileUrl: string; fileName: string; sentAt: string } | null;
  /** Waiting for the team: status waiting, or a newer one pending (what the team's list asks for first). */
  toCheck?: boolean;
};

const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const normEmail = (v: unknown) => String(v ?? '').trim().toLowerCase().slice(0, 200);
// One address, nothing that could make it a list of them.
export const EMAIL = /^[^\s@,;<>"()\\[\]:]+@[^\s@,;<>"()\\[\]:]+\.[^\s@,;<>"()\\[\]:]{2,}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

/** The document id for an email: its own fingerprint, so the email itself is never a path. */
export const licenseId = (email: string) => createHash('sha256').update(normEmail(email)).digest('hex').slice(0, 32);
export const licensesOf = (db: any, t: string) => db.collection(`tenants/${t}/proLicenses`);

/** A real calendar day, YYYY-MM-DD (not Feb 30). */
export function realDay(v: unknown): string | null {
  const d = String(v ?? '').trim(); if (!DAY.test(d)) return null;
  const t = Date.parse(`${d}T12:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
}

/** Is this license good to sell on, today (YYYY-MM-DD on the business's calendar)? */
export function licenseValid(l: any, today: string): boolean {
  if (!l || l.status !== 'approved') return false;
  const exp = realDay(l.expiresOn); return !!exp && exp >= today;
}

/** What a customer sends, checked: the problem in words, or the fields to keep. */
export function checkLicenseForm(b: any, today: string): { ok: true; fields: { name: string; email: string; phone: string; number: string; state: string; expiresOn: string } } | { ok: false; message: string } {
  const name = s(b?.name, 80); const email = normEmail(b?.email); const phone = s(b?.phone, 30);
  const number = s(b?.number, 40); const state = s(b?.state, 2).toUpperCase(); const expiresOn = realDay(b?.expiresOn);
  if (!name) return { ok: false, message: 'Add the name on your license.' };
  if (!EMAIL.test(email)) return { ok: false, message: 'Add the email you order with.' };
  if (!/^[A-Za-z0-9 .\-/#]{3,40}$/.test(number)) return { ok: false, message: 'Add your license number as it’s printed.' };
  if (!STATES.includes(state)) return { ok: false, message: 'Pick the state that issued it.' };
  if (!expiresOn) return { ok: false, message: 'Add the date it expires.' };
  if (expiresOn < today) return { ok: false, message: 'That license has expired. Send one that’s current.' };
  return { ok: true, fields: { name, email, phone, number, state, expiresOn } };
}

/** The license on file for this email (any status), or null. */
export async function licenseFor(db: any, t: string, email: string): Promise<ProLicense | null> {
  const e = normEmail(email); if (!EMAIL.test(e)) return null;
  const snap = await licensesOf(db, t).doc(licenseId(e)).get();
  return snap.exists ? ({ ...(snap.data() || {}), id: snap.id } as ProLicense) : null;
}

/** Keep a license sent from the shop. While the one on file is good today, the new one waits beside it (`pending`);
 *  otherwise it takes the one on file's place, waiting. `fresh` when nobody had sent one for this email before. */
export async function sendLicense(db: any, t: string, f: { name: string; email: string; phone: string; number: string; state: string; expiresOn: string }, file: { fileUrl: string; fileName: string }, now: string, today: string): Promise<{ id: string; fresh: boolean; pending: boolean }> {
  const id = licenseId(f.email); const ref = licensesOf(db, t).doc(id);
  return db.runTransaction(async (tx: any) => {
    const was = await tx.get(ref); const old: any = was.exists ? was.data() || {} : null;
    if (old && licenseValid(old, today)) {
      const { email: _e, ...rest } = f; void _e;
      tx.set(ref, { ...old, pending: { ...rest, fileUrl: file.fileUrl, fileName: file.fileName, sentAt: now }, toCheck: true });
      return { id, fresh: false, pending: true };
    }
    // (What it was before, so the team sees it's a renewal: the approved one, or the one a waiting renewal is for.)
    const renewalOf = old?.status === 'approved' ? { number: old.number || '', expiresOn: old.expiresOn || '' } : old?.status === 'waiting' && old?.renewalOf ? old.renewalOf : null;
    tx.set(ref, {
      id, ...f, fileUrl: file.fileUrl || old?.fileUrl || '', fileName: file.fileUrl ? file.fileName : old?.fileName || '',
      status: 'waiting', note: '', sentAt: now, decidedAt: null, decidedBy: null, pending: null, toCheck: true,
      ...(renewalOf ? { renewalOf } : {}),
    });
    return { id, fresh: !old, pending: false };
  });
}

/** The team's decision: approve (with the expiry they read off it), decline (with a reason the customer is told), or
 *  revoke an approved one. Approve and decline act on what's waiting (a pending renewal before the one on file), and
 *  only on the very one the team looked at (`sentAt`): sent again since, and they're asked to look again.
 *  `renewal` when it was a pending one: declined, the license on file stays as it was. */
export async function decideLicense(db: any, t: string, id: string, d: { action: 'approve' | 'decline' | 'revoke'; expiresOn?: string; note?: string; sentAt?: string }, by: { id: string; name: string }, today: string, now: string): Promise<{ ok: true; license: ProLicense; renewal: boolean; was: { number: string; state: string } } | { ok: false; error: string; status: number }> {
  if (!/^[a-f0-9]{32}$/.test(id)) return { ok: false, error: 'Which license?', status: 400 };
  const ref = licensesOf(db, t).doc(id);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref); if (!snap.exists) return { ok: false, error: 'That license isn’t on file.', status: 404 };
    const l: any = snap.data() || {};
    const p: any = l.pending && typeof l.pending === 'object' ? l.pending : null;
    const note = s(d.note, 300); const who = by.name || by.id;
    if (d.action !== 'revoke') {
      const looked = String(d.sentAt ?? '');
      if (!looked) return { ok: false, error: 'Open the license again, then decide.', status: 400 };
      if (looked !== String((p || l).sentAt || '')) return { ok: false, error: 'They sent it again just now. Open it again to see what they sent.', status: 409 };
    }
    if (d.action === 'approve') {
      if (!p && l.status === 'approved') return { ok: false, error: 'It’s already approved.', status: 409 };
      const exp = realDay(d.expiresOn ?? (p || l).expiresOn);
      if (!exp) return { ok: false, error: 'Add the date it expires.', status: 400 };
      if (exp < today) return { ok: false, error: 'That date has passed. A license that’s expired can’t be approved.', status: 400 };
      // A pending one takes the place of the one on file, which is kept as what it renewed.
      const next = p
        ? { ...l, name: p.name || l.name, phone: p.phone ?? l.phone, number: p.number, state: p.state, fileUrl: p.fileUrl || l.fileUrl || '', fileName: p.fileName || '', sentAt: p.sentAt,
            renewalOf: { number: l.number || '', expiresOn: l.expiresOn || '' }, pending: null }
        : { ...l };
      Object.assign(next, { status: 'approved', expiresOn: exp, note: '', decidedAt: now, decidedBy: who, toCheck: false });
      tx.set(ref, next); return { ok: true, license: { ...next, id }, renewal: !!p, was: { number: String((p || l).number || ''), state: String((p || l).state || '') } };
    }
    if (d.action === 'decline') {
      if (!note) return { ok: false, error: 'Say why, so they can send what’s needed.', status: 400 };
      if (p) {
        // The license on file stays as it was; what they sent is noted for the record.
        const next = { ...l, pending: null, toCheck: l.status === 'waiting', pendingDeclined: { number: String(p.number || ''), note, at: now, by: who } };
        tx.set(ref, next); return { ok: true, license: { ...next, id, note }, renewal: true, was: { number: String(p.number || ''), state: String(p.state || '') } };
      }
      if (l.status !== 'waiting') return { ok: false, error: 'Only a license waiting to be checked can be declined.', status: 409 };
      const next = { ...l, status: 'declined', note, decidedAt: now, decidedBy: who, toCheck: false };
      tx.set(ref, next); return { ok: true, license: { ...next, id }, renewal: false, was: { number: String(l.number || ''), state: String(l.state || '') } };
    }
    if (l.status !== 'approved') return { ok: false, error: 'Only an approved license can be taken off.', status: 409 };
    // (A renewal waiting beside it still waits, to approve or decline.)
    const next = { ...l, status: 'revoked', note, decidedAt: now, decidedBy: who, toCheck: !!p };
    tx.set(ref, next); return { ok: true, license: { ...next, id }, renewal: false, was: { number: String(l.number || ''), state: String(l.state || '') } };
  });
}

/** A product sold to licensed pros only. */
export const prosOnly = (item: any) => item?.prosOnly === true;
