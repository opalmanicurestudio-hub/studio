// src/app/api/wait/route.ts — A WAITING GUEST'S OWN LINK (app/wait): no sign-in, the link's token is the key, and it
// only ever shows this one party (never anyone else's name). The host stand texts it when the business sends links.
//   view   { tenantId, token } → where they are: their place in line and wait (lib/wait-line, from the same floor the
//          host sees), whether their table is ready (and held for how long), their drinks, and the drinks they can add.
//   add    { tenantId, token, itemId } → one more of a drink for when they sit (priced from the menu here).
//   remove { tenantId, token, itemId } → one fewer, until the bar has it.
//   later  { tenantId, token } → "Need more time": back in line later by the business's time, as often as it allows.
//          A table held for them is let go, so it goes to the next party.
//   leave  { tenantId, token } → off the list. The host stand sees they left, and drinks already at the bar come off.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { toolLocked } from '@/lib/tool-lock';
import { publicLook } from '@/lib/public-look';
import { liveCounts } from '@/lib/dish-counts-server';
import { addPreorder, minutesWords, moreTime, placeWords, preorderTotal, removePreorder, waitSettingsOf } from '@/lib/wait-line';
import { forgetFloor, readFloor, voidPreorderOrFlag, waitDrinks, waitNow } from '@/lib/floor-server';
import { wordsList } from '@/lib/allergens';
import { tableLabel } from '@/lib/table-service';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: NO_STORE });
const bad = (error: string, status = 400, extra: any = {}) => NextResponse.json({ ok: false, error, ...extra }, { status, headers: NO_STORE });
class Stop extends Error { constructor(public msg: string, public status = 409) { super(msg); } }

// A link asks every 20 seconds or so; more than this in a minute is someone else's doing. Counted per link, per
// network address (roomy: a hundred guests on the business's own Wi-Fi share one), and links that don't exist per address
// and business, so guessing at links is slowed without locking real guests out.
const hits = new Map<string, number[]>();
function recent(key: string): number[] { const now = Date.now(); const list = (hits.get(key) || []).filter((t) => now - t < 60000); hits.set(key, list); return list; }
function tooMany(key: string, max: number, add = true): boolean {
  const list = recent(key); if (add) list.push(Date.now());
  if (hits.size > 5000) { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }
  return list.length > max;
}
// The business, read once for a few seconds (every waiting guest's page asks often).
const tenants = new Map<string, { at: number; v: any }>();
async function tenantOf(db: any, tenantId: string): Promise<any> {
  const hit = tenants.get(tenantId); if (hit && Date.now() - hit.at < 10000) return hit.v;
  const v = (await db.doc(`tenants/${tenantId}`).get()).data() || null;
  if (tenants.size > 500) { const now = Date.now(); for (const [k, x] of tenants) if (now - x.at >= 10000) tenants.delete(k); if (tenants.size > 500) tenants.clear(); }
  tenants.set(tenantId, { at: Date.now(), v }); return v;
}
// Links that were real a moment ago skip the guessing check, so nobody guessing at links can lock real guests out.
const known = new Map<string, number>();
const isKnown = (key: string) => { const t = known.get(key); return !!t && Date.now() - t < 30 * 60000; };
const remember = (key: string) => { if (known.size > 5000) known.clear(); known.set(key, Date.now()); };
/** The caller's address as the platform saw it (not a value the caller can add to the header themselves). */
function callerOf(req: NextRequest): string {
  const h = (k: string) => String(req.headers?.get?.(k) || '').trim();
  const fwd = h('x-forwarded-for').split(',').map((x) => x.trim()).filter(Boolean);
  return (h('x-vercel-forwarded-for').split(',')[0] || h('x-real-ip') || fwd[fwd.length - 1] || 'unknown').trim().slice(0, 60);
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const token = String(b.token || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId) || !TOKEN.test(token)) return bad('This link isn’t complete. Open it from your text again.');
  if (!['view', 'add', 'remove', 'later', 'leave'].includes(action)) return bad('Unknown action.');
  const ip = callerOf(req); const missKey = `miss|${ip}|${tenantId}`;
  if (tooMany(`ip|${ip}`, 400) || tooMany(`${tenantId}|${token}`, action === 'view' ? 40 : 20) || (!isKnown(`${tenantId}|${token}`) && tooMany(missKey, 30, false))) return bad('One moment, then try again.', 429);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  try {
    const tenant: any = await tenantOf(db, tenantId);
    if (!tenant) { tooMany(missKey, 30); return bad('This link isn’t working any more.', 404); }
    { const locked = toolLocked(tenant, ['hospitality'], 'guest', 'The wait list isn’t open right now.'); if (locked) return locked; }
    const found = await db.collection(`${T}/parties`).where('waitToken', '==', token).limit(1).get();
    if (found.empty) { tooMany(missKey, 30); return bad('This link isn’t working any more.', 404); }
    remember(`${tenantId}|${token}`);
    const pRef = found.docs[0].ref; const partyId = found.docs[0].id;
    const s = waitSettingsOf(tenant);
    const sessionOpen = async (p: any) => { const ss: any = p.sessionId && ID.test(String(p.sessionId)) ? (await db.doc(`${T}/serviceSessions/${p.sessionId}`).get()).data() : null; return !!ss && ss.status === 'open'; };

    if (action !== 'view') {
      const first = (await pRef.get()).data() || {};
      if (!(await sessionOpen(first))) return bad('The list has closed for today.');
      const now = Date.now(); const nowIso = new Date(now).toISOString();
      let item: any = null;
      if (action === 'add') {
        if (!s.preorder) return bad('Drinks can be ordered at your table.');
        const itemId = String(b.itemId || ''); if (!ID.test(itemId)) return bad('Which drink?');
        const counts = await liveCounts(db, tenantId, tenant).catch(() => ({ soldOut: [] as string[] }));
        item = (await waitDrinks(db, T, tenant, new Set(counts.soldOut || []))).find((d) => d.id === itemId) || null;
        if (!item) return bad('That one isn’t available now. Pick another, or order it at your table.');
      }
      const res = await db.runTransaction(async (tx: any) => {
        const p: any = (await tx.get(pRef)).data() || {};
        const waiting = ['waiting', 'notified'].includes(String(p.status));
        if (action === 'leave') {
          if (!waiting) throw new Stop(p.status === 'seated' ? 'You’re already seated. Enjoy!' : 'You’re not on the list now.');
          tx.set(pRef, { status: 'left', leftAt: nowIso, leftBy: 'guest', holdUnitId: null, holdUntil: null }, { merge: true });
          return { left: true };
        }
        if (action === 'later') {
          const m = moreTime({ status: String(p.status), laterCount: p.laterCount, laterUntil: p.laterUntil }, s, now);
          if (!m.ok) throw new Stop(m.error);
          // A table held for them goes to the next party; they're texted again when one's ready.
          tx.set(pRef, { laterUntil: m.until, laterCount: (Number(p.laterCount) || 0) + 1, laterAt: nowIso, status: 'waiting', notifiedAt: null, holdUnitId: null, holdUntil: null }, { merge: true });
          return { until: m.until };
        }
        if (!waiting) throw new Stop(p.status === 'seated' ? 'You’re seated now. Order at your table.' : 'You’re not on the list now.');
        if (p.preorderRungAt) throw new Stop('The bar has your drinks already. Anything else, order at your table.');
        if (action === 'add') {
          const r = addPreorder(p.preorder || [], { id: item.id, name: item.name, price: item.price }, nowIso);
          if (!r.ok) throw new Stop(r.error);
          tx.set(pRef, { preorder: r.lines, preorderAt: nowIso }, { merge: true });
          return { lines: r.lines };
        }
        const lines = removePreorder(p.preorder || [], String(b.itemId || ''));
        tx.set(pRef, { preorder: lines, preorderAt: nowIso }, { merge: true });
        return { lines };
      });
      // Drinks already at the bar for someone who's left come off (lib/floor-server).
      if (action === 'leave') await voidPreorderOrFlag(db, T, partyId, 'The guest, from their link');
      forgetFloor(tenantId);
      return ok(res);
    }

    // view
    const p: any = { id: partyId, ...((await pRef.get()).data() || {}) };
    const open = await sessionOpen(p);
    const status = String(p.status || '');
    const state = !open && ['waiting', 'notified', 'expected'].includes(status) ? 'closed'
      : status === 'notified' ? 'ready' : status === 'waiting' ? 'waiting' : status === 'seated' ? 'seated' : status === 'left' ? 'left' : 'done';
    // Once they've left, or the night is over, the link says only that: no name, no order.
    const look = { look: publicLook(tenant), business: String(tenant.name || tenant.businessName || '').slice(0, 80) };
    if (!open || state === 'left' || state === 'done' || state === 'closed') return ok({ ...look, state: state === 'left' ? 'left' : state === 'closed' ? 'closed' : 'done' });
    const base = { ...look, first: String(p.name || '').trim().split(/\s+/)[0]?.slice(0, 40) || '',
      size: Number(p.size) || 1, state, preorder: Array.isArray(p.preorder) ? p.preorder : [], preorderTotal: preorderTotal(p.preorder || []), rung: !!p.preorderRungAt, drinksWhen: s.drinksWhen };
    if (state !== 'waiting' && state !== 'ready') return ok(base);
    const now = Date.now();
    const read = await readFloor(db, T, tenant);
    const place = waitNow(read, tenant, p, now);
    const units: any[] = Array.isArray(read.session?.units) ? read.session.units : [];
    const holdUntil = p.holdUntil && Date.parse(p.holdUntil) > now ? p.holdUntil : null;
    const holdName = holdUntil ? String(units.find((u: any) => String(u.id) === String(p.holdUnitId))?.name || '') : '';
    const holdTable = holdName ? tableLabel(holdName) : '';
    const m = moreTime({ status, laterCount: p.laterCount, laterUntil: p.laterUntil }, s, now);
    let drinks: any[] = [];
    if (s.preorder && !p.preorderRungAt) {
      const counts = await liveCounts(db, tenantId, tenant).catch(() => ({ soldOut: [] as string[] }));
      drinks = (await waitDrinks(db, T, tenant, new Set(counts.soldOut || []))).map((d) => ({ id: d.id, name: d.name, price: d.price, section: d.section, contains: d.contains.length ? `Contains ${wordsList(d.contains)}` : '' }));
    }
    return ok({ ...base, place: place.place, ahead: place.ahead, minutes: place.minutes, placeWords: placeWords(place), minutesWords: minutesWords(place.minutes),
      notifiedAt: p.notifiedAt || null, holdUntil, holdTable, laterUntil: p.laterUntil && Date.parse(p.laterUntil) > now ? p.laterUntil : null,
      canLater: m.ok, moreMin: s.moreMin, preorderOn: s.preorder, drinks });
  } catch (e: any) {
    if (e instanceof Stop) return bad(e.msg, e.status);
    console.error('[wait]', e);
    return bad('That didn’t go through. Try again in a moment.', 500);
  }
}
