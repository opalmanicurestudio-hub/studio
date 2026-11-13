// src/app/api/retail/popup/route.ts — POP-UP TABLES, for the team (app/(app)/popup; lib/popup).
//   list       { tenantId } → anyone on the team: the pop-ups (today's and coming ones first), each with its products as
//              the table sells them (name, price, photo, window number, what came, what's left) and its line orders'
//              count; whether this person can change them
//   save       { tenantId, id?, name, place, day, items: [{ id, qty }] } → managers: set one up, or change it (what the
//              table sold and the numbers called stay as they are)
//   lineOrders { tenantId, id, on } → managers: take orders from the line, or stop (only on the pop-up's own day)
//   close      { tenantId, id } → managers: the pop-up is over (no more sales against it, no more line orders)
//   catalog    { tenantId } → managers: what could come along (the shop's products that can be sold, each variant on
//              its own line), for setting one up
// Renters get none of it: a pop-up is the business's own.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { logAuditAdmin } from '@/lib/audit';
import { moduleEnabled } from '@/lib/modules';
import { checkPopupForm, leftAt, lineOrdered, popupToday, popupsOf } from '@/lib/popup';
import { popupCatalog, popupProducts } from '@/lib/popup-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['list', 'save', 'lineOrders', 'close', 'catalog'].includes(action)) return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, action === 'list' ? 'staff' : 'manager'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('Pop-ups are the business’s own.', 403);
    const db = getAdminDb();
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    if (!moduleEnabled(tenant, 'pickup')) return bad('Pop-ups are part of Pickup and drive-thru, and it’s off. It’s in Shop setup.', 403);
    const today = todayIn(tenantTimeZone(tenant));
    const now = new Date().toISOString();
    const manager = !!(g.actor?.isTenantOwner || g.actor?.isManager || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || '').toLowerCase()));
    const by = { type: 'user', id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'A manager').slice(0, 80) };

    if (action === 'list') {
      const snap = await popupsOf(db, tenantId).orderBy('day', 'desc').limit(30).get();
      // (A day's marker isn't a pop-up: see save.)
      const all = snap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })).filter((p: any) => !p.marker && p.day);
      // One left open after its day is over: closed now, so it stops counting as that day's pop-up.
      const stale = all.filter((p: any) => p.status !== 'closed' && p.day < today);
      // (Each looked at again as it's closed: one moved to a coming day a moment ago stays open.)
      for (const p of stale) {
        const ref = popupsOf(db, tenantId).doc(p.id);
        const closed = await db.runTransaction(async (tx: any) => { const s = await tx.get(ref); const d: any = s.exists ? s.data() || {} : null;
          if (!d || d.status === 'closed' || !(d.day < today)) return false; tx.update(ref, { status: 'closed', lineOrders: false, closedAt: now, updatedAt: now }); return true; }).catch(() => false);
        if (closed) { p.status = 'closed'; p.lineOrders = false; }
      }
      // Today's and the coming ones first (soonest first), then the ones gone by (latest first).
      const ahead = all.filter((p: any) => p.day >= today).sort((a: any, z: any) => a.day.localeCompare(z.day));
      const past = all.filter((p: any) => p.day < today);
      const shown = [...ahead, ...past].slice(0, 20);
      const ids = new Set<string>(); for (const p of shown) for (const it of p.items || []) ids.add(String(it.id));
      const products = await popupProducts(db, tenantId, tenant, [...ids]);
      const popups = await Promise.all(shown.map(async (p: any) => {
        // (What the line has ordered is read for today's only: one gone by says what the table sold and how many
        // numbers it called.)
        const orders = popupToday(p, today) ? (await db.collection(`tenants/${tenantId}/retailOrders`).where('popupId', '==', p.id).get()).docs.map((d: any) => d.data() || {}) : [];
        const line = lineOrdered(orders, Date.now()); const left = leftAt(p, line);
        return { id: p.id, name: p.name || '', place: p.place || '', day: p.day, status: p.status || 'open', lineOrders: p.lineOrders === true, today: popupToday(p, today), called: Number(p.nextNumber) || 0,
          lineCount: orders.filter((o: any) => !['placed', 'cancelled'].includes(String(o.stage))).length,
          items: (p.items || []).map((it: any) => ({ ...(products.get(String(it.id)) || { id: it.id, name: 'Not on file any more', priceCents: 0, imageUrl: null, number: null, gone: true }), qty: Number(it.qty) || 0,
            soldAtTable: Number(p.soldAtTable?.[it.id]) || 0, ordered: Number(line[it.id]) || 0, left: left[it.id] ?? 0 })) };
      }));
      return ok({ popups, today, canEdit: manager });
    }

    if (action === 'catalog') return ok({ products: (await popupCatalog(db, tenantId)).map(({ id, name, priceCents, imageUrl, onHand }) => ({ id, name, priceCents, imageUrl, onHand })) });

    const id = String(b.id || '');
    if (action === 'save') {
      const chk = checkPopupForm(b); if (!chk.ok) return bad(chk.message);
      if (chk.fields.day < today && !id) return bad('Pick today or a day coming up.');
      // Only the business's own products that can be sold: checked against the record, never the screen.
      const products = await popupProducts(db, tenantId, tenant, chk.fields.items.map((x) => x.id));
      const unknown = chk.fields.items.filter((x) => !products.has(x.id));
      if (unknown.length) return bad(`${unknown.length === 1 ? 'One product isn’t' : `${unknown.length} products aren’t`} for sale any more. Take ${unknown.length === 1 ? 'it' : 'them'} off and save again.`, 409);
      if (id && !ID.test(id)) return bad('Which pop-up?');
      const ref = id ? popupsOf(db, tenantId).doc(id) : popupsOf(db, tenantId).doc();
      // One open pop-up a day: the register and the sign each know which one they're for. The day is claimed by a
      // marker in the same step as the save (day-YYYY-MM-DD, naming the pop-up), so two managers saving at once can't
      // both take it; a marker naming one that's closed, or has moved to another day, is free.
      const dayRef = popupsOf(db, tenantId).doc(`day-${chk.fields.day}`);
      const r = await db.runTransaction(async (tx: any) => {
        const was = id ? await tx.get(ref) : null;
        const mark = await tx.get(dayRef); const holder = mark.exists ? String(mark.data()?.popupId || '') : '';
        const other = holder && holder !== ref.id ? await tx.get(popupsOf(db, tenantId).doc(holder)) : null;
        if (id && !was.exists) return { error: 'That pop-up isn’t here any more.', status: 404 };
        const old: any = was?.data() || {};
        if (id && old.status === 'closed') return { error: 'That pop-up is over. Set up a new one.', status: 409 };
        const od: any = other?.exists ? other.data() || {} : null;
        if (od && od.status !== 'closed' && od.day === chk.fields.day) return { error: `${od.name || 'Another pop-up'} is already on that day. Change that one, or pick another day.`, status: 409 };
        tx.set(dayRef, { marker: true, popupId: ref.id, updatedAt: now });
        // (Merged: anything else on it stays. What the table sold and the numbers called are carried as they are.)
        tx.set(ref, { id: ref.id, ...chk.fields, status: 'open', lineOrders: old.lineOrders === true && chk.fields.day === today, soldAtTable: old.soldAtTable || {}, nextNumber: Number(old.nextNumber) || 0,
          createdAt: old.createdAt || now, updatedAt: now }, { merge: true });
        return { ok: true };
      });
      if ((r as any).error) return bad((r as any).error, (r as any).status);
      await logAuditAdmin(db, tenantId, { action: id ? 'popup.changed' : 'popup.set_up', targetType: 'popup', targetId: ref.id, summary: `Pop-up ${chk.fields.name} on ${chk.fields.day}, ${chk.fields.items.length} product${chk.fields.items.length === 1 ? '' : 's'}`, actor: by } as any).catch(() => {});
      return ok({ id: ref.id });
    }

    if (!ID.test(id)) return bad('Which pop-up?');
    const ref = popupsOf(db, tenantId).doc(id);
    const r: any = await db.runTransaction(async (tx: any) => {
      const s = await tx.get(ref); if (!s.exists) return { error: 'That pop-up isn’t here any more.', status: 404 };
      const p: any = s.data() || {};
      if (p.marker) return { error: 'That pop-up isn’t here any more.', status: 404 };
      if (action === 'lineOrders') {
        const on = b.on === true;
        if (on && !popupToday(p, today)) return { error: p.status === 'closed' ? 'That pop-up is over.' : 'Orders from the line open on the pop-up’s own day.', status: 409 };
        tx.update(ref, { lineOrders: on, updatedAt: now }); return { ok: true, p, on };
      }
      if (p.status === 'closed') return { ok: true, p, already: true };
      tx.update(ref, { status: 'closed', lineOrders: false, closedAt: now, updatedAt: now }); return { ok: true, p };
    });
    if (r.error) return bad(r.error, r.status);
    await logAuditAdmin(db, tenantId, { action: action === 'close' ? 'popup.closed' : r.on ? 'popup.line_on' : 'popup.line_off', targetType: 'popup', targetId: id, summary: `Pop-up ${r.p.name}: ${action === 'close' ? 'closed' : r.on ? 'taking orders from the line' : 'no more orders from the line'}`, actor: by } as any).catch(() => {});
    return ok({});
  } catch (e: any) {
    console.error('[popup]', e?.message);
    return bad('That didn’t work. Try again.', 500);
  }
}
