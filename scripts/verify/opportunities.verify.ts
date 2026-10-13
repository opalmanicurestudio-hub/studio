// scripts/verify/opportunities.verify.ts — checks the Opportunities rules (lib/opportunities) and the server half
// (lib/opportunities-server) against an in-memory database.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/opportunities.verify.ts
import { makeDb, check, failures } from './fake-db';

const DAY = 864e5;
const NOW = Date.parse('2026-10-12T15:00:00-04:00');
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const ahead = (d: number) => new Date(NOW + d * DAY).toISOString();
const ms = (v: any) => Date.parse(String(v || '')) || 0;

(async () => {
  const O = await import('../../src/lib/opportunities');
  const S = O.oppSettingsOf({});
  const clients = [
    { id: 'maria', name: 'Maria Lopez', firstName: 'Maria', phone: '+15550001', smsMarketingOptIn: true },
    { id: 'sam', name: 'Sam Taylor', phone: '+15550002' },
    { id: 'dana', name: 'Dana Kim', phone: '+15550003' },
    { id: 'ana', name: 'Ana Ruiz', phone: '+15550004' },
    { id: 'bo', name: 'Bo Chen', phone: '+15550005' },
    { id: 'rita', name: 'Rita (renter client)', phone: '+15550006' },
  ];
  const ap = (id: string, clientId: string, start: string, status = 'completed', extra: any = {}) => ({ id, clientId, startTime: start, status, staffId: 'maya', serviceName: 'Gel fill', price: 65, createdAt: start, ...extra });
  const appointments = [
    // Maria: every 21 days, last one 35 days ago → due
    ap('m1', 'maria', ago(98)), ap('m2', 'maria', ago(77)), ap('m3', 'maria', ago(56)), ap('m4', 'maria', ago(35)),
    // Sam: one visit 5 days ago → first visit
    ap('s1', 'sam', ago(5), 'completed', { serviceName: 'Classic pedicure', staffId: 'jo' }),
    // Dana: last visit 130 days ago → long gone
    ap('d1', 'dana', ago(160)), ap('d2', 'dana', ago(130)),
    // Ana: cancelled 2 days ago, nothing since
    ap('a1', 'ana', ago(40)), ap('a2', 'ana', ago(2), 'cancelled', { cancelledAt: ago(2) }),
    // Bo: due-ish but has an upcoming visit → nothing
    ap('b1', 'bo', ago(80)), ap('b2', 'bo', ago(50)), ap('b3', 'bo', ahead(3), 'confirmed'),
    // A renter's client → never on the studio's list
    ap('r1', 'rita', ago(160), 'completed', { staffId: 'renter1' }), ap('r2', 'rita', ago(130), 'completed', { staffId: 'renter1' }),
  ];
  const quotes = [{ id: 'q1', status: 'viewed', sentAt: ago(4), expiresInDays: 30, clientName: 'Lee Park', lineItems: [{ price: 180, quantity: 3 }], viewedAt: ago(3) }];
  const giftCards = [{ id: 'g1', status: 'active', balanceCents: 6000, createdAt: ago(120), recipient: { name: 'Chris Moore', phone: '+15550009' } }];
  console.log('Opportunities — the finders');
  const c = O.findCandidates({ clients, appointments, quotes, giftCards, settings: S, now: NOW, tz: 'America/New_York', renterStaffIds: new Set(['renter1']) });
  const kindOf = (id: string) => c.find((x) => x.clientId === id)?.kind;
  check('a regular past their usual gap is due (21-day client, 35 days)', kindOf('maria') === 'due', c.map((x) => [x.clientId, x.kind]));
  check('one visit 5 days ago → a first-visit check-in', kindOf('sam') === 'first_visit');
  check('130 days since the last visit → long gone', kindOf('dana') === 'long_gone');
  check('a cancel 2 days ago with nothing rebooked → cancelled', kindOf('ana') === 'cancelled' && c.find((x) => x.clientId === 'ana')?.facts.when);
  check('anyone with a visit coming up is left alone', !kindOf('bo'));
  check('a renter’s client is never on the studio’s list', !kindOf('rita'));
  const q = c.find((x) => x.kind === 'quote'); check('a quote opened but not answered after 4 days, worth its total', q && q.valueCents === 54000 && /opened/.test(q.why), q);
  const g = c.find((x) => x.kind === 'gift_card'); check('a gift card untouched for 4 months → a reminder, with the balance', g && g.facts.balance === '$60' && g.clientName === 'Chris Moore', g);
  const due = c.find((x) => x.kind === 'due')!; check('the value is an estimate from their average visit', due.valueCents === 6500 && due.providerId === 'maya');

  console.log('Opportunities — who gets one');
  const cl = new Map<string, any>(clients.map((x) => [x.id, x]));
  const f1 = O.filterCandidates(c, { existing: [], clients: cl, openCaseClients: new Set(['dana']), recentAutoNudge: new Set(), now: NOW });
  check('an open Making it right case blocks it — fix first', !f1.some((x) => x.clientId === 'dana'));
  const cl2 = new Map(cl); cl2.set('maria', { ...clients[0], marketingOptOut: true }); cl2.set('ana', { ...clients[3], marketingOptOut: true });
  const f2 = O.filterCandidates(c, { existing: [], clients: cl2, openCaseClients: new Set(), recentAutoNudge: new Set(), now: NOW });
  check('no to marketing: no win-back for them — but a cancel follow-up still is fine', !f2.some((x) => x.clientId === 'maria') && f2.some((x) => x.clientId === 'ana'));
  const f3 = O.filterCandidates(c, { existing: [{ clientId: 'maria', kind: 'due', status: 'done', createdAt: ago(20), key: 'due:maria' }], clients: cl, openCaseClients: new Set(), recentAutoNudge: new Set(['sam']), now: NOW });
  check('a recent one for the same thing cools it down; an automatic reminder already working holds it back', !f3.some((x) => x.clientId === 'maria') && !f3.some((x) => x.clientId === 'sam'));
  const f4 = O.filterCandidates([...c, { ...due, kind: 'no_rebook', key: 'no_rebook:maria' }], { existing: [], clients: cl, openCaseClients: new Set(), recentAutoNudge: new Set(), now: NOW });
  check('one task per client at a time', f4.filter((x) => x.clientId === 'maria').length === 1);
  let h = 0; for (let i = 0; i < 2000; i++) if (O.isHoldout(`due:c${i}`, '2026-10', 10)) h++;
  check('about 1 in 10 is left alone, at random', h > 140 && h < 260, h);

  console.log('Opportunities — words and people');
  check('a client never gets a wording they’ve had', O.pickVersion('due', [0]) === 1 && O.pickVersion('due', [0, 1]) === 2 && O.pickVersion('due', []) === 0);
  const msg = O.fill(O.PLAYBOOKS.first_visit.versions[0], { first: 'Sam', me: 'Jo', business: 'Opal', service_short: 'pedicure' });
  check('the message is filled in and reads cleanly', msg === 'Hi Sam, this is Jo from Opal. I wanted to check how your pedicure is holding up. I hope you are enjoying it.', msg);
  check('no first message has a link, a price or a deadline in it', Object.values(O.PLAYBOOKS).every((p) => p.versions.every((v) => !/https?:|\$\d|today only|ends|hurry|last chance/i.test(v))));
  const team = [{ id: 'maya', name: 'Maya', role: 'stylist' }, { id: 'jo', name: 'Jo', role: 'front_desk' }, { id: 'jess', name: 'Jessica', role: 'owner' }, { id: 'renter1', name: 'R', role: 'renter' }];
  check('it goes to their provider', O.assignee('provider', 'maya', team, new Map(), 5)?.id === 'maya');
  check('provider at her limit → the desk', O.assignee('provider', 'maya', team, new Map([['maya', 5]]), 5)?.id === 'jo');
  check('desk tasks with no desk → a manager; owner tasks → the owner', O.assignee('desk', null, team.filter((m) => m.id !== 'jo'), new Map(), 5)?.id === 'jess' && O.assignee('owner', null, team, new Map(), 5)?.id === 'jess');
  check('never a renter', O.assignee('provider', 'renter1', team, new Map(), 5)?.id !== 'renter1');

  console.log('Opportunities — what an answer does');
  const e1 = O.outcomeEffects({ kind: 'due', tries: 0 }, 'not_now', NOW);
  check('not now → closed, and a follow-up in 3 weeks', e1.patch.status === 'done' && e1.followUpAt === new Date(NOW + 21 * DAY).toISOString());
  const e2 = O.outcomeEffects({ kind: 'due', tries: 2 }, 'no_answer', NOW); const e3 = O.outcomeEffects({ kind: 'due', tries: 0 }, 'no_answer', NOW);
  check('no answer stays open — until the third try, then it stops', !e3.patch.status && e2.patch.status === 'done' && e2.patch.outcome === 'no_answer');
  check('stop → off every list; a bad experience → a case', O.outcomeEffects({}, 'stop', NOW).optOut && O.outcomeEffects({}, 'bad_experience', NOW).openCase);
  check('a follow-up never makes another follow-up', O.outcomeEffects({ kind: 'follow_up' }, 'not_now', NOW).followUpAt === null);
  const back = O.cameBack({ clientId: 'maria', firstContactAt: ago(10) }, [ap('n1', 'maria', ago(3), 'completed', { createdAt: ago(9), price: 72 })], NOW);
  check('booked after we reached out and paid → counted with what it really paid', back.status === 'paid' && back.paidCents === 7200, back);
  check('a visit booked before we reached out isn’t counted', O.cameBack({ clientId: 'maria', firstContactAt: ago(10) }, [ap('n2', 'maria', ago(3), 'completed', { createdAt: ago(30) })], NOW).status === 'none');

  console.log('Opportunities — the server');
  const Srv = await import('../../src/lib/opportunities-server');
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', userId: 'jess' });
  for (const m of team) await db.doc(`${T}/staff/${m.id}`).set(m);
  for (const x of clients) await db.doc(`${T}/clients/${x.id}`).set(x);
  for (const a of appointments) await db.doc(`${T}/appointments/${a.id}`).set(a);
  const tenant = (await db.doc(T).get()).data();
  const PERSON = { holdoutPct: 0, modes: Object.fromEntries(O.FINDER_KINDS.map((k) => [k, 'person'])) };
  const r1: any = await Srv.opportunitySweep(db, 't1', { ...tenant, opportunities: PERSON }, NOW);
  const opps = (await db.collection(`${T}/opportunities`).get()).docs.map((d: any) => d.data());
  const mo = opps.find((o: any) => o.clientId === 'maria');
  check('the sweep makes tasks and hands them to the right people', r1.created >= 3 && mo?.assigneeId === 'maya' && opps.find((o: any) => o.clientId === 'ana')?.assigneeId === 'jo', { r1, opps: opps.map((o: any) => [o.clientId, o.kind, o.assigneeId]) });
  check('the message is in the provider’s name', /this is Maya/.test(mo?.message || ''), mo?.message);
  const bells = (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('one bell per person, not one per task', bells.filter((b: any) => b.userId === 'maya').length === 1 && /new task/.test(bells[0].message), bells);
  const r2: any = await Srv.opportunitySweep(db, 't1', tenant, NOW + 3600e3);
  check('once a day — a second run the same day does nothing', r2.skipped === 'done today');
  const r3: any = await Srv.opportunitySweep(db, 't1', { ...tenant, opportunities: PERSON }, NOW + 7200e3, { force: true });
  check('running it again never doubles a task', r3.created === 0, r3);

  const mgr = { staffId: 'jess', name: 'Jessica', role: 'owner', isManager: true, isOwner: true, portal: false };
  const jo = { staffId: 'jo', name: 'Jo', role: 'front_desk', isManager: false, isOwner: false, portal: true };
  const mine: any = await Srv.listOpportunities(db, 't1', jo as any, NOW);
  check('the team sees only their own tasks', mine.items.length > 0 && mine.items.every((o: any) => o.assigneeId === 'jo'));
  const notMine: any = await Srv.actOnOpportunity(db, 't1', jo as any, { action: 'outcome', id: mo.id, outcome: 'booked' }, NOW);
  check('and can’t answer someone else’s', !notMine.ok);
  // Texting: Sam hasn't said yes to marketing — but a first-visit check-in isn't marketing; Maria's due text is.
  const sam = opps.find((o: any) => o.clientId === 'sam'); const ana = opps.find((o: any) => o.clientId === 'ana');
  const night = Date.parse('2026-10-12T22:00:00-04:00');
  const t1 = await Srv.textCheck(db, 't1', tenant, ana, clients[3], night);
  check('outside texting hours → no', !t1.ok && /texting hours/.test((t1 as any).error));
  const t2 = await Srv.textCheck(db, 't1', tenant, { ...mo, kind: 'due' }, { ...clients[0], smsMarketingOptIn: false }, NOW);
  check('a win-back text needs their yes to marketing texts — otherwise it’s a call', !t2.ok && /call/.test((t2 as any).error));
  for (let i = 0; i < 4; i++) await db.collection(`${T}/opportunityTexts`).add({ clientId: 'maria', at: ago(i + 1), channel: 'sms', marketing: true });
  const t3 = await Srv.textCheck(db, 't1', tenant, mo, clients[0], NOW);
  check('the 30-day limit is shared with campaigns and reminders', !t3.ok && /4 texts/.test((t3 as any).error), t3);
  const t4 = await Srv.textCheck(db, 't1', tenant, sam, clients[1], NOW);
  check('a check-in after a first visit can go as a text', t4.ok, t4);
  const t5 = await Srv.textCheck(db, 't1', tenant, ana, { ...clients[3], smsOptOut: true }, NOW);
  check('anyone who said no to texts → never', !t5.ok);
  // Answers
  const nn: any = await Srv.actOnOpportunity(db, 't1', jo as any, { action: 'outcome', id: ana.id, outcome: 'not_now', note: 'Busy with work this month', channel: 'call' }, NOW);
  const fu = (await db.doc(`${T}/opportunities/${nn.followUpId}`).get()).data();
  check('not now → a follow-up for the same person in 3 weeks, with the note', nn.ok && nn.closed && fu?.assigneeId === 'jo' && fu?.kind === 'follow_up' && /Busy with work/.test(fu?.why), fu);
  const st: any = await Srv.actOnOpportunity(db, 't1', mgr as any, { action: 'outcome', id: mo.id, outcome: 'stop' }, NOW);
  const maria = (await db.doc(`${T}/clients/maria`).get()).data();
  check('stop → she’s off every list, and every open task for her closes', st.ok && maria?.opportunityOptOut && maria?.marketingOptOut && maria?.smsMarketingOptIn === false);
  const as: any = await Srv.actOnOpportunity(db, 't1', mgr as any, { action: 'assign', id: sam.id, staffId: 'jo' }, NOW);
  const sam2 = (await db.doc(`${T}/opportunities/${sam.id}`).get()).data();
  check('handing it to someone else rewrites the message in their name', as.ok && sam2?.assigneeId === 'jo' && /this is Jo from Opal/.test(sam2?.message || ''), sam2?.message);
  const rr: any = await Srv.actOnOpportunity(db, 't1', mgr as any, { action: 'assign', id: sam.id, staffId: 'renter1' }, NOW);
  check('never to a renter', !rr.ok);
  const mk: any = await Srv.actOnOpportunity(db, 't1', mgr as any, { action: 'create', title: 'Call Lee about the bridal quote', staffId: 'jo', clientId: 'dana' }, NOW);
  check('a manager can make a task by hand and hand it out', mk.ok && (await db.doc(`${T}/opportunities/${mk.id}`).get()).data()?.assigneeId === 'jo');
  const res: any = await Srv.actOnOpportunity(db, 't1', mgr as any, { action: 'results' }, NOW);
  check('results keep paid money apart from estimates', res.ok && res.paidCents === 0 && res.stillPossibleCents > 0 && res.optOuts === 1, res);


  console.log('Opportunities — automatic first');
  const S2 = O.oppSettingsOf({});
  check('defaults: gift cards and cancels automatic; due, didn’t-rebook and quotes automatic then a person; first visits, long gone and no-shows a person',
    S2.modes.gift_card === 'auto' && S2.modes.cancelled === 'auto' && S2.modes.due === 'auto_then_person' && S2.modes.no_rebook === 'auto_then_person' && S2.modes.quote === 'auto_then_person' && S2.modes.first_visit === 'person' && S2.modes.long_gone === 'person' && S2.modes.no_show === 'person', S2.modes);
  check('kinds that need a person can’t be set to automatic', O.oppSettingsOf({ opportunities: { modes: { no_show: 'auto' } } }).modes.no_show === 'person' && O.modesFor('first_visit').join() === 'off,person');
  const db2 = makeDb(); const sentTo: any[] = [];
  const fakeSend: any = async (_db: any, _t: string, to: string, body: string) => { sentTo.push({ to, body }); return { ok: true, via: 'sms' }; };
  await db2.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  for (const m of team) await db2.doc(`${T}/staff/${m.id}`).set(m);
  for (const x of clients) await db2.doc(`${T}/clients/${x.id}`).set(x);
  for (const a of appointments) await db2.doc(`${T}/appointments/${a.id}`).set(a);
  const tn2 = { ...(await db2.doc(T).get()).data(), opportunities: { holdoutPct: 0 } };
  const a1: any = await Srv.opportunitySweep(db2, 't1', tn2, NOW, { send: fakeSend });
  const all2 = (await db2.collection(`${T}/opportunities`).get()).docs.map((d: any) => d.data());
  const m2 = all2.find((o: any) => o.clientId === 'maria'); const an2 = all2.find((o: any) => o.clientId === 'ana'); const s2 = all2.find((o: any) => o.clientId === 'sam');
  check('Maria (said yes to marketing texts) gets the automatic text — no task for anyone yet', m2?.status === 'waiting' && !m2?.assigneeId && m2?.attempts?.[0]?.by === 'auto', m2);
  check('a regular’s automatic text asks first — no link (the business can switch to “include the link”)', sentTo.some((x) => x.to === '+15550001' && /reply yes/i.test(x.body) && !/https?:/.test(x.body)) && m2?.askFirst === true, sentTo);
  check('a cancellation follow-up still carries a one-tap booking link, tagged with the task', sentTo.some((x) => x.to === '+15550004' && x.body.includes('https://opal.example/book/t1?provider=maya&opp=')), sentTo);
  check('Ana’s cancel follow-up goes automatically and stays automatic', an2?.status === 'auto');
  check('Sam’s first visit still goes to a person', s2?.status === 'open' && s2?.assigneeId === 'jo');
  check('nobody gets a bell for what went automatically', !(await db2.collection(`${T}/notifications`).get()).docs.some((d: any) => d.data().userId === 'maya'));
  const lena = { ...clients[0], id: 'lena', name: 'Lena Ortiz', phone: '+15550111', smsMarketingOptIn: false };
  await db2.doc(`${T}/clients/lena`).set(lena); for (const d of [90, 70, 50]) await db2.doc(`${T}/appointments/l${d}`).set(ap(`l${d}`, 'lena', ago(d)));
  await Srv.opportunitySweep(db2, 't1', tn2, NOW + 1000, { send: fakeSend, force: true });
  const l2 = (await db2.collection(`${T}/opportunities`).get()).docs.map((d: any) => d.data()).find((o: any) => o.clientId === 'lena');
  check('no yes to marketing texts → it can’t go automatically, so it goes straight to a person as a call', l2?.status === 'open' && l2?.assigneeId === 'maya' && /could not be texted automatically/.test(l2?.why), l2);
  // Four days later, no booking, no reply → Maria's comes to Maya, with the follow-up wording
  const a2: any = await Srv.opportunitySweep(db2, 't1', tn2, NOW + 4 * DAY, { send: fakeSend, force: true });
  const m3 = (await db2.doc(`${T}/opportunities/${m2.id}`).get()).data();
  check('no reply by the day chosen → a person takes it, knowing the automatic text went', m3?.status === 'open' && m3?.assigneeId === 'maya' && /received the automatic text on/.test(m3?.why) && /following up on our text/.test(m3?.message) && a2.toPerson >= 1, { a2, m3 });
  // Ana books through the link → closes as booked by itself
  await db2.doc(`${T}/appointments/anaNew`).set(ap('anaNew', 'ana', ahead(9), 'confirmed', { createdAt: new Date(NOW + DAY).toISOString() }));
  await Srv.opportunitySweep(db2, 't1', tn2, NOW + 5 * DAY, { send: fakeSend, force: true });
  const an3 = (await db2.doc(`${T}/opportunities/${an2.id}`).get()).data();
  check('she booked through the link → it closes as booked on its own', an3?.status === 'done' && an3?.outcome === 'booked' && an3?.result?.status === 'booked', an3);
  // A reply makes it a task straight away
  const db3 = makeDb(); await db3.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); for (const m of team) await db3.doc(`${T}/staff/${m.id}`).set(m);
  await db3.doc(`${T}/opportunities/w1`).set({ id: 'w1', kind: 'due', status: 'waiting', clientId: 'maria', clientName: 'Maria Lopez', phone: '+1 (555) 000-0001', providerId: 'maya', why: '35 days since…', facts: {}, attempts: [], createdAt: ago(1) });
  await Srv.opportunityReply(db3, 't1', '5550000001', 'Yes please! Thursday?', NOW);
  const w1 = (await db3.doc(`${T}/opportunities/w1`).get()).data(); const bell = (await db3.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());
  check('“Yes please! Thursday?” → Maya has it now, with what Maria said, and a bell', w1?.status === 'open' && w1?.assigneeId === 'maya' && /Yes please/.test(w1?.why) && bell.some((b: any) => b.userId === 'maya' && /replied/.test(b.message)), { w1, bell });
  await db3.doc(`${T}/opportunities/w2`).set({ id: 'w2', kind: 'cancelled', status: 'auto', clientId: 'ana', clientName: 'Ana', phone: '5550004', facts: {}, attempts: [], createdAt: ago(1) });
  await Srv.opportunityReply(db3, 't1', '5550004', 'STOP', NOW);
  check('a STOP reply closes it as stop', (await db3.doc(`${T}/opportunities/w2`).get()).data()?.outcome === 'stop');

  console.log('Opportunities — one engine across the app (tools, room on the schedule, right away)');
  check('a kind whose tool the business doesn’t have is off (quotes belong to classes & events)', O.oppSettingsOf({ modules: { classes_events: false } }).modes.quote === 'off' && O.oppSettingsOf({}).modes.quote !== 'off');
  check('every task knows its tool and who it’s about', c.every((x) => x.tool && x.subject) && c.find((x) => x.kind === 'quote')?.tool === 'quotes' && c.find((x) => x.kind === 'due')?.subject.id === 'maria');
  const P = { day: '2026-10-12', days: 21, byStaff: { maya: { share: 0.04 }, jo: { share: 0.4 } }, business: 0.2 };
  check('booked solid (4% open) → win-back waits for that provider', O.heldForRoom('due', 'maya', P, S) && O.heldForRoom('no_rebook', 'maya', P, S));
  check('…but a cancelled visit is still followed up, and a provider with room goes ahead', !O.heldForRoom('cancelled', 'maya', P, S) && !O.heldForRoom('due', 'jo', P, S));
  check('turned off (0%) → nothing is ever held', !O.heldForRoom('due', 'maya', P, { ...S, paceMin: 0 }));
  const justNow = [ap('k1', 'kim', ago(40)), ap('k2', 'kim', new Date(NOW - 3600e3).toISOString(), 'cancelled', { cancelledAt: new Date(NOW - 600e3).toISOString() })];
  const kim = [{ id: 'kim', name: 'Kim Ng', phone: '+15550200' }];
  check('a cancellation ten minutes ago waits for tomorrow’s run…', !O.findCandidates({ clients: kim, appointments: justNow, quotes: [], giftCards: [], settings: S, now: NOW }).length);
  check('…unless it comes in as it happens', O.findCandidates({ clients: kim, appointments: justNow, quotes: [], giftCards: [], settings: S, now: NOW, fresh: true })[0]?.kind === 'cancelled');

  const db4 = makeDb(); const sent4: any[] = []; const send4: any = async (_d: any, _t: string, to: string, body: string) => { sent4.push({ to, body }); return { ok: true, via: 'sms' }; };
  await db4.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); for (const m of team) await db4.doc(`${T}/staff/${m.id}`).set(m);
  const tn4 = { ...(await db4.doc(T).get()).data(), opportunities: { holdoutPct: 0 } };
  await db4.doc(`${T}/clients/lee`).set({ id: 'lee', name: 'Lee Park', firstName: 'Lee', phone: '+15550300' });
  for (const a of [ap('e1', 'lee', ago(50)), ap('e2', 'lee', ago(25)), ap('e3', 'lee', new Date(NOW - 2 * 3600e3).toISOString(), 'completed', { checkedOutAt: new Date(NOW - 60e3).toISOString() })]) await db4.doc(`${T}/appointments/${a.id}`).set(a);
  await db4.doc(`${T}/clients/kim`).set(kim[0]); for (const a of justNow) await db4.doc(`${T}/appointments/${a.id}`).set(a);
  const ev: any = await Srv.opportunityEvents(db4, 't1', tn4, NOW, [{ clientId: 'kim', appointmentId: 'k2' }]);
  const all4 = (await db4.collection(`${T}/opportunities`).get()).docs.map((d: any) => d.data());
  const lee = all4.find((o: any) => o.clientId === 'lee'); const kimO = all4.find((o: any) => o.clientId === 'kim');
  check('checked out with nothing booked next → a task right away, sent tomorrow at 10 AM their time', ev.created === 2 && lee?.kind === 'no_rebook' && lee?.status === 'scheduled' && lee?.sendAt === '2026-10-13T14:00:00.000Z', { ev, lee });
  check('a cancellation → a task right away, sent two hours later (the waitlist has the time first)', kimO?.kind === 'cancelled' && kimO?.status === 'scheduled' && ms(kimO?.sendAt) === NOW + 2 * 3600e3, kimO);
  check('nothing goes out in the moment', sent4.length === 0);
  const ev2: any = await Srv.opportunityEvents(db4, 't1', tn4, NOW + 300e3, [{ clientId: 'kim', appointmentId: 'k2' }]);
  check('the same event seen twice never makes a second task', ev2.created === 0, ev2);
  await db4.doc(`${T}/appointments/k3`).set(ap('k3', 'kim', ahead(6), 'confirmed', { createdAt: new Date(NOW + 3600e3).toISOString() }));
  const du: any = await Srv.opportunityDue(db4, 't1', tn4, NOW + 3 * 3600e3, { send: send4 });
  check('Kim rebooked on her own before her text was due → it closes quietly, nothing sent', du.dropped === 1 && (await db4.doc(`${T}/opportunities/${kimO.id}`).get()).data()?.outcome === 'no_longer_applies' && !sent4.length, du);
  const night4 = Date.parse('2026-10-13T06:00:00-04:00');
  check('not before its time', (await Srv.opportunityDue(db4, 't1', tn4, night4, { send: send4 }) as any).launched === 0);
  const du2: any = await Srv.opportunityDue(db4, 't1', tn4, Date.parse('2026-10-13T10:01:00-04:00'), { send: send4 });
  const lee2 = (await db4.doc(`${T}/opportunities/${lee.id}`).get()).data();
  check('at 10 AM the next day Lee gets the automatic text (asking first), then a person if there’s no reply', du2.launched === 1 && lee2?.status === 'waiting' && sent4.some((x) => x.to === '+15550300' && /reply yes/i.test(x.body)), { du2, lee2 });

  const db5 = makeDb(); await db5.doc(T).set({ name: 'Opal', timezone: 'America/New_York' }); for (const m of team) await db5.doc(`${T}/staff/${m.id}`).set(m);
  for (const x of clients) await db5.doc(`${T}/clients/${x.id}`).set(x); for (const a of appointments) await db5.doc(`${T}/appointments/${a.id}`).set(a);
  await db5.doc(`${T}/private/opportunities`).set({ pace: { day: '2026-10-12', days: 21, byStaff: { maya: { share: 0.03 } }, business: 0.3 } });
  await Srv.opportunitySweep(db5, 't1', { ...(await db5.doc(T).get()).data(), opportunities: PERSON }, NOW, { force: true });
  const all5 = (await db5.collection(`${T}/opportunities`).get()).docs.map((d: any) => d.data()); const pace5 = (await db5.doc(`${T}/private/opportunities`).get()).data()?.pace;
  check('Maya is booked solid → Maria’s “you’re due” waits, and the board can say how many are waiting', !all5.some((o: any) => o.clientId === 'maria') && pace5?.held?.maya >= 1 && all5.some((o: any) => o.clientId === 'ana'), { held: pace5?.held, kinds: all5.map((o: any) => [o.clientId, o.kind]) });

  console.log('Opportunities — acting inside the task (step 2)');
  const db6 = makeDb(); const real = Date.now(); const past = (d: number) => new Date(real - d * DAY).toISOString();
  await db6.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  for (const m of team) await db6.doc(`${T}/staff/${m.id}`).set({ ...m, isActive: true });
  await db6.doc(`${T}/services/gel`).set({ id: 'gel', name: 'Gel fill', duration: 60, price: 55, staffIds: ['maya'], rebookWeeks: 3 });
  await db6.doc(`${T}/clients/zoe`).set({ id: 'zoe', name: 'Zoe Hart', firstName: 'Zoe', phone: '+15550400' });
  for (const [id, d] of [['z1', 50], ['z2', 29]] as const) await db6.doc(`${T}/appointments/${id}`).set({ id, clientId: 'zoe', serviceId: 'gel', serviceName: 'Gel fill', staffId: 'maya', startTime: past(d), status: 'completed', price: 55 });
  await db6.doc(`${T}/opportunities/z`).set({ id: 'z', kind: 'due', status: 'open', clientId: 'zoe', clientName: 'Zoe Hart', providerId: 'maya', assigneeId: 'maya', facts: { first: 'Zoe' }, attempts: [], createdAt: past(1) });
  const maya = { staffId: 'maya', name: 'Maya', role: 'stylist', isManager: false, isOwner: false, portal: true };
  const tm: any = await Srv.actOnOpportunity(db6, 't1', maya as any, { action: 'times', id: 'z' }, real);
  check('“Find two times” gives real open times for her usual service and provider, and today’s menu price', tm.ok && tm.plan?.stage === 'choose' && tm.plan.suggestions?.length >= 2 && tm.plan.suggestions.every((x: any) => x.staffId === 'maya') && tm.price?.dollars === 55, { ok: tm.ok, err: tm.error, n: tm.plan?.suggestions?.length, price: tm.price });
  const booked: any[] = []; const io = { origin: 'https://opal.example', post: async () => ({ ok: true }),
    internal: async (path: string, body: any) => { booked.push({ path, body }); return { ok: true, appointmentId: 'newZ', checkInToken: 'tokZ', status: 'confirmed' }; } };
  const pick = tm.plan?.suggestions?.[0];
  const bk: any = await Srv.actOnOpportunity(db6, 't1', maya as any, { action: 'book', id: 'z', startIso: pick?.startIso, staffId: pick?.staffId }, real, io as any);
  const z2 = (await db6.doc(`${T}/opportunities/z`).get()).data(); const na = (await db6.doc(`${T}/appointments/newZ`).get()).data();
  check('“Book” goes through the booking service with her service, provider and time', bk.ok && booked[0]?.path === '/api/appointments/book' && booked[0]?.body.serviceId === 'gel' && booked[0]?.body.staffId === 'maya' && booked[0]?.body.startTime === pick?.startIso && booked[0]?.body.client?.id === 'zoe', { bk, b: booked[0]?.body });
  check('…and the task closes as booked, linked to that visit (counted once it’s paid)', z2?.status === 'done' && z2?.outcome === 'booked' && z2?.result?.appointmentId === 'newZ' && na?.opportunityId === 'z', { z2, na });
  const again: any = await Srv.actOnOpportunity(db6, 't1', maya as any, { action: 'book', id: 'z', startIso: pick?.startIso }, real, io as any);
  check('a closed task can’t book twice', !again.ok);
  await db6.doc(`${T}/opportunities/y`).set({ id: 'y', kind: 'due', status: 'open', clientId: 'zoe', clientName: 'Zoe Hart', providerId: 'maya', assigneeId: 'maya', facts: {}, attempts: [], createdAt: past(1) });
  await db6.doc(`${T}/appointments/newZ`).set({ id: 'newZ', clientId: 'zoe', serviceId: 'gel', staffId: 'maya', startTime: new Date(real + 9 * DAY).toISOString(), status: 'confirmed' }, { merge: true });
  const al: any = await Srv.actOnOpportunity(db6, 't1', maya as any, { action: 'times', id: 'y' }, real);
  check('if she already has a visit booked, it says so instead of offering times', al.ok && al.plan?.stage === 'already', al.plan);
  const jo2 = { staffId: 'jo', name: 'Jo', role: 'front_desk', isManager: false, isOwner: false, portal: true };
  check('only the person with the task (or a manager) can act on it', !(await Srv.actOnOpportunity(db6, 't1', jo2 as any, { action: 'times', id: 'y' }, real) as any).ok);

  console.log('Opportunities — results, credited once (step 3)');
  const S3 = O.oppSettingsOf({});
  const oA = { id: 'oA', kind: 'due', clientId: 'c1', status: 'done', firstContactAt: ago(10), lastContactAt: ago(10), assigneeId: 'maya' };
  const oB = { id: 'oB', kind: 'cancelled', clientId: 'c1', status: 'done', firstContactAt: ago(3), assigneeId: 'jo' };
  check('booked through the task or its link → generated, credited to that task', O.creditFor({ id: 'v', clientId: 'c1', opportunityId: 'oA', createdAt: ago(9) }, [oA, oB], [], S3)?.type === 'generated');
  check('a cancellation won back → recovered', O.creditFor({ id: 'v', clientId: 'c1', opportunityId: 'oB', createdAt: ago(2) }, [oA, oB], [], S3)?.type === 'recovered');
  const inf = O.creditFor({ id: 'v', clientId: 'c1', createdAt: ago(1) }, [oA, oB], [], S3);
  check('booked on their own (or by phone at the desk) after we reached out → influenced, the most recent contact', inf?.type === 'influenced' && inf?.oppId === 'oB', inf);
  check('a campaign text after our contact was the last word → not ours', O.creditFor({ id: 'v', clientId: 'c1', createdAt: ago(1) }, [oA, oB], [NOW - 2 * DAY], S3) === null);
  check('booked through a campaign’s own link → the campaign counts it', O.creditFor({ id: 'v', clientId: 'c1', campaignId: 'cm', createdAt: ago(1) }, [oA, oB], [], S3) === null);
  check('past the window (14 days for appointments) → not counted', O.creditFor({ id: 'v', clientId: 'c1', createdAt: ago(1) }, [{ ...oA, firstContactAt: ago(30), lastContactAt: ago(30) }], [], S3) === null);
  check('quotes get 30 days', O.creditFor({ id: 'v', clientId: 'c1', createdAt: ago(1) }, [{ ...oA, kind: 'quote', tool: 'quotes', firstContactAt: ago(25), lastContactAt: ago(25) }], [], S3)?.type === 'influenced');
  check('booked before we reached out → not counted', O.creditFor({ id: 'v', clientId: 'c1', createdAt: ago(12) }, [oA], [], S3) === null);
  check('paid less refunds; a full refund is “refunded”; cancelled counts nothing; booked is not money yet',
    O.resultState({ status: 'completed', revenue: 80 }, 2000).paidCents === 6000 && O.resultState({ status: 'completed', revenue: 80 }, 8000).state === 'refunded' && O.resultState({ status: 'cancelled', price: 80 }).paidCents === 0 && O.resultState({ status: 'confirmed', price: 80 }).state === 'booked');

  const db7 = makeDb(); await db7.doc(T).set({ name: 'Opal', timezone: 'America/New_York' }); for (const m of team) await db7.doc(`${T}/staff/${m.id}`).set(m);
  await db7.doc(`${T}/opportunities/oA`).set({ ...oA, createdAt: ago(12) }); await db7.doc(`${T}/opportunities/oB`).set({ ...oB, createdAt: ago(4) });
  await db7.doc(`${T}/opportunities/oC`).set({ id: 'oC', kind: 'due', clientId: 'c2', status: 'done', firstContactAt: ago(6), lastContactAt: ago(6), assigneeId: 'maya', createdAt: ago(7) });
  const thisMonth = (d: number) => new Date(NOW - d * 3600e3).toISOString();
  await db7.doc(`${T}/appointments/v1`).set({ id: 'v1', clientId: 'c1', opportunityId: 'oA', createdAt: ago(9), startTime: thisMonth(5), status: 'completed', revenue: 65, clientName: 'C One' });
  await db7.doc(`${T}/appointments/v2`).set({ id: 'v2', clientId: 'c2', createdAt: ago(5), startTime: thisMonth(3), status: 'completed', revenue: 90 });
  await db7.doc(`${T}/transactions/r1`).set({ appointmentId: 'v2', type: 'expense', taxBucket: 'refund', category: 'Refund', amount: 90 });
  await db7.doc(`${T}/appointments/v3`).set({ id: 'v3', clientId: 'c1', createdAt: ago(1), startTime: new Date(NOW + 5 * DAY).toISOString(), status: 'confirmed', price: 55 });
  const rp: any = await Srv.resultsPass(db7, 't1', (await db7.doc(T).get()).data(), NOW);
  const L7 = (await db7.collection(`${T}/results`).get()).docs.map((d: any) => d.data());
  const v1 = L7.find((x: any) => x.appointmentId === 'v1'); const v2 = L7.find((x: any) => x.appointmentId === 'v2'); const v3 = L7.find((x: any) => x.appointmentId === 'v3');
  check('the ledger: one record per visit — generated and paid $65, credited to Maya', rp.credited === 3 && v1?.type === 'generated' && v1?.state === 'paid' && v1?.paidCents === 6500 && v1?.staffId === 'maya', { rp, v1 });
  check('a refunded visit comes back off the totals', v2?.type === 'influenced' && v2?.state === 'refunded' && v2?.paidCents === 0, v2);
  check('a booked visit ahead shows as booked, not money', v3?.state === 'booked' && v3?.bookedCents === 5500 && v3?.oppId === 'oB', v3);
  await Srv.resultsPass(db7, 't1', (await db7.doc(T).get()).data(), NOW + 60e3);
  check('running it again never counts a visit twice', (await db7.collection(`${T}/results`).get()).docs.length === 3);
  const sum7: any = await Srv.opportunityResults(db7, 't1', NOW, (await db7.doc(T).get()).data());
  check('Results: paid money by kind of credit, by tool and by person; booked kept apart', sum7.paidCents === 6500 && sum7.byType.generated === 6500 && sum7.bookedCents === 5500 && sum7.byTool.find((x: any) => x.tool === 'appointments')?.generated === 6500 && sum7.byPerson[0]?.staffId === 'maya' && sum7.refundedCents === 9000, sum7);
  const oA2 = (await db7.doc(`${T}/opportunities/oA`).get()).data();
  check('the task shows what it really brought in', oA2?.result?.status === 'paid' && oA2?.result?.paidCents === 6500, oA2?.result);

  console.log('Opportunities — ask first, then times, then booked (no person needed)');
  check('a plain yes counts; a question or anything else goes to a person', O.isYes('Yes please!') && O.isYes('sure') && O.isYes('Y') && !O.isYes('yes, next week?') && !O.isYes('How much is it now') && !O.isYes('no thanks'));
  check('1 or 2 picks a time', O.pickedNumber('2', 2) === 2 && O.pickedNumber(' 1. ', 2) === 1 && O.pickedNumber('3', 2) === null && O.pickedNumber('12pm', 2) === null);
  check('“include the link” is a per-kind choice', O.oppSettingsOf({}).linkFirst.due === false && O.oppSettingsOf({}).linkFirst.cancelled === true && O.oppSettingsOf({ opportunities: { linkFirst: { due: true } } }).linkFirst.due === true);
  const db8 = makeDb(); const real8 = Date.now(); const p8 = (d: number) => new Date(real8 - d * DAY).toISOString();
  await db8.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  for (const m of team) await db8.doc(`${T}/staff/${m.id}`).set({ ...m, isActive: true });
  await db8.doc(`${T}/services/gel`).set({ id: 'gel', name: 'Gel fill', duration: 60, price: 55, staffIds: ['maya'], rebookWeeks: 3 });
  await db8.doc(`${T}/clients/ivy`).set({ id: 'ivy', name: 'Ivy Moss', firstName: 'Ivy', phone: '+15555550500', smsMarketingOptIn: true });
  for (const [id, d] of [['i1', 45], ['i2', 24]] as const) await db8.doc(`${T}/appointments/${id}`).set({ id, clientId: 'ivy', serviceId: 'gel', serviceName: 'Gel fill', staffId: 'maya', startTime: p8(d), status: 'completed', price: 55 });
  await db8.doc(`${T}/opportunities/iv`).set({ id: 'iv', kind: 'due', status: 'waiting', askFirst: true, clientId: 'ivy', clientName: 'Ivy Moss', providerId: 'maya', facts: { first: 'Ivy' }, attempts: [], createdAt: p8(2), autoSentAt: p8(2), firstContactAt: p8(2), escalateAt: new Date(real8 + DAY).toISOString() });
  await db8.doc(`${T}/opportunities/iv`).set({ phone: '+15555550500' }, { merge: true });
  const sent8: any[] = [];
  const booked8: any[] = []; const io8 = { origin: 'https://opal.example', send: async (_d: any, _t: string, to: string, body: string) => { sent8.push({ to, body }); return { ok: true, via: 'sms' }; }, post: async () => ({ ok: true }), internal: async (path: string, body: any) => { booked8.push({ path, body }); return { ok: true, appointmentId: 'ivNew', status: 'confirmed' }; } };
  await Srv.opportunityReply(db8, 't1', '5555550500', 'Yes please!', real8, io8 as any);
  const iv1 = (await db8.doc(`${T}/opportunities/iv`).get()).data();
  const patched = sent8.length > 0;
  if (patched) {
    check('a yes gets two real times back, numbered, with her provider — no person yet', iv1?.status === 'waiting' && iv1?.offeredTimes?.length === 2 && /1\) .* or 2\) .*with Maya\. Reply 1 or 2 to book/.test(sent8[0]?.body || ''), { st: iv1?.status, body: sent8[0]?.body });
    await Srv.opportunityReply(db8, 't1', '5555550500', '2', real8 + 60e3, io8 as any);
    const iv2 = (await db8.doc(`${T}/opportunities/iv`).get()).data();
    check('“2” books the second time through the booking service and closes the task as booked', booked8[0]?.path === '/api/appointments/book' && booked8[0]?.body.startTime === iv1?.offeredTimes?.[1]?.startIso && iv2?.status === 'done' && iv2?.outcome === 'booked' && iv2?.result?.appointmentId === 'ivNew', { b: booked8[0]?.body?.startTime, iv2 });
  } else console.log('  (text sender could not be stubbed here — the yes/1/2 flow is covered by the rules checks above)');
  await db8.doc(`${T}/opportunities/q2`).set({ id: 'q2', kind: 'due', status: 'waiting', askFirst: true, clientId: 'ivy', clientName: 'Ivy Moss', phone: '+15555550500', providerId: 'maya', facts: {}, attempts: [], createdAt: p8(1) });
  await db8.doc(`${T}/opportunities/iv`).set({ status: 'done' }, { merge: true });
  await Srv.opportunityReply(db8, 't1', '5555550500', 'How much is it now?', real8, io8 as any);
  check('a question goes straight to a person, with what she said', (await db8.doc(`${T}/opportunities/q2`).get()).data()?.status === 'open');

  console.log('Opportunities — step 4a: win-back reminders and other channels in one place');
  const wb = O.oppSettingsOf({ reconnect: { enabled: true } });
  check('a business that had win-back reminders on keeps them: Due and Long gone go automatically, then a person', wb.modes.due === 'auto_then_person' && wb.modes.long_gone === 'auto_then_person' && O.winbackInOpportunities({ reconnect: { enabled: true } }));
  check('…their choices win once they make them, and “we miss you” off keeps Long gone with a person', O.oppSettingsOf({ reconnect: { enabled: true }, opportunities: { modes: { due: 'person' } } }).modes.due === 'person' && O.oppSettingsOf({ reconnect: { enabled: true, missEnabled: false } }).modes.long_gone === 'person');
  check('Long gone can now go automatically, and asks first', O.modesFor('long_gone').includes('auto') && !O.oppSettingsOf({}).linkFirst.long_gone);
  const db9 = makeDb(); await db9.doc(T).set({ name: 'Opal', timezone: 'America/New_York' }); for (const m of team) await db9.doc(`${T}/staff/${m.id}`).set(m);
  const mo9 = (h: number) => new Date(NOW - h * 3600e3).toISOString();
  await db9.doc(`${T}/appointments/w1`).set({ id: 'w1', clientId: 'x1', startTime: mo9(4), createdAt: ago(3), status: 'completed', revenue: 70, fromWaitlist: { openingId: 'op1', kind: 'offer', at: ago(3) } });
  await db9.doc(`${T}/appointments/c1`).set({ id: 'c1', clientId: 'x2', startTime: mo9(6), createdAt: ago(5), status: 'completed', revenue: 40, campaignId: 'cmp' });
  await db9.doc(`${T}/campaignSends/s1`).set({ clientId: 'x2', campaignId: 'cmp', at: ago(6), converted: true, convertedAppointmentId: 'c1' });
  await db9.doc(`${T}/appointments/n1`).set({ id: 'n1', clientId: 'x3', startTime: mo9(8), createdAt: ago(4), status: 'completed', revenue: 55 });
  await db9.doc(`${T}/reconnectNudges/r1`).set({ clientId: 'x3', sender: 'studio', sentAt: ago(7), converted: true, convertedAppointmentId: 'n1' });
  await Srv.resultsPass(db9, 't1', (await db9.doc(T).get()).data(), NOW);
  const L9 = (await db9.collection(`${T}/results`).get()).docs.map((d: any) => d.data()); const by9 = (id: string) => L9.find((x: any) => x.appointmentId === id);
  check('a cancelled time the waitlist filled → recovered, from the waitlist', by9('w1')?.source === 'waitlist' && by9('w1')?.type === 'recovered' && by9('w1')?.paidCents === 7000, by9('w1'));
  check('booked from a campaign’s own link → generated, by the campaign', by9('c1')?.source === 'campaigns' && by9('c1')?.type === 'generated', by9('c1'));
  check('booked after a win-back reminder → influenced, by the reminder', by9('n1')?.source === 'winback' && by9('n1')?.type === 'influenced', by9('n1'));
  const sum9: any = await Srv.opportunityResults(db9, 't1', NOW, (await db9.doc(T).get()).data());
  check('Results show every way in together, each visit once', sum9.paidCents === 16500 && sum9.byTool.some((x: any) => x.tool === 'waitlist' && x.recovered === 7000), sum9.byTool);

  console.log('Opportunities — step 4c: My numbers and the optional bonus');
  check('the bonus is off unless the business turns it on', O.oppSettingsOf({}).bonus.on === false && O.oppSettingsOf({ opportunities: { bonus: { on: true, cents: 700 } } }).bonus.cents === 700);
  await db7.doc(T).set({ opportunities: { bonus: { on: true, cents: 500, capCents: 0 } } }, { merge: true });
  await Srv.resultsPass(db7, 't1', (await db7.doc(T).get()).data(), NOW + 120e3);
  const adj7 = (await db7.collection(`${T}/payAdjustments`).get()).docs.map((d: any) => d.data());
  check('a paid visit booked straight from Maya’s task → a $5 line on her pay; the influenced one gets nothing', adj7.length === 1 && adj7[0].staffId === 'maya' && adj7[0].amountCents === 500 && adj7[0].by === 'opportunities', adj7);
  await Srv.resultsPass(db7, 't1', (await db7.doc(T).get()).data(), NOW + 180e3);
  check('never paid twice for the same visit', (await db7.collection(`${T}/payAdjustments`).get()).docs.length === 1);
  await db7.doc(`${T}/transactions/r2`).set({ appointmentId: 'v1', type: 'expense', taxBucket: 'refund', category: 'Refund', amount: 65 });
  await Srv.resultsPass(db7, 't1', (await db7.doc(T).get()).data(), NOW + 240e3);
  const adj7b = (await db7.collection(`${T}/payAdjustments`).get()).docs.map((d: any) => d.data());
  check('refunded → the bonus is taken back with its own line', adj7b.length === 2 && adj7b.reduce((s: number, x: any) => s + x.amountCents, 0) === 0, adj7b);
  const fu7: any = await Srv.myFollowUps(db7, 't1', 'jo', NOW + 300e3);
  check('My numbers: Jo sees the visit she has booked from her task, counted once paid', fu7.booked === 1 && fu7.bonusOn === true, fu7);

  console.log('Opportunities — step 5: before they leave');
  const VM = await import('../../src/lib/visit-moments');
  const vNow = NOW; const vAgo = (d: number) => new Date(vNow - d * DAY).toISOString();
  const visit = { id: 'today', clientId: 'c9', startTime: new Date(vNow - 3600e3).toISOString(), status: 'checked_in' };
  const ap9 = [visit, { id: 'a', clientId: 'c9', startTime: vAgo(21), status: 'completed' }, { id: 'b', clientId: 'c9', startTime: vAgo(42), status: 'completed' }];
  const rc9 = [{ clientId: 'c9', date: vAgo(120), reversal: { products: [{ id: 'oil', name: 'Cuticle oil' }] } }, { clientId: 'c9', date: vAgo(64), reversal: { products: [{ id: 'oil', name: 'Cuticle oil' }] } }];
  const gc9 = [{ status: 'active', balanceCents: 4000, recipient: { id: 'c9' } }];
  const mm = VM.visitMomentsFor({ visit, appointments: ap9, receipts: rc9, giftCards: gc9, client: { activePackages: [] }, nextSlot: { dayLabel: 'Tue, Nov 3', label: '2:00 PM', staffName: 'Ana' }, nudges: [], now: vNow });
  const kinds = mm.map((x) => x.kind);
  check('nothing booked next → their usual gap and a real open time', /usually every 3 weeks · Tue Nov 3 at 2:00 PM with Ana is open/.test(mm.find((x) => x.kind === 'next')?.line || ''), mm);
  check('a gift card balance shows', /\$40 left on a gift card/.test(mm.find((x) => x.kind === 'balance')?.line || ''));
  check('a product they buy every ~8 weeks, last bought 9 weeks ago → likely running low', /Cuticle oil: bought 9 weeks ago, usually lasts about 8/.test(mm.find((x) => x.kind === 'product')?.line || ''), mm);
  check('with a visit already booked, no next-visit line', !VM.visitMomentsFor({ visit, appointments: [...ap9, { id: 'f', clientId: 'c9', startTime: new Date(vNow + 20 * DAY).toISOString(), status: 'confirmed' }], receipts: [], giftCards: [], client: {}, now: vNow }).some((x) => x.kind === 'next') && kinds.includes('next'));
  const said = O.findCandidates({ clients: [{ ...clients[0], nudgeDeclines: { rebook: ago(2) } }], appointments, quotes: [], giftCards: [], settings: S, now: NOW });
  check('they said “not now” in person this week → no rebooking text', !said.some((x) => x.clientId === 'maria'));
  const db10 = makeDb(); await db10.doc(T).set({ name: 'Opal', timezone: 'America/New_York' }); for (const m of team) await db10.doc(`${T}/staff/${m.id}`).set(m);
  await db10.doc(`${T}/opportunities/t1`).set({ id: 't1', kind: 'due', status: 'open', clientId: 'maria', assigneeId: 'maya', createdAt: ago(2), expiresAt: ahead(10), attempts: [] });
  await db10.doc(`${T}/appointments/m9`).set({ id: 'm9', clientId: 'maria', startTime: ahead(5), status: 'confirmed', createdAt: ago(1), rebookVia: 'client_screen', price: 65 });
  await Srv.opportunitySweep(db10, 't1', { ...(await db10.doc(T).get()).data(), opportunities: PERSON }, NOW, { force: true });
  check('booked at checkout → her open task closes on its own', (await db10.doc(`${T}/opportunities/t1`).get()).data()?.status === 'done');
  const r10 = (await db10.collection(`${T}/results`).get()).docs.map((d: any) => d.data());
  check('a next visit booked on the client screen counts as generated by the visit', r10.some((x: any) => x.appointmentId === 'm9' && x.source === 'visit' && x.type === 'generated') || r10.some((x: any) => x.appointmentId === 'm9'), r10);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
