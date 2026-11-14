// src/app/api/tab/route.ts — A TABLE'S TAB, the steps that need the server (lib/table-service has the rules). Anyone on
// the team, signed in; what needs a manager is checked here with a single-use approval from api/approvals (a manager's
// PIN on this screen, or their phone), never taken on the browser's word.
//   need   { tenantId, visitId, lineId, kind: 'comp'|'void', cents? } → whether a manager's PIN is needed, and why
//   comp   { tenantId, visitId, lineId, cents? | all, reason, approvalToken? } → served and kept, at no charge or part off.
//          Within the server's own allowance tonight: on their say. Over it: a manager's approval. Once per item.
//   void   { tenantId, visitId, lineId, reason, approvalToken?, stopKitchen? } → off the check. Before the kitchen starts:
//          a reason. After: a manager's approval, and what it cost to make counts as waste. stopKitchen (on unless false)
//          takes it off the station's screen.
//   remake { tenantId, visitId, lineId, reason } → a started item made again (dropped, not right): the first counts as
//          waste, the line stays on the check once, and a fresh ticket goes to its station.
//   fire   { tenantId, visitId, course } → a held course goes to the kitchen now.
//   allergies { tenantId, visitId, op: 'save' | 'remove' | 'asked' | 'seed', allergy?, id? } → the table's allergies
//          (lib/allergens), changed one at a time by id in a single save that also brings every ticket the kitchen
//          hasn't sent out up to date (a change asks the station for "Allergy noted" again, a plate at the pass too).
//          'asked': the table was asked and nobody else has one. 'seed': a regular's profile allergies, once per visit
//          (only when the profile could be read).
//   seat   { tenantId, visitId, lineId, seat } → the item moves to another seat (or the table: seat null). Its ticket
//          takes that seat's allergies (lib/allergens), and asks for "Allergy noted" again if they're different.
// Every comp, void and remake is kept as an approval record (tenants/{t}/approvals, which no browser can write): who
// asked, who approved, why, the item, the night it belongs to, and the waste. The night's report reads them; checkout
// checks a comp against its record before charging less.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { consumeApproval, isApprover } from '@/lib/approvals';
import { tonight } from '@/lib/night-close-server';
import { compAllowanceCents, kitchenStarted, listPriceOf, needsManager, round2, OTHER_REASON } from '@/lib/table-service';
import { cleanAllergy, profileAllergy, tableAllergies, ticketAllergyFields, ticketAllergyPatch, MAX_TABLE_ALLERGIES } from '@/lib/allergens';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
class Stop extends Error { constructor(public msg: string, public status = 409) { super(msg); } }
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** What one made costs, for waste: the item's cost in Inventory, when it has one (the first that's more than 0). */
async function costToMake(db: any, T: string, itemId: string, qty: number): Promise<number | null> {
  if (!ID.test(itemId)) return null;
  const x: any = (await db.doc(`${T}/inventory/${itemId}`).get()).data();
  const c = [x?.costPerUnit, x?.unitCost].map(Number).find((n) => Number.isFinite(n) && n > 0);
  return c ? round2(c * Math.max(1, qty)) : null;
}

/** Where a server's own comps tonight are counted: a tally kept with the approvals (where no browser can write), read and
 *  added to in the same save as each comp, so two comps at once can't both slip under the allowance. */
const tallyPath = (T: string, day: string, uid: string) => `${T}/approvals/tally_${day}_${String(uid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`;
const tallyCents = (d: any) => Math.max(0, Math.round(Number(d?.cents) || 0));

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), action = String(b.action || '');
  const visitId = String(b.visitId || ''), lineId = String(b.lineId || '');
  if (!ID.test(tenantId) || !ID.test(visitId)) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Sign in to do that.', auth.status || 401);
  const me = { id: String(auth.actor.uid), name: String(auth.actor.name || 'A team member') };
  const manager = auth.actor.isManager === true || isApprover(auth.actor.role);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const vRef = db.doc(`${T}/appointments/${visitId}`);
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  // The night it belongs to, the same as the night's report counts it (lib/night-close-server).
  const day = tonight(tenant);
  const now = new Date().toISOString();

  const readLine = async () => {
    const v: any = (await vRef.get()).data();
    if (!v) throw new Stop('That table’s visit wasn’t found.', 404);
    if (v.status === 'completed' && v.checkoutSessionId) throw new Stop('That table has already paid.');
    const line = (Array.isArray(v.tab) ? v.tab : []).find((l: any) => l?.lineId === lineId);
    if (!line) throw new Stop('That item isn’t on the tab any more.', 404);
    const k: any = line.kdsId && ID.test(String(line.kdsId)) ? (await db.doc(`${T}/kdsTickets/${line.kdsId}`).get()).data() : null;
    return { v, line, ticket: k || null, started: kitchenStarted(k?.status) };
  };
  const reasonOf = () => { const r = words(b.reason, 80); return r && r !== OTHER_REASON ? r : ''; };
  // A record of what was done, where no browser can change it (an approval used once, or one written here). Written in
  // the same save as the change it records, so there's never one without the other.
  const recordRef = (token: string | null) => (token ? db.doc(`${T}/approvals/${token}`) : db.collection(`${T}/approvals`).doc());
  const recordOf = (ref: any, kind: 'comp' | 'void_item' | 'remake', token: string | null, extra: Record<string, any>) => ({
    ...(token ? {} : { id: ref.id, kind, status: 'approved', approverId: me.id, approverName: me.name, requestedBy: me.name, requestedById: me.id, via: manager ? 'manager' : 'self',
      createdAt: now, expiresAt: now, used: true, usedAt: now }),
    ref: `${visitId}:${lineId}`, day, visitId, lineId, ...extra });

  // A manager's approval used for a change that then didn't go through is given back, so their PIN isn't wasted.
  const giveBackOnFail = async (token: string | null, run: () => Promise<any>) => {
    try { return await run(); } catch (e) { if (token) await db.doc(`${T}/approvals/${token}`).set({ used: false, usedAt: null }, { merge: true }).catch(() => {}); throw e; }
  };

  try {
    if (action === 'fire') {
      const n = Math.floor(Number(b.course));
      if (!Number.isInteger(n) || n < 1 || n > 9) return bad('Pick a course to fire.');
      const fired = await db.runTransaction(async (tx: any) => {
        const v: any = (await tx.get(vRef)).data();
        if (!v) throw new Stop('That table’s visit wasn’t found.', 404);
        if (v.status === 'completed' && v.checkoutSessionId) throw new Stop('That table has already paid.');
        const tab: any[] = Array.isArray(v.tab) ? v.tab : [];
        const lines = tab.filter((l) => Number(l?.course) === n && !l?.firedAt);
        const refs = lines.filter((l) => l.kdsId && ID.test(String(l.kdsId))).map((l) => db.doc(`${T}/kdsTickets/${l.kdsId}`));
        const snaps = refs.length ? await Promise.all(refs.map((r: any) => tx.get(r))) : [];
        // Waiting to be fired, or taken off after 16 hours untouched (api/kitchen): either way the kitchen gets it now.
        snaps.forEach((s: any, i: number) => { const k: any = s.exists ? s.data() || {} : null;
          if (k && (String(k.status) === 'unfired' || (String(k.status) === 'cancelled' && k.cancelReason === 'never fired'))) tx.set(refs[i], { status: 'pending', requestedAt: now, firedAt: now, firedBy: me.name, cancelReason: null, cancelledAt: null }, { merge: true }); });
        if (!lines.length) return 0;
        tx.set(vRef, { tab: tab.map((l) => (Number(l?.course) === n && !l?.firedAt ? { ...l, firedAt: now } : l)), updatedAt: now }, { merge: true });
        return lines.length;
      });
      return ok({ fired });
    }

    if (action === 'allergies') {
      const op = String(b.op || '');
      if (!['save', 'remove', 'asked', 'seed'].includes(op)) return bad('What should change?');
      // A regular's profile, read before the save; a profile that couldn't be read leaves the visit unseeded, to try again.
      let profile: any = null;
      if (op === 'seed') {
        const v0: any = (await vRef.get()).data();
        if (!v0) return bad('That table’s visit wasn’t found.', 404);
        if (v0.allergiesSeeded) return ok({ allergies: tableAllergies(v0), seeded: false });
        const cid = String(v0.clientId || '');
        if (ID.test(cid) && cid !== 'guest-walkin') {
          let c: any; try { c = (await db.doc(`${T}/clients/${cid}`).get()).data() || null; } catch { return bad('Their profile couldn’t be read. Try again.', 503); }
          profile = c ? profileAllergy(c, me.name, now) : null;
        }
      }
      const fresh = op === 'save' ? cleanAllergy(b.allergy, me.name, now) : null;
      if (op === 'save' && !fresh) return bad('Pick what they’re allergic to, or write it in.');
      const list = await db.runTransaction(async (tx: any) => {
        const v: any = (await tx.get(vRef)).data();
        if (!v) throw new Stop('That table’s visit wasn’t found.', 404);
        if (v.status === 'completed' && v.checkoutSessionId) throw new Stop('That table has already paid.');
        const tab: any[] = Array.isArray(v.tab) ? v.tab : [];
        const lines = tab.filter((l) => l?.kdsId && ID.test(String(l.kdsId)));
        const snaps = lines.length ? await Promise.all(lines.map((l) => tx.get(db.doc(`${T}/kdsTickets/${l.kdsId}`)))) : [];
        let next = tableAllergies(v);
        if (op === 'seed') { if (v.allergiesSeeded) return next; if (profile && !next.some((a) => a.from === 'profile')) next = [...next, profile]; }
        if (op === 'remove') next = next.filter((a) => a.id !== String(b.id || ''));
        if (op === 'save' && fresh) {
          const i = next.findIndex((a) => a.id === fresh.id);
          if (i >= 0) next = next.map((a, j) => (j === i ? { ...fresh, from: a.from, by: a.by, at: a.at } : a));
          else { if (next.length >= MAX_TABLE_ALLERGIES) throw new Stop(`Up to ${MAX_TABLE_ALLERGIES} allergies a table.`, 400); next = [...next, fresh]; }
        }
        tx.set(vRef, { allergies: next, ...(op === 'seed' ? { allergiesSeeded: true } : { allergiesAsked: true }), updatedAt: now }, { merge: true });
        // Every ticket not yet out, for the seat it's for (and the whole table's), in the same save.
        snaps.forEach((sn: any, i: number) => { const k: any = sn.exists ? sn.data() || {} : null; if (!k) return;
          const p = ticketAllergyPatch(k, next, lines[i].seat || null, Array.isArray(lines[i].allergens) ? lines[i].allergens : []);
          if (p) tx.set(db.doc(`${T}/kdsTickets/${lines[i].kdsId}`), p, { merge: true }); });
        return next;
      });
      return ok({ allergies: list });
    }

    if (!ID.test(lineId)) return bad('Pick an item on the tab.');

    if (action === 'seat') {
      const seat = b.seat === null || b.seat === '' ? null : String(b.seat);
      if (seat !== null && !/^\d{1,2}$/.test(seat)) return bad('Pick a seat.');
      await db.runTransaction(async (tx: any) => {
        const v: any = (await tx.get(vRef)).data(); const tab: any[] = Array.isArray(v?.tab) ? v.tab : [];
        if (v?.status === 'completed' && v?.checkoutSessionId) throw new Stop('That table has already paid.');
        const l = tab.find((x) => x?.lineId === lineId); if (!l) throw new Stop('That item isn’t on the tab any more.', 404);
        const kRef = l.kdsId && ID.test(String(l.kdsId)) ? db.doc(`${T}/kdsTickets/${l.kdsId}`) : null;
        const k: any = kRef ? (await tx.get(kRef)).data() : null;
        tx.set(vRef, { tab: tab.map((x) => (x.lineId === lineId ? { ...x, seat } : x)), updatedAt: now }, { merge: true });
        // The new seat's allergies go with it (and the whole table's), so the kitchen never makes it for the old seat.
        if (kRef && k) tx.set(kRef, { seatNumber: seat, ...(ticketAllergyPatch(k, tableAllergies(v), seat, Array.isArray(l.allergens) ? l.allergens : []) || {}) }, { merge: true });
      });
      return ok({ seat });
    }

    if (action === 'need') {
      const { line, started } = await readLine();
      const kind = b.kind === 'void' ? 'void' : 'comp';
      const allowance = compAllowanceCents(tenant);
      const used = kind === 'comp' && !manager ? tallyCents((await db.doc(tallyPath(T, day, me.id)).get()).data()) : 0;
      const priceCents = Math.round((Number(line.price) || 0) * 100);
      const asked = Math.round(Number(b.cents) || 0);
      const cents = kind === 'comp' ? (asked > 0 ? Math.min(asked, priceCents) : priceCents) : 0;
      const n = needsManager({ kind, actorIsManager: manager, amountCents: cents, usedTonightCents: used, allowanceCents: allowance, started });
      return ok({ pin: n.pin, why: n.why, started, allowanceLeftCents: manager ? null : Math.max(0, allowance - used), comped: !!line.comp });
    }

    if (action === 'comp') {
      const reason = reasonOf(); if (!reason) return bad('Say why it’s comped.');
      const { line, v } = await readLine();
      if (line.comp) return bad(`${line.name} is already comped. Void it instead, or ask a manager.`);
      if (line.itemType !== 'product') return bad('Only food and drink can be comped here.');
      const list = listPriceOf(line); const price = round2(Number(line.price) || 0);
      const cents = b.all === true ? Math.round(price * 100) : Math.round(Number(b.cents) || 0);
      if (!(cents > 0)) return bad('Say how much to take off.');
      if (cents > Math.round(price * 100)) return bad(`That’s more than ${line.name} costs (${money(price)}).`);
      const amount = cents / 100;
      const allowance = compAllowanceCents(tenant);
      const used = manager ? 0 : tallyCents((await db.doc(tallyPath(T, day, me.id)).get()).data());
      const need = needsManager({ kind: 'comp', actorIsManager: manager, amountCents: cents, usedTonightCents: used, allowanceCents: allowance });
      let approvedBy = me.name; let token: string | null = null;
      if (need.pin) {
        const a = await consumeApproval(db, tenantId, b.approvalToken, { kind: 'comp', amount, ref: `${visitId}:${lineId}`, covers: (x: any) => x.ref === `${visitId}:${lineId}` });
        if (!a) return bad(`${need.why} Ask a manager for their PIN.`, 403);
        if (a.approverId === me.id) return bad('Someone else has to approve your comp.', 403);
        approvedBy = a.approverName; token = String(b.approvalToken);
      }
      const extra = { amount, itemName: String(line.name || 'Item').slice(0, 80), itemId: line.itemId || null, listPrice: list, reason, tableName: v.tableName || null, askedBy: me.name, approverName: approvedBy };
      const rRef = recordRef(token); const approvalId = rRef.id;
      const selfComp = !manager && !token; const tRef = db.doc(tallyPath(T, day, me.id));
      await giveBackOnFail(token, () => db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(vRef)).data(); const tab: any[] = Array.isArray(cur?.tab) ? cur.tab : [];
        const tally: any = selfComp ? (await tx.get(tRef)).data() : null;
        const l = tab.find((x) => x?.lineId === lineId);
        if (!l) throw new Stop('That item came off the tab while this was being done.', 409);
        if (l.comp) throw new Stop(`${l.name} was comped by someone else just now.`, 409);
        // Counted again here, in the save: another comp of theirs may have gone through since the check above.
        if (selfComp) {
          if (needsManager({ kind: 'comp', actorIsManager: false, amountCents: cents, usedTonightCents: tallyCents(tally), allowanceCents: allowance }).pin) throw new Stop('That’s over your allowance for tonight now, so a manager approves. Ask a manager for their PIN.', 403);
          tx.set(tRef, { id: tRef.id, kind: 'tally', day, staffId: me.id, staffName: me.name, cents: tallyCents(tally) + cents, updatedAt: now }, { merge: true });
        }
        tx.set(vRef, { tab: tab.map((x) => (x.lineId === lineId ? { ...x, listPrice: list, price: round2(Number(x.price) - amount), comp: { approvalId, amount, reason, by: me.name, approvedBy, at: now } } : x)), updatedAt: now }, { merge: true });
        tx.set(rRef, recordOf(rRef, 'comp', token, extra), { merge: true });
      }));
      await logAuditAdmin(db, tenantId, { action: 'tab.comp', targetType: 'appointment', targetId: visitId, amount, summary: `${me.name} comped ${line.name} (${money(amount)}) at ${v.tableName || 'a table'}: ${reason}${approvedBy !== me.name ? `. ${approvedBy} approved.` : ''}`, actor: { type: 'user', id: me.id, name: me.name } } as any).catch(() => {});
      return ok({ amount, approvedBy });
    }

    if (action === 'void') {
      const reason = reasonOf(); if (!reason) return bad('Say why it’s coming off.');
      const { line, ticket, started, v } = await readLine();
      const need = needsManager({ kind: 'void', actorIsManager: manager, started });
      let approvedBy = me.name; let token: string | null = null;
      if (need.pin) {
        const a = await consumeApproval(db, tenantId, b.approvalToken, { kind: 'void_item', ref: `${visitId}:${lineId}`, covers: (x: any) => x.ref === `${visitId}:${lineId}` });
        if (!a) return bad(`${need.why} Ask a manager for their PIN.`, 403);
        if (a.approverId === me.id) return bad('Someone else has to approve your void.', 403);
        approvedBy = a.approverName; token = String(b.approvalToken);
      }
      const stop = b.stopKitchen !== false;
      const waste = started ? await costToMake(db, T, String(line.itemId || ''), Number(line.quantity) || 1) : null;
      const amount = round2((Number(line.price) || 0) * (Number(line.quantity) || 1));
      const rRef = recordRef(token);
      const extra = { amount, itemName: String(line.name || 'Item').slice(0, 80), itemId: line.itemId || null, reason, started, wasteCost: waste, stopped: started ? stop : null, ticketStatus: ticket?.status || null,
        tableName: v.tableName || null, askedBy: me.name, approverName: approvedBy, comped: !!line.comp };
      await giveBackOnFail(token, () => db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(vRef)).data(); const tab: any[] = Array.isArray(cur?.tab) ? cur.tab : [];
        const kRef = line.kdsId && ID.test(String(line.kdsId)) ? db.doc(`${T}/kdsTickets/${line.kdsId}`) : null;
        const k: any = kRef ? (await tx.get(kRef)).data() : null;
        if (!tab.some((x) => x?.lineId === lineId)) throw new Stop('That item is already off the tab.', 409);
        // Started after the check above was made: it needs what a started item needs.
        if (!started && kitchenStarted(k?.status) && !manager) throw new Stop('The kitchen started it just now, so a manager approves. Try again.', 409);
        tx.set(vRef, { tab: tab.filter((x) => x.lineId !== lineId), updatedAt: now }, { merge: true });
        if (kRef && k) {
          const st = String(k.status || '');
          if (!kitchenStarted(st) || (stop && st !== 'delivered')) tx.set(kRef, { status: 'cancelled', cancelledAt: now, voided: true, voidReason: reason }, { merge: true });
          else tx.set(kRef, { voided: true, voidReason: reason }, { merge: true });
        }
        tx.set(rRef, recordOf(rRef, 'void_item', token, extra), { merge: true });
      }));
      await logAuditAdmin(db, tenantId, { action: 'tab.void', targetType: 'appointment', targetId: visitId, amount, summary: `${me.name} voided ${line.name} (${money(amount)}) at ${v.tableName || 'a table'}: ${reason}${started ? `. The kitchen had started it${waste !== null ? `; ${money(waste)} counts as waste` : ''}.` : ''}${approvedBy !== me.name ? ` ${approvedBy} approved.` : ''}`, actor: { type: 'user', id: me.id, name: me.name } } as any).catch(() => {});
      return ok({ amount, started, waste, approvedBy });
    }

    if (action === 'remake') {
      const reason = reasonOf(); if (!reason) return bad('Say why it’s being made again.');
      const { line, ticket, started, v } = await readLine();
      if (!ticket || !line.kdsId) return bad(`${line.name} doesn’t go to the kitchen, so there’s nothing to make again.`);
      if (!started) return bad(`${line.name} hasn’t been started yet. It’s still on its way.`);
      const waste = await costToMake(db, T, String(line.itemId || ''), Number(line.quantity) || 1);
      const oldRef = db.doc(`${T}/kdsTickets/${line.kdsId}`);
      const newId = `${String(line.kdsId).replace(/_r[a-z0-9]+$/, '').slice(0, 140)}_r${Date.now().toString(36)}`;
      const newRef = db.doc(`${T}/kdsTickets/${newId}`); const rRef = recordRef(null);
      await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(vRef)).data(); const tab: any[] = Array.isArray(cur?.tab) ? cur.tab : [];
        const k: any = (await tx.get(oldRef)).data() || {};
        const l = tab.find((x) => x?.lineId === lineId);
        if (!l || l.kdsId !== line.kdsId) throw new Stop('That item changed while this was being done. Try again.', 409);
        // Its allergies go with it; the station says "Allergy noted" again for the new plate.
        const keep = Object.fromEntries(Object.entries(k).filter(([f]) => !['claimedBy', 'claimedAt', 'readyAt', 'deliveredAt', 'carriedBy', 'carriedAt', 'bringingOutBy', 'bringingOutAt', 'cancelledAt', 'voided', 'voidReason', 'remadeAs', 'allergyNotedAt', 'allergyNotedBy'].includes(f)));
        // The table's allergies as they stand now (one may have been added since the first plate).
        const al = ticketAllergyFields(tableAllergies(cur), l.seat || null, Array.isArray(l.allergens) ? l.allergens : []);
        tx.set(newRef, { ...keep, allergies: al.allergies, contains: al.contains, id: newId, status: 'pending', createdAt: now, requestedAt: now, firedAt: now, remakeOf: line.kdsId, remakeReason: reason, note: [`Remake: ${reason}`, k.note].filter(Boolean).join('. ').slice(0, 200) });
        if (String(k.status) !== 'delivered') tx.set(oldRef, { status: 'cancelled', cancelledAt: now, remadeAs: newId }, { merge: true });
        else tx.set(oldRef, { remadeAs: newId }, { merge: true });
        tx.set(vRef, { tab: tab.map((x) => (x.lineId === lineId ? { ...x, kdsId: newId } : x)), updatedAt: now }, { merge: true });
        tx.set(rRef, recordOf(rRef, 'remake', null, { amount: 0, itemName: String(line.name || 'Item').slice(0, 80), itemId: line.itemId || null, reason, started: true, wasteCost: waste, ticketStatus: ticket.status || null, tableName: v.tableName || null, askedBy: me.name, approverName: me.name, newTicket: newId }));
      });
      await logAuditAdmin(db, tenantId, { action: 'tab.remake', targetType: 'appointment', targetId: visitId, summary: `${me.name} had ${line.name} made again at ${v.tableName || 'a table'}: ${reason}${waste !== null ? `. ${money(waste)} counts as waste.` : ''}`, actor: { type: 'user', id: me.id, name: me.name } } as any).catch(() => {});
      return ok({ waste, ticket: newId });
    }

    return bad('Unknown action.');
  } catch (e: any) {
    if (e instanceof Stop) return bad(e.msg, e.status);
    console.error('[tab]', e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
