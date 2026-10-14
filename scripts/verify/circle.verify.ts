// scripts/verify/circle.verify.ts — the Circle (lib/circle, lib/circle-server): tiers, typed codes, boosts, creators,
// the public page and requests to join, against an in-memory database.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/circle.verify.ts
import { makeDb, check, failures } from './fake-db';

const DAY = 864e5; const NOW = Date.parse('2026-10-14T15:00:00-04:00'); const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
(async () => {
  const L = await import('../../src/lib/circle'); const RS = await import('../../src/lib/referrals-server'); const CS = await import('../../src/lib/circle-server');
  const db = makeDb(); const T = 'tenants/t1'; const J = { id: 'jess', name: 'Jessica' };

  console.log('Circle — the rules');
  const C0 = L.circleOf({});
  check('defaults: off, called Circle, Insider 3 · Ambassador 6 · Icon 12 at $15/$20/$25', !C0.on && C0.name === 'Circle' && C0.tiers.map((t) => `${t.friends}:${t.rewardCents}:${t.friendCents}`).join() === '3:1500:1500,6:2000:2000,12:2500:2500');
  check('a business names its own (“The Opal Insiders”)', L.programName(L.circleOf({ referrals: { circle: { name: 'Insiders' } } }), 'Opal') === 'Opal Insiders');
  check('tiers by friends: 2 → none, 3 → Insider, 7 → Ambassador, 12 → Icon', !L.tierFor(2, C0) && L.tierFor(3, C0)?.id === 'insider' && L.tierFor(7, C0)?.id === 'ambassador' && L.tierFor(12, C0)?.id === 'icon');
  check('higher tiers always need more friends, even if set lower by mistake', L.circleOf({ referrals: { circle: { tiers: [{ id: 'insider', friends: 5 }, { id: 'ambassador', friends: 4 }] } } }).tiers[1].friends === 6);
  check('next: 4 friends as an Insider → 2 more to Ambassador', L.nextTier(4, C0, 'insider')?.need === 2 && L.nextTier(4, C0, 'insider')?.tier.id === 'ambassador');
  check('typed codes: HANNAH15, then a different one if taken', L.typedCodeFor('Hannah Kim', 1500, () => false) === 'HANNAH15' && L.typedCodeFor('Hannah', 1500, (c) => c === 'HANNAH15') !== 'HANNAH15' && L.normalizeCode(' maya-20 ') === 'MAYA20');

  console.log('Circle — earning a tier, and boosts');
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  await RS.setReferralSettings(db, 't1', { on: true, circle: { on: true } }, J, NOW);
  check('switching it on approves a welcome offer for each tier amount ($20 and $25 as their own discounts)', (await db.doc(`${T}/discounts/referral_welcome_2000`).get()).data()?.code === 'FRIEND-WELCOME-20' && (await db.doc(`${T}/discounts/referral_welcome_2500`).get()).data()?.isActive === true);
  await db.doc(`${T}/clients/han`).set({ id: 'han', name: 'Hannah Kim', phone: '+15555550101', smsConsent: true });
  for (let i = 0; i < 6; i++) await db.doc(`${T}/referrals/old${i}`).set({ id: `old${i}`, referrerId: 'han', referrerName: 'Hannah Kim', status: 'rewarded', rewardedAt: ago(30 + i), rewardCents: 1500, friendClientId: `f${i}` });
  await db.doc(`${T}/referrals/old9`).set({ id: 'old9', referrerId: 'han', status: 'rewarded', rewardedAt: ago(400), rewardCents: 1500 });
  const st: any = await CS.memberState(db, 't1', 'han', L.circleOf((await db.doc(T).get()).data()), NOW);
  check('6 friends in the last 12 months (one older doesn’t count) → Ambassador', st.friends === 6 && st.tier === 'ambassador', st);
  const friend = async (id: string, refId: string, extra: any = {}) => { await db.doc(`${T}/clients/${id}`).set({ id, name: `${id} New`, phone: `+1555555${String(Math.floor(Math.random() * 9000) + 1000)}` });
    await db.doc(`${T}/appointments/a_${id}`).set({ clientId: id, status: 'completed', startTime: ago(1), checkedOutAt: ago(1) });
    await db.doc(`${T}/referrals/${refId}`).set({ id: refId, referrerId: 'han', referrerName: 'Hannah Kim', friendClientId: id, friendFirst: id, status: 'booked', createdAt: ago(5), bookedAt: ago(5), ...extra }); };
  await friend('ava', 'r1'); await RS.giveNow(db, 't1', 'r1', J, NOW);
  const r1: any = (await db.doc(`${T}/referrals/r1`).get()).data();
  check('her 7th friend pays the Ambassador amount: $20 credit', r1.status === 'rewarded' && r1.rewardCents === 2000 && r1.tierAtReward === 'ambassador', r1);
  check('…and she’s recorded as an Ambassador', ((await db.doc(`${T}/clients/han`).get()).data() as any).circle?.tier === 'ambassador');
  await CS.circleAction(db, 't1', { do: 'boost', name: 'Double credit weekend', start: ago(1), end: new Date(NOW + 2 * DAY).toISOString(), multiplier: 2 }, J, NOW);
  await friend('bea', 'r2'); await RS.giveNow(db, 't1', 'r2', J, NOW);
  check('a boost that’s running doubles it: $40, with the boost noted', ((await db.doc(`${T}/referrals/r2`).get()).data() as any).rewardCents === 4000 && !!((await db.doc(`${T}/referrals/r2`).get()).data() as any).boostId);
  await CS.circleAction(db, 't1', { do: 'end_boost', id: L.circleOf((await db.doc(T).get()).data()).boosts[0].id }, J, NOW);
  check('…ending it now stops it', !L.activeBoost(L.circleOf((await db.doc(T).get()).data()), NOW + 1000, 'ambassador'));

  console.log('Circle — typed codes and the friend’s offer');
  const S = (await import('../../src/lib/referrals')).referralSettingsOf((await db.doc(T).get()).data());
  const code = await CS.codeFor(db, 't1', 'han', S, L.circleOf((await db.doc(T).get()).data()));
  check('Hannah’s code is HANNAH20 (her friends get $20 as an Ambassador), and stays the same', code === 'HANNAH20' && (await CS.codeFor(db, 't1', 'han', S, L.circleOf((await db.doc(T).get()).data()))) === code, code);
  await db.doc(`${T}/clients/cal`).set({ id: 'cal', name: 'Cal New', phone: '+15555550777' }); await db.doc(`${T}/appointments/b_cal`).set({ clientId: 'cal', status: 'booked', startTime: new Date(NOW + 3 * DAY).toISOString() });
  const m: any = await RS.matchOnBooking(db, 't1', { clientId: 'cal', appointmentId: 'b_cal', code: 'hannah20', serviceIds: ['gel'] }, NOW);
  check('a friend who types “hannah20” at booking → matched to Hannah, with the $20 offer on their visit', m.matched === 'code' && (await db.doc(`${T}/appointments/b_cal`).get()).data()?.pendingDiscountCode === 'FRIEND-WELCOME-20', m);
  check('a code nobody has → nothing happens', ((await RS.matchOnBooking(db, 't1', { clientId: 'cal', appointmentId: 'b_cal', code: 'NOPE99' }, NOW)) as any).skipped !== undefined);

  console.log('Circle — creators');
  await db.doc(`${T}/clients/maya`).set({ id: 'maya', name: 'Maya Ortiz', phone: '+15555550888', smsConsent: true });
  const bad: any = await CS.circleAction(db, 't1', { do: 'creator', clientId: 'maya', creator: { code: 'HANNAH20' } }, J, NOW);
  check('a creator can’t take a code that’s already someone’s', !bad.ok && /already/.test(bad.error), bad);
  const mk: any = await CS.circleAction(db, 't1', { do: 'creator', clientId: 'maya', creator: { code: 'maya20', handle: 'mayanails', friendCents: 2000, rewardCents: 1000, pay: 'cash', cashCents: 1000, line: 'My go-to for two years.' } }, J, NOW);
  check('Maya becomes a creator: code MAYA20, @mayanails, $20 off for followers, $10 credit + $10 cash per paid first visit', mk.ok && mk.creator.code === 'MAYA20' && mk.creator.handle === '@mayanails' && mk.creator.pay === 'cash', mk);
  for (const [id, ref] of [['dee', 'm1'], ['eli', 'm2']]) { await db.doc(`${T}/clients/${id}`).set({ id, name: `${id} New`, phone: `+1555555${id === 'dee' ? '0901' : '0902'}` });
    await db.doc(`${T}/appointments/a_${id}`).set({ clientId: id, status: 'completed', startTime: ago(1), checkedOutAt: ago(1) });
    await db.doc(`${T}/referrals/${ref}`).set({ id: ref, referrerId: 'maya', referrerName: 'Maya Ortiz', friendClientId: id, friendFirst: id, status: 'booked', createdAt: ago(3), bookedAt: ago(3) });
    await RS.giveNow(db, 't1', ref, J, NOW); }
  const ov: any = await CS.circleOverview(db, 't1', NOW); const mayaRow = ov.members.find((x: any) => x.clientId === 'maya');
  check('two paid first visits → $20 credit given, and $20 cash owed to Maya (shown on the Circle tab)', mayaRow?.earnedCents === 2000 && mayaRow?.owedCents === 2000 && ov.owedCents === 2000, mayaRow);
  const paid: any = await CS.circleAction(db, 't1', { do: 'cash_paid', clientId: 'maya', method: 'Zelle' }, J, NOW);
  check('marking it paid (Zelle) clears what’s owed', paid.paidCents === 2000 && ((await CS.circleOverview(db, 't1', NOW)) as any).owedCents === 0);
  const page: any = await CS.creatorPage(db, 't1', 'maya20', NOW);
  check('her page: name, handle, line, code and the $20 offer', page.ok && page.creator.code === 'MAYA20' && page.creator.handle === '@mayanails' && page.creator.line && page.offerCents === 2000, page.error || page.creator);
  check('a client who isn’t a creator or an Icon has no page', !((await CS.creatorPage(db, 't1', 'HANNAH20', NOW)) as any).ok);

  console.log('Circle — the public page and asking to join');
  await db.doc(T).set({ referrals: { circle: { season: { name: 'Fall', places: 3 } } } }, { merge: true });
  await CS.setOptIn(db, 't1', 'han', true);
  const pub: any = await CS.circlePublic(db, 't1', NOW);
  check('the public page: The Opal Circle, Fall, real member count, places left, Hannah shown (she said yes)', pub.ok && pub.name === 'Opal Circle' && pub.season === 'Fall' && pub.count === 1 && pub.placesLeft === 2 && pub.faces[0]?.name === 'Hannah K.', pub);
  check('totals stay hidden until they’re worth showing (5+ friends this year)', pub.totals?.friends >= 5 || pub.totals === null);
  check('asking to join needs a name and a real mobile', !((await CS.circleJoin(db, 't1', { name: 'J', phone: '12' }, NOW)) as any).ok);
  await CS.circleJoin(db, 't1', { name: 'Jo Lane', phone: '(555) 555-0333', handle: '@jolanebeauty', why: 'Love it' }, NOW);
  check('…asking twice doesn’t add a second request', ((await CS.circleJoin(db, 't1', { name: 'Jo Lane', phone: '5555550333' }, NOW)) as any).already === true);
  const req = (await CS.circleOverview(db, 't1', NOW) as any).requests[0];
  const acc: any = await CS.circleAction(db, 't1', { do: 'request', id: req.id, decision: 'accept' }, J, NOW);
  const jo: any = (await db.doc(`${T}/clients/${acc.clientId}`).get()).data();
  check('accepting someone new makes them a client and an Insider', acc.ok && jo.name === 'Jo Lane' && jo.circle.tier === 'insider' && jo.circle.granted === true, jo);
  const mv: any = await CS.memberView(db, 't1', 'han', (await db.doc(T).get()).data(), 'https://opal.example', NOW);
  check('Hannah’s card: Ambassador, 8 friends, 4 more to Icon, her code and the Circle board', mv.tier.name === 'Ambassador' && mv.friends === 8 && mv.next?.name === 'Icon' && mv.next.need === 4 && mv.code === 'HANNAH20' && mv.board.some((x: any) => x.me), mv);
  console.log('Circle — the end of a season');
  check('soft landing: an Icon with 2 friends left drops one level, not three', L.seasonTier(L.circleOf({ referrals: { circle: { on: true } } }), 'icon', null, false) === 'ambassador');
  check('without the soft landing they start at what they earned', L.seasonTier(L.circleOf({ referrals: { circle: { on: true, season: { soft: false } } } }), 'icon', null, false) === null);
  check('a level the business gave by hand stays', L.seasonTier(L.circleOf({ referrals: { circle: { on: true } } }), 'icon', null, true) === 'icon');
  { const db2 = makeDb(); const T2 = 'tenants/t2'; const end = ago(1);
    await db2.doc(T2).set({ name: 'Opal', referrals: { on: true, circle: { on: true, season: { name: 'Fall', end } } } });
    await db2.doc(`${T2}/clients/ivy`).set({ id: 'ivy', name: 'Ivy Ross', phone: '+15555550301', circle: { tier: 'icon', tierAt: ago(200) } });
    await db2.doc(`${T2}/clients/mo`).set({ id: 'mo', name: 'Mo Diaz', phone: '+15555550302', circle: { tier: 'insider', tierAt: ago(200) } });
    await db2.doc(`${T2}/clients/kay`).set({ id: 'kay', name: 'Kay Lee', phone: '+15555550303', circle: { tier: 'ambassador', tierAt: ago(200), granted: true } });
    await db2.doc(`${T2}/clients/al`).set({ id: 'al', name: 'Al Park', phone: '+15555550304', circle: { tier: 'insider', tierAt: ago(200) } });
    for (let i = 0; i < 2; i++) await db2.doc(`${T2}/referrals/i${i}`).set({ id: `i${i}`, referrerId: 'ivy', status: 'rewarded', rewardedAt: ago(20 + i) });
    for (let i = 0; i < 7; i++) await db2.doc(`${T2}/referrals/a${i}`).set({ id: `a${i}`, referrerId: 'al', status: 'rewarded', rewardedAt: ago(20 + i) });
    const texts: any[] = []; const tenant2 = (await db2.doc(T2).get()).data();
    const sum: any = await CS.seasonReview(db2, 't2', tenant2, NOW, async (c, body) => { texts.push([c.id, body]); });
    const tierOf = async (id: string) => ((await db2.doc(`${T2}/clients/${id}`).get()).data() as any).circle.tier;
    check('Ivy (Icon, 2 friends) starts the new season as an Ambassador', await tierOf('ivy') === 'ambassador');
    check('Mo (Insider, no friends) leaves the program; Kay (given by hand) stays; Al (7 friends) moves up', await tierOf('mo') === null && await tierOf('kay') === 'ambassador' && await tierOf('al') === 'ambassador', sum);
    check('the summary counts it', sum.down === 1 && sum.left === 1 && sum.kept === 1 && sum.up === 1, sum);
    check('Ivy’s text says where she is and what brings her back, with no sign-off', texts.some(([id, b]) => id === 'ivy' && /new season of the Opal Circle starts today\. You’re an Ambassador this season, and 10 more friends brings you back to Icon\.$/.test(b)), texts);
    check('nobody who left gets a text', !texts.some(([id]) => id === 'mo'));
    check('it runs once per season', (await CS.seasonReview(db2, 't2', tenant2, NOW + DAY, async () => {})) === null);
    const ov: any = await CS.circleOverview(db2, 't2', NOW);
    check('the Circle tab knows the season ended and what happened', ov.seasonEnded === true && ov.lastSeason?.down === 1 && ov.lastSeason?.end === new Date(end).toISOString(), ov.lastSeason);
    check('the business gets a summary notice', (await db2.collection(`${T2}/notifications`).get()).docs.some((d: any) => /Fall season of the Opal Circle has ended\. 1 kept their level, 1 moved down one, 1 left, 1 moved up/.test(d.data().message)));
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
