// src/app/api/my-tenants/route.ts — WHICH BUSINESSES ARE MINE (signed-in user, verified ID token).
// The browser can't list businesses (the rules forbid it), so the server answers — checking every way ownership has
// been recorded over time, because older businesses don't all carry `userId`:
//   1. tenants.userId == me            (signup today)
//   2. users/{me}.tenantId / tenantIds (signup has written this since the start)
//   3. tenants.ownerId / ownerUid == me (older fields)
//   4. a business with NO owner recorded whose owner email == my VERIFIED login email (verified only — a password
//      account can be made with anyone's email)
// Anything found by 2–4 gets its missing `userId` filled in (a proven repair, done on the server).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tk = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tk) return NextResponse.json({ ok: false, error: 'no token' }, { status: 401 });
  // Only a VERIFIED email may prove ownership (anyone can make a password account with any email).
  let uid = '', email = '', emailOk = false;
  try { const d: any = await getAdminAuth().verifyIdToken(tk); uid = d.uid; email = String(d.email || '').toLowerCase(); emailOk = d.email_verified === true; }
  catch (e: any) { console.error('[my-tenants] token', e?.message); return NextResponse.json({ ok: false, error: 'bad token' }, { status: 401 }); }
  const db = getAdminDb(); const found = new Map<string, string>();   // tenantId → how it was found
  const q = async (field: string, val: string) => (await db.collection('tenants').where(field, '==', val).get().catch(() => ({ docs: [] as any[] }))).docs;
  for (const d of await q('userId', uid)) found.set(d.id, 'userId');
  const u: any = (await db.doc(`users/${uid}`).get().catch(() => null))?.data?.() || null;
  for (const id of [u?.tenantId, ...(Array.isArray(u?.tenantIds) ? u.tenantIds : [])].filter(Boolean).map(String)) if (!found.has(id)) found.set(id, 'users');
  for (const f of ['ownerId', 'ownerUid']) for (const d of await q(f, uid)) if (!found.has(d.id)) found.set(d.id, f);
  if (!found.size && email && emailOk) for (const f of ['ownerEmail', 'email']) for (const d of await q(f, email)) { const t: any = d.data() || {}; if (!t.userId && !found.has(d.id)) found.set(d.id, `${f} (no owner recorded)`); }
  // Keep only businesses that exist and aren't someone else's; fill in a missing userId we've just proven.
  const owned: string[] = [];
  for (const [id, how] of found) {
    const ref = db.doc(`tenants/${id}`); const t: any = (await ref.get().catch(() => null))?.data?.(); if (!t) continue;
    if (t.userId && t.userId !== uid) continue;
    if (!t.userId) { await ref.set({ userId: uid, userIdRepairedAt: new Date().toISOString(), userIdRepairedFrom: how }, { merge: true }).catch(() => {}); }
    owned.push(id);
  }
  const sd: any = (await db.doc(`staffDirectory/${uid}`).get().catch(() => null))?.data?.() || null;
  return NextResponse.json({ ok: true, owned, staff: sd?.tenantId ? { tenantId: String(sd.tenantId), role: sd.role || 'staff' } : null }, { headers: { 'Cache-Control': 'no-store' } });
}
