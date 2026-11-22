// src/app/api/cron/store-low/route.ts — EVERY HOUR (Vercel Cron + CRON_SECRET): each business with more than one store
// is checked for items running low at a store (lib/store-low-server): told once to the managers who work there.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { forEachTenant } from '@/lib/cron-fanout';
import { checkStoreLow } from '@/lib/store-low-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb();
  const counts = { stores: 0, items: 0, notes: 0 };
  const run = await forEachTenant(db, 'store-low', async (t) => {
    try { const r = await checkStoreLow(db, t.id, t.data); counts.stores += r.stores; counts.items += r.items; counts.notes += r.notes; }
    catch (e: any) { console.error('[cron/store-low]', t.id, String(e?.message || e).slice(0, 200)); }
  });
  return NextResponse.json({ ok: true, ...counts, ...(run && typeof run === 'object' ? { run } : {}) });
}
