// src/app/api/counter/voice/route.ts — THE DRIVE-THRU'S VOICE ASSISTANT, through the server (L21). A car at the
// speaker is greeted by a voice assistant that takes the order itself (its tools: api/counter/assistant), and the team
// can listen in from the lane screen, take over on their own microphone at any moment (the order taken so far stays
// exactly as it is), or tell the assistant something mid-order ("we're out of shakes").
//   The voice service's own browser kit runs the call on the speaker tablet and the monitoring on the lane screen, but
//   every request it makes comes here instead (its fetch is pointed at this route), and this route adds the secret
//   key, the assistant, and what it should know about this business. A screen never holds the key, and only ever
//   reaches the calls this business started (driveThruCalls/{callId}, at the top of the database: server only).
//   config  { tenantId, key }                   → whether the assistant is on here, and the public key (if one is set)
//                                                  for the live transcript
//   speaker { tenantId, key }                   → the car at the speaker now (for the speaker tablet to greet)
//   start   { tenantId, key, carId }            → the call for that car, made with the secret key (its connection
//                                                  details only, nothing else)
//   op      { tenantId, key, callId, op, body? } → listen, take over (the assistant stops; whoever took over is kept on
//                                                  the car), tell the assistant something, or hang up, for one of this
//                                                  business's own calls
//   ended   { tenantId, key, callId }           → the speaker tablet says the call is over
// Only a drive-thru lane screen's key (or a team member signed in) is accepted, and only while Lounge & hospitality is on.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { accessLockOf } from '@/lib/tenant-access';
import { toolLocked } from '@/lib/tool-lock';
import { screenOf, teamInstead, workingNow } from '@/lib/screen-keys';
import { RUSH_CARS, inLineNow } from '@/lib/counter-orders';
import { readMenu } from '@/lib/menu-server';
import { menuForVoice } from '@/lib/voice-order';
import { agentOf, voiceOn, markCallEnded } from '@/lib/drive-thru-voice';
import { FieldValue } from 'firebase-admin/firestore';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const CALL = /^[A-Za-z0-9_-]{6,128}$/;
// Calls a business can start in a day (the voice service bills every minute, so a stuck sensor or a loop can't run up
// a bill): RETELL_DRIVETHRU_DAILY_CAP, or 600. A call nobody ended is treated as over after 11 minutes (the assistant
// is set to hang up after 10).
const DAILY_CAP = () => { const n = Math.floor(Number(process.env.RETELL_DRIVETHRU_DAILY_CAP)); return Number.isFinite(n) && n > 0 ? n : 600; };
const STALE_MS = 11 * 60000;
const first = (s: unknown) => String(s || '').trim().split(/\s+/)[0] || 'Someone';
const RETELL = 'https://api.retellai.com';
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const OPS: Record<string, { method: string; path: (id: string) => string }> = {
  'listen-live-call': { method: 'POST', path: (id) => `/v2/listen-live-call/${encodeURIComponent(id)}` },
  'take-over-live-call': { method: 'POST', path: (id) => `/v2/take-over-live-call/${encodeURIComponent(id)}` },
  'update-live-call': { method: 'PATCH', path: (id) => `/v2/update-live-call/${encodeURIComponent(id)}` },
  'stop-call': { method: 'POST', path: (id) => `/v2/stop-call/${encodeURIComponent(id)}` },
};


async function retell(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  // (15 seconds at most: shorter than the 20 a take-over claim is held for, so a slow answer never lets two people on.)
  const r = await fetch(`${RETELL}${path}`, { method, headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  return { status: r.status, data };
}

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['config', 'speaker', 'start', 'op', 'ended'].includes(action)) return bad('Unknown action.');
    const db = getAdminDb(); const T = `tenants/${tenantId}`;

    let screen: any = await screenOf(db, tenantId, b.key);
    if (!screen && !b.key) {
      const t: any = await teamInstead(req, db, tenantId);
      if (t.deny) return t.deny;
      if (t.renter) return bad('This is for the business’s own team.', 403);
      screen = { ref: null, name: t.member.name, kind: 'drive-thru', passes: {}, member: t.member };
    }
    if (!screen) {
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This screen isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }
    if (screen.kind !== 'drive-thru') return bad('This screen isn’t set up for the drive-thru. A manager can set it up here.', 401);
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'The drive-thru is closed for now. The business owner can tell you more.' }, { status: 403 });
    // Taking over or hanging up a call already going always works; starting one needs the tool on.
    if (action === 'start' || action === 'speaker') { const locked = toolLocked(tenant, ['hospitality']); if (locked) return locked; }
    const nowIso = new Date().toISOString();

    if (action === 'config') return ok({ on: voiceOn(tenant), publicKey: voiceOn(tenant) ? (process.env.RETELL_PUBLIC_KEY || null) : null, setUp: !!process.env.RETELL_API_KEY && !!agentOf(tenant) });

    if (action === 'speaker') {
      // The newest car at the speaker whose order is still being taken: the one to greet.
      const snap = await db.collection(`${T}/driveThruCars`).where('stage', '==', 'speaker').limit(100).get();
      // (A car taken in line, before the speaker, already has someone with it: never greeted.)
      const car: any = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => c.inLine !== true).sort((a: any, c: any) => String(c.arrivedAt).localeCompare(String(a.arrivedAt)))[0] || null;
      const o: any = car?.orderId && ID.test(String(car.orderId)) ? (await db.doc(`${T}/counterOrders/${car.orderId}`).get()).data() : null;
      return ok({ on: voiceOn(tenant), now: nowIso, car: car ? { id: car.id, number: car.number, orderId: car.orderId || null, arrivedAt: car.arrivedAt, voice: car.voice || null, items: Array.isArray(o?.lines) ? o.lines.length : 0 } : null });
    }

    if (action === 'start') {
      if (!voiceOn(tenant)) return bad('The voice assistant isn’t set up here yet.', 409);
      const carId = String(b.carId || ''); if (!ID.test(carId)) return bad('Which car?');
      const carRef = db.doc(`${T}/driveThruCars/${carId}`);
      // One call a car: claimed first, so two tablets (or a double tap) never start two.
      const claim: any = await db.runTransaction(async (tx: any) => {
        const car: any = (await tx.get(carRef)).data();
        if (!car || car.stage !== 'speaker') return { error: 'That car isn’t at the speaker.', status: 409 };
        if (car.inLine === true) return { error: 'That car’s order is being taken in line.', status: 409 };
        const o: any = car.orderId ? (await tx.get(db.doc(`${T}/counterOrders/${car.orderId}`))).data() : null;
        if (!o || o.status !== 'building') return { error: 'That order has been taken already.', status: 409 };
        const v = car.voice || {};
        const fresh = Date.now() - Date.parse(String(v.at || v.startedAt || '')) < (v.status === 'starting' ? 20000 : STALE_MS);
        if (v.status === 'starting' && fresh) return { error: 'The assistant is already starting for that car.', status: 409 };
        if ((v.status === 'live' || v.status === 'taken_over') && fresh) return { error: 'That car already has a call.', status: 409 };
        // The day's calls, counted in the same step (server only), so they can't run past the cap.
        const useRef = db.doc(`${T}/private/driveThruVoice_${todayIn(tenantTimeZone(tenant))}`);
        const used = Math.floor(Number(((await tx.get(useRef)).data() || {}).calls) || 0);
        if (used >= DAILY_CAP()) return { error: 'The voice assistant has taken today’s most calls. Take orders by hand until tomorrow.', status: 429 };
        tx.set(useRef, { calls: FieldValue.increment(1) }, { merge: true });
        tx.set(carRef, { voice: { status: 'starting', at: nowIso } }, { merge: true });
        return { car, order: o };
      });
      if (claim.error) return bad(claim.error, claim.status);
      // From here, anything that goes wrong leaves the car able to be greeted again (never stuck "starting").
      let r: { status: number; data: any };
      try {
        const [menuItems, laneSnap] = await Promise.all([readMenu(db, tenantId), db.collection(`${T}/driveThruCars`).where('stage', 'in', ['speaker', 'pay', 'pickup', 'forward']).limit(60).get()]);
        const menu = menuForVoice(menuItems);
        // A long line (this many cars in it, counting this one) puts the assistant in rush mode: no suggestions, a short
        // read-back. Only cars that arrived in the last three hours count, so one left behind yesterday never does.
        const others = inLineNow(laneSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), Date.now(), carId);
        const busy = others + 1 >= RUSH_CARS;
        r = await retell('POST', '/v3/create-web-call', {
          agent_id: agentOf(tenant),
          retell_llm_dynamic_variables: { business_name: String(tenant.name || tenant.businessName || 'our drive-thru').slice(0, 80), order_number: String(claim.car.number || ''), menu: menu.slice(0, 12000),
            ask_name: tenant.driveThru?.askName === false ? 'no' : 'yes', busy: busy ? 'yes' : 'no' },
          // (Named so the call log for phone calls never takes it for one of its own: api/voice/call-events.)
          metadata: { driveThruTenantId: tenantId, carId, orderId: claim.car.orderId, kind: 'drive-thru' },
        });
      } catch (e: any) { r = { status: 599, data: { message: e?.message || 'network' } }; }
      if (r.status >= 300 || !r.data?.call_id || !CALL.test(String(r.data.call_id))) {
        await carRef.set({ voice: { status: 'failed', at: nowIso } }, { merge: true }).catch(() => undefined);
        console.error('[counter/voice] start', r.status, r.data?.message || r.data?.error_message || '');
        return bad('The voice assistant didn’t answer. Take this order by hand.', 502);
      }
      const callId = String(r.data.call_id);
      await Promise.all([
        db.doc(`driveThruCalls/${callId}`).set({ callId, tenantId, carId, orderId: claim.car.orderId, number: claim.car.number, startedAt: nowIso, status: 'live' }),
        carRef.set({ voice: { status: 'live', callId, at: nowIso, startedAt: nowIso } }, { merge: true }),
      ]);
      // Only what the browser kit needs to join the call.
      const { call_id, access_token, transport, url, ice_servers, expires_at } = r.data;
      return NextResponse.json({ call_id, access_token, ...(transport ? { transport } : {}), ...(url ? { url } : {}), ...(ice_servers ? { ice_servers } : {}), ...(expires_at ? { expires_at } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const callId = String(b.callId || ''); if (!CALL.test(callId)) return bad('Which call?');
    const call: any = (await db.doc(`driveThruCalls/${callId}`).get()).data();
    if (!call || call.tenantId !== tenantId) return bad('That call isn’t here.', 404);
    const carRef = ID.test(String(call.carId || '')) ? db.doc(`${T}/driveThruCars/${call.carId}`) : null;

    if (action === 'ended') { await markCallEnded(db, callId, 'speaker'); return ok(); }

    // op
    const op = OPS[String(b.op || '')]; if (!op) return bad('Unknown step.');
    let body: any = undefined;
    if (b.op === 'take-over-live-call') { const pid = String(b.body?.participant_id || ''); if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(pid)) return bad('Who is taking over?'); body = { participant_id: pid }; }
    else if (b.op === 'update-live-call') {
      // Only something to tell the assistant (and whether to say it now): nothing else about the call can be changed here.
      const said = String(b.body?.call_control?.additional_context || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!said) return bad('What should the assistant know?');
      body = { call_control: { additional_context: said, trigger_response: b.body?.call_control?.trigger_response === true } };
    } else if (b.op === 'listen-live-call') body = {};
    let who: string = screen.name;
    try { const staff = b.staffPass && screen.ref ? await workingNow(db, tenantId, screen, b.staffPass) : (screen.member || null); who = staff?.name || screen.name; } catch { /* the screen's name */ }
    // One person on the speaker at a time: the first tap on Take over claims the call, and anyone after them is told
    // who has it (a claim nobody finished is let go after 20 seconds).
    const callRef = db.doc(`driveThruCalls/${callId}`);
    if (b.op === 'take-over-live-call') {
      const got: any = await db.runTransaction(async (tx: any) => {
        const c: any = (await tx.get(callRef)).data() || {};
        if (c.status === 'taken_over') return { error: `${first(c.takenOverBy)} is already on this call.` };
        if (c.status === 'taking_over' && Date.now() - Date.parse(String(c.takingAt || '')) < 20000) return { error: `${first(c.takingBy)} is taking this call.` };
        if (c.status !== 'live' && c.status !== 'taking_over') return { error: 'This call has ended.' };
        tx.set(callRef, { status: 'taking_over', takingBy: who, takingAt: nowIso }, { merge: true });
        return { ok: true };
      });
      if (got.error) return NextResponse.json({ ok: false, error: got.error, message: got.error }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    // A take-over that didn't happen gives the call back to the assistant (only if it's still this claim).
    const letGo = () => db.runTransaction(async (tx: any) => {
      const c: any = (await tx.get(callRef)).data() || {};
      if (c.status === 'taking_over' && c.takingAt === nowIso) tx.set(callRef, { status: 'live', takingBy: null, takingAt: null }, { merge: true });
    }).catch(() => undefined);
    let r: { status: number; data: any };
    try { r = await retell(op.method, op.path(callId), body); } catch { if (b.op === 'take-over-live-call') await letGo(); return bad('The voice service didn’t answer. Try again.', 502); }
    if (b.op === 'take-over-live-call' && r.status >= 300) await letGo();
    // Hanging up a call the service has already ended (the speaker tablet lost power, say) still ends it here: the
    // service answers that the call can't be found. A refused key, a bill or too many tries doesn't end anything.
    const ended = b.op === 'stop-call' && (r.status < 300 || [400, 404, 409, 410, 422].includes(r.status));
    // What happened is kept, but a slip here never turns a step the service took into an error on screen.
    try {
      if (r.status < 300 && b.op === 'take-over-live-call') {
        // Kept only while this claim is still the one on the call: a call that ended meanwhile (the car drove off) stays
        // ended, and is never marked taken over again.
        await db.runTransaction(async (tx: any) => {
          const c: any = (await tx.get(callRef)).data() || {};
          const car: any = carRef ? (await tx.get(carRef)).data() : null;
          if (c.status !== 'taking_over' || c.takingAt !== nowIso) return;
          tx.set(callRef, { status: 'taken_over', takenOverBy: who, takenOverAt: nowIso, takingBy: null, takingAt: null }, { merge: true });
          if (carRef && car?.voice?.callId === callId && car.voice.status !== 'ended') tx.set(carRef, { voice: { status: 'taken_over', callId, takenOverBy: who, at: nowIso } }, { merge: true });
        });
      }
      if (ended) { await db.doc(`driveThruCalls/${callId}`).set({ endedBy: who }, { merge: true }); await markCallEnded(db, callId, 'hung up'); }
      if (r.status < 300 && b.op === 'update-live-call') await db.doc(`driveThruCalls/${callId}`).set({ told: FieldValue.arrayUnion({ at: nowIso, by: who, text: body.call_control.additional_context }) }, { merge: true });
    } catch (e: any) { console.error('[counter/voice] record', e?.message || e); }
    if (ended) return NextResponse.json({}, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    // The service's own answer on success; anything else is ours to word (its details stay on the server).
    if (r.status < 300) return NextResponse.json(r.data ?? {}, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
    console.error('[counter/voice] op', b.op, r.status, r.data?.message || '');
    return NextResponse.json({ message: 'The voice service couldn’t do that right now.' }, { status: 502 });
  } catch (e: any) {
    console.error('[counter/voice] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
