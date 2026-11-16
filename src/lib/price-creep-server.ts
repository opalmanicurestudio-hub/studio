// src/lib/price-creep-server.ts — A DELIVERY THAT COST MORE (lib/price-creep), as it's put away: what it did to the
// menu, and a notice to the people who run the business when it pushed a dish over their aim (or further over it) or
// left a choice that no longer pays for itself (lib/tell-managers, kind 'price_moved', to Food cost). Once a delivery: the notice is kept as
// tenants/{t}/priceAlerts/{item}_{delivery}, made only if it isn't there yet. Never stops the delivery it's about.
import { isMenuItem } from '@/lib/menu-server';
import { targetOf } from '@/lib/food-cost';
import { effectsOf, hurtBy, moveOf, moveWords, type DishHit, type Move, type OptionHit } from '@/lib/price-creep';
import { tellManagers } from '@/lib/tell-managers';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const $ = (n: number) => `$${n.toFixed(2)}`;
const pc = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);

export type MoveWithEffects = Move & { dishes: DishHit[]; options: OptionHit[] };

/** The notice, in words: what moved, and the dish or choice it hurt most. */
export function alertWords(m: MoveWithEffects, target: number): string | null {
  const d = m.dishes.find((x) => x.crossed) || m.dishes.find(hurtBy); const o = m.options[0];
  if (!d && !o) return null;
  // (Inventory still at the older price: what follows is at the new one.)
  const head = `${m.name} ${moveWords(m)} on the last delivery.${m.live !== null ? ` Your costs still use ${$(m.live)}. At the new price,` : ''}`;
  if (d) return `${head} ${d.name} is now ${pc(d.shareAfter)} of its price (it was ${pc(d.shareBefore)}), over your ${pc(target)}.${d.fix ? ` ${$(d.fix)} brings it back.` : ''}`;
  return `${head} ${o.option} on ${o.item} now costs you ${$(o.costAfter)} more, and you charge ${$(o.charges)} for it.`;
}

/** Deliveries of these items since `since` that moved the price: each with what it did to the menu, and the managers
 *  told about the ones that hurt (once a delivery). */
export async function checkDeliveries(db: any, tenantId: string, tenant: any, itemIds: string[], since: string): Promise<MoveWithEffects[]> {
  const ids = Array.from(new Set(itemIds.filter((x) => ID.test(x)))).slice(0, 50); if (!ids.length) return [];
  const T = `tenants/${tenantId}`; const target = targetOf(tenant);
  // Only what was put away first; the whole stock (for what each dish costs) only when one of them moved.
  const snaps: any[] = await db.getAll(...ids.map((id) => db.doc(`${T}/inventory/${id}`)));
  const moved = ids.map((id, k) => (snaps[k]?.exists ? moveOf(id, snaps[k].data() || {}, since) : null)).filter((m): m is Move => !!m);
  if (!moved.length) return [];
  const inv = await db.collection(`${T}/inventory`).limit(3000).get();
  const all = new Map<string, any>(inv.docs.map((d: any) => [d.id, d.data() || {}]));
  const menu = Array.from(all.entries()).filter(([, x]) => isMenuItem(x));
  const out: MoveWithEffects[] = moved.map((m) => { const e = effectsOf(m, all, menu, target); return { ...m, dishes: e.dishes.slice(0, 6), options: e.options.slice(0, 4) }; });
  for (const m of out) {
    const message = alertWords(m, target); if (!message || !m.batchId) continue;
    const key = `${m.id}_${m.batchId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 160); if (!ID.test(key) || key.endsWith('_')) continue;
    const ref = db.doc(`${T}/priceAlerts/${key}`);
    const made = await ref.create({ itemId: m.id, batchId: m.batchId, from: m.from, to: m.to, pct: m.pct, at: m.at, message, createdAt: new Date().toISOString() }).then(() => true).catch(() => false);
    // Not told (the notices weren't written): the mark comes off, so the next check tells them.
    if (made && (await tellManagers(db, tenantId, tenant, { type: 'price_moved', link: '/food-cost', message }).catch(() => -1)) < 0) await ref.delete().catch(() => undefined);
  }
  return out;
}
