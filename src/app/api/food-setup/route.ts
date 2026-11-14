// src/app/api/food-setup/route.ts — SET UP FOR FOOD AND DRINK (lib/food-setup, lib/food-starters; design canvas
// "Food setup"; the page at settings/setup/food). Managers and owners.
//   plan  { tenantId, answers: { kind, ways, team } } → the plan to look over: stations (and the business's own, when it
//         set some), courses with table service, the starter menu with each item's cost to make and a suggested price,
//         the ingredients with typical costs, the tools that fit (never switched here), and which of the items and
//         ingredients the business already has (by name: those are kept as they are), and starter items it had and took
//         off (removed: not added again unless asked).
//   apply { tenantId, answers, stations?: string[] | null, menu?: boolean, skip?: string[], restore?: string[] } → sets it up:
//         - how it set up, and whether food is its main business (it says so, or nothing says it's anything else and it
//           has no services: then it's food and drink, and whether it's one person is taken from here too). A spa with
//           a tea bar sets up its menu and stays a spa;
//         - the stations given (null or absent: its own are kept, or the plan's when it has none), and the usual courses
//           with table service when it hasn't set its own;
//         - with `menu` (on unless false): each starter ingredient it doesn't have yet, at its typical cost, marked as
//           typical and not yet counted (so nothing shows as run out before the first count), and each starter item it
//           doesn't have yet (less `skip`), with its recipe, station, timing and likely allergens, at no price and off the
//           menu until the business sets a price (and confirms its allergens).
//         Applying again adds only what's missing. Never changes the business's tools, prices or anything already made.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { chosenNiche } from '@/lib/niche';
import { cleanAnswers, coursesFor, foodIsMain, foodPlan, hasOwnStations, isFoodBusiness, kindLabel } from '@/lib/food-setup';
import { FOOD_STARTERS, INGREDIENT_BY_KEY, ingredientsFor, likelyAllergens, unitOf } from '@/lib/food-starters';
import { MAX_STATIONS, NAME_MAX } from '@/lib/table-service';
import { ingredientUnit } from '@/lib/menu-stock';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const nameKey = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'plan');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['plan', 'apply'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const a = cleanAnswers(b.answers); if (!a) return bad('Pick what you run.');
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data() || {};
  const inv = await db.collection(`${T}/inventory`).limit(1500).get();
  const live = inv.docs.map((d: any) => ({ id: d.id, x: d.data() || {} })).filter(({ x }: any) => x.archived !== true && x.status !== 'archived');
  const haveIng = new Map<string, any>(); const haveItem = new Map<string, any>();
  for (const r of live) { const k = nameKey(r.x.name); if (!k) continue; if (r.x.type === 'refreshment') { if (!haveItem.has(k)) haveItem.set(k, r); } else if (r.x.type !== 'equipment' && !haveIng.has(k)) haveIng.set(k, r); }
  const plan = foodPlan(a, tenant);
  // Starter items added before and since taken off: not added again unless asked (restore).
  const ids = new Set(live.map((r: any) => r.id));
  const removed = (Array.isArray(tenant?.foodSetup?.added) ? tenant.foodSetup.added.map(String) : []).filter((k: string) => !ids.has(`starter-item-${k}`) && !plan.items.some((x) => x.key === k && haveItem.has(nameKey(x.name))));

  if (action === 'plan') {
    return ok({ plan, have: { items: plan.items.filter((x) => haveItem.has(nameKey(x.name))).map((x) => x.key), ingredients: plan.ingredients.filter((x) => haveIng.has(nameKey(x.name))).map((x) => x.key), removed } });
  }

  // APPLY
  const by = String(g.actor?.name || 'A manager').slice(0, 60); const now = new Date().toISOString();
  let stations: string[] | null = null;
  if (Array.isArray(b.stations)) {
    const seen = new Set<string>(); stations = [];
    for (const s of b.stations.slice(0, MAX_STATIONS)) { const n = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); if (!n || seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase()); stations.push(n); }
    if (!stations.length) return bad('Keep at least one place where things are made.');
  } else if (!hasOwnStations(tenant)) stations = plan.stations;
  const courses = coursesFor(a) && !Array.isArray(tenant?.kitchenSettings?.courses) ? coursesFor(a) : null;
  const solo = a.team === 'solo';
  // Food and drink becomes what the business is only when nothing says it's something else and it has no services of
  // its own; whether it's one person is set here only for a food business, or one that never said (a spa's tea bar
  // doesn't change the spa).
  const sv = await db.collection(`${T}/services`).limit(25).get();
  const hasServices = sv.docs.some((d: any) => { const x: any = d.data() || {}; return x.status !== 'archived' && x.archived !== true; });
  const primary = !!chosenNiche(tenant) ? chosenNiche(tenant) === 'hospitality' : foodIsMain(tenant, hasServices);
  const restore = new Set((Array.isArray(b.restore) ? b.restore : []).map(String));
  const tPatch: any = { foodSetup: { kind: a.kind, ways: a.ways, team: a.team, primary, at: now, by }, updatedAt: now,
    ...(!chosenNiche(tenant) && primary ? { niche: 'hospitality' } : {}),
    ...(isFoodBusiness(tenant) || primary || typeof tenant?.shape?.solo !== 'boolean' ? { shape: { solo } } : {}),
    ...(stations || courses ? { kitchenSettings: { ...(stations ? { stations } : {}), ...(courses ? { courses } : {}) } } : {}) };

  // In one save that reads first: a starter ingredient or item has its own fixed id, so two taps (or two managers) at
  // once add it once. One the business made itself, by the same name, is kept as it is.
  const skip = new Set([...(Array.isArray(b.skip) ? b.skip : []).map(String), ...removed.filter((k: string) => !restore.has(k))]);
  const useStations = stations || (hasOwnStations(tenant) ? (tenant.kitchenSettings.stations as string[]) : plan.stations);
  const wanted = b.menu === false ? [] : FOOD_STARTERS[a.kind].filter((x) => !skip.has(x.key) && !haveItem.has(nameKey(x.name)));
  const needed = new Set(wanted.flatMap((x) => x.recipe.map(([k]) => k)));
  const ingList = ingredientsFor(a.kind).filter((i) => needed.has(i.key));
  const ingRef = (k: string) => db.doc(`${T}/inventory/starter-ing-${k}`); const itemRef = (k: string) => db.doc(`${T}/inventory/starter-item-${k}`);
  const counts = await db.runTransaction(async (tx: any) => {
    const ingSnaps = await Promise.all(ingList.map((i) => tx.get(ingRef(i.key))));
    const itemSnaps = await Promise.all(wanted.map((x) => tx.get(itemRef(x.key))));
    let ingAdded = 0, ingKept = 0, itemsAdded = 0; const itemsKept = (b.menu === false ? 0 : FOOD_STARTERS[a.kind].filter((x) => !skip.has(x.key) && haveItem.has(nameKey(x.name))).length);
    const ids = new Map<string, { id: string; name: string; unit: string }>(); const gaps = new Map<string, string>();
    ingList.forEach((i, n) => {
      const have = haveIng.get(nameKey(i.name));
      // One it has already, measured the same way: used as it is. Measured another way, a recipe line can't use the
      // starter's amount, so the item says to add it to the recipe itself (recipeGaps).
      if (have) { const unit = ingredientUnit(have.x); if (unit.toLowerCase() === unitOf(i).toLowerCase()) ids.set(i.key, { id: have.id, name: String(have.x.name), unit }); else gaps.set(i.key, String(have.x.name)); ingKept++; return; }
      const ref = ingRef(i.key);
      if (ingSnaps[n].exists) { const d: any = ingSnaps[n].data() || {}; ids.set(i.key, { id: ref.id, name: String(d.name || i.name), unit: ingredientUnit(d) }); ingKept++; return; }
      tx.set(ref, { id: ref.id, name: i.name, type: 'professional', category: i.category, status: 'active', totalStock: 0, supplier: '', batches: [], costPerUnit: i.cost,
        costingMethod: i.how, ...(i.how === 'size' ? { size: i.size, unit: i.unit } : { estimatedUses: i.uses, useUnit: i.useUnit }),
        // A typical price until the business puts in its own; not counted until its first count or delivery.
        typicalCost: true, container: i.container, countStock: false, createdVia: 'food-starter', starterKey: i.key, createdAt: now, updatedAt: now });
      ids.set(i.key, { id: ref.id, name: i.name, unit: unitOf(i) }); ingAdded++;
    });
    wanted.forEach((x, n) => {
      if (itemSnaps[n].exists) return;
      const ref = itemRef(x.key);
      const formula = x.recipe.flatMap(([k, q]) => { const r = ids.get(k); return r && INGREDIENT_BY_KEY.has(k) ? [{ id: r.id, name: r.name, quantityUsed: q, unit: r.unit }] : []; });
      const station = useStations.includes(x.station) ? x.station : useStations[0] || null;
      tx.set(ref, { id: ref.id, name: x.name, type: 'refreshment', category: x.section, description: '', status: 'active', isActive: true, totalStock: 0, supplier: '', batches: [],
        price: 0, msrp: 0, showInConcierge: false, formula, station, course: a.ways.includes('table') ? x.course : null, makeSeconds: x.makeSeconds,
        allergensLikely: likelyAllergens(x), costTarget: x.target, recipeGaps: x.recipe.map(([k]) => gaps.get(k)).filter(Boolean),
        createdVia: 'food-starter', starterKey: x.key, starterKind: a.kind, createdAt: now, updatedAt: now });
      itemsAdded++;
    });
    // Which starter items it has had (so one taken off later isn't put back by itself).
    const hadKeys = Array.from(new Set([...(Array.isArray(tenant?.foodSetup?.added) ? tenant.foodSetup.added.map(String) : []), ...wanted.filter((x, n) => !itemSnaps[n].exists).map((x) => x.key), ...wanted.filter((x, n) => itemSnaps[n].exists).map((x) => x.key)])).slice(0, 200);
    tx.set(db.doc(T), { ...tPatch, foodSetup: { ...tPatch.foodSetup, added: hadKeys } }, { merge: true });
    return { ingAdded, ingKept, itemsAdded, itemsKept: itemsKept + itemSnaps.filter((x: any) => x.exists).length };
  });
  const { ingAdded, ingKept, itemsAdded, itemsKept } = counts;
  await logAuditAdmin(db, tenantId, { action: 'food.setup', targetType: 'tenant', targetId: tenantId,
    summary: `${by} set the business up as ${kindLabel(a.kind).toLowerCase()}${itemsAdded ? `: ${itemsAdded} menu items and ${ingAdded} ingredients added` : ''}.`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: by } } as any).catch(() => {});
  return ok({ added: { ingredients: ingAdded, items: itemsAdded }, kept: { ingredients: ingKept, items: itemsKept }, stations: stations || null, courses: !!courses });
}
