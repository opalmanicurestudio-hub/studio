// src/app/api/briefing/route.ts — THE PRE-SHIFT BRIEFING (lib/briefing, lib/briefing-server; design canvas "Pre-shift
// briefing and staffing"; the page at /briefing). The business's own team, signed in; its note and its staffing numbers
// are a manager's.
//   view     { tenantId, day? } → today's (or tomorrow's) briefing: guests expected and when, staffing against the
//            schedule, bookings worth knowing, the kitchen, who's working, the manager's note and who has read it.
//   note     { tenantId, day, text } → the manager's note for the day (empty clears it).
//   read     { tenantId, day } → "Got it".
//   staffing { tenantId, staffing: { perServer, perCook, perBartender, hostAt } } → the numbers staffing is worked out by.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { prepDays } from '@/lib/prep-list-server';
import { cleanStaffing } from '@/lib/briefing';
import { briefingFor, forgetBriefing, markRead, MAX_NOTE, saveNote } from '@/lib/briefing-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['view', 'note', 'read', 'staffing'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, action === 'note' || action === 'staffing' ? 'manager' : 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter || g.actor?.role === 'renter') return bad('The briefing is the business’s own.', 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data() || {};
  { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
  const me = { id: String(g.actor?.uid || g.actor?.staffId || ''), name: String(g.actor?.name || 'Team member').slice(0, 60) };
  const manager = !!g.actor?.isTenantOwner || !!g.actor?.isManager || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || '').toLowerCase());
  const days = prepDays(tenant).slice(0, 2);
  const day = String(b.day || '');

  try {
    if (action === 'staffing') {
      const s = cleanStaffing(b.staffing);
      if (!s) return bad('Staffing: guests a server 4 to 60, an hour a cook 5 to 120, a bartender 5 to 150, a host from 5 to 200 an hour.');
      await db.doc(T).set({ kitchenSettings: { staffing: s } }, { merge: true }); forgetBriefing(T);
      return ok({ staffing: s });
    }
    if (action === 'note' || action === 'read') {
      if (!days.includes(day)) return bad('Which day?');
      if (action === 'note') { if (String(b.text ?? '').length > MAX_NOTE * 2) return bad('That note is too long.'); await saveNote(db, T, day, String(b.text ?? ''), me.name); return ok({}); }
      await markRead(db, T, day, me); return ok({});
    }
    return ok({ briefing: await briefingFor(db, T, tenant, days.includes(day) ? day : null, me), manager });
  } catch (e) {
    console.error('[briefing]', e);
    return bad('The briefing couldn’t be put together just now. Try again in a moment.', 500);
  }
}
