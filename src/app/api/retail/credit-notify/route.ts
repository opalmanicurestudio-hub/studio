import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendStoreCreditEmail } from '@/lib/retail-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/retail/credit-notify — "you've received store credit", for RETAIL
 * credit (depositCredits docs, the pool the shop checkout spends).
 *
 * Called fire-and-forget after a return is resolved as store credit. The
 * email answers the three questions a customer actually has — how much did I
 * just get, how much do I have NOW, and where did the rest go — so balance
 * and history are computed across every credit doc under their email, not
 * just the new one.
 *
 * Idempotent by claim: the credit doc's grantEmailAt is taken in a
 * transaction, so a double-fire (retry, double-tap, two tabs) sends exactly
 * one email. No balance is ever returned in the response — this route tells
 * the CUSTOMER their balance, never the caller, so it adds no probe surface.
 */

const str = (v: any, max: number): string => {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
};

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const tenantId = str(body?.tenantId, 120);
    const creditId = str(body?.creditId, 200);
    if (!tenantId || !creditId) {
      return NextResponse.json({ ok: false, error: 'Missing tenant or credit.' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.doc(`tenants/${tenantId}/depositCredits/${creditId}`);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: 'That credit could not be found.' }, { status: 404 });
    }
    const credit = (snap.data() as any) || {};
    const email = str(credit.clientEmail, 200).toLowerCase();
    if (!email) {
      return NextResponse.json({ ok: true, sent: false, message: 'No email on this credit.' });
    }

    let claimed = false;
    try {
      claimed = await db.runTransaction(async (tx: any) => {
        const s = await tx.get(ref);
        if (!s.exists) return false;
        const cur = (s.data() as any) || {};
        if (cur.grantEmailAt) return false;
        tx.set(ref, { grantEmailAt: new Date().toISOString() }, { merge: true });
        return true;
      });
    } catch { claimed = false; }

    if (!claimed) {
      return NextResponse.json({ ok: true, sent: false, alreadyNotified: true });
    }

    const allSnap = await db.collection(`tenants/${tenantId}/depositCredits`)
      .where('clientEmail', '==', email)
      .limit(50).get();
    const docs = allSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));

    const balanceCents = docs.reduce((a: number, c: any) =>
      a + (c.status === 'available'
        ? Math.max(0, (Number(c.amountCents) || 0) - (Number(c.usedCents) || 0))
        : 0), 0);

    const history: { at: string; label: string; deltaCents: number }[] = [];
    for (const c of docs) {
      history.push({
        at: String(c.createdAt || ''),
        label: c.sourceRetailReturnId ? 'Store credit \u2014 return' : 'Store credit added',
        deltaCents: Math.max(0, Number(c.amountCents) || 0),
      });
      const used = Math.max(0, Number(c.usedCents) || 0);
      if (used > 0) {
        history.push({
          at: String(c.lastUsedAt || c.createdAt || ''),
          label: 'Applied at checkout',
          deltaCents: -used,
        });
      }
    }
    history.sort((a, b) => String(b.at).localeCompare(String(a.at)));

    const sent = await sendStoreCreditEmail(db, tenantId, {
      toEmail: email,
      toName: str(credit.clientName, 120),
      grantedCents: Math.max(0, Number(credit.amountCents) || 0),
      reason: credit.sourceRetailReturnId ? 'From your recent return' : undefined,
      balanceCents,
      expiresAt: credit.expiresAt || null,
      history,
    });

    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : 'Notify failed.',
    }, { status: 500 });
  }
}
