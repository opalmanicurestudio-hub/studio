// src/app/api/kiosk/route.ts — THE KIOSK'S OWN CALLS (lib/kiosk; app/drive-thru/[tenantId]/kiosk). Every call carries the
// kiosk's key (api/kitchen 'pair', kind 'kiosk'), and that key works here only: it reads the menu, places its own
// guests' orders and takes their payments on its own card reader. It can't open the lane, the counter, the kitchen or
// another kiosk's orders, and no other screen's key works here.
//   menu                              → the menu as a guest sees it now, and whether the kiosk can take payments
//   place { orderKey, lines, name, toGo } → the order, sent to the kitchen unpaid (its stock held), and its number
//   pay / check / cancel { orderId }  → the card on this kiosk's reader; paid, the kitchen has it; canceled, it's let go
//   textMe { orderId, phone }         → "Text me when it's ready" for the order just paid here (lib/ready-text)
//   receipt { orderId, channel: 'sms'|'email', to } → "Get a receipt": its private link sent to what the guest typed
//   readers / setReader { pin?, readerId } → a manager (signed in, or their PIN) picks this kiosk's card reader
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { accessLockOf } from '@/lib/tenant-access';
import { toolLocked } from '@/lib/tool-lock';
import { screenOf } from '@/lib/screen-keys';
import { requireRole } from '@/lib/route-guard';
import { listReaders } from '@/lib/counter-card';
import { logAuditAdmin } from '@/lib/audit';
import { kioskMenu, kioskPlace, kioskPay, kioskCheck, kioskCancel, kioskTextMe, kioskReceipt, managerByPin } from '@/lib/kiosk';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const READER = /^tmr_[A-Za-z0-9]{4,60}$/;
const ACTIONS = ['menu', 'place', 'pay', 'check', 'cancel', 'textMe', 'receipt', 'readers', 'setReader'];
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400, extra: any = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });
const answer = (r: any) => (r?.ok ? ok(r) : bad(r?.error || 'That didn’t go through. Try again.', r?.status || 500, r?.code ? { code: r.code } : {}));

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || ''); if (!ACTIONS.includes(action)) return bad('Unknown action.');
    const db = getAdminDb(); const T = `tenants/${tenantId}`;
    const screen = await screenOf(db, tenantId, b.key);
    if (!screen || screen.kind !== 'kiosk') {
      // Guessing keys gets nowhere, but it isn't free to answer: a few dozen wrong tries an hour from one place.
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This kiosk isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'Ordering here is closed for now. Please order at the counter.' }, { status: 403 });
    // A new order only while the plan has quick service; paying for, checking or letting go of one already placed still works.
    if (action === 'menu' || action === 'place') { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }

    if (action === 'menu') return answer(await kioskMenu(db, tenantId, tenant, screen));
    if (action === 'place') {
      // However busy, a kiosk places a few orders a minute at most.
      const slow = await limitPublic(req, 'kiosk_place', tenantId, { perHour: 240, perDay: 3000 }); if (slow) return slow;
      return answer(await kioskPlace(db, tenantId, tenant, screen, { key: b.orderKey, lines: b.lines, name: b.name, toGo: b.toGo, allergy: b.allergy }));
    }
    if (action === 'pay') return answer(await kioskPay(db, tenantId, tenant, screen, b.orderId));
    if (action === 'check') return answer(await kioskCheck(db, tenantId, tenant, screen, b.orderId));
    if (action === 'cancel') return answer(await kioskCancel(db, tenantId, tenant, screen, b.orderId));
    if (action === 'textMe') {
      // Each text costs the business something, so a kiosk can ask for only so many an hour.
      const slow = await limitPublic(req, 'kiosk_text', tenantId, { perHour: 120, perDay: 1500 }); if (slow) return slow;
      return answer(await kioskTextMe(db, tenantId, tenant, screen, b.orderId, b.phone));
    }
    if (action === 'receipt') {
      // Each one sent costs the business something too: so many an hour.
      const slow = await limitPublic(req, 'kiosk_receipt', tenantId, { perHour: 120, perDay: 1500 }); if (slow) return slow;
      return answer(await kioskReceipt(db, tenantId, screen, b.orderId, b.channel, b.to, req.nextUrl.origin));
    }

    // readers / setReader: a manager only, signed in here or with their PIN typed on the kiosk.
    let manager: { id: string; name: string };
    if (b.pin !== undefined && b.pin !== null && b.pin !== '') {
      const m: any = await managerByPin(db, tenantId, tenant, b.pin);
      if (m.error) return bad(m.error, m.status, { needsManager: true });
      manager = m;
    } else {
      const g: any = await requireRole(req, tenantId, 'manager');
      if (g.deny || g.actor?.isRenter) return bad('A manager’s PIN to change the card reader.', 403, { needsManager: true });
      manager = { id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'A manager').slice(0, 60) };
    }
    const r: any = await listReaders(tenantId, tenant);
    if (r.error) return bad(r.error, 503);
    if (action === 'readers') return ok({ readers: r.rows, payments: r.payments, current: screen.readerId || null, by: manager.name });
    const readerId = String(b.readerId || '');
    if (!READER.test(readerId) || !r.rows.some((x: any) => x.id === readerId)) return bad('Pick one of this business’s card readers.', 400);
    await screen.ref.set({ readerId, readerSetAt: new Date().toISOString(), readerSetBy: manager.name }, { merge: true });
    const label = String(r.rows.find((x: any) => x.id === readerId)?.label || 'a card reader').slice(0, 60);
    await logAuditAdmin(db, tenantId, { action: 'kiosk.reader', targetType: 'screen', targetId: screen.ref.id, summary: `${manager.name} set ${screen.name} to take cards on ${label}.`, actor: { type: 'user', id: manager.id || 'kiosk', name: manager.name } } as any).catch(() => {});
    return ok({ current: readerId });
  } catch (e: any) {
    console.error('[kiosk] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
