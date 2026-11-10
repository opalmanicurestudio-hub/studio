// src/app/api/kitchen/route.ts — THE KITCHEN SCREEN (app/kds/[tenantId]), through the server. A kitchen tablet has no
// team member signed in, so it could never read or move a ticket itself. Instead it's set up once by a manager signed in
// on it ('pair'), and from then on it carries its own key: it reads the tickets and moves them along here, and keeps
// working when the manager signs out. Nobody's PIN is needed to see the screen; a PIN only puts a name on what's done.
// A screen's key is kept only as its fingerprint, in kitchenScreens/{sha256(key)} at the top of the database, where no
// browser can read or write (the security rules allow nothing there): only this route makes, checks and stops them.
//   pair    { tenantId, name }                     (a manager, signed in) → the screen's key, shown once and kept on it
//   screens { tenantId }                           (a manager) → this business's screens, to stop one that's lost
//   revoke  { tenantId, id }                       (a manager) → that screen stops working
//   maker   { tenantId, maker: 'kitchen'|'desk' }   (a manager) → who makes the lounge's orders (lib/kitchen loungeMaker)
// A team member signed in on their own device can list, move and bump tickets too (no key: their sign-in instead), so
// the front desk and the dashboard hand a lounge order over with this same step, never one of their own.
//   tickets { tenantId, key, eventId? }            → the tickets waiting, being made and ready, from both places they
//                                                    live (lib/kitchen), the items they use, and today's for the numbers
//   pin     { tenantId, key, pin }                 → who's working, checked here (lib/pin, with its lockout): a pass for
//                                                    this screen for 12 hours, so what they move carries their name
//   act     { tenantId, key, col, id, step, staffPass? } → one ticket moved along, once (lib/kitchen canStep).
//                                                    Delivering a lounge order uses up what it's made of (as
//                                                    lib/lounge-delivery does: a recipe's parts, or the item itself only
//                                                    if ordering didn't already take it), counts a member perk, adds it
//                                                    to the visit, and books money collected for a kiosk order at the
//                                                    station; cancelling one whose item was taken at ordering puts it back.
//   bump    { tenantId, key, tickets: [{col,id}], step, staffPass? } → a whole course or dish moved along at once
//   forget  { tenantId, key }                      → this screen stops working (set it up again to use it)
import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { limitPublic } from '@/lib/rate-limit';
import { findStaffByPin, pinLocked, recordPinAttempt, validPin } from '@/lib/pin';
import { moveStock } from '@/lib/usage';
import { buildEntry } from '@/lib/stock-ledger';
import { ticketFrom, canStep, collectAtHandover, loungeMaker, ACTIVE_STATUSES, type KitchenCol, type KitchenStep } from '@/lib/kitchen';
import { startOfDay, todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { accessLockOf } from '@/lib/tenant-access';

const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const hash = (k: string) => createHash('sha256').update(String(k)).digest('hex');
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const COLS: KitchenCol[] = ['refreshmentRequests', 'kdsTickets'];
const STEPS: KitchenStep[] = ['claim', 'release', 'ready', 'carry', 'drop', 'deliver', 'cancel'];
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const PASS_MS = 12 * 3600000, MAX_PASSES = 40;
export const maxDuration = 60;   // a whole course or a run of lounge orders moved at once

/** The screen this key belongs to (for this business only), or null. Seen-at is kept, at most every few minutes. */
async function screenOf(db: any, tenantId: string, key: unknown) {
  const k = String(key || '');
  if (k.length < 32 || k.length > 200) return null;
  const ref = db.doc(`kitchenScreens/${hash(k)}`);
  const s: any = (await ref.get()).data();
  if (!s || s.revokedAt || s.tenantId !== tenantId) return null;
  if (!s.lastSeenAt || Date.now() - Date.parse(s.lastSeenAt) > 5 * 60000) await ref.set({ lastSeenAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  return { ref, name: String(s.name || 'Kitchen'), passes: (s.passes && typeof s.passes === 'object' ? s.passes : {}) as Record<string, { id: string; name: string; exp: number }> };
}

/** Who a pass (from 'pin') says is working, while it's good; otherwise nobody (the screen's own name is used). */
function staffOf(screen: { passes: Record<string, { id: string; name: string; exp: number }> }, pass: unknown) {
  const p = String(pass || ''); if (p.length < 32 || p.length > 200) return null;
  const x = screen.passes[hash(p)];
  return x && Number(x.exp) > Date.now() ? { id: String(x.id), name: String(x.name) } : null;
}

/** One ticket moved along, in one step and once. */
async function act(db: any, tenantId: string, screen: { name: string }, col: KitchenCol, id: string, step: KitchenStep, staff: { id: string | null; name: string } | null) {
  const T = `tenants/${tenantId}`;
  const ref = db.doc(`${T}/${col}/${id}`);
  const now = new Date().toISOString();
  const by = staff?.name ? { staffId: staff.id || null, name: staff.name, via: screen.name } : { staffId: null, name: screen.name, via: screen.name };
  const actorId = by.staffId || 'kitchen';
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: 'That ticket is gone.', status: 404 };
    const r: any = snap.data() || {};
    if (!canStep(r.status, step)) return { already: true, status: r.status };
    // One person carries it: a second "I'll take it" (two people tapping at once) changes nothing.
    const carried = !!(r.carriedBy || r.bringingOutBy);   // the desk's older "Bringing it" counts as someone carrying it
    if ((step === 'carry' && carried) || (step === 'drop' && !carried)) return { already: true, status: r.status };
    const lounge = col === 'refreshmentRequests';
    const qty = Math.max(1, Math.round(num(r.quantity) || 1));
    const itemId = String(r.itemId || r.menuItemId || '');
    // Reads first (a transaction reads everything before it writes): the item and what it's made of, for a lounge
    // order's stock.
    let item: any = null; let tookItem = false; const parts: { ref: any; data: any; qty: number }[] = [];
    if (lounge && itemId && ID.test(itemId) && (step === 'deliver' || (step === 'cancel' && r.stockMoved === true && !r.stockReturned))) {
      const iRef = db.doc(`${T}/inventory/${itemId}`);
      item = (await tx.get(iRef)).data() || null;
      if (item && step === 'deliver') {
        // A recipe (a latte) uses up its parts now: ordering only took the item itself. A plain item is taken now only
        // if ordering didn't already.
        const recipe = Array.isArray(item.formula) && item.formula.length ? item.formula : null;
        const formula = recipe || (r.stockMoved === true ? [] : [{ id: itemId, quantityUsed: 1 }]);
        tookItem = !recipe && formula.length > 0;
        for (const f of formula) {
          const pid = String(f?.id || ''); if (!ID.test(pid)) continue;
          const same = parts.find((p) => p.ref.id === pid);   // a part listed twice is used once, in full
          if (same) { same.qty += num(f.quantityUsed) * qty; continue; }
          const pRef = db.doc(`${T}/inventory/${pid}`);
          const data = pid === itemId ? item : (await tx.get(pRef)).data();
          if (data) parts.push({ ref: pRef, data, qty: num(f.quantityUsed) * qty });
        }
      }
    }
    const patch: any = step === 'claim' ? { status: 'in_progress', claimedBy: by, claimedAt: now }
      : step === 'release' ? { status: 'pending', claimedBy: null, claimedAt: null }
      : step === 'ready' ? { status: 'ready', readyAt: now, ...(r.claimedBy ? {} : { claimedBy: by }) }
      // "I'll take it": still ready, now with someone carrying it (a lounge guest sees it's on its way). "Let someone
      // else" frees it again.
      : step === 'carry' ? { carriedBy: by.name, carriedAt: now, ...(lounge ? { bringingOutAt: now, bringingOutBy: by.name } : {}) }
      : step === 'drop' ? { carriedBy: null, carriedAt: null, ...(lounge ? { bringingOutAt: null, bringingOutBy: null } : {}) }
      : step === 'deliver' ? { status: 'delivered', deliveredAt: now, deliveredBy: by }
      : { status: 'cancelled', cancelledAt: now, cancelledBy: by };
    if (lounge && step === 'deliver' && parts.length) {
      // The same stock step as checkout (lib/usage moveStock): a product with no uses or size set is left alone.
      for (const p of parts) {
        const m = moveStock(p.data, p.qty); if (m.notCounted) continue;
        tx.set(p.ref, m.patch, { merge: true });
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: p.ref.id, type: 'used', delta: -p.qty, unit: String(p.data.unit || 'units'),
          reason: `Kitchen: ${String(r.itemName || 'item')} ×${qty} for ${String(r.clientName || 'a guest')}`, actorId, actorName: by.name, ref: { kind: 'order', id } }));
      }
      patch.partsUsed = true; if (tookItem) patch.stockMoved = true;
    }
    if (lounge && step === 'cancel' && r.stockMoved === true && !r.stockReturned && item) {
      tx.set(db.doc(`${T}/inventory/${itemId}`), { totalStock: FieldValue.increment(qty) }, { merge: true });
      tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: itemId, type: 'returned', delta: qty, reason: `Kitchen cancelled: ${String(r.itemName || 'item')} for ${String(r.clientName || 'a guest')}`, actorId, actorName: by.name, ref: { kind: 'order', id } }));
      patch.stockReturned = true;
    }
    if (lounge && step === 'deliver') {
      if (r.isRedemption === true && r.clientId && r.clientId !== 'guest-walkin' && ID.test(String(r.clientId)) && itemId) {
        tx.set(db.doc(`${T}/clients/${r.clientId}`), { subscription: { perkUsage: { [itemId]: FieldValue.increment(qty) }, perkLastUsed: now } }, { merge: true });
      }
      if (r.appointmentId && r.appointmentId !== 'guest-walkin' && ID.test(String(r.appointmentId))) {
        tx.set(db.doc(`${T}/appointments/${r.appointmentId}`), { checkoutState: { refreshments: FieldValue.arrayUnion({ id: itemId || id, name: String(r.itemName || 'Item'), price: num(r.priceAtRequest), deliveredAt: now, quantity: qty, isAccountedFor: true }) } }, { merge: true });
      } else if (collectAtHandover(r) > 0) {
        // A kiosk order to be paid at the station (lib/kitchen collectAtHandover: nothing was taken when it was ordered)
        // is collected as it's handed over, the same as the desk's delivery books it (lib/lounge-delivery): once, named
        // after the order.
        tx.set(db.doc(`${T}/transactions/kiosk_${id}`), { id: `kiosk_${id}`, date: now, description: `Lounge Guest Sale: ${String(r.itemName || 'Item')} (x${qty})`, clientOrVendor: String(r.clientName || 'Guest'),
          type: 'income', context: 'Business', category: 'Hospitality Revenue', amount: collectAtHandover(r), paymentMethod: 'Guest Kiosk Entry', hasReceipt: false, tenantId, conciergeRequestId: id, recordedBy: by.name });
      }
    }
    tx.set(ref, patch, { merge: true });
    return { ok: true, status: patch.status };
  });
}

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || '');
    if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    const db = getAdminDb();

    if (action === 'pair') {
      const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
      const key = randomBytes(32).toString('hex');
      const name = String(b.name || '').trim().slice(0, 40) || 'Kitchen';
      await db.doc(`kitchenScreens/${hash(key)}`).set({ tenantId, name, createdAt: new Date().toISOString(), createdBy: g.actor?.name || g.actor?.uid || 'manager', lastSeenAt: new Date().toISOString() });
      // The first kitchen screen takes over the lounge's orders, unless the business already chose the desk.
      const tRef = db.doc(`tenants/${tenantId}`); const t0: any = (await tRef.get()).data() || {};
      if (!t0.kitchenSettings?.loungeOrdersMadeBy) await tRef.set({ kitchenSettings: { loungeOrdersMadeBy: 'kitchen' } }, { merge: true });
      return ok({ key, name, maker: t0.kitchenSettings?.loungeOrdersMadeBy || 'kitchen' });
    }
    if (action === 'screens' || action === 'revoke' || action === 'maker') {
      const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
      if (action === 'maker') {
        const to = b.maker === 'kitchen' ? 'kitchen' : b.maker === 'desk' ? 'desk' : null; if (!to) return bad('The kitchen or the desk?');
        // Not while an order is being made: it would drop off the one screen without landing on the other.
        const making = await db.collection(`tenants/${tenantId}/refreshmentRequests`).where('status', '==', 'in_progress').limit(5).get();
        const was: any = (await db.doc(`tenants/${tenantId}`).get()).data();
        if (!making.empty && loungeMaker(was) !== to) return bad(`${making.size === 5 ? 'Some' : making.size} lounge ${making.size === 1 ? 'order is' : 'orders are'} being made right now. Switch once ${making.size === 1 ? 'it’s' : 'they’re'} done.`, 409);
        await db.doc(`tenants/${tenantId}`).set({ kitchenSettings: { loungeOrdersMadeBy: to } }, { merge: true });
        return ok({ maker: to });
      }
      if (action === 'revoke') {
        const id = String(b.id || ''); if (!/^[0-9a-f]{64}$/.test(id)) return bad('Which screen?');
        const ref = db.doc(`kitchenScreens/${id}`); const s: any = (await ref.get()).data();
        if (!s || s.tenantId !== tenantId) return bad('That screen isn’t here.', 404);
        await ref.set({ revokedAt: new Date().toISOString(), revokedBy: g.actor?.name || g.actor?.uid || 'manager' }, { merge: true });
        return ok();
      }
      const snap = await db.collection('kitchenScreens').where('tenantId', '==', tenantId).limit(50).get();
      const screens = snap.docs.map((d: any) => { const x: any = d.data() || {}; return { id: d.id, name: String(x.name || 'Kitchen'), createdAt: x.createdAt || null, createdBy: x.createdBy || null, lastSeenAt: x.lastSeenAt || null }; })
        .filter((_: any, i: number) => !(snap.docs[i].data() || {}).revokedAt).sort((a: any, b2: any) => String(b2.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
      return ok({ screens, maker: loungeMaker((await db.doc(`tenants/${tenantId}`).get()).data()) });
    }

    let screen: any = await screenOf(db, tenantId, b.key);
    // A team member signed in on their own device (the front desk, the dashboard, the host stand) takes the same steps,
    // under their own name. Setting up, stopping and PINs stay with a screen.
    let teamMember: { id: string; name: string } | null = null;
    if (!screen && !b.key && ['tickets', 'act', 'bump'].includes(action)) {
      const g: any = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
      // The business's own team only: a renter runs their own business here and never moves the shop's stock or money;
      // someone switched off isn't on the team any more.
      if (g.actor?.isRenter) return bad('This is for the business’s own team.', 403);
      const me: any = ID.test(String(g.actor?.uid || '')) ? (await db.doc(`tenants/${tenantId}/staff/${g.actor.uid}`).get()).data() : null;
      if (me && (me.isActive === false || me.status === 'archived' || me.archived === true)) return bad('This is for the business’s own team.', 403);
      teamMember = { id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'A team member').slice(0, 60) };
      screen = { ref: null, name: teamMember.name, passes: {} };
    }
    if (!screen) {
      // Guessing keys gets nowhere, but it isn't free to answer: a few dozen wrong tries an hour from one place.
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This screen isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }

    if (action === 'forget') { await screen.ref.set({ revokedAt: new Date().toISOString() }, { merge: true }); return ok(); }

    // A paused or closed business has its kitchen screen closed too (as the page itself is, app/kds layout).
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'The kitchen screen is closed for now. The business owner can tell you more.' }, { status: 403 });

    if (action === 'tickets') {
      const T = `tenants/${tenantId}`;
      const tz = tenantTimeZone(tenant);
      const since = startOfDay(todayIn(tz), tz).toISOString();
      const [la, ka, lt, kt] = await Promise.all([
        db.collection(`${T}/refreshmentRequests`).where('status', 'in', [...ACTIVE_STATUSES]).limit(1500).get(),
        db.collection(`${T}/kdsTickets`).where('status', 'in', [...ACTIVE_STATUSES]).limit(1500).get(),
        db.collection(`${T}/refreshmentRequests`).where('requestedAt', '>=', since).orderBy('requestedAt').limit(1500).get().catch(() => ({ docs: [] as any[] })),
        db.collection(`${T}/kdsTickets`).where('createdAt', '>=', since).orderBy('createdAt').limit(1500).get().catch(() => ({ docs: [] as any[] })),
      ]);
      const eventId = b.eventId && ID.test(String(b.eventId)) ? String(b.eventId) : null;
      // Lounge orders show here only when the kitchen makes them (lib/kitchen loungeMaker); otherwise the desk does.
      const lounge = loungeMaker(tenant) === 'kitchen' ? la.docs.map((d: any) => ticketFrom({ ...d.data(), id: d.id }, 'refreshmentRequests')) : [];
      let tickets = [...lounge, ...ka.docs.map((d: any) => ticketFrom({ ...d.data(), id: d.id }, 'kdsTickets'))];
      if (eventId) tickets = tickets.filter((t) => t.eventId === eventId);
      // The items they use: a picture and what each is made of (for the label), nothing about cost.
      const ids = Array.from(new Set(tickets.map((t) => String(t.itemId || '')).filter((x) => ID.test(x)))).slice(0, 100);
      const docs = ids.length ? await db.getAll(...ids.map((i) => db.doc(`${T}/inventory/${i}`))) : [];
      const items: Record<string, any> = {};
      for (const d of docs) { const x: any = d.data(); if (!x) continue; items[d.id] = { id: d.id, name: String(x.name || ''), imageUrl: x.imageUrl || null, unit: x.unit || null, formula: (Array.isArray(x.formula) ? x.formula : []).map((f: any) => ({ id: f.id, name: String(f.name || ''), quantityUsed: num(f.quantityUsed), unit: String(f.unit || '') })) }; }
      const today = [...lt.docs, ...kt.docs].map((d: any) => { const x: any = d.data() || {}; return { status: String(x.status || ''), at: String(x.requestedAt || x.createdAt || ''), deliveredAt: x.deliveredAt || null, item: String(x.itemName || x.menuItemName || '') }; });
      return ok({ screen: screen.name, business: { name: String(tenant.name || tenant.businessName || 'Kitchen'), timeZone: tz }, tickets, items, today });
    }

    if (action === 'pin') {
      const pin = String(b.pin || '');
      if (!validPin(pin)) return bad('Enter a 4-digit PIN.');
      if (await pinLocked(db, tenantId)) return bad('Too many wrong PINs. Wait 15 minutes, or ask a manager.', 423);
      const hit = await findStaffByPin(db, tenantId, pin);
      await recordPinAttempt(db, tenantId, !!hit);
      if (!hit) return bad('That PIN isn’t right.', 403);
      const pass = randomBytes(24).toString('hex'); const nowMs = Date.now();
      // This pass added on its own (two people signing in at once each keep theirs), and passes that have run out removed.
      const patch: any = { [`passes.${hash(pass)}`]: { id: hit.id, name: hit.name, exp: nowMs + PASS_MS } };
      // …and, past a few dozen still good, the oldest of those too (the screen's record stays small).
      const live = Object.entries(screen.passes as Record<string, { id: string; name: string; exp: number }>).filter(([h, x]) => Number(x?.exp) > nowMs && /^[0-9a-f]{64}$/.test(h)).sort((a, b2) => Number(a[1].exp) - Number(b2[1].exp));
      const drop = [...Object.entries(screen.passes as Record<string, { id: string; name: string; exp: number }>).filter(([h, x]) => !(Number(x?.exp) > nowMs) && /^[0-9a-f]{64}$/.test(h)), ...live.slice(0, Math.max(0, live.length - (MAX_PASSES - 1)))];
      for (const [h] of drop) patch[`passes.${h}`] = FieldValue.delete();
      await screen.ref.update(patch);
      return ok({ staff: { id: hit.id, name: hit.name }, pass });
    }

    // Who's working comes only from a pass this route gave (a PIN checked here), never from a name the screen sends; and
    // only while they're still on the team.
    let staff = teamMember || staffOf(screen, b.staffPass);
    if (staff && !teamMember) { const st: any = ID.test(staff.id) ? (await db.doc(`tenants/${tenantId}/staff/${staff.id}`).get()).data() : null; if (!st || st.isActive === false || st.status === 'archived') staff = null; }
    const staffOk = b.staffPass && !teamMember ? !!staff : undefined;   // a pass that no longer counts: the screen stops showing that name

    if (action === 'act') {
      const col = String(b.col || '') as KitchenCol; const id = String(b.id || ''); const step = String(b.step || '') as KitchenStep;
      if (!COLS.includes(col) || !ID.test(id) || !STEPS.includes(step)) return bad('That isn’t a ticket.');
      const r: any = await act(db, tenantId, screen, col, id, step, staff);
      if (r.error) return NextResponse.json({ ok: false, error: r.error, staffOk }, { status: r.status || 400 });
      return ok({ ...r, staffOk });
    }

    if (action === 'bump') {
      const step = String(b.step || '') as KitchenStep;
      if (!['ready', 'deliver'].includes(step)) return bad('Ready or served only.');
      const list = (Array.isArray(b.tickets) ? b.tickets : []).slice(0, 120).filter((t: any) => COLS.includes(t?.col) && ID.test(String(t?.id || '')));
      let moved = 0, failed = 0;
      const tally = (r: any) => { if (!r || (r.error && r.status !== 404)) failed++; else if (r.ok && !r.already) moved++; };   // a ticket that's gone isn't a failure
      const run = (t: any) => act(db, tenantId, screen, t.col, String(t.id), step, staff).catch(() => null);
      // Event and table tickets a few at a time, so a big course is quick. Lounge orders one by one: they share the
      // shelf, and several at once on the same item would only wait on each other (or give up).
      const kitchen = list.filter((t: any) => t.col === 'kdsTickets'), lounge = list.filter((t: any) => t.col === 'refreshmentRequests');
      for (let i = 0; i < kitchen.length; i += 8) (await Promise.all(kitchen.slice(i, i + 8).map(run))).forEach(tally);
      for (const t of lounge) tally(await run(t));
      return ok({ moved, failed, of: list.length, staffOk });
    }

    return bad('Unknown action.');
  } catch (err) {
    console.error('[kitchen] failed', err);
    return bad('That didn’t go through. Try again.', 500);
  }
}
