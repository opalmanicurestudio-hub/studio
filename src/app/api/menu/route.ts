// src/app/api/menu/route.ts — THE MENU, for the team (app/(app)/menu): what guests see of each drink and dish, its
// choices, and "Sold out" in one tap. Items themselves (stock, cost, recipe) are made in Inventory; this is the menu side.
//   list    { tenantId }                                   → every menu item (anyone on the team)
//   soldout { tenantId, itemId, groupId?, optionId?, out } → the item, or one of its choices, sold out or back (anyone on the team)
//   save    { tenantId, itemId, item: { name, section, words, price, choices, onMenu, membersOnly, makeSeconds?,
//             holdMinutes?, batchSize?, imageUrl?, recipe? } } → managers (the kitchen timing: lib/counter-orders, lib/holding;
//             the photo: an https address the Menu page uploaded, or null to take it off; the recipe: [{ id, quantityUsed }],
//             what goes into one, from the business's own stock — an item with one is counted by its ingredients,
//             lib/menu-stock; [] takes it off, and the item is counted by itself again)
//   ingredients { tenantId } → managers: what a recipe can use (the business's stock, by name, with what's left and what
//             it's counted in; never cost or supplier)
//   service { tenantId, courses?, stations?, compAllowanceCents?, compReasons? } → managers: table service (lib/table-
//             service): the courses (name, held until fired or not), the stations things are made at, how much a server
//             can comp in a night on their own say, and the comp reasons offered. list returns them as `service`.
//   (save also takes station: one of the stations or null, and course: a course number, 0 for right away, or null;
//   allergens: what it contains, from lib/allergens; and dailyCount: how many it starts each night with, or null.)
//   (service also takes askAllergies: whether a table is asked about allergies before its first order.)
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
//   laneSettings { tenantId, spots } → managers: how many numbered pull-forward spots the drive-thru has (1 to 8)
//   voiceSetup { tenantId } → managers: make this business's assistant with the voice service (lib/drive-thru-voice-setup)
// Nothing about cost or suppliers is read or written here. `list` also gives each item's recipe.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { readMenu, setSoldOut, isMenuItem, menuItemOf, menuItemNow } from '@/lib/menu-server';
import { recipeOf, ingredientLeft, ingredientUnit, MAX_RECIPE_LINES } from '@/lib/menu-stock';
import { cleanForSave, outNow, MAX_GROUPS, MAX_OPTIONS } from '@/lib/menu-choices';
import { randomBytes } from 'crypto';
import { targetsOf, photoOf, spotsOf, CHANNELS } from '@/lib/counter-orders';
import { agentOf } from '@/lib/drive-thru-voice';
import { setUpDriveThruAssistant, updateDriveThruAssistant, VOICE_VERSION } from '@/lib/drive-thru-voice-setup';
import { aheadOf } from '@/lib/counter-ahead';
import { askAllergiesOf, compAllowanceCents, compReasonsOf, coursesOf, stationsOf, MAX_COMP_ALLOWANCE_CENTS, MAX_COURSES, MAX_STATIONS } from '@/lib/table-service';
import { ALLERGENS, cleanKeys } from '@/lib/allergens';
import { MAX_COUNT } from '@/lib/dish-counts';
import { forgetCounts, liveCounts, setTonightCount } from '@/lib/dish-counts-server';
import { accountOf } from '@/lib/reader-sale';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
/** This app's storage, where the Menu page uploads photos. */
const ownBuckets = () => Array.from(new Set([process.env.FIREBASE_STORAGE_BUCKET, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET].map((b) => String(b || '').trim()).filter((b) => /^[A-Za-z0-9._-]{3,222}$/.test(b))));
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Table service as the Menu page edits it (lib/table-service). */
const serviceOf = (t: any) => ({ courses: coursesOf(t), stations: stationsOf(t), compAllowanceCents: compAllowanceCents(t), compReasons: compReasonsOf(t), askAllergies: askAllergiesOf(t) });

/** What the Menu page shows of ordering ahead: the settings, the guests' link, and whether payments are connected. */
function aheadSettings(t: any, tenantId: string, origin: string | null) {
  const a = t.orderAhead || {}; const A = aheadOf(t);
  return { on: A.on, driveThru: a.driveThru !== false, inside: a.inside !== false, laterHours: A.laterHours, payments: !!accountOf(t),
    link: `${linkOrigin(t, origin).replace(/\/+$/, '')}/order/${encodeURIComponent(tenantId)}` };
}

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['list', 'soldout', 'save', 'ingredients', 'targets', 'service', 'voice', 'voiceSetup', 'voiceUpdate', 'laneSettings', 'ahead', 'counts', 'count'].includes(action)) return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, ['save', 'ingredients', 'targets', 'service', 'voice', 'voiceSetup', 'voiceUpdate', 'laneSettings', 'ahead', 'count'].includes(action) ? 'manager' : 'staff'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('The menu is the business’s own.', 403);
    const db = getAdminDb();

    if (action === 'list') {
      const [menu, t, items] = await Promise.all([readMenu(db, tenantId), db.doc(`tenants/${tenantId}`).get(), db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400).get()]);
      const td: any = t.data() || {};
      const setUp = !!process.env.RETELL_API_KEY && !!agentOf(td);
      // Each item's recipe (what goes into one), for the Menu page's editor.
      const recipes: Record<string, any[]> = {};
      for (const d of items.docs) { const r = recipeOf(d.data() || {}, d.id); if (r.length) recipes[d.id] = r; }
      // Tonight's counts, for "3 left" beside each counted dish (lib/dish-counts).
      const counts = (await liveCounts(db, tenantId, td, items.docs.map((d: any) => ({ id: d.id, x: d.data() || {} })).filter((r: any) => isMenuItem(r.x))).catch(() => ({ rows: [] as any[] }))).rows;
      // One the count just sold out (or brought back) shows that way here too.
      for (const r of counts) { const m = menu.find((x) => x.id === r.id); if (m) m.soldOut = r.soldOut; }
      return ok({ menu, recipes, counts, canEdit: !!(g.actor?.isManager || g.actor?.isTenantOwner), targets: targetsOf(td), service: serviceOf(td), lane: { spots: spotsOf(td) }, ahead: aheadSettings(td, tenantId, req.nextUrl?.origin || null),
        voice: { setUp, on: setUp && td.driveThru?.voice !== false, canSetUp: !setUp && !!process.env.RETELL_API_KEY && !!process.env.VOICE_AGENT_SECRET, askName: td.driveThru?.askName !== false,
          // An assistant this app made for the business, made with older instructions: offered an update.
          outdated: setUp && !!td.driveThru?.voiceLlmId && Math.floor(Number(td.driveThru?.voiceVersion) || 1) < VOICE_VERSION } });
    }

    if (action === 'counts' || action === 'count') {
      const td: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      if (action === 'count') { const r = await setTonightCount(db, tenantId, td, b.itemId, b.value, String(g.actor?.name || 'A manager')); if (!r.ok) return bad(r.error, r.status); }
      const c = await liveCounts(db, tenantId, td, undefined, { fresh: b.fresh === true || action === 'count' });
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
      await tRef.set({ driveThru: { voiceAgentId: r.agentId, voiceLlmId: r.llmId, voiceVersion: VOICE_VERSION, voice: true, voiceSettingUpAt: null, voiceSetUpAt: new Date().toISOString(), voiceSetUpBy: words(g.actor?.name, 60) || null } }, { merge: true });
      return ok({ setUp: true, on: true });
    }

    if (action === 'voice') {
      const patch: Record<string, boolean> = {};
      if (typeof b.on === 'boolean') patch.voice = b.on;
      if (typeof b.askName === 'boolean') patch.askName = b.askName;
      if (!Object.keys(patch).length) return bad('On or off?');
      await db.doc(`tenants/${tenantId}`).set({ driveThru: patch }, { merge: true });
      const td: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      return ok({ on: td.driveThru?.voice !== false, askName: td.driveThru?.askName !== false });
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
      await tRef.set({ driveThru: { voiceVersion: VOICE_VERSION, voiceUpdatedAt: new Date().toISOString(), voiceUpdatedBy: words(g.actor?.name, 60) || null } }, { merge: true });
      return ok({ updated: true });
    }

    // Ordering ahead (lib/counter-ahead): on or off, how guests can pick up, and how far ahead they can order.
    if (action === 'ahead') {
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      const cur = t.orderAhead || {};
      const patch: any = {};
      if (typeof b.on === 'boolean') patch.on = b.on;
      if (typeof b.driveThru === 'boolean') patch.driveThru = b.driveThru;
      if (typeof b.inside === 'boolean') patch.inside = b.inside;
      if (b.laterHours !== undefined) { const h = Math.floor(Number(b.laterHours)); if (!(h >= 0 && h <= 12)) return bad('Up to 12 hours ahead.'); patch.laterHours = h; }
      const next = { ...cur, ...patch };
      if (next.driveThru === false && next.inside === false) return bad('Keep at least one way to pick up.');
      if (patch.on === true && !accountOf(t)) return bad('Connect payments first: orders placed ahead are paid when they’re placed.', 409);
      await db.doc(`tenants/${tenantId}`).set({ orderAhead: { ...patch, updatedAt: new Date().toISOString(), updatedBy: words(g.actor?.name, 60) || null } }, { merge: true });
      return ok({ ahead: aheadSettings({ ...t, orderAhead: next }, tenantId, req.nextUrl?.origin || null) });
    }

    if (action === 'laneSettings') {
      const n = typeof b.spots === 'number' ? Math.floor(b.spots) : NaN;
      if (!(n >= 1 && n <= 8)) return bad('Between 1 and 8 spots.');
      await db.doc(`tenants/${tenantId}`).set({ driveThru: { spots: n } }, { merge: true });
      return ok({ lane: { spots: n } });
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
      if (!Object.keys(next).length) return bad('Nothing to change.');
      await tRef.set({ kitchenSettings: next }, { merge: true });
      return ok({ service: serviceOf({ ...td, kitchenSettings: { ...(td.kitchenSettings || {}), ...next } }) });
    }

    if (action === 'ingredients') {
      // What a recipe can use: anything the business stocks but equipment, and never a menu item that's made from its own
      // recipe (one level of recipe only).
      const snap = await db.collection(`tenants/${tenantId}/inventory`).limit(1500).get();
      const list = snap.docs.map((d: any) => ({ id: d.id, x: d.data() || {} }))
        .filter(({ id, x }: any) => ID.test(id) && canBeIngredient(x, id))
        .map(({ id, x }: any) => { const left = ingredientLeft(x); return { id, name: words(x.name, 80) || 'Item', unit: ingredientUnit(x), left: left === null ? null : Math.round(left * 100) / 100, menu: x.type === 'refreshment' }; })
        .sort((a: any, c: any) => a.name.localeCompare(c.name));
      return ok({ ingredients: list });
    }

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
    // The recipe, when given: what goes into one, from the business's own stock (checked against it below).
    let recipeIn: { id: string; q: number }[] | null = null;
    if (x.recipe !== undefined && x.recipe !== null) {
      if (!Array.isArray(x.recipe)) return bad('Check the recipe.');
      if (x.recipe.length > MAX_RECIPE_LINES) return bad(`Up to ${MAX_RECIPE_LINES} ingredients in a recipe.`);
      recipeIn = [];
      for (const l of x.recipe) {
        const id = String(l?.id || ''); const q = Math.round(Number(l?.quantityUsed) * 1000) / 1000;
        if (!ID.test(id) || id === itemId) return bad('Check the recipe: one of the ingredients isn’t in your stock.');
        if (!Number.isFinite(q) || q <= 0 || q > 10000) return bad(`How much ${words(l?.name, 40) || 'of an ingredient'} goes into one? Type an amount above 0.`);
        const same = recipeIn.find((y) => y.id === id); if (same) same.q = Math.round((same.q + q) * 1000) / 1000; else recipeIn.push({ id, q });
      }
    }
    const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
    const r: any = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data();
      const partDocs = recipeIn ? await Promise.all(recipeIn.map((l) => tx.get(db.doc(`tenants/${tenantId}/inventory/${l.id}`)))) : [];
      // An item that goes into another item's recipe is counted by its own count, so it can't have a recipe of its own.
      const usedIn = recipeIn && recipeIn.length ? (await tx.get(db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400))).docs
        .find((d: any) => d.id !== itemId && isMenuItem(d.data()) && recipeOf(d.data() || {}, d.id).some((l) => l.id === itemId)) : null;
      if (!isMenuItem(cur)) return { error: 'That isn’t on the menu.', status: 404 };
      if (usedIn) return { error: `${words(cur.name, 40) || 'This item'} goes into ${words(usedIn.data()?.name, 40) || 'another item'}’s recipe, so it’s counted by itself. Take it out of that recipe first.`, status: 409 };
      let formula: any[] | undefined;
      if (recipeIn) {
        formula = [];
        for (const [k, l] of recipeIn.entries()) {
          const p: any = partDocs[k].data();
          if (!p || !canBeIngredient(p, l.id)) return { error: `${p ? words(p.name, 40) || 'One of the ingredients' : 'One of the ingredients'} can’t go into a recipe. Take it off and save again.`, status: 409 };
          formula.push({ id: l.id, name: words(p.name, 80) || 'Ingredient', quantityUsed: l.q, unit: ingredientUnit(p) });
        }
      }
      // What's sold out is the kitchen's to say (one tap, api/menu 'soldout' or the kitchen screen): a save keeps it as
      // it is now, whatever the form had when it opened.
      const nowOut = new Map<string, string | null>();
      for (const cg of Array.isArray(cur.choices) ? cur.choices : []) for (const o of Array.isArray(cg?.options) ? cg.options : []) if (outNow(o)) nowOut.set(`${cg.id}/${o.id}`, o.soldOutUntil || null);
      const kept = choices.map((cg) => ({ ...cg, options: cg.options.map((o) => (nowOut.has(`${cg.id}/${o.id}`) ? { ...o, soldOut: true, soldOutUntil: nowOut.get(`${cg.id}/${o.id}`) } : { ...o, soldOut: false })) }));
      // The desk and a table's tab charge an item's Inventory price (lib/variants deskPrice): set to the menu's when the
      // menu's price changes (or there isn't one yet), so a dish costs the same at the counter, at a table and at the desk.
      const deskToo = !(Number(cur.msrp) > 0) || Math.round(Number(cur.price) * 100) !== Math.round(price * 100);
      const patch = { name, category: words(x.section, 40) || 'Menu', description: words(x.words, 240), price, ...(deskToo ? { msrp: price } : {}), choices: kept,
        showInConcierge: x.onMenu !== false, isMembersOnly: x.membersOnly === true, ...timing, ...service, ...safety, ...photo, ...board, ...(formula ? { formula } : {}), menuUpdatedAt: new Date().toISOString(), menuUpdatedBy: words(g.actor?.name, 60) || null };
      tx.set(ref, patch, { merge: true });
      return { item: menuItemOf(itemId, { ...cur, ...patch }), raw: { ...cur, ...patch } };
    });
    if (r.error) return bad(r.error, r.status);
    // A nightly count just changed: counts are read fresh next time.
    if (safety.dailyCount !== undefined) forgetCounts(tenantId);
    // As every menu shows it now: with its recipe's ingredients counted.
    const item = await menuItemNow(db, tenantId, itemId, r.raw).catch(() => r.item);
    return ok({ item, recipe: recipeOf(r.raw, itemId) });
  } catch (e: any) {
    console.error('[menu] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}

/** Can this go into a menu item's recipe: something the business stocks (not equipment, not archived), and not a menu
 *  item that's made from a recipe of its own. */
function canBeIngredient(x: any, id: string): boolean {
  if (!x || x.archived === true || x.status === 'archived' || x.isActive === false) return false;
  if (x.type === 'equipment') return false;
  if (x.type === 'refreshment' && recipeOf(x, id).length) return false;
  return true;
}
