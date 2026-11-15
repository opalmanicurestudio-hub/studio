// src/app/api/event-sheet/route.ts — THE EVENT SHEET (lib/event-sheet, lib/event-sheet-server; design canvas "Event sheet
// and final invoice"; the page at /events/[eventId]/sheet). The business's own team, signed in; the money on it is for
// managers only.
//   view { tenantId, eventId } → the sheet.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { sheetFor } from '@/lib/event-sheet-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const eventId = String(b.eventId || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!ID.test(eventId)) return bad('Which event?');
  if (action !== 'view') return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter || g.actor?.role === 'renter') return bad('The event is the business’s own.', 403);
  const manager = !!g.actor?.isTenantOwner || !!g.actor?.isManager || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || '').toLowerCase());
  try {
    const db = getAdminDb(); const T = `tenants/${tenantId}`;
    const tenant: any = (await db.doc(T).get()).data() || {};
    const me = [g.actor?.staffId, g.actor?.uid].filter((x: any) => typeof x === 'string' && x).map(String);
    const sheet = await sheetFor(db, T, tenant, eventId, manager, me);
    if (!sheet) return bad('That event isn’t here any more.', 404);
    return NextResponse.json({ ok: true, sheet, manager }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[event-sheet]', e);
    return bad('The event sheet couldn’t load just now. Try again in a moment.', 500);
  }
}
