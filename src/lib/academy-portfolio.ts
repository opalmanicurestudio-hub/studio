// src/lib/academy-portfolio.ts
//
// PORTFOLIO — tenants/{t}/portfolio/{id}
//   before / after photos (private storage), service, note
//   consent   the client agreed (student's tick + client's initials + time) — required
//   status    'pending' (waiting for an instructor) → 'approved' | 'hidden'
// Sharing — students/{id}.portfolio { on, token, displayName }
//   The public page (/learn/{t}/portfolio/{token}) shows ONLY approved work, ONLY
//   while sharing is on, with photo links that expire. No client details, no
//   contact details; the page asks search engines not to index it.

import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { mediaUrl } from '@/lib/academy';

export const newToken = () => randomBytes(12).toString('base64url');
const view = async (p?: any) => (p?.path ? await mediaUrl(p.path, 60) : null);

export async function itemsFor(tenantId: string, studentId: string, opts: { approvedOnly?: boolean } = {}) {
  const db = getAdminDb();
  const q = await db.collection(`tenants/${tenantId}/portfolio`).where('studentId', '==', studentId).limit(200).get();
  const rows = q.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => !opts.approvedOnly || x.status === 'approved').sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return Promise.all(rows.map(async (x: any) => ({ id: x.id, service: x.service, note: x.note, status: x.status, createdAt: x.createdAt, reviewedAt: x.reviewedAt || null, reviewNote: x.reviewNote || null,
    consent: opts.approvedOnly ? undefined : x.consent, before: await view(x.before), after: await view(x.after) })));
}

/** The public page: approved work only, only while sharing is on. */
export async function publicPortfolio(tenantId: string, token: string) {
  const db = getAdminDb();
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) return null;
  const q = await db.collection(`tenants/${tenantId}/students`).where('portfolio.token', '==', token).limit(1).get();
  const st = q.docs[0]; const s = (st?.data() as any) || null;
  if (!st || !s.portfolio?.on) return null;
  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  return { name: s.portfolio.displayName || s.name || 'Student', school: t.name || '', logoUrl: t.logoUrl || t.bookingPageSettings?.logoUrl || null, color: t.academy?.brandColor || t.brandColor || null, items: await itemsFor(tenantId, st.id, { approvedOnly: true }) };
}
