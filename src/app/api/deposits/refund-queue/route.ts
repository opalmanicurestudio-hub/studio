// src/app/api/deposits/refund-queue/route.ts — REFUNDS TO PROCESS.
// Deposits promised back to clients (provider delays, callouts, closures,
// early cancellations) are recorded as "refund pending". This is where they
// actually go back:
//   list    — every pending one, with client, appointment, amount and why
//   process — the chosen ones (or all), each through the secure refund route
//             (it finds the deposit itself and never trusts an amount), one at
//             a time, NEVER retried (a lost reply must not refund twice), with
//             a lock so two clicks can't process the same one
//   Each can instead be given as store credit. Managers only — it moves money.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { internalPost, internalOrigin } from '@/lib/message-policy';

export const dynamic = 'force-dynamic';
const WHY: Record<string, string> = { provider_delay: 'Provider running late', provider_callout: 'Provider callout', business_interruption: 'Business interruption', client_cancel: 'Cancelled with notice', studio_cancel: 'We cancelled' };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), action = String(b.action || 'list');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  if (!['owner', 'admin', 'manager'].includes(String(auth.actor.role || '').toLowerCase())) return NextResponse.json({ ok: false, error: 'Only a manager can process refunds.' }, { status: 403 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const snap = await db.collection(`${T}/depositDecisions`).where('outcome', '==', 'refund_pending').get();
  const pending = snap.docs.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() as any) })).filter((x: any) => !x.processedAt);

  if (action === 'list') {
    const items = [];
    for (const d of pending) {
      const ap: any = d.appointmentId ? (((await db.doc(`${T}/appointments/${d.appointmentId}`).get()).data() as any) || {}) : {};
      items.push({ id: d.id, amountDollars: Number(d.amountDollars) || 0, why: WHY[d.trigger] || String(d.trigger || 'Deposit refund').replace(/_/g, ' '), reason: d.reason || null, decidedAt: d.decidedAt || null,
        clientName: ap.clientName || d.clientName || null, clientId: d.clientId || ap.clientId || null, appointmentId: d.appointmentId || null, startTime: ap.startTime || null, serviceName: ap.serviceName || null, lastError: d.lastError || null });
    }
    items.sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
    return NextResponse.json({ ok: true, items, totalDollars: items.reduce((m, x) => m + x.amountDollars, 0) });
  }

  if (action === 'process') {
    const asCredit = b.as === 'credit';
    const ids: string[] = b.all === true ? pending.map((x: any) => x.id) : (Array.isArray(b.ids) ? b.ids.map(String) : []);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids.slice(0, 50)) {
      const d = pending.find((x: any) => x.id === id);
      if (!d) { results.push({ id, ok: false, error: 'Already processed.' }); continue; }
      // Lock: another click / device mustn't process the same refund.
      const locked = await db.runTransaction(async (tx: any) => { const cur = (await tx.get(d.ref)).data() as any;
        if (cur?.processedAt || (cur?.processingAt && Date.now() - Date.parse(cur.processingAt) < 10 * 60000)) return false;
        tx.set(d.ref, { processingAt: new Date().toISOString(), processingBy: auth.actor.name }, { merge: true }); return true; });
      if (!locked) { results.push({ id, ok: false, error: 'Being processed already.' }); continue; }
      const ap: any = d.appointmentId ? (((await db.doc(`${T}/appointments/${d.appointmentId}`).get()).data() as any) || {}) : {};
      const clientId = d.clientId || ap.clientId;
      if (!clientId || !d.appointmentId) { await d.ref.set({ processingAt: null, lastError: 'No client or appointment on this refund.' }, { merge: true }); results.push({ id, ok: false, error: 'No client or appointment on this refund.' }); continue; }
      const r = await internalPost(internalOrigin(null, req.nextUrl.origin), '/api/stripe/studio-cancel-refund',
        { tenantId, clientId, appointmentId: d.appointmentId, disposition: asCredit ? 'store_credit' : 'refund', reason: d.reason || WHY[d.trigger] || 'Deposit refund', staffId: auth.actor.uid }, { retries: 0 });
      const nowIso = new Date().toISOString();
      if (r.ok && r.data?.ok) {
        await d.ref.set({ processedAt: nowIso, processedBy: auth.actor.name, processingAt: null, outcome: asCredit ? 'store_credit' : 'refunded', stripeRefundId: r.data?.refundId || r.data?.stripeRefundId || null, lastError: null }, { merge: true });
        await logAuditAdmin(db, tenantId, { action: asCredit ? 'deposit.credited' : 'deposit.refunded', targetType: 'appointment', targetId: d.appointmentId,
          summary: `${ap.clientName || 'Client'}’s $${(Number(d.amountDollars) || 0).toFixed(2)} deposit ${asCredit ? 'given as store credit' : 'refunded to their card'} (${WHY[d.trigger] || d.trigger})`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } }).catch(() => {});
        results.push({ id, ok: true });
      } else {
        const err = String(r.data?.reason || r.data?.error || r.transportError || 'The refund didn’t go through.');
        await d.ref.set({ processingAt: null, lastError: err, lastTriedAt: nowIso }, { merge: true });
        results.push({ id, ok: false, error: err });
      }
    }
    return NextResponse.json({ ok: true, results, done: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
