// src/app/api/money/close/route.ts — CLOSING A MONTH (lib/books-close-server).
//   view    { tenantId, month? }    → what's still open in a month (the next to close, without one), and the months around
//   close   { tenantId, month }     → closed, with every month before it (a manager)
//   reopen  { tenantId, reason }    → the last month closed, opened again (the owner only; kept on the record)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { closeMonth, closeOverview, reopenMonth } from '@/lib/books-close-server';
import { monthName } from '@/lib/books-close';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const auth: any = await verifyStaffActor(req, tenantId);
    if (!auth?.ok || !(auth.actor.isManager || auth.actor.isTenantOwner)) return reply({ ok: false, error: 'Managers only.' }, 403);
    const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const by = String(auth.actor.name || 'A manager').slice(0, 60);
    const actor = { type: 'user', id: String(auth.actor.uid || 'manager'), name: by } as any;
    const action = String(b.action || 'view');
    if (action === 'view') { const r: any = await closeOverview(db, tenantId, tenant, b.month); return reply({ ...r, canReopen: !!auth.actor.isTenantOwner }, r.ok ? 200 : r.status); }
    if (action === 'close') {
      const r: any = await closeMonth(db, tenantId, tenant, b.month, by);
      if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: 'books.month_closed', targetType: 'tenant', targetId: tenantId, summary: `${by} closed ${monthName(String(b.month))}: nothing dated in it can change now.`, actor } as any).catch(() => {});
      return reply(r, r.ok ? 200 : r.status);
    }
    if (action === 'reopen') {
      if (!auth.actor.isTenantOwner) return reply({ ok: false, error: 'Only the owner can reopen a month.' }, 403);
      const r: any = await reopenMonth(db, tenantId, by, b.reason);
      if (r.ok) await logAuditAdmin(db, tenantId, { action: 'books.month_reopened', targetType: 'tenant', targetId: tenantId, summary: `${by} reopened ${monthName(String(r.reopened))}: ${String(b.reason || '').trim().slice(0, 200)}`, actor } as any).catch(() => {});
      return reply(r, r.ok ? 200 : r.status);
    }
    return reply({ ok: false, error: 'Something went wrong.' }, 400);
  } catch (e: any) {
    console.error('[money/close]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
