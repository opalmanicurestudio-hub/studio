// src/lib/printing-server.ts — PRINTERS, on the server (lib/printing lays out the paper).
// A networked receipt printer asks this server every few seconds whether there's something to print (Star CloudPRNT,
// Epson Server Direct Print): nothing runs on a tablet, and a ticket prints even when no screen is open.
//   printerOf / keyOk   → the printer, by its own address (its id and a secret key in the address it's given).
//   heard               → what it said about itself (working, out of paper…), kept so the business can see it.
//   nextJob             → what it prints next: new kitchen tickets for its stations are made into slips first (a
//                         table's course or an order on one slip, and an update when an allergy changes on a ticket
//                         it printed, even one being made), then the oldest slip waiting goes. Each ticket is marked
//                         as printed by that printer in the same save as its slip is made, so two asks at once can't
//                         print it twice; a slip given up on clears those marks so its tickets print again.
//                         A printer set to print item stickers makes them the same way: one sticker for each item
//                         made at its stations, as the order comes in (lib/item-stickers), each ticket marked as
//                         stickered in the same save.
//   jobOf / jobDone     → the slip's paper, and what the printer said when it was done (tried again a few times).
//   queueVoids          → something already printed was taken off: a "Taken off" slip at each printer that printed it.
//   printCheck          → the guest check to the first check printer that's answering (or, with none, a page for the
//                         tablet, saying which printer isn't answering).
// Printers and their slips are only ever read and written here (no screen reads them directly).
import { randomBytes, timingSafeEqual } from 'crypto';
import { allergySig } from '@/lib/allergens';
import { ticketFrom } from '@/lib/kitchen';
import { stationsOf, tableLabel } from '@/lib/table-service';
import { tenantTimeZone } from '@/lib/tenant-time';
import { allergyLines, allergyUpdateDoc, checkDoc, cleanPrinter, initialOf, printsWords, ticketDoc, voidDoc, type PrintDoc, type PrinterSettings } from '@/lib/printing';
import { makeItemCode } from '@/lib/order-qr';
import { MAX_STICKERS, MAX_UNITS, stickerDoc, stickerKey, stickerName, stickerOf, stickersOf, type Sticker, stickersFor } from '@/lib/item-stickers';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export class PrintStop extends Error { constructor(public msg: string, public status = 409) { super(msg); } }
const nowIso = () => new Date().toISOString();
export const newKey = () => randomBytes(18).toString('base64url');
export const KEY = /^[A-Za-z0-9_-]{16,64}$/;
/** Tickets older than this aren't printed by a printer that's just been set up or was off for a while. */
export const PRINT_BACK_MS = 2 * 3600000;
/** A slip sent that the printer hasn't said is done is offered again after this; given up after a few tries. */
const RESEND_MS = 60000, TRIES = 4;

export type Printer = PrinterSettings & { id: string; key: string; addedAt: string; lastSeenAt: string | null; statusCode: string | null; lastError: string | null; lastErrorAt: string | null; gaveUpAt: string | null;
  /** It prints pictures (lib/print-picture): an Epson always; a Star once it has asked for one. */ pictures?: boolean };
/** It prints a code to scan: as a picture, or an Epson's own (a Star printing words only can't). */
export const printsCodes = (p: { kind: string; pictures?: boolean } | null | undefined) => !!p && (p.kind === 'epson' || p.pictures === true);
export const printerFrom = (id: string, d: any): Printer => ({ ...cleanPrinter(d), id, pictures: d?.kind === 'epson' || d?.pictures === true, key: String(d?.key || ''), addedAt: String(d?.addedAt || ''), lastSeenAt: d?.lastSeenAt || null,
  statusCode: d?.statusCode ? String(d.statusCode).slice(0, 80) : null, lastError: d?.lastError ? String(d.lastError).slice(0, 160) : null, lastErrorAt: d?.lastErrorAt || null, gaveUpAt: d?.gaveUpAt || null });

const cache = new Map<string, { at: number; v: Printer }>();
// Addresses for no printer (one taken away still asking, or one made up), kept apart so they can't push real ones out.
const gone = new Map<string, number>();
/** Whether a printer address is answered without a read (it was looked up in the last half minute). */
export function inMemory(T: string, id: string): boolean {
  const k = `${T}|${id}`; const now = Date.now(); const hit = cache.get(k);
  return (!!hit && now - hit.at < 30000) || now - (gone.get(k) || 0) < 30000;
}
/** A printer, read at most every half minute (it asks every few seconds). */
export async function printerOf(db: any, T: string, id: string, o: { fresh?: boolean } = {}): Promise<Printer | null> {
  if (!ID.test(id)) return null;
  const k = `${T}|${id}`; const hit = cache.get(k);
  if (!o.fresh && hit && Date.now() - hit.at < 30000) return hit.v;
  if (!o.fresh && Date.now() - (gone.get(k) || 0) < 30000) return null;
  const d = (await db.doc(`${T}/printers/${id}`).get()).data();
  const v = d ? printerFrom(id, d) : null;
  if (v) { if (cache.size > 2000) cache.clear(); cache.set(k, { at: Date.now(), v }); gone.delete(k); }
  else { cache.delete(k); if (gone.size > 5000) gone.clear(); gone.set(k, Date.now()); }
  return v;
}
/** Someone trying made-up printer addresses: after 30 lookups a minute from one place that found no printer, addresses
 *  not already known are turned away without a read (a printer that's working is known, and keeps printing). */
const misses = new Map<string, { at: number; n: number }>();
export function tooManyMisses(from: string): boolean {
  const m = misses.get(from); return !!m && Date.now() - m.at < 60000 && m.n >= 30;
}
export function missed(from: string) {
  const m = misses.get(from); const now = Date.now();
  if (misses.size > 5000) misses.clear();
  misses.set(from, m && now - m.at < 60000 ? { at: m.at, n: m.n + 1 } : { at: now, n: 1 });
}
/** A printer's words in its address bar, read safely (a stray "%" is kept as it is). */
export const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
export const fromOf = (req: any) => String(req?.headers?.get?.('x-forwarded-for') || '').split(',')[0].trim() || String(req?.headers?.get?.('x-real-ip') || '') || 'here';
export const forgetPrinter = (T: string, id: string) => { cache.delete(`${T}|${id}`); gone.delete(`${T}|${id}`); lists.delete(T); };
export function keyOk(p: Printer | null, key: string): p is Printer {
  if (!p || !KEY.test(key) || !p.key) return false;
  const a = Buffer.from(p.key); const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the printer said about itself, kept at most every half minute (or at once when it changes). */
export async function heard(db: any, T: string, p: Printer, code: string | null, mac: string | null): Promise<void> {
  const c = code ? dec(String(code)).slice(0, 80) : null;
  const last = Date.parse(p.lastSeenAt || '');
  if (c === p.statusCode && Number.isFinite(last) && Date.now() - last < 30000) return;
  const at = nowIso();
  await db.doc(`${T}/printers/${p.id}`).set({ lastSeenAt: at, statusCode: c, ...(mac ? { mac: String(mac).slice(0, 40) } : {}) }, { merge: true });
  p.lastSeenAt = at; p.statusCode = c;
}

/** "Working, heard from 3 sec ago" / "Not heard from since 7:42 pm" / "Out of paper". */
export function printerState(p: Printer, now: number, tz: string | null): { ok: boolean; words: string } {
  const seen = Date.parse(p.lastSeenAt || '');
  if (!Number.isFinite(seen)) return { ok: false, words: 'Waiting to hear from it. Put its address in the printer’s settings.' };
  const ago = Math.max(0, Math.round((now - seen) / 1000));
  if (ago > 90) return { ok: false, words: `Not heard from since ${new Date(seen).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).replace(' AM', ' am').replace(' PM', ' pm')}` };
  const code = String(p.statusCode || '');
  if (code && !/^2/.test(code)) return { ok: false, words: `The printer says: ${code.replace(/^\d+\s*/, '') || code}` };
  if (p.lastError) return { ok: false, words: `Last slip didn’t print: ${p.lastError}` };
  return { ok: true, words: `Working, heard from ${ago < 5 ? 'just now' : `${ago} sec ago`}` };
}

/** The slips waiting for a printer, oldest first. */
async function openJobs(db: any, T: string, printerId: string): Promise<any[]> {
  const snap = await db.collection(`${T}/printJobs`).where('printerId', '==', printerId).where('open', '==', true).limit(20).get();
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).sort((a: any, b: any) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/** A slip for a printer. */
export async function queueJob(db: any, T: string, printerId: string, kind: 'ticket' | 'check' | 'void' | 'allergy' | 'test' | 'receipt' | 'drawer' | 'label' | 'sticker', doc: PrintDoc, extra: Record<string, unknown> = {}): Promise<string> {
  const ref = db.collection(`${T}/printJobs`).doc();
  await ref.set({ printerId, kind, doc, status: 'queued', open: true, tries: 0, createdAt: nowIso(), ...extra });
  return ref.id;
}

// The kitchen's tickets not out yet (waiting, being made, ready), read at most every few seconds a business however
// many printers ask: new ones print once they're waiting; an allergy that changes on any of them prints an update.
const LIVE = ['pending', 'in_progress', 'ready'];
const pending = new Map<string, { at: number; v: any[] }>();
async function pendingTickets(db: any, T: string): Promise<any[]> {
  const hit = pending.get(T); if (hit && Date.now() - hit.at < 4000) return hit.v;
  const snap = await db.collection(`${T}/kdsTickets`).where('status', 'in', LIVE).limit(500).get();
  const v = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  if (pending.size > 2000) pending.clear(); pending.set(T, { at: Date.now(), v });
  return v;
}
export const forgetPending = (T: string) => { pending.delete(T); };

/** Which station makes a ticket (its own, else the business's first). */
const stationOf = (raw: any, stations: string[]) => String(raw?.madeAt || stations[0] || 'Kitchen');
const keyOf = (s: string) => s.trim().toLowerCase();
/** A slip's worth: a table's course, or an order, at one station. */
const groupKey = (raw: any, station: string) => `${raw.visitId ? `v:${raw.visitId}|${raw.course || 0}` : raw.orderId ? `o:${raw.orderId}` : `t:${raw.id}`}|${keyOf(station)}`;

/** New tickets for this printer's stations, and allergy changes on ones it already printed, grouped into slips. */
export function ticketsFor(raws: any[], p: Printer, stations: string[], now: number): { fresh: any[][]; changed: any[][] } {
  const mine = (st: string) => !p.stations.length || p.stations.some((x) => keyOf(x) === keyOf(st));
  const since = Math.max(now - PRINT_BACK_MS, Date.parse(p.addedAt) || 0);
  const fresh = new Map<string, any[]>(); const changed = new Map<string, any[]>();
  for (const r of raws) {
    const st = stationOf(r, stations); if (!mine(st)) continue;
    if (r.holdUntil && Date.parse(r.holdUntil) > now) continue;
    const mark = r.printed && typeof r.printed === 'object' ? r.printed[p.id] : null;
    if (mark) { if (mark.sig !== allergySig(r)) { const k = groupKey(r, st); changed.set(k, [...(changed.get(k) || []), r]); } continue; }
    if (r.status !== 'pending') continue;
    const at = Date.parse(r.firedAt || r.createdAt || r.requestedAt || '');
    if (!Number.isFinite(at) || at < since) continue;
    const k = groupKey(r, st); fresh.set(k, [...(fresh.get(k) || []), r]);
  }
  const order = (g: any[][]) => g.sort((a, b) => String(a[0].firedAt || a[0].createdAt || '').localeCompare(String(b[0].firedAt || b[0].createdAt || '')));
  return { fresh: order(Array.from(fresh.values())), changed: order(Array.from(changed.values())) };
}

/** Slips made from the kitchen's tickets for this printer (a few at a time), each ticket marked as printed by it. */
// The business (its stations and time zone), read at most every half minute however many printers ask.
const tenants = new Map<string, { at: number; v: any }>();
async function tenantFor(T: string, load: () => Promise<any>) {
  const hit = tenants.get(T); if (hit && Date.now() - hit.at < 30000) return hit.v;
  const v = (await load()) || {}; if (tenants.size > 2000) tenants.clear(); tenants.set(T, { at: Date.now(), v }); return v;
}
async function makeTicketJobs(db: any, T: string, loadTenant: () => Promise<any>, p: Printer, now: number): Promise<number> {
  const raws = await pendingTickets(db, T); if (!raws.length) return 0;
  const tenant = await tenantFor(T, loadTenant);
  const stations = stationsOf(tenant); const tz = tenantTimeZone(tenant);
  const { fresh, changed } = ticketsFor(raws, p, stations, now);
  let made = 0;
  for (const [kind, groups] of [['ticket', fresh], ['allergy', changed]] as const) {
    for (const g of groups.slice(0, 5)) {
      const refs = g.map((r) => db.doc(`${T}/kdsTickets/${r.id}`));
      const ok = await db.runTransaction(async (tx: any) => {
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        const live = snaps.map((s: any, i: number) => ({ ref: refs[i], d: s.exists ? { id: g[i].id, ...(s.data() || {}) } : null }))
          .filter((x) => x.d && (kind === 'ticket' ? x.d.status === 'pending' && !x.d.printed?.[p.id] : LIVE.includes(String(x.d.status)) && !!x.d.printed?.[p.id] && x.d.printed[p.id].sig !== allergySig(x.d)));
        if (!live.length) return false;
        const at = nowIso(); const jobRef = db.collection(`${T}/printJobs`).doc();
        const views = live.map((x) => ticketFrom(x.d, 'kdsTickets'));
        const doc = kind === 'ticket' ? ticketDoc(views, { tz, at, station: p.stations.length === 1 ? null : stationOf(live[0].d, stations), buzz: p.buzz })
          : allergyUpdateDoc(views, { tz, at });
        tx.set(jobRef, { printerId: p.id, kind, doc, status: 'queued', open: true, tries: 0, createdAt: at, ticketIds: live.map((x) => x.d.id) });
        for (const x of live) tx.set(x.ref, { printed: { [p.id]: { job: jobRef.id, sig: allergySig(x.d), at } } }, { merge: true });
        return true;
      });
      if (ok) made += 1;
    }
  }
  if (made) forgetPending(T);
  return made;
}

/** Item stickers for this printer's stations (lib/item-stickers): a quick-service order's new tickets (not a table's),
 *  one sticker for each item, kept on the order with the ticket marked as stickered in the same save, so two asks at
 *  once can't print them twice. A Star on CloudPRNT prints words only, so its stickers carry no code to scan. */
export function stickerTickets(raws: any[], p: Printer, stations: string[], now: number): Map<string, any[]> {
  const mine = (st: string) => !p.stations.length || p.stations.some((x) => keyOf(x) === keyOf(st));
  const since = Math.max(now - PRINT_BACK_MS, Date.parse(p.addedAt) || 0);
  const by = new Map<string, any[]>();
  for (const r of raws) {
    if (r.sticker || r.stickerSkip?.[p.id] || r.status !== 'pending' || !r.channel || !ID.test(String(r.orderId || '')) || !mine(stationOf(r, stations))) continue;
    if (r.holdUntil && Date.parse(r.holdUntil) > now) continue;
    const at = Date.parse(r.firedAt || r.createdAt || r.requestedAt || '');
    if (!Number.isFinite(at) || at < since) continue;
    by.set(String(r.orderId), [...(by.get(String(r.orderId)) || []), r]);
  }
  return by;
}
async function makeStickerJobs(db: any, T: string, loadTenant: () => Promise<any>, p: Printer, now: number): Promise<number> {
  const raws = await pendingTickets(db, T); if (!raws.length) return 0;
  const tenant = await tenantFor(T, loadTenant);
  const groups = Array.from(stickerTickets(raws, p, stationsOf(tenant), now).entries()).slice(0, 5);
  const tenantId = T.split('/')[1]; const coded = printsCodes(p);
  let made = 0;
  for (const [orderId, g] of groups) {
    const refs = g.map((r) => db.doc(`${T}/kdsTickets/${r.id}`)); const orderRef = db.doc(`${T}/counterOrders/${orderId}`);
    const ok = await db.runTransaction(async (tx: any) => {
      const [or, ...snaps] = await Promise.all([tx.get(orderRef), ...refs.map((r) => tx.get(r))]);
      const order: any = or.data();
      const live = snaps.map((s: any, i: number) => ({ ref: refs[i], d: s.exists ? { id: g[i].id, ...(s.data() || {}) } : null })).filter((x) => x.d && x.d.status === 'pending' && !x.d.sticker && !x.d.stickerSkip?.[p.id]);
      if (!order || order.status !== 'sent' || !live.length) return false;
      const at = nowIso(); const had = stickersOf(order);
      // A printer kept to the orders where a mistake costs most (a delivery app's, two or more bags, an allergy): any
      // other order's tickets are passed by, once, by this printer only (another printing stickers on every order for
      // the same station still can), and its items go as before.
      if (!stickersFor(order, p.stickersOn)) { for (const x of live) tx.set(x.ref, { stickerSkip: { [p.id]: at } }, { merge: true }); return false; }
      const fresh: { s: Sticker; view: any; u: number; of: number }[] = [];
      for (const x of live) { const view = ticketFrom(x.d, 'kdsTickets'); const of = Math.min(MAX_UNITS, view.quantity); for (let u = 1; u <= of; u++) fresh.push({ s: { k: stickerKey(x.d.id, u), name: stickerName(view), v: 1, c: coded }, view, u, of }); }
      const keys = new Set(fresh.map((f) => f.s.k));
      // (No more than an order keeps: the rest print as words, never to be scanned.)
      const kept = (had?.list || []).filter((x) => !keys.has(x.k)); const room = Math.max(0, MAX_STICKERS - kept.length);
      fresh.forEach((f, i) => { if (i >= room) f.s.c = false; });
      const list = [...kept, ...fresh.slice(0, room).map((f) => f.s)];
      tx.set(orderRef, { stickers: { list, scanned: (had?.scanned || []).filter((k) => !keys.has(k)) } }, { merge: true });
      // (Two of the same item numbered: "1 of 2".)
      fresh.forEach((f) => {
        const doc = stickerDoc(stickerOf(order, f.view, allergyLines([f.view]), f.u, f.of, f.s.c ? makeItemCode(tenantId, orderId, f.s.k, 1) : null, initialOf(tenant.name || tenant.businessName)));
        tx.set(db.collection(`${T}/printJobs`).doc(), { printerId: p.id, kind: 'sticker', doc, status: 'queued', open: true, tries: 0, createdAt: at, orderId, stickerKey: f.s.k });
      });
      for (const x of live) tx.set(x.ref, { sticker: { printer: p.id, at } }, { merge: true });
      return true;
    });
    if (ok) made += 1;
  }
  if (made) forgetPending(T);
  return made;
}

/** A slip given up on: tickets still waiting lose their "printed" mark, so they print again on the next ask (a missing
 *  kitchen ticket is worse than one printed twice), and the business sees that one didn't print. */
async function giveUp(db: any, T: string, p: Printer, j: any, code: string) {
  const ref = db.doc(`${T}/printJobs/${j.id}`);
  const kind = await db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(ref)).data(); if (!d || !d.open) return null;
    const ids: string[] = (Array.isArray(d.ticketIds) ? d.ticketIds : []).filter((x: any) => ID.test(String(x))).slice(0, 40);
    const refs = ['ticket', 'allergy'].includes(String(d.kind)) ? ids.map((id) => db.doc(`${T}/kdsTickets/${id}`)) : [];
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    tx.set(ref, { status: 'failed', open: false, failedAt: nowIso(), code }, { merge: true });
    // Still waiting to be made: printed again whole. Being made already: it's on the screens (which say this printer
    // isn't printing), so it isn't sent round again.
    snaps.forEach((sn: any, i: number) => { const k: any = sn.data(); if (k?.status === 'pending' && k?.printed?.[p.id]?.job === j.id) tx.set(refs[i], { printed: { [p.id]: null } }, { merge: true }); });
    return String(d.kind || '');
  });
  const lastError = String(code || 'No answer').slice(0, 120);
  // Kitchen tickets given up on: new ones wait a minute (a check or test page that didn't print holds nothing up).
  const at = nowIso(); const pause = kind === 'ticket' || kind === 'allergy';
  await db.doc(`${T}/printers/${p.id}`).set({ lastError, lastErrorAt: at, ...(pause ? { gaveUpAt: at } : {}) }, { merge: true });
  p.lastError = lastError; p.lastErrorAt = at; if (pause) p.gaveUpAt = at;
  forgetPending(T);
}

/** A check or test page this old is no use on paper any more ("Taken off" still prints: the kitchen may have it on paper). */
const STALE_MS = 20 * 60000;
/** A slip the printer said it couldn't print waits this long before it's tried again; after one is given up on, new
 *  tickets wait a minute before they're made into slips (a printer with its cover open isn't sent the same slip
 *  every few seconds). */
const RETRY_MS = 20000, PAUSE_MS = 60000;
/** What this printer prints next, made ready to send (null: nothing): new kitchen tickets are made into slips every
 *  time it asks (one slow slip never holds them up), then the oldest slip waiting goes. */
export async function nextJob(db: any, T: string, loadTenant: () => Promise<any>, p: Printer): Promise<SentJob | null> {
  const now = Date.now();
  if (p.tickets && !(now - (Date.parse(p.gaveUpAt || '') || 0) < PAUSE_MS)) await makeTicketJobs(db, T, loadTenant, p, now).catch((e) => console.warn('[printing] tickets', e?.message || e));
  if (p.stickers && !(now - (Date.parse(p.gaveUpAt || '') || 0) < PAUSE_MS)) await makeStickerJobs(db, T, loadTenant, p, now).catch((e) => console.warn('[printing] stickers', e?.message || e));
  const jobs = await openJobs(db, T, p.id);
  for (const j of jobs) {
    const ref = db.doc(`${T}/printJobs/${j.id}`);
    // One sent a moment ago is still on its way (the printer asks again before it has said it's done).
    if (j.status === 'sent' && now - (Date.parse(j.sentAt || '') || 0) < RESEND_MS) return sentJob(j);
    if (['check', 'test'].includes(String(j.kind)) && now - (Date.parse(j.createdAt || '') || now) > STALE_MS) { await ref.set({ status: 'failed', open: false, failedAt: nowIso(), code: 'Too old to print' }, { merge: true }); continue; }
    if ((Number(j.tries) || 0) >= TRIES) { await giveUp(db, T, p, j, String(j.code || 'No answer')); continue; }
    if (j.status === 'queued' && now < (Date.parse(j.retryAt || '') || 0)) continue;
    await ref.set({ status: 'sent', sentAt: nowIso(), tries: (Number(j.tries) || 0) + 1 }, { merge: true });
    return sentJob(j);
  }
  return null;
}

/** A slip's paper: by its id, or the one this printer was last sent. */
export async function jobOf(db: any, T: string, p: Printer, jobId: string | null): Promise<SentJob | null> {
  if (jobId && ID.test(jobId)) { const d = (await db.doc(`${T}/printJobs/${jobId}`).get()).data(); return d && d.printerId === p.id && d.open ? sentJob({ ...d, id: jobId }) : null; }
  const sent = (await openJobs(db, T, p.id)).filter((j) => j.status === 'sent').sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')))[0];
  return sent ? sentJob(sent) : null;
}
/** A slip as sent: its id, its paper, and whether it couldn't be drawn as a picture (kept on the slip, so whichever
 *  server the printer asks next offers it as text). */
export type SentJob = { id: string; doc: PrintDoc; noPicture: boolean };
const sentJob = (j: any): SentJob => ({ id: String(j.id), doc: j.doc, noPicture: j.noPicture === true });
/** A slip that couldn't be drawn as a picture: offered as text from now on. */
export const noPictureFor = (db: any, T: string, jobId: string) => db.doc(`${T}/printJobs/${jobId}`).set({ noPicture: true }, { merge: true });

/** What the printer said when it was done: printed, or not (tried again a few times, then given up and said so). */
export async function jobDone(db: any, T: string, p: Printer, jobId: string | null, ok: boolean, code: string): Promise<void> {
  const j = await jobOf(db, T, p, jobId); if (!j) return;
  const ref = db.doc(`${T}/printJobs/${j.id}`);
  const why = dec(String(code || '')).slice(0, 80);
  const last = await db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(ref)).data(); if (!d || !d.open) return false;
    if (ok) { tx.set(ref, { status: 'done', open: false, doneAt: nowIso(), code: why || 'OK' }, { merge: true }); return false; }
    if ((Number(d.tries) || 0) >= TRIES) return true;
    tx.set(ref, { status: 'queued', code: why, retryAt: new Date(Date.now() + RETRY_MS).toISOString() }, { merge: true }); return false;
  });
  if (last) { await giveUp(db, T, p, { id: j.id }, why || 'The printer said no'); return; }
  // Printed: whatever went wrong before is over.
  const lastError = ok ? null : why || 'The printer said no';
  if (lastError !== p.lastError) { await db.doc(`${T}/printers/${p.id}`).set({ lastError, ...(ok ? {} : { lastErrorAt: nowIso() }) }, { merge: true }); p.lastError = lastError; }
}

/** Something already printed was taken off a table's tab: a "Taken off" slip at each printer that printed it. */
export async function queueVoids(db: any, T: string, tenant: any, raws: any[], by: string): Promise<number> {
  const tz = tenantTimeZone(tenant); const at = nowIso();
  const per = new Map<string, any[]>();
  for (const r of raws) for (const [pid, mark] of Object.entries(r?.printed && typeof r.printed === 'object' ? r.printed : {})) if (mark && ID.test(pid)) per.set(pid, [...(per.get(pid) || []), r]);
  let n = 0;
  for (const [pid, list] of per) {
    const p = await printerOf(db, T, pid); if (!p || !p.tickets) continue;
    const k = list[0];
    await queueJob(db, T, pid, 'void', voidDoc(list.map((r) => ({ qty: Math.max(1, Number(r.quantity) || 1), name: String(r.itemName || r.menuItemName || 'Item') })),
      { where: k.orderNumber ? `Order ${k.orderNumber}` : k.tableNumber ? tableLabel(k.tableNumber) : 'An order', by, tz, at }), { ticketIds: list.map((r) => r.id) });
    n += 1;
  }
  return n;
}

/** The guest check: to the business's check printer when it has one, else back as paper for the tablet's own print
 *  dialog. With pay at the table on, it carries the table's pay link (a QR code where the printer can draw one). */
export async function printCheck(db: any, T: string, tenant: any, tenantId: string, visitId: string, origin: string): Promise<{ printer: string | null; down: string | null; doc: PrintDoc }> {
  const P = await import('@/lib/table-pay-server'); const B = await import('@/lib/table-bill');
  const ck = await P.checkOf(db, T, tenant, visitId);
  if (!ck.bill.lines.length) throw new PrintStop('Nothing’s on this table’s tab yet.');
  const pay = B.tablePayOf(tenant).on && ck.visit.status !== 'completed' ? await P.checkStatus(db, T, tenant, tenantId, visitId, origin).catch(() => null) : null;
  const party: any = ck.visit.partyId && ID.test(String(ck.visit.partyId)) ? (await db.doc(`${T}/parties/${ck.visit.partyId}`).get()).data() || null : null;
  const doc = checkDoc({ business: String(tenant?.name || tenant?.businessName || 'Thank you').slice(0, 40), table: ck.table, name: String(party?.name || ck.visit.clientName || 'Guests').slice(0, 40),
    size: Math.max(1, Number(party?.size) || 1), lines: ck.bill.lines.map((l) => ({ name: l.name, price: l.price, comped: l.comped })), subtotal: ck.bill.subtotal, discount: ck.bill.discount,
    tax: ck.bill.tax, total: pay ? pay.total : ck.bill.total, paid: pay ? pay.paid : 0, payUrl: pay && !pay.why && pay.left > 0 ? pay.url : null, at: nowIso(), tz: tenantTimeZone(tenant) });
  // The first check printer that's answering; none answering: back to the tablet, and say which one isn't.
  const tz = tenantTimeZone(tenant);
  const list = (await printersOf(db, T)).filter((x) => x.checks);
  const up = list.find((x) => printerState(x, Date.now(), tz).ok);
  if (!up) return { printer: null, down: list[0]?.name || null, doc };
  // Asked twice before it printed: one check, the newer one.
  const waiting = (await openJobs(db, T, up.id)).filter((j) => j.kind === 'check' && j.visitId === visitId && j.status === 'queued');
  for (const j of waiting) await db.doc(`${T}/printJobs/${j.id}`).set({ status: 'replaced', open: false }, { merge: true });
  await queueJob(db, T, up.id, 'check', doc, { visitId });
  return { printer: up.name, down: null, doc };
}

/** The business's printers (managers see each one's address). */
export async function printersOf(db: any, T: string): Promise<Printer[]> {
  const snap = await db.collection(`${T}/printers`).limit(20).get();
  return snap.docs.map((d: any) => printerFrom(d.id, d.data() || {})).sort((a: Printer, b: Printer) => a.name.localeCompare(b.name));
}
const lists = new Map<string, { at: number; v: Printer[] }>();
/** The business's printers, read at most every half minute (for the kitchen screen's "is it answering?"). */
export async function printersCached(db: any, T: string): Promise<Printer[]> {
  const hit = lists.get(T); if (hit && Date.now() - hit.at < 30000) return hit.v;
  const v = await printersOf(db, T); if (lists.size > 2000) lists.clear(); lists.set(T, { at: Date.now(), v }); return v;
}
/** The address a printer is given (its kind, the business, its id and its key). */
export const printerUrl = (origin: string, tenantId: string, p: Printer) => `${origin.replace(/\/+$/, '')}/api/printer/${p.kind}/${encodeURIComponent(tenantId)}/${p.id}/${p.key}`;
/** How each printer is doing, for the screens that rely on it. */
export const printerSummary = (list: Printer[], now: number, tz: string | null) => list.map((p) => ({ id: p.id, name: p.name, prints: printsWords(p), stations: p.stations, tickets: p.tickets, checks: p.checks, ...printerState(p, now, tz) }));
export { checkDoc };
