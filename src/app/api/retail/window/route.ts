// src/app/api/retail/window/route.ts — THE PICKUP WINDOW, for the team (app/(app)/window; lib/pickup-window): which of
// the shop's products show at the window and on its board, in what order, and how they're tagged there.
//   list    { tenantId } → anyone on the team: the window's products (each with its number, what's on the shelf, its
//           board tags), every product that could go on it, the best sellers of the last 30 days first, and the board's
//           address
//   save    { tenantId, items: string[], was?: string[] } → managers: the window's products in order (up to WINDOW_MAX;
//           anything that can't go on a window is refused by name). `was`: the list as saved when the page read it
//           (list's `stored`); when it's changed since (someone else saved), it's refused so their change isn't undone.
//   tag     { tenantId, itemId, featured?: boolean, badge?: 'new' | 'limited' | null } → managers: shown big on the board,
//           and its New or Limited time tag (a product on the window only)
//   numbers { tenantId } → anyone on the team: { [productId]: number }, the numbers the board shows, for the register
// Nothing about cost or suppliers is read out.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { readMenu } from '@/lib/menu-server';
import { WINDOW_MAX, windowIdsOf, windowable, readWindow, boardNumbers, windowProductOf } from '@/lib/pickup-window';
import { linkOrigin } from '@/lib/app-origin';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const CATALOG_MAX = 600;

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['list', 'save', 'tag', 'numbers'].includes(action)) return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, action === 'save' || action === 'tag' ? 'manager' : 'staff'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('The window is the business’s own.', 403);
    const db = getAdminDb();
    const tRef = db.doc(`tenants/${tenantId}`);
    const tenant: any = (await tRef.get()).data() || {};

    if (action === 'numbers') {
      const [menu, products] = await Promise.all([readMenu(db, tenantId), readWindow(db, tenantId, tenant)]);
      const nums = boardNumbers(menu, products);
      return ok({ numbers: Object.fromEntries(products.map((p) => [p.id, nums.get(p.id) ?? null]).filter(([, n]) => n != null)) });
    }

    if (action === 'list') {
      const now = Date.now();
      const since = new Date(now - 30 * 86400000).toISOString();
      const [menu, products, inv, orders] = await Promise.all([
        readMenu(db, tenantId), readWindow(db, tenantId, tenant),
        db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'retail').limit(CATALOG_MAX).get(),
        db.collection(`tenants/${tenantId}/retailOrders`).where('placedAt', '>', since).orderBy('placedAt', 'desc').limit(500).get().catch((e: any) => { console.error('[window] best sellers not read', e?.message); return null; }),
      ]);
      const nums = boardNumbers(menu, products);
      // Units sold of each listing over 30 days (paid orders only), for the best sellers first.
      const sold = new Map<string, number>();
      for (const d of orders?.docs || []) {
        const o: any = d.data() || {}; if (!o.paidAt || o.stage === 'cancelled') continue;
        for (const l of Array.isArray(o.lines) ? o.lines : []) { const id = String(l?.listingId || l?.productId || ''); if (ID.test(id)) sold.set(id, (sold.get(id) || 0) + Math.max(0, Number(l?.qtyOrdered) || 0)); }
      }
      const all = inv.docs.map((d: any) => ({ id: d.id, i: d.data() || {} }));
      const byId = new Map<string, any>(all.map((x: any) => [x.id, x.i]));
      const onIds = new Set(windowIdsOf(tenant));
      const catalog = all.filter((x: any) => windowable(x.i)).map((x: any) => {
        const p = windowProductOf(x.id, x.i, byId);
        return { id: x.id, name: p.name, category: p.section, price: p.price, from: p.from, imageUrl: p.imageUrl, onHand: p.onHand, prosOnly: p.prosOnly, onWindow: onIds.has(x.id), soldLast30: sold.get(x.id) || 0 };
      }).sort((a: any, c: any) => c.soldLast30 - a.soldLast30 || a.name.localeCompare(c.name));
      const origin = linkOrigin(tenant, req.nextUrl.origin).replace(/\/+$/, '');
      return ok({
        items: products.map((p) => ({ ...p, number: nums.get(p.id) ?? null })),
        catalog, max: WINDOW_MAX, capped: inv.size >= CATALOG_MAX,
        // (The list as saved, which the page sends back as `was` when it saves.)
        stored: windowIdsOf(tenant), menuCount: menu.filter((m) => m.onMenu && !m.membersOnly).length,
        // (Whether this person can change it: managers, as save and tag require.)
        canEdit: !!(g.actor?.isTenantOwner || g.actor?.isManager || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || '').toLowerCase())),
        board: `${origin}/drive-thru/${encodeURIComponent(tenantId)}/menu`,
      });
    }

    if (action === 'save') {
      const raw = Array.isArray(b.items) && b.items.length <= 200 ? b.items.map((x: any) => String(x ?? '')) : null;
      if (!raw) return bad(Array.isArray(b.items) ? `The window holds up to ${WINDOW_MAX} products. Take some off first.` : 'Which products?');
      const was = Array.isArray(b.was) ? JSON.stringify(b.was.map((x: any) => String(x ?? '')).slice(0, 200)) : null;
      const ids: string[] = []; for (const id of raw) if (ID.test(id) && !ids.includes(id)) ids.push(id);
      if (ids.length > WINDOW_MAX) return bad(`The window holds up to ${WINDOW_MAX} products. Take some off first.`);
      const snaps: any[] = ids.length ? await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`))) : [];
      const wrong = snaps.map((s: any, k: number) => (s?.exists && windowable(s.data()) ? null : (s?.exists ? String(s.data()?.name || 'A product') : 'A product no longer in Inventory'))).filter(Boolean) as string[];
      if (wrong.length) return bad(`${wrong[0]} can’t go on the window: only your own shop products with a price, not archived and not a variant of another listing.`);
      // Changed by someone else since this page read it: refused, so their change isn't undone (checked and written
      // together). Who changed it goes in the team's own log, not on the business's page, which anyone can read.
      const moved = await db.runTransaction(async (tx: any) => {
        const now = (await tx.get(tRef)).data() || {};
        if (was !== null && was !== JSON.stringify(windowIdsOf(now))) return true;
        tx.set(tRef, { pickupWindow: { items: ids, updatedAt: new Date().toISOString() } }, { merge: true });
        return false;
      });
      if (moved) return bad('The window was changed since you opened it. It’s been reloaded; make your change again.', 409);
      await logAuditAdmin(db, tenantId, { action: 'window.saved', targetType: 'pickup_window', summary: `Pickup window set to ${ids.length} product${ids.length === 1 ? '' : 's'}`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: String(g.actor?.name || '') } } as any).catch(() => {});
      return ok({ items: ids });
    }

    // tag
    const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which product?');
    if (!windowIdsOf(tenant).includes(itemId)) return bad('Put it on the window first.');
    const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
    const snap = await ref.get(); if (!snap.exists || !windowable(snap.data())) return bad('That product can’t go on the window.', 404);
    const patch: any = {};
    if (b.featured !== undefined) { if (typeof b.featured !== 'boolean') return bad('Shown big: on or off?'); patch.boardFeatured = b.featured; }
    if (b.badge !== undefined) { if (!(b.badge === null || b.badge === 'new' || b.badge === 'limited')) return bad('The tag is New, Limited time or none.'); patch.boardBadge = b.badge; }
    if (!Object.keys(patch).length) return bad('Nothing to change.');
    await ref.set(patch, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'window.tagged', targetType: 'inventory', targetId: itemId, summary: `${String(snap.data()?.name || 'A product')} on the window board: ${patch.boardFeatured === undefined ? '' : patch.boardFeatured ? 'shown big. ' : 'not shown big. '}${patch.boardBadge === undefined ? '' : patch.boardBadge ? `Tagged ${patch.boardBadge === 'new' ? 'New' : 'Limited time'}.` : 'No tag.'}`.trim(), actor: { type: 'user', id: String(g.actor?.uid || ''), name: String(g.actor?.name || '') } } as any).catch(() => {});
    return ok({ itemId, ...patch });
  } catch (e: any) {
    console.error('[window]', e?.message);
    return bad('That didn’t work. Try again.', 500);
  }
}
