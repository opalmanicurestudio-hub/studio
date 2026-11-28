// scripts/verify/outreach-guard.verify.ts — optional outreach leaves out clients the business no longer books, and (unless
// the owner turns it off) anyone with a balance owed or more missed visits than the business allows: campaigns,
// opportunities, filling a gap, win-back reminders, loyalty texts, review asks, gift card notes and the waitlist.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/outreach-guard.verify.ts
import fs from 'fs';
import path from 'path';
import { makeDb, check, failures } from './fake-db';

const DAY = 864e5;
const NOW = Date.parse('2026-10-12T15:00:00-04:00');
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

(async () => {
  const G = await import('../../src/lib/outreach-guard');
  const O = await import('../../src/lib/opportunities');
  const C = await import('../../src/lib/campaigns');

  console.log('The rule itself');
  const fine = { id: 'ana', name: 'Ana Ruiz' };
  const banned = { id: 'bo', name: 'Bo Chen', status: 'banned' };
  const blocked = { id: 'bk', name: 'Bea Kerr', status: 'blocked' };
  const owes = { id: 'cy', name: 'Cy Moss', outstandingBalance: 40 };
  const misses = { id: 'di', name: 'Di Park', noShowCount: 2, cancellationCount: 1 };
  const atLimit = { id: 'ed', name: 'Ed Lane', noShowCount: 1, cancellationCount: 1 };
  check('not booked anymore (banned or blocked) holds everything optional, even about their own things', G.outreachHold(banned, {}) === 'not_booked' && G.outreachHold(blocked, {}, 'service') === 'not_booked');
  check('a balance owed holds invitations, not notes about what they already have', G.outreachHold(owes, {}) === 'owes' && G.outreachHold(owes, {}, 'service') === null);
  check('a cent or more counts as owing; nothing, or a credit, does not', G.owesBalance({ outstandingBalance: 0.01 }) && !G.owesBalance({ outstandingBalance: 0 }) && !G.owesBalance({ outstandingBalance: -5 }) && !G.owesBalance({}));
  check('more missed or canceled visits than allowed (2 by default) holds invitations; exactly the limit does not', G.outreachHold(misses, {}) === 'policy' && G.outreachHold(atLimit, {}) === null);
  check('the strikes the owner allows are the same ones the deposit rule uses', G.outreachHold(misses, { guardianPolicy: { riskThreshold: 5 } }) === null);
  check('the owner can turn off each of the two optional rules', G.outreachHold(owes, { outreachRules: { skipOwing: false } }) === null && G.outreachHold(misses, { outreachRules: { skipPoorHistory: false } }) === null
    && G.outreachHold(banned, { outreachRules: { skipOwing: false, skipPoorHistory: false } }) === 'not_booked');
  check('a client in good standing is never held', G.outreachHold(fine, {}) === null && G.outreachHold(null, {}) === null);

  console.log('Campaigns');
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York' });
  const people: any[] = [
    { ...fine, email: 'ana@example.com' }, { ...banned, email: 'bo@example.com' }, { ...owes, email: 'cy@example.com' }, { ...misses, email: 'di@example.com' },
    { id: 'eu', name: 'Eli Unsub', status: 'banned', marketingOptOut: true, email: 'eu@example.com' },
    { id: 'fo', name: 'Fay Owes', outstandingBalance: 12, marketingOptOut: true, email: 'fo@example.com' },
  ];
  for (const p of people) await db.doc(`${T}/clients/${p.id}`).set(p);
  const all = await C.resolveAudience(db, 't1', 'all', 'email', {}, NOW);
  const why = (r: any, id: string) => r.skipped.find((x: any) => x.id === id)?.reason;
  check('only the client in good standing gets it', all.members.map((m: any) => m.id).join() === 'ana', all.members);
  check('each one left out is named with the reason', why(all, 'bo') === 'not_booked' && why(all, 'cy') === 'owes' && why(all, 'di') === 'policy', all.skipped);
  check('not booked anymore is the reason shown even when they also unsubscribed; unsubscribed comes before a balance', why(all, 'eu') === 'not_booked' && why(all, 'fo') === 'unsubscribed');
  check('and counted, for the summary', all.skippedNotBooked === 2 && all.skippedOwes === 1 && all.skippedPolicy === 1 && all.skippedUnsubscribed === 1);
  const picked = await C.resolveAudience(db, 't1', 'specific', 'email', { specificIds: ['ana', 'bo', 'cy', 'di'] }, NOW);
  check('clients the owner picks by name: only "not booked anymore" holds them back', picked.members.map((m: any) => m.id).sort().join() === 'ana,cy,di' && why(picked, 'bo') === 'not_booked', picked);
  for (const p of [{ id: 'ra', name: 'Rae Owes', outstandingBalance: 20, noShowCount: 4 }, { id: 'rb', name: 'Rob Gone', status: 'banned' }]) await db.doc(`${T}/clients/${p.id}`).set({ ...p, ownerRenterId: 'r1', email: `${p.id}@example.com` });
  const renterAud = await C.resolveAudience(db, 't1', 'all', 'email', { owner: { renterId: 'r1', staffIds: ['s1'] } }, NOW);
  check('a renter’s own campaign: the business’s balance and missed-visit rules don’t apply; not booked anymore still does', renterAud.members.map((m: any) => m.id).join() === 'ra' && why(renterAud, 'rb') === 'not_booked', renterAud);
  const lenient = await C.resolveAudience(db, 't1', 'all', 'email', { tenant: { outreachRules: { skipOwing: false, skipPoorHistory: false } } }, NOW);
  check('with both rules off, those who owe or miss visits get it; the client let go still does not', lenient.members.map((m: any) => m.id).sort().join() === 'ana,cy,di', lenient.members);

  console.log('Opportunities');
  const S = O.oppSettingsOf({});
  const cands: any[] = [
    { kind: 'due', key: 'due:bo', clientId: 'bo' }, { kind: 'due', key: 'due:cy', clientId: 'cy' }, { kind: 'quote', key: 'quote:cy', clientId: 'cy2' },
    { kind: 'no_show', key: 'ns:di', clientId: 'di' }, { kind: 'gift_card', key: 'gc:bo', clientId: 'bo2' }, { kind: 'due', key: 'due:ana', clientId: 'ana' },
  ];
  const cmap = new Map<string, any>([['bo', banned], ['cy', owes], ['cy2', { ...owes, id: 'cy2' }], ['di', misses], ['bo2', { ...banned, id: 'bo2' }], ['ana', fine]]);
  const held: any = {};
  const kept = O.filterCandidates(cands, { existing: [], clients: cmap, openCaseClients: new Set(), recentAutoNudge: new Set(), now: NOW, tenant: {}, held });
  check('a win-back to someone let go, someone who owes, or a rebooking ask to a frequent no-show: none of them', kept.map((k: any) => k.key).sort().join() === 'due:ana,quote:cy', kept.map((k: any) => k.key));
  check('…a quote they asked for still goes to someone who owes; nothing goes to someone let go, not even about their gift card', kept.some((k: any) => k.kind === 'quote') && !kept.some((k: any) => k.kind === 'gift_card'));
  check('…and the run counts what it left out, by reason', held.not_booked === 2 && held.owes === 1 && held.policy === 1, held);
  check('which kinds invite a visit', ['due', 'first_visit', 'long_gone', 'fill_gap', 'no_rebook', 'cancelled', 'no_show', 'membership_fit', 'shop_reorder', 'share_ask'].every(O.invitesVisit) && !['quote', 'gift_card', 'renewal_failed', 'unused_visits'].some(O.invitesVisit));
  void S;

  console.log('Filling a gap');
  const appts: any[] = []; const gap = ['ana', 'bo', 'cy', 'di'];
  for (const id of gap) for (const [k, d] of [['a', 49], ['b', 28]] as const) appts.push({ id: `${id}${k}`, clientId: id, serviceId: 'gel', serviceName: 'Gel fill', staffId: 'maya', startTime: ago(d), status: 'completed', price: 55, duration: 60 });
  const H = O.historyOf(appts, NOW);
  const gmap = new Map<string, any>(gap.map((id) => [id, { ...(cmap.get(id) || fine), id, phone: `+1555000${gap.indexOf(id)}` }]));
  const opening = { id: 'op1', start: new Date(NOW + DAY).toISOString(), end: new Date(NOW + DAY + 3600e3).toISOString(), minutes: 60, staffId: 'maya' };
  const asked = O.gapAskList({ opening, H, clients: gmap, busy: new Set(), minsOf: () => 60, now: NOW, tenant: {} });
  check('a spare time is offered only to the client in good standing', asked.map((c: any) => c.clientId).join() === 'ana', asked.map((c: any) => c.clientId));

  console.log('Sending an opportunity text');
  const Srv = await import('../../src/lib/opportunities-server');
  const t1 = await Srv.textCheck(db, 't1', {}, { kind: 'quote', clientId: 'bo' }, { ...banned, phone: '+15550009' }, NOW);
  const t2 = await Srv.textCheck(db, 't1', {}, { kind: 'quote', clientId: 'bo' }, { ...banned, phone: '+15550009' }, NOW, { answering: true });
  check('nothing optional is texted to a client let go, even one already on the list', !t1.ok && /not booked anymore/.test((t1 as any).error), t1);
  check('…but the team can still answer when they write in', t2.ok, t2);

  console.log('Win-back reminders');
  const R = await import('../../src/lib/reconnect');
  const dbR = makeDb(); const TR = 'tenants/t2';
  for (const p of [{ ...fine, phone: '+15550101', smsMarketingOptIn: true }, { ...banned, phone: '+15550102', smsMarketingOptIn: true }, { ...owes, phone: '+15550103', smsMarketingOptIn: true }]) {
    await dbR.doc(`${TR}/clients/${p.id}`).set(p);
    await dbR.doc(`${TR}/appointments/${p.id}1`).set({ clientId: p.id, startTime: new Date(Date.now() - 120 * DAY).toISOString(), status: 'completed', serviceId: 'gel', staffId: 'maya' });
  }
  const toR: string[] = [];
  const rr = await R.runReconnect(dbR, { tenantId: 't2', renterId: null, staffIds: null, settings: { enabled: true, missEnabled: true, dueEnabled: true, missWeeks: 10 }, tenant: {}, bookingUrl: 'https://x.example/book', signer: 'Opal', stopUrl: () => 'https://x.example/stop',
    send: async (to) => { toR.push(to.clientId); return 'sms'; } });
  check('“we miss you” goes to the client in good standing only', toR.join() === 'ana' && rr.sent === 1, { toR, rr });

  console.log('Loyalty texts');
  const LS = await import('../../src/lib/loyalty-server');
  const T4: any = { timezone: 'America/New_York', name: 'Opal', loyalty: { on: true, auto: { tierUp: true, rewardReady: false, unused: false, comeBack: false, monthlyTexts: 50 }, tiers: [{ id: 'gold', name: 'Gold', points: 100, multiplier: 1, perks: ['priority booking'] }] } };
  const dbL = makeDb();
  for (const p of [fine, banned, misses]) await dbL.doc(`tenants/t/clients/${p.id}`).set({ ...p, phone: `+1555070${p.id.length}${p.id}`, smsMarketingOptIn: true, loyalty: { balance: 150, tier: { id: 'gold' } } });
  const lt: string[] = [];
  await LS.automationSweep(dbL, 't', T4, Date.parse('2026-10-14T15:00:00Z'), async (_to, text) => { lt.push(text); return true; });
  check('the tier-up text goes to the client in good standing, not to someone let go or a frequent no-show', lt.length === 1 && /^Hi Ana/.test(lt[0] || ''), lt);

  console.log('Every optional sender asks the same rule');
  const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src', p), 'utf8');
  const uses = [['lib/campaigns.ts', 'outreachHold'], ['lib/opportunities.ts', 'outreachHold'], ['lib/reconnect.ts', 'outreachHold'], ['lib/loyalty-server.ts', 'outreachHold'], ['lib/reviews-server.ts', 'outreachHold'],
    ['lib/gift-cards.ts', 'notBooked'], ['lib/waitlist-server.ts', 'notBooked'], ['app/api/import/tell/route.ts', 'notBooked']];
  const missing = uses.filter(([f, fn]) => !src(f).includes(`${fn}(`)).map(([f]) => f);
  check('campaigns, opportunities, win-backs, loyalty, review asks, gift card notes, the waitlist and the switch-over notice', !missing.length, missing);
  const cron = src('app/api/cron/reminders/route.ts');
  check('the nightly run hands the business to its win-back reminders, and a renter’s get only the not-booked rule', /settings: studioSettings, tenant: tdata/.test(cron) && /settings: rSettings, tenant: RENTER_RULES/.test(cron));
  check('the thank-you after a visit: nothing to a client let go but their aftercare; no booking link or review ask for anyone held', /if \(notBooked\(await clientRec\(a\.clientId\)\)\) continue;/.test(cron) && /if \(letGo && !careLink\) continue;/.test(cron)
    && /book_link: held \? '' : bookLink/.test(cron) && /cfg\.bookingUrl && !held \?/.test(cron) && /cfg\.reviewUrl && !held \?/.test(cron));
  check('a renter’s own opportunities follow only the not-booked rule', /tenant: RENTER_RULES, openCaseClients/.test(src('lib/opportunities-server.ts')));
  check('the owner’s two choices are on Booking policies', /outreachRules\.skipOwing/.test(src('app/(app)/settings/policies/page.tsx')) && /outreachRules\.skipPoorHistory/.test(src('app/(app)/settings/policies/page.tsx')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
