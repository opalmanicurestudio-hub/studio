// src/app/api/table-pay/route.ts — A GUEST PAYS THEIR SHARE OF THE TABLE'S CHECK ON THEIR OWN PHONE (public: the check's
// own link is the only key, and it opens nothing but that one check, while it's open). lib/table-pay-server.
//   view   { tenantId, token } → the check: each line with its seat and whether it's paid or being paid, the totals, the
//          business's tip choices and the ways the table may split. Never anyone's name.
//   start  { tenantId, token, choice, tip, replace? } → their share held for them, and the card company's form for exactly
//          it (worked out here, never taken from the page).
//   done   { tenantId, token, claimId } → after the form says it went through: on the check (asked of the card company).
//   cancel { tenantId, token, claimId } → they changed their mind: the payment is called off and their pick let go.
//   keep   { tenantId, token, claimId } → still on the card form: their pick held a while longer (up to an hour).
// It's also the table's GUEST PASS (lib/guest-pass): 'view' says where their order is, course by course, what they've
// asked for and whether someone has it, and a regular's usual when the business offers it; and
//   ask    { tenantId, token, what: 'server'|'water'|'check'|'usual' } → their server's phone says so (lib/nudges), the
//          check asked for shows on the host stand too. Asked again while the last is open: nothing new.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { toolLocked } from '@/lib/tool-lock';
import { publicLook } from '@/lib/public-look';
import { tablePayOf } from '@/lib/table-bill';
import { checkOf, claimsOf, keepShare, letGoStale, PayStop, payableWhy, PAY_TOKEN, settleShare, startShare, visitByToken } from '@/lib/table-pay-server';
import { coursesOf, tableLabel } from '@/lib/table-service';
import { ASK_KINDS, askOpen, askSaid, askSeen, firstName, MAX_ASKS, openOfKind, passCourses, type AskKind, type GuestAsk } from '@/lib/guest-pass';
import { memorySettingsOf } from '@/lib/guest-memory';
import { memoryFor } from '@/lib/guest-memory-server';
import { forgetFloor } from '@/lib/floor-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const H = { 'Cache-Control': 'no-store' };
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: H });
const bad = (error: string, status = 400, extra: any = {}) => NextResponse.json({ ok: false, error, ...extra }, { status, headers: H });

// A page asks every few seconds while it's open; more than this from one place in a minute is someone else's doing.
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, add = true): boolean {
  const now = Date.now(); const list = (hits.get(key) || []).filter((t) => now - t < 60000); if (add) list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return list.length > max;
}
function callerOf(req: NextRequest): string {
  const h = (k: string) => String(req.headers?.get?.(k) || '').trim();
  const fwd = h('x-forwarded-for').split(',').map((x) => x.trim()).filter(Boolean);
  return (h('x-vercel-forwarded-for').split(',')[0] || h('x-real-ip') || fwd[fwd.length - 1] || 'unknown').trim().slice(0, 60);
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const token = String(b.token || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId) || !PAY_TOKEN.test(token)) return bad('This link isn’t complete. Scan the code again.');
  if (!['view', 'start', 'done', 'cancel', 'keep', 'ask'].includes(action)) return bad('Unknown action.');
  const ip = callerOf(req);
  if (tooMany(`ip|${ip}`, 400) || tooMany(`${tenantId}|${token}`, 60) || tooMany(`miss|${ip}|${tenantId}`, 30, false)) return bad('One moment, then try again.', 429);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  try {
    const tenant: any = (await db.doc(T).get()).data();
    if (!tenant) { tooMany(`miss|${ip}|${tenantId}`, 30); return bad('This link isn’t working any more.', 404); }
    { const locked = toolLocked(tenant, ['hospitality'], 'guest', 'Paying at the table isn’t open right now.'); if (locked) return locked; }
    const found = await visitByToken(db, T, token);
    if (!found) { tooMany(`miss|${ip}|${tenantId}`, 30); return bad('This link isn’t working any more. Ask your server.', 404); }
    const visitId = found.id;
    const look = { look: publicLook(tenant), business: String(tenant.name || tenant.businessName || '').slice(0, 80) };

    if (action === 'start') {
      const slow = await limitPublic(req, 'table_pay', tenantId, { perHour: 60, perDay: 0 }); if (slow) return slow;
      const choice = b.choice && typeof b.choice === 'object' ? b.choice : null;
      if (!choice || !['seat', 'item', 'even', 'rest'].includes(String(choice.way))) return bad('Pick what you’re paying for.');
      const tip = b.tip && typeof b.tip === 'object' ? { pct: b.tip.pct ?? null, amount: b.tip.amount ?? null } : {};
      const r = await startShare(db, T, tenant, tenantId, visitId, { choice, tip, replace: typeof b.replace === 'string' && ID.test(b.replace) ? b.replace : null });
      return ok(r);
    }
    if (action === 'done' || action === 'cancel' || action === 'keep') {
      const claimId = String(b.claimId || ''); if (!ID.test(claimId)) return bad('Which payment?');
      const pendingId = String(found.v.payTicketId || ''); if (!ID.test(pendingId)) return bad('This check has no payments yet.', 404);
      if (action === 'keep') return ok({ kept: await keepShare(db, T, pendingId, claimId) });
      const t: any = (await db.doc(`${T}/pendingCheckouts/${pendingId}`).get()).data();
      const c = claimsOf(t).find((x) => x.id === claimId);
      if (action === 'cancel') { if (c && !c.paid) await letGoStale(db, T, tenant, pendingId, { also: claimId }); return ok({}); }
      if (!c) return bad('That payment wasn’t found. Ask your server whether it went through.', 404);
      if (c.paid) return ok({ paid: true });
      if (!c.piId) return bad('That payment didn’t start. Try again.', 409);
      const r = await settleShare(db, T, tenant, pendingId, c.piId);
      if (r.pending) return NextResponse.json({ ok: false, pending: true, error: 'Your payment is still going through.' }, { status: 202, headers: H });
      if (r.keptApart) return bad('This check was closed before your payment landed, so it’s set aside for the business to give back. Show this screen to your server.', 409, { keptApart: true });
      if (!r.paid) return bad('That payment didn’t go through.', 409);
      return ok({ paid: true, full: !!r.full });
    }

    // A regular's usual (lib/guest-memory), when the business offers it and the host said who they are: the first of it
    // not on the tab yet.
    const usualOf = async (v: any, party: any): Promise<string | null> => {
      const mem = memorySettingsOf(tenant);
      if (!mem.on || !mem.offerUsual || !party?.clientId || party.guestMatch !== 'host' || !ID.test(String(party.clientId))) return null;
      const m = await memoryFor(db, T, tenant, String(party.clientId)).catch(() => null);
      const have = new Set((Array.isArray(v.tab) ? v.tab : []).map((l: any) => String(l?.itemId || '')));
      return m?.usual.find((u) => !have.has(u.id))?.name?.slice(0, 80) || null;
    };
    const partyOf = async (v: any) => (v?.partyId && ID.test(String(v.partyId)) ? (await db.doc(`${T}/parties/${v.partyId}`).get()).data() || null : null);

    if (action === 'ask') {
      const what = String(b.what || '') as AskKind; if (!ASK_KINDS.includes(what)) return bad('What would you like?');
      // Per table (a whole room on the venue's Wi-Fi shares one address): a few a minute from this table's link.
      if (tooMany(`ask|${tenantId}|${token}`, 8)) return bad('One moment, then try again.', 429);
      const slow = await limitPublic(req, 'table_ask', tenantId, { perHour: 600, perDay: 0 }); if (slow) return slow;
      const vRef = db.doc(`${T}/appointments/${visitId}`);
      const item = what === 'usual' ? await usualOf(found.v, await partyOf(found.v)) : null;
      if (what === 'usual' && !item) return bad('Ask your server for your usual.');
      const r: any = await db.runTransaction(async (tx: any) => {
        const v: any = (await tx.get(vRef)).data() || {};
        const pRef = v.partyId && ID.test(String(v.partyId)) ? db.doc(`${T}/parties/${v.partyId}`) : null;
        const party: any = pRef ? (await tx.get(pRef)).data() || null : null;
        if (v.status === 'completed' || (party && party.status !== 'seated')) throw new PayStop('Your table’s check is closed. Ask anyone on the team.', 409);
        const asks: GuestAsk[] = Array.isArray(v.guestAsks) ? v.guestAsks : []; const done = party?.nudges || {};
        const open = openOfKind(asks, what, done); if (open) return { ask: open, already: true };
        // Every ask still open is kept (one of each kind at most); the oldest ones someone has seen make room, so a long
        // night never runs out.
        const stillOpen = asks.filter((a) => askOpen(a, done));
        const ask: GuestAsk = { id: Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '').padEnd(6, '0'), what, at: new Date().toISOString(), ...(item ? { item } : {}) };
        const seenRoom = Math.max(0, MAX_ASKS - stillOpen.length - 1);
        const keep = asks.filter((a) => !askOpen(a, done)).slice(-seenRoom);
        tx.set(vRef, { guestAsks: [...asks.filter((a) => keep.includes(a) || askOpen(a, done)), ask] }, { merge: true });
        // Asking for the check shows on the host stand too: the table is nearly free.
        if (what === 'check' && pRef && party && !party.checkAt) tx.set(pRef, { checkAt: ask.at, checkBy: 'The table' }, { merge: true });
        return { ask };
      });
      forgetFloor(tenantId);
      return ok({ ask: { ...r.ask, said: askSaid(r.ask, null), seen: false }, already: !!r.already });
    }

    // view
    const s = tablePayOf(tenant);
    const ck = await checkOf(db, T, tenant, visitId, found.v);
    if (found.v.status === 'completed') return ok({ ...look, state: 'closed' });
    const why = payableWhy(tenant, ck);
    const total = ck.bill.total;
    // The guest pass: where their order is, what they've asked for, and their usual.
    const tab: any[] = Array.isArray(found.v.tab) ? found.v.tab : [];
    const kds = Array.from(new Set(tab.map((l) => String(l?.kdsId || '')).filter((x) => ID.test(x)))).slice(0, 120);
    const kSnaps = kds.length ? await db.getAll(...kds.map((k) => db.doc(`${T}/kdsTickets/${k}`))) : [];
    const tickets: Record<string, any> = {}; for (const k of kSnaps) if (k.exists) tickets[k.id] = { status: String((k.data() || {}).status || '') };
    const party: any = await partyOf(found.v); const done = party?.nudges || {};
    const asks = (Array.isArray(found.v.guestAsks) ? found.v.guestAsks : []).slice(-6).map((a: GuestAsk) => { const seen = askSeen(a, done); const by = seen ? firstName(done[`ask:${a.id}`]?.by) || null : null;
      return { id: a.id, what: a.what, at: a.at, seen, said: askSaid(a, by) }; });
    const pass = { courses: passCourses(tab, tickets, coursesOf(tenant)), asks, usual: await usualOf(found.v, party), payOn: s.on, checkAsked: !!party?.checkAt };
    return ok({ ...look, state: why ? 'wait' : 'open', why, table: ck.table || tableLabel(found.v.tableName), pass,
      settings: { ways: s.ways, tips: s.tips, tipBase: s.tipBase, suggest: s.suggest },
      lines: ck.bill.lines.map((l) => ({ lineId: l.lineId, name: l.name, seat: l.seat, price: l.price, comped: l.comped, state: ck.st.covered.has(l.lineId) ? 'paid' : ck.st.busy.has(l.lineId) ? 'busy' : 'open' })),
      subtotal: ck.bill.subtotal, discount: ck.bill.discount, tax: ck.bill.tax, total, paid: ck.st.paid, claimed: ck.st.claimed,
      split: { way: ck.st.way, ways: ck.st.ways, partsTaken: ck.st.partsTaken },
      covered: Array.from(ck.st.covered), busy: Array.from(ck.st.busy) });
  } catch (e: any) {
    if (e instanceof PayStop) return bad(e.msg, e.status, e.code ? { code: e.code } : {});
    console.error('[table-pay]', e);
    return bad('That didn’t go through. Try again in a moment.', 500);
  }
}
