// src/app/api/host/floor/route.ts — THE HOST STAND'S FLOOR: where every table is in its meal and when it's likely free
// (lib/table-stage), and the steps that text a waiting guest. Anyone on the team, signed in; settings need a manager.
//   floor    { tenantId } → each seated table's stage and likely free time by table, who looks after which tables (first
//            names), and the floor and wait-list settings.
//   link     { tenantId, partyId, resend? } → the party's own wait link (lib/wait-line): made once, and texted to them
//            when the business sends links and there's a mobile number (once, unless `resend`).
//   hold     { tenantId, partyId, unitId } → hold a nearly-ready table for a waiting party and text them to head back.
//            The hold lasts until the table's likely free plus the business's hold time. Their drinks go to the bar now
//            when the business makes them "when we text them".
//   ring     { tenantId, partyId, tableName } → the drinks they ordered while waiting go on the table's tab (once; after
//            that, the drinks not yet taken out are pointed at this table).
//   left     { tenantId, partyId, noShow? } → a waiting party isn't here any more (or never came back after the text):
//            off the list, and drinks already at the bar for them come off (when that fails, the party says so and
//            `unring` tries again).
//   settings { tenantId, floor?, wait? } → the business's floor and wait-list settings (a manager).
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { sendTenantSms } from '@/lib/sms';
import { linkOrigin } from '@/lib/app-origin';
import { cleanFloor, floorSettingsOf } from '@/lib/table-stage';
import { cleanWait, waitSettingsOf } from '@/lib/wait-line';
import { FloorStop, forgetFloor, readFloor, ringPreorder, stagesByUnit, tablesOf, voidPreorderOrFlag } from '@/lib/floor-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const firstName = (v: unknown) => String(v || '').trim().split(/\s+/)[0]?.slice(0, 40) || 'Hi';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'floor');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['floor', 'link', 'hold', 'ring', 'left', 'unring', 'settings'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, action === 'settings' ? 'manager' : 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return bad('The floor is the business’s own.', 403);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = g.tenant && Object.keys(g.tenant).length ? g.tenant : ((await db.doc(T).get()).data() || {});
  { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
  const by = String(g.actor?.name || 'Host').slice(0, 60);

  try {
    if (action === 'settings') {
      const patch: Record<string, any> = {};
      if (b.floor && typeof b.floor === 'object') patch['hostingSettings.floor'] = cleanFloor(b.floor);
      if (b.wait && typeof b.wait === 'object') patch['hostingSettings.wait'] = cleanWait(b.wait);
      if (!Object.keys(patch).length) return bad('Nothing to save.');
      await db.doc(T).update(patch);
      forgetFloor(tenantId);
      return ok({ floor: patch['hostingSettings.floor'] || floorSettingsOf(tenant), wait: patch['hostingSettings.wait'] || waitSettingsOf(tenant) });
    }

    if (action === 'floor') {
      const read = await readFloor(db, T, tenant);
      return ok({ session: read.session?.id || null, stages: stagesByUnit(read), staff: read.staff, floor: floorSettingsOf(tenant), wait: waitSettingsOf(tenant), at: read.at });
    }

    if (action === 'ring') {
      const partyId = String(b.partyId || ''); if (!ID.test(partyId)) return bad('Which party?');
      const r = await ringPreorder(db, T, tenant, partyId, String(b.tableName || ''), by);
      return ok(r);
    }

    const partyId = String(b.partyId || ''); if (!ID.test(partyId)) return bad('Which party?');
    const pRef = db.doc(`${T}/parties/${partyId}`);
    const wait = waitSettingsOf(tenant);
    const business = String(tenant.name || tenant.businessName || '').slice(0, 60);

    if (action === 'left') {
      const at = new Date().toISOString();
      await db.runTransaction(async (tx: any) => {
        const s = await tx.get(pRef); const p: any = s.exists ? s.data() || {} : null;
        if (!p) throw new FloorStop('That party wasn’t found.', 404);
        if (!['waiting', 'notified', 'expected'].includes(String(p.status))) throw new FloorStop('They’re not waiting now.');
        tx.set(pRef, { status: b.noShow === true ? 'no_show' : 'left', leftAt: at, leftBy: 'host', holdUnitId: null, holdUntil: null }, { merge: true });
      });
      const v = await voidPreorderOrFlag(db, T, partyId, by, b.noShow === true ? 'Didn’t come back' : 'Left the wait list');
      forgetFloor(tenantId);
      return ok(v);
    }

    if (action === 'unring') {
      const p: any = (await pRef.get()).data();
      if (!p) return bad('That party wasn’t found.', 404);
      if (p.status === 'seated') return bad('They’re seated. Take drinks off from their tab.', 409);
      if (!['left', 'no_show'].includes(String(p.status)) && !p.drinksStuckAt) return bad('They’re still on the list.', 409);
      const v = await voidPreorderOrFlag(db, T, partyId, by, 'Left the wait list');
      return v.stuck ? bad('Their drinks still couldn’t be taken off. Try again in a moment.', 500) : ok(v);
    }

    if (action === 'link') {
      const made = await db.runTransaction(async (tx: any) => {
        const s = await tx.get(pRef); const p: any = s.exists ? s.data() || {} : null;
        if (!p) throw new FloorStop('That party wasn’t found.', 404);
        if (!['waiting', 'notified'].includes(String(p.status))) throw new FloorStop('They’re not waiting now.');
        const token = p.waitToken && /^[A-Za-z0-9_-]{20,40}$/.test(p.waitToken) ? p.waitToken : randomBytes(16).toString('base64url');
        const send = wait.link && !!String(p.phone || '').trim() && (!p.linkSentAt || b.resend === true);
        tx.set(pRef, { waitToken: token, ...(send ? { linkSentAt: new Date().toISOString() } : {}) }, { merge: true });
        return { token, send, p };
      });
      const url = `${linkOrigin(tenant, req.nextUrl.origin)}/wait/${encodeURIComponent(tenantId)}/${made.token}`;
      if (!made.send) return ok({ url, sent: false, message: wait.link ? (String(made.p.phone || '').trim() ? 'Their link was already sent.' : 'No mobile number, so no text. Their link is ready to share.') : 'Wait links are off in Hosting settings.' });
      const text = `${firstName(made.p.name)}, you’re on the list${business ? ` at ${business}` : ''}. See your place in line${wait.preorder ? ' and order a drink' : ''}: ${url}`;
      const r = await sendTenantSms(db, tenantId, String(made.p.phone), text, { email: null, subject: 'You’re on the list' },
        { kind: 'host_wait_link', recipientType: 'client', recipientId: partyId, recipientName: String(made.p.name || '').slice(0, 80) || null }).catch(() => ({ ok: false }));
      if (!r?.ok) { await pRef.set({ linkSentAt: null }, { merge: true }).catch(() => {}); return ok({ url, sent: false, message: 'The text didn’t go through. Their link is ready to share.' }); }
      return ok({ url, sent: true });
    }

    // hold: a nearly-ready table, held for them while they head back.
    const unitId = String(b.unitId || ''); if (!ID.test(unitId)) return bad('Which table?');
    const read = await readFloor(db, T, tenant, { fresh: true });
    if (!read.session) return bad('Tonight’s floor isn’t open.', 409);
    const t = tablesOf(read, tenant, Date.now()).find((x) => x.id === unitId);
    if (!t) return bad('That table isn’t on tonight’s floor.', 404);
    // Who holds which table tonight is kept on the session too, and read in the same step, so two people holding one
    // table at once can't both succeed (one goes again and finds it held).
    const sRef = db.doc(`${T}/serviceSessions/${read.session.id}`);
    const held = await db.runTransaction(async (tx: any) => {
      const s = await tx.get(pRef); const p: any = s.exists ? s.data() || {} : null;
      const ss: any = (await tx.get(sRef)).data() || {};
      if (!p) throw new FloorStop('That party wasn’t found.', 404);
      if (p.sessionId !== read.session.id) throw new FloorStop('They’re on another night’s list.');
      if (!['waiting', 'notified'].includes(String(p.status))) throw new FloorStop('They’re not waiting now.');
      if (t.heldFor && t.heldFor !== partyId) throw new FloorStop(`${t.name} is held for someone else.`);
      if (t.capacity < (Number(p.size) || 1)) throw new FloorStop(`${t.name} seats ${t.capacity}.`);
      const now = Date.now(); const nowIso = new Date(now).toISOString();
      const other = ss.holds?.[unitId];
      if (other && other.partyId !== partyId && Date.parse(other.until) > now && ID.test(String(other.partyId))) {
        const o: any = (await tx.get(db.doc(`${T}/parties/${other.partyId}`))).data() || {};
        if (['waiting', 'notified'].includes(String(o.status)) && o.holdUnitId === unitId && Date.parse(o.holdUntil) > now) throw new FloorStop(`${t.name} is held for someone else.`);
      }
      const until = new Date(now + ((t.freeIn ?? 0) + wait.holdMin) * 60000).toISOString();
      tx.set(pRef, { status: 'notified', notifiedAt: p.notifiedAt || nowIso, holdUnitId: unitId, holdUntil: until, heldAt: nowIso, holdBy: by }, { merge: true });
      tx.set(sRef, { holds: { [unitId]: { partyId, until } } }, { merge: true });
      return { p, until };
    });
    forgetFloor(tenantId);
    let rung = 0;
    if (wait.preorder && wait.drinksWhen === 'ready') rung = (await ringPreorder(db, T, tenant, partyId, t.name, by).catch(() => ({ rung: 0 }))).rung;
    const phone = String(held.p.phone || '').trim();
    if (!phone) return ok({ sent: false, until: held.until, rung, message: `${t.name} is held for them. No mobile number, so let them know in person.` });
    const text = `${firstName(held.p.name)}, your table${business ? ` at ${business}` : ''} is almost ready. Please head back to the host stand now.`;
    const r = await sendTenantSms(db, tenantId, phone, text, { email: null, subject: 'Your table is almost ready' },
      { kind: 'host_ready', recipientType: 'client', recipientId: partyId, recipientName: String(held.p.name || '').slice(0, 80) || null }).catch(() => ({ ok: false }));
    return ok({ sent: !!r?.ok, until: held.until, rung, ...(r?.ok ? {} : { message: `${t.name} is held for them, but the text didn’t go through. Let them know in person.` }) });
  } catch (e: any) {
    if (e instanceof FloorStop) return bad(e.msg, e.status);
    console.error('[host floor]', e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
