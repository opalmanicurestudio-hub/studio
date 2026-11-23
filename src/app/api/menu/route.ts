// src/app/api/menu/route.ts — THE MENU, for the team (app/(app)/menu): what guests see of each drink and dish, its
// choices, and "Sold out" in one tap. Items themselves (stock, cost, recipe) are made in Inventory; this is the menu side.
//   list    { tenantId }                                   → every menu item (anyone on the team)
//   soldout { tenantId, itemId, groupId?, optionId?, out } → the item, or one of its choices, sold out or back (anyone on the team)
//   save    { tenantId, itemId, item: { name, section, words, price, choices, onMenu, membersOnly, makeSeconds?,
//             holdMinutes?, batchSize?, imageUrl?, recipe? } } → managers (the kitchen timing: lib/counter-orders, lib/holding;
//             the photo: an https address the Menu page uploaded, or null to take it off; the recipe: [{ id, quantityUsed }],
//             what goes into one, from the business's own stock — an item with one is counted by its ingredients,
//             lib/menu-stock; [] takes it off, and the item is counted by itself again)
//   spanish { tenantId, itemId, name, words? } | { section, name } | { daypart, name } → managers: Spanish for the guest
//             screens (lib/guest-lang); empty takes it off
//   ingredients { tenantId } → managers: what a recipe can use (the business's stock, by name, with what's left and what
//             it's counted in; never cost or supplier)
//   service { tenantId, courses?, stations?, compAllowanceCents?, compReasons? } → managers: table service (lib/table-
//             service): the courses (name, held until fired or not), the stations things are made at, how much a server
//             can comp in a night on their own say, and the comp reasons offered. list returns them as `service`.
//   (save also takes station: one of the stations or null, and course: a course number, 0 for right away, or null;
//   allergens: what it contains, from lib/allergens; and dailyCount: how many it starts each night with, or null.)
//   (service also takes askAllergies: whether a table is asked about allergies before its first order; finishTogether:
//   whether a table's plates are timed to finish together; and nudges: the server's nudge timings, lib/nudges.)
//   counts  { tenantId, fresh? }                          → tonight's counted dishes and what each has left, and which
//             menu items are sold out now (anyone on the team); one at zero is sold out on every menu as this is read
//             (lib/dish-counts-server). fresh: read again now, not what was read a few seconds ago.
//   count   { tenantId, itemId, value }                   → managers: tonight's number for a dish (0 to 999), 'off' for
//             not counted tonight, or 'menu' for the menu's own number
//   targets { tenantId, targets: { 'drive-thru'?, counter?, kiosk?, ahead? } } → managers: seconds each kind of order
//             aims to be handed over in (list returns them)
//   voice   { tenantId, on?, askName? } → managers: the drive-thru's voice assistant on or off here (api/counter/voice),
//             and whether it asks each car for a first name; list says whether it's set up, on, asking, and up to date
//   voiceUpdate { tenantId } → managers: bring this business's assistant up to date (lib/drive-thru-voice-setup)
//   create  { tenantId, name, section, price, station?, onHand?, tapKey? } → managers: a new item, on the menu and in
//             Inventory in one step (its editor opens next); save also takes alsoAt [{ station, part }] (lib/two-stations).
//   times   { tenantId, dayparts: [{ id, name, from, to }], happyHour: { on, days, from, to } } → managers: menus by time
//             of day and happy hour (lib/menu-time); save also takes dayparts (ids), happyPrice, combo and comboParts,
//             and upgrades { size, items }: what's offered at the end, once it's added (lib/menu-upgrades).
//   laneSettings { tenantId, spots | pickupOnly | readyTexts | tips | discounts | tiles } → managers: how many numbered pull-forward spots the drive-thru
//             has (1 to 8), whether it's pickup only (cars collect orders placed ahead; nobody orders at the speaker), or
//             whether guests can ask for a text when their order is ready (lib/ready-text)
//             (bagGroups [names] | bagExtras [ids]: what's ticked into a to-go bag before it's handed over, lib/bag-extras:
//             the guest's picks from those choices, and those of the business's extras.)
//             (scaleLabels { on?, holds?, digits?, unit? }: how the business's scale prints its stickers, lib/scale-label;
//             and save's scaleNo: an item sold by weight's number on that scale, one item to a number.)
//   voiceSetup { tenantId } → managers: make this business's assistant with the voice service (lib/drive-thru-voice-setup)
//   prep    { tenantId, prepId?, name, makes, unit, keepsDays?, minutes?, recipe } → managers: a prep recipe added or
//             changed (lib/prep-recipes-server savePrep): what goes into a batch, what a batch makes, how long it keeps
//   prepRemove { tenantId, prepId } → managers: a prep recipe put away (not while a recipe uses it)
//   (save's recipe lines may be written in a kitchen measure: [{ id, amount, measure }], lib/kitchen-units; and each
//   choice option may carry changes: what it adds, swaps or leaves out of the recipe, lib/choice-recipe.)
// Suppliers are never read or written here. Costs are for managers only: what each item costs to make, what each
// ingredient costs (for the recipe editor's live cost), and the prep recipes. `list` also gives each item's recipe.
import { bagExtrasSetOf, cleanBagGroups, MAX_BAG_EXTRAS } from '@/lib/bag-extras';
import { extraWords, extrasOf } from '@/lib/plate-extras';
import { bizLocationsOf, forgetLocations, hereOf, zoneOf, zoneToAsk, zonedFor, zonedHere } from '@/lib/here-server';
import { locateMissing } from '@/lib/locate-server';
import { cleanWeek } from '@/lib/ahead-places';
import { smsConfigured } from '@/lib/sms';
import { cleanDayparts, cleanHappyHour, daypartsOf, happyHourOf } from '@/lib/menu-time';
import { cleanSlotItems, SLOT_ITEMS_MAX, SLOT_ITEMS_MIN } from '@/lib/ahead-slots';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { readMenu, setSoldOut, isMenuItem, menuItemOf, menuItemNow } from '@/lib/menu-server';
import { WEIGHT_UNITS, byWeightOf } from '@/lib/menu-weight';
import { cleanScaleNo, scaleSetOf, SCALE_HOLDS } from '@/lib/scale-label';
import { itemCost, targetOf } from '@/lib/food-cost';
import { cleanPace, paceSettingsOf } from '@/lib/kitchen-pace';
import { forgetPace } from '@/lib/kitchen-pace-server';
import { cleanRecovery, recoverySettingsOf } from '@/lib/table-recovery';
import { forgetMenuFacts } from '@/lib/klair-menu-server';
import { cleanEs, spanishOf, ES_NAME_MAX, ES_WORDS_MAX, ES_SECTION_MAX, ES_DAYPART_MAX } from '@/lib/guest-lang';
import { FieldValue } from 'firebase-admin/firestore';
import { recipeOf, ingredientLeft, ingredientUnit, MAX_RECIPE_LINES } from '@/lib/menu-stock';
import { choiceGroups, cleanForSave, outNow, outAtOf, MAX_GROUPS, MAX_OPTIONS } from '@/lib/menu-choices';
import { createHash, randomBytes } from 'crypto';
import { targetsOf, photoOf, spotsOf, aheadAtDriveThru, CHANNELS } from '@/lib/counter-orders';
import { lanesOf } from '@/lib/drive-lanes';
import { earlyModeOf } from '@/lib/lane-entry';
import { foodDeliveryOf, DRIVE_MAX_CHOICES } from '@/lib/food-delivery';
import { appMoneyFrom, MARKUP_CHOICES, FEE_MAX, appOrdersOf, cleanAppName, SHELF_CHOICES } from '@/lib/app-orders';
import { deliveryFrom, deliveryProblems } from '@/lib/delivery-plan';
import { hasMapsKey } from '@/lib/geocode-server';
import { hasTimeZone, tenantTimeZone } from '@/lib/tenant-time';
import { sensorsView, newSensor, stopSensor, pointsView } from '@/lib/lane-entry-server';
import { pointOf } from '@/lib/lane-entry';
import { agentOf, assistantVersion } from '@/lib/drive-thru-voice';
import { setAssistantLanguages, setUpDriveThruAssistant, updateDriveThruAssistant, VOICE_VERSION } from '@/lib/drive-thru-voice-setup';
import { aheadOf } from '@/lib/counter-ahead';
import { anotherDayOf, cleanMinOrder, DAYS_AHEAD, NOTICE_HOURS, MIN_ORDER_MAX } from '@/lib/ahead-days';
import { nudgeSettingsOf, NUDGE_KEYS } from '@/lib/nudges';
import { cleanTablePay, tablePayOf } from '@/lib/table-bill';
import { askAllergiesOf, finishTogetherOn, compAllowanceCents, compReasonsOf, coursesOf, stationsOf, MAX_COMP_ALLOWANCE_CENTS, MAX_COURSES, MAX_STATIONS } from '@/lib/table-service';
import { ALLERGENS, cleanKeys } from '@/lib/allergens';
import { MAX_COUNT } from '@/lib/dish-counts';
import { forgetCounts, liveCounts, setTonightCount } from '@/lib/dish-counts-server';
import { accountOf } from '@/lib/reader-sale';
import { linkOrigin } from '@/lib/app-origin';
import { cleanAlsoAt, MAX_ALSO } from '@/lib/two-stations';
import { MAX_UPGRADE_ITEMS, upgradesOf } from '@/lib/menu-upgrades';
import { buildEntry } from '@/lib/stock-ledger';
import { canBeIngredient, readPartsDeep, recipeFromScreen, removePrep, savePrep } from '@/lib/prep-recipes-server';
import { cleanChanges, optionChanges, changeIds, type ChoiceChange } from '@/lib/choice-recipe';
import { groupOfSet, idsOnItem, setIdsOf, type ChoiceSet } from '@/lib/choice-sets';
import { measuresFor, toStockUnits, hasYield, yieldOf, perEachOf } from '@/lib/kitchen-units';
import { prepOf, isPrep } from '@/lib/prep-recipes';
import { linesCost, partUnitCost } from '@/lib/food-cost';
import { unitLabel } from '@/lib/product-cost';
import { voiceOfferMode, VOICE_OFFERS_FROM } from '@/lib/voice-offer';
import { tipsOf, discountsOf, cleanDiscount, DISCOUNTS_MAX } from '@/lib/counter-money';
import { oneOffMaxOf, ONE_OFF_MAX_CAP, type OneOffName } from '@/lib/counter-oneoff';
/** What's been rung in at the counter that isn't on the menu, by name, the last three months, most recent first. */
async function oneOffNamesOf(db: any, tenantId: string): Promise<OneOffName[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const snap = await db.collection(`tenants/${tenantId}/oneOffNames`).orderBy('lastAt', 'desc').limit(30).get().catch(() => ({ docs: [] as any[] }));
  return snap.docs.map((d: any) => d.data() || {}).filter((x: any) => String(x.lastAt || '') >= since && x.name)
    .map((x: any) => ({ key: String(x.key || ''), name: String(x.name).slice(0, 60), count: Math.max(0, Math.round(Number(x.count) || 0)), lastPrice: Math.round((Number(x.lastPrice) || 0) * 100) / 100, lastAt: String(x.lastAt) }));
}

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
/** This app's storage, where the Menu page uploads photos. */
const ownBuckets = () => Array.from(new Set([process.env.FIREBASE_STORAGE_BUCKET, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET].map((b) => String(b || '').trim()).filter((b) => /^[A-Za-z0-9._-]{3,222}$/.test(b))));
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Table service as the Menu page edits it (lib/table-service). */
const serviceOf = (t: any) => ({ pace: paceSettingsOf(t), recovery: recoverySettingsOf(t), courses: coursesOf(t), stations: stationsOf(t), compAllowanceCents: compAllowanceCents(t), compReasons: compReasonsOf(t), askAllergies: askAllergiesOf(t), finishTogether: finishTogetherOn(t), tablePay: tablePayOf(t), nudges: nudgeSettingsOf(t) });

/** What the Menu page shows of ordering ahead: the settings, the guests' link, and whether payments are connected. */
/** Delivery app orders, as the Menu page shows them (lib/app-orders). */
const APP_CODES = ['doordash', 'ubereats', 'grubhub', 'other'];
const appSettings = (t: any) => { const a = t?.appOrders || {}; const v = appOrdersOf(t);
  return { on: a.on === true, apps: Array.isArray(a.apps) ? a.apps.filter((x: any) => APP_CODES.includes(String(x))) : [], otherName: cleanAppName(a.otherName) || '', shelves: v.shelves,
    // Each app's money (lib/app-orders): its price difference, its share, and who pays the sales tax.
    money: Object.fromEntries(APP_CODES.map((c) => [c, appMoneyFrom(a.money?.[c])])) }; };

/** The business's delivery is set up and on (zones, fees, days, the time zone), so food can go out with its drivers. */
const deliveryReady = (t: any) => { const plan = deliveryFrom(t?.retailSettings); return plan.on && hasTimeZone(t) && !deliveryProblems(plan, { mapsReady: hasMapsKey() }).length; };

/** With more than one location (lib/ahead-places): each one's ordering ahead, delivery, hours and its own link. Each
 *  one with an address and no pin is found on the map first (lib/locate-server); `map` says where it stands, and `zone`
 *  is its own time zone when it keeps one (lib/here-server zoneOf). */
async function withPlaces(db: any, tenantId: string, a: any, t: any) {
  let locs = await bizLocationsOf(db, tenantId);
  if (locs.length < 2) return a;
  // (Every time: one found from an address that's since changed is looked up again. One read when nothing's due.)
  const maps = await locateMissing(db, tenantId);
  locs = await bizLocationsOf(db, tenantId);
  const house = tenantTimeZone(t);
  // (`shop`: a store on the online shop, lib/shop-stores-server; its own shop link picks it for pickup.)
  return { ...a, houseZone: house, places: locs.map((l) => ({ id: l.id, name: l.name, address: l.address, ahead: l.ordering.ahead, delivery: l.ordering.delivery, shop: l.ordering.shop, hours: l.ordering.hours, pinned: !!l.coordinates,
    map: maps[l.id] || (l.coordinates ? 'on' : l.address ? 'not_yet' : 'no_address'), zone: zoneOf(t, l) === house ? null : zoneOf(t, l), zoneAsk: zoneToAsk(t, l),
    link: `${a.link}?place=${encodeURIComponent(l.id)}`, shopLink: `${String(a.link).replace(/\/order\/([^/?#]+).*$/, '/shop/$1')}?store=${encodeURIComponent(l.id)}` })) };
}

function aheadSettings(t: any, tenantId: string, origin: string | null) {
  const a = t.orderAhead || {}; const A = aheadOf(t);
  // Delivery by the business's own drivers (lib/food-delivery): on, the longest drive for hot food, and whether its
  // delivery zones are set up (Orders, Delivery), which it needs first.
  const F = foodDeliveryOf(t);
  return { on: A.on, driveThru: a.driveThru !== false, inside: a.inside !== false, curbside: a.curbside === true, laterHours: A.laterHours, slotItems: A.slotItems, payments: !!accountOf(t),
    delivery: F.on, deliveryMaxMin: F.maxDriveMin, deliveryFeeTaxed: F.feeTaxed, deliveryReady: deliveryReady(t), deliveryByZip: deliveryFrom(t.retailSettings).by === 'postal',
    // Orders for another day (lib/ahead-days): on, how far ahead, the notice, and the smallest order.
    anotherDay: anotherDayOf(t),
    link: `${linkOrigin(t, origin).replace(/\/+$/, '')}/order/${encodeURIComponent(tenantId)}` };
}

/** The locations whose lanes each have their own sensor (with more than one; none with one). */
async function sensorPlaces(db: any, tenantId: string): Promise<{ id: string; name: string }[]> {
  const locs = await bizLocationsOf(db, tenantId); return locs.length > 1 ? locs.map((l) => ({ id: l.id, name: l.name })) : [];
}

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    const SET_ACTIONS = ['sets', 'setSave', 'setRemove', 'setApply', 'setOff', 'setFrom'];
    if (!['list', 'soldout', 'save', 'ingredients', 'targets', 'service', 'voice', 'voiceSetup', 'voiceUpdate', 'laneSettings', 'ahead', 'aheadPlace', 'places', 'apps', 'counts', 'count', 'times', 'create', 'prep', 'prepRemove', 'setSoldOut', 'spanish', ...SET_ACTIONS].includes(action)) return bad('Unknown action.');
    // Klair's answers to guests read the menu afresh after any change here (lib/klair-menu-server).
    if (action !== 'list') forgetMenuFacts(tenantId);
    const g: any = await requireRole(req, tenantId, ['save', 'ingredients', 'targets', 'service', 'voice', 'voiceSetup', 'voiceUpdate', 'laneSettings', 'ahead', 'aheadPlace', 'places', 'apps', 'count', 'times', 'create', 'prep', 'prepRemove', 'spanish', ...SET_ACTIONS].includes(action) ? 'manager' : 'staff'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('The menu is the business’s own.', 403);
    const db = getAdminDb();

    // With more than one location: the menu as the location picked in the app sees it, and its sold out here or
    // everywhere (lib/menu-choices outWhere).
    const soldHere = action === 'list' || action === 'soldout' || action === 'save' ? await hereOf(db, tenantId, b.locationId) : null;
    if (action === 'list') {
      const [menu, t, items] = await Promise.all([readMenu(db, tenantId, soldHere), db.doc(`tenants/${tenantId}`).get(), db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400).get()]);
      const td: any = t.data() || {};
      const setUp = !!process.env.RETELL_API_KEY && !!agentOf(td);
      // Each item's recipe (what goes into one), for the Menu page's editor.
      const recipes: Record<string, any[]> = {};
      for (const d of items.docs) { const r = recipeOf(d.data() || {}, d.id); if (r.length) recipes[d.id] = r; }
      // Tonight's counts, for "3 left" beside each counted dish (lib/dish-counts).
      // (The location picked in the app's own, with more than one, on its own clock.)
      const countsTenant = soldHere ? await zonedHere(db, tenantId, td, soldHere) : td;
      const counts = (await liveCounts(db, tenantId, countsTenant, items.docs.map((d: any) => ({ id: d.id, x: d.data() || {} })).filter((r: any) => isMenuItem(r.x)), { at: soldHere }).catch(() => ({ rows: [] as any[] }))).rows;
      // One the count just sold out (or brought back) shows that way here too.
      // (Never lowering one sold out at this location only: the counts are the business's.)
      for (const r of counts) { const m = menu.find((x) => x.id === r.id); if (m) m.soldOut = r.soldOut || m.outWhere === 'here'; }
      const canEdit = !!(g.actor?.isManager || g.actor?.isTenantOwner);
      // For managers: what each costs to make from its recipe, as a share of its price (lib/food-cost).
      let costs: Record<string, { cost: number | null; share: number | null; over: boolean; typical: boolean; target: number; thin?: string[] }> | undefined;
      // For managers, too: what each choice changes in the recipe (lib/choice-recipe), and the prep recipes made in batches.
      let changes: Record<string, Record<string, ChoiceChange[]>> | undefined; let preps: any[] | undefined; let sets: any[] | undefined;
      if (canEdit) {
        const prepDocs = (await db.collection(`tenants/${tenantId}/inventory`).where('createdVia', '==', 'prep-recipe').limit(200).get().catch(() => ({ docs: [] as any[] }))).docs
          .filter((d: any) => isPrep(d.data() || {}, d.id));
        const ids = Array.from(new Set([...Object.values(recipes).flatMap((r: any[]) => r.map((l) => String(l.id))), ...items.docs.flatMap((d: any) => changeIds(d.data() || {})), ...prepDocs.map((d: any) => d.id)])).slice(0, 600);
        const parts = await readPartsDeep(db, `tenants/${tenantId}`, ids);
        const target = targetOf(td); costs = {}; changes = {};
        for (const d of items.docs) { const x: any = d.data() || {}; if (!isMenuItem(x)) continue; const c = itemCost(d.id, x, parts, target); const thin = c.options.filter((o) => o.thin).map((o) => o.option);
          costs[d.id] = { cost: c.cost, share: c.share, over: c.over, typical: c.typical, target, ...(thin.length ? { thin } : {}) };
          const ch = optionChanges(x); if (ch.size) changes[d.id] = Object.fromEntries(ch); }
        preps = prepDocs.map((d: any) => prepRow(d.id, d.data() || {}, parts)).sort((a: any, c: any) => a.name.localeCompare(c.name));
        // The choice sets, for an item's editor to turn on (lib/choice-sets).
        const { cleanSet } = await import('@/lib/choice-sets');
        sets = (await db.collection(`tenants/${tenantId}/choiceSets`).limit(60).get().catch(() => ({ docs: [] as any[] }))).docs
          .map((d: any) => { const c = cleanSet(d.data() || {}, () => d.id); return 'error' in c ? null : { id: d.id, ...c }; }).filter(Boolean).sort((a: any, c: any) => a.name.localeCompare(c.name));
      }
      const hereName = soldHere ? (await bizLocationsOf(db, tenantId)).find((l) => l.id === soldHere)?.name || null : null;
      return ok({ menu, recipes, counts, canEdit, here: soldHere ? { id: soldHere, name: hereName } : null, ...(costs ? { costs, changes, preps, sets } : {}), targets: targetsOf(td), service: serviceOf(td), times: { dayparts: daypartsOf(td), happyHour: happyHourOf(td) },
        // The business's Spanish for its sections and menus by time of day (lib/guest-lang), for the Spanish column.
        spanish: canEdit ? spanishOf(td) : null, lane: { spots: spotsOf(td), pickupOnly: td.driveThru?.pickupOnly === true, lanes: lanesOf(td), kitchenEarly: earlyModeOf(td), sensors: canEdit ? await sensorsView(db, tenantId, td, await sensorPlaces(db, tenantId)) : [], points: canEdit ? await pointsView(db, tenantId, lanesOf(td) === 2, await sensorPlaces(db, tenantId)) : [], aheadThere: aheadAtDriveThru(td), readyTexts: smsConfigured() ? td.readyTexts?.off !== true : null, bagCheck: td.bagCheck?.off !== true,
          // What's ticked into a to-go bag (lib/bag-extras), and the business's extras to pick from (lib/plate-extras).
          bagExtras: canEdit ? { ...bagExtrasSetOf(td), plate: extrasOf(td).filter((e) => e.per !== 'guest' && e.when !== 'here').map((e) => ({ id: e.id, name: e.name, words: extraWords(e) })) } : null }, money: { tips: tipsOf(td), discounts: discountsOf(td) },
        // Something not on the menu at the counter (lib/counter-oneoff): up to how much, and what's been rung in by name.
        oneOff: canEdit ? { max: oneOffMaxOf(td), names: await oneOffNamesOf(db, tenantId) } : null,
        // How the register's tiles are arranged (lib/register-tiles): for the Register tiles card.
        tiles: canEdit ? (await import('@/lib/register-tiles')).tileSetupOf(td) : null,
        // Scale labels (lib/scale-label): how the business's scale prints its stickers.
        scale: canEdit ? scaleSetOf(td) : null, ahead: await withPlaces(db, tenantId, aheadSettings(td, tenantId, req.nextUrl?.origin || null), td), apps: appSettings(td),
        voice: { setUp, on: setUp && td.driveThru?.voice !== false, canSetUp: !setUp && !!process.env.RETELL_API_KEY && !!process.env.VOICE_AGENT_SECRET, askName: td.driveThru?.askName !== false, offers: voiceOfferMode(td), offersReady: assistantVersion(td) >= VOICE_OFFERS_FROM,
          // Spanish at the speaker (lib/drive-thru-voice-setup): on, and whether it can be changed here (the business's own
          // assistant, up to date).
          spanish: td.driveThru?.spanish !== false, spanishHeard: td.driveThru?.spanishHeard !== false, spanishHere: setUp && !!td.driveThru?.voiceAgentId && !!td.driveThru?.voiceLlmId && Math.floor(Number(td.driveThru?.voiceVersion) || 1) >= VOICE_VERSION,
          // An assistant this app made for the business, made with older instructions: offered an update.
          outdated: setUp && !!td.driveThru?.voiceLlmId && Math.floor(Number(td.driveThru?.voiceVersion) || 1) < VOICE_VERSION } });
    }

    // Spanish for the guest screens (lib/guest-lang), from the Menu page's Spanish column, one name at a time: an item's
    // name and description, a section's name, or a menu by time of day's name. Empty takes it off (the English shows).
    if (action === 'spanish') {
      const name = cleanEs(b.name, b.itemId ? ES_NAME_MAX : b.section !== undefined ? ES_SECTION_MAX : ES_DAYPART_MAX);
      if (b.itemId !== undefined) {
        const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which item?');
        const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
        const cur: any = (await ref.get()).data();
        if (!cur || !isMenuItem(cur)) return bad('That item isn’t on the menu.', 404);
        // (The name and the description each by itself: one saved never touches the other.)
        const patch: Record<string, any> = {};
        if (b.name !== undefined) patch.nameEs = name;
        if (b.words !== undefined) patch.descriptionEs = cleanEs(b.words, ES_WORDS_MAX);
        if (!Object.keys(patch).length) return bad('Its name or its description in Spanish?');
        await ref.set({ ...patch, menuUpdatedAt: new Date().toISOString(), menuUpdatedBy: words(g.actor?.name, 60) || null }, { merge: true });
        // (Only what was sent: a reply never carries the other field as it was before a save just made to it.)
        return ok({ itemId, ...(b.name !== undefined ? { nameEs: name } : {}), ...(b.words !== undefined ? { wordsEs: patch.descriptionEs } : {}) });
      }
      const tRef = db.doc(`tenants/${tenantId}`);
      if (b.section !== undefined) {
        const section = words(b.section, 40); if (!section) return bad('Which section?');
        await tRef.set({ menuSpanish: { sections: { [section]: name || FieldValue.delete() } } }, { merge: true });
      } else if (b.daypart !== undefined) {
        const id = String(b.daypart || ''); const td0: any = (await tRef.get()).data() || {};
        if (!daypartsOf(td0).some((d) => d.id === id)) return bad('Pick one of your menus by time of day.');
        await tRef.set({ menuSpanish: { dayparts: { [id]: name || FieldValue.delete() } } }, { merge: true });
      } else return bad('An item, a section, or a menu by time of day?');
      return ok({ spanish: spanishOf((await tRef.get()).data() || {}) });
    }

    if (action === 'counts' || action === 'count') {
      // (A location's own, with more than one: the one picked in the app, or the table's.)
      const countAt = await hereOf(db, tenantId, b.locationId);
      const td: any = await zonedHere(db, tenantId, (await db.doc(`tenants/${tenantId}`).get()).data() || {}, countAt);
      if (action === 'count') { const r = await setTonightCount(db, tenantId, td, b.itemId, b.value, String(g.actor?.name || 'A manager'), countAt); if (!r.ok) return bad(r.error, r.status); }
      const c = await liveCounts(db, tenantId, td, undefined, { fresh: b.fresh === true || action === 'count', at: countAt });
      return ok({ day: c.day, counts: c.rows, soldOut: c.soldOut });
    }

    if (action === 'voiceSetup') {
      const tRef = db.doc(`tenants/${tenantId}`);
      // Once, however many taps: claimed first, so two taps never make two assistants.
      const claim: any = await db.runTransaction(async (tx: any) => {
        const t0: any = (await tx.get(tRef)).data() || {};
        if (agentOf(t0)) return { done: true, on: t0.driveThru?.voice !== false };
        if (t0.driveThru?.voiceSettingUpAt && Date.now() - Date.parse(t0.driveThru.voiceSettingUpAt) < 60000) return { busy: true };
        tx.set(tRef, { driveThru: { voiceSettingUpAt: new Date().toISOString() } }, { merge: true });
        return { t: t0 };
      });
      if (claim.done) return ok({ setUp: true, on: claim.on });
      if (claim.busy) return bad('It’s being set up right now. Give it a moment.', 409);
      const t: any = claim.t;
      const origin = String(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl?.origin || '').replace(/\/+$/, '');
      const r = await setUpDriveThruAssistant(String(t.name || t.businessName || '').slice(0, 80), origin);
      if (!r.ok) { await tRef.set({ driveThru: { voiceSettingUpAt: null } }, { merge: true }); return bad(r.error, 502); }
      // (Spanish: the business's choice, on to start; and whether the voice service hears it, which a voice that speaks
      // only English can't.)
      await tRef.set({ driveThru: { voiceAgentId: r.agentId, voiceLlmId: r.llmId, voiceVersion: VOICE_VERSION, voice: true, spanishHeard: r.spanish, voiceSettingUpAt: null, voiceSetUpAt: new Date().toISOString(), voiceSetUpBy: words(g.actor?.name, 60) || null } }, { merge: true });
      return ok({ setUp: true, on: true, spanish: (t.driveThru?.spanish !== false), spanishHeard: r.spanish });
    }

    if (action === 'voice') {
      const patch: Record<string, boolean | string> = {};
      if (typeof b.on === 'boolean') patch.voice = b.on;
      if (typeof b.askName === 'boolean') patch.askName = b.askName;
      // How often it offers what each item offers (lib/voice-offer): with each item, once per order, or never.
      if (b.offers !== undefined) { if (!['item', 'order', 'off'].includes(String(b.offers))) return bad('With each item, once per order, or not at all?'); patch.offers = String(b.offers); }
      // Spanish at the speaker: the business's own assistant, up to date, set to hear English and Spanish or English
      // alone. Kept only once the voice service has taken it (refused, nothing changes).
      if (typeof b.spanish === 'boolean') {
        const t0: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
        const agentId = String(t0.driveThru?.voiceAgentId || '');
        if (!agentId || !t0.driveThru?.voiceLlmId) return bad('There’s no assistant of this business’s own to change.', 409);
        if (Math.floor(Number(t0.driveThru?.voiceVersion) || 1) < VOICE_VERSION) return bad('Update the assistant first.', 409);
        const r = await setAssistantLanguages(agentId, b.spanish);
        if (!r.ok) return bad(r.error, 502);
        patch.spanish = b.spanish; patch.spanishHeard = b.spanish;
      }
      if (!Object.keys(patch).length) return bad('On or off?');
      await db.doc(`tenants/${tenantId}`).set({ driveThru: patch }, { merge: true });
      const td: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      return ok({ on: td.driveThru?.voice !== false, askName: td.driveThru?.askName !== false, offers: voiceOfferMode(td), spanish: td.driveThru?.spanish !== false, spanishHeard: td.driveThru?.spanishHeard !== false });
    }

    if (action === 'voiceUpdate') {
      const tRef = db.doc(`tenants/${tenantId}`);
      const t: any = (await tRef.get()).data() || {};
      const llmId = String(t.driveThru?.voiceLlmId || '');
      if (!llmId) return bad('There’s no assistant of this business’s own to update.', 409);
      if (Math.floor(Number(t.driveThru?.voiceVersion) || 1) >= VOICE_VERSION) return ok({ updated: true });
      const origin = String(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl?.origin || '').replace(/\/+$/, '');
      const r = await updateDriveThruAssistant(llmId, String(t.name || t.businessName || '').slice(0, 80), origin);
      if (!r.ok) return bad(r.error, 502);
      // (Then the languages it hears: Spanish too unless the business turned it off. Refused, it hears English alone and
      // says so; the business's choice stays as it was, and the rest of the update is in.)
      const agentId = String(t.driveThru?.voiceAgentId || ''); const wantSpanish = t.driveThru?.spanish !== false;
      const lang = agentId ? await setAssistantLanguages(agentId, wantSpanish) : { ok: false as const, error: '' };
      const heard = lang.ok ? wantSpanish : false;
      await tRef.set({ driveThru: { voiceVersion: VOICE_VERSION, spanishHeard: heard, voiceUpdatedAt: new Date().toISOString(), voiceUpdatedBy: words(g.actor?.name, 60) || null } }, { merge: true });
      return ok({ updated: true, spanish: wantSpanish, spanishHeard: heard, ...(wantSpanish && !lang.ok && lang.error ? { note: lang.error } : {}) });
    }

    // Ordering ahead (lib/counter-ahead): on or off, how guests can pick up, and how far ahead they can order.
    // Delivery app orders (lib/app-orders): on, which apps (and another by name), and the spots on the pickup shelf.
    if (action === 'apps') {
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      const patch: any = {};
      if (typeof b.on === 'boolean') patch.on = b.on;
      if (b.apps !== undefined) { if (!Array.isArray(b.apps) || b.apps.some((x: any) => !APP_CODES.includes(String(x)))) return bad('Pick the apps from the list.'); patch.apps = Array.from(new Set(b.apps.map(String))); }
      if (b.otherName !== undefined) patch.otherName = cleanAppName(b.otherName) || null;
      if (b.shelves !== undefined) { const n = Number(b.shelves); if (!(SHELF_CHOICES as readonly number[]).includes(n)) return bad('Pick how many spots the shelf has.'); patch.shelves = n; }
      // One app's money: its price difference (one of the choices), its share (a percent, or empty for not set), and
      // whether it collects and pays the sales tax. New orders use it from when they're sent.
      if (b.money !== undefined) {
        const code = String(b.money?.app || ''); if (!APP_CODES.includes(code)) return bad('Which app?');
        const cur = appMoneyFrom(t.appOrders?.money?.[code]); const m: any = { ...cur };
        if (b.money.markupPct !== undefined) { const n = Number(b.money.markupPct); if (!(MARKUP_CHOICES as readonly number[]).includes(n)) return bad('Pick how much higher your prices are on the app.'); m.markupPct = n; }
        if (b.money.feePct !== undefined) {
          if (b.money.feePct === null || b.money.feePct === '') m.feePct = null;
          else { const f = Number(b.money.feePct); if (!Number.isFinite(f) || f < 0 || f > FEE_MAX) return bad(`What the app keeps is a percent from 0 to ${FEE_MAX}.`); m.feePct = Math.round(f * 10) / 10; }
        }
        if (typeof b.money.appPaysTax === 'boolean') m.appPaysTax = b.money.appPaysTax;
        patch.money = { ...(t.appOrders?.money || {}), [code]: m };
      }
      const next = { ...(t.appOrders || {}), ...patch };
      if ((next.apps || []).includes('other') && !cleanAppName(next.otherName)) return bad('Type the other app’s name.');
      if (next.on === true && !appOrdersOf({ appOrders: { ...next, on: true } }).apps.length) return bad('Pick at least one app first.');
      await db.doc(`tenants/${tenantId}`).set({ appOrders: { ...patch, updatedAt: new Date().toISOString(), updatedBy: words(g.actor?.name, 60) || null } }, { merge: true });
      return ok({ apps: appSettings({ ...t, appOrders: next }) });
    }

    if (action === 'ahead') {
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      const cur = t.orderAhead || {};
      const patch: any = {};
      if (typeof b.on === 'boolean') patch.on = b.on;
      if (typeof b.driveThru === 'boolean') patch.driveThru = b.driveThru;
      if (typeof b.inside === 'boolean') patch.inside = b.inside;
      if (typeof b.curbside === 'boolean') patch.curbside = b.curbside;
      if (typeof b.delivery === 'boolean') patch.delivery = b.delivery;
      if (b.deliveryMaxMin !== undefined) { const m = Number(b.deliveryMaxMin); if (!(DRIVE_MAX_CHOICES as readonly number[]).includes(m)) return bad('Pick how far hot food goes.'); patch.deliveryMaxMin = m; }
      // Sales tax on the hot food delivery fee (lib/food-delivery): some states tax delivery charges.
      if (typeof b.deliveryFeeTaxed === 'boolean') patch.deliveryFeeTaxed = b.deliveryFeeTaxed;
      if (patch.delivery === true && !deliveryReady(t)) return bad('Set up delivery first: where you deliver and what it costs, under Orders, Delivery.', 409);
      if (b.laterHours !== undefined) { const h = Math.floor(Number(b.laterHours)); if (!(h >= 0 && h <= 12)) return bad('Up to 12 hours ahead.'); patch.laterHours = h; }
      // Most items one pickup time takes (lib/ahead-slots); null for no limit.
      if (b.slotItems !== undefined) { const n = cleanSlotItems(b.slotItems); if (n === undefined) return bad(`Items for one pickup time: ${SLOT_ITEMS_MIN} to ${SLOT_ITEMS_MAX}, or no limit.`); patch.slotItems = n; }
      // Orders for another day (lib/ahead-days): on or off, how far ahead, the notice, the smallest order (dollars, empty for any).
      if (b.anotherDay && typeof b.anotherDay === 'object') {
        const x = b.anotherDay; const ad: any = {};
        if (typeof x.on === 'boolean') ad.on = x.on;
        if (x.daysAhead !== undefined) { if (!(DAYS_AHEAD as readonly number[]).includes(Number(x.daysAhead))) return bad('Pick how far ahead.'); ad.daysAhead = Number(x.daysAhead); }
        if (x.noticeHours !== undefined) { if (!(NOTICE_HOURS as readonly number[]).includes(Number(x.noticeHours))) return bad('Pick the notice you need.'); ad.noticeHours = Number(x.noticeHours); }
        if (x.minOrder !== undefined) { const c = cleanMinOrder(x.minOrder); if (c === undefined) return bad(`The smallest order: $0 to $${MIN_ORDER_MAX.toLocaleString('en-US')}, or leave it empty.`); ad.minCents = c; }
        if (Object.keys(ad).length) patch.anotherDay = ad;
      }
      const next = { ...cur, ...patch, ...(patch.anotherDay ? { anotherDay: { ...(cur.anotherDay || {}), ...patch.anotherDay } } : {}) };
      if (next.driveThru === false && next.inside === false && next.curbside !== true && next.delivery !== true) return bad('Keep at least one way to pick up.');
      if (patch.on === true && !accountOf(t)) return bad('Connect payments first: orders placed ahead are paid when they’re placed.', 409);
      await db.doc(`tenants/${tenantId}`).set({ orderAhead: { ...patch, updatedAt: new Date().toISOString(), updatedBy: words(g.actor?.name, 60) || null } }, { merge: true });
      return ok({ ahead: await withPlaces(db, tenantId, aheadSettings({ ...t, orderAhead: next }, tenantId, req.nextUrl?.origin || null), t) });
    }
    if (action === 'places') {
      // Each location's settings without the whole menu (Shop settings, Your stores): a manager's.
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      const a: any = await withPlaces(db, tenantId, aheadSettings(t, tenantId, req.nextUrl?.origin || null), t);
      // For Your stores (`shop`): a store whose opening hours leave none of the shop's pickup times says so, before a
      // customer finds out (lib/shop-stores-server storeWeekOf; lib/pickup-slots-server).
      if (b.shop === true && Array.isArray(a.places)) {
        const { shopPickup } = await import('@/lib/pickup-slots-server'); const { storeWeekOf } = await import('@/lib/shop-stores-server');
        const now = Date.now(); const base = (await shopPickup(db, tenantId, t, now)).view;
        if (base.scheduled && base.windows.length) {
          const locs = await bizLocationsOf(db, tenantId);
          for (const p of a.places) {
            const l = locs.find((x) => x.id === p.id); if (!l || !l.ordering.shop) continue;
            p.pickupNone = (await shopPickup(db, tenantId, zonedFor(t, l), now, '', { id: l.id, week: await storeWeekOf(db, tenantId, l) })).view.windows.length === 0;
          }
        }
      }
      return ok({ places: a.places || [], houseZone: a.houseZone || null, storesLink: `${String(a.link).replace(/\/order\/([^/?#]+).*$/, '/shop/$1')}/stores` });
    }
    if (action === 'aheadPlace') {
      // One location's ordering ahead (lib/ahead-places): on or off there, delivering from there or not, a store on the
      // online shop or not (lib/shop-stores-server), and its own hours (null: the business's). A manager's, kept on the
      // location itself.
      const id = String(b.id || ''); const loc = (await bizLocationsOf(db, tenantId)).find((l) => l.id === id);
      if (!loc) return bad('Pick one of your locations.', 404);
      const patch: any = {};
      if (typeof b.ahead === 'boolean') patch.aheadOff = !b.ahead;
      if (typeof b.delivery === 'boolean') patch.deliveryOff = !b.delivery;
      if (typeof b.shop === 'boolean') patch.shopOff = !b.shop;
      // Its time zone, answered (lib/here-server zoneToAsk): the one it has, or the business's.
      const zoneFix: any = b.zone === 'own' ? { timezoneSure: true } : b.zone === 'house' ? { timezone: tenantTimeZone(((await db.doc(`tenants/${tenantId}`).get()).data() || {})), timezoneSure: true } : null;
      if (b.hours !== undefined) { if (b.hours === null) patch.hours = null; else { const w = cleanWeek(b.hours); if (!w) return bad('Check the hours: each day open or closed, with its opening and closing times.'); patch.hours = w; } }
      if (!Object.keys(patch).length && !zoneFix) return bad('Nothing to change.');
      // (Each field replaced whole, in one write: its hours as a whole, so a day left out is closed, never kept from before.)
      const fields: any = { updatedAt: new Date().toISOString(), ...(zoneFix || {}) }; for (const [k, v] of Object.entries(patch)) fields[`ordering.${k}`] = v;
      await db.doc(`tenants/${tenantId}/locations/${id}`).update(fields);
      forgetLocations(tenantId);
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      return ok({ ahead: await withPlaces(db, tenantId, aheadSettings(t, tenantId, req.nextUrl?.origin || null), t) });
    }

    // Menus by time of day and happy hour (lib/menu-time): the windows; each item says which it's in, and its price then.
    if (action === 'create') {
      // A new item, on the menu and in Inventory in one step (design canvas "One item, two stations"): its name, section,
      // price, the station that makes it and, if it's counted, how many there are. Its photo, choices, recipe and the rest
      // are added in its editor, which opens next. The same tap sent twice makes one item.
      const name = words(b.name, 80); if (!name) return bad('Give it a name.');
      if (b.price === null || b.price === undefined || String(b.price).trim() === '') return bad('Enter a price ($0 is fine).');
      const price = Math.round(Number(b.price) * 100) / 100; if (!Number.isFinite(price) || price < 0 || price > 10000) return bad('Enter a price of $0 or more.');
      const onHand = b.onHand === null || b.onHand === undefined || String(b.onHand).trim() === '' ? null : Math.floor(Number(b.onHand));
      if (onHand !== null && (!Number.isFinite(onHand) || onHand < 0 || onHand > 100000)) return bad('How many you have: a number, or leave it empty.');
      const td: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const want = words(b.station, 24); const station = want ? stationsOf(td).find((y) => y.toLowerCase() === want.toLowerCase()) || null : null;
      if (want && !station) return bad('Pick one of your stations.');
      const snap = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400).get();
      const same = snap.docs.find((d: any) => { const x: any = d.data() || {}; return x.archived !== true && x.status !== 'archived' && words(x.name, 80).toLowerCase() === name.toLowerCase(); });
      const tap = typeof b.tapKey === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(b.tapKey) ? b.tapKey : null;
      if (same && !(tap && same.id === `menu_${tap}`)) return bad(`${name} is on the menu already. Find it in the list and open it.`);
      const ref = tap ? db.doc(`tenants/${tenantId}/inventory/menu_${tap}`) : db.collection(`tenants/${tenantId}/inventory`).doc();
      const nowIso = new Date().toISOString(); const by = words(g.actor?.name, 60) || 'A manager';
      // The name, claimed in the same step, so two managers adding the same item at once make one.
      const claimRef = db.doc(`tenants/${tenantId}/private/menuName_${createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 40)}`);
      const made: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(ref)).data(); if (cur) return { item: cur, already: true };
        const claim: any = (await tx.get(claimRef)).data();
        const held: any = claim?.id && claim.id !== ref.id && ID.test(String(claim.id)) ? (await tx.get(db.doc(`tenants/${tenantId}/inventory/${claim.id}`))).data() : null;
        if (held && held.archived !== true && held.status !== 'archived' && words(held.name, 80).toLowerCase() === name.toLowerCase()) return { dupe: true };
        tx.set(claimRef, { id: ref.id, name, at: nowIso });
        const item = { id: ref.id, name, type: 'refreshment', category: words(b.section, 40) || 'Menu', description: '', status: 'active', isActive: true, totalStock: onHand ?? 0, supplier: '', batches: [],
          price, msrp: price, showInConcierge: true, choices: [], formula: [], station, course: null, createdVia: 'menu', createdAt: nowIso, updatedAt: nowIso, menuUpdatedAt: nowIso, menuUpdatedBy: by };
        tx.set(ref, item);
        // What's on hand to start with, in the stock ledger like any count.
        if (onHand) tx.set(db.collection(`tenants/${tenantId}/stockCorrections`).doc(), buildEntry({ productId: ref.id, type: 'counted', delta: onHand, unit: 'units', reason: 'Added on the Menu page', actorId: String(g.actor?.uid || 'manager'), actorName: by, balanceAfter: onHand }));
        return { item };
      });
      if (made.dupe) return bad(`${name} is on the menu already. Find it in the list and open it.`);
      return ok({ item: menuItemOf(ref.id, made.item), already: !!made.already });
    }

    if (action === 'times') {
      const dayparts = cleanDayparts(b.dayparts); const happyHour = cleanHappyHour(b.happyHour);
      if (Array.isArray(b.dayparts) && b.dayparts.length !== dayparts.length) return bad('Each menu by time of day needs a name, and a start and end that differ.');
      await db.doc(`tenants/${tenantId}`).set({ menuSettings: { dayparts, happyHour } }, { merge: true });
      return ok({ dayparts, happyHour });
    }
    if (action === 'laneSettings') {
      const td: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      // Pickup only (orders placed ahead, nobody orders at the speaker), or orders and pickup: said on its own.
      // A text when it's ready, for guests who ask (lib/ready-text): on, or off for the whole business.
      if (typeof b.readyTexts === 'boolean') {
        await db.doc(`tenants/${tenantId}`).set({ readyTexts: { off: !b.readyTexts } }, { merge: true });
        return ok({ lane: { readyTexts: b.readyTexts } });
      }
      // Scanning each bag's label before a food order is handed over (lib/food-bags): on, or off for the whole business.
      if (typeof b.bagCheck === 'boolean') {
        await db.doc(`tenants/${tenantId}`).set({ bagCheck: { off: !b.bagCheck } }, { merge: true });
        return ok({ lane: { bagCheck: b.bagCheck } });
      }
      // What's ticked into a to-go bag before it's handed over (lib/bag-extras): the choices whose picks go in on their
      // own (by name), and the business's own extras (by id: only ones it has, and never one for a table's guests).
      if (b.bagGroups !== undefined || b.bagExtras !== undefined) {
        const groups = b.bagGroups !== undefined ? cleanBagGroups(b.bagGroups) : undefined;
        if (groups === null) return bad('Which choices go in the bag?');
        let extras: string[] | undefined;
        if (b.bagExtras !== undefined) {
          if (!Array.isArray(b.bagExtras)) return bad('Which extras go in the bag?');
          const have = new Set(extrasOf(td).filter((e) => e.per !== 'guest' && e.when !== 'here').map((e) => e.id));
          const asked = Array.from(new Set<string>(b.bagExtras.map(String))).slice(0, MAX_BAG_EXTRAS);
          if (asked.some((id) => !have.has(id))) return bad('One of those extras isn’t set anymore. Reload the page and pick again.', 409);
          extras = asked;
        }
        await db.doc(`tenants/${tenantId}`).set({ bagCheck: { ...(groups !== undefined ? { groups } : {}), ...(extras !== undefined ? { extras } : {}) } }, { merge: true });
        const after = bagExtrasSetOf({ ...td, bagCheck: { ...(td.bagCheck || {}), ...(groups !== undefined ? { groups } : {}), ...(extras !== undefined ? { extras } : {}) } });
        return ok({ lane: { bagExtras: after } });
      }
      // How the register's tiles are arranged (lib/register-tiles; components/menu/TilesCard): the look, the order, pinned
      // and hidden, among the menu's own items. Read and written in one go, so two managers' saves never lose the other's.
      // (Only an item not in it yet is looked up, to be sure it's one of the business's: a drag reads nothing more.)
      if (b.tiles && typeof b.tiles === 'object') {
        const { cleanTileSetup, tileSetupOf } = await import('@/lib/register-tiles');
        const was = tileSetupOf(td); const known = new Set<string>([...was.order, ...was.pinned, ...was.hidden]);
        const asked = Array.from(new Set((['order', 'pinned', 'hidden'] as const).flatMap((k) => (Array.isArray(b.tiles[k]) ? b.tiles[k].map(String) : [])).filter((x: string) => /^[A-Za-z0-9_-]{1,128}$/.test(x) && !known.has(x)))).slice(0, 1000);
        const found = asked.length ? (await db.getAll(...asked.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)))).filter((s: any) => s.exists).map((s: any) => String(s.id)) : [];
        const ids = new Set<string>([...known, ...found]);
        const r: any = await db.runTransaction(async (tx: any) => {
          const now: any = (await tx.get(db.doc(`tenants/${tenantId}`))).data() || {};
          const next = cleanTileSetup(b.tiles, ids, tileSetupOf(now)); if ('error' in next) return next;
          tx.set(db.doc(`tenants/${tenantId}`), { registerTiles: { ...next, updatedAt: new Date().toISOString() } }, { merge: true });
          return next;
        });
        if ('error' in r) return bad(r.error);
        return ok({ lane: { tiles: r } });
      }
      // Tips at the counter (lib/counter-money): on or off, the three percents, and the drive-thru too.
      if (b.tips && typeof b.tips === 'object') {
        const pcts = Array.isArray(b.tips.pcts) ? b.tips.pcts.map((x: unknown) => Math.round(Number(x))) : null;
        if (pcts && (pcts.length !== 3 || pcts.some((x: number) => !(x >= 1 && x <= 50)))) return bad('Three percents, each from 1 to 50.');
        const tips = tipsOf({ counterTips: { on: b.tips.on === true, pcts: pcts || tipsOf(td).pcts, where: b.tips.where === 'both' ? 'both' : 'counter' } });
        await db.doc(`tenants/${tenantId}`).set({ counterTips: { ...tips, updatedAt: new Date().toISOString() } }, { merge: true });
        return ok({ lane: { tips } });
      }
      // Scale labels (lib/scale-label): on or off, what the sticker holds, how many digits its barcode has, the scale's unit.
      if (b.scaleLabels && typeof b.scaleLabels === 'object') {
        const x = b.scaleLabels;
        if (x.holds !== undefined && !(SCALE_HOLDS as string[]).includes(String(x.holds))) return bad('The weight, or the price: which does the sticker hold?');
        if (x.digits !== undefined && ![12, 13].includes(Number(x.digits))) return bad('12 digits or 13: how many does the sticker’s barcode have?');
        if (x.unit !== undefined && !(WEIGHT_UNITS as string[]).includes(String(x.unit))) return bad('Pick lb, oz, kg or g.');
        const now = scaleSetOf(td);
        const next = scaleSetOf({ scaleLabels: { ...now, ...(typeof x.on === 'boolean' ? { on: x.on } : {}), ...(x.holds !== undefined ? { holds: x.holds } : {}), ...(x.digits !== undefined ? { digits: Number(x.digits) } : {}), ...(x.unit !== undefined ? { unit: x.unit } : {}) } });
        await db.doc(`tenants/${tenantId}`).set({ scaleLabels: { ...next, updatedAt: new Date().toISOString() } }, { merge: true });
        return ok({ lane: { scaleLabels: next } });
      }
      // Something not on the menu at the counter (lib/counter-oneoff): up to how much (0 turns it off), or a name taken off
      // the list of what's been rung in (once it's on the menu, say).
      if (b.oneOffMax !== undefined) {
        const n = b.oneOffMax === null || b.oneOffMax === '' ? NaN : Math.round(Number(b.oneOffMax) * 100) / 100;
        if (!Number.isFinite(n) || n < 0 || n > ONE_OFF_MAX_CAP) return bad(`Up to how much? $0 to $${ONE_OFF_MAX_CAP}, or $0 to turn it off.`);
        await db.doc(`tenants/${tenantId}`).set({ counterOneOff: { max: n, updatedAt: new Date().toISOString() } }, { merge: true });
        return ok({ lane: { oneOffMax: n } });
      }
      if (typeof b.oneOffForget === 'string') {
        if (!/^n-[a-z0-9-]{1,60}$/.test(b.oneOffForget)) return bad('Which one?');
        await db.doc(`tenants/${tenantId}/oneOffNames/${b.oneOffForget}`).delete();
        return ok({ lane: { oneOffNames: await oneOffNamesOf(db, tenantId) } });
      }
      // The business's discounts at the counter (lib/counter-money): the whole list, as kept.
      if (Array.isArray(b.discounts)) {
        if (b.discounts.length > DISCOUNTS_MAX) return bad(`${DISCOUNTS_MAX} discounts at most.`);
        const list = b.discounts.map(cleanDiscount);
        if (list.some((x: unknown) => !x)) return bad('Each discount needs a name, and a percent from 1 to 100 or an amount off up to $500.');
        const ids = new Set<string>(); const kept = (list as any[]).map((x) => { let id = x.id; for (let n = 2; ids.has(id); n++) id = `${x.id}-${n}`; ids.add(id); return { ...x, id }; });
        await db.doc(`tenants/${tenantId}`).set({ counterDiscounts: kept }, { merge: true });
        return ok({ lane: { discounts: discountsOf({ counterDiscounts: kept }) } });
      }
      // The lane entry sensor (lib/lane-entry-server): a new link for a lane (shown once; the old one stops), turned off,
      // or how each is doing (when it last counted a car).
      if (b.sensor === 'new' || b.sensor === 'stop' || b.sensor === 'check') {
        // (Where along the lane: the entry, the speaker, the pickup window or the exit; past the speaker, one for both lanes.)
        const point = pointOf(b.point);
        const two = lanesOf(td) === 2; const lane = b.lane === 2 && two && (point === 'entry' || point === 'speaker') ? 2 : 1;
        // (With more than one location, each location's own lanes: `at`. None: one set up before there were locations.)
        const places = await sensorPlaces(db, tenantId); const at = places.find((p) => p.id === String(b.at || ''))?.id || null;
        if (b.sensor === 'new') {
          const key = await newSensor(db, tenantId, lane, words(g.actor?.name, 60) || 'A manager', at, point);
          const origin = String(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl?.origin || '').replace(/\/+$/, '');
          return ok({ lane: { sensors: await sensorsView(db, tenantId, td, places), points: await pointsView(db, tenantId, two, places) }, sensorLink: { lane, at, point, link: `${origin}/api/counter/lane-entry?t=${encodeURIComponent(tenantId)}&k=${key}` } });
        }
        if (b.sensor === 'stop') await stopSensor(db, tenantId, lane, at, point);
        return ok({ lane: { sensors: await sensorsView(db, tenantId, td, places), points: await pointsView(db, tenantId, two, places) } });
      }
      // When the kitchen sees what's being ordered at the speaker before it's sent (lib/lane-entry).
      if (b.kitchenEarly === 'rush' || b.kitchenEarly === 'always' || b.kitchenEarly === 'off') {
        await db.doc(`tenants/${tenantId}`).set({ driveThru: { kitchenEarly: b.kitchenEarly } }, { merge: true });
        return ok({ lane: { kitchenEarly: b.kitchenEarly } });
      }
      // Ordering lanes: one, or two that merge (lib/drive-lanes): each speaker tablet and order board is set to its lane.
      if (b.lanes === 1 || b.lanes === 2) {
        await db.doc(`tenants/${tenantId}`).set({ driveThru: { lanes: b.lanes } }, { merge: true });
        return ok({ lane: { lanes: b.lanes } });
      }
      if (typeof b.pickupOnly === 'boolean') {
        await db.doc(`tenants/${tenantId}`).set({ driveThru: { pickupOnly: b.pickupOnly } }, { merge: true });
        return ok({ lane: { spots: spotsOf(td), pickupOnly: b.pickupOnly, aheadThere: aheadAtDriveThru(td) } });
      }
      const n = typeof b.spots === 'number' ? Math.floor(b.spots) : NaN;
      if (!(n >= 1 && n <= 8)) return bad('Between 1 and 8 spots.');
      await db.doc(`tenants/${tenantId}`).set({ driveThru: { spots: n } }, { merge: true });
      return ok({ lane: { spots: n, pickupOnly: td.driveThru?.pickupOnly === true, aheadThere: aheadAtDriveThru(td) } });
    }

    if (action === 'targets') {
      const given = b.targets && typeof b.targets === 'object' ? b.targets : {};
      const next: Record<string, number> = {};
      for (const c of CHANNELS) {
        if (given[c] === undefined) continue;
        const n = Math.floor(Number(given[c]));
        if (!Number.isFinite(n) || n < 60 || n > 3600) return bad('A time between 1 and 60 minutes.');
        next[c] = n;
      }
      if (!Object.keys(next).length) return bad('Which time?');
      await db.doc(`tenants/${tenantId}`).set({ kitchenSettings: { targets: next } }, { merge: true });
      return ok({ targets: targetsOf((await db.doc(`tenants/${tenantId}`).get()).data() || {}) });
    }

    if (action === 'service') {
      const tRef = db.doc(`tenants/${tenantId}`); const td: any = ((await tRef.get()).data() as any) || {};
      const next: Record<string, any> = {};
      if (b.courses !== undefined) {
        if (!Array.isArray(b.courses) || b.courses.length < 1 || b.courses.length > MAX_COURSES) return bad(`Between 1 and ${MAX_COURSES} courses.`);
        const list = b.courses.map((c: any) => ({ name: words(c?.name, 24), hold: c?.hold === true }));
        if (list.some((c: any) => !c.name)) return bad('Each course needs a name.');
        if (new Set(list.map((c: any) => c.name.toLowerCase())).size !== list.length) return bad('Two courses have the same name.');
        next.courses = list;
      }
      if (b.stations !== undefined) {
        if (!Array.isArray(b.stations) || b.stations.length < 1 || b.stations.length > MAX_STATIONS) return bad(`Between 1 and ${MAX_STATIONS} stations.`);
        const list = b.stations.map((x: any) => words(x, 24));
        if (list.some((x: string) => !x)) return bad('Each station needs a name.');
        if (new Set(list.map((x: string) => x.toLowerCase())).size !== list.length) return bad('Two stations have the same name.');
        next.stations = list;
      }
      if (b.compAllowanceCents !== undefined) { const n = Math.round(Number(b.compAllowanceCents)); if (!Number.isFinite(n) || n < 0 || n > MAX_COMP_ALLOWANCE_CENTS) return bad('Pick an allowance up to $500.'); next.compAllowanceCents = n; }
      if (b.compReasons !== undefined) {
        if (!Array.isArray(b.compReasons) || b.compReasons.length > 8) return bad('Up to 8 reasons.');
        next.compReasons = Array.from(new Set(b.compReasons.map((r: any) => words(r, 40)).filter(Boolean)));
      }
      if (b.askAllergies !== undefined) { if (typeof b.askAllergies !== 'boolean') return bad('Ask about allergies: on or off.'); next.askAllergies = b.askAllergies; }
      if (b.finishTogether !== undefined) { if (typeof b.finishTogether !== 'boolean') return bad('Finish together: on or off.'); next.finishTogether = b.finishTogether; }
      if (b.pace !== undefined) { const p = cleanPace(b.pace); if (!p) return bad('Kitchen pace: on or off, and busy at 2 to 30 minutes behind.'); next.pace = p; }
      if (b.recovery !== undefined) { const r = cleanRecovery(b.recovery); if (!r) return bad('When something goes wrong: on or off, and the host told after 0 to 60 minutes.'); next.recovery = r; }
      if (b.tablePay !== undefined) {
        if (!b.tablePay || typeof b.tablePay !== 'object') return bad('Check the pay at the table settings.');
        const tp = cleanTablePay({ ...tablePayOf(td), ...b.tablePay });
        if (tp.on && !tp.ways.length) return bad('Pick at least one way to split.');
        next.tablePay = tp;
      }
      if (b.nudges !== undefined) {
        if (!b.nudges || typeof b.nudges !== 'object') return bad('Check the nudge timings.');
        const n: Record<string, number> = { ...nudgeSettingsOf(td) };
        for (const k of NUDGE_KEYS) if (b.nudges[k] !== undefined) { const v = Math.round(Number(b.nudges[k])); if (!Number.isFinite(v) || v < 0 || v > 60) return bad('Each nudge: up to 60 minutes, or off.'); n[k] = v; }
        next.nudges = n;
      }
      if (!Object.keys(next).length) return bad('Nothing to change.');
      await tRef.set({ kitchenSettings: next }, { merge: true });
      if (next.pace) forgetPace(`tenants/${tenantId}`);
      return ok({ service: serviceOf({ ...td, kitchenSettings: { ...(td.kitchenSettings || {}), ...next } }) });
    }

    if (action === 'ingredients') {
      // What a recipe can use: anything the business stocks but equipment, and never a menu item that's made from its own
      // recipe (one level of recipe only).
      const snap = await db.collection(`tenants/${tenantId}/inventory`).limit(1500).get();
      const all = new Map<string, any>(snap.docs.map((d: any) => [d.id, d.data() || {}]));
      const list = Array.from(all.entries())
        .filter(([id, x]: any) => ID.test(id) && canBeIngredient(x, id))
        .map(([id, x]: any) => { const left = ingredientLeft(x); const u = partUnitCost(x, all);
          // What the recipe editor works a cost out from, here on the screen, by the same rules as the server (lib/food-cost):
          // what one costs, how it's counted, what's usable, what one gives, and a prep recipe's own recipe.
          return { id, name: words(x.name, 80) || 'Item', unit: ingredientUnit(x), left: left === null ? null : Math.round(left * 100) / 100, menu: x.type === 'refreshment',
            prep: isPrep(x, id), measures: measuresFor(x), usable: hasYield(x) ? Math.round(yieldOf(x) * 1000) / 1000 : null, perEach: perEachOf(x), unitCost: u,
            part: { name: words(x.name, 80), type: x.type || null, costPerUnit: Number(x.costPerUnit) || 0, costingMethod: x.costingMethod || null, size: x.size ?? null, unit: x.unit ?? null, estimatedUses: x.estimatedUses ?? null, useUnit: x.useUnit ?? null,
              usablePct: x.usablePct ?? null, cookLossPct: x.cookLossPct ?? null, perEach: x.perEach ?? null, typicalCost: x.typicalCost === true, ...(prepOf(x) ? { prep: x.prep, formula: recipeOf(x, id) } : {}) } }; })
        .sort((a: any, c: any) => a.name.localeCompare(c.name));
      return ok({ ingredients: list });
    }

    if (action === 'prep') {
      const r = await savePrep(db, `tenants/${tenantId}`, { id: String(g.actor?.uid || 'manager'), name: words(g.actor?.name, 60) || 'A manager' }, b);
      if ('error' in r) return bad(r.error, r.status);
      const parts = await readPartsDeep(db, `tenants/${tenantId}`, recipeOf(r.item, r.id).map((l) => l.id));
      return ok({ prep: prepRow(r.id, r.item, parts) });
    }

    if (action === 'prepRemove') {
      const r = await removePrep(db, `tenants/${tenantId}`, String(b.prepId || ''), words(g.actor?.name, 60) || 'A manager');
      return 'error' in r ? bad(r.error, r.status) : ok({});
    }

    // CHOICE SETS (lib/choice-sets): made once, on every item that has them. Managers; sold out on one, anyone on the team.
    if (action === 'setSoldOut' || SET_ACTIONS.includes(action)) {
      const CS = await import('@/lib/choice-sets-server'); const by = words(g.actor?.name, 60) || 'A manager';
      try {
        if (action === 'sets') return ok(await CS.listSets(db, tenantId));
        if (action === 'setSave') { const r = await CS.saveSet(db, tenantId, b.set, by); return ok({ set: r.set, items: r.items }); }
        if (action === 'setApply') return ok(await CS.applySet(db, tenantId, String(b.setId || ''), b.itemIds, by));
        if (action === 'setOff') { await CS.setOff(db, tenantId, String(b.setId || ''), String(b.itemId || ''), b.keep === true); return ok({}); }
        if (action === 'setFrom') { const r = await CS.setFromGroup(db, tenantId, String(b.itemId || ''), String(b.groupId || ''), by); return ok({ set: r.set, items: r.items }); }
        if (action === 'setRemove') return ok({ items: await CS.removeSet(db, tenantId, String(b.setId || '')) });
        if (typeof b.out !== 'boolean') return bad('Sold out, or back?');
        return ok({ items: await CS.setOptionSoldOut(db, tenantId, String(b.setId || ''), String(b.optionId || ''), b.out, words(g.actor?.name, 60) || 'The team') });
      } catch (e: any) { if (e instanceof CS.SetStop) return bad(e.msg, e.status); throw e; }
    }

    if (action === 'soldout') {
      const r: any = await setSoldOut(db, tenantId, { itemId: b.itemId, groupId: b.groupId, optionId: b.optionId, out: b.out, where: b.where }, String(g.actor?.name || 'The team'), soldHere);
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
    let choices = cleanForSave(x.choices, () => randomBytes(6).toString('base64url'));
    // A choice with a name but no options, or options with no names, is dropped by cleanForSave: say so rather than lose it.
    const given = Array.isArray(x.choices) ? x.choices.filter((c: any) => words(c?.name, 40) || (Array.isArray(c?.options) && c.options.some((o: any) => words(o?.name, 40)))) : [];
    if (given.length !== choices.length) return bad('Each choice needs a name and at least one option with a name.');
    // A choice from a set is the set's, whatever the form sent (lib/choice-sets): its options and prices as the set has
    // them (each option keeping the id it has on this item, worked out in the save below); its recipe changes fitted to
    // this item's recipe below. A set that's gone leaves the choice as the item's own.
    const sets = new Map<string, ChoiceSet>();
    const setIds = Array.from(new Set(choices.map((c) => c.setId).filter(Boolean))) as string[];
    if (setIds.length) {
      const { readSet } = await import('@/lib/choice-sets-server');
      for (const cs of await Promise.all(setIds.map((id) => readSet(db, tenantId, id)))) if (cs) sets.set(cs.id, cs);
      choices = choices.map((c) => {
        if (!c.setId) return c; const cs = sets.get(c.setId);
        if (!cs) { const { setId: _gone, ...own } = c; return { ...own, options: own.options.map(({ setOption: _s, ...o }) => o) }; }
        return choiceGroups({ choices: [groupOfSet(cs, c.id, () => undefined)] }, true)[0];
      });
    }
    const lowest = price + choices.filter((cg) => cg.required && cg.pick === 'one').reduce((s, cg) => s + Math.min(...cg.options.map((o) => o.price)), 0);
    if (lowest < 0) return bad('A choice takes off more than the item costs. Check the prices.');
    // Kitchen timing, when given: how long it takes to make, and whether a batch is cooked ahead and held (and for how long).
    const timing: Record<string, number> = {};
    if (x.makeSeconds !== undefined && x.makeSeconds !== null) { const n = Math.floor(Number(x.makeSeconds)); if (!Number.isFinite(n) || n < 10 || n > 3600) return bad('How long it takes to make: between 10 seconds and an hour.'); timing.makeSeconds = n; }
    if (x.holdMinutes !== undefined && x.holdMinutes !== null) { const n = Math.floor(Number(x.holdMinutes)); if (!Number.isFinite(n) || n < 0 || n > 240) return bad('How long it can be held: up to 4 hours.'); timing.holdMinutes = n; }
    if (x.batchSize !== undefined && x.batchSize !== null) { const n = Math.floor(Number(x.batchSize)); if (!Number.isFinite(n) || n < 1 || n > 200) return bad('A batch is between 1 and 200.'); timing.batchSize = n; }
    // Table service, when given (lib/table-service): the station it's made at (one of the business's, or null to work it
    // out from its section) and its course (a course number, 0 for always right away, or null for its section's course).
    const service: Record<string, any> = {};
    if (x.station !== undefined || x.course !== undefined) {
      const td: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      if (x.station !== undefined) { const st = words(x.station, 24); if (st && !stationsOf(td).some((y) => y.toLowerCase() === st.toLowerCase())) return bad('Pick one of your stations.'); service.station = st || null; }
      if (x.course !== undefined) { if (x.course === null || x.course === '') service.course = null; else { const n = Math.floor(Number(x.course)); if (!(n === 0 || coursesOf(td).some((c) => c.n === n))) return bad('Pick one of your courses.'); service.course = n; } }
    }
    // Also made at another station, as a part of its own (lib/two-stations): one of the business's stations, not the one
    // it's made at, each with a few words for its part.
    if (x.alsoAt !== undefined) {
      const td: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const given = Array.isArray(x.alsoAt) ? x.alsoAt.filter((a: any) => words(a?.station, 24) || words(a?.part, 40)) : [];
      const own = service.station !== undefined ? service.station : words((await db.doc(`tenants/${tenantId}/inventory/${itemId}`).get()).data()?.station, 24) || null;
      const also = cleanAlsoAt(given, stationsOf(td), own);
      if (given.length > MAX_ALSO) return bad(`Up to ${MAX_ALSO} other stations.`);
      if (also.length !== given.length) return bad('Each other station is one of yours (not the one it’s made at), with a few words for what’s made there.');
      service.alsoAt = also;
    }
    // What it contains (lib/allergens), when given: only the allergens on the list, each once.
    const safety: Record<string, any> = {};
    if (x.allergens !== undefined) {
      if (!Array.isArray(x.allergens) || x.allergens.length > ALLERGENS.length) return bad('Pick what it contains from the list.');
      if (x.allergens.some((k: unknown) => !cleanKeys([k]).length)) return bad('Pick what it contains from the list.');
      safety.allergens = cleanKeys(x.allergens);
    }
    // How many it starts each night with (lib/dish-counts), or null to not count it.
    if (x.dailyCount !== undefined) {
      if (x.dailyCount === null || String(x.dailyCount).trim() === '') safety.dailyCount = null;
      else { const n = typeof x.dailyCount === 'number' ? x.dailyCount : /^\s*\d{1,3}\s*$/.test(String(x.dailyCount)) ? Number(String(x.dailyCount).trim()) : NaN;
        if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) return bad(`Made each night: a number up to ${MAX_COUNT}, or leave it empty.`); safety.dailyCount = n; }
    }
    // The menu board, when given: shown big up front, a New or Limited time tag, and its calories.
    const board: Record<string, any> = {};
    if (x.featured !== undefined) board.boardFeatured = x.featured === true;
    if (x.badge !== undefined) { if (![null, '', 'new', 'limited'].includes(x.badge)) return bad('Pick New, Limited time, or none.'); board.boardBadge = x.badge || null; }
    if (x.calories !== undefined) {
      if (x.calories === null || String(x.calories).trim() === '') board.calories = null;
      else { const n = typeof x.calories === 'number' ? Math.round(x.calories) : typeof x.calories === 'string' && /^\s*\d{1,4}\s*$/.test(x.calories) ? Number(x.calories.trim()) : NaN; if (!Number.isFinite(n) || n < 0 || n > 5000) return bad('Calories: a number up to 5000, or leave it empty.'); board.calories = n; }
    }
    // The photo, when given: shown on the drive-thru's buttons and its order board, and on the lounge menu.
    // Menus by time of day it's in, its happy-hour price, and as a combo, the parts it always has (lib/menu-time,
    // lib/counter-orders partsOfLine).
    const timed: Record<string, any> = {};
    if (x.dayparts !== undefined) {
      const td0: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const known = daypartsOf(td0).map((d) => d.id);
      const ids: string[] = Array.isArray(x.dayparts) ? Array.from(new Set<string>(x.dayparts.map(String))) : [];
      if (ids.some((id) => !known.includes(id))) return bad('Pick from your menus by time of day.');
      timed.dayparts = ids;
    }
    if (x.happyPrice !== undefined) {
      if (x.happyPrice === null || String(x.happyPrice).trim() === '') timed.happyPrice = null;
      else { const hp = Math.round(Number(x.happyPrice) * 100) / 100; if (!Number.isFinite(hp) || hp < 0 || hp >= price) return bad('The happy-hour price is less than its price (or leave it empty).'); timed.happyPrice = hp; }
    }
    if (x.combo !== undefined) {
      timed.combo = x.combo === true;
      const parts = Array.isArray(x.comboParts) ? x.comboParts.map((p: any) => String(p?.itemId || p || '')).filter((id: string) => ID.test(id) && id !== itemId).slice(0, 6) : [];
      timed.comboParts = timed.combo ? parts.map((id: string) => ({ itemId: id })) : [];
      if (timed.combo && !parts.length && !choices.some((cg) => cg.options.some((o) => o.itemId))) return bad('A combo needs what’s in it: the items it always has, or a choice of items.');
      // A combo's parts each go to their own station already: it isn't also made somewhere else.
      if (timed.combo && Array.isArray(service.alsoAt) && service.alsoAt.length) return bad('A combo’s parts each go to their own station already. Take Also made at off.');
      if (timed.combo) service.alsoAt = [];
    }
    // Sold by weight, when given (lib/menu-weight): the unit its price is per, or none. Never a combo.
    if (x.byWeight !== undefined) {
      if (x.byWeight !== null && !(WEIGHT_UNITS as string[]).includes(String(x.byWeight))) return bad('Pick lb, oz, kg or g.');
      if (x.byWeight !== null && timed.combo === true) return bad('A combo isn’t sold by weight.');
      // (Already part of a combo: weighed on its own, so it comes out of the combo first.)
      if (x.byWeight !== null) {
        const combos = (await db.collection(`tenants/${tenantId}/inventory`).where('combo', '==', true).limit(300).get()).docs.map((d: any) => d.data() || {});
        const inOne = combos.find((c: any) => c.archived !== true && ((Array.isArray(c.comboParts) && c.comboParts.some((p: any) => String(p?.itemId || '') === itemId)) || (Array.isArray(c.choices) && c.choices.some((g: any) => (g?.options || []).some((o: any) => String(o?.itemId || '') === itemId)))));
        if (inOne) return bad(`It’s part of ${String(inOne.name || 'a combo')}. Take it out of the combo first, then sell it by weight.`);
      }
      timed.byWeight = x.byWeight === null ? null : { unit: String(x.byWeight) };
    }
    // Its number on the scale (lib/scale-label), when given: up to five digits, or none.
    const scaleNo = x.scaleNo === undefined ? undefined : x.scaleNo === null || String(x.scaleNo).trim() === '' ? null : cleanScaleNo(x.scaleNo);
    if (scaleNo === null && x.scaleNo !== undefined && x.scaleNo !== null && String(x.scaleNo).trim() !== '') return bad('Its number on the scale: one to five digits, not all zeros.');
    if (choices.some((cg) => cg.options.some((o) => o.itemId === itemId))) return bad('A combo can’t have itself in it.');
    // Each part (always in it, or made as a choice) is one of the business's own menu items, and not a combo itself.
    const partIds = Array.from(new Set<string>([...(timed.comboParts || []).map((p: any) => String(p.itemId)), ...choices.flatMap((cg) => cg.options.map((o) => String(o.itemId || ''))).filter(Boolean)]));
    if (partIds.length) {
      const docs = await Promise.all(partIds.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`).get()));
      const bad1 = docs.findIndex((d: any) => { const x: any = d.data(); return !x || x.type !== 'refreshment' || x.archived === true || x.combo === true || !!byWeightOf(x); });
      if (bad1 >= 0) { const x: any = docs[bad1].data(); return bad(x?.combo === true ? `${String(x.name || 'That item')} is a combo itself. Pick the items it’s made of.` : byWeightOf(x) ? `${String(x.name || 'That item')} is sold by weight, so it’s weighed on its own, not part of a combo.` : 'One of its parts isn’t on the menu any more. Pick another.'); }
    }
    // Offered at the end, when given (lib/menu-upgrades): the next size up on or off, and up to two of the business's own
    // menu items to go with it (never itself).
    if (x.upgrades !== undefined) {
      const u: any = x.upgrades && typeof x.upgrades === 'object' && !Array.isArray(x.upgrades) ? x.upgrades : {};
      const asked = Array.from(new Set<string>((Array.isArray(u.items) ? u.items : []).map((v: unknown) => String(v ?? ''))));
      if (asked.length > MAX_UPGRADE_ITEMS) return bad(`Up to ${MAX_UPGRADE_ITEMS} things to go with it.`);
      if (asked.includes(itemId)) return bad('It can’t be offered with itself.');
      const up = upgradesOf(u, itemId);
      if (up.items.length !== asked.length) return bad('Pick what goes with it from your menu.');
      const docs = await Promise.all(up.items.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`).get()));
      if (docs.some((d: any) => !isMenuItem(d.data()))) return bad('Something offered with it isn’t on the menu any more. Pick another.');
      timed.upgrades = up;
    }
    const photo: Record<string, string | null> = {};
    if (x.imageUrl !== undefined) {
      if (x.imageUrl === null || String(x.imageUrl).trim() === '') photo.imageUrl = null;
      else {
        // Only a photo this business uploaded from the Menu page (its own product photos, in this app's storage): a
        // screen guests see never loads anything from anywhere else.
        const u = photoOf({ imageUrl: x.imageUrl });
        const own = !!u && ownBuckets().some((bk) => u.startsWith(`https://firebasestorage.googleapis.com/v0/b/${bk}/o/tenants%2F${tenantId}%2Fproducts%2F`));
        if (!own) return bad('That photo didn’t upload properly. Try adding it again.');
        photo.imageUrl = u;
      }
    }
    // The recipe, when given: what goes into one, from the business's own stock, each line as the cook measures it
    // (checked against the stock, and turned into what each ingredient is counted in, below: lib/kitchen-units).
    let recipeIn: any[] | null = null;
    if (x.recipe !== undefined && x.recipe !== null) {
      if (!Array.isArray(x.recipe)) return bad('Check the recipe.');
      if (x.recipe.length > MAX_RECIPE_LINES) return bad(`Up to ${MAX_RECIPE_LINES} ingredients in a recipe.`);
      if (x.recipe.some((l: any) => !ID.test(String(l?.id || '')) || String(l?.id) === itemId)) return bad('Check the recipe: one of the ingredients isn’t in your stock.');
      recipeIn = x.recipe;
    }
    // What each choice changes in the recipe (lib/choice-recipe), by option, as given.
    const changesIn = new Map<string, ChoiceChange[]>();
    for (const cg of rawGroups) for (const o of Array.isArray(cg?.options) ? cg.options : []) {
      const ch = cleanChanges(o?.changes); if (!ch.length) continue;
      // Its option as saved: by its id (kept by cleanForSave), else by its group's and its own name.
      const grp = choices.find((c) => c.id === String(cg?.id || '')) || choices.find((c) => words(c.name, 40) === words(cg?.name, 40));
      const opt = grp?.options.find((y) => y.id === String(o?.id || '')) || grp?.options.find((y) => words(y.name, 40) === words(o?.name, 40));
      if (grp && opt && !grp.setId) changesIn.set(`${grp.id}/${opt.id}`, ch);
    }
    const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
    const r: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data();
      // A set's choice as this item has it: each option keeping the id it has here (what its orders and sales were kept
      // with), and the set's changes for each option, fitted to the recipe below.
      const setChanges = new Map<string, ChoiceChange[]>();
      const mine = choices.map((c) => {
        const cs = c.setId ? sets.get(c.setId) : null; if (!cs) return c;
        const was = (Array.isArray(cur?.choices) ? cur.choices : []).find((g: any) => String(g?.id) === c.id && g?.setId === c.setId);
        const grp = choiceGroups({ choices: [groupOfSet(cs, c.id, () => undefined, idsOnItem(was))] }, true)[0];
        for (const o of grp.options) { const so = cs.options.find((y) => y.id === (o.setOption || o.id)); if (so?.changes?.length) setChanges.set(`${c.id}/${o.id}`, so.changes); }
        return grp;
      });
      // An option sent without its changes (a caller that doesn't edit them) keeps the ones it has; an empty list clears them.
      const stored = optionChanges(cur);
      for (const cg of rawGroups) for (const o of Array.isArray(cg?.options) ? cg.options : []) {
        if (o?.changes !== undefined) continue;
        const key = `${String(cg?.id || '')}/${String(o?.id || '')}`; if (choices.some((c) => c.id === String(cg?.id) && c.setId)) continue;
        if (stored.has(key) && choices.some((c) => c.id === String(cg?.id) && c.options.some((y) => y.id === String(o?.id)))) changesIn.set(key, stored.get(key)!);
      }
      const wantIds = Array.from(new Set<string>([...(recipeIn || []).map((l: any) => String(l.id)), ...Array.from(setChanges.values()).flat().flatMap((c) => (c.kind === 'add' ? [c.id] : c.kind === 'swap' ? [c.to] : [])), ...Array.from(changesIn.values()).flat().flatMap((c) => (c.kind === 'add' ? [c.id] : c.kind === 'swap' ? [c.to] : [])), ...recipeOf(cur, itemId).map((l) => l.id)])).filter((id) => ID.test(id) && id !== itemId);
      const partDocs = await Promise.all(wantIds.map((id) => tx.get(db.doc(`tenants/${tenantId}/inventory/${id}`))));
      const parts = new Map<string, any>(); wantIds.forEach((id, k) => { const d = partDocs[k].data(); if (d) parts.set(id, d); });
      // An item that goes into another item's recipe is counted by its own count, so it can't have a recipe of its own.
      const usedIn = recipeIn && recipeIn.length ? (await tx.get(db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400))).docs
        .find((d: any) => d.id !== itemId && isMenuItem(d.data()) && recipeOf(d.data() || {}, d.id).some((l) => l.id === itemId)) : null;
      if (!isMenuItem(cur)) return { error: 'That isn’t on the menu.', status: 404 };
      if (usedIn) return { error: `${words(cur.name, 40) || 'This item'} goes into ${words(usedIn.data()?.name, 40) || 'another item'}’s recipe, so it’s counted by itself. Take it out of that recipe first.`, status: 409 };
      let formula: any[] | undefined;
      if (recipeIn) { const f = recipeFromScreen(recipeIn, itemId, parts); if ('error' in f) return f; formula = f.formula; }
      // Each choice's changes, against the recipe as it'll be: what it adds is in stock and can be measured that way; what
      // it swaps out or leaves out is in the recipe; what it swaps in can stand in the same measure.
      const recipeNow = formula ? recipeOf({ formula }, itemId) : recipeOf(cur, itemId);
      const checked = new Map<string, ChoiceChange[]>();
      for (const [key, list] of changesIn) {
        const [gid, oid] = key.split('/'); const optName = choices.find((c) => c.id === gid)?.options.find((y) => y.id === oid)?.name || 'A choice';
        const out: ChoiceChange[] = [];
        for (const c of list) {
          if (c.kind === 'add') {
            const p = parts.get(c.id); if (!p || !canBeIngredient(p, c.id)) return { error: `${optName}: what it adds isn’t in your stock any more. Pick another.`, status: 409 };
            if (toStockUnits(c.amount, c.measure, p) === null) return { error: `${optName}: ${words(p.name, 40)} is counted in ${unitLabel(p)}, so ${c.amount} ${c.measure} can’t be worked out from that.`, status: 400 };
            out.push({ ...c, name: words(p.name, 80) || c.name });
          } else if (c.kind === 'swap') {
            const line = recipeNow.find((l) => l.id === c.from); const p = parts.get(c.to);
            if (!line) return { error: `${optName}: it swaps out ${c.fromName}, which isn’t in the recipe. Add it to the recipe, or change the choice.`, status: 400 };
            if (!p || !canBeIngredient(p, c.to)) return { error: `${optName}: what it swaps in isn’t in your stock any more. Pick another.`, status: 409 };
            if (toStockUnits(line.measure ? Number(line.amount) : line.quantityUsed, line.measure || line.unit, p) === null) return { error: `${optName}: ${words(p.name, 40)} is counted in ${unitLabel(p)}, so it can’t stand in for ${line.measure ? `${line.amount} ${line.measure}` : `${line.quantityUsed} ${line.unit}`} of ${line.name}. Count it the same way, or say in Inventory what one gives.`, status: 400 };
            out.push({ ...c, fromName: line.name, toName: words(p.name, 80) || c.toName });
          } else {
            const line = recipeNow.find((l) => l.id === c.id);
            if (!line) return { error: `${optName}: it leaves out ${c.name}, which isn’t in the recipe.`, status: 400 };
            out.push({ ...c, name: line.name });
          }
        }
        checked.set(key, out);
      }
      // A set's changes: only those that fit this item's recipe (oat instead of whole milk does nothing on a drink with
      // no milk), never refused.
      if (setChanges.size) { const { fitChanges } = await import('@/lib/choice-sets-server'); for (const [key, list] of setChanges) { const fit = fitChanges(list, recipeNow, parts); if (fit.length) checked.set(key, fit); } }
      // What's sold out is the kitchen's to say (one tap, api/menu 'soldout' or the kitchen screen): a save keeps it as
      // it is now, whatever the form had when it opened.
      // (Each location's own sold out, `outAt`, kept the same way.)
      const nowOut = new Map<string, string | null>(); const nowAt = new Map<string, Record<string, string>>();
      for (const cg of Array.isArray(cur.choices) ? cur.choices : []) for (const o of Array.isArray(cg?.options) ? cg.options : []) {
        if (outNow(o)) nowOut.set(`${cg.id}/${o.id}`, o.soldOutUntil || null);
        const at = outAtOf(o); if (Object.keys(at).length) nowAt.set(`${cg.id}/${o.id}`, at);
      }
      const kept = mine.map((cg) => ({ ...cg, options: cg.options.map((o) => ({ ...(nowOut.has(`${cg.id}/${o.id}`) ? { ...o, soldOut: true, soldOutUntil: nowOut.get(`${cg.id}/${o.id}`) } : { ...o, soldOut: false }),
        ...(nowAt.has(`${cg.id}/${o.id}`) ? { outAt: nowAt.get(`${cg.id}/${o.id}`) } : {}),
        ...(checked.has(`${cg.id}/${o.id}`) ? { changes: checked.get(`${cg.id}/${o.id}`) } : {}) })) }));
      // The desk and a table's tab charge an item's Inventory price (lib/variants deskPrice): set to the menu's when the
      // menu's price changes (or there isn't one yet), so a dish costs the same at the counter, at a table and at the desk.
      // An item from a starter menu goes on the menu only once it has a price (it came in at none, lib/food-starters).
      if (cur.createdVia === 'food-starter' && x.onMenu !== false && !(price > 0)) return { error: 'Give it a price first, then put it on the menu.', status: 400 };
      // Its number on the scale: only on an item sold by weight, and on one item at a time. No longer sold by weight, it goes.
      const weighedNow = timed.byWeight !== undefined ? !!timed.byWeight : !!byWeightOf(cur);
      let scalePatch: Record<string, any> = {};
      if (!weighedNow && cur.scaleNo) scalePatch = { scaleNo: null };
      else if (scaleNo !== undefined) {
        if (scaleNo && !weighedNow) return { error: 'Only an item sold by weight has a number on the scale.', status: 400 };
        if (scaleNo) {
          const other = (await tx.get(db.collection(`tenants/${tenantId}/inventory`).where('scaleNo', '==', scaleNo).limit(20))).docs.find((d: any) => d.id !== itemId && d.data()?.archived !== true);
          if (other) return { error: `${words(other.data()?.name, 40) || 'Another item'} has scale number ${scaleNo} already. Each item has its own.`, status: 409 };
        }
        scalePatch = { scaleNo: scaleNo || null };
      }
      const deskToo = !(Number(cur.msrp) > 0) || Math.round(Number(cur.price) * 100) !== Math.round(price * 100);
      const patch = { name, category: words(x.section, 40) || 'Menu', description: words(x.words, 240), price, ...(deskToo ? { msrp: price } : {}), choices: kept, choiceSetIds: setIdsOf(kept),
        showInConcierge: x.onMenu !== false, isMembersOnly: x.membersOnly === true, ...timing, ...service, ...safety, ...photo, ...board, ...timed, ...scalePatch, ...(formula ? { formula } : {}), menuUpdatedAt: new Date().toISOString(), menuUpdatedBy: words(g.actor?.name, 60) || null };
      tx.set(ref, patch, { merge: true });
      return { item: menuItemOf(itemId, { ...cur, ...patch }), raw: { ...cur, ...patch } };
    });
    if (r.error) return bad(r.error, r.status);
    // A nightly count just changed: counts are read fresh next time.
    if (safety.dailyCount !== undefined) forgetCounts(tenantId);
    // As every menu shows it now: with its recipe's ingredients counted.
    const item = await menuItemNow(db, tenantId, itemId, r.raw, soldHere).catch(() => r.item);
    return ok({ item, recipe: recipeOf(r.raw, itemId), changes: Object.fromEntries(optionChanges(r.raw)) });
  } catch (e: any) {
    console.error('[menu] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}

/** A prep recipe as the Menu page lists it: what a batch makes and costs, what one portion costs, what's on the shelf,
 *  and its recipe for the editor (lib/prep-recipes). */
function prepRow(id: string, x: any, parts: Map<string, any>) {
  const p = prepOf(x)!; const lines = recipeOf(x, id); const c = linesCost(lines, parts); const left = ingredientLeft(x);
  return { id, name: words(x.name, 80) || 'Prep recipe', makes: p.makes, unit: p.unit, keepsDays: p.keepsDays, minutes: p.minutes, lastMadeAt: p.lastMadeAt, lastMadeBy: p.lastMadeBy,
    left: left === null ? null : Math.round(left * 1000) / 1000, batchCost: c.cost, unitCost: c.cost === null ? null : c.cost / p.makes, typical: c.typical, gaps: c.gaps, recipe: lines };
}
