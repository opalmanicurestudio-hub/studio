// /api/retail/digital/access — the shop changes one buyer's access to a download, from the Digital products area:
// more downloads, a later end (or none), closed with a reason, or opened again (lib/entitlement-actions). Managers
// only; the rest of the team can look. The change is made in one transaction on the buyer's record (only the server
// writes those), kept on its history with who made it, and the buyer is emailed what changed.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { applyAction, buyerMessage, cleanAction } from '@/lib/entitlement-actions';
import { digitalLineAccess } from '@/lib/digital-access-rule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const id = String(b.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) return bad('Missing details.');
  const action = cleanAction(b.action);
  if (!action) return bad('That change isn’t one the shop can make.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.status === 401 ? 'Please sign in again to make this change.' : auth.error || 'Please sign in to continue.', auth.status || 401);
  if (!auth.actor?.isManager) return bad('Only managers can change a buyer’s access.', 403);

  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/entitlements/${id}`);
  const by = String(auth.actor?.name || 'The shop').slice(0, 60);
  let result: any = null;
  try {
    result = await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, error: 'That buyer’s record wasn’t found.' };
      const ent: any = snap.data();
      // Where the buyer stands now, by the one rule over their order: a refund or chargeback can't be undone here, and
      // an extension has to end later than access already does.
      const os = ent.orderId ? await tx.get(db.doc(`tenants/${tenantId}/retailOrders/${ent.orderId}`)) : null;
      const order: any = os?.exists ? os.data() : null;
      const line = order ? (order.lines || []).find((l: any) => String(l.lineId || l.productId) === String(ent.lineId || ent.productId)) || null : null;
      const nowMs = Date.now();
      const acc = order && line ? digitalLineAccess(order, line, nowMs, ent) : null;
      const r = applyAction(ent, action, by, new Date(nowMs).toISOString(), acc ? { endsAt: acc.endsAt, closedFor: acc.open ? null : acc.reason } : {});
      if (!r.ok) return r;
      tx.set(ref, r.patch, { merge: true });
      return { ...r, ent: { ...ent, ...r.patch } };
    });
  } catch (e: any) {
    console.error('[digital/access]', String(e?.message || e).slice(0, 200));
    return bad('That didn’t save. Try again.', 500);
  }
  if (!result?.ok) return bad(result?.error || 'That didn’t save.', 409);

  // Tell the buyer what changed. A message that doesn't go never undoes the change.
  const ent = result.ent;
  let emailed = false;
  try {
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const shop = String(tenant.businessName || tenant.name || 'The shop');
    const origin = String(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin || '').replace(/\/$/, '');
    if (ent.email && origin) {
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');
      const m = buyerMessage(action, String(ent.name || 'your download'), shop);
      const url = action.kind === 'revoke' ? `${origin}/shop/${tenantId}/order/${ent.orderId}` : `${origin}/shop/${tenantId}/library/${ent.orderId}`;
      const html = brandedEmailHtml({ studioName: shop, title: m.subject, bodyLines: [m.line], cta: { label: action.kind === 'revoke' ? 'Open my order' : 'Open my library', url } } as any);
      emailed = (await sendNotification(db, { tenantId, channel: 'email', to: ent.email, subject: m.subject, text: `${m.line}\n\n${url}`, html, kind: 'digital_access', clientId: ent.clientId || null, recipientType: 'client' } as any)).ok;
    }
  } catch { /* the change stands */ }
  return NextResponse.json({ ok: true, what: result.what, emailed });
}
