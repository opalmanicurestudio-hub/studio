// src/app/api/counter/route.ts — QUICK-SERVICE ORDERS (L21): the drive-thru lane first, then the counter and kiosk. A
// lane tablet is set up once like the kitchen screen (api/kitchen 'pair', kind 'drive-thru') and carries its own key; a
// team member signed in on their own device can use it with no key. A PIN pass (api/kitchen 'pin') puts a name on
// what's done. Every price comes from the menu (lib/counter-orders, lib/menu-choices), never from a screen, and every
// change to an order goes through lib/counter-server (the voice assistant uses the same steps).
//   lane   { tenantId, key }                        → cars in the lane (at the speaker, paying, picking up, pulled
//                                                      forward), their orders and how the kitchen is getting on, today's
//                                                      times against the target (and where the time goes), and the menu
//   board  { tenantId, key }                        → the outdoor order board (its own kind of key, good for nothing
//                                                      else): the newest car's order as it's built, nothing else
//   car    { tenantId, key, carKey? }               → a car at the speaker: its number and an empty order (the same
//                                                      carKey sent twice is the same car)
//   add    { tenantId, key, orderId, itemId, quantity?, choices?, tapKey? } → a line, priced from the menu (the
//                                                      same tapKey twice adds it once)
//   remove { tenantId, key, orderId, lineId, tapKey? }  ·  qty { tenantId, key, orderId, lineId, quantity, tapKey? }
//   send   { tenantId, key, orderId }               → to the kitchen: one ticket a line, due by the channel's target
//                                                      (the drive-thru's is the tightest); stock and recipe parts once
//   paid   { tenantId, key, orderId, method: 'card'|'cash', tendered? } → paid at the window: the sale and its tax in
//                                                      the books, cash into the open drawer (with what was handed over
//                                                      and the change); the car moves on to pick up
//   move   { tenantId, key, carId, to: 'pickup'|'forward'|'gone', spot? } → along the lane, only ever forward;
//                                                      "forward" parks it (a numbered spot) so the cars behind keep
//                                                      moving; "gone" hands it over (paid, or never sent)
//   name   { tenantId, key, orderId, name }         → the guest's first name on the order (and its kitchen tickets), or
//                                                      none; the board, the window and the bag call them by it
//   car    { tenantId, key, carKey, inLine?, looks? } → a new car (taken in line before the speaker: never greeted at the
//                                                      speaker or shown on its board; told apart by how it looks)
//   looks  { tenantId, key, carId, looks }          → how a car looks ("Red SUV"), or none
//   here   { tenantId, key, carId }                 → a car taken in line has reached the window: from now on it's a car
//                                                      at the window like any other (the window screens show it)
//   pouch  { tenantId, key, staffPass }             → the cash the person signed in has taken in line and not handed in
//   handIn { tenantId, key, staffPass }             → that cash, into the one open drawer
//   phoneLink / phoneCheck { tenantId, key, orderId } → scan to pay: the code the guest scans to pay on their own phone
//                                                      (lib/counter-phone; the window screen shows it too, for 10 minutes)
//                                                      / whether they have
//   readers { tenantId, key }                       → the business's card readers the lane can send a payment to
//   card   { tenantId, key, orderId, readerId }     → the order's total sent to that reader (lib/counter-card); the guest
//                                                      taps, inserts or swipes there
//   cardCheck / cardStop { tenantId, key, orderId } → how it's going (approved: the order is paid by it) / called off so
//                                                      it can be paid another way
//   cardTest { tenantId, key, orderId }             → a test reader only: a test card is presented, to try it end to end
//   window { tenantId, key, at: 'pay'|'pickup'|'one' } → the screen facing the guest at a window (its own display-only key,
//                                                      like the board): the car there, its order and total, how paying is
//                                                      going, and where to go next
//   cancel { tenantId, key, orderId }               → an order not sent yet, dropped (the car leaves the lane)
//   void   { tenantId, key, orderId, reason, staffPass? } → a sent order that won't be paid (the car drove off), by a
//                                                      manager (their PIN, or signed in): lib/counter-server voidOrder
// Part of Lounge & hospitality: closed while it isn't part of the plan (lib/tool-lock).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { accessLockOf } from '@/lib/tenant-access';
import { toolLocked } from '@/lib/tool-lock';
import { screenOf, teamInstead, workingNow } from '@/lib/screen-keys';
import { readMenu } from '@/lib/menu-server';
import { targetsOf, photoOf, spotsOf, RUSH_CARS, inLineNow, CHANNEL_NAME, type Channel } from '@/lib/counter-orders';
import { createCar, editOrder, sendOrder, voidOrder, setOrderName, cleanName, payOrder } from '@/lib/counter-server';
import { cleanLooks } from '@/lib/counter-orders';
import { FieldValue } from 'firebase-admin/firestore';
import { listReaders, startCard, checkCard, stopCard } from '@/lib/counter-card';
import { phoneLink, checkPhone, stopPhone, phoneSig } from '@/lib/counter-phone';
import { walletsOn } from '@/lib/wallet-domains';
import { aheadForLane, aheadToCar, aheadOf } from '@/lib/counter-ahead';
import { pointsOn, linkOrder } from '@/lib/counter-points';
import { pageAccent } from '@/lib/studio-page';
import { menuNumbers } from '@/lib/menu-numbers';
import { readWindow, boardNumbers } from '@/lib/pickup-window';
import { moduleEnabled } from '@/lib/modules';
import { linkOrigin } from '@/lib/app-origin';
import { accountOf, readerStripe } from '@/lib/reader-sale';
import { stopCarCall } from '@/lib/drive-thru-voice';
import { startOfDay, todayIn, tenantTimeZone } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const STAGES = ['speaker', 'pay', 'pickup', 'forward', 'gone'] as const;
type Stage = typeof STAGES[number];
const LIVE: Stage[] = ['speaker', 'pay', 'pickup', 'forward'];
const MANAGER_ROLES = ['owner', 'admin', 'manager'];
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Today's lane numbers, worked out at most every 20 seconds a business (every tablet polls every 2), not on every read.
const statsCache = new Map<string, { at: number; stats: any }>();

// The menu board's menu, per business, for a few seconds (api 'menuBoard').
const menuBoardCache = new Map<string, { at: number; sections: { name: string; items: any[] }[]; popular: Set<string>; popularAt: number }>();

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['lane', 'board', 'window', 'car', 'add', 'remove', 'qty', 'name', 'send', 'paid', 'move', 'cancel', 'void', 'readers', 'card', 'cardCheck', 'cardStop', 'cardTest', 'looks', 'pouch', 'here', 'handIn', 'phoneLink', 'phoneCheck', 'aheadCar', 'menuBoard', 'points'].includes(action)) return bad('Unknown action.');
    const db = getAdminDb(); const T = `tenants/${tenantId}`;

    let screen: any = await screenOf(db, tenantId, b.key);
    let member: { id: string; name: string } | null = null;
    if (!screen && !b.key && action !== 'board' && action !== 'window') {
      const t: any = await teamInstead(req, db, tenantId);
      if (t.deny) return t.deny;
      if (t.renter) return bad('This is for the business’s own team.', 403);
      member = t.member; screen = { ref: null, name: member!.name, kind: 'drive-thru', passes: {} };
    }
    if (!screen) {
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This screen isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }
    // Only a lane screen takes orders and payments here; a screen guests can see (the order board by the speaker, the
    // screen at the window) has a key that only shows. A kitchen or floor screen's key does nothing here.
    if (screen.ref && !(screen.kind === 'drive-thru' || (screen.kind === 'drive-thru-board' && (action === 'board' || action === 'window' || action === 'menuBoard')))) return bad('This screen isn’t set up for the drive-thru. A manager can set it up here.', 401);
    if (action === 'window' && screen.kind !== 'drive-thru-board') return bad('This screen isn’t set up for the window. A manager can set it up here.', 401);
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'The lane screen is closed for now. The business owner can tell you more.' }, { status: 403 });
    // Handing over, taking payment for, or voiding an order already taken still works if the plan changes mid-service.
    if (!['paid', 'move', 'board', 'window', 'menuBoard', 'void', 'readers', 'card', 'cardCheck', 'cardStop', 'cardTest', 'pouch', 'handIn', 'here', 'phoneLink', 'phoneCheck'].includes(action)) { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
    const staff = member || (b.staffPass ? await workingNow(db, tenantId, screen, b.staffPass) : null);
    const staffOk = b.staffPass && !member ? !!staff : undefined;
    const who = { id: staff?.id || null, name: staff?.name || screen.name };
    const by = who.name;
    const now = new Date(); const nowIso = now.toISOString();
    const tz = tenantTimeZone(tenant);

    if (action === 'lane') {
      // Only the cars in the lane now (a car is gone once it's handed over, left, or voided), oldest first.
      // (Read generously and sorted here, so however many were left behind, the cars that just arrived are always shown.)
      const [carSnap, menu] = await Promise.all([db.collection(`${T}/driveThruCars`).where('stage', 'in', LIVE).limit(300).get(), readMenu(db, tenantId)]);
      const live = carSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).sort((a: any, c: any) => String(a.arrivedAt).localeCompare(String(c.arrivedAt))).slice(-40);
      // (Each button carries the number guests order by, as on the menu board: lib/menu-numbers.)
      const laneNums = menuNumbers(menu);
      const orderIds = Array.from(new Set(live.map((c: any) => String(c.orderId || '')).filter((x: string) => ID.test(x))));
      const [orderSnaps, ticketSnaps] = await Promise.all([
        Promise.all(orderIds.map((id) => db.doc(`${T}/counterOrders/${id}`).get())),
        Promise.all(Array.from({ length: Math.ceil(orderIds.length / 30) }, (_, i) => orderIds.slice(i * 30, i * 30 + 30)).map((ids) => db.collection(`${T}/kdsTickets`).where('orderId', 'in', ids).get())),
      ]);
      const tickets = ticketSnaps.flatMap((s: any) => s.docs.map((d: any) => d.data() || {}));
      const orders: Record<string, any> = {};
      for (const s of orderSnaps) {
        const o: any = s.data(); if (!o) continue;
        const mine = tickets.filter((t: any) => t.orderId === s.id && t.status !== 'cancelled');
        const waitingOn = mine.filter((t: any) => t.status === 'pending' || t.status === 'in_progress').map((t: any) => ({ name: String(t.menuItemName || 'Item'), quantity: num(t.quantity) || 1 }));
        orders[s.id] = { id: s.id, number: o.number, channel: o.channel, status: o.status, guestName: cleanName(o.guestName) || null, lines: o.lines || [],
          // Rewards for this order (lib/counter-points): the last 4 of the phone given, and what it earned once paid.
          points: o.clientId && o.points?.phone ? { phone: String(o.points.phone), earned: num(o.points.earned) } : null, subtotal: o.subtotal || 0, tax: o.tax || 0, taxLabel: o.taxLabel || 'Tax', total: o.total || 0,
          paidAt: o.paidAt || null, payMethod: o.payMethod || null, paidVia: o.paidAt ? (o.paidVia || null) : null, sentAt: o.sentAt || null, dueAt: o.dueAt || null,
          // The card reader's payment for it, if one was started (lib/counter-card): how it's going, and the reader's words.
          card: o.card && typeof o.card === 'object' && o.card.state ? { state: String(o.card.state), failed: o.card.failed || null, readerId: o.card.readerId || null, at: o.card.at || null } : null,
          kitchen: o.status === 'building' ? 'not sent' : mine.length && !waitingOn.length ? 'ready' : 'making', waitingOn,
          readyCount: mine.filter((t: any) => t.status === 'ready' || t.status === 'delivered').length, ticketCount: mine.length };
      }
      const target = targetsOf(tenant)['drive-thru'];
      let cached = statsCache.get(tenantId);
      if (!cached || now.getTime() - cached.at > 20000 || cached.stats.target !== target) {
        // Served today (a car that left or was voided isn't a time), and where the time went: ordering at the speaker,
        // then from the order to the window, then waiting at the window or parked until it's handed over.
        const since = startOfDay(todayIn(tz, now), tz).toISOString(); const hourAgo = new Date(now.getTime() - 3600000).toISOString();
        const halfHourAgo = new Date(now.getTime() - 30 * 60000).toISOString();
        const [goneSnap, hourSnap, recentSnap] = await Promise.all([
          db.collection(`${T}/driveThruCars`).where('goneAt', '>=', since).limit(3000).get(),
          db.collection(`${T}/driveThruCars`).where('arrivedAt', '>=', hourAgo).limit(1000).get(),
          db.collection(`${T}/driveThruCars`).where('goneAt', '>=', halfHourAgo).limit(500).get(),
        ]);
        const gone = goneSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => !c.left);
        const span = (c: any, from: string, to: string) => { const a = Date.parse(String(c.stageAt?.[from] || (from === 'speaker' ? c.arrivedAt : ''))), z = Date.parse(String(to === 'gone' ? c.goneAt : c.stageAt?.[to] || '')); const v = (z - a) / 1000; return Number.isFinite(v) && v >= 0 && v < 3600 ? v : null; };
        const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((s2, x) => s2 + x, 0) / v.length) : null; };
        // A car taken in line ordered and paid before it reached the speaker: its own times say nothing about where the
        // speaker and the windows lose time, so it isn't counted in those parts. It is in the day's average, from when it
        // was taken in line: that's the guest's whole wait, which is what the target is about.
        const viaSpeaker = (c: any) => !c.inLine && !c.wasInLine;
        cached = { at: now.getTime(), stats: { average: avg(gone.map((c: any) => span(c, 'speaker', 'gone'))), target,
          ordering: avg(gone.filter(viaSpeaker).map((c: any) => span(c, 'speaker', 'pay'))), toWindow: avg(gone.filter(viaSpeaker).map((c: any) => span(c, 'pay', 'pickup'))), atWindow: avg(gone.filter(viaSpeaker).map((c: any) => span(c, 'pickup', 'gone'))),
          underTarget: gone.filter((c: any) => { const v = span(c, 'speaker', 'gone'); return v !== null && v <= target; }).length,
          thisHour: hourSnap.docs.filter((d: any) => !(d.data() || {}).left).length, servedToday: gone.length,
          // The last half hour on its own, so the lane can say which part is slow right now (not just on average today).
          recent: (() => { const r = recentSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => !c.left && viaSpeaker(c));
            return { count: r.length, ordering: avg(r.map((c: any) => span(c, 'speaker', 'pay'))), toWindow: avg(r.map((c: any) => span(c, 'pay', 'pickup'))), atWindow: avg(r.map((c: any) => span(c, 'pickup', 'gone'))) }; })() } };
        statsCache.set(tenantId, cached);
        if (statsCache.size > 500) statsCache.delete(statsCache.keys().next().value as string);
      }
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' }, screen: screen.name, staff: staff ? { id: staff.id, name: staff.name } : null, staffOk,
        cars: live.map((c: any) => ({ id: c.id, number: c.number, stage: c.stage, arrivedAt: c.arrivedAt, stageAt: c.stageAt || {}, orderId: c.orderId || null, takenBy: c.takenBy || null, spot: c.spot || null,
          inLine: c.inLine === true, wasInLine: c.wasInLine === true, hereAt: c.hereAt || null, looks: cleanLooks(c.looks),
          // The voice assistant's call for this car, if it has one (api/counter/voice): its state and who took over.
          voice: c.voice?.callId ? { status: String(c.voice.status || ''), callId: String(c.voice.callId), takenOverBy: c.voice.takenOverBy || null } : null })),
        orders, stats: { ...cached.stats, inLane: live.length, inLineNow: inLineNow(live, now.getTime()), rushAt: RUSH_CARS }, settings: { spots: spotsOf(tenant) }, menu: menu.filter((m) => m.onMenu).map((m) => ({ ...m, number: laneNums.get(m.id) ?? null })), now: nowIso,
        // Orders placed ahead for the drive-thru, paid and not picked up yet (lib/counter-ahead): those on their way first.
        // (Even with ordering ahead switched off since: an order already paid is still picked up.)
        ahead: await aheadForLane(db, tenantId, tenant).catch((e: any) => { console.error('[counter] orders placed ahead not read', e?.message); return []; }),
        // Whether the business takes orders ahead (the lane offers "Ordered ahead" for a code even with none listed).
        aheadOn: aheadOf(tenant).on, pointsOn: pointsOn(tenant),
      });
    }

    // The menu board (a screen guests read before they order): the menu by section, each item's photo and price, sold out
    // shown as it happens, and the code to order ahead when that's on. Only what's on the menu for everyone.
    if (action === 'menuBoard') {
      // (Read at most every 10 seconds per business, however many boards poll; the week's best sellers every 10 minutes.)
      const hit = menuBoardCache.get(tenantId);
      let sections: { name: string; kind?: 'product'; items: any[] }[];
      if (hit && now.getTime() - hit.at < 10000) sections = hit.sections;
      else {
        // The menu, and the shop's products picked for the window (lib/pickup-window), shown after it.
        const [items, products] = await Promise.all([readMenu(db, tenantId).then((l) => l.filter((m) => m.onMenu && !m.membersOnly)),
          // (Only while the business has the shop.)
          moduleEnabled(tenant, 'retail') ? readWindow(db, tenantId, tenant).catch((e: any) => { console.error('[counter] window not read', e?.message); return [] as any[]; }) : Promise.resolve([] as any[])]);
        // Popular: the three best sellers on the board over the last 7 days (at least 5 each), from the day's counts sendOrder keeps.
        let popular = hit?.popular || new Set<string>(); let popularAt = hit?.popularAt || 0;
        if (!hit || now.getTime() - hit.popularAt > 10 * 60000) {
          // (The business's last 7 days by date, counted back from today's date: a short or long day at a clock change skips none.)
          const noon = Date.parse(`${todayIn(tz, now)}T12:00:00Z`);
          const days = Array.from({ length: 7 }, (_, k) => new Date(noon - k * 86400000).toISOString().slice(0, 10));
          const snaps: any[] | null = await db.getAll(...days.map((d) => db.doc(`${T}/menuSales/${d}`))).catch((e: any) => { console.error('[counter] best sellers not read', e?.message); return null; });
          if (snaps) {
            const sum = new Map<string, number>(); const onBoard = new Set(items.map((m) => m.id));
            for (const sn of snaps) for (const [k, v] of Object.entries<any>((sn?.data?.() || {}) as any)) if (k.startsWith('n_') && onBoard.has(k.slice(2))) sum.set(k.slice(2), (sum.get(k.slice(2)) || 0) + num(v));
            popular = new Set(Array.from(sum.entries()).filter(([, q]) => q >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id));
            popularAt = now.getTime();
          }
          // The window's best sellers the same way: its products' units on the shop's paid orders over the same 7 days.
          if (products.length) {
            const since = new Date(noon - 7 * 86400000).toISOString(); const onWin = new Set(products.map((p: any) => p.id));
            const os: any = await db.collection(`${T}/retailOrders`).where('placedAt', '>', since).orderBy('placedAt', 'desc').limit(400).get().catch((e: any) => { console.error('[counter] window best sellers not read', e?.message); return null; });
            if (os) {
              const sum = new Map<string, number>();
              for (const d of os.docs) { const o: any = d.data() || {}; if (!o.paidAt || o.stage === 'cancelled') continue;
                for (const l of Array.isArray(o.lines) ? o.lines : []) { const id = String(l?.listingId || l?.productId || ''); if (onWin.has(id)) sum.set(id, (sum.get(id) || 0) + num(l?.qtyOrdered)); } }
              for (const [id] of Array.from(sum.entries()).filter(([, q]) => q >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3)) popular.add(id);
            }
          }
        }
        sections = []; const nums = boardNumbers(items, products);
        for (const m of items) {
          let sec = sections.find((x) => x.name === m.section); if (!sec) sections.push((sec = { name: m.section, items: [] }));
          sec.items.push({ id: m.id, name: m.name, words: m.words, price: m.price, from: m.from, startPrice: m.startPrice, imageUrl: m.imageUrl, soldOut: m.soldOut || !m.inStock,
            featured: m.featured, badge: m.badge || (popular.has(m.id) ? 'popular' : null), calories: m.calories,
            // The number guests can order by ("number 3"), the same on every screen (lib/menu-numbers).
            number: nums.get(m.id) ?? null });
        }
        // The window's products after the menu: their size and shades instead of calories, and Pros only when it's sold
        // to licensed pros alone.
        // (A category with the same name as a menu section is named apart, so a screen can show either one.)
        const menuNames = new Set(sections.map((x) => x.name));
        for (const p of products as any[]) {
          const name = menuNames.has(p.section) ? `${p.section} (shop)` : p.section;
          let sec = sections.find((x) => x.name === name && x.kind === 'product'); if (!sec) sections.push((sec = { name, kind: 'product', items: [] } as any));
          sec!.items.push({ id: p.id, name: p.name, words: p.words, price: p.price, from: p.from, startPrice: p.startPrice, imageUrl: p.imageUrl, soldOut: p.soldOut,
            featured: p.featured, badge: p.badge || (popular.has(p.id) ? 'popular' : null), calories: null, number: nums.get(p.id) ?? null,
            kind: 'product', size: p.size, prosOnly: p.prosOnly, swatches: p.swatches.map((w: any) => ({ label: w.label, color: w.color, soldOut: w.soldOut })) });
        }
        // (Not read just now, it tries again on the next ask: the tags it had stay until then.)
        menuBoardCache.set(tenantId, { at: now.getTime(), sections, popular, popularAt });
        if (menuBoardCache.size > 500) menuBoardCache.delete(menuBoardCache.keys().next().value as string);
      }
      const A = aheadOf(tenant);
      // Ordering ahead: the menu's own page when that's on, else the shop when the board shows its products (and the
      // shop is open).
      const shopOpen = sections.some((x) => x.kind === 'product') && moduleEnabled(tenant, 'retail') && tenant.retailSettings?.storePaused !== true;
      const origin = linkOrigin(tenant, req.nextUrl.origin).replace(/\/+$/, '');
      return ok({ business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Menu' }, sections,
        // The business's own color (made readable for white text on it), for the tags and the price on the featured item.
        accent: pageAccent(tenant),
        orderAhead: A.on ? `${origin}/order/${encodeURIComponent(tenantId)}` : shopOpen ? `${origin}/shop/${encodeURIComponent(tenantId)}` : null, now: nowIso });
    }

    if (action === 'board') {
      // What a guest at the speaker sees: the newest car's order as it's built, and once it's sent, where to go and what
      // it comes to (for 20 seconds). An order nobody has touched for 10 minutes is never shown to the next car.
      const since = new Date(now.getTime() - 30 * 60000).toISOString();
      const carSnap = await db.collection(`${T}/driveThruCars`).where('arrivedAt', '>=', since).get();
      // (A car taken in line, before the speaker, is never the one at the speaker.)
      const newest: any = carSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => c.inLine !== true).sort((a: any, c: any) => String(c.arrivedAt).localeCompare(String(a.arrivedAt)))[0] || null;
      const o: any = newest && (newest.stage === 'speaker' || newest.stage === 'pay') && ID.test(String(newest.orderId || '')) ? (await db.doc(`${T}/counterOrders/${newest.orderId}`).get()).data() : null;
      const touched = o ? Date.parse(String(o.updatedAt || o.createdAt || '')) : NaN;
      const show = o && (o.status === 'building' ? now.getTime() - touched < 10 * 60000 : o.status === 'sent' && now.getTime() - Date.parse(String(o.sentAt || '')) < 20000);
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' },
        order: show ? { number: o.number, name: cleanName(o.guestName) || null, sent: o.status !== 'building', lines: (o.lines || []).map((l: any) => ({ name: l.name, quantity: l.quantity, choicesText: l.choicesText || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: photoOf(l) })),
          subtotal: num(o.subtotal), tax: num(o.tax), total: num(o.total) } : null,
        now: nowIso,
      });
    }

    if (action === 'window') {
      // The car at this window and nothing about any other: at the pay window, the first car to pay (or the one that just
      // paid, for a few seconds, while it pulls away); at the pickup window, the first car picking up; at a single window,
      // whichever of those is first. A car just parked in a spot or just handed over at this window is told where to go,
      // or thanked, before the next car shows.
      const at = b.at === 'pay' || b.at === 'pickup' ? b.at : 'one';
      const nowMs = now.getTime(); const ageOf = (iso: unknown) => nowMs - (Date.parse(String(iso || '')) || 0);
      const [liveSnap, goneSnap] = await Promise.all([
        db.collection(`${T}/driveThruCars`).where('stage', 'in', LIVE).limit(300).get(),
        at === 'pay' ? Promise.resolve({ docs: [] as any[] }) : db.collection(`${T}/driveThruCars`).where('goneAt', '>=', new Date(nowMs - 10000).toISOString()).limit(10).get(),
      ]);
      // (A car taken in line is still back in the line until someone at the window taps “It’s here”.)
      // In the order they reached the window: a car taken in line from when it got there, not when it was taken.
      const live = liveSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => inLineNow([c], nowMs) === 1 && c.inLine !== true)
        .sort((a: any, c: any) => String(a.hereAt || a.arrivedAt).localeCompare(String(c.hereAt || c.arrivedAt)));
      const newest = (xs: any[], when: (c: any) => unknown) => xs.sort((a, c) => ageOf(when(a)) - ageOf(when(c)))[0] || null;
      let pick: { car: any; mode: 'pay' | 'paid' | 'forward' | 'thanks' } | null = null;
      // The car the reader is asking for (or just asked for) is the one at the window, whichever is first in the lane.
      const atWindow = live.filter((c: any) => (at === 'pickup' ? false : c.stage === 'pay') && ID.test(String(c.orderId || ''))).slice(0, 6);
      const cardOf = new Map<string, string>();
      if (atWindow.length) {
        const snaps: any[] = await db.getAll(...atWindow.map((c: any) => db.doc(`${T}/counterOrders/${c.orderId}`)));
        // (A card being started counts for a minute, a decline for half a minute: as long as the screen would show them.)
        atWindow.forEach((c: any, k: number) => {
          const cd: any = snaps[k]?.data?.()?.card || {}; const st = String(cd.state || '');
          if (st === 'on_reader' || st === 'capturing' || (st === 'starting' && ageOf(cd.at) < 60000) || (st === 'declined' && ageOf(cd.failedAt) < 30000)) cardOf.set(c.id, st);
        });
      }
      const paying = atWindow.find((c: any) => cardOf.has(c.id) && cardOf.get(c.id) !== 'declined') || atWindow.find((c: any) => cardOf.has(c.id)) || null;
      if (at === 'pay') {
        const justPaid = newest(live.filter((c: any) => (c.stage === 'pickup' || c.stage === 'forward') && ageOf(c.stageAt?.pickup) < 12000), (c) => c.stageAt?.pickup);
        const first = paying || live.find((c: any) => c.stage === 'pay');
        pick = justPaid && !paying ? { car: justPaid, mode: 'paid' } : first ? { car: first, mode: 'pay' } : null;
      } else {
        // Only a car parked or handed over straight from the window: one brought out to its spot isn't at the window.
        const parked = newest(live.filter((c: any) => c.stage === 'forward' && ageOf(c.stageAt?.forward) < 20000), (c) => c.stageAt?.forward);
        const handed = newest(goneSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => !c.left && !c.voided && c.inLine !== true && !c.stageAt?.forward && ageOf(c.goneAt) < 8000), (c) => c.goneAt);
        const first = paying || live.find((c: any) => (at === 'one' ? c.stage === 'pay' || c.stage === 'pickup' : c.stage === 'pickup'));
        pick = parked ? { car: parked, mode: 'forward' } : handed ? { car: handed, mode: 'thanks' } : first ? { car: first, mode: first.stage === 'pay' ? 'pay' : 'paid' } : null;
      }
      const o: any = pick && ID.test(String(pick.car.orderId || '')) ? (await db.doc(`${T}/counterOrders/${pick.car.orderId}`).get()).data() : null;
      let kitchen: 'making' | 'ready' | null = null;
      if (o && pick && pick.mode === 'paid') {
        const mine = (await db.collection(`${T}/kdsTickets`).where('orderId', '==', String(pick.car.orderId)).get()).docs.map((d: any) => d.data() || {}).filter((t: any) => t.status !== 'cancelled');
        kitchen = mine.length && !mine.some((t: any) => t.status === 'pending' || t.status === 'in_progress') ? 'ready' : 'making';
      }
      // An order that was cancelled or voided never shows.
      const shown = o && pick && !['cancelled', 'voided', 'building'].includes(String(o.status)) ? pick : null;
      const card = shown && o.card && !o.paidAt ? (o.card.state === 'on_reader' || o.card.state === 'starting' || o.card.state === 'capturing' ? 'on_reader' : o.card.state === 'declined' && ageOf(o.card.failedAt) < 30000 ? 'declined' : null) : null;
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' },
        show: shown ? { mode: shown.mode === 'pay' && o.paidAt ? 'paid' : shown.mode, number: o.number, name: cleanName(o.guestName) || null, spot: shown.mode === 'forward' ? (shown.car.spot || null) : null,
          // The items and money only while they're paying (a car told where to go, or thanked, doesn't need them).
          lines: shown.mode === 'pay' || shown.mode === 'paid' ? (o.lines || []).map((l: any) => ({ name: l.name, quantity: l.quantity, choicesText: l.choicesText || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: photoOf(l) })) : [],
          subtotal: shown.mode === 'pay' || shown.mode === 'paid' ? num(o.subtotal) : 0, tax: shown.mode === 'pay' || shown.mode === 'paid' ? num(o.tax) : 0, total: shown.mode === 'pay' || shown.mode === 'paid' ? num(o.total) : 0, paid: !!o.paidAt, payMethod: o.paidAt ? (o.payMethod || null) : null,
          // Change for cash, while the car is still likely at the window.
          change: o.paidAt && o.payMethod === 'cash' && num(o.changeGiven) > 0 && ageOf(o.paidAt) < 60000 ? num(o.changeGiven) : null,
          card, cardMessage: card === 'declined' ? String(o.card.failed || '') || null : null, kitchen, nextWindow: at === 'pay',
          // Scan to pay: the code, while the team has it up (10 minutes) and the order isn't paid.
          payUrl: shown.mode === 'pay' && !o.paidAt && o.phone?.shownAt && ageOf(o.phone.shownAt) < 10 * 60000 && phoneSig(tenantId, String(pick!.car.orderId))
            ? `${linkOrigin(tenant, req.nextUrl.origin).replace(/\/+$/, '')}/drive-thru/${encodeURIComponent(tenantId)}/pay?o=${encodeURIComponent(String(pick!.car.orderId))}&s=${phoneSig(tenantId, String(pick!.car.orderId))}` : null } : null,
        // Whether the guest's phone offers Apple Pay or Google Pay (said beside the code; lib/wallet-domains).
        wallets: walletsOn(tenant, linkOrigin(tenant, req.nextUrl.origin)),
        now: nowIso,
      });
    }

    if (action === 'readers') {
      const r: any = await listReaders(tenantId, tenant);
      return r.error ? bad(r.error, 503) : ok({ readers: r.rows, payments: r.payments, staffOk });
    }

    // Anything that changes today's numbers lets them be worked out again on the next read.
    if (['car', 'move', 'cancel', 'void'].includes(action)) statsCache.delete(tenantId);

    // Rewards: the guest's phone number puts the order in their name (they join only when they say yes); paid already,
    // it earns now (lib/counter-points).
    if (action === 'points') {
      const r: any = await linkOrder(db, tenantId, tenant, String(b.orderId || ''), { phone: b.phone, join: b.join === true, name: b.name }, who.name);
      // (Not in the program yet: the lane asks them in its own sheet, so no message across the bottom too.)
      return r.ok ? ok({ earned: r.earned || 0, balance: r.balance ?? null, unit: r.unit || 'points', already: !!r.already, staffOk })
        : NextResponse.json({ ok: false, error: r.error, code: r.code || null, quiet: r.code === 'not_found' || r.code === 'not_member', staffOk }, { status: r.status });
    }
    // "I ordered ahead, code 4821": the order placed ahead becomes this car's (or a new car's), straight to pickup.
    if (action === 'aheadCar') {
      const r: any = await aheadToCar(db, tenantId, tenant, { orderId: b.orderId, code: b.code, carId: b.carId }, who);
      statsCache.delete(tenantId);
      return r.ok ? ok({ carId: r.carId, number: r.number, name: r.name, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    if (action === 'car') { const c = await createCar(db, tenantId, tenant, b.carKey, who, { inLine: b.inLine === true, looks: cleanLooks(b.looks) }); statsCache.delete(tenantId); return ok({ ...c, staffOk }); }

    if (action === 'looks') {
      const carId = String(b.carId || ''); if (!ID.test(carId)) return bad('Which car?');
      const carRef = db.doc(`${T}/driveThruCars/${carId}`); const looks = cleanLooks(b.looks);
      const r: any = await db.runTransaction(async (tx: any) => {
        const car: any = (await tx.get(carRef)).data(); if (!car || car.stage === 'gone') return { error: 'That car isn’t in the lane.', status: 404 };
        tx.set(carRef, { looks: looks || null }, { merge: true }); return { ok: true };
      });
      return r.error ? bad(r.error, r.status) : ok({ looks, staffOk });
    }

    if (action === 'here') {
      const carId = String(b.carId || ''); if (!ID.test(carId)) return bad('Which car?');
      const carRef = db.doc(`${T}/driveThruCars/${carId}`);
      const r: any = await db.runTransaction(async (tx: any) => {
        const car: any = (await tx.get(carRef)).data(); if (!car || car.stage === 'gone') return { error: 'That car isn’t in the lane.', status: 404 };
        if (car.inLine !== true) return { ok: true, already: true };
        // Only once its order is with the kitchen: one still being taken in line stays with the person taking it (the
        // speaker would greet it otherwise).
        if (car.stage !== 'pay' && car.stage !== 'pickup') return { error: 'That car’s order is still being taken in line.', status: 409 };
        tx.set(carRef, { inLine: false, wasInLine: true, hereAt: nowIso }, { merge: true }); return { ok: true };
      });
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, staffOk });
    }

    if (action === 'pouch' || action === 'handIn') {
      // Only for someone signed in with their PIN: the cash is theirs to hand in. What they haven't handed in yet, from
      // whichever day.
      if (!staff?.id) return action === 'handIn' ? NextResponse.json({ ok: false, needsStaff: true, error: 'Enter your PIN first, so it’s your pouch that’s handed in.', staffOk }, { status: 403 }) : ok({ name: null, total: 0, count: 0, staffOk });
      // (Up to 400 orders a hand-in, so one step stays within what the database takes at once; any more, hand in again.)
      const q = db.collection(`${T}/counterOrders`).where('cashWithId', '==', String(staff.id)).where('pouchOpen', '==', true).limit(400);
      if (action === 'pouch') {
        const mine = (await q.get()).docs.map((d: any) => d.data() || {});
        return ok({ name: staff.name, total: Math.round(mine.reduce((n: number, o: any) => n + num(o.total), 0) * 100) / 100, count: mine.length, staffOk });
      }
      // Handed in: all of it into the one drawer that's open, in one step (two open, or none: it waits).
      const r: any = await db.runTransaction(async (tx: any) => {
        const [mine, till] = await Promise.all([tx.get(q), tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))]);
        if (till.docs.length !== 1) return { error: till.docs.length ? 'Two drawers are open. Close one, then hand it in.' : 'Open the drawer first, then hand it in.', status: 409 };
        const total = Math.round(mine.docs.reduce((n: number, d: any) => n + num((d.data() || {}).total), 0) * 100) / 100;
        if (!mine.docs.length) return { ok: true, total: 0, count: 0 };
        tx.set(till.docs[0].ref, { expectedCash: FieldValue.increment(total), totalCashSales: FieldValue.increment(total) }, { merge: true });
        for (const d of mine.docs) tx.set(d.ref, { pouchOpen: false, pouchHandedAt: nowIso, pouchHandedTo: till.docs[0].id, tillId: till.docs[0].id }, { merge: true });
        return { ok: true, total, count: mine.docs.length, more: mine.docs.length === 400 };
      });
      return r.error ? bad(r.error, r.status) : ok({ handedIn: r.total, count: r.count, more: !!r.more, staffOk });
    }

    if (action === 'move') {
      const carId = String(b.carId || ''); const to = String(b.to || '') as Stage;
      if (!ID.test(carId) || !STAGES.includes(to) || to === 'speaker') return bad('Where to?');
      const carRef = db.doc(`${T}/driveThruCars/${carId}`);
      const r: any = await db.runTransaction(async (tx: any) => {
        const car: any = (await tx.get(carRef)).data(); if (!car) return { error: 'That car isn’t in the lane.', status: 404 };
        const order: any = car.orderId ? (await tx.get(db.doc(`${T}/counterOrders/${car.orderId}`))).data() : null;
        const tix = to === 'gone' && car.orderId ? (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', car.orderId))).docs : [];
        const parked = to === 'forward' && b.spot !== undefined && b.spot !== null ? (await tx.get(db.collection(`${T}/driveThruCars`).where('stage', '==', 'forward').limit(30))).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })) : [];
        if (car.stage === 'gone') return { already: true };
        // Only ever forward (a tap on an old screen never puts a car back, or spoils its times).
        if (STAGES.indexOf(to) <= STAGES.indexOf(car.stage)) return { already: true };
        if (to === 'gone' && order && order.status !== 'building' && !order.paidAt) return { error: 'Take payment first. If they drove off, void the order.', status: 409 };
        if ((to === 'pickup' || to === 'forward') && order && !order.paidAt) return { error: 'Take payment first.', status: 409 };
        // A spot is one of the business's own numbered spots (Menu page), and free; or none at all.
        const asked = to === 'forward' && b.spot !== undefined && b.spot !== null && String(b.spot) !== '' ? String(b.spot) : null;
        if (asked !== null && !(/^[1-8]$/.test(asked) && Number(asked) <= spotsOf(tenant))) return { error: 'That spot isn’t there anymore. Pick another.', status: 409 };
        // (A car left parked from hours ago doesn't hold its spot: the same three hours that make a line "now".)
        if (asked !== null) { const there = parked.find((p: any) => p.id !== carId && String(p.spot || '') === asked && inLineNow([p], now.getTime()) === 1); if (there) return { error: `Spot ${asked} has car ${there.number}. Pick another.`, status: 409 }; }
        const spot = to === 'forward' ? asked : undefined;
        tx.set(carRef, { stage: to, stageAt: { ...(car.stageAt || {}), [to]: nowIso }, ...(to === 'gone' ? { goneAt: nowIso, handedBy: by } : {}), ...(to === 'gone' && (!order || order.status === 'building') ? { left: true } : {}), ...(spot !== undefined ? { spot } : {}) }, { merge: true });
        if (to === 'gone' && order) {
          tx.set(db.doc(`${T}/counterOrders/${car.orderId}`), { status: order.status === 'building' ? 'cancelled' : 'done', doneAt: nowIso }, { merge: true });
          // Handed over: whatever the kitchen hadn't marked served is now.
          for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name: by, via: 'lane' } }, { merge: true }); }
        }
        return { ok: true };
      });
      statsCache.delete(tenantId);   // again once it's done, so a read in between never keeps the old numbers
      // Handed over or gone: the voice assistant (if it's still on with this car) hangs up.
      if (!r.error && to === 'gone') await stopCarCall(db, tenantId, carId, 'car gone');
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, staffOk });
    }

    const orderId = String(b.orderId || ''); if (!ID.test(orderId)) return bad('Which order?');
    const orderRef = db.doc(`${T}/counterOrders/${orderId}`);

    if (action === 'add' || action === 'remove' || action === 'qty') {
      const r: any = await editOrder(db, tenantId, tenant, orderId, action === 'add' ? { action, itemId: String(b.itemId || ''), quantity: b.quantity, choices: b.choices, tapKey: b.tapKey }
        : action === 'remove' ? { action, lineId: String(b.lineId || ''), tapKey: b.tapKey } : { action, lineId: String(b.lineId || ''), quantity: b.quantity, tapKey: b.tapKey });
      return r.error ? bad(r.error, r.status) : ok({ order: r.order, staffOk });
    }

    if (action === 'name') {
      const r: any = await setOrderName(db, tenantId, orderId, b.name);
      return r.error ? bad(r.error, r.status) : ok({ name: r.name, staffOk });
    }

    if (action === 'card' || action === 'cardCheck' || action === 'cardStop') {
      const r: any = action === 'card' ? await startCard(db, tenantId, tenant, orderId, String(b.readerId || ''), by)
        : action === 'cardCheck' ? await checkCard(db, tenantId, tenant, orderId, by) : await stopCard(db, tenantId, tenant, orderId, by);
      if (r.ok && r.state === 'paid' && !r.already) statsCache.delete(tenantId);
      return r.ok ? ok({ state: r.state, message: r.message || null, already: !!r.already, payMethod: r.payMethod || null, justWent: !!r.justWent, notKept: !!r.notKept, voided: !!r.voided, wrongAmount: !!r.wrongAmount, staffOk })
        : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }

    if (action === 'phoneLink') {
      const r: any = await phoneLink(db, tenantId, tenant, orderId, linkOrigin(tenant, req.nextUrl.origin), by);
      return r.ok ? ok({ url: r.url, wallets: !!r.wallets, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    if (action === 'phoneCheck') {
      const r: any = await checkPhone(db, tenantId, tenant, orderId);
      if (r.ok && r.paid) statsCache.delete(tenantId);
      return r.ok ? ok({ paid: !!r.paid, viaPhone: !!r.viaPhone, payMethod: r.payMethod || null, staffOk }) : NextResponse.json({ ok: false, error: r.error, staffOk }, { status: r.status });
    }

    if (action === 'cardTest') {
      // Only on a test reader (the card company's own pretend one): never on a real reader, and never with real money.
      const acct = accountOf(tenant); const stripe = readerStripe(); const o: any = (await orderRef.get()).data();
      const readerId = String(o?.card?.readerId || '');
      if (!acct || !stripe || !o?.card?.id || o.card.state !== 'on_reader' || !/^tmr_[A-Za-z0-9]{4,60}$/.test(readerId)) return bad('Send the order to the test reader first.', 409);
      try {
        const rd: any = await stripe.terminal.readers.retrieve(readerId, {}, { stripeAccount: acct });
        if (rd?.device_type !== 'simulated_wisepos_e') return bad('That only works on a test reader.', 409);
        await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId, {}, { stripeAccount: acct });
      } catch { return bad('The test card didn’t go through. Try again.', 503); }
      return ok({ staffOk });
    }

    if (action === 'cancel') {
      const r: any = await db.runTransaction(async (tx: any) => {
        const o: any = (await tx.get(orderRef)).data(); if (!o) return { error: 'That order is gone.', status: 404 };
        const car: any = o.carId ? (await tx.get(db.doc(`${T}/driveThruCars/${o.carId}`))).data() : null;
        if (o.status === 'cancelled') return { ok: true };
        if (o.status !== 'building') return { error: 'That order has gone to the kitchen. If they drove off, void it.', status: 409 };
        tx.set(orderRef, { status: 'cancelled', cancelledAt: nowIso, cancelledBy: by }, { merge: true });
        if (car && car.stage !== 'gone') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'gone', goneAt: nowIso, left: true, stageAt: { ...(car.stageAt || {}), gone: nowIso } }, { merge: true });
        return { ok: true, carId: o.carId || null };
      });
      statsCache.delete(tenantId);
      if (!r.error && r.carId) await stopCarCall(db, tenantId, String(r.carId), 'car left');
      return r.error ? bad(r.error, r.status) : ok({ staffOk });
    }

    if (action === 'send') {
      const r: any = await sendOrder(db, tenantId, tenant, orderId, who);
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, dueAt: r.due || null, staffOk });
    }

    if (action === 'void') {
      // A manager only: their PIN on this screen, or signed in on their own device as one.
      let manager = false;
      if (staff) manager = await isManager(db, tenantId, staff.id);
      if (!manager) return NextResponse.json({ ok: false, needsManager: true, error: 'A manager’s PIN is needed to void an order.', staffOk }, { status: 403 });
      const reason = String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!reason) return bad('Why is it being voided?');
      const r: any = await voidOrder(db, tenantId, orderId, reason, who);
      statsCache.delete(tenantId);
      if (!r.error) {
        const vo: any = (await orderRef.get()).data() || {}; const carId = String(vo.carId || '');
        if (ID.test(carId)) await stopCarCall(db, tenantId, carId, 'voided');
        // A card payment started for it (declined, or left) is called off, so it can never go through later.
        if (vo.card?.id && !['stopped', 'paid'].includes(String(vo.card.state))) await stopCard(db, tenantId, tenant, orderId, who.name).catch(() => null);
        // …and so is one on the guest's phone.
        await stopPhone(db, tenantId, tenant, orderId).catch(() => null);
      }
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, returned: r.returned, wasted: r.wasted, staffOk });
    }

    // paid (cash, or a card machine of the business's own): lib/counter-server payOrder. A card payment the window's
    // reader started for it and that isn't needed now is called off, so it can never go through later.
    const method = b.method === 'cash' ? 'cash' : b.method === 'card' ? 'card' : null; if (!method) return bad('Card or cash?');
    // Cash into the pouch of the person taking orders in line: theirs, so they're signed in with their PIN.
    const pouch = method === 'cash' && b.pouch === true;
    if (pouch && !staff?.id) return NextResponse.json({ ok: false, needsStaff: true, error: 'Enter your PIN first, so the cash is counted as yours.', staffOk }, { status: 403 });
    const r: any = await payOrder(db, tenantId, orderId, { method, tendered: b.tendered, by, byId: staff?.id || null, pouch, day: todayIn(tz, now) });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    if (r.cardId) await stopCard(db, tenantId, tenant, orderId, by).catch(() => null);
    // A phone payment the guest had open is called off too (or given back, if they paid at that very moment).
    if (!r.already) await stopPhone(db, tenantId, tenant, orderId).catch(() => null);
    return ok({ already: !!r.already, inDrawer: r.drawer ?? null, inPouch: !!r.pouch, change: r.change ?? null, payMethod: r.payMethod || null, staffOk });
  } catch (e: any) {
    console.error('[counter] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}

/** Someone a manager here (their own team record says so). */
async function isManager(db: any, tenantId: string, staffId: string | null): Promise<boolean> {
  if (!staffId || !ID.test(staffId)) return false;
  const [st, t] = await Promise.all([db.doc(`tenants/${tenantId}/staff/${staffId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const s: any = st.data() || {}; const tn: any = t.data() || {};
  if (s.isActive === false || s.archived === true || s.status === 'archived') return false;
  return MANAGER_ROLES.includes(String(s.role || '')) || s.isManager === true || (tn.ownerId && tn.ownerId === staffId);
}
