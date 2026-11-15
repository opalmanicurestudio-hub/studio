// src/lib/barback-server.ts — THE BARBACK, read and kept on the server (lib/barback has the rules; api/back is the way
// in).
//   barbackFor → what the barback's screen shows: what's running low at the bar (with the last hour's pace), how many
//                drinks the bar made in the last hour, and tonight's rush. The last of something, or none left, tells the
//                owner and managers once a day.
//   changePart → "Changed it": a keg or bottle swapped. A little left by the count is logged as pour loss (taken off
//                the open one, on the stock history as spoiled, with who), and every change is kept in barChanges. Tapped
//                twice, it's changed once (barLast keeps each item's last change).
//   undoChange → a change tapped by mistake, put back within a few minutes: the count is as it was.
// Reads are shared between screens: the menu (which drinks the bar makes and what they pour from) for a few minutes,
// what's left in each for a few seconds, and the last hour and a half's tickets with the dish screen (lib/dish-server).
// The pace comes from those tickets: each drink the bar made in the last hour, times what its recipe pours.
import { barParts, changeOutcome, runningLow, lowWords, type BarPart } from '@/lib/barback';
import { isMenuItem } from '@/lib/menu-server';
import { recipeOf } from '@/lib/menu-stock';
import { stationOfItem, stationsOf } from '@/lib/table-service';
import { moveStock } from '@/lib/usage';
import { buildEntry } from '@/lib/stock-ledger';
import { ledgerUnit } from '@/lib/food-cost';
import { barOf, recentTickets, rushFor } from '@/lib/dish-server';
import { tonight } from '@/lib/night-close-server';
import { tellManagers } from '@/lib/tell-managers';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export class BarStop extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
/** A second "Changed it" for the same thing this soon is the same change, tapped twice. */
const SAME_CHANGE_MS = 2 * 60000;
/** How long a change can be undone. */
export const UNDO_MS = 5 * 60000;

const MENU_MS = 5 * 60000, PARTS_MS = 12000;
const kept = new Map<string, { at: number; p: Promise<any> }>();
function keep<V>(k: string, ms: number, make: () => Promise<V>): Promise<V> {
  const hit = kept.get(k); if (hit && Date.now() - hit.at < ms) return hit.p;
  const p = make(); kept.set(k, { at: Date.now(), p }); p.catch(() => kept.delete(k));
  if (kept.size > 1000) for (const [kk, v] of Array.from(kept)) if (Date.now() - v.at > MENU_MS) kept.delete(kk);
  return p;
}
const forget = (T: string) => { for (const k of Array.from(kept.keys())) if (k.startsWith(`${T}|parts`)) kept.delete(k); };

type Menu = { bar: string | null; stations: string[]; items: Map<string, any>; rows: { id: string; data: any }[]; partIds: string[] };
/** The menu, which of its drinks the bar makes, and what they pour from (a few minutes). */
const menuFor = (db: any, T: string, tenant: any): Promise<Menu> => keep(`${T}|menu`, MENU_MS, async () => {
  const bar = barOf(tenant); const stations = stationsOf(tenant);
  if (!bar) return { bar: null, stations, items: new Map(), rows: [], partIds: [] };
  const snap = await db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(400).get();
  const rows = snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} })).filter((m: any) => isMenuItem(m.data));
  const ids = new Set<string>();
  for (const m of rows) if (stationOfItem(m.data, stations) === bar) for (const l of recipeOf(m.data, m.id)) if (ID.test(l.id)) ids.add(l.id);
  return { bar, stations, items: new Map(rows.map((m: any) => [m.id, m.data])), rows, partIds: Array.from(ids) };
});

/** What the bar pours from, with what's left in each now (a few seconds). */
export async function barPartsFor(db: any, T: string, tenant: any): Promise<{ menu: Menu; parts: BarPart[] }> {
  const menu = await menuFor(db, T, tenant);
  const parts: BarPart[] = await keep(`${T}|parts`, PARTS_MS, async () => {
    const got = new Map<string, any>();
    for (let i = 0; i < menu.partIds.length; i += 100) {
      const chunk = menu.partIds.slice(i, i + 100);
      const snaps: any[] = await db.getAll(...chunk.map((id) => db.doc(`${T}/inventory/${id}`))).catch(() => []);
      chunk.forEach((id, k) => { const x = snaps[k]?.data?.(); if (x) got.set(id, x); });
    }
    return menu.bar ? barParts(menu.rows, got, (item) => stationOfItem(item, menu.stations), menu.bar, recipeOf) : [];
  });
  return { menu, parts: parts.map((p) => ({ ...p })) };
}

// The last of something told to the managers today, remembered here so each screen's read doesn't ask again.
const alerted = new Set<string>();

export async function barbackFor(db: any, tenantId: string, tenant: any, now = Date.now()) {
  const T = `tenants/${tenantId}`; const day = tonight(tenant, new Date(now));
  const [{ menu, parts }, recent, rush] = await Promise.all([barPartsFor(db, T, tenant), recentTickets(db, T), rushFor(db, T, tenant, day)]);
  // The last hour at the bar, from the tickets: drinks made, and what each poured by its recipe. A list cut off at its
  // limit would make the pace look slower than it is, so the pace isn't given then.
  let drinks = 0; const used = new Map<string, number>();
  if (menu.bar) for (const t of recent.tickets) {
    const at = Date.parse(String(t.readyAt || t.deliveredAt || '')); if (!Number.isFinite(at) || at > now || now - at > 3600000) continue;
    if (['cancelled', 'canceled', 'voided', 'refunded'].includes(String(t.status))) continue;
    const item = t.itemId ? menu.items.get(String(t.itemId)) : null;
    const station = t.madeAt || (item ? stationOfItem(item, menu.stations) : null);
    if (String(station || '').toLowerCase() !== menu.bar.toLowerCase()) continue;
    drinks += t.quantity;
    if (item) for (const l of recipeOf(item, String(t.itemId))) used.set(l.id, (used.get(l.id) || 0) + l.quantityUsed * t.quantity);
  }
  if (!recent.capped) for (const p of parts) p.usedLastHour = Math.round((used.get(p.id) || 0) * 1000) / 1000;
  const low = runningLow(parts);
  for (const p of low.filter((x) => x.state !== 'change').slice(0, 5)) {
    const mark = `${T}|${day}|${p.id}`; if (alerted.has(mark)) continue;
    const ref = db.doc(`${T}/barAlerts/${day}_${p.id}`);
    const first = await db.runTransaction(async (tx: any) => { if ((await tx.get(ref)).exists) return false; tx.set(ref, { id: ref.id, day, itemId: p.id, state: p.state, at: new Date(now).toISOString() }); return true; }).catch(() => null);
    if (first === null) continue;
    alerted.add(mark); if (alerted.size > 5000) alerted.clear();
    if (!first) continue;
    const sent = await tellManagers(db, tenantId, tenant, { type: 'bar_running_out', link: `/inventory`, message: p.state === 'out' ? `The bar is out of ${p.name}, by the count, and there’s none in stock.` : `The bar is on the last of ${p.name}, and there’s none in stock. ${lowWords(p)}` });
    // Not written (the database didn't take it): let it go, so the next read tries again.
    if (sent < 0) { alerted.delete(mark); await ref.delete().catch(() => undefined); }
  }
  return {
    bar: menu.bar,
    low: low.map((p) => ({ id: p.id, name: p.name, kind: p.kind, state: p.state, poursLeft: p.poursLeft, minutesLeft: p.minutesLeft, full: p.full, words: lowWords(p) })),
    fine: parts.length - low.length,
    // Everything the bar pours from, to say one was changed that wasn't on the list.
    all: parts.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    drinksLastHour: drinks,
    paceKnown: !recent.capped,
    rush,
  };
}

/** "Changed it": the keg or bottle `itemId` was swapped. */
export async function changePart(db: any, tenantId: string, tenant: any, itemId: string, by: { id: string | null; name: string }): Promise<{ id: string | null; words: string; loss: number; already: boolean }> {
  if (!ID.test(itemId)) throw new BarStop('Which one?');
  const T = `tenants/${tenantId}`;
  const part = (await barPartsFor(db, T, tenant)).parts.find((p) => p.id === itemId);
  if (!part) throw new BarStop('That isn’t something the bar pours from any more.', 404);
  const ref = db.doc(`${T}/inventory/${itemId}`); const lastRef = db.doc(`${T}/barLast/${itemId}`);
  return db.runTransaction(async (tx: any) => {
    const [snap, lastSnap] = await Promise.all([tx.get(ref), tx.get(lastRef)]);
    const it: any = snap.data(); if (!it) throw new BarStop('That isn’t in Inventory any more.', 404);
    const nowMs = Date.now(); const last: any = lastSnap.data();
    if (last && !last.undone && nowMs - (Date.parse(String(last.at || '')) || 0) < SAME_CHANGE_MS) return { id: String(last.changeId || '') || null, words: String(last.words || `${part.name} changed.`), loss: 0, already: true };
    const open = Math.max(0, Number(it.costingMethod === 'uses' ? it.partialContainerUses : it.partialContainerSize) || 0);
    let out = changeOutcome({ ...part, open });
    const at = new Date(nowMs).toISOString(); const who = clip(by.name, 60) || 'Someone';
    if (out.loss > 0) {
      const mv = moveStock(it, out.loss);
      if (mv.notCounted) out = { loss: 0, words: `${part.name} changed. Its count isn’t kept by the ${part.kind === 'keg' ? 'keg' : 'bottle'}, so nothing was logged.` };
      else {
        tx.set(ref, mv.patch, { merge: true });
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: itemId, type: 'spoiled', delta: -out.loss, unit: ledgerUnit(it),
          reason: `Changed the ${part.kind === 'keg' ? 'keg' : part.kind === 'bottle' ? 'bottle' : 'container'} with ${out.loss} ${part.unit} left by the count (pour loss), ${who}`.slice(0, 200), actorId: by.id || 'staff', actorName: who }));
      }
    }
    const row = db.collection(`${T}/barChanges`).doc();
    tx.set(row, { id: row.id, day: tonight(tenant, new Date(nowMs)), at, itemId, name: part.name, kind: part.kind, open, loss: out.loss, unit: part.unit, by: who, byId: by.id || null, words: out.words });
    tx.set(lastRef, { itemId, at, changeId: row.id, words: out.words, undone: false });
    return { id: row.id, words: out.words, loss: out.loss, already: false };
  }).finally(() => forget(T));
}

/** A change tapped by mistake, put back within a few minutes: the pour loss it logged is returned to the open one. */
export async function undoChange(db: any, tenantId: string, changeId: string, by: { id: string | null; name: string }): Promise<{ words: string }> {
  if (!ID.test(changeId)) throw new BarStop('Which change?');
  const T = `tenants/${tenantId}`; const row = db.doc(`${T}/barChanges/${changeId}`);
  return db.runTransaction(async (tx: any) => {
    const r: any = (await tx.get(row)).data(); if (!r) throw new BarStop('That change isn’t here any more.', 404);
    if (r.undone) return { words: 'Already undone.' };
    if (Date.now() - (Date.parse(String(r.at || '')) || 0) > UNDO_MS) throw new BarStop('It’s too late to undo that one. The next stock count will settle it.', 409);
    const ref = db.doc(`${T}/inventory/${String(r.itemId)}`); const lastRef = db.doc(`${T}/barLast/${String(r.itemId)}`);
    const [snap, lastSnap] = await Promise.all([tx.get(ref), tx.get(lastRef)]);
    const it: any = snap.data(); const who = clip(by.name, 60) || 'Someone';
    const loss = Math.max(0, Number(r.loss) || 0);
    if (loss > 0 && it) {
      const mv = moveStock(it, -loss);
      if (!mv.notCounted) {
        tx.set(ref, mv.patch, { merge: true });
        // Put back, not counted: a count on the stock history is what someone found on the shelf, and nobody counted.
        tx.set(db.collection(`${T}/stockCorrections`).doc(), buildEntry({ productId: String(r.itemId), type: 'returned', delta: loss, unit: ledgerUnit(it),
          reason: `Put back: a keg or bottle change tapped by mistake was undone (${loss} ${clip(r.unit, 10)}), ${who}`.slice(0, 200), actorId: by.id || 'staff', actorName: who }));
      }
    }
    tx.set(row, { undone: true, undoneAt: new Date().toISOString(), undoneBy: who }, { merge: true });
    if (lastSnap.data()?.changeId === changeId) tx.set(lastRef, { undone: true }, { merge: true });
    return { words: `Undone. The count for ${clip(r.name, 60) || 'it'} is back as it was.` };
  }).finally(() => forget(T));
}
