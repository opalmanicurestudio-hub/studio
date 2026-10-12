// scripts/verify/opportunities.verify.ts — checks the Opportunities rules (lib/opportunities) and the server half
// (lib/opportunities-server) against an in-memory database.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/opportunities.verify.ts
import { makeDb, check, failures } from './fake-db';

const DAY = 864e5;
const NOW = Date.parse('2026-10-12T15:00:00-04:00');
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const ahead = (d: number) => new Date(NOW + d * DAY).toISOString();

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
  check('kinds that need a person can’t be set to automatic', O.oppSettingsOf({ opportunities: { modes: { long_gone: 'auto' } } }).modes.long_gone === 'person' && O.modesFor('first_visit').join() === 'off,person');
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
  check('it carries a one-tap booking link with her provider', sentTo.some((x) => x.to === '+15550001' && x.body.includes('https://opal.example/book/t1?provider=maya')), sentTo);
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
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
