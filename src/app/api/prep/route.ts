// src/app/api/prep/route.ts — TOMORROW'S PREP LIST (lib/prep-list-server). Anyone on the team, signed in.
//   plan { tenantId, day?, fresh? } → the day's list (tomorrow when none is asked for): about how many of each dish, a
//        usual night's range, the guests expected (booked and walk-ins), what the recipes take against what's in stock,
//        and what's been ticked off.
//   done { tenantId, day, itemId, done, make? } → a dish ticked off as prepped (or not), with how many the list said.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { markPrep, prepFor } from '@/lib/prep-list-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'plan');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['plan', 'done'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return bad('The prep list is the business’s own.', 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = g.tenant && Object.keys(g.tenant).length ? g.tenant : ((await db.doc(T).get()).data() || {});
  { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
  try {
    if (action === 'done') {
      const r = await markPrep(db, T, tenant, String(b.day || ''), String(b.itemId || ''), b.done === true, String(g.actor?.name || 'Kitchen'), b.make ?? null);
      return r.ok ? ok() : bad(r.error);
    }
    return ok({ plan: await prepFor(db, T, tenant, typeof b.day === 'string' ? b.day : null, { fresh: b.fresh === true }) });
  } catch (e: any) {
    console.error('[prep]', e);
    return bad('The prep list couldn’t be worked out just now. Try again in a moment.', 500);
  }
}
