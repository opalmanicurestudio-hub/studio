// src/app/api/bar/route.ts — BAR TABS WITH A CARD HELD (design canvas "The bar and the pass"; lib/bar-tab-server). The
// business's own team, signed in (a PIN in the team app too), never a renter.
//   tabs      { tenantId }                    → tonight's open tabs at the bar, with their held cards, the bar's card
//                                              readers, and the hold amount
//   open      { tenantId, name }              → a new tab under a name
//   hold      { tenantId, visitId, readerId } → the hold amount sent to the bar's reader (the guest taps once)
//   holdCheck { tenantId, visitId }           → how the hold is going
//   holdStop  { tenantId, visitId }           → called off, or a held card let go
//   charge    { tenantId, visitId, pendingId, amountCents } → the desk closes the tab on the held card (only the check,
//                                              never more than what's held), as the sale's own card reader payment
//   settings  { tenantId, holdDollars }       (a manager) → how much a tab holds on a card
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { accessLockOf } from '@/lib/tenant-access';
import { chargeHold, checkHold, openTab, startHold, stopHold, tabsNow } from '@/lib/bar-tab-server';
import { cleanHoldDollars, holdDollarsOf } from '@/lib/bar-tab';
import { listReaders } from '@/lib/counter-card';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ACTIONS = ['tabs', 'open', 'hold', 'holdCheck', 'holdStop', 'charge', 'settings'];
const bad = (error: string, status = 400, more: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...more }, { status });
const ok = (d: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...d });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
  const action = String(b.action || ''); if (!ACTIONS.includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, action === 'settings' ? 'manager' : 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return bad('The bar is the business’s own.', 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = g.tenant && Object.keys(g.tenant).length ? g.tenant : ((await db.doc(T).get()).data() || {});
  if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'The bar is closed for now. The business owner can tell you more.' }, { status: 403 });
  // Closing a tab on its held card still works if the plan changed, so a guest's check is never stuck.
  if (action !== 'charge' && action !== 'holdStop') { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
  const by = String(g.actor?.name || 'The bar').slice(0, 60);
  try {
    if (action === 'tabs') {
      const [tabs, readers] = await Promise.all([tabsNow(db, tenantId), listReaders(tenantId, tenant).catch(() => ({ rows: [], payments: false }))]);
      return ok({ tabs, readers: 'rows' in readers ? readers.rows : [], payments: 'rows' in readers ? readers.payments : false, holdDollars: holdDollarsOf(tenant),
        manager: !!g.actor?.isTenantOwner || !!g.actor?.isManager, meName: by });
    }
    if (action === 'open') { const r = await openTab(db, tenantId, b.name, by); return r.ok ? ok({ partyId: r.partyId, visitId: r.visitId }) : bad(r.error, r.status); }
    if (action === 'settings') {
      const v = cleanHoldDollars(b.holdDollars); if (v === null) return bad('A hold between $10 and $500.');
      await db.doc(T).set({ barTabSettings: { holdDollars: v } }, { merge: true });
      return ok({ holdDollars: v });
    }
    const visitId = String(b.visitId || '');
    if (action === 'charge') {
      const r = await chargeHold(db, tenantId, tenant, visitId, String(b.pendingId || ''), Number(b.amountCents), by);
      if (!r.ok) return bad(r.error, r.status, { ...(r.code ? { code: r.code } : {}), ...(r.paidWith ? { paidWith: r.paidWith, paidPayload: r.paidPayload } : {}) });
      return ok({ paymentIntentId: r.paymentIntentId, amountCents: r.amountCents, ...(r.already ? { already: true } : {}), ...(r.sale ? { sale: r.sale } : {}) });
    }
    const r = action === 'hold' ? await startHold(db, tenantId, tenant, visitId, String(b.readerId || ''), by)
      : action === 'holdCheck' ? await checkHold(db, tenantId, tenant, visitId) : await stopHold(db, tenantId, tenant, visitId);
    if (!r.ok) return bad(r.error, r.status, r.code ? { code: r.code } : {});
    return ok({ hold: r.hold, ...(r.already ? { already: true } : {}) });
  } catch (e) {
    console.error('[bar]', e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
