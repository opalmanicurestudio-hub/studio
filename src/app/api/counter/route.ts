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
//   add    { tenantId, key, orderId, itemId, quantity?, choices?, tapKey?, offer?, weight? } → a line, priced from the menu (the
//                                                      same tapKey twice adds it once); offer 'item': taken from what
//                                                      the last thing added offers (components/menu/OfferAsk)
//   takeOff { tenantId, key, orderId, lineId, qty, pin? } → some or all of one line off an order the kitchen has,
//                                                      before it's paid (lib/counter-takeoff-server): its stock back
//                                                      when the kitchen hadn't started it, a manager's when it had
//   drawer { tenantId, key, kind: 'out'|'in'|'drop', cents, note, moveKey, receiptUrl?, pin? } → cash in or out of the open
//                                                      drawer (lib/drawer-moves-server), a manager's; drawerView: what
//                                                      should be in it; drawerUndo { moveKey, pin? }: one undone
//   comp   { tenantId, key, orderId, lineId, qty, reason, pin? } → some or all of a line on the house, a manager's, with
//                                                      why (lib/counter-comp-server); uncomp { …, lineId } its price again
//   giftCard { tenantId, key, orderId, cents, to?, via: print|text|email, phone?, email?, tapKey? } → a gift card sold
//                                                      with the order (lib/counter-gift): made and sent once it's paid;
//                                                      giftIssue { …, orderId }: the ones not made yet, made now
//   price  { tenantId, key, orderId, lineId, qty, price, reason, pin? } → some or all of a line at a different price
//                                                      (lib/counter-price-server), lower a manager's; priceBack { …, lineId }
//   noSale { tenantId, key, reason, moveKey, printerId? } → the drawer opened with no sale, on its record by who and why
//   oneOff { tenantId, key, orderId, name, price, quantity?, taxed?, tapKey? } → something not on the menu, up to the
//                                                      business's amount (lib/counter-oneoff): no kitchen, no stock
//   sizeUp { tenantId, key, orderId, lineId, quantity?, tapKey? } → that many of the line in the next size up, when its
//                                                      item offers one (lib/menu-upgrades), priced from the menu
//   remove { tenantId, key, orderId, lineId, tapKey? }  ·  qty { tenantId, key, orderId, lineId, quantity, tapKey? }
//   send   { tenantId, key, orderId, toGo? }        → to the kitchen: one ticket a line, due by the channel's target
//                                                      (the drive-thru's is the tightest); stock and recipe parts once;
//                                                      at the counter, toGo says it's to go, and what goes out with it
//                                                      follows (lib/plate-extras)
//   staffMeal { tenantId, key, orderId, for, pin? } → a sent order settled as a staff meal for a named member of the
//          team: no money, left out of the night's sales, counted apart on the food cost report (lib/counter-server
//          staffMeal); a manager's to ring in (signed in or working here as one, else their PIN), and never undone
//   paid   { tenantId, key, orderId, method: 'card'|'cash', tendered? } → paid at the window: the sale and its tax in
//                                                      the books, cash into the open drawer (with what was handed over
//                                                      and the change); the car moves on to pick up
//   tip    { tenantId, key, orderId, cents } → the guest's tip on a sent, unpaid order (when the business takes tips
//          here: lib/counter-money), into its total; 0 takes it off
//   discount { tenantId, key, orderId, discountId? | custom: { kind: 'pct'|'off', value, reason }, pin? } → one of the
//          business's discounts, or another amount a manager okays (signed in or working here as one, else their PIN);
//          neither takes it off
//   tender { tenantId, key, orderId, do: 'gift'|'credit'|'remove', code?, giftCardId? } → a gift card (by its code, held
//          on the card) or the guest's store credit set aside for what's left, or one taken off; paid { method: 'tender' }
//          finishes an order they cover all of
//   receipt { tenantId, key, orderId, do: 'link'|'print'|'drawer'|'send', printerId?, drawer?, channel?, to? } → a paid
//          order's receipt (lib/receipt-actions-server): its private link, printed, the cash drawer for cash taken into
//          it, or sent by text or email
//   move   { tenantId, key, carId, to: 'pickup'|'forward'|'gone', spot? } → along the lane, only ever forward;
//                                                      "forward" parks it (a numbered spot) so the cars behind keep
//                                                      moving; "gone" hands it over (paid, or never sent)
//   name   { tenantId, key, orderId, name }         → the guest's first name on the order (and its kitchen tickets), or
//                                                      none; the board, the window and the bag call them by it
//   readyText { tenantId, key, orderId, phone | null } → a counter or kiosk order: one text to the guest when it's all
//                                                      ready, if they asked (lib/ready-text); null: don't text
//   appStart { tenantId, carKey }                    → the counter: a new order from a delivery app (lib/app-orders-server)
//   appSend  { tenantId, orderId, app, code, courierIn } → to the kitchen to go with the app's code, ready for the courier,
//                                                      with a spot on the pickup shelf; paid on the app (in the books when
//                                                      it's handed to the courier: move gone)
//   appCode { tenantId, orderId, app, code }        → the code (or app) on a sent app order, fixed
//   appCancel { tenantId, orderId, pin? }            → cancelled on the app before it was picked up: voided (a manager's
//                                                      okay once the kitchen started on it)
//   car    { tenantId, key, carKey, inLine?, looks?, lane? } → a new car (taken in line before the speaker: never greeted at the
//                                                      speaker or shown on its board; told apart by how it looks)
//   looks  { tenantId, key, carId, looks }          → how a car looks ("Red SUV"), or none
//   merged { tenantId, key, carId }                → two lanes that merge (lib/drive-lanes): this car merged first
//   lineClear { tenantId, key, lane? }             → nobody waiting to order before the speaker (lib/lane-entry-server)
//   deliveryOut / deliveryDone / deliveryFailed { tenantId, orderId, driverId? | driver?, why? } → the counter: hot food out with a driver,
//                                                      delivered, or couldn't be (lib/food-delivery-server)
//   deliveryRefund { tenantId, orderId, fee?, pin? } → one that couldn't be delivered (or a pickup never collected),
//                                                      refunded to the card in one step; a manager's (lib/food-delivery-settle-server)
//   deliveryHanded / deliveryOwed { tenantId, orderId } → picked up instead: handed over; what didn't go back yet, sent again
//   laterCancel { tenantId, orderId, pin? }         → an order for another day, canceled before it goes to the kitchen: every
//                                                      line back to the card; a manager's (lib/ahead-days-server)
//   laterSend { tenantId, orderId }                 → an order for another day, on its day: to the kitchen now (one that
//                                                      couldn't go by itself, once what stopped it is fixed)
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
//   readyBoard { tenantId, key }                  → the ready board by the counter (its own display-only key, like the
//                                                      board): orders being made and ready to collect, by number and
//                                                      first name (lib/ready-board)
//   window { tenantId, key, at: 'pay'|'pickup'|'one' } → the screen facing the guest at a window (its own display-only key,
//                                                      like the board): the car there, its order and total, how paying is
//                                                      going, and where to go next
//   cancel { tenantId, key, orderId }               → an order not sent yet, dropped (the car leaves the lane; one with
//                                                      an order placed ahead going with it carries on to pickup)
//   aheadCar { tenantId, key, code? | orderId?, carId? } → "I ordered ahead": the order placed ahead goes with the car at
//                                                      the speaker (they can add to it, paid at the window), or a new
//                                                      car is made for it, straight to pickup (lib/counter-ahead)
//   aheadDone { tenantId, key, carId }              → "Nothing else": that car goes on to pickup with its order placed
//                                                      ahead (its own empty order let go)
//   call   { tenantId, carId }                      → the counter called a ready order out: when, and how many times
//   (A team member signed in sends channel: 'counter' for the counter's own line of guests, numbered "C14".)
//   void   { tenantId, key, orderId, reason, staffPass? } → a sent order that won't be paid (the car drove off), by a
//                                                      manager (their PIN, or signed in): lib/counter-server voidOrder
// Part of Lounge & hospitality: closed while it isn't part of the plan (lib/tool-lock).
import { bizLocationsOf, hereFor, zonedHere } from '@/lib/here-server';
import { atHere } from '@/lib/business-locations';
import { tileSetupOf } from '@/lib/register-tiles';
import { daypartNow, daypartsNow, happyHourOf, inHappyHour, nextDaypart, priceNow, servedNow, timeWords } from '@/lib/menu-time';
import { spanishOf } from '@/lib/guest-lang';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { accessLockOf } from '@/lib/tenant-access';
import { toolLocked } from '@/lib/tool-lock';
import { screenOf, teamInstead, workingNow } from '@/lib/screen-keys';
import { readMenu } from '@/lib/menu-server';
import { targetsOf, photoOf, spotsOf, pickupOnlyOf, carryOn, RUSH_CARS, inLineNow, CHANNEL_NAME, atDriveThru, counterSide, type Channel } from '@/lib/counter-orders';
import { createCar, editOrder, sendOrder, voidOrder, setOrderName, cleanName, payOrder, staffMeal, setAllergy } from '@/lib/counter-server';
import { cleanLooks } from '@/lib/counter-orders';
import { FieldValue } from 'firebase-admin/firestore';
import { listReaders, startCard, checkCard, stopCard } from '@/lib/counter-card';
import { phoneLink, checkPhone, stopPhone, phoneSig } from '@/lib/counter-phone';
import { walletsOn } from '@/lib/wallet-domains';
import { aheadForLane, aheadToCar, aheadNothingMore, aheadOf } from '@/lib/counter-ahead';
import { readyBoardOf, onReadyBoard, BOARD_CHANNELS, LIVE_TICKETS, MAX_MAKING, MAX_READY } from '@/lib/ready-board';
import { askReadyText, readyTextView, readyTextsOn, textIfReady } from '@/lib/ready-text';
import { takeOffSent } from '@/lib/counter-takeoff-server';
import { compLine, uncompLine } from '@/lib/counter-comp-server';
import { drawerMove, drawerUndo, drawerView, drawerNoSale } from '@/lib/drawer-moves-server';
import { priceLine, priceBack } from '@/lib/counter-price-server';
import { pointsOn, linkOrder, linkByCode, rewardsOn, useReward } from '@/lib/counter-points';
import { loyaltyOf } from '@/lib/loyalty';
import { codesOn } from '@/lib/rewards-code';
import { pageAccent } from '@/lib/studio-page';
import { menuNumbers } from '@/lib/menu-numbers';
import { extrasOf } from '@/lib/plate-extras';
import { logAuditAdmin } from '@/lib/audit';
import { rulesOf, needFor, needWords, type RuleKey } from '@/lib/money-rules';
import { okayFor } from '@/lib/money-rules-server';
import { logMoney } from '@/lib/activity-server';
import type { ActivityWhere } from '@/lib/activity';
import { managerFor } from '@/lib/manager-pin';
import { bagsWaiting, labelPrinter, printLabels, scanBag, waitingWords } from '@/lib/food-bags-server';
import { bagsLeft, bagsOf, defaultBags } from '@/lib/food-bags';
import { readWindow, boardNumbers } from '@/lib/pickup-window';
import { moduleEnabled } from '@/lib/modules';
import { linkOrigin } from '@/lib/app-origin';
import { accountOf, readerStripe } from '@/lib/reader-sale';
import { stopCarCall } from '@/lib/drive-thru-voice';
import { lanesOf, laneOf, cleanLane, mergeAsk, mergeFirst, paidFirst, windowKey, byWindow, forLaneScreen } from '@/lib/drive-lanes';
import { lineNow, lineClear, forgetLine } from '@/lib/lane-entry-server';
import { forgetLive } from '@/lib/drive-live-server';
import { handOverInTx } from '@/lib/counter-handover';
import { checkLongWaits } from '@/lib/speed-server';
import { forgetBoard } from '@/lib/scoreboard-server';
import { earlyModeOf } from '@/lib/lane-entry';
import { foodDeliveryOf } from '@/lib/food-delivery';
import { deliveriesToday, deliveryOut, deliveryEnd, foodDrivers } from '@/lib/food-delivery-server';
import { pickupHanded, sendOwed, settleFailed } from '@/lib/food-delivery-settle-server';
import { cancelLater, comingUp, releaseOne } from '@/lib/ahead-days-server';
import { appSoldOutTodo, appOrdersOf, appName } from '@/lib/app-orders';
import { appSend, appCode, appCancel } from '@/lib/app-orders-server';
import { allergyWords, orderAllergyOf } from '@/lib/order-allergy';
import { deliveryNowOf, EXTRA_CHOICES, PAUSE_CHOICES } from '@/lib/driver-load';
import { driverLoad } from '@/lib/driver-load-server';
import { nightBounds, tonight } from '@/lib/night-close-server';
import { printersCached } from '@/lib/printing-server';
import { receiptAfterOf } from '@/lib/printing';
import { tipsOf, tipsHere, tipChoices, discountsOf, tendersOf, dueCentsOf, codeEnd, sharesPaidOf, tipBaseOf, giftCentsOf } from '@/lib/counter-money';
import { oneOffMaxOf } from '@/lib/counter-oneoff';
import { issueCounterGifts, giftsOpenOf } from '@/lib/counter-gift-server';
import { shopSettings } from '@/lib/gift-designs';
import { setTip, setDiscount, addTender, removeTender } from '@/lib/counter-money-server';
import { ticketFrom, needsAllergyNote } from '@/lib/kitchen';
import { staffIdForLogin } from '@/lib/owner-staff';
import { startOfDay, todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { takePart, undoPart, setSplit } from '@/lib/counter-split-server';
import { previewRefund, refundCounterOrder, cleanAsk } from '@/lib/counter-refund-server';
import { refundLeftOf, cantRefund, unitsLeftOf } from '@/lib/counter-refund';
import { scanToOrder, codeOnItem } from '@/lib/counter-scan-server';
import { cardBusy as cardBusyOf } from '@/lib/counter-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const STAGES = ['speaker', 'pay', 'pickup', 'forward', 'gone'] as const;
type Stage = typeof STAGES[number];
const LIVE: Stage[] = ['speaker', 'pay', 'pickup', 'forward'];
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Today's lane numbers, worked out at most every 20 seconds a business (every tablet polls every 2), not on every read.
const statsCache = new Map<string, { at: number; stats: any }>();
// (Kept a business and a line of guests: the drive-thru's and the counter's.)
// (Each channel's, at each location: lib/here-server.)
// (A car moved: the day's times and Drive-thru live are read afresh on this server.)
const forgetStats = (tenantId: string) => { for (const k of Array.from(statsCache.keys())) if (k.startsWith(`${tenantId}|`)) statsCache.delete(k); forgetLive(tenantId); forgetBoard(tenantId); };

// The ready board, per business, for a few seconds (api 'readyBoard'): however many TVs show it.
const readyCache = new Map<string, { at: number; body: any }>();
// The menu board's menu, per business, for a few seconds (api 'menuBoard').
const menuBoardCache = new Map<string, { at: number; sections: { name: string; items: any[] }[]; popular: Set<string>; popularAt: number }>();

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['lane', 'board', 'window', 'car', 'add', 'oneOff', 'sizeUp', 'remove', 'qty', 'note', 'allergy', 'name', 'send', 'scan', 'codeOn', 'show', 'guest', 'guestTip', 'paid', 'move', 'cancel', 'void', 'takeOff', 'comp', 'uncomp', 'drawer', 'drawerView', 'drawerUndo', 'giftCard', 'giftIssue', 'price', 'priceBack', 'noSale', 'readers', 'card', 'cardCheck', 'cardStop', 'cardTest', 'looks', 'pouch', 'here', 'handIn', 'phoneLink', 'phoneCheck', 'aheadCar', 'aheadDone', 'menuBoard', 'readyBoard', 'points', 'rewardsCode', 'rewards', 'reward', 'call', 'staffMeal', 'readyText', 'merged', 'lineClear', 'deliveryOut', 'deliveryDone', 'deliveryFailed', 'deliveryRefund', 'deliveryHanded', 'deliveryOwed', 'deliverySlow', 'appSoldOut', 'appStart', 'appSend', 'appCode', 'appCancel', 'laterCancel', 'laterSend', 'receipt', 'tip', 'discount', 'tender', 'part', 'partUndo', 'split', 'refund', 'refundPreview', 'paidToday', 'bags', 'bagScan'].includes(action)) return bad('Unknown action.');
    const db = getAdminDb(); const T = `tenants/${tenantId}`;

    let screen: any = await screenOf(db, tenantId, b.key);
    let member: { id: string; name: string } | null = null;
    if (!screen && !b.key && action !== 'board' && action !== 'window') {
      const t: any = await teamInstead(req, db, tenantId);
      if (t.deny) return t.deny;
      if (t.renter) return bad('This is for the business’s own team.', 403);
      member = t.member; screen = { ref: null, name: member!.name, kind: b.channel === 'counter' ? 'counter' : 'drive-thru', passes: {} };
    }
    if (!screen) {
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This screen isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }
    // Only a lane screen takes orders and payments here; a screen guests can see (the order board by the speaker, the
    // screen at the window) has a key that only shows. A kitchen or floor screen's key does nothing here.
    if (screen.ref && !(screen.kind === 'drive-thru' || (screen.kind === 'drive-thru-board' && (action === 'board' || action === 'window' || action === 'menuBoard' || action === 'readyBoard' || ((action === 'guest' || action === 'guestTip') && (screen as any).guest === true))))) return bad('This screen isn’t set up for the drive-thru. A manager can set it up here.', 401);
    // The counter's own screen (app/(app)/counter, a team member signed in) takes its orders the same way, as counter
    // orders ("C14"), with its own line of guests (lib/counter-server createCar channel).
    const channel: Channel = screen.kind === 'counter' ? 'counter' : 'drive-thru';
    if (action === 'window' && screen.kind !== 'drive-thru-board') return bad('This screen isn’t set up for the window. A manager can set it up here.', 401);
    let tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'The lane screen is closed for now. The business owner can tell you more.' }, { status: 403 });
    // Handing over, taking payment for, or voiding an order already taken still works if the plan changes mid-service.
    if (!['paid', 'receipt', 'tip', 'discount', 'tender', 'part', 'partUndo', 'split', 'refund', 'refundPreview', 'paidToday', 'move', 'drawer', 'drawerView', 'drawerUndo', 'giftIssue', 'noSale', 'board', 'window', 'menuBoard', 'readyBoard', 'show', 'guest', 'guestTip', 'void', 'readers', 'card', 'cardCheck', 'cardStop', 'cardTest', 'pouch', 'handIn', 'here', 'phoneLink', 'phoneCheck', 'merged', 'lineClear', 'deliveryOut', 'deliveryDone', 'deliveryFailed', 'deliveryRefund', 'deliveryHanded', 'deliveryOwed', 'appSoldOut', 'appCode', 'appCancel', 'laterCancel', 'bags', 'bagScan'].includes(action)) { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
    const staff = member || (b.staffPass ? await workingNow(db, tenantId, screen, b.staffPass) : null);
    const staffOk = b.staffPass && !member ? !!staff : undefined;
    const who = { id: staff?.id || null, name: staff?.name || screen.name };
    const by = who.name;
    const now = new Date(); const nowIso = now.toISOString();
    // With more than one location (lib/here-server): the one this screen is set up for, or for a team member on their own
    // device, the one picked in the app; each screen shows that location's cars, orders and deliveries only, on its own
    // clock when it keeps one (its day, its codes and numbers, its hours: zonedHere).
    const here = await hereFor(db, tenantId, { screen, asked: b.locationId, memberId: member?.id || null });
    tenant = await zonedHere(db, tenantId, tenant, here);
    const tz = tenantTimeZone(tenant);
    // The owner's rules for the money moments (lib/money-rules): who each takes, and who okayed it (lib/money-rules-server).
    // When it takes nobody else, the person at this screen okayed it. Each one is a line in Activity (lib/activity-server).
    const rules = rulesOf(tenant); const where: ActivityWhere = channel === 'counter' ? 'counter' : 'window';
    type Okay = { approver: { id: string | null; name: string }; reply: null } | { approver: null; reply: ReturnType<typeof NextResponse.json> };
    const okayBy = async (key: RuleKey, cents?: number | null): Promise<Okay> => {
      const need = needFor(rules, key, cents);
      const m = await okayFor(db, tenantId, staff, b.pin, need, { where, tenant });
      if (m.approver) return { approver: m.approver, reply: null };
      // (Anyone, but someone: it's on their name, never a screen's.)
      if (need === 'anyone') return who.id ? { approver: { id: who.id, name: who.name }, reply: null } : { approver: null, reply: signInFirst() };
      if (m.error && !m.notEnough) return { approver: null, reply: bad(m.error, m.status || 400) };
      return { approver: null, reply: NextResponse.json({ ok: false, needsManager: true, ...(need === 'owner' ? { owner: true } : {}), error: m.error || needWords(key, need), staffOk }, { status: 403 }) };
    };
    const atScreen = (a: { id: string | null; name: string }) => (a.id !== who.id ? ` at ${who.name}’s ${where}` : '');
    const signInFirst = () => NextResponse.json({ ok: false, needsStaff: true, error: 'Sign in first: tap Who’s working? and enter your PIN, so it’s on your name.', staffOk }, { status: 403 });
    // Each screen works its own line of guests only: a drive-thru screen never changes a counter order, and the counter
    // never a car (an order placed ahead and picked up at the drive-thru is the drive-thru's).
    if (['add', 'oneOff', 'sizeUp', 'remove', 'qty', 'note', 'allergy', 'name', 'send', 'scan', 'codeOn', 'paid', 'receipt', 'tip', 'discount', 'tender', 'part', 'partUndo', 'split', 'refund', 'refundPreview', 'cancel', 'void', 'takeOff', 'comp', 'uncomp', 'giftCard', 'giftIssue', 'price', 'priceBack', 'card', 'cardCheck', 'cardStop', 'cardTest', 'phoneLink', 'phoneCheck', 'points', 'rewardsCode', 'rewards', 'reward', 'move', 'call', 'looks', 'here', 'staffMeal', 'readyText', 'merged', 'lineClear', 'appSend', 'appCode', 'appCancel', 'bags', 'bagScan'].includes(action)) {
      const cid = String(b.carId || ''), oid = String(b.orderId || '');
      // (Both, when both are given: each has to be this screen's.)
      const xs: any[] = (await Promise.all([ID.test(cid) ? db.doc(`${T}/driveThruCars/${cid}`).get() : null, ID.test(oid) ? db.doc(`${T}/counterOrders/${oid}`).get() : null])).map((s2: any) => s2?.data?.() || null);
      // (A kiosk order is the counter's once it's paid: it waits there to be handed over.)
      if (xs.some((x) => x && counterSide(x.channel) !== (channel === 'counter'))) return bad(channel === 'counter' ? 'That order is the drive-thru’s. Open it on the drive-thru screen.' : 'That order is the counter’s. Open it on the counter screen.', 409);
    }

    // A paid order's receipt (lib/receipt-actions-server; components/pos/ReceiptAsk): its link, printed, the cash drawer,
    // or sent; the same as api/receipts, for a screen that carries its own key.
    // A tip and a discount (lib/counter-money-server; design board "Money at the counter").
    if (action === 'tip') {
      if (!tipsHere(tipsOf(tenant), channel)) return bad('Tips aren’t taken here. A manager can turn them on under Menu.', 409);
      const r: any = await setTip(db, tenantId, String(b.orderId || ''), b.cents, who);
      return r.ok ? ok({ tipCents: r.tipCents, total: r.total, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    // A gift card or store credit (lib/counter-money-server addTender): set aside for what's left, or taken off.
    if (action === 'tender') {
      const oid = String(b.orderId || ''); const what = String(b.do || '');
      if (!['gift', 'credit', 'remove'].includes(what)) return bad('Gift card or store credit?');
      const r: any = what === 'remove' ? await removeTender(db, tenantId, oid, { giftCardId: b.giftCardId, credit: b.credit === true })
        : await addTender(db, tenantId, oid, { kind: what as 'gift' | 'credit', code: b.code, upTo: b.upTo }, who);
      return r.ok ? ok({ due: (Number(r.due) || 0) / 100, cents: r.tender?.cents ?? 0, code: r.tender?.kind === 'gift' ? codeEnd(r.tender.code) : null, staffOk })
        : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    if (action === 'discount') {
      const custom = b.custom && typeof b.custom === 'object' ? b.custom : null;
      let approver: { id: string | null; name: string } | null = null;
      if (custom) { const m = await okayBy('customDiscount'); if (m.reply) return m.reply; approver = m.approver; }
      const r: any = await setDiscount(db, tenantId, tenant, String(b.orderId || ''), { id: custom ? null : b.discountId ? String(b.discountId) : null, custom }, who, approver as any);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      if (r.custom && approver) await logMoney(db, tenantId, { action: 'counter.discount', kind: 'discount', targetType: 'order', targetId: String(b.orderId), cents: r.cents, where, by: who, okBy: approver, reason: r.reason || r.label, ref: r.number,
        summary: `${approver.name} okayed $${(r.cents / 100).toFixed(2)} off ${r.number} (${r.reason || r.label})${atScreen(approver)}.` }, tenant);
      return ok({ total: r.total, cents: r.cents ?? 0, off: !!r.off, approvedBy: approver?.name || null, staffOk });
    }
    if (action === 'receipt') {
      const oid = String(b.orderId || ''); const what = String(b.do || '');
      if (!ID.test(oid)) return bad('Which order?');
      if (!['link', 'print', 'drawer', 'send'].includes(what)) return bad('Unknown action.');
      const { receiptAct } = await import('@/lib/receipt-actions-server');
      const x = await receiptAct(db, tenantId, `co_${oid}`, what, b, { name: by }, req.nextUrl.origin);
      return NextResponse.json(x.body, { status: x.status });
    }
    if (action === 'lane') {
      // Only the cars in the lane now (a car is gone once it's handed over, left, or voided), oldest first.
      // (Read generously and sorted here, so however many were left behind, the cars that just arrived are always shown.)
      // (With two ordering lanes that merge, the line to the window first, then the cars still ordering: lib/drive-lanes.)
      const twoLanes = channel === 'drive-thru' && lanesOf(tenant) === 2;
      const [carSnap, menu] = await Promise.all([db.collection(`${T}/driveThruCars`).where('stage', 'in', LIVE).limit(300).get(), readMenu(db, tenantId, here)]);
      const live = carSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => (counterSide(c.channel) ? 'counter' : 'drive-thru') === channel && atHere(c, here)).sort(forLaneScreen(twoLanes)).slice(-40);
      // (Each button carries the number guests order by, as on the menu board: lib/menu-numbers.)
      const laneNums = menuNumbers(menu);
      // The line before the speaker, from the lane entry sensor (lib/lane-entry-server), counting toward a rush.
      // (Its own location's cars and its own lanes' sensors, with more than one.)
      const line = channel === 'drive-thru' ? await lineNow(db, tenantId, tenant, { cars: carSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => atHere(c, here)), nowMs: now.getTime(), at: here }).catch(() => null) : null;
      // (With each car's order placed ahead going with it, if it has one.)
      const orderIds = Array.from(new Set(live.flatMap((c: any) => [String(c.orderId || ''), String(c.aheadId || '')]).filter((x: string) => ID.test(x))));
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
        orders[s.id] = { id: s.id, number: o.number, channel: o.channel, status: o.status, guestName: cleanName(o.guestName) || null, lines: o.lines || [], allergy: orderAllergyOf(o),
          // Rewards for this order (lib/counter-points): the last 4 of the phone given, and what it earned once paid.
          // (Given by their rewards code, `verified`: they can use a reward on it, which is kept with what it took off.)
          points: o.clientId && o.points ? { phone: o.points.phone ? String(o.points.phone) : null, earned: num(o.points.earned), verified: o.points.verified === true } : null, subtotal: o.subtotal || 0, tax: o.tax || 0, taxLabel: o.taxLabel || 'Tax', total: o.total || 0,
          reward: o.reward ? { name: String(o.reward.name || 'Reward'), cents: num(o.reward.cents) } : null, itemsTotal: o.reward ? num(o.itemsTotal) : null,
          paidAt: o.paidAt || null, payMethod: o.payMethod || null, paidVia: o.paidAt ? (o.paidVia || null) : null, sentAt: o.sentAt || null, dueAt: o.dueAt || null,
          // To go (sent so: lib/plate-extras), and a staff meal (settled with no money: lib/counter-server staffMeal).
          toGo: o.toGo === true, staffMeal: o.staffMeal ? { for: String(o.staffMeal.for || '') } : null,
          // Its tip and discount (lib/counter-money): the tip in its total; the discount's name, how much, and who okayed one.
          tipCents: Math.max(0, Math.round(Number(o.tipCents) || 0)), keptChange: o.keptChange === true,
          // Gift cards and store credit set aside on it, and what's left for cash or card (lib/counter-money).
          tenders: tendersOf(o).map((t) => (t.kind === 'gift' ? { kind: 'gift', giftCardId: t.giftCardId, code: codeEnd(t.code), cents: t.cents, part: t.part === true } : t.kind === 'credit' ? { kind: 'credit', cents: t.cents, part: t.part === true }
            : { kind: t.kind, partId: t.partId, cents: t.cents, machine: t.kind === 'card' && !t.id })),
          // A split bill (lib/counter-split-server): how many ways, and how many have paid their share.
          split: o.split?.ways ? { ways: Math.round(Number(o.split.ways)) || 2, shares: sharesPaidOf(o) } : null,
          due: dueCentsOf(o) / 100, creditShort: Math.max(0, Math.round(Number(o.creditShort) || 0)),
          markdown: o.markdown ? { id: String(o.markdown.id || ''), label: String(o.markdown.label || 'Discount'), words: String(o.markdown.words || ''), cents: Math.max(0, Math.round(Number(o.markdown.cents) || 0)), okBy: o.markdown.okBy || null, reason: o.markdown.reason || null } : null,
          // A delivery app's order (lib/app-orders): which app, its code, its spot on the shelf, and when the courier is due.
          app: o.app ? { state: String(o.app.state || 'taking'), app: o.app.app || null, label: o.app.label || null, code: o.app.code || null, shelf: o.app.shelf || null, courierAt: o.app.courierAt || null,
            // (What it comes to with the app: its price, and any sales tax the business pays. lib/app-orders)
            ...(o.app.money ? { money: { markupPct: Number(o.app.money.markupPct) || 0, appCents: Number(o.app.money.appCents) || 0, taxCents: Number(o.app.money.taxCents) || 0, appPaysTax: o.app.money.appPaysTax !== false } } : {}) } : null,
          // The card reader's payment for it, if one was started (lib/counter-card): how it's going, and the reader's words.
          card: o.card && typeof o.card === 'object' && o.card.state ? { state: String(o.card.state), failed: o.card.failed || null, readerId: o.card.readerId || null, at: o.card.at || null, cents: Math.round(Number(o.card.cents) || 0) || null } : null,
          // (Nothing for the kitchen, only what was rung in that isn't on the menu: ready as soon as it's sent.)
          kitchen: o.status === 'building' ? 'not sent' : (mine.length || o.kitchenNone === true) && !waitingOn.length ? 'ready' : 'making', waitingOn,
          readyCount: mine.filter((t: any) => t.status === 'ready' || t.status === 'delivered').length, ticketCount: mine.length,
          // The text the guest asked for when it's ready (lib/ready-text): the last four digits, and when it went.
          text: readyTextView(o) ? { ...readyTextView(o)!, sentAt: o.readyText?.sentAt || null } : null,
          // Its bag labels once printed (lib/food-bags): how many, and which are still to scan before it's handed over.
          bags: bagsOf(o) ? { of: bagsOf(o)!.count, left: bagsLeft(o, tenant) } : null, bagsStart: defaultBags(o) };
      }
      // A car waiting past the business's limit: the shift lead hears, once (lib/speed-server).
      if (channel === 'drive-thru') await checkLongWaits(db, tenantId, tenant, live, now.getTime(), new Map(live.map((c: any) => [String(c.id), (orders[String(c.orderId || '')]?.waitingOn || []).map((w: any) => `${num(w.quantity) > 1 ? `${num(w.quantity)} ` : ''}${w.name}`)])));
      const target = targetsOf(tenant)[channel];
      const statsKey = `${tenantId}|${channel}|${here || ''}`;
      let cached = statsCache.get(statsKey);
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
        const mine = (c: any) => (counterSide(c.channel) ? 'counter' : 'drive-thru') === channel && atHere(c, here);
        const gone = goneSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => !c.left && mine(c));
        const span = (c: any, from: string, to: string) => { const a = Date.parse(String(c.stageAt?.[from] || (from === 'speaker' ? c.arrivedAt : ''))), z = Date.parse(String(to === 'gone' ? c.goneAt : c.stageAt?.[to] || '')); const v = (z - a) / 1000; return Number.isFinite(v) && v >= 0 && v < 3600 ? v : null; };
        const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((s2, x) => s2 + x, 0) / v.length) : null; };
        // A car taken in line ordered and paid before it reached the speaker: its own times say nothing about where the
        // speaker and the windows lose time, so it isn't counted in those parts. It is in the day's average, from when it
        // was taken in line: that's the guest's whole wait, which is what the target is about.
        const viaSpeaker = (c: any) => !c.inLine && !c.wasInLine;
        cached = { at: now.getTime(), stats: { average: avg(gone.map((c: any) => span(c, 'speaker', 'gone'))), target,
          ordering: avg(gone.filter(viaSpeaker).map((c: any) => span(c, 'speaker', 'pay'))), toWindow: avg(gone.filter(viaSpeaker).map((c: any) => span(c, 'pay', 'pickup'))), atWindow: avg(gone.filter(viaSpeaker).map((c: any) => span(c, 'pickup', 'gone'))),
          underTarget: gone.filter((c: any) => { const v = span(c, 'speaker', 'gone'); return v !== null && v <= target; }).length,
          thisHour: hourSnap.docs.filter((d: any) => !(d.data() || {}).left && mine(d.data() || {})).length, servedToday: gone.length,
          // The last half hour on its own, so the lane can say which part is slow right now (not just on average today).
          recent: (() => { const r = recentSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => !c.left && viaSpeaker(c) && mine(c));
            return { count: r.length, ordering: avg(r.map((c: any) => span(c, 'speaker', 'pay'))), toWindow: avg(r.map((c: any) => span(c, 'pay', 'pickup'))), atWindow: avg(r.map((c: any) => span(c, 'pickup', 'gone'))) }; })() } };
        statsCache.set(statsKey, cached);
        if (statsCache.size > 500) statsCache.delete(statsCache.keys().next().value as string);
      }
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' }, screen: screen.name,
        // The location this screen is at, with more than one (lib/here-server).
        location: here ? { id: here, name: (await bizLocationsOf(db, tenantId)).find((l) => l.id === here)?.name || null } : null, staff: staff ? { id: staff.id, name: staff.name } : null, staffOk,
        cars: live.map((c: any) => ({ id: c.id, number: c.number, stage: c.stage, arrivedAt: c.arrivedAt, stageAt: c.stageAt || {}, orderId: c.orderId || null, takenBy: c.takenBy || null, spot: c.spot || null,
          // An order placed ahead going with the car (found at the speaker while it was ordering): handed over with it.
          aheadId: ID.test(String(c.aheadId || '')) ? String(c.aheadId) : null,
          // What they added was voided, and the car carried on with its order placed ahead (it may have driven off).
          addOnVoided: c.addOnVoided === true,
          inLine: c.inLine === true, wasInLine: c.wasInLine === true, hereAt: c.hereAt || null, looks: cleanLooks(c.looks),
          // The lane it ordered in, with two that merge.
          lane: twoLanes ? cleanLane(c.lane) : null,
          // When the counter last called this order out (api 'call'), and how many times.
          calledAt: c.calledAt || null, calls: num(c.calls),
          // The voice assistant's call for this car, if it has one (api/counter/voice): its state and who took over.
          voice: c.voice?.callId ? { status: String(c.voice.status || ''), callId: String(c.voice.callId), takenOverBy: c.voice.takenOverBy || null } : null })),
        orders, stats: { ...cached.stats, inLane: live.length, inLineNow: inLineNow(live, now.getTime()), rushAt: RUSH_CARS, waiting: line?.waiting || 0, waitingByLane: line?.byLane || null, sensor: !!line?.sensor }, settings: { spots: spotsOf(tenant), pickupOnly: pickupOnlyOf(tenant), texts: readyTextsOn(tenant), lanes: channel === 'drive-thru' ? lanesOf(tenant) : 1, early: earlyModeOf(tenant),
          // The printer that prints bag labels, if one does (lib/food-bags-server).
          labelPrinter: (await labelPrinter(db, T).catch(() => null))?.name || null }, now: nowIso,
        // Which car merged first, when the window is asked (lib/drive-lanes): the front car of each lane, neither paying.
        merge: (() => { const paying = new Set<string>(live.filter((c: any) => { const cd = orders[String(c.orderId || '')]?.card; const st = String(cd?.state || ''); return st === 'on_reader' || st === 'capturing' || (st === 'starting' && now.getTime() - (Date.parse(String(cd?.at || '')) || 0) < 60000); }).map((c: any) => String(c.id)));
          const ask = mergeAsk(live, twoLanes, paying, now.getTime()); return ask ? { next: ask.next.id, other: ask.other.id } : null; })(),
        // Each item with its price right now (happy hour) and, outside its menus by time of day, when it's back
        // (lib/menu-time): ordering it then is refused anyway (lib/counter-orders lineFor).
        menu: menu.filter((m) => m.onMenu).map((m) => { const s = servedNow(m, tenant, now); const p = priceNow(m, tenant, now);
          return { ...m, number: laneNums.get(m.id) ?? null, off: s.ok ? null : s.when, priceNow: p.price, happy: p.happy }; }),
        // What sells at this hour, most sold first (lib/register-tiles-server): the register's first tab.
        most: await (await import('@/lib/register-tiles-server')).mostSoldNow(db, tenantId, tz, menu.filter((m) => m.onMenu).map((m) => m.id), now).catch(() => null),
        // How the business arranges the tiles (lib/register-tiles TileSetup): the look, the order, pinned and hidden.
        // (Only ids on the menu now: a long-gone item never rides along on every look.)
        tiles: (() => { const onMenu = new Set(menu.filter((m) => m.onMenu).map((m) => m.id)); const t = tileSetupOf(tenant);
          return { ...t, order: t.order.filter((x) => onMenu.has(x)), pinned: t.pinned.filter((x) => onMenu.has(x)), hidden: t.hidden.filter((x) => onMenu.has(x)) }; })(),
        // Orders placed ahead for the drive-thru, paid and not picked up yet (lib/counter-ahead): those on their way first.
        // (Even with ordering ahead switched off since: an order already paid is still picked up.)
        ahead: channel !== 'drive-thru' ? [] : (await aheadForLane(db, tenantId, tenant).catch((e: any) => { console.error('[counter] orders placed ahead not read', e?.message); return []; })).filter((o: any) => atHere(o, here)),
        // The menu by time of day that's on, and happy hour (lib/menu-time), for the counter's header.
        daypart: daypartNow(tenant), happyHour: inHappyHour(tenant) ? { until: timeWords(happyHourOf(tenant).to) } : null, channel,
        // Whether the business takes orders ahead (the lane offers "Ordered ahead" for a code even with none listed).
        // Hot food going out with the business's own drivers today (lib/food-delivery-server), at the counter.
        deliveries: channel === 'counter' && foodDeliveryOf(tenant).on ? (await deliveriesToday(db, tenantId, tenant, now.getTime()).catch(() => [])).filter((r: any) => atHere(r, here)) : [],
        drivers: channel === 'counter' && foodDeliveryOf(tenant).on ? await foodDrivers(db, tenantId, tenant, now.getTime(), here).catch(() => []) : [],
        // The drivers now (lib/driver-load-server: on the schedule, out, the first back), and new deliveries slowed down.
        // (Each of the drivers by name: out and back about when, here, or on later. lib/driver-load-server)
        driverNow: channel === 'counter' && foodDeliveryOf(tenant).on ? await Promise.all([driverLoad(db, tenantId, tenant, now.getTime(), { at: here }), foodDrivers(db, tenantId, tenant, now.getTime(), here)]).then(([l, names]) => ({ onNow: l.onNow, outNow: l.outNow, backAt: l.backAt,
          drivers: l.drivers.map((x) => ({ ...x, name: names.find((n) => n.id === x.id)?.name || null })).filter((x) => x.name) })).catch(() => null) : null,
        slow: channel === 'counter' && foodDeliveryOf(tenant).on ? deliveryNowOf(tenant, now.getTime()) : null,
        // The delivery apps it takes orders from (lib/app-orders), for the counter's App order.
        apps: channel === 'counter' && appOrdersOf(tenant).on ? appOrdersOf(tenant).apps : [],
        // Sold out here, to mark on each delivery app (and back on again when it's back): lib/app-orders.
        // (The first 30 items, and how many taps there are in all.)
        ...(() => { const all = channel === 'counter' && appOrdersOf(tenant).on ? appSoldOutTodo(menu, appOrdersOf(tenant).apps) : [];
          return { appSoldOut: all.slice(0, 30), appSoldOutTaps: all.reduce((n, r) => n + r.apps.length, 0) }; })(),
        // Orders for another day still waiting for their day (lib/ahead-days-server), soonest first.
        comingUp: channel === 'counter' && tenant.orderAhead?.anotherDay ? (await comingUp(db, tenantId, tenant, now.getTime()).catch(() => [])).filter((r: any) => atHere(r, here)) : [],
        aheadOn: aheadOf(tenant).on, pointsOn: pointsOn(tenant), rewardsCodes: pointsOn(tenant) && codesOn(),
        // At the counter: whether "For here or to go" matters (something goes out only to go, or only for here: a box, a
        // real cup), so the screen asks it before the order is sent (lib/plate-extras).
        askToGo: channel === 'counter' && extrasOf(tenant).some((e) => e.per !== 'guest' && e.when !== 'any'),
        // Receipts after a sale (design board "Receipts at the counter"; api/receipts): ask, print one, or don't print;
        // the printers that print receipts (a screen with more than one picks its own), and whether one opens a drawer.
        // Tips and discounts here (lib/counter-money): whether this screen asks for a tip, its percents, and the list.
        money: { tips: tipsHere(tipsOf(tenant), channel) ? { pcts: tipsOf(tenant).pcts } : null, discounts: discountsOf(tenant) },
        // Something not on the menu (lib/counter-oneoff): up to how much (0: not offered here).
        oneOffMax: oneOffMaxOf(tenant),
        // Gift cards sold with an order (lib/counter-gift): the business's own amounts, as on its Gift cards page.
        // (And this screen's paid orders whose gift cards weren't made yet, to make now: lib/counter-gift-server.)
        gift: { amounts: shopSettings(tenant).amounts, open: (await giftsOpenOf(db, tenantId)).filter((g) => counterSide(g.channel) === (channel === 'counter')).map(({ channel: _c, ...g }) => g) },
        receipt: await (async () => { const ps = await printersCached(db, `tenants/${tenantId}`).catch(() => [] as any[]);
          return { after: receiptAfterOf(tenant), printers: ps.filter((p: any) => p.receipts).map((p: any) => ({ id: p.id, name: p.name, drawer: !!p.drawer })), drawer: ps.some((p: any) => p.drawer) }; })(),
      });
    }

    // The menu board (a screen guests read before they order): the menu by section, each item's photo and price, sold out
    // shown as it happens, and the code to order ahead when that's on. Only what's on the menu for everyone.
    if (action === 'menuBoard') {
      // (Read at most every 10 seconds per business, however many boards poll; the week's best sellers every 10 minutes.)
      // (Each location's board its own: sold out there or everywhere, lib/menu-choices outWhere.)
      const boardKey = `${tenantId}|${here || ''}`;
      const hit = menuBoardCache.get(boardKey);
      let sections: { name: string; kind?: 'product'; items: any[] }[];
      if (hit && now.getTime() - hit.at < 10000) sections = hit.sections;
      else {
        // The menu, and the shop's products picked for the window (lib/pickup-window), shown after it.
        const [items, products] = await Promise.all([readMenu(db, tenantId, here).then((l) => l.filter((m) => m.onMenu && !m.membersOnly)),
          // (Only while the business has the shop.)
          moduleEnabled(tenant, 'pickup') ? readWindow(db, tenantId, tenant).catch((e: any) => { console.error('[counter] window not read', e?.message); return [] as any[]; }) : Promise.resolve([] as any[])]);
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
          sec.items.push({ id: m.id, name: m.name, words: m.words, ...(m.nameEs ? { nameEs: m.nameEs } : {}), ...(m.wordsEs ? { wordsEs: m.wordsEs } : {}), price: m.price, from: m.from, startPrice: m.startPrice, imageUrl: m.imageUrl, soldOut: m.soldOut || !m.inStock,
            featured: m.featured, badge: m.badge || (popular.has(m.id) ? 'popular' : null), calories: m.calories,
            // The number guests can order by ("number 3"), the same on every screen (lib/menu-numbers).
            number: nums.get(m.id) ?? null,
            // (Sold by weight: its price is per this unit, lib/menu-weight.)
            ...(m.byWeight ? { per: m.byWeight } : {}),
            // (Its menus by time of day and happy-hour price, shaped for the clock below and never sent as they are.)
            dayparts: m.dayparts, happyPrice: m.happyPrice });
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
        menuBoardCache.set(boardKey, { at: now.getTime(), sections, popular, popularAt });
        if (menuBoardCache.size > 500) menuBoardCache.delete(menuBoardCache.keys().next().value as string);
      }
      // The breakfast switch (lib/menu-time; design board "The breakfast switch", A): on the business's own clock (its
      // location's), only what's served now, the menu by time of day it's on and until when, and happy-hour prices with
      // the regular one beside them. Worked out on every ask, so the board changes within a poll of the time.
      const dpNow = daypartsNow(tenant, now); const happyNow = inHappyHour(tenant, now);
      // (A board set to Español shows the business's own Spanish for its sections and menus by time of day: lib/guest-lang.)
      const es = spanishOf(tenant);
      const boardSections = sections.map((sec) => ({ ...sec, ...(!sec.kind && es.sections[sec.name] ? { nameEs: es.sections[sec.name] } : {}), items: sec.items.filter((it: any) => !Array.isArray(it.dayparts) || servedNow({ dayparts: it.dayparts }, tenant, now).ok)
        .map(({ dayparts: _d, happyPrice, ...it }: any) => ({ ...it, ...(happyNow && happyPrice !== null && happyPrice !== undefined && happyPrice < it.price ? { happyPrice } : {}) })) })).filter((sec) => sec.items.length > 0);
      const A = aheadOf(tenant);
      // Ordering ahead: the menu's own page when that's on, else the shop when the board shows its products (and the
      // shop is open).
      const shopOpen = sections.some((x) => x.kind === 'product') && moduleEnabled(tenant, 'pickup') && tenant.retailSettings?.storePaused !== true;
      const origin = linkOrigin(tenant, req.nextUrl.origin).replace(/\/+$/, '');
      return ok({ business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Menu' }, sections: boardSections,
        // (Every menu on now, overlapping ones too; and with nothing at all to show, when the next one starts.)
        dayparts: dpNow.map((d) => ({ name: d.name, ...(es.dayparts[d.id] ? { nameEs: es.dayparts[d.id] } : {}), until: d.until })), happyHour: happyNow ? { until: timeWords(happyHourOf(tenant).to) } : null,
        next: boardSections.length ? null : (() => { const nx = nextDaypart(tenant, now, new Set(sections.flatMap((x) => x.items.flatMap((it: any) => (Array.isArray(it.dayparts) ? it.dayparts.map(String) : []))))); if (!nx) return null;
          const { id, ...rest } = nx; return { ...rest, ...(es.dayparts[id] ? { nameEs: es.dayparts[id] } : {}) }; })(),
        // The business's own color (made readable for white text on it), for the tags and the price on the featured item.
        accent: pageAccent(tenant),
        orderAhead: A.on ? `${origin}/order/${encodeURIComponent(tenantId)}` : shopOpen ? `${origin}/shop/${encodeURIComponent(tenantId)}` : null,
        // A pickup-only drive-thru: the board says to order on your phone, not at the speaker.
        pickupOnly: pickupOnlyOf(tenant), now: nowIso });
    }

    // The ready board (a TV by the counter, lib/ready-board): which counter, kiosk and ordered-ahead orders are being made
    // and which are ready to collect, by number and first name; nothing else.
    if (action === 'readyBoard') {
      const rKey = `${tenantId}|${here || ''}`;
      const c = readyCache.get(rKey);
      if (c && now.getTime() - c.at < 3000) return ok({ ...c.body, now: nowIso });
      // From the kitchen's live tickets for these orders (being made, held, or ready, not yet handed over), and only their
      // orders: never a whole day's orders read again every few seconds. Each channel and state asked for by itself, so
      // tickets from the tables and the lounge never count, and one left live from days ago is let go here.
      const old = now.getTime() - 14 * 3600000;
      const tSnaps = await Promise.all(BOARD_CHANNELS.flatMap((c) => LIVE_TICKETS.map((s) => db.collection(`${T}/kdsTickets`).where('channel', '==', c).where('status', '==', s).limit(300).get())));
      const live = tSnaps.flatMap((x: any) => x.docs.map((d: any) => d.data() || {})).filter((t: any) => ID.test(String(t.orderId || '')) && (Date.parse(String(t.createdAt || '')) || now.getTime()) >= old);
      const ids: string[] = Array.from(new Set(live.map((t: any) => String(t.orderId)))).slice(0, 300) as string[];
      const oSnaps: any[] = ids.length ? await db.getAll(...ids.map((id) => db.doc(`${T}/counterOrders/${id}`))) : [];
      const orders = oSnaps.filter((x: any) => x?.exists).map((x: any) => ({ id: x.id, ...(x.data() || {}) })).filter((o: any) => onReadyBoard(o) && atHere(o, here));
      const r = readyBoardOf(orders, live, now.getTime());
      const body = { business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Your order' },
        making: r.making.slice(0, MAX_MAKING).map((x) => ({ number: x.number, name: x.name, ...(x.app ? { app: x.app, shelf: x.shelf || null } : {}) })), more: Math.max(0, r.making.length - MAX_MAKING),
        ready: r.ready.slice(0, MAX_READY).map((x) => ({ number: x.number, name: x.name, ...(x.app ? { app: x.app, shelf: x.shelf || null } : {}) })), moreReady: Math.max(0, r.ready.length - MAX_READY) };
      readyCache.set(rKey, { at: now.getTime(), body }); if (readyCache.size > 500) readyCache.delete(readyCache.keys().next().value as string);
      return ok({ ...body, now: nowIso });
    }

    if (action === 'board') {
      // What a guest at the speaker sees: the newest car's order as it's built, and once it's sent, where to go and what
      // it comes to (for 20 seconds). An order nobody has touched for 10 minutes is never shown to the next car.
      const since = new Date(now.getTime() - 30 * 60000).toISOString();
      const carSnap = await db.collection(`${T}/driveThruCars`).where('arrivedAt', '>=', since).get();
      // (A car taken in line, before the speaker, is never the one at the speaker.)
      // (With two lanes, a board set to its lane shows only the car at its own speaker.)
      const boardLane = lanesOf(tenant) === 2 ? cleanLane(b.lane) : null;
      const newest: any = carSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => c.inLine !== true && atDriveThru(c) && atHere(c, here) && (!boardLane || laneOf(c) === boardLane)).sort((a: any, c: any) => String(c.arrivedAt).localeCompare(String(a.arrivedAt)))[0] || null;
      const o: any = newest && (newest.stage === 'speaker' || newest.stage === 'pay') && ID.test(String(newest.orderId || '')) ? (await db.doc(`${T}/counterOrders/${newest.orderId}`).get()).data() : null;
      const touched = o ? Date.parse(String(o.updatedAt || o.createdAt || '')) : NaN;
      const show = o && (o.status === 'building' ? now.getTime() - touched < 10 * 60000 : o.status === 'sent' && now.getTime() - Date.parse(String(o.sentAt || '')) < 20000);
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' }, lanes: lanesOf(tenant),
        order: show ? { number: o.number, name: cleanName(o.guestName) || null, sent: o.status !== 'building',
          // Their order placed ahead, found at the speaker: "A1, paid and being made".
          alsoAhead: ID.test(String(newest.aheadId || '')) ? String(newest.aheadNumber || '') || null : null, lines: (o.lines || []).map((l: any) => ({ name: l.name, ...(l.nameEs ? { nameEs: String(l.nameEs).slice(0, 80) } : {}), quantity: l.quantity, choicesText: l.choicesText || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: photoOf(l), ...(l.comp ? { comp: true } : {}) })),
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
      // In the order they reached the window: a car taken in line from when it got there, not when it was taken; with two
      // lanes that merge, in the order they merged (lib/drive-lanes).
      const live = liveSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => inLineNow([c], nowMs) === 1 && c.inLine !== true && atDriveThru(c) && atHere(c, here))
        .sort(byWindow(lanesOf(tenant) === 2));
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
        const handed = newest(goneSnap.docs.map((d: any) => d.data() || {}).filter((c: any) => !c.left && !c.voided && c.inLine !== true && !c.stageAt?.forward && ageOf(c.goneAt) < 8000 && atDriveThru(c) && atHere(c, here)), (c) => c.goneAt);
        const first = paying || live.find((c: any) => (at === 'one' ? c.stage === 'pay' || c.stage === 'pickup' : c.stage === 'pickup'));
        pick = parked ? { car: parked, mode: 'forward' } : handed ? { car: handed, mode: 'thanks' } : first ? { car: first, mode: first.stage === 'pay' ? 'pay' : 'paid' } : null;
      }
      const o: any = pick && ID.test(String(pick.car.orderId || '')) ? (await db.doc(`${T}/counterOrders/${pick.car.orderId}`).get()).data() : null;
      // An order placed ahead going with the car: said beside its own, and ready only when both are.
      const aheadId = pick && ID.test(String(pick.car.aheadId || '')) ? String(pick.car.aheadId) : null;
      let kitchen: 'making' | 'ready' | null = null;
      if (o && pick && pick.mode === 'paid') {
        const mine = (await db.collection(`${T}/kdsTickets`).where('orderId', 'in', [String(pick.car.orderId), ...(aheadId ? [aheadId] : [])]).get()).docs.map((d: any) => d.data() || {}).filter((t: any) => t.status !== 'cancelled');
        kitchen = (mine.length || o.kitchenNone === true) && !mine.some((t: any) => t.status === 'pending' || t.status === 'in_progress') ? 'ready' : 'making';
      }
      // An order that was cancelled or voided never shows.
      const shown = o && pick && !['cancelled', 'voided', 'building'].includes(String(o.status)) ? pick : null;
      const card = shown && o.card && !o.paidAt ? (o.card.state === 'on_reader' || o.card.state === 'starting' || o.card.state === 'capturing' ? 'on_reader' : o.card.state === 'declined' && ageOf(o.card.failedAt) < 30000 ? 'declined' : null) : null;
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Drive-thru' },
        show: shown ? { mode: shown.mode === 'pay' && o.paidAt ? 'paid' : shown.mode, number: o.number, name: cleanName(o.guestName) || null, spot: shown.mode === 'forward' ? (shown.car.spot || null) : null,
          // The items and money only while they're paying (a car told where to go, or thanked, doesn't need them).
          lines: shown.mode === 'pay' || shown.mode === 'paid' ? (o.lines || []).map((l: any) => ({ name: l.name, ...(l.nameEs ? { nameEs: String(l.nameEs).slice(0, 80) } : {}), quantity: l.quantity, choicesText: l.choicesText || null, price: Math.round(num(l.unitPrice) * num(l.quantity) * 100) / 100, imageUrl: photoOf(l), ...(l.comp ? { comp: true } : {}) })) : [],
          subtotal: shown.mode === 'pay' || shown.mode === 'paid' ? num(o.subtotal) : 0, tax: shown.mode === 'pay' || shown.mode === 'paid' ? num(o.tax) : 0, total: shown.mode === 'pay' || shown.mode === 'paid' ? num(o.total) : 0, paid: !!o.paidAt, payMethod: o.paidAt ? (o.payMethod || null) : null,
          // A reward used on it (what it took off, and the items' own total), and once it's paid, the points it earned
          // (never their balance: anyone at the window can see it).
          reward: (shown.mode === 'pay' || shown.mode === 'paid') && o.reward ? { name: String(o.reward.name || 'Reward'), off: num(o.reward.cents) / 100 || num(o.discount), itemsTotal: num(o.itemsTotal) } : null,
          // Its discount and tip (lib/counter-money), each by itself, as on the receipt.
          markdown: (shown.mode === 'pay' || shown.mode === 'paid') && o.markdown && num(o.markdown.cents) > 0 ? { name: String(o.markdown.label || 'Discount').slice(0, 40), off: num(o.markdown.cents) / 100, itemsTotal: num(o.itemsTotal) } : null,
          tip: (shown.mode === 'pay' || shown.mode === 'paid') ? Math.max(0, num(o.tipCents)) / 100 : 0,
          // Gift cards bought with it (lib/counter-gift): beside the subtotal, never in it. (None: left out.)
          ...((shown.mode === 'pay' || shown.mode === 'paid') && giftCentsOf(o.lines) > 0 ? { giftCards: giftCentsOf(o.lines) / 100 } : {}),
          earned: o.paidAt && num(o.points?.earned) > 0 && shown.mode !== 'pay' ? { points: num(o.points.earned), unit: loyaltyOf(tenant).earn?.mode === 'punch' ? 'punches' : 'points' } : null,
          // Change for cash, while the car is still likely at the window.
          change: o.paidAt && o.payMethod === 'cash' && num(o.changeGiven) > 0 && ageOf(o.paidAt) < 60000 ? num(o.changeGiven) : null,
          card, cardMessage: card === 'declined' ? String(o.card.failed || '') || null : null, kitchen, nextWindow: at === 'pay',
          // "And A1, your order placed ahead": its number, while they're paying or picking up.
          alsoAhead: aheadId && (shown.mode === 'pay' || shown.mode === 'paid') ? String(pick!.car.aheadNumber || '') || null : null,
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
    if (['car', 'move', 'cancel', 'void'].includes(action)) forgetStats(tenantId);

    // Rewards: the guest's phone number puts the order in their name (they join only when they say yes); paid already,
    // it earns now (lib/counter-points).
    if (action === 'points') {
      const r: any = await linkOrder(db, tenantId, tenant, String(b.orderId || ''), { phone: b.phone, join: b.join === true, name: b.name }, who.name);
      // (Not in the program yet: the lane asks them in its own sheet, so no message across the bottom too.)
      return r.ok ? ok({ earned: r.earned || 0, balance: r.balance ?? null, unit: r.unit || 'points', already: !!r.already, staffOk })
        : NextResponse.json({ ok: false, error: r.error, code: r.code || null, quiet: r.code === 'not_found' || r.code === 'not_member', staffOk }, { status: r.status });
    }
    // Their rewards code (lib/rewards-code): the order is theirs, and what they can use on it; a reward used or taken off
    // (lib/counter-points useReward); what they can use now.
    if (action === 'rewardsCode') {
      const r: any = await linkByCode(db, tenantId, tenant, String(b.orderId || ''), b.code, who.name);
      return r.ok ? ok({ earned: r.earned || 0, already: !!r.already, member: r.member || null, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    if (action === 'rewards') return ok({ ...(await rewardsOn(db, tenantId, tenant, String(b.orderId || ''))), staffOk });
    if (action === 'reward') {
      const r: any = await useReward(db, tenantId, tenant, String(b.orderId || ''), b.rewardId ?? null, who.name);
      return r.ok ? ok({ total: r.total, member: r.member || null, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    // "I ordered ahead, code 4821": the order placed ahead becomes this car's (or a new car's), straight to pickup.
    if (action === 'aheadCar') {
      const r: any = await aheadToCar(db, tenantId, tenant, { orderId: b.orderId, code: b.code, carId: b.carId }, who, here);
      forgetStats(tenantId); forgetLine(tenantId);
      return r.ok ? ok({ carId: r.carId, number: r.number, name: r.name, linked: !!r.linked, carNumber: r.carNumber || null, already: !!r.already, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    // "Nothing else": the car came only for its order placed ahead, and goes on to pickup with it.
    if (action === 'aheadDone') {
      const r: any = await aheadNothingMore(db, tenantId, String(b.carId || ''));
      forgetStats(tenantId);
      // On to pickup: the voice assistant (if it's still on with this car) hangs up.
      if (r.ok && !r.already) await stopCarCall(db, tenantId, String(b.carId || ''), 'car moved on');
      return r.ok ? ok({ number: r.number, already: !!r.already, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    // A delivery app's order (lib/app-orders-server): rung in at the counter, sent with the app's code, cancelled on the app.
    if (action === 'appCode') {
      // The code (or the app) typed wrong on a sent app order, fixed (lib/app-orders-server appCode). At the counter.
      if (channel !== 'counter') return bad('App orders are rung in at the counter.', 409);
      const id = String(b.orderId || '');
      const r: any = await appCode(db, tenantId, tenant, id, { app: b.app, code: b.code }, who);
      if (!r.ok) return bad(r.error, r.status);
      forgetStats(tenantId);
      if (!r.already) await logAuditAdmin(db, tenantId, { action: 'counter.app_code_fixed', targetType: 'order', targetId: id, summary: `${by} fixed the code on ${r.was}: now ${r.name}.`,
        actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
      return ok({ ...r, staffOk });
    }
    if (action === 'appStart' || action === 'appSend' || action === 'appCancel') {
      if (channel !== 'counter') return bad('App orders are rung in at the counter.', 409);
      if (action === 'appStart') {
        if (!appOrdersOf(tenant).on) return bad('Delivery app orders aren’t on. A manager turns them on in the Menu page’s settings.', 409);
        const c = await createCar(db, tenantId, tenant, b.carKey, who, { channel, app: true, locationId: here }); forgetStats(tenantId); return ok({ ...c, staffOk });
      }
      const id = String(b.orderId || '');
      // Cancelled once the kitchen started on it throws food out with no sale, so a manager okays that, as any void: one
      // signed in or working here, or their PIN typed here. Before then, anyone at the counter.
      let approver: { id: string | null; name: string } | null = null; let pinSaid: string | null = null;
      if (action === 'appCancel') {
        // (Asked for, and said, only once the kitchen started on it.)
        const need = needFor(rules, 'void');
        if (need === 'anyone') approver = who.id ? { id: who.id, name: who.name } : null;
        else { const m = await okayFor(db, tenantId, staff, b.pin, need, { where, tenant }); if (m.error && !m.notEnough) return bad(m.error, m.status || 400); approver = m.approver; pinSaid = m.error || null; }
      }
      const r: any = action === 'appSend' ? await appSend(db, tenantId, tenant, id, { app: b.app, code: b.code, courierIn: b.courierIn }, who) : await appCancel(db, tenantId, id, who, { manager: !!approver });
      if (!r.ok && r.needsManager && needFor(rules, 'void') === 'anyone') return signInFirst();
      if (!r.ok) return r.needsManager ? NextResponse.json({ ok: false, needsManager: true, ...(needFor(rules, 'void') === 'owner' ? { owner: true, error: pinSaid || needWords('void', 'owner') } : { error: pinSaid || r.error }), staffOk }, { status: 403 }) : bad(r.error, r.status);
      forgetStats(tenantId);
      if (action === 'appCancel' && !r.already) {
        const okayed = approver && r.wasted && approver.id !== who.id ? `${approver.name} okayed it at ${by}’s counter. ` : '';
        await logAuditAdmin(db, tenantId, { action: 'counter.app_cancelled', targetType: 'order', targetId: id,
          summary: `${by} took off ${r.name}: cancelled on ${r.label}. ${okayed}${r.wasted ? `Made already, so wasted: ${r.wasted}. ` : ''}${r.returned ? `Put back: ${r.returned}.` : ''}`.trim(),
          actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
      }
      return ok({ ...r, ...(approver && r.wasted ? { approvedBy: approver.name } : {}), staffOk });
    }

    if (action === 'car') { const c = await createCar(db, tenantId, tenant, b.carKey, who, { locationId: here, inLine: channel === 'drive-thru' && b.inLine === true, looks: channel === 'drive-thru' ? cleanLooks(b.looks) : null, channel,
      // (Its lane, with two that merge: the speaker's own, or the lane screen's button.)
      lane: lanesOf(tenant) === 2 ? cleanLane(b.lane) : null }); forgetStats(tenantId); forgetLine(tenantId); return ok({ ...c, staffOk }); }

    if (action === 'deliverySlow') {
      // New deliveries slowed down from the counter (lib/driver-load): more minutes on their times for an hour, a pause for
      // a while or the rest of the business's day, or back to normal. Orders already placed keep their times.
      if (channel !== 'counter') return bad('Deliveries are handled at the counter.', 409);
      const mode = String(b.mode || ''); const n = now.getTime(); const iso = (ms: number) => new Date(ms).toISOString();
      let patch: any;
      if (mode === 'extra' && (EXTRA_CHOICES as readonly number[]).includes(Number(b.minutes))) patch = { extraMin: Number(b.minutes), extraUntil: iso(n + 60 * 60000) };
      else if (mode === 'pause' && b.minutes === 'day') patch = { pausedUntil: nightBounds(tenant, tonight(tenant, now)).end };
      else if (mode === 'pause' && (PAUSE_CHOICES as readonly number[]).includes(Number(b.minutes))) patch = { pausedUntil: iso(n + Number(b.minutes) * 60000) };
      else if (mode === 'clear') patch = { pausedUntil: null, extraMin: 0, extraUntil: null };
      else return bad('Add time, pause, or back to normal?');
      await db.doc(T).set({ deliveryNow: { ...patch, by, at: now.toISOString() } }, { merge: true });
      const after = deliveryNowOf({ deliveryNow: { ...(tenant.deliveryNow || {}), ...patch } }, n);
      await logAuditAdmin(db, tenantId, { action: 'counter.delivery_slow', targetType: 'tenant', targetId: tenantId,
        summary: mode === 'clear' ? `${by} put new deliveries back to normal.` : mode === 'extra' ? `${by} added ${patch.extraMin} minutes to new deliveries for an hour.` : `${by} paused new deliveries${b.minutes === 'day' ? ' for the rest of the day' : ` for ${b.minutes} minutes`}.`,
        actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
      return ok({ slow: after, staffOk });
    }

    if (action === 'deliveryOut' || action === 'deliveryDone' || action === 'deliveryFailed') {
      // Hot food with the business's own drivers (lib/food-delivery-server): out with a driver (the person doing it),
      // delivered, or couldn't be and why. At the counter, never the lane.
      if (channel !== 'counter') return bad('Deliveries are handed out at the counter.', 409);
      const id = String(b.orderId || '');
      // (Who's driving, typed on the counter screen; or whoever's signed in.)
      // One of the business's drivers (their tip is theirs), a name typed for someone else, or whoever's signed in.
      const pickId = String(b.driverId || ''); const picked = pickId ? (await foodDrivers(db, tenantId, tenant, Date.now(), here)).find((x) => x.id === pickId) : null;
      if (pickId && !picked) return bad('Pick the driver again: they aren’t one of your drivers now.', 400);
      const typed = String(b.driver ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      const driver = picked || (typed ? { name: typed, id: null } : { name: by, id: who.id ? await staffIdForLogin(db, tenantId, who.id).catch(() => null) : null });
      const r: any = action === 'deliveryOut' ? await deliveryOut(db, tenantId, id, driver) : await deliveryEnd(db, tenantId, id, action === 'deliveryDone' ? { done: true } : { done: false, why: b.why }, by);
      if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: action === 'deliveryOut' ? 'counter.delivery_out' : action === 'deliveryDone' ? 'counter.delivery_done' : 'counter.delivery_failed', targetType: 'order', targetId: id,
        summary: action === 'deliveryOut' ? (driver.name === by ? `${by} took a delivery out.` : `${by} sent a delivery out with ${driver.name}.`) : action === 'deliveryDone' ? `${by} marked a delivery delivered.` : `${by} said a delivery couldn’t be made.`, actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
      return r.ok ? ok({ already: !!r.already, staffOk }) : bad(r.error, r.status);
    }
    if (action === 'appSoldOut') {
      // Marked sold out on a delivery app (or back on there), as the counter did it in the app (lib/app-orders
      // appSoldOutTodo): kept on the item, so the reminder goes once every app is done.
      if (channel !== 'counter') return bad('Delivery apps are at the counter.', 409);
      const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which item?');
      const app = appOrdersOf(tenant).apps.find((x) => x.code === b.app); if (!app) return bad('Which app?');
      if (typeof b.out !== 'boolean') return bad('Sold out, or back on?');
      const ref = db.doc(`${T}/inventory/${itemId}`);
      const r: any = await db.runTransaction(async (tx: any) => {
        const i: any = (await tx.get(ref)).data(); if (!i) return { error: 'That isn’t on the menu.', status: 404 };
        tx.set(ref, { appOut: { [app.code]: b.out ? now.toISOString() : FieldValue.delete() }, appOutBy: by }, { merge: true });
        return { ok: true, name: String(i.name || 'It') };
      });
      if (r.error) return bad(r.error, r.status);
      return ok({ name: r.name, app: app.label, out: b.out, staffOk });
    }
    if (action === 'deliveryRefund' || action === 'deliveryHanded' || action === 'deliveryOwed') {
      // One that couldn't be delivered (lib/food-delivery-settle-server): refunded to the card in one step (a manager's,
      // as any refund: signed in or working here as one, or their PIN typed here), or picked up instead and handed over.
      if (channel !== 'counter') return bad('Deliveries are handed out at the counter.', 409);
      const id = String(b.orderId || ''); if (!ID.test(id)) return bad('Which order?');
      if (action === 'deliveryHanded') {
        const r: any = await pickupHanded(db, tenantId, id, by);
        if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: 'counter.delivery_picked_up', targetType: 'order', targetId: id, summary: `${by} handed over ${r.number}, picked up instead of delivered.`, actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
        return r.ok ? ok({ already: !!r.already, number: r.number, staffOk }) : bad(r.error, r.status);
      }
      if (action === 'deliveryOwed') {
        const r: any = await sendOwed(db, tenantId, tenant, id, by);
        return r.ok ? ok({ cents: r.cents, owed: r.owed || 0, number: r.number, staffOk }) : bad(r.error, r.status);
      }
      const m = await okayBy('refund'); if (m.reply) return m.reply;
      const approver = m.approver;
      const r: any = await settleFailed(db, tenantId, tenant, id, 'refund', { by: approver.name, guest: false, ...(typeof b.fee === 'boolean' ? { fee: b.fee } : {}) });
      if (r.ok && !r.already) await logMoney(db, tenantId, { action: 'counter.delivery_refunded', kind: 'refund', targetType: 'order', targetId: id, cents: r.cents, where, by: who, okBy: approver, reason: 'Couldn’t be delivered', ref: r.number,
        summary: `${approver.name} refunded ${r.number} ($${(r.cents / 100).toFixed(2)}), which couldn’t be delivered${atScreen(approver)}.` }, tenant);
      return r.ok ? ok({ already: !!r.already, cents: r.cents, number: r.number, approvedBy: approver.name, staffOk }) : bad(r.error, r.status);
    }
    if (action === 'laterCancel' || action === 'laterSend') {
      // An order for another day (lib/ahead-days-server): to the kitchen now, on its day; or canceled with every line back to
      // the card, a manager's (as any refund: signed in or working here as one, or their PIN typed here).
      if (channel !== 'counter') return bad('Orders for another day are at the counter.', 409);
      const id = String(b.orderId || ''); if (!ID.test(id)) return bad('Which order?');
      if (action === 'laterSend') {
        const o: any = (await db.doc(`${T}/counterOrders/${id}`).get()).data();
        if (!o?.ahead?.forDay) return bad('That order isn’t here.', 404);
        if (String(o.ahead.forDay) > todayIn(tenantTimeZone(tenant), now)) return bad('That order is for another day. It goes to the kitchen on its day.', 409);
        const r: any = await releaseOne(db, tenantId, tenant, id, { id: who.id || null, name: by }, now.getTime());
        if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: 'counter.later_sent', targetType: 'order', targetId: id, summary: `${by} sent ${r.number}, an order for another day, to the kitchen.`, actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
        return r.ok ? ok({ already: !!r.already, number: r.number, staffOk }) : bad(r.error, r.status);
      }
      const m = await okayBy('refund'); if (m.reply) return m.reply;
      const approver = m.approver;
      const r: any = await cancelLater(db, tenantId, tenant, id, { by: approver.name, guest: false });
      if (r.ok && !r.already) await logMoney(db, tenantId, { action: 'counter.later_canceled', kind: 'refund', targetType: 'order', targetId: id, cents: r.cents, where, by: who, okBy: approver, reason: 'An order for another day, canceled', ref: r.number,
        summary: `${approver.name} canceled ${r.number}, an order for another day, and refunded $${(r.cents / 100).toFixed(2)}${atScreen(approver)}.` }, tenant);
      return r.ok ? ok({ already: !!r.already, cents: r.cents, number: r.number, approvedBy: approver.name, staffOk }) : bad(r.error, r.status);
    }
    if (action === 'lineClear') {
      // "Line's clear" (lib/lane-entry-server): nobody waiting to order before the speaker, in a lane or all of them.
      if (channel !== 'drive-thru') return bad('The counter has no lane.', 409);
      // (This location's lanes, with more than one.)
      await lineClear(db, tenantId, lanesOf(tenant) === 2 ? cleanLane(b.lane) : null, now.getTime(), here);
      return ok({ done: true, staffOk });
    }
    if (action === 'merged') {
      // The window: "this car merged first" (lib/drive-lanes). Only the front car of either lane, while it's asked.
      const carId = String(b.carId || ''); if (!ID.test(carId)) return bad('Which car?');
      if (lanesOf(tenant) !== 2) return bad('The drive-thru has one lane.', 409);
      const snap = await db.collection(`${T}/driveThruCars`).where('stage', '==', 'pay').limit(100).get();
      const ask = mergeAsk(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), true, new Set(), now.getTime());
      if (!ask || (ask.next.id !== carId && ask.other.id !== carId)) return ok({ already: true, staffOk });
      const r: any = await db.runTransaction(async (tx: any) => {
        // Both front cars read again: either one paid, left or moved since, and the question was about a line that's
        // changed (the screen asks again if it still needs to).
        const [n, o] = await Promise.all([ask.next, ask.other].map(async (c: any) => (await tx.get(db.doc(`${T}/driveThruCars/${c.id}`))).data()));
        if (!n || !o || n.stage !== 'pay' || o.stage !== 'pay' || windowKey(n, true) !== windowKey(ask.next, true) || windowKey(o, true) !== windowKey(ask.other, true)) return { already: true };
        tx.set(db.doc(`${T}/driveThruCars/${carId}`), mergeFirst(ask.next.id === carId ? ask.next : ask.other, ask), { merge: true }); return { done: true };
      });
      return ok({ ...r, staffOk });
    }

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

    if (action === 'call') {
      // The counter calls a ready order out ("C12, Dev"): kept on the order's place in line so every counter screen shows
      // it was called, and when.
      const carId = String(b.carId || ''); if (!ID.test(carId)) return bad('Which order?');
      const carRef = db.doc(`${T}/driveThruCars/${carId}`);
      const r: any = await db.runTransaction(async (tx: any) => {
        const car: any = (await tx.get(carRef)).data(); if (!car || car.stage === 'gone') return { error: 'That order was already handed over.', status: 404 };
        tx.set(carRef, { calledAt: nowIso, calls: num(car.calls) + 1, calledBy: by }, { merge: true });
        return { calledAt: nowIso, calls: num(car.calls) + 1 };
      });
      if (r.error) return bad(r.error, r.status);
      return ok({ ...r, staffOk });
    }
    // Bag labels (lib/food-bags-server; design board "Bag labels, and a check before it goes"): printed again from here,
    // on this tablet or the bag-label printer, with a number of bags; and each bag's label scanned before it's handed over
    // (an order placed ahead going with the car counts too).
    if (action === 'bags' || action === 'bagScan') {
      const carId = String(b.carId || ''); if (!ID.test(carId)) return bad('Which order?');
      const car: any = (await db.doc(`${T}/driveThruCars/${carId}`).get()).data();
      if (!car || car.stage === 'gone') return bad('That order was already handed over.', 404);
      const ids = [car.orderId, car.aheadId].map((x: unknown) => String(x || '')).filter((x) => ID.test(x));
      if (action === 'bagScan') { const r = await scanBag(db, tenantId, tenant, ids, b.code); return r.ok ? ok({ ...r, staffOk }) : bad(r.error, r.status); }
      const oid = String(b.orderId || ''); if (!ids.includes(oid)) return bad('Which order?');
      const r = await printLabels(db, tenantId, oid, { by, here: b.here === true, count: b.count });
      return r.ok ? ok({ ...r, staffOk }) : bad(r.error, r.status);
    }
    if (action === 'move') {
      const carId = String(b.carId || ''); const to = String(b.to || '') as Stage;
      if (!ID.test(carId) || !STAGES.includes(to) || to === 'speaker') return bad('Where to?');
      const carRef = db.doc(`${T}/driveThruCars/${carId}`);
      // Handed over with an allergy the kitchen hasn't noted (lib/order-allergy, lib/kitchen needsAllergyNote): refused,
      // unless a manager hands it over themselves (signed in, or their PIN here), which is kept on record.
      let allergyOk: { id: string; name: string } | null = null;
      if (to === 'gone' && b.allergyOverride === true) {
        const m = await managerFor(db, tenantId, staff, b.pin);
        if (m.error) return m.notManager ? NextResponse.json({ ok: false, needsManager: true, error: m.error, staffOk }, { status: 403 }) : bad(m.error, m.status);
        if (!m.approver) return NextResponse.json({ ok: false, needsManager: true, error: 'A manager hands it over without the kitchen’s Allergy noted. Their PIN, or ask one to.', staffOk }, { status: 403 });
        allergyOk = m.approver;
      }
      // A bag that won't scan (a torn label): a manager lets the order go without it, kept on the order (lib/food-bags).
      let bagOk: { id: string; name: string } | null = null;
      if (to === 'gone' && b.bagOverride === true) {
        const m = allergyOk ? { approver: allergyOk } as Awaited<ReturnType<typeof managerFor>> : await managerFor(db, tenantId, staff, b.pin);
        if (m.error) return m.notManager ? NextResponse.json({ ok: false, needsManager: true, error: m.error, staffOk }, { status: 403 }) : bad(m.error, m.status);
        if (!m.approver) return NextResponse.json({ ok: false, needsManager: true, error: 'A manager lets it go without every bag scanned. Their PIN, or ask one to.', staffOk }, { status: 403 });
        bagOk = m.approver;
      }
      const unnoted = (docs: any[]) => docs.some((d: any) => { const t: any = d.data() || {}; return !['delivered', 'cancelled'].includes(String(t.status)) && needsAllergyNote(ticketFrom({ ...t, id: d.id }, 'kdsTickets') as any); });
      const allergyWait = (number: string) => ({ error: `${number || 'This order'} has an allergy the kitchen hasn’t noted. Ask the kitchen to tap Allergy noted, or a manager hands it over.`, status: 409, code: 'allergy' });
      // A delivery app's order handed to its courier (lib/app-orders): in the books first, as the app's sale (no tax
      // added, nothing in the drawer), then handed over as any order is.
      if (to === 'gone') {
        const c0: any = (await carRef.get()).data();
        const o0: any = c0 && ID.test(String(c0.orderId || '')) ? (await db.doc(`${T}/counterOrders/${c0.orderId}`).get()).data() : null;
        // (Checked before anything is booked; checked again as it's handed over.)
        if (!allergyOk && o0?.app?.code && unnoted((await db.collection(`${T}/kdsTickets`).where('orderId', '==', String(c0.orderId)).get()).docs)) return NextResponse.json({ ok: false, ...allergyWait(appName(o0.app)), staffOk }, { status: 409 });
        // (Its bags too, before the app's sale is booked.)
        const w0 = o0?.app?.code && !bagOk ? bagsWaiting([{ id: String(c0.orderId), data: o0 }], tenant) : [];
        if (w0.length) return NextResponse.json({ ok: false, error: waitingWords(w0), code: 'bags', bags: w0, staffOk }, { status: 409 });
        if (o0?.app?.code && o0.status === 'sent' && !o0.paidAt) {
          const p: any = await payOrder(db, tenantId, String(c0.orderId), { method: 'app', by, byId: staff?.id || null, day: todayIn(tz, now) });
          if (!p.ok) return bad(p.error, p.status);
          await db.doc(`${T}/counterOrders/${c0.orderId}`).set({ app: { state: 'picked', pickedAt: nowIso, pickedBy: by } }, { merge: true });
        }
      }
      const r: any = await db.runTransaction(async (tx: any) => {
        const car: any = (await tx.get(carRef)).data(); if (!car) return { error: 'That car isn’t in the lane.', status: 404 };
        const order: any = car.orderId ? (await tx.get(db.doc(`${T}/counterOrders/${car.orderId}`))).data() : null;
        const tix = to === 'gone' && car.orderId ? (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', car.orderId))).docs : [];
        // An order placed ahead going with the car: handed over with it.
        const aheadRef = ID.test(String(car.aheadId || '')) ? db.doc(`${T}/counterOrders/${car.aheadId}`) : null;
        const aheadTix = to === 'gone' && aheadRef ? (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', String(car.aheadId)))).docs : [];
        const aheadOrder: any = to === 'gone' && aheadRef ? (await tx.get(aheadRef)).data() : null;
        const parked = to === 'forward' && b.spot !== undefined && b.spot !== null ? (await tx.get(db.collection(`${T}/driveThruCars`).where('stage', '==', 'forward').limit(30))).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter(atDriveThru) : [];
        if (car.stage === 'gone') return { already: true };
        // Only ever forward (a tap on an old screen never puts a car back, or spoils its times).
        if (STAGES.indexOf(to) <= STAGES.indexOf(car.stage)) return { already: true };
        if (to === 'gone' && order && order.status !== 'building' && !order.paidAt) return { error: 'Take payment first. If they drove off, void the order.', status: 409 };
        if ((to === 'pickup' || to === 'forward') && order && !order.paidAt && !order.app?.code) return { error: 'Take payment first.', status: 409 };
        if (to === 'gone' && !allergyOk && unnoted([...(order && order.status !== 'building' ? tix : []), ...aheadTix])) return allergyWait(String(car.number || order?.number || ''));
        // Each bag's label scanned first (lib/food-bags), unless a manager lets it go without: who, kept on the order.
        // (Not a car let go with nothing sent from here, carrying on with an order placed ahead: that one's checked at pickup.)
        const carriesOn = to === 'gone' && !!aheadRef && (!order || order.status === 'building');
        const bagWait = to === 'gone' && !carriesOn ? bagsWaiting([{ id: String(car.orderId || ''), data: order }, { id: String(car.aheadId || ''), data: aheadOrder }], tenant) : [];
        if (bagWait.length && !bagOk) return { error: waitingWords(bagWait), status: 409, code: 'bags', bags: bagWait };
        for (const w of bagWait) {
          tx.set(db.doc(`${T}/counterOrders/${w.orderId}`), { bags: { skipped: { by: bagOk!.name, at: nowIso } } }, { merge: true });
          // (As read here too, so the handover below sees them let go, not passed by.)
          const d = w.orderId === String(car.orderId || '') ? order : aheadOrder; if (d) d.bags = { ...(d.bags || {}), skipped: { by: bagOk!.name, at: nowIso } };
        }
        const skippedBags = bagWait.length > 0;
        // A spot is one of the business's own numbered spots (Menu page), and free; or none at all.
        const asked = to === 'forward' && b.spot !== undefined && b.spot !== null && String(b.spot) !== '' ? String(b.spot) : null;
        if (asked !== null && !(/^[1-8]$/.test(asked) && Number(asked) <= spotsOf(tenant))) return { error: 'That spot isn’t there anymore. Pick another.', status: 409 };
        // (A car left parked from hours ago doesn't hold its spot: the same three hours that make a line "now".)
        if (asked !== null) { const there = parked.find((p: any) => p.id !== carId && String(p.spot || '') === asked && inLineNow([p], now.getTime()) === 1); if (there) return { error: `Spot ${asked} has car ${there.number}. Pick another.`, status: 409 }; }
        const spot = to === 'forward' ? asked : undefined;
        // Let go with nothing sent from here, but with an order placed ahead going with it: the car carries on to pickup
        // with what it paid for, never leaves without it.
        if (to === 'gone' && aheadRef && (!order || order.status === 'building')) {
          if (order) tx.set(db.doc(`${T}/counterOrders/${car.orderId}`), { status: 'cancelled', cancelledAt: nowIso, cancelledBy: by, carId: null }, { merge: true });
          tx.set(carRef, carryOn(car, nowIso), { merge: true });
          return { ok: true, carriedOn: true };
        }
        // Handed over: the car, its order and the kitchen's tickets, and an order placed ahead with it (lib/counter-handover).
        if (to === 'gone') handOverInTx(tx, db, T, { carRef, car, order, tix, aheadRef, aheadTix, by, nowIso, aheadOrder });
        else tx.set(carRef, { stage: to, stageAt: { ...(car.stageAt || {}), [to]: nowIso }, ...(spot !== undefined ? { spot } : {}) }, { merge: true });
        return { ok: true, skippedBags };
      });
      forgetStats(tenantId);   // again once it's done, so a read in between never keeps the old numbers
      // Handed over or gone: the voice assistant (if it's still on with this car) hangs up.
      if (!r.error && to === 'gone') await stopCarCall(db, tenantId, carId, 'car gone');
      if (!r.error && !r.already && r.skippedBags && bagOk) await logAuditAdmin(db, tenantId, { action: 'counter.bags_skipped', targetType: 'car', targetId: carId, summary: `${bagOk.name} let an order go without every bag scanned${bagOk.id !== who.id ? ` (at ${by}’s screen)` : ''}.`, actor: { type: 'user', id: bagOk.id, name: bagOk.name } } as any).catch(() => {});
      if (!r.error && !r.already && allergyOk) await logAuditAdmin(db, tenantId, { action: 'counter.allergy_handover', targetType: 'car', targetId: carId, summary: `${allergyOk.name} handed over an order with an allergy the kitchen hadn’t noted${allergyOk.id !== who.id ? ` (at ${by}’s screen)` : ''}.`, actor: { type: 'user', id: allergyOk.id, name: allergyOk.name } } as any).catch(() => {});
      return r.error ? (r.code ? NextResponse.json({ ok: false, error: r.error, code: r.code, ...(r.bags ? { bags: r.bags } : {}), staffOk }, { status: r.status }) : bad(r.error, r.status)) : ok({ already: !!r.already, carriedOn: !!r.carriedOn, staffOk });
    }

    // Today's paid orders on this side (the counter's, or the drive-thru's), to find one to refund (lib/counter-refund).
    // THE GUEST SCREEN AT THE COUNTER (app/drive-thru/[tenantId]/guest; design board "Register tools", part 4): the
    // counter's screen says which order it's on (one per location), and the screen facing the guest shows that order as
    // it's rung, the total, the tip (the business's three, or none: picked there), and a code for the receipt once paid.
    const guestRef = db.doc(`${T}/counterGuest/${here && ID.test(String(here)) ? String(here) : 'main'}`);
    if (action === 'show') {
      if (channel !== 'counter') return bad('Only the counter shows its order on the guest screen.', 409);
      const oid = ID.test(String(b.orderId || '')) ? String(b.orderId) : null;
      await guestRef.set({ orderId: oid, at: nowIso, by: who.name, receiptUrl: null }, { merge: true });
      return ok({ staffOk });
    }
    if (action === 'guest' || action === 'guestTip') {
      const g: any = (await guestRef.get()).data() || {};
      const oid = ID.test(String(g.orderId || '')) ? String(g.orderId) : null;
      const oRef = oid ? db.doc(`${T}/counterOrders/${oid}`) : null;
      const o: any = oRef ? (await oRef.get()).data() : null;
      const nowMs = now.getTime(); const ageOf = (iso: unknown) => nowMs - (Date.parse(String(iso || '')) || 0);
      const live = !!o && o.channel === 'counter' && !['cancelled', 'voided'].includes(String(o.status)) && !o.staffMeal;
      // (While the counter's screen is on it: it says so every minute, so an order left open drops off within three.)
      const mode: 'ringing' | 'pay' | 'thanks' | null = !live ? null : o.paidAt ? (ageOf(o.paidAt) < 90000 ? 'thanks' : null) : ageOf(g.at) < 3 * 60000 ? (o.status === 'building' ? 'ringing' : 'pay') : null;
      // The tip, asked on this screen: the business's three, worked out on what the order comes to before any tip; once
      // picked (or none), not asked again.
      const ts = tipsOf(tenant);
      // (Never on a gift card sold with it: lib/counter-gift.)
      const tipBase = o ? tipBaseOf(o) : 0;
      const askTip = mode === 'pay' && tipsHere(ts, 'counter') && !o.tipChosenAt && Math.max(0, Math.round(num(o.tipCents))) === 0 && !o.app?.code && o.status === 'sent' && !cardBusyOf(o) && !(o.phone?.id && o.phone.state === 'open') && !(Array.isArray(o.tenders) && o.tenders.length);
      const choices = askTip ? tipChoices(tipBase, ts.pcts) : [];
      if (action === 'guestTip') {
        if (!askTip || String(b.orderId || '') !== oid) return bad('The tip is picked at the counter now.', 409);
        const cents = Math.round(Number(b.cents));
        if (!(cents === 0 || choices.some((c) => c.cents === cents))) return bad('Pick one of the tips shown.', 400);
        const r: any = await setTip(db, tenantId, oid!, cents, { id: null, name: 'The guest' }, { guestOnce: true });
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null }, { status: r.status });
        return ok({ tipCents: r.tipCents, total: r.total });
      }
      // The receipt's private link, made once for the order and kept with the screen's state.
      let receiptUrl: string | null = mode === 'thanks' ? (g.receiptUrl && g.receiptFor === oid ? String(g.receiptUrl) : null) : null;
      if (mode === 'thanks' && !receiptUrl) {
        const { receiptAct } = await import('@/lib/receipt-actions-server');
        const x = await receiptAct(db, tenantId, `co_${oid}`, 'link', {}, { name: 'Guest screen', guest: true }, req.nextUrl.origin).catch(() => null);
        receiptUrl = x?.body?.ok ? String(x.body.url) : null;
        if (receiptUrl) await guestRef.set({ receiptUrl, receiptFor: oid }, { merge: true });
      }
      const money = (v: unknown) => Math.round(num(v) * 100) / 100;
      return ok({
        business: { name: String(tenant.name || tenant.businessName || '').slice(0, 80) || 'Welcome' },
        show: mode ? { mode, number: String(o.number || ''), name: cleanName(o.guestName) || null, orderId: oid,
          lines: (o.lines || []).map((l: any) => ({ name: l.name, ...(l.nameEs ? { nameEs: String(l.nameEs).slice(0, 80) } : {}), quantity: l.quantity, choicesText: l.choicesText || null, price: money(num(l.unitPrice) * num(l.quantity)), ...(l.comp ? { comp: true } : {}) })),
          reward: o.reward ? { name: String(o.reward.name || 'Reward'), off: num(o.reward.cents) / 100 } : null,
          markdown: o.markdown && num(o.markdown.cents) > 0 ? { name: String(o.markdown.label || 'Discount').slice(0, 40), off: num(o.markdown.cents) / 100 } : null,
          tax: money(o.tax), tip: Math.max(0, num(o.tipCents)) / 100, total: money(o.total),
          tips: askTip ? choices : null,
          card: mode === 'pay' && o.card && ['on_reader', 'starting', 'capturing'].includes(String(o.card.state)) ? 'on_reader' : null,
          change: mode === 'thanks' && o.payMethod === 'cash' && num(o.changeGiven) > 0 ? num(o.changeGiven) : null,
          earned: mode === 'thanks' && num(o.points?.earned) > 0 ? { points: num(o.points.earned), unit: loyaltyOf(tenant).earn?.mode === 'punch' ? 'punches' : 'points' } : null,
          receiptUrl } : null,
      });
    }
    if (action === 'paidToday') {
      const since = startOfDay(todayIn(tz, now), tz).toISOString();
      // (Both sides' orders come back together: read enough of the day's to find this side's, then the newest 80.)
      const snap = await db.collection(`${T}/counterOrders`).where('paidAt', '>=', since).orderBy('paidAt', 'desc').limit(600).get();
      const rows = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((o: any) => counterSide(o.channel) === (channel === 'counter') && !o.staffMeal && o.status !== 'voided' && o.status !== 'scheduled').slice(0, 80)
        .map((o: any) => ({ id: o.id, number: String(o.number || ''), guestName: o.guestName || null, total: Number(o.total) || 0, paidAt: o.paidAt, refundCents: Math.max(0, Math.round(Number(o.refundCents) || 0)),
          left: refundLeftOf(o), why: cantRefund(o), lines: (Array.isArray(o.lines) ? o.lines : []).map((l: any) => ({ lineId: l.lineId, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, choicesText: l.choicesText || null, left: unitsLeftOf(o, l.lineId),
            ...(l.giftCard ? { gift: { code: l.giftCard.code || null, id: l.giftCard.id || null, refunded: !!l.giftCard.refundedAt } } : {}) })),
          tipCents: Math.max(0, Math.round(Number(o.tipCents) || 0) - Math.round(Number(o.refundTipCents) || 0)) }));
      // A gift card sold here that something's been spent from stays as it is (lib/counter-refund-server): said so.
      const giftIds = rows.flatMap((r: any) => r.lines.filter((l: any) => l.gift?.id && l.left > 0).map((l: any) => String(l.gift.id))).filter((x: string) => ID.test(x)).slice(0, 30);
      const cards = new Map<string, any>((await Promise.all(giftIds.map((id: string) => db.doc(`${T}/giftCards/${id}`).get()))).map((d: any) => [d.id, d.data() || null]));
      for (const r of rows as any[]) for (const l of r.lines) if (l.gift?.id && cards.has(l.gift.id)) {
        const c = cards.get(l.gift.id); const spent = !c || c.status === 'void' ? null : Math.max(0, Math.round(Number(c.initialCents) || 0) - Math.round(Number(c.balanceCents) || 0));
        if (!c || c.status === 'void' || (spent || 0) > 0) { l.left = 0; l.gift.spentCents = spent; l.gift.why = !c ? 'Not found' : c.status === 'void' ? 'Cancelled' : 'spent'; }
      }
      for (const r of rows as any[]) if (!r.why && r.left <= 0 && !r.lines.some((l: any) => l.left > 0)) r.why = 'Its gift card has been used, so nothing is left to refund.';
      return ok({ orders: rows, staffOk });
    }
    // Cash in and out of the open drawer, for something other than a sale (lib/drawer-moves-server): a pay out and a drop
    // to the safe are a manager's; and how much should be in it now, with today's moves.
    if (action === 'drawerView') return ok({ drawer: await drawerView(db, tenantId), staffOk });
    if (action === 'drawerUndo') {
      const m = await okayBy('cashMove'); if (m.reply) return m.reply;
      const r: any = await drawerUndo(db, tenantId, b.moveKey, who, m.approver as any);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      if (!r.already) await logMoney(db, tenantId, { action: 'counter.drawer_undo', kind: 'cash', targetType: 'tillSession', targetId: String(b.moveKey || ''), cents: r.cents, where, by: who, okBy: m.approver, reason: 'Undone',
        summary: `${r.words} $${(r.cents / 100).toFixed(2)} undone by ${m.approver.name}${atScreen(m.approver)}.` }, tenant);
      return ok({ kind: r.kind, cents: r.cents, words: r.words, already: !!r.already, staffOk });
    }
    if (action === 'drawer') {
      const m = await okayBy('cashMove'); if (m.reply) return m.reply;
      const r: any = await drawerMove(db, tenantId, b.kind, b.cents, b.note, who, m.approver as any, { receiptUrl: b.receiptUrl, key: b.moveKey });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      if (!r.already) await logMoney(db, tenantId, { action: `counter.drawer_${r.kind}`, kind: 'cash', targetType: 'tillSession', targetId: String(r.tillId || ''), cents: r.cents, where, by: who, okBy: m.approver, reason: b.note ? String(b.note) : r.words,
        summary: `${r.words} $${(r.cents / 100).toFixed(2)}${b.note ? `: ${String(b.note).slice(0, 80)}` : ''}, at ${who.name}’s ${where}${m.approver.id !== who.id ? `, okayed by ${m.approver.name}` : ''}.` }, tenant);
      return ok({ kind: r.kind, cents: r.cents, expectedCash: r.expectedCash, already: !!r.already, words: r.words, approvedBy: needFor(rules, 'cashMove') === 'anyone' && m.approver.id === who.id ? null : m.approver.name, staffOk });
    }
    // The drawer opened with no sale (lib/drawer-moves-server drawerNoSale): someone signed in here, with why.
    if (action === 'noSale') {
      // (Anyone signed in, with why, unless the owner's rules say a manager or only them.)
      const m = await okayBy('noSale'); if (m.reply) return m.reply;
      const r: any = await drawerNoSale(db, tenantId, b.reason, who, { key: b.moveKey, printerId: b.printerId });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, ...(r.code === 'staff' ? { needsStaff: true } : {}), staffOk }, { status: r.status });
      if (!r.already) await logMoney(db, tenantId, { action: 'counter.no_sale', kind: 'drawer', targetType: 'tillSession', targetId: 'open', where, by: who, okBy: m.approver.id !== who.id ? m.approver : null, reason: b.reason,
        summary: `${who.name} opened the drawer with no sale: ${String(b.reason || '').slice(0, 60)}${m.approver.id !== who.id ? `, okayed by ${m.approver.name}` : ''}.` }, tenant);
      return ok({ printer: r.printer || null, already: !!r.already, staffOk });
    }
    const orderId = String(b.orderId || ''); if (!ID.test(orderId)) return bad('Which order?');
    // With two lanes that merge (lib/drive-lanes): a car that starts paying at the window, or pays there, merged first,
    // whatever was taken to be ahead of it, so the windows and the kitchen follow it. (Nothing with one lane.)
    const settleMerge = async () => {
      if (channel !== 'drive-thru' || lanesOf(tenant) !== 2) return;
      try {
        const cars = (await db.collection(`${T}/driveThruCars`).where('stage', '==', 'pay').limit(100).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
        const me: any = cars.find((c: any) => c.orderId === orderId); if (!me) return;
        const patch = paidFirst(cars, me.id, true, now.getTime()); if (patch) await db.doc(`${T}/driveThruCars/${me.id}`).set(patch, { merge: true });
      } catch { /* the line's order stays a guess; paying goes on */ }
    };
    const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
    // A split bill (lib/counter-split-server): how many ways; one part in cash or on another card machine (the card
    // reader's part is 'card' with its cents); a part given back (a manager's).
    if (action === 'split') {
      const r: any = await setSplit(db, tenantId, orderId, b.ways);
      return r.ok ? ok({ ways: r.ways, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    if (action === 'part') {
      const method = b.method === 'cash' ? 'cash' : b.method === 'card' ? 'card' : null;
      if (!method) return bad('Cash or card?');
      await settleMerge();
      const r: any = await takePart(db, tenantId, orderId, { method, cents: b.cents, tendered: b.tendered, by });
      // All of what's left: it pays the order, as the last part.
      if (r.ok && r.whole) {
        const p: any = await payOrder(db, tenantId, orderId, { method, tendered: method === 'cash' ? b.tendered : undefined, by, byId: staff?.id || null, day: todayIn(tz, now) });
        if (!p.ok) return NextResponse.json({ ok: false, error: p.error, code: p.code || null, staffOk }, { status: p.status });
        if (p.cardId) await stopCard(db, tenantId, tenant, orderId, by).catch(() => null);
        if (!p.already) { await stopPhone(db, tenantId, tenant, orderId).catch(() => null); forgetStats(tenantId); }
        return ok({ paid: true, already: !!p.already, change: p.change ?? null, payMethod: p.payMethod || null, inDrawer: p.drawer ?? null, ...(p.gifts ? { gifts: p.gifts } : {}), staffOk });
      }
      return r.ok ? ok({ paid: false, partId: r.partId, cents: r.cents, change: r.change, due: r.due, inDrawer: !!r.inDrawer, staffOk })
        : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    // Money back on a paid order (lib/counter-refund-server; design board "Register tools"): what it would give back and
    // where, then the refund itself, a manager's.
    if (action === 'refundPreview') {
      const r: any = await previewRefund(db, tenantId, orderId, cleanAsk(b));
      return r.ok ? ok({ plan: r.plan || null, back: r.back || [], resuming: r.resuming || null, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    if (action === 'refund') {
      // (How much, first: staff may refund a small amount on their own, by the owner's rules.)
      // (With what's been refunded on the order already, so a refund in small pieces is one refund.)
      const pv: any = await previewRefund(db, tenantId, orderId, cleanAsk(b)).catch(() => null);
      const askCents = pv?.ok ? Number(pv.resuming?.cents ?? pv.plan?.cents) : NaN;
      const ro: any = (await db.doc(`${T}/counterOrders/${orderId}`).get()).data() || {};
      const soFar = Math.max(0, Math.round(Number(ro.refundCents) || 0)) + Object.values(ro.partsBack && typeof ro.partsBack === 'object' ? ro.partsBack : {}).reduce((n: number, x: any) => n + Math.max(0, Math.round(Number(x?.cents) || 0)), 0);
      const m = await okayBy('refund', Number.isFinite(askCents) && askCents > 0 ? askCents + soFar : null); if (m.reply) return m.reply;
      const r: any = await refundCounterOrder(db, tenantId, tenant, orderId, cleanAsk(b), { id: m.approver.id, name: m.approver.name }, who.name, b.resume === true);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, unfinished: r.unfinished || null, staffOk }, { status: r.status });
      forgetStats(tenantId);
      const paidBy = String(((await db.doc(`${T}/counterOrders/${orderId}`).get()).data() || {}).paidBy || '');
      await logMoney(db, tenantId, { action: 'counter.refund', kind: 'refund', targetType: 'order', targetId: orderId, cents: r.cents, where, by: who, okBy: m.approver, reason: b.reason, ref: r.number,
        // (Cash back by the person who took the payment, with nobody else okaying it.)
        toCash: Number(r.cashCents) > 0, sameAsPaid: !!paidBy && paidBy === who.name && m.approver.id === who.id,
        summary: `${m.approver.name} ${r.resumed ? `finished the $${(r.cents / 100).toFixed(2)} refund on ${r.number} that ${r.startedBy || 'another manager'} okayed` : m.approver.id === who.id ? `refunded $${(r.cents / 100).toFixed(2)} on ${r.number}` : `okayed a $${(r.cents / 100).toFixed(2)} refund on ${r.number}`}${atScreen(m.approver)}.` }, tenant);
      return ok({ cents: r.cents, back: r.back, machineCents: r.machineCents, cashCents: r.cashCents, full: r.full, resumed: !!r.resumed, approvedBy: m.approver.name, ...(r.cancelled?.length ? { cancelled: r.cancelled } : {}), staffOk });
    }
    if (action === 'partUndo') {
      // (A part of a split bill given back is a refund, by the owner's rules: how much, first.)
      const po: any = (await db.doc(`${T}/counterOrders/${orderId}`).get()).data() || {};
      const part = (Array.isArray(po.tenders) ? po.tenders : []).find((t: any) => t?.partId && t.partId === b.partId);
      const soFar = Math.max(0, Math.round(Number(po.refundCents) || 0)) + Object.values(po.partsBack && typeof po.partsBack === 'object' ? po.partsBack : {}).reduce((n: number, x: any) => n + Math.max(0, Math.round(Number(x?.cents) || 0)), 0);
      const m = await okayBy('refund', part ? (Math.round(Number(part.cents) || 0) + soFar) || null : null); if (m.reply) return m.reply;
      const r: any = await undoPart(db, tenantId, tenant, orderId, b.partId, { id: m.approver.id, name: m.approver.name });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      if (!r.already) await logMoney(db, tenantId, { action: 'counter.partBack', kind: 'refund', targetType: 'order', targetId: orderId, cents: r.cents, where, by: who, okBy: m.approver, reason: 'Part of a split bill given back', ref: po.number || null,
        toCash: r.kind === 'cash', sameAsPaid: false,
        summary: `${m.approver.name} gave back a $${(r.cents / 100).toFixed(2)} ${r.kind === 'cash' ? 'cash' : 'card'} part of a split bill${atScreen(m.approver)}.` }, tenant);
      return ok({ due: r.due, cents: r.cents, kind: r.kind || null, machine: !!r.machine, fromDrawer: !!r.fromDrawer, already: !!r.already, staffOk });
    }

    // A barcode scanned (lib/counter-scan-server; design board "Register tools"): the menu item it's on, added like a tap;
    // one on no item yet put on one, a manager's. A scale's sticker (lib/scale-label), when the business uses them: the
    // item at the weight or price printed, `label` true.
    if (action === 'scan') {
      const r: any = await scanToOrder(db, tenantId, tenant, orderId, b.code, b.tapKey);
      return r.ok ? ok({ order: r.order, line: r.line, name: r.name, pack: r.pack, ...(r.label ? { label: true } : {}), staffOk })
        : NextResponse.json({ ok: false, error: r.error, code: r.code || null, itemId: r.itemId || null, scanned: r.scanned || null, ...(r.scaleNo ? { scaleNo: r.scaleNo } : {}), staffOk }, { status: r.status });
    }
    if (action === 'codeOn') {
      const m = await managerFor(db, tenantId, staff, b.pin);
      if (m.error) return m.notManager ? NextResponse.json({ ok: false, needsManager: true, error: m.error, staffOk }, { status: 403 }) : bad(m.error, m.status);
      if (!m.approver) return NextResponse.json({ ok: false, needsManager: true, error: 'Putting a code on an item takes a manager. Their PIN, or ask one to.', staffOk }, { status: 403 });
      const r: any = await codeOnItem(db, tenantId, tenant, orderId, b.code, String(b.itemId || ''), m.approver.name, b.tapKey);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      await logAuditAdmin(db, tenantId, { action: 'counter.codeOn', targetType: 'inventory', targetId: String(b.itemId || ''), summary: `${m.approver.name} put code ••${r.codeEnd || ''} on ${r.item || 'an item'} at ${who.name}’s ${channel === 'counter' ? 'counter' : 'window'}. It scans everywhere now.`,
        actor: { type: 'user', id: String(m.approver.id || 'counter'), name: m.approver.name } } as any).catch(() => null);
      return ok({ order: r.order || null, line: r.line || null, name: r.name || null, learned: r.learned, after: r.after || null, staffOk });
    }
    // Some or all of one line off an order the kitchen has, before it's paid (lib/counter-takeoff-server): a manager's
    // once the kitchen started it.
    if (action === 'takeOff') {
      // (Something already made, thrown out with no sale: a void, by the owner's rules. Not made yet, anyone.)
      const need = needFor(rules, 'void');
      const mm = need === 'anyone' ? { approver: who.id ? { id: who.id, name: who.name } : null } : await okayFor(db, tenantId, staff, b.pin, need, { where, tenant });
      if ((mm as any).error && !(mm as any).notEnough) return bad((mm as any).error, (mm as any).status || 400);
      const r: any = await takeOffSent(db, tenantId, tenant, orderId, String(b.lineId || ''), b.qty, who, mm.approver as any);
      if (!r.ok && r.code === 'made' && need === 'anyone') return signInFirst();
      if (!r.ok && r.code === 'made') return NextResponse.json({ ok: false, needsManager: true, ...(need === 'owner' ? { owner: true } : {}), error: (mm as any).error || (need === 'owner' ? needWords('void', 'owner') : r.error), staffOk }, { status: 403 });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      const m = { approver: mm.approver };
      await logMoney(db, tenantId, { action: 'counter.takeOff', kind: 'void', targetType: 'order', targetId: orderId, cents: Math.round((Number(r.less) || 0) * 100), where, by: who, okBy: r.made ? m.approver : null, ref: r.order?.number || null,
        reason: r.made ? 'Taken off, made already' : 'Taken off before it was made', afterKitchen: !!r.made,
        summary: `${r.qty} × ${r.name} taken off order ${r.order.number} at ${who.name}’s ${where}${r.made ? `, made already, okayed by ${m.approver?.name || 'a manager'}` : ''}.` }, tenant);
      // (What's left may be ready now: the guest's text, if they asked for one.)
      await textIfReady(db, tenantId, [orderId]).catch(() => 0);
      forgetStats(tenantId);
      return ok({ order: r.order, made: r.made, returned: r.returned, name: r.name, qty: r.qty, less: r.less, approvedBy: r.made ? m.approver?.name || null : null, staffOk });
    }
    // One item on the house (lib/counter-comp-server): a manager's, with why; and taken back (its price again).
    if (action === 'comp') {
      const m = await okayBy('comp'); if (m.reply) return m.reply;
      const r: any = await compLine(db, tenantId, tenant, orderId, String(b.lineId || ''), b.qty, b.reason, who, m.approver as any);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      await logMoney(db, tenantId, { action: 'counter.comp', kind: 'comp', targetType: 'order', targetId: orderId, cents: r.cents, where, by: who, okBy: m.approver, reason: b.reason, ref: r.order?.number || null,
        summary: `${r.qty} × ${r.name} on the house ($${(r.cents / 100).toFixed(2)}) on order ${r.order.number}${m.approver.id !== who.id ? `, okayed by ${m.approver.name}` : `, by ${who.name}`}: ${String(b.reason || '').slice(0, 60)}.` }, tenant);
      return ok({ order: r.order, name: r.name, qty: r.qty, cents: r.cents, approvedBy: r.approvedBy, staffOk });
    }
    // One item at a different price (lib/counter-price-server): lower takes a manager, higher doesn't.
    if (action === 'price' || action === 'priceBack') {
      // (Lower than it is now takes someone, by the owner's rules; higher never does. Which it is, the order says.)
      const need = needFor(rules, 'lowerPrice');
      const mm: any = need === 'anyone' ? { approver: who.id ? { id: who.id, name: who.name } : null } : await okayFor(db, tenantId, staff, b.pin, need, { where, tenant });
      if (mm.error && !mm.notEnough) return bad(mm.error, mm.status || 400);
      const m = { approver: mm.approver as { id: string | null; name: string } | null };
      const r: any = action === 'price' ? await priceLine(db, tenantId, tenant, orderId, String(b.lineId || ''), b.qty, b.price, b.reason, who, m.approver as any)
        : await priceBack(db, tenantId, tenant, orderId, String(b.lineId || ''), who, m.approver as any);
      if (!r.ok && r.code === 'manager' && need === 'anyone') return signInFirst();
      if (!r.ok) return NextResponse.json({ ok: false, code: r.code || null, ...(r.code === 'manager' ? { needsManager: true, ...(need === 'owner' ? { owner: true } : {}), error: mm.error || (need === 'owner' ? needWords('lowerPrice', 'owner') : r.error) } : { error: r.error }), staffOk }, { status: r.status });
      if (!r.already) await logMoney(db, tenantId, { action: action === 'price' ? 'counter.price' : 'counter.price_back', kind: 'price', targetType: 'order', targetId: orderId, where, by: who,
        okBy: r.approvedBy && m.approver && m.approver.id !== who.id ? m.approver : null, ref: r.order?.number || null,
        cents: action === 'price' ? Math.round(Math.abs(Number(r.from) - Number(r.to)) * (Number(r.qty) || 1) * 100) : null,
        reason: action === 'price' ? `${String(b.reason || '').slice(0, 60)} (${Number(r.to) < Number(r.from) ? 'lower' : 'higher'})` : 'Back at its menu price',
        summary: action === 'price' ? `${r.qty} × ${r.name} at $${Number(r.to).toFixed(2)} (was $${Number(r.from).toFixed(2)}) on order ${r.order.number}${r.approvedBy && m.approver?.id !== who.id ? `, okayed by ${r.approvedBy}` : ''}: ${String(b.reason || '').slice(0, 60)}` : `${r.name} back at its menu price on order ${r.order.number}.` }, tenant);
      return ok({ order: r.order, name: r.name, qty: r.qty ?? null, from: r.from ?? null, to: r.to ?? null, back: !!r.back, approvedBy: r.approvedBy || null, already: !!r.already, staffOk });
    }
    if (action === 'uncomp') {
      const r: any = await uncompLine(db, tenantId, tenant, orderId, String(b.lineId || ''), who);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
      if (!r.already) await logMoney(db, tenantId, { action: 'counter.uncomp', kind: 'comp', targetType: 'order', targetId: orderId, where, by: who, ref: r.order?.number || null, reason: 'Charged for again',
        summary: `${r.name} charged for again on order ${r.order?.number || ''}, by ${who.name}.` }, tenant);
      return ok({ order: r.order, name: r.name, already: !!r.already, staffOk });
    }
    // Gift cards on a paid order made (the ones that weren't: lib/counter-gift-server), with their codes.
    if (action === 'giftIssue') {
      const o: any = (await db.doc(`${T}/counterOrders/${orderId}`).get()).data();
      if (!o) return bad('That order is gone.', 404);
      if (!o.paidAt) return bad('It isn’t paid yet. The gift card is made once it is.', 409);
      return ok({ gifts: await issueCounterGifts(db, tenantId, orderId, by), staffOk });
    }
    if (action === 'add' || action === 'oneOff' || action === 'giftCard' || action === 'sizeUp' || action === 'remove' || action === 'qty' || action === 'note') {
      const r: any = await editOrder(db, tenantId, tenant, orderId, action === 'add' ? { action, itemId: String(b.itemId || ''), quantity: b.quantity, choices: b.choices, tapKey: b.tapKey, offer: b.offer, note: b.note, ...(b.weight !== undefined ? { weight: b.weight } : {}) }
        // A gift card sold with it (lib/counter-gift): how much, who it's for, and how it gets to them.
        : action === 'giftCard' ? { action, cents: b.cents, to: b.to, via: b.via, phone: b.phone, email: b.email, tapKey: b.tapKey }
        // Something not on the menu (lib/counter-oneoff): its name, price, how many, and whether it's taxed.
        : action === 'oneOff' ? { action, name: b.name, price: b.price, quantity: b.quantity, taxed: b.taxed !== false, tapKey: b.tapKey }
        : action === 'sizeUp' ? { action, lineId: String(b.lineId || ''), quantity: b.quantity, tapKey: b.tapKey }
        : action === 'note' ? { action, lineId: String(b.lineId || ''), note: b.note, tapKey: b.tapKey }
        : action === 'remove' ? { action, lineId: String(b.lineId || ''), tapKey: b.tapKey } : { action, lineId: String(b.lineId || ''), quantity: b.quantity, tapKey: b.tapKey });
      // The line it went on (an add can join a line already there), for what to offer with it (components/menu/OfferAsk).
      return r.error ? bad(r.error, r.status) : ok({ order: r.order, line: r.line ? { lineId: r.line.lineId } : null, staffOk });
    }

    if (action === 'readyText') {
      const r: any = await askReadyText(db, tenantId, tenant, orderId, b.phone === null ? null : b.phone, 'counter');
      if (r.ok) await logAuditAdmin(db, tenantId, { action: 'counter.ready_text', targetType: 'order', targetId: orderId, summary: r.last4 ? `${by} set a text to ···${r.last4} for when the order is ready.` : `${by} took off the text for when the order is ready.`, actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
      return r.ok ? ok({ last4: r.last4, sent: r.sent, staffOk }) : bad(r.error, r.status);
    }

    if (action === 'allergy') {
      // The guest's allergies (lib/order-allergy): on every ticket once it's sent.
      const r: any = await setAllergy(db, tenantId, orderId, b.allergy, who);
      if (r.error) return bad(r.error, r.status);
      if (!r.already) await logAuditAdmin(db, tenantId, { action: 'counter.allergy', targetType: 'order', targetId: orderId, summary: r.allergy ? `${by} noted an allergy on the order: ${allergyWords(r.allergy)}${r.tickets ? `, after it was sent (on ${r.tickets} ${r.tickets === 1 ? 'ticket' : 'tickets'} still being made)` : ''}.` : `${by} took the allergy off the order.`, actor: { type: 'user', id: who.id || 'counter', name: by } } as any).catch(() => {});
      return ok({ allergy: r.allergy, tickets: r.tickets || 0, already: !!r.already, staffOk });
    }

    if (action === 'name') {
      const r: any = await setOrderName(db, tenantId, orderId, b.name);
      return r.error ? bad(r.error, r.status) : ok({ name: r.name, staffOk });
    }

    if (action === 'card' || action === 'cardCheck' || action === 'cardStop') {
      if (action === 'card') await settleMerge();
      const r: any = action === 'card' ? await startCard(db, tenantId, tenant, orderId, String(b.readerId || ''), by, { cents: b.cents })
        : action === 'cardCheck' ? await checkCard(db, tenantId, tenant, orderId, by) : await stopCard(db, tenantId, tenant, orderId, by);
      if (r.ok && r.state === 'paid' && !r.already) forgetStats(tenantId);
      return r.ok ? ok({ state: r.state, message: r.message || null, already: !!r.already, payMethod: r.payMethod || null, justWent: !!r.justWent, notKept: !!r.notKept, voided: !!r.voided, wrongAmount: !!r.wrongAmount, partCents: r.partCents ?? null, due: r.due ?? null, staffOk })
        : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }

    if (action === 'phoneLink') {
      const r: any = await phoneLink(db, tenantId, tenant, orderId, linkOrigin(tenant, req.nextUrl.origin), by);
      return r.ok ? ok({ url: r.url, wallets: !!r.wallets, staffOk }) : NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    }
    if (action === 'phoneCheck') {
      const r: any = await checkPhone(db, tenantId, tenant, orderId);
      if (r.ok && r.paid) forgetStats(tenantId);
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
        // (A number left for a ready text goes with it: lib/ready-text.)
        tx.set(orderRef, { status: 'cancelled', cancelledAt: nowIso, cancelledBy: by, ...(o.readyText?.to ? { readyText: { to: null, pendingSince: null } } : {}) }, { merge: true });
        // (A delivery app's code taken for it, if its send didn't finish: free again.)
        if (o.app?.claimId && ID.test(String(o.app.claimId))) tx.delete(db.doc(`${T}/private/${o.app.claimId}`));
        // (One with an order placed ahead going with it carries on to pickup with that, instead of leaving.)
        const carriedOn = !!car && car.stage !== 'gone' && car.orderId === orderId && ID.test(String(car.aheadId || ''));
        if (carriedOn) tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), carryOn(car, nowIso), { merge: true });
        else if (car && car.stage !== 'gone') tx.set(db.doc(`${T}/driveThruCars/${o.carId}`), { stage: 'gone', goneAt: nowIso, left: true, stageAt: { ...(car.stageAt || {}), gone: nowIso } }, { merge: true });
        return { ok: true, carId: o.carId || null, carriedOn };
      });
      forgetStats(tenantId);
      if (!r.error && r.carId) await stopCarCall(db, tenantId, String(r.carId), 'car left');
      return r.error ? bad(r.error, r.status) : ok({ carriedOn: !!r.carriedOn, staffOk });
    }

    if (action === 'staffMeal') {
      // A staff meal: settled with no money, for a named member of the team (lib/counter-server staffMeal). It writes the
      // order off as a void does, so a manager rings it in: signed in or working here as one, or with their PIN typed here
      // (checked with the same lockout as any PIN, lib/pin).
      const m = await okayBy('staffMeal'); if (m.reply) return m.reply;
      const approver = m.approver as { id: string; name: string };
      const mealOf: any = (await db.doc(`${T}/counterOrders/${orderId}`).get()).data() || {};
      const r: any = await staffMeal(db, tenantId, orderId, b.for, who, approver);
      if (r.error) return bad(r.error, r.status);
      forgetStats(tenantId);
      if (!r.already) {
        await stopPhone(db, tenantId, tenant, orderId).catch(() => null);
        await logMoney(db, tenantId, { action: 'counter.staff_meal', kind: 'staffMeal', targetType: 'counterOrder', targetId: orderId, cents: Math.round((Number(mealOf.total) || 0) * 100) || null, where, by: who, okBy: approver, reason: `For ${r.for}`, ref: mealOf.number || null,
          summary: `${approver.name} rang in a staff meal for ${r.for}${atScreen(approver)}.` }, tenant);
      }
      return ok({ already: !!r.already, for: r.for, approvedBy: approver.name, staffOk });
    }

    if (action === 'send') {
      // For here or to go, at the counter (the drive-thru is always to go): what goes out with it follows (lib/plate-extras).
      const r: any = await sendOrder(db, tenantId, tenant, orderId, who, { toGo: channel === 'counter' ? b.toGo === true : undefined });
      return r.error ? bad(r.error, r.status) : ok({ already: !!r.already, dueAt: r.due || null, staffOk });
    }

    if (action === 'void') {
      // By the owner's rules (a manager, unless they say otherwise): their PIN on this screen, or signed in as one.
      const m = await okayBy('void'); if (m.reply) return m.reply;
      const reason = String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!reason) return bad('Why is it being voided?');
      const before: any = (await orderRef.get()).data() || {};
      const r: any = await voidOrder(db, tenantId, orderId, reason, who);
      forgetStats(tenantId);
      if (!r.error) {
        const vo: any = (await orderRef.get()).data() || {}; const carId = String(vo.carId || '');
        if (!r.already) await logMoney(db, tenantId, { action: 'counter.void', kind: 'void', targetType: 'order', targetId: orderId, cents: Math.round((Number(before.total) || 0) * 100) || null, where, by: who, okBy: m.approver, reason, ref: before.number || null,
          afterKitchen: Number(r.wasted) > 0 || ['making', 'ready'].includes(String(before.kitchen || '')),
          summary: `${before.number || 'An order'} voided${m.approver.id !== who.id ? `, okayed by ${m.approver.name}` : ` by ${who.name}`}: ${reason}.` }, tenant);
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
    const method = b.method === 'cash' ? 'cash' : b.method === 'card' ? 'card' : b.method === 'tender' ? 'tender' : null; if (!method) return bad('Card or cash?');
    // Cash into the pouch of the person taking orders in line: theirs, so they're signed in with their PIN.
    const pouch = method === 'cash' && b.pouch === true;
    if (pouch && !staff?.id) return NextResponse.json({ ok: false, needsStaff: true, error: 'Enter your PIN first, so the cash is counted as yours.', staffOk }, { status: 403 });
    if (!pouch) await settleMerge();
    // Kept the change (lib/counter-money): a tip, where the business takes tips here.
    const keepChange = method === 'cash' && b.keepChange === true;
    if (keepChange && !tipsHere(tipsOf(tenant), channel)) return bad('Tips aren’t taken here. A manager can turn them on under Menu.', 409);
    const r: any = await payOrder(db, tenantId, orderId, { method, tendered: b.tendered, by, byId: staff?.id || null, pouch, day: todayIn(tz, now), keepChange });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code || null, staffOk }, { status: r.status });
    if (r.cardId) await stopCard(db, tenantId, tenant, orderId, by).catch(() => null);
    // A phone payment the guest had open is called off too (or given back, if they paid at that very moment).
    if (!r.already) await stopPhone(db, tenantId, tenant, orderId).catch(() => null);
    return ok({ already: !!r.already, inDrawer: r.drawer ?? null, inPouch: !!r.pouch, change: r.change ?? null, payMethod: r.payMethod || null, keptChange: !!r.keptChange, tipCents: r.tipCents ?? 0, ...(r.gifts ? { gifts: r.gifts } : {}), staffOk });
  } catch (e: any) {
    console.error('[counter] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
