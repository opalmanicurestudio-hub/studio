// src/app/api/retail/kpis/route.ts — THE PACKING NUMBERS, worked out on the server so a busy month isn't cut short.
// GET ?tenantId&days=1|7|30 → per-person rows (lib/fulfilment-access staffKpis) over every order placed in the range,
// with wave picks credited to whoever scanned them. People who can't see the team get only their own row.
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { permissionsFor, staffKpis } from '@/lib/fulfilment-access';
import { dueAt, fulfilmentPolicy } from '@/lib/retail-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_ORDERS = 5000;
const PAGE = 400;
const PARALLEL = 24;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const tenantId = String(p.get('tenantId') || '').trim();
  const days = Math.min(90, Math.max(1, Math.floor(Number(p.get('days')) || 7)));
  if (!tenantId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const seesTeam = auth.actor.isManager || permissionsFor({ role: auth.actor.role as any, fulfilmentRole: auth.actor.fulfilmentRole || undefined }).canSeeTeam;

  const db = getAdminDb();
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const policy = fulfilmentPolicy(tenant.retailSettings);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Every order in the range, a page at a time.
  const docs: any[] = []; let cursor: any = null; let capped = false;
  for (;;) {
    let q = db.collection(`tenants/${tenantId}/retailOrders`).where('placedAt', '>', since).orderBy('placedAt', 'desc').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    docs.push(...snap.docs);
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
    if (docs.length >= MAX_ORDERS) { capped = true; break; }
  }

  const orders: any[] = new Array(docs.length);
  for (let i = 0; i < docs.length; i += PARALLEL) {
    await Promise.all(docs.slice(i, i + PARALLEL).map(async (d: any, j: number) => {
      const data = d.data() || {};
      let events: any[] = [];
      try { events = (await d.ref.collection('events').limit(300).get()).docs.map((e: any) => e.data()); } catch { /* contributes nothing */ }
      orders[i + j] = { id: d.id, orderNumber: data.orderNumber, stage: data.stage, method: data.method, placedAt: data.placedAt, paidAt: data.paidAt, lines: data.lines || [], events, dueAtMs: dueAt(data, policy) };
    }));
  }

  // Wave walks in the same range: items scanned, by person.
  const wavePicks: Record<string, { name: string; items: number }> = {};
  try {
    const ws = await db.collection(`tenants/${tenantId}/waves`).where('createdAt', '>', since).limit(500).get();
    ws.docs.forEach((w: any) => { const by = (w.data() || {}).pickedBy || {}; for (const [id, v] of Object.entries<any>(by)) { const cur = wavePicks[id] || { name: String(v?.name || 'Staff'), items: 0 }; cur.items += Number(v?.items) || 0; wavePicks[id] = cur; } });
  } catch { /* waves are a bonus */ }

  let rows = staffKpis(orders.filter(Boolean), Date.now(), wavePicks);
  if (!seesTeam) { const me = new Set([auth.actor.uid, auth.actor.authUid].filter(Boolean) as string[]); rows = rows.filter((r) => me.has(r.actorId)); }
  return NextResponse.json({ ok: true, orderCount: orders.length, capped, seesTeam, rows });
}
