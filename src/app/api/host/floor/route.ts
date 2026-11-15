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
//   settings { tenantId, floor?, wait?, booking?, memory? } → the business's floor, wait-list, online booking and
//            regulars settings (a manager).
//   booking_charge { tenantId, bookingId } → a manager charges a booking's no-show or late-cancel fee, the one the guest
//            agreed to (lib/table-booking-server). booking_letgo: not charged (a no-show marked as one, or a late cancel
//            let go). booking_cancel { bookingId, guestAsked? }: cancelled from the host stand (late, and the fee can be
//            charged, only when the guest asked).
//   guest_link { tenantId, partyId, clientId|null } → who a party is (a guest the business has), or "not them"
//            (lib/guest-memory-server). guest_note { tenantId, partyId, clientId, note }: the team's note for next time,
//            for the guest a party on tonight's floor is linked to. guest_find { tenantId, term }: "Been here before?",
//            guests by name, number or email (a hint of their contact details only), a few a minute.
//   make_right { tenantId, partyId } → a Making it right case for a seated table (lib/table-recovery-server): its food
//            is late or something isn't right. The one already open for the visit when there is one.
//   sections { tenantId } → tonight's sections for the host stand's chart (lib/sections-server): each table with its
//            people and whether it's seated, the floor's people with who's on tonight, and who can change them.
//   section_tap { tenantId, unitId, staffId } → that table is theirs tonight (or back to nobody if it was theirs alone).
//   call_out { tenantId, staffId, to } → someone called out: their tables go to one person, or 'share' (to whoever's on
//            tonight with the fewest, a table at a time). hand { tenantId, partyId, to }: a seated table handed to
//            someone (its own server can, or whoever runs the floor). Whoever is given a seated table hears it.
//   usual    { tenantId } → a manager keeps tonight's sections as the floor plan's usual ones.
// The floor read says which seated tables need someone (lib/table-recovery): a table that told us something isn't right
// from its page, and food later than the business's minutes, each with its case when there is one.
// The floor read also puts today's online bookings on the host stand as parties still to come, and says which late
// cancels could be charged. When the business shows regulars, it suggests who tonight's parties are (an exact mobile
// number or email of a guest it already has; only the host's yes links them) and gives each one's memory: visits,
// usuals, usual table, allergies and the team's note.
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { toolLocked } from '@/lib/tool-lock';
import { sendTenantSms } from '@/lib/sms';
import { linkOrigin } from '@/lib/app-origin';
import { cleanFloor, floorSettingsOf } from '@/lib/table-stage';
import { cleanWait, waitSettingsOf } from '@/lib/wait-line';
import { FloorStop, forgetFloor, readFloor, ringPreorder, stagesByUnit, tablesOf, voidPreorderOrFlag, type FloorRead } from '@/lib/floor-server';
import { hostLateText, lateCourses, recoverySettingsOf, reportItem } from '@/lib/table-recovery';
import { caseForVisit } from '@/lib/table-recovery-server';
import { cleanTableBooking, tableBookingOf } from '@/lib/table-booking';
import { BookStop, bookingsOnFloor, cancelBooking, chargeBooking, letGo } from '@/lib/table-booking-server';
import { cleanMemory, memorySettingsOf } from '@/lib/guest-memory';
import { findGuests, GuestStop, linkGuest, memoriesFor, recognize, saveGuestNote, tableTakesGuest } from '@/lib/guest-memory-server';
import { tellSeated } from '@/lib/floor-buzz';
import { handTable, keepAsUsual, runsFloor, SectionStop, sectionCallOut, sectionsNow, sectionTap, tellGiven } from '@/lib/sections-server';

/** Seated tables that need someone (lib/table-recovery): one that told us something isn't right, and food later than
 *  the business's minutes. Each with its case when there is one. */
function troublesOf(read: FloorRead, tenant: any, now: number) {
  if (!read.session) return [];
  const R = recoverySettingsOf(tenant); const out: { partyId: string; table: string; kind: 'report' | 'late'; text: string; caseId: string | null; seen: boolean; safety: boolean }[] = [];
  for (const t of read.seated) {
    const askId = String(t.report?.askId || ''); const seenBy = t.report && askId ? (t.nt.done as any)?.[`ask:${askId}`] : null; const seen = !!seenBy && !seenBy.until;
    // Someone has had it a quarter of an hour: off the host stand (it stays on the case).
    // (A safety one stays while they're seated.)
    if (t.report && (t.report.safety || !(seen && now - Date.parse(String(seenBy.at || '')) > 15 * 60000))) {
      out.push({ partyId: t.partyId, table: t.nt.table, kind: 'report', safety: !!t.report.safety, seen, caseId: t.caseId || null,
        text: `${t.nt.table} says something isn’t right: ${reportItem(String(t.report.label || 'Something else'), t.report.dish || null)}.${seen && seenBy?.by ? ` ${String(seenBy.by).split(' ')[0]} is on it.` : ''}` });
      continue;
    }
    if (R.hostLateMin > 0) {
      const late = lateCourses(t.nt.tab as any, t.nt.tickets as any, t.nt.courses, now, R.hostLateMin)[0];
      if (late) out.push({ partyId: t.partyId, table: t.nt.table, kind: 'late', safety: false, seen: false, caseId: t.caseId || null, text: hostLateText(t.nt.table, late) });
    }
  }
  return out.sort((a, b) => Number(b.safety) - Number(a.safety) || Number(a.kind === 'late') - Number(b.kind === 'late'));
}


export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
/** "Been here before?" looks, by person, in the last minute. */
const finds = new Map<string, number[]>();
const firstName = (v: unknown) => String(v || '').trim().split(/\s+/)[0]?.slice(0, 40) || 'Hi';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'floor');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['floor', 'link', 'hold', 'ring', 'left', 'unring', 'settings', 'booking_charge', 'booking_letgo', 'booking_cancel', 'guest_link', 'guest_note', 'guest_find', 'make_right', 'event', 'sections', 'section_tap', 'call_out', 'hand', 'usual'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, action === 'settings' || action === 'booking_charge' || action === 'usual' ? 'manager' : 'staff'); if (g.deny) return g.deny;
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
      if (b.booking && typeof b.booking === 'object') patch['hostingSettings.booking'] = cleanTableBooking(b.booking);
      if (b.memory && typeof b.memory === 'object') patch['hostingSettings.memory'] = cleanMemory(b.memory);
      if (!Object.keys(patch).length) return bad('Nothing to save.');
      await db.doc(T).update(patch);
      forgetFloor(tenantId);
      return ok({ floor: patch['hostingSettings.floor'] || floorSettingsOf(tenant), wait: patch['hostingSettings.wait'] || waitSettingsOf(tenant), booking: patch['hostingSettings.booking'] || tableBookingOf(tenant),
        memory: patch['hostingSettings.memory'] || memorySettingsOf(tenant) });
    }

    // Tonight's event, for the host stand's tablet: only what seating its guests needs (its name and table plan). The
    // event's own page keeps its client, quote and money.
    if (action === 'event') {
      const q = await db.collection(`${T}/studioEvents`).where('status', '==', 'active').limit(1).get();
      if (q.empty) return ok({ event: null });
      const e: any = q.docs[0].data() || {};
      const tables = Array.isArray(e.seatingTables) ? e.seatingTables.slice(0, 200) : null;
      return ok({ event: { id: q.docs[0].id, name: String(e.name || e.title || 'Tonight’s event').slice(0, 80), seatingTables: tables } });
    }

    // TONIGHT'S SECTIONS (lib/sections-server). Changing them is for whoever runs the floor; a server hands over their own.
    if (['sections', 'section_tap', 'call_out', 'hand', 'usual'].includes(action)) {
      try {
        if (action === 'sections') {
          const r = await sectionsNow(db, T);
          return ok({ ...r, canEdit: runsFloor(g.actor), canUsual: !!g.actor?.isTenantOwner || !!g.actor?.isManager, me: String(g.actor?.uid || '') });
        }
        if (action === 'usual') { const r = await keepAsUsual(db, T); forgetFloor(tenantId); return ok(r); }
        if (action === 'hand') {
          const r = await handTable(db, T, g.actor, String(b.partyId || ''), String(b.to || ''));
          forgetFloor(tenantId);
          const told = await tellGiven(db, tenantId, tenant, r.moves, [String(g.actor?.uid || '') || null]);
          return ok({ moved: r.moves.length, told });
        }
        if (!runsFloor(g.actor)) return bad('Tonight’s sections are set at the host stand, or by a manager.', 403);
        const r = action === 'section_tap' ? await sectionTap(db, T, String(b.unitId || ''), String(b.staffId || ''))
          : await sectionCallOut(db, T, String(b.staffId || ''), String(b.to || 'share'));
        forgetFloor(tenantId);
        const told = await tellGiven(db, tenantId, tenant, r.moves, [String(g.actor?.uid || '') || null, action === 'call_out' ? String(b.staffId || '') : null]);
        return ok({ moved: r.moves.length, told, ...('staffIds' in r ? { staffIds: r.staffIds } : {}), ...('words' in r ? { words: r.words } : {}) });
      } catch (e: any) { if (e instanceof SectionStop) return bad(e.message, e.status); throw e; }
    }

    if (action === 'make_right') {
      const partyId = String(b.partyId || ''); if (!ID.test(partyId)) return bad('Which table?');
      const read = await readFloor(db, T, tenant, { fresh: true });
      const t = read.seated.find((x) => x.partyId === partyId); if (!t) return bad('That table isn’t seated any more.', 404);
      const late = lateCourses(t.nt.tab as any, t.nt.tickets as any, t.nt.courses, Date.now(), 0)[0];
      const words = t.report ? `${t.nt.table} told us: ${reportItem(String(t.report.label || ''), t.report.dish || null)}.` : late ? hostLateText(t.nt.table, late) : `${t.nt.table}: the host is making it right.`;
      const actor = { staffId: String(g.actor?.uid || ''), name: by, role: String(g.actor?.role || 'staff'), isManager: !!g.actor?.isManager || !!g.actor?.isTenantOwner, isOwner: !!g.actor?.isTenantOwner, portal: false, caps: [] };
      const r = await caseForVisit(db, tenantId, actor, t.nt.visitId, { via: 'floor', reasonId: t.report?.reasonId || (late ? 'wait' : 'service'), words });
      if (!r.ok) return bad(r.error, 409);
      forgetFloor(tenantId);
      return ok({ caseId: r.id, opened: r.opened });
    }

    if (action === 'floor') {
      const read = await readFloor(db, T, tenant);
      // Today's online bookings on the host stand (made once each), and late cancels that could be charged.
      const lateCancels = read.session ? await bookingsOnFloor(db, T, tenant, read.session).catch((e) => { console.warn('[host/floor] bookings', e); return []; }) : [];
      const manager = !!g.actor?.isTenantOwner || !!g.actor?.isManager || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || '').toLowerCase());
      // Regulars: tonight's parties linked to guests the business has, and what it knows about each (lib/guest-memory).
      const memory = memorySettingsOf(tenant); let guests: Record<string, any> = {};
      if (memory.on && read.session) {
        const live = read.parties.filter((p: any) => ['waiting', 'notified', 'expected', 'seated'].includes(String(p.status)));
        const suggested = await recognize(db, T, live).catch((e) => { console.warn('[host/floor] guests', e); return {} as Record<string, string>; });
        await tableTakesGuest(db, T, live, by).catch(() => 0);
        const ids = [...live.flatMap((p: any) => [p.clientId, suggested[p.id] || p.guestSuggest]), ...read.lobby.map((m: any) => m.clientId)].filter((x) => x && x !== 'guest-walkin').map(String);
        guests = await memoriesFor(db, T, tenant, ids).catch(() => ({}));
        // A guest only suggested by a number or email someone typed: their name and how often they've been, nothing more,
        // until the host says it's them.
        const linkedIds = new Set([...live.map((p: any) => p.clientId), ...read.lobby.map((m: any) => m.clientId)].filter(Boolean).map(String));
        for (const [id, m] of Object.entries(guests)) if (!linkedIds.has(id)) guests[id] = { ...m, usual: [], table: null, allergy: null, note: null, lastAt: null };
      }
      return ok({ session: read.session?.id || null, stages: stagesByUnit(read), staff: read.staff, floor: floorSettingsOf(tenant), wait: waitSettingsOf(tenant), at: read.at, lateCancels, manager, memory, guests,
        // How far behind the kitchen is (lib/kitchen-pace): already counted in the likely free times above.
        pace: read.pace && read.pace.level !== 'calm' ? read.pace : null,
        // Tables that need someone: something isn't right, or food later than the business's minutes (lib/table-recovery).
        troubles: troublesOf(read, tenant, Date.now()) });
    }

    if (action === 'booking_charge' || action === 'booking_letgo' || action === 'booking_cancel') {
      const bookingId = String(b.bookingId || ''); if (!/^tb[0-9a-f]{16}$/.test(bookingId)) return bad('Which booking?');
      try {
        if (action === 'booking_charge') return ok(await chargeBooking(db, T, tenant, tenantId, bookingId, by));
        if (action === 'booking_cancel') return ok(await cancelBooking(db, T, tenant, tenantId, bookingId, by, { guestAsked: b.guestAsked === true }));
        return ok(await letGo(db, T, tenant, bookingId, by));
      } catch (e: any) { if (e instanceof BookStop) return NextResponse.json({ ok: false, error: e.msg, code: e.code || null }, { status: e.status }); throw e; }
    }

    if (action === 'guest_link' || action === 'guest_note' || action === 'guest_find') {
      try {
        if (action === 'guest_find') {
          const k = `${tenantId}|${g.actor?.uid || by}`; const now = Date.now(); const list = (finds.get(k) || []).filter((t) => now - t < 60000);
          if (list.length >= 20) return bad('One moment, then look again.', 429);
          list.push(now); finds.set(k, list); if (finds.size > 2000) finds.clear();
          return ok({ guests: await findGuests(db, T, String(b.term || '')) });
        }
        if (action === 'guest_note') {
          // Only for a guest someone on tonight's floor is linked to.
          const partyId = String(b.partyId || ''); const p: any = ID.test(partyId) ? (await db.doc(`${T}/parties/${partyId}`).get()).data() : null;
          if (!p || !p.clientId || String(p.clientId) !== String(b.clientId || '') || !['waiting', 'notified', 'expected', 'seated'].includes(String(p.status))) return bad('Link them first, then add a note.', 409);
          return ok(await saveGuestNote(db, T, String(b.clientId || ''), b.note, by));
        }
        const r = await linkGuest(db, T, String(b.partyId || ''), b.clientId ? String(b.clientId) : null, by);
        forgetFloor(tenantId);
        return ok(r);
      } catch (e: any) { if (e instanceof GuestStop) return bad(e.msg, e.status); throw e; }
    }

    if (action === 'ring') {
      const partyId = String(b.partyId || ''); if (!ID.test(partyId)) return bad('Which party?');
      const r = await ringPreorder(db, T, tenant, partyId, String(b.tableName || ''), by);
      // The host stand calls this right after seating someone: their table's server hears (lib/floor-buzz), once.
      await tellSeated(db, tenantId, partyId);
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
