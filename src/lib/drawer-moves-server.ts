// src/lib/drawer-moves-server.ts — CASH IN AND OUT OF THE DRAWER, FOR SOMETHING OTHER THAN A SALE (server; design board
// "Register tools, part 2", part 3; api/counter 'drawer'; components/pos/DrawerMove). The drawer that's open (the one
// cash sales go into: lib/counter-server payOrder), and three ways cash moves:
// - Pay out: cash taken out to pay for something (milk from the store). An expense on the books (Supplies, paid in
//   cash), with a photo of the receipt when there is one. A manager's.
// - Put in: cash added (more change). Only on the drawer's count. A manager's (a put in that never happened would hide
//   cash taken).
// - To the safe: cash taken out to the safe while the drawer's full. Only off the drawer's count, not an expense. A
//   manager's.
// Each one is kept on the drawer (who did it, who okayed it, what for), so the count when it's closed adds up, and the
// night report lists them. A manager can undo one while the drawer is open (a pay out's expense is given back).
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
type Who = { id: string | null; name: string };

export type DrawerKind = 'out' | 'in' | 'drop';
export const DRAWER_MAX_CENTS = 1000000;
const WORDS: Record<DrawerKind, string> = { out: 'Paid out', in: 'Put in', drop: 'To the safe' };
// (Opened with no sale, lib drawerNoSale: on the drawer's record, no money moved.)
/** A photo of a receipt as this business's uploads keep it (its storage address, in its own uploads), or none. */
const receiptOk = (u: unknown, tenantId: string) => {
  if (typeof u !== 'string' || u.length > 1500) return null;
  // (The object's own path starts in this business's uploads: anything after a "?" is never the path.)
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[A-Za-z0-9._-]{1,120}\/o\/([^?\s"'<>]{10,1200})(\?[^\s"'<>]*)?$/.exec(u);
  return m && m[1].startsWith(`tenants%2F${encodeURIComponent(tenantId)}%2Fuploads%2F`) ? u : null;
};

/** Cash in or out of the open drawer. `approver`: the manager who okayed it (every move needs one). */
export async function drawerMove(db: any, tenantId: string, kindRaw: unknown, centsRaw: unknown, noteRaw: unknown, who: Who, approver: Who | null, opts: { receiptUrl?: unknown; key?: unknown } = {}) {
  const kind = (['out', 'in', 'drop'] as const).find((k) => k === kindRaw); if (!kind) return fail('Pay out, put in, or to the safe?', 400);
  const cents = Math.round(num(centsRaw)); if (!(cents > 0) || cents > DRAWER_MAX_CENTS) return fail('How much? More than $0.', 400, 'amount');
  const note = String(noteRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (kind !== 'drop' && !note) return fail(kind === 'out' ? 'What was it for?' : 'What is it for?', 400, 'note');
  if (!approver) return fail(`${kind === 'out' ? 'A pay out' : kind === 'in' ? 'Putting cash in' : 'Cash to the safe'} takes a manager. Their PIN, or ask one to.`, 403, 'manager');
  // (One move however often it's sent: the screen's own key for it.)
  const key = /^[A-Za-z0-9_-]{8,64}$/.test(String(opts.key || '')) ? String(opts.key) : null;
  if (!key) return fail('Try again.', 400, 'key');
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  const receiptUrl = kind === 'out' ? receiptOk(opts.receiptUrl, tenantId) : null;
  return db.runTransaction(async (tx: any) => {
    const tills = (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs;
    if (!tills.length) return fail('No drawer is open. Open it from the front desk’s till first.', 409, 'closed');
    if (tills.length > 1) return fail('More than one drawer is open. Close the extra one from the front desk’s till first.', 409, 'two');
    const till = tills[0]; const t: any = till.data() || {};
    const moves: any[] = Array.isArray(t.cashMoves) ? t.cashMoves : [];
    const same = moves.find((m) => m?.key === key);
    if (same) return { ok: true as const, already: true, kind, cents: Math.round(num(same.cents)), expectedCash: Math.round(num(t.expectedCash) * 100) / 100, words: WORDS[kind] };
    const expected = Math.round(num(t.expectedCash) * 100);
    if (kind !== 'in' && cents > expected) return fail(`The drawer should only have $${(expected / 100).toFixed(2)}. Count it, or take out less.`, 409, 'more_than');
    const after = kind === 'in' ? expected + cents : expected - cents;
    const move = { key, kind, cents, note: note || null, by: who.name.slice(0, 60), byId: who.id && ID.test(who.id) ? who.id : null, ...(approver ? { approvedBy: approver.name.slice(0, 60) } : {}), at: nowIso, ...(receiptUrl ? { receiptUrl } : {}) };
    const field = kind === 'out' ? 'totalPaidOut' : kind === 'in' ? 'totalPaidIn' : 'totalDrops';
    // (Worked out in whole cents from the drawer as it was read in this same step, so it never drifts by a fraction.)
    tx.set(till.ref, { expectedCash: after / 100, [field]: Math.round(num(t[field]) * 100 + cents) / 100, cashMoves: [...moves, move].slice(-200), updatedAt: nowIso }, { merge: true });
    // A pay out is an expense, paid in cash (on the books the day it went).
    if (kind === 'out') {
      const ref = db.collection(`${T}/transactions`).doc(`drawer_${till.id}_${key}`);
      tx.set(ref, { id: ref.id, description: `Paid out of the drawer: ${note}`, clientOrVendor: 'Paid out of the drawer', type: 'expense', context: 'Business', category: 'Supplies', taxBucket: 'operating_cost', amount: cents / 100,
        paymentMethod: 'Cash', hasReceipt: !!receiptUrl, ...(receiptUrl ? { receiptUrl } : {}), tillSessionId: till.id, ...(t.locationId ? { locationId: String(t.locationId) } : {}), recordedBy: who.name.slice(0, 60), approvedBy: approver?.name || null, date: nowIso });
    }
    return { ok: true as const, kind, cents, expectedCash: after / 100, tillId: till.id, words: WORDS[kind] };
  });
}

/** A move undone by a manager while the drawer's open: the count back as it was, and a pay out's expense given back. */
export async function drawerUndo(db: any, tenantId: string, keyRaw: unknown, who: Who, approver: Who | null) {
  if (!approver) return fail('Undoing it takes a manager. Their PIN, or ask one to.', 403, 'manager');
  const key = String(keyRaw || ''); if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return fail('Which one?', 400);
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const tills = (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs;
    if (tills.length !== 1) return fail('That drawer is closed already, so it stays as it was counted.', 409, 'closed');
    const till = tills[0]; const t: any = till.data() || {};
    const moves: any[] = Array.isArray(t.cashMoves) ? t.cashMoves : [];
    if ((Array.isArray(t.noSaleLog) ? t.noSaleLog : []).some((x: any) => x?.key === key)) return fail('Opening the drawer stays on its record.', 409, 'nosale');
    const m = moves.find((x) => x?.key === key); if (!m) return fail('That isn’t on this drawer.', 404);
    if (m.undoneAt) return { ok: true as const, already: true, kind: m.kind as DrawerKind, cents: Math.round(num(m.cents)), words: WORDS[m.kind as DrawerKind] };
    const cents = Math.round(num(m.cents)); const kind = m.kind as DrawerKind;
    // (Taking back a put in or giving back a drop never leaves the drawer below none.)
    if (kind === 'in' && cents > Math.round(num(t.expectedCash) * 100)) return fail('Less than that should be in the drawer now. Count it first.', 409, 'more_than');
    const field = kind === 'out' ? 'totalPaidOut' : kind === 'in' ? 'totalPaidIn' : 'totalDrops';
    const exp = Math.round(num(t.expectedCash) * 100);
    tx.set(till.ref, { expectedCash: (kind === 'in' ? exp - cents : exp + cents) / 100, [field]: Math.max(0, Math.round(num(t[field]) * 100) - cents) / 100,
      cashMoves: moves.map((x) => (x?.key === key ? { ...x, undoneAt: nowIso, undoneBy: approver.name.slice(0, 60) } : x)), updatedAt: nowIso }, { merge: true });
    if (kind === 'out') {
      const ref = db.collection(`${T}/transactions`).doc(`drawer_${till.id}_${key}_undo`);
      tx.set(ref, { id: ref.id, description: `Pay out undone: ${String(m.note || '').slice(0, 80)}`, clientOrVendor: 'Paid out of the drawer', type: 'reversal', context: 'Business', category: 'Supplies', taxBucket: 'operating_cost', amount: cents / 100,
        paymentMethod: 'Cash', hasReceipt: false, tillSessionId: till.id, ...(t.locationId ? { locationId: String(t.locationId) } : {}), recordedBy: who.name.slice(0, 60), approvedBy: approver.name.slice(0, 60), date: nowIso });
    }
    return { ok: true as const, kind, cents, words: WORDS[kind] };
  });
}

/** The drawer opened with no sale (to make change, to check the count): on the open drawer's record, by who and why,
 *  then opened on the receipt printer it's plugged into. Someone signed in here does it, so it's theirs. Kept apart from
 *  the money moves (its own list, and a count of every one), so a busy day's openings never crowd them out. */
export async function drawerNoSale(db: any, tenantId: string, reasonRaw: unknown, who: Who, opts: { key?: unknown; printerId?: unknown } = {}) {
  if (!who.id || !ID.test(who.id)) return fail('Enter your PIN first, so it’s on record as yours.', 403, 'staff');
  const note = String(reasonRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60); if (!note) return fail('Why is it opening?', 400, 'note');
  const key = /^[A-Za-z0-9_-]{8,64}$/.test(String(opts.key || '')) ? String(opts.key) : null; if (!key) return fail('Try again.', 400, 'key');
  const T = `tenants/${tenantId}`; const nowIso = new Date().toISOString();
  const { printersOf, queueJob } = await import('@/lib/printing-server'); const { drawerDoc } = await import('@/lib/printing');
  const drawers = (await printersOf(db, T)).filter((p: any) => p.drawer);
  const want = String(opts.printerId || ''); const at = drawers.find((p: any) => p.id === want) || (drawers.length === 1 ? drawers[0] : null);
  if (!drawers.length) return fail('No printer here opens a cash drawer. Turn it on in Printers.', 409, 'no_printer');
  if (!at) return fail('More than one printer opens a drawer. Pick this screen’s receipt printer, the one with the drawer.', 409, 'pick_printer');
  // (On the record first, then opened: a drawer is never opened without it. Asked again with the same key: opened only
  // if the first try's opening didn't go.)
  const r: any = await db.runTransaction(async (tx: any) => {
    const tills = (await tx.get(db.collection(`${T}/tillSessions`).where('status', '==', 'open').limit(2))).docs;
    if (!tills.length) return fail('No drawer is open. Open it from the front desk’s till first.', 409, 'closed');
    if (tills.length > 1) return fail('More than one drawer is open. Close the extra one from the front desk’s till first.', 409, 'two');
    const t: any = tills[0].data() || {}; const log: any[] = Array.isArray(t.noSaleLog) ? t.noSaleLog : [];
    const had = log.find((m) => m?.key === key);
    if (had) return { ok: true as const, already: true, opened: had.opened === true, tillRef: tills[0].ref };
    tx.set(tills[0].ref, { noSaleLog: [...log, { key, note, by: who.name.slice(0, 60), byId: who.id, at: nowIso, printer: String(at.name || '').slice(0, 60), opened: false }].slice(-500), noSales: Math.round(num(t.noSales)) + 1, updatedAt: nowIso }, { merge: true });
    return { ok: true as const, tillRef: tills[0].ref };
  });
  if (!r.ok) return r;
  if (r.already && r.opened) return { ok: true as const, already: true, printer: String(at.name || '') };
  try { await queueJob(db, T, at.id, 'drawer', drawerDoc(), { noSale: key }); }
  catch { return fail('It’s on the record, but the drawer didn’t open. Try again.', 503, 'not_opened'); }
  await db.runTransaction(async (tx: any) => {
    const t: any = (await tx.get(r.tillRef)).data() || {};
    tx.set(r.tillRef, { noSaleLog: (Array.isArray(t.noSaleLog) ? t.noSaleLog : []).map((m: any) => (m?.key === key ? { ...m, opened: true } : m)) }, { merge: true });
  }).catch(() => null);
  return { ok: true as const, ...(r.already ? { already: true } : {}), printer: String(at.name || '') };
}

/** The drawer's moves for a screen: how much should be in it now, and today's moves (newest first). */
export async function drawerView(db: any, tenantId: string) {
  const snap = await db.collection(`tenants/${tenantId}/tillSessions`).where('status', '==', 'open').limit(2).get();
  if (snap.docs.length !== 1) return { open: false as const, two: snap.docs.length > 1 };
  const t: any = snap.docs[0].data() || {};
  // (Its money moves and its openings with no sale, together, newest first.)
  const moves = [...(Array.isArray(t.cashMoves) ? t.cashMoves : []).slice(-12), ...(Array.isArray(t.noSaleLog) ? t.noSaleLog : []).slice(-12).map((m: any) => ({ ...m, kind: 'nosale', cents: 0 }))]
    .sort((a: any, b: any) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 12)
    .map((m: any) => ({ key: m.key, kind: m.kind, cents: Math.round(num(m.cents)), note: m.note || null, by: m.by || null, approvedBy: m.approvedBy || null, at: m.at || null, undone: !!m.undoneAt }));
  return { open: true as const, expectedCash: Math.round(num(t.expectedCash) * 100) / 100, moves };
}
