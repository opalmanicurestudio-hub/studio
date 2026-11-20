// Checks "They're here" (lib/arrival-nudge, lib/arrival-nudge-server, api/arrival, and the screens that use them).
// - The rules: what the desk sees (told, no answer, nudged again, answered, not buzzed), the guest's line, the buzz.
// - Nudging: once per arrival, at once, never for a renter's guest, a visit not checked in or already started, or by
//   the provider themselves; again only with no answer, at most once a minute; the visit says whether it buzzed.
// - Answering: the provider or a manager; the alert that asked is marked read; nothing once the visit has started.
// - Every door: the desk, the planner, the kiosk and the guest's own link all go through the one nudge.
// - The screens: the provider's four answers, the desk's Nudge again, the guest's page.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/arrival-nudge.verify.tsx
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'desk1', name: 'Dana Desk', role: 'front_desk', isManager: false, caps: [] };
let pushAs = 'sent to 1 device';
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: { name: 'North Pier', timezone: 'America/New_York' } }) };
  if (request === '@/lib/push' || /\/src\/lib\/push(\.ts)?$/.test(request)) return fake(request, { pushNow: async (d: any, t: string) => {
    const snap = await d.collection(`tenants/${t}/notifications`).get();
    for (const x of snap.docs) if (!(x.data() || {}).pushResult) await x.ref.set({ pushedAt: new Date().toISOString(), pushResult: pushAs }, { merge: true });
  } });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer x' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const notes = async () => (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const L = await import('../../src/lib/arrival-nudge');
  const now = Date.parse('2026-11-19T20:10:00.000Z'); const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
  const here = { id: 'a1', checkInStatus: 'arrived', status: 'confirmed' };

  console.log('what the desk sees');
  check('nobody nudged: nothing to say', L.nudgeView(here, now) === null);
  check('told just now: says so, no nudging yet', JSON.stringify(L.nudgeView({ ...here, arrivalNudge: { at: iso(0), lastAt: iso(0), count: 1, toName: 'Maria', buzz: 'sent' } }, now)) === JSON.stringify({ text: 'Told Maria just now', tone: 'info', canAgain: false }));
  const four = L.nudgeView({ ...here, arrivalNudge: { at: iso(4), lastAt: iso(4), count: 1, toName: 'Dev', buzz: 'sent' } }, now);
  check('no answer after three minutes: amber, and the desk can nudge again', four?.text === 'Dev was told 4 min ago, no answer yet' && four.tone === 'warn' && four.canAgain === true, four);
  const twice = L.nudgeView({ ...here, arrivalNudge: { at: iso(5), lastAt: iso(0.5), count: 2, toName: 'Dev', buzz: 'sent' } }, now);
  check('…nudged twice: says so, and not again within the minute', twice?.text === 'Dev was nudged twice, no answer yet' && twice.canAgain === false, twice);
  const ans = L.nudgeView({ ...here, arrivalNudge: { at: iso(5), toName: 'Maria' }, arrivalReply: { kind: 'now', at: iso(1), for: 'Maria' } }, now);
  check('answered: their answer and when, green for coming now', ans?.text === 'Maria: coming now, 1 min ago' && ans.tone === 'ok' && !ans.canAgain, ans);
  check('…5 minutes is plain', L.nudgeView({ ...here, arrivalReply: { kind: 'five', at: iso(2), for: 'Lena' } }, now)?.text === 'Lena: 5 minutes, 2 min ago' && L.nudgeView({ ...here, arrivalReply: { kind: 'five', at: iso(2), for: 'Lena' } }, now)?.tone === 'info');
  const nophone = L.nudgeView({ ...here, arrivalNudge: { at: iso(1), lastAt: iso(1), count: 1, toName: 'Priya', buzz: 'no phone' } }, now);
  check('not buzzed: says why, so the desk goes back', nophone?.text === 'Priya wasn’t buzzed: no phone is set up for alerts' && nophone.tone === 'warn' && !nophone.canAgain, nophone);
  check('…paused alerts, and a failed buzz (which can be tried again)', L.nudgeView({ ...here, arrivalNudge: { at: iso(2), lastAt: iso(2), toName: 'Priya', buzz: 'paused' } }, now)?.text === 'Priya wasn’t buzzed: their alerts are paused'
    && L.nudgeView({ ...here, arrivalNudge: { at: iso(2), lastAt: iso(2), toName: 'Priya', buzz: 'failed' } }, now)?.canAgain === true);
  check('started, or not checked in: nothing', L.nudgeView({ ...here, status: 'servicing', arrivalNudge: { at: iso(4), toName: 'Dev' } }, now) === null && L.nudgeView({ id: 'x', status: 'confirmed', arrivalNudge: { at: iso(4) } }, now) === null);
  check('the buzz, read from what the sender recorded', L.buzzOf('sent to 2 devices') === 'sent' && L.buzzOf('no phone registered') === 'no phone' && L.buzzOf('held: quiet hours') === 'paused' && L.buzzOf('failed: unknown') === 'failed' && L.buzzOf('') === 'later');

  console.log('the guest’s own page');
  check('no answer: they know you’re here', L.guestWaitLine('Maria Lopez', 'shortly', null, now) === 'Maria knows you’re here and will be with you shortly.' && L.guestWaitLine('', 'at 3:00 PM', null, now) === 'We know you’re here and will be with you at 3:00 PM.');
  check('coming now: right out (and, later, shortly)', L.guestWaitLine('Maria', 'shortly', { kind: 'now', at: iso(1) }, now) === 'Maria will be right out.' && L.guestWaitLine('Maria', 'shortly', { kind: 'now', at: iso(8) }, now) === 'Maria will be with you shortly.');
  check('5 or 10 minutes counts down', L.guestWaitLine('Maria', 'shortly', { kind: 'ten', at: iso(3) }, now) === 'Maria will be with you in about 7 minutes.' && L.guestWaitLine('Maria', 'shortly', { kind: 'five', at: iso(6) }, now) === 'Maria will be with you shortly.');
  check('send them back', L.guestWaitLine('Maria', 'shortly', { kind: 'send', at: iso(0) }, now) === 'Maria is ready for you. Someone will show you back.');
  const { visitProjection } = await import('../../src/lib/visit');
  const pv: any = visitProjection({ ...here, startTime: iso(-10), arrivalReply: { kind: 'five', at: iso(1), by: 'maria', byName: 'Maria', for: 'Maria' }, arrivalNudge: { toName: 'Maria', to: 'maria' } });
  check('their page gets the answer and when, nothing else about it', JSON.stringify(pv.providerReply) === JSON.stringify({ kind: 'five', at: iso(1) }) && !('arrivalNudge' in pv) && !('arrivalReply' in pv), pv.providerReply);

  console.log('nudging');
  const { POST } = await import('../../src/app/api/arrival/route');
  const A = (b: any) => POST(req({ tenantId: 't1', ...b }));
  await db.doc(T).set({ name: 'North Pier', timezone: 'America/New_York' });
  await db.doc(`${T}/staff/maria`).set({ name: 'Maria Lopez', role: 'staff' });
  await db.doc(`${T}/staff/dev`).set({ name: 'Dev Shah', role: 'staff' });
  await db.doc(`${T}/services/gel`).set({ name: 'Gel full set' });
  const visit = (id: string, extra: any = {}) => db.doc(`${T}/appointments/${id}`).set({ id, tenantId: 't1', clientName: 'Sam Lee', staffId: 'maria', serviceId: 'gel', status: 'confirmed', checkInStatus: 'arrived', startTime: '2026-11-19T20:00:00.000Z', ...extra });
  await visit('a1');
  let r: any = await A({ appointmentId: 'a1', action: 'tell', via: 'front desk' });
  let n = await notes(); let a: any = await get(`${T}/appointments/a1`);
  check('told: one alert for their provider, buzzing, with a title and what it is', r.body.ok && r.body.told && n.length === 1 && n[0].userId === 'maria' && n[0].type === 'guest_arrived' && n[0].title === 'Sam is here'
    && n[0].message === 'Sam is here for their 3:00 PM gel full set. Checked in at the desk.' && n[0].link === '/planner?visit=a1', { body: r.body, n });
  check('…and the visit says who was told, when, and that it buzzed', a.arrivalNudge?.count === 1 && a.arrivalNudge.to === 'maria' && a.arrivalNudge.toName === 'Maria' && a.arrivalNudge.via === 'front desk' && a.arrivalNudge.buzz === 'sent' && a.arrivalNudge.noteId === n[0].id, a.arrivalNudge);
  r = await A({ appointmentId: 'a1', action: 'tell', via: 'planner' });
  check('once: a second check-in tap tells nobody again', r.body.ok && !r.body.told && r.body.why === 'already told' && (await notes()).length === 1, r.body);
  actor = { uid: 'maria', name: 'Maria Lopez', role: 'staff', isManager: false };
  await visit('a2'); r = await A({ appointmentId: 'a2', action: 'tell' });
  check('not when the provider checked them in themselves', !r.body.told && r.body.why === 'self' && (await notes()).length === 1);
  actor = { uid: 'desk1', name: 'Dana Desk', role: 'front_desk', isManager: false };
  await visit('a3', { isRenterBooking: true }); await visit('a4', { checkInStatus: 'pending' }); await visit('a5', { status: 'servicing' }); await visit('a6', { staffId: null });
  const skip = await Promise.all(['a3', 'a4', 'a5', 'a6'].map((id) => A({ appointmentId: id, action: 'tell' })));
  check('nobody nudged for a renter’s guest, someone not checked in, a visit under way, or no provider', skip.map((x: any) => x.body.why).join() === 'renter,not here,started,no provider' && (await notes()).length === 1, skip.map((x: any) => x.body));
  pushAs = 'no phone registered'; await visit('a7', { staffId: 'dev', clientName: 'Jo Park', serviceId: null, serviceName: 'Haircut' });
  r = await A({ appointmentId: 'a7', action: 'tell' });
  check('a provider with no phone set up: the visit says it didn’t buzz', r.body.told && r.body.buzz === 'no phone' && (await get(`${T}/appointments/a7`)).arrivalNudge.buzz === 'no phone', r.body);
  pushAs = 'sent to 1 device';

  console.log('nudging again');
  r = await A({ appointmentId: 'a1', action: 'again' });
  check('too soon: inside three minutes of the first, refused with words', r.status === 409 && /Give it a minute/.test(r.body.error), r.body);
  r = await A({ appointmentId: 'a2', action: 'again' });
  check('…and never as a first nudge: someone nobody was told about is checked in first', r.status === 409 && /hasn’t been told yet/.test(r.body.error) && (await notes()).length === 2, r.body);
  await db.doc(`${T}/appointments/a1`).set({ arrivalNudge: { at: new Date(Date.now() - 4 * 60000).toISOString(), lastAt: new Date(Date.now() - 30000).toISOString() } }, { merge: true });
  r = await A({ appointmentId: 'a1', action: 'again' });
  check('…nor within a minute of the last one', r.status === 409, r.body);
  await db.doc(`${T}/appointments/a1`).set({ arrivalNudge: { lastAt: new Date(Date.now() - 4 * 60000).toISOString(), at: new Date(Date.now() - 4 * 60000).toISOString() } }, { merge: true });
  r = await A({ appointmentId: 'a1', action: 'again' }); n = await notes(); a = await get(`${T}/appointments/a1`);
  const again = n.find((x: any) => x.title === 'Sam is still waiting');
  check('after a minute: a second alert, still waiting, and the count goes up', r.body.ok && r.body.told && !!again && again.message === 'Sam is still waiting for their 3:00 PM gel full set. The desk is asking again.' && a.arrivalNudge.count === 2 && a.arrivalNudge.noteId === again.id, { body: r.body, nudge: a.arrivalNudge });

  console.log('answering');
  r = await A({ appointmentId: 'a1', action: 'reply', reply: 'five' });
  check('someone else on the team can’t answer for the provider', r.status === 403 && /Only their provider/.test(r.body.error), r.body);
  actor = { uid: 'maria', name: 'Maria Lopez', role: 'staff', isManager: false };
  r = await A({ appointmentId: 'a1', action: 'reply', reply: 'soon' });
  check('…and the answer has to be one of the four', r.status === 400);
  r = await A({ appointmentId: 'a1', action: 'reply', reply: 'five' }); a = await get(`${T}/appointments/a1`);
  check('the provider answers: on the visit, in first names, and the alert that asked is read', r.body.ok && a.arrivalReply.kind === 'five' && a.arrivalReply.by === 'maria' && a.arrivalReply.for === 'Maria' && (await get(`${T}/notifications/${a.arrivalNudge.noteId}`)).read === true, a.arrivalReply);
  actor = { uid: 'desk1', name: 'Dana Desk', role: 'front_desk', isManager: false };
  r = await A({ appointmentId: 'a1', action: 'again' });
  check('answered: nobody is nudged again', r.status === 409 && /already answered/.test(r.body.error));
  actor = { uid: 'boss', name: 'Ana Ruiz', role: 'manager', isManager: true };
  r = await A({ appointmentId: 'a7', action: 'reply', reply: 'now' }); a = await get(`${T}/appointments/a7`);
  check('a manager can answer for them, in the provider’s name', r.body.ok && a.arrivalReply.kind === 'now' && a.arrivalReply.for === 'Dev' && a.arrivalReply.byName === 'Ana', a.arrivalReply);
  r = await A({ appointmentId: 'a5', action: 'reply', reply: 'now' });
  check('…not once the visit has started', r.status === 409 && /already started/.test(r.body.error));
  actor = { uid: 'r1', name: 'Rae Renter', role: 'renter', isManager: false, isRenter: true };
  r = await A({ appointmentId: 'a1', action: 'again' });
  check('a renter doesn’t nudge or answer for the shop’s visits', r.status === 403);

  console.log('every door');
  const desk = src('src/components/pos/desk/DeskCheckIn.tsx'); const plan = src('src/app/(app)/planner/page.tsx');
  check('the desk: a booked visit’s provider is nudged by the server once it’s saved (a walk-in’s is told as before)', /if \(notify && provider && !isWalkIn\) void arrivalCall\(\{ tenantId: e\.tenantId, appointmentId: item\.id, action: 'tell', via: 'front desk' \}\);/.test(desk) && /if \(notify && provider && isWalkIn\) \{/.test(desk));
  check('the planner: the same, after it saves, and not for someone already here', /if \(!wasHere\) void arrivalCall\(\{ tenantId, appointmentId: apt\.id, action: 'tell', via: 'planner' \}\)/.test(plan) && !/arrivalNotice/.test(plan));
  const wk = src('src/app/api/walkins/route.ts');
  check('the kiosk, alongside its forms work and finished before it answers', /nudgeProvider\(db, tenantId, String\(ref\.id\), \{ via: 'kiosk' \}\)/.test(wk) && /await nudging;\n  return \{ already, formsDue, formsSent, seeDesk \};/.test(wk));
  const ci = src('src/app/api/checkins/route.ts');
  check('the guest’s own I’m here; a guest with no provider yet, and running late, buzz the floor at once', /const r = await nudgeProvider\(db, tenantId, String\(body\.appointmentId\), \{ via: 'client link', tenant: t \}\); nudged = r\.told \|\| r\.why === 'already told';/.test(ci)
    && /type: st === 'running_late' \? 'guest_running_late' : st === 'arrived' \? 'guest_arrived' : 'on_my_way'/.test(ci) && /if \(st !== 'on_my_way'\) \{ try \{ await \(await import\('@\/lib\/push'\)\)\.pushNow\(db, tenantId\);/.test(ci));
  const tier = src('src/lib/push-tier.ts'); const push = src('src/lib/push.ts');
  check('both kinds buzz, and the alert carries its own title', /guest_arrived: 'now'/.test(tier) && /guest_running_late: 'now'/.test(tier) && /n\.type === 'guest_arrived'\) && n\.title\)/.test(push));

  console.log('the screens');
  const { renderToStaticMarkup } = await import('react-dom/server'); const React = await import('react');
  const { HereForYou } = await import('../../src/components/visit/HereForYou');
  const html = renderToStaticMarkup(React.createElement(HereForYou, { tenantId: 't1', serviceOf: (v: any) => (v.serviceId === 'gel' ? 'Gel full set' : ''), visits: [
    { id: 'v1', clientName: 'Sam Lee', serviceId: 'gel', status: 'confirmed', checkInStatus: 'arrived', checkedInVia: 'front desk', startTime: '2026-11-19T20:00:00.000Z', arrivedAt: new Date(Date.now() - 2 * 60000).toISOString() },
    { id: 'v2', clientName: 'Ana Ortiz', serviceName: 'Brow shape', status: 'confirmed', checkInStatus: 'arrived', arrivalNudge: { via: 'client link' }, arrivedAt: new Date(Date.now() - 6 * 60000).toISOString(), arrivalReply: { kind: 'five', at: new Date().toISOString() } },
    { id: 'v3', clientName: 'Jo Park', status: 'servicing', checkInStatus: 'arrived' }, { id: 'v4', clientName: 'Rae Kim', status: 'confirmed', checkInStatus: 'pending' }] }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('the provider’s Today: each guest who’s here, longest wait first, with how they checked in', text.indexOf('Ana Ortiz is here') < text.indexOf('Sam Lee is here') && text.includes('6 min') && text.includes('Checked in on their own link.') && /Checked in at the desk\./.test(text) && !text.includes('Jo Park') && !text.includes('Rae Kim'), text);
  check('…four answers, one tap each, 44px, in a group named for the guest', /role="group" aria-label="Answer for Sam Lee"/.test(html) && ['Coming now', '5 minutes', '10 minutes', 'Send them back'].every((w) => html.includes(`>${w}</button>`)) && (html.match(/min-h-\[44px\]/g) || []).length >= 5);
  check('…an answer given shows, with Change', text.includes('You said 5 minutes') && text.includes('Change'));
  const hn = src('src/components/pos/desk/HereNow.tsx'); const pos = src('src/components/pos/desk/DeskPOS.tsx');
  check('the desk’s Here now: the answer or how long since, and Nudge again when there’s been none', /r\.nudge && <p/.test(hn) && /r\.nudge\?\.canAgain && onNudge && <Btn className="min-h-\[44px\]"/.test(hn) && /onNudge=\{async \(id: string\) => \{ const r = await arrivalCall\(\{ tenantId: e\.tenantId, appointmentId: id, action: 'again' \}\)/.test(pos)
    && /nudge: a\.id \? nudgeView\(a, now\.getTime\(\)\) : null/.test(src('src/lib/here-now.ts')));
  check('the staff portal’s Today and the planner’s side panel carry the answers', /<HereForYou tenantId=\{tenantId\} visits=\{todaysMine\}/.test(src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx')) && /<HereReply tenantId=/.test(src('src/components/planner/VisitPanel.tsx')));
  check('the guest’s page says what they answered', /reply=\{\(appointmentData as any\)\?\.providerReply \|\| null\}/.test(src('src/app/check-in/[token]/page.tsx')) && /guestWaitLine\(name \|\| '', when, reply, Date\.now\(\)\)/.test(src('src/components/visit/VisitStages.tsx')) && /guestWaitLine\(who, when, appointment\?\.providerReply, Date\.now\(\)\)/.test(src('src/components/visit/VisitLounge.tsx')));
  const mine = ['src/lib/arrival-nudge.ts', 'src/lib/arrival-nudge-server.ts', 'src/app/api/arrival/route.ts', 'src/components/visit/HereForYou.tsx', 'src/lib/arrival-client.ts'].map(src).join('\n');
  check('in the app’s own words and look', !/uppercase|font-black|\{\/\*| · |call us|contact us/i.test(mine) && !/[\u{1F300}-\u{1FAFF}]/u.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
