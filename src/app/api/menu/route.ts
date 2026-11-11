// src/app/api/menu/route.ts — THE MENU, for the team (app/(app)/menu): what guests see of each drink and dish, its
// choices, and "Sold out" in one tap. Items themselves (stock, cost, recipe) are made in Inventory; this is the menu side.
//   list    { tenantId }                                   → every menu item (anyone on the team)
//   soldout { tenantId, itemId, groupId?, optionId?, out } → the item, or one of its choices, sold out or back (anyone on the team)
//   save    { tenantId, itemId, item: { name, section, words, price, choices, onMenu, membersOnly } } → managers
// Nothing about cost or suppliers is read or written here.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { readMenu, setSoldOut, isMenuItem, menuItemOf } from '@/lib/menu-server';
import { cleanForSave, outNow, MAX_GROUPS, MAX_OPTIONS } from '@/lib/menu-choices';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['list', 'soldout', 'save'].includes(action)) return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, action === 'save' ? 'manager' : 'staff'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('The menu is the business’s own.', 403);
    const db = getAdminDb();

    if (action === 'list') return ok({ menu: await readMenu(db, tenantId), canEdit: !!(g.actor?.isManager || g.actor?.isTenantOwner) });

    if (action === 'soldout') {
      const r: any = await setSoldOut(db, tenantId, { itemId: b.itemId, groupId: b.groupId, optionId: b.optionId, out: b.out }, String(g.actor?.name || 'The team'));
      return r.ok ? ok({ item: r.item }) : bad(r.error, r.status);
    }

    // save
    const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which item?');
    const x: any = b.item && typeof b.item === 'object' ? b.item : {};
    const name = words(x.name, 80); if (!name) return bad('Give it a name.');
    if (x.price === null || x.price === undefined || String(x.price).trim() === '') return bad('Enter a price ($0 is fine).');
    const price = Math.round(Number(x.price) * 100) / 100;
    if (!Number.isFinite(price) || price < 0 || price > 10000) return bad('Enter a price of $0 or more.');
    const rawGroups = Array.isArray(x.choices) ? x.choices : [];
    if (rawGroups.length > MAX_GROUPS) return bad(`Up to ${MAX_GROUPS} choices an item.`);
    for (const cg of rawGroups) {
      const opts = Array.isArray(cg?.options) ? cg.options : [];
      if (opts.length > MAX_OPTIONS) return bad(`Up to ${MAX_OPTIONS} options in a choice (${words(cg?.name, 40) || 'one of them'} has more).`);
      for (const o of opts) { const p = Number(o?.price); if (String(o?.price ?? '').trim() !== '' && (!Number.isFinite(p) || Math.abs(p) > 1000)) return bad(`Check the price of ${words(o?.name, 40) || 'an option'}.`); }
    }
    const choices = cleanForSave(x.choices, () => randomBytes(6).toString('base64url'));
    // A choice with a name but no options, or options with no names, is dropped by cleanForSave: say so rather than lose it.
    const given = Array.isArray(x.choices) ? x.choices.filter((c: any) => words(c?.name, 40) || (Array.isArray(c?.options) && c.options.some((o: any) => words(o?.name, 40)))) : [];
    if (given.length !== choices.length) return bad('Each choice needs a name and at least one option with a name.');
    const lowest = price + choices.filter((cg) => cg.required && cg.pick === 'one').reduce((s, cg) => s + Math.min(...cg.options.map((o) => o.price)), 0);
    if (lowest < 0) return bad('A choice takes off more than the item costs. Check the prices.');
    const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
    const r: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data();
      if (!isMenuItem(cur)) return { error: 'That isn’t on the menu.', status: 404 };
      // What's sold out is the kitchen's to say (one tap, api/menu 'soldout' or the kitchen screen): a save keeps it as
      // it is now, whatever the form had when it opened.
      const nowOut = new Map<string, string | null>();
      for (const cg of Array.isArray(cur.choices) ? cur.choices : []) for (const o of Array.isArray(cg?.options) ? cg.options : []) if (outNow(o)) nowOut.set(`${cg.id}/${o.id}`, o.soldOutUntil || null);
      const kept = choices.map((cg) => ({ ...cg, options: cg.options.map((o) => (nowOut.has(`${cg.id}/${o.id}`) ? { ...o, soldOut: true, soldOutUntil: nowOut.get(`${cg.id}/${o.id}`) } : { ...o, soldOut: false })) }));
      const patch = { name, category: words(x.section, 40) || 'Menu', description: words(x.words, 240), price, choices: kept,
        showInConcierge: x.onMenu !== false, isMembersOnly: x.membersOnly === true, menuUpdatedAt: new Date().toISOString(), menuUpdatedBy: words(g.actor?.name, 60) || null };
      tx.set(ref, patch, { merge: true });
      return { item: menuItemOf(itemId, { ...cur, ...patch }) };
    });
    return r.error ? bad(r.error, r.status) : ok({ item: r.item });
  } catch (e: any) {
    console.error('[menu] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
