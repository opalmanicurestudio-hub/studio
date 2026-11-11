// src/app/api/menu/route.ts — THE MENU, for the team (app/(app)/menu): what guests see of each drink and dish, its
// choices, and "Sold out" in one tap. Items themselves (stock, cost, recipe) are made in Inventory; this is the menu side.
//   list    { tenantId }                                   → every menu item (anyone on the team)
//   soldout { tenantId, itemId, groupId?, optionId?, out } → the item, or one of its choices, sold out or back (anyone on the team)
//   save    { tenantId, itemId, item: { name, section, words, price, choices, onMenu, membersOnly, makeSeconds?,
//             holdMinutes?, batchSize?, imageUrl? } } → managers (the kitchen timing: lib/counter-orders, lib/holding; the
//             photo: an https address the Menu page uploaded, or null to take it off)
//   targets { tenantId, targets: { 'drive-thru'?, counter?, kiosk?, ahead? } } → managers: seconds each kind of order
//             aims to be handed over in (list returns them)
//   voice   { tenantId, on?, askName? } → managers: the drive-thru's voice assistant on or off here (api/counter/voice),
//             and whether it asks each car for a first name; list says whether it's set up, on, asking, and up to date
//   voiceUpdate { tenantId } → managers: bring this business's assistant up to date (lib/drive-thru-voice-setup)
//   voiceSetup { tenantId } → managers: make this business's assistant with the voice service (lib/drive-thru-voice-setup)
// Nothing about cost or suppliers is read or written here.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { readMenu, setSoldOut, isMenuItem, menuItemOf } from '@/lib/menu-server';
import { cleanForSave, outNow, MAX_GROUPS, MAX_OPTIONS } from '@/lib/menu-choices';
import { randomBytes } from 'crypto';
import { targetsOf, photoOf, CHANNELS } from '@/lib/counter-orders';
import { agentOf } from '@/lib/drive-thru-voice';
import { setUpDriveThruAssistant, updateDriveThruAssistant, VOICE_VERSION } from '@/lib/drive-thru-voice-setup';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
/** This app's storage, where the Menu page uploads photos. */
const ownBuckets = () => Array.from(new Set([process.env.FIREBASE_STORAGE_BUCKET, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET].map((b) => String(b || '').trim()).filter((b) => /^[A-Za-z0-9._-]{3,222}$/.test(b))));
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['list', 'soldout', 'save', 'targets', 'voice', 'voiceSetup', 'voiceUpdate'].includes(action)) return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, ['save', 'targets', 'voice', 'voiceSetup', 'voiceUpdate'].includes(action) ? 'manager' : 'staff'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('The menu is the business’s own.', 403);
    const db = getAdminDb();

    if (action === 'list') {
      const [menu, t] = await Promise.all([readMenu(db, tenantId), db.doc(`tenants/${tenantId}`).get()]);
      const td: any = t.data() || {};
      const setUp = !!process.env.RETELL_API_KEY && !!agentOf(td);
      return ok({ menu, canEdit: !!(g.actor?.isManager || g.actor?.isTenantOwner), targets: targetsOf(td),
        voice: { setUp, on: setUp && td.driveThru?.voice !== false, canSetUp: !setUp && !!process.env.RETELL_API_KEY && !!process.env.VOICE_AGENT_SECRET, askName: td.driveThru?.askName !== false,
          // An assistant this app made for the business, made with older instructions: offered an update.
          outdated: setUp && !!td.driveThru?.voiceLlmId && Math.floor(Number(td.driveThru?.voiceVersion) || 1) < VOICE_VERSION } });
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
        showInConcierge: x.onMenu !== false, isMembersOnly: x.membersOnly === true, ...timing, ...photo, menuUpdatedAt: new Date().toISOString(), menuUpdatedBy: words(g.actor?.name, 60) || null };
      tx.set(ref, patch, { merge: true });
      return { item: menuItemOf(itemId, { ...cur, ...patch }) };
    });
    return r.error ? bad(r.error, r.status) : ok({ item: r.item });
  } catch (e: any) {
    console.error('[menu] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
