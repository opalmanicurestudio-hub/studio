// /api/getting-started — STARTING FRESH (no old app to bring over): the six-step setup checklist. Managers only.
//   status          → each step's state, from what's actually set up (nothing to tick by hand)
//   starter { menu } → adds a starter menu (lib/starter-menus): hidden, no prices, until the business checks them
//   fresh           → "I'm starting fresh": hides the moving-in card and shows this checklist instead
//   page-seen       → they've opened their booking page from here
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { STARTER_MENUS, suggestMenu } from '@/lib/starter-menus';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '');
  const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const action = String(b.action || 'status');
  if (action === 'fresh') { await db.doc(T).set({ movingIn: { dismissed: true, fresh: true, freshAt: new Date().toISOString() } }, { merge: true }); return j({ ok: true }); }
  if (action === 'page-seen') { await db.doc(T).set({ bookingPageVisitedAt: new Date().toISOString() }, { merge: true }); return j({ ok: true }); }
  const t: any = (await db.doc(T).get()).data() || {};
  if (action === 'starter') {
    const menu = STARTER_MENUS.find((m) => m.id === b.menu); if (!menu) return j({ ok: false, error: 'Choose a menu.' }, 400);
    const have = new Set((await db.collection(`${T}/services`).get()).docs.map((d: any) => String((d.data() as any)?.name || '').trim().toLowerCase()));
    const batch = db.batch(); let added = 0; const now = new Date().toISOString();
    for (const sv of menu.services) { if (have.has(sv.name.toLowerCase())) continue; const ref = db.collection(`${T}/services`).doc();
      batch.set(ref, { id: ref.id, name: sv.name, category: sv.category, duration: sv.duration, price: 0, cost: 0, profit: 0, margin: 0, description: sv.description || '', type: 'service', status: 'active', isActive: true,
        isPrivate: true, createdVia: 'starter', starterMenu: menu.id, createdAt: now }); added++; }
    await batch.commit(); await db.doc(T).set({ movingIn: { starterMenu: menu.id } }, { merge: true });
    return j({ ok: true, added });
  }
  // status
  const [sv, st, cl, sp] = await Promise.all([db.collection(`${T}/services`).get(), db.collection(`${T}/staff`).get(), db.collection(`${T}/clients`).limit(3).get(), db.collection(`${T}/scheduleProfiles`).get()]);
  const services = sv.docs.map((d: any) => d.data() || {}).filter((x: any) => x.status !== 'archived');
  const live = services.filter((x: any) => !x.isPrivate && Number(x.price) > 0).length; const toPrice = services.filter((x: any) => x.createdVia === 'starter' && (x.isPrivate || !(Number(x.price) > 0))).length;
  const team = st.docs.filter((d: any) => (d.data() as any)?.archived !== true && (d.data() as any)?.role !== 'renter' && !(d.data() as any)?.isRenter).length;
  const hours = sp.docs.some((d: any) => { const w = (d.data() as any)?.week || {}; return Object.values(w).some((x: any) => x?.enabled); });
  const pays = !!t.stripeAccountId && t.stripeChargesEnabled !== false;
  const page = !!t.bookingPageSettings?.design || !!t.bookingPageVisitedAt;
  const steps = [
    { key: 'services', done: live > 0, note: live ? `${live} on your booking page${toPrice ? ` · ${toPrice} still need a price` : ''}` : toPrice ? `${toPrice} ready for your prices` : null },
    { key: 'hours', done: hours }, { key: 'team', done: team > 1, note: team > 1 ? `${team} people` : null }, { key: 'payments', done: pays },
    { key: 'page', done: page }, { key: 'clients', done: cl.size > 0 } ];
  return j({ ok: true, steps, done: steps.filter((x) => x.done).length, fresh: !!t.movingIn?.fresh, suggest: suggestMenu(t), starterMenu: t.movingIn?.starterMenu || null,
    menus: STARTER_MENUS.map((m) => ({ id: m.id, label: m.label, count: m.services.length })), bookingPath: `/book/${encodeURIComponent(tenantId)}` });
}
