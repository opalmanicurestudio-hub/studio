// scripts/verify/creator-campaigns.verify.ts — creator campaigns (lib/creator-campaigns, lib/creator-campaigns-server):
// the planner, the guarded offer, handing in and reviewing, fees owed, reminders, the cost guard and scorecards.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/creator-campaigns.verify.ts
import { makeDb, check, failures } from './fake-db';

const DAY = 864e5; const NOW = Date.parse('2026-10-14T15:00:00-04:00'); const at = (d: number) => new Date(NOW + d * DAY).toISOString();
(async () => {
  const L = await import('../../src/lib/creator-campaigns'); const S = await import('../../src/lib/creator-campaigns-server');
  const RS = await import('../../src/lib/referrals-server'); const CS = await import('../../src/lib/circle-server'); const O = await import('../../src/lib/owed-to-clients');
  const J = { id: 'jess', name: 'Jessica' };

  console.log('Campaigns — the planner');
  const p = L.plan({ creators: 3, pieces: 1, feeCents: 6000, contentVisits: 3, contentCostCents: 1800, offerCents: 2000, creditCents: 0, cashCents: 1000, expectedPerCreator: 4.7, firstVisitCents: 5800, yearValueCents: 41000, margin: 0.62, rebook: 0.64, historyKnown: true });
  check('costs add up: 3 reels $180 + content visits $54 + offers + commission', p.cost.fees === 18000 && p.cost.content === 5400 && p.cost.offers === Math.round(p.expected * 2000) && p.cost.cash === Math.round(p.expected * 1000), p.cost);
  check('a new client is worth $410 × 62% less $30 to win → $224; break-even is 2 clients', p.profitPerClient === 22420 && p.breakEven === 2, p);
  check('a forecast range, and a verdict: good', p.low < p.expected && p.high > p.expected && p.verdict === 'good' && p.profit12 > 0);
  check('a campaign that can’t pay back says so', L.plan({ creators: 2, pieces: 3, feeCents: 50000, contentVisits: 0, contentCostCents: 0, offerCents: 5000, creditCents: 0, cashCents: 0, expectedPerCreator: 1, firstVisitCents: 4000, yearValueCents: 6000, margin: 0.5, rebook: 0.2, historyKnown: false }).verdict === 'loses');
  check('days read plainly: Tue–Thu, or a list', L.daysLabel([2, 3, 4]) === 'Tue–Thu' && L.daysLabel([2, 4]) === 'Tue, Thu' && L.daysLabel([]) === '');
  check('scorecards: lots of first visits nobody returns from → discount hunters', L.scoreTag({ paidFirst: 4, costCents: 24000, comeBack: 0.25, spendCents: 22000, onTime: 0.67 }).tag === 'hunters' && L.scoreTag({ paidFirst: 9, costCents: 12000, comeBack: 0.78, spendCents: 110000, onTime: 1 }).tag === 'more');

  console.log('Campaigns — a live campaign');
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' });
  await RS.setReferralSettings(db, 't1', { on: true, circle: { on: true } }, J, NOW);
  await db.doc(`${T}/clients/maya`).set({ id: 'maya', name: 'Maya Ortiz', phone: '+15555550888', smsConsent: true });
  await CS.circleAction(db, 't1', { do: 'creator', clientId: 'maya', creator: { code: 'MAYA20', friendCents: 2000, rewardCents: 1000, pay: 'cash', cashCents: 1000 } }, J, NOW);
  const draft: any = await S.saveCampaign(db, 't1', { name: 'Fall chrome', status: 'live', creators: [], pieces: [] }, J, NOW);
  check('it can’t go live without creators', !draft.ok && /creator/.test(draft.error));
  const saved: any = await S.saveCampaign(db, 't1', { name: 'Fall chrome', status: 'live', start: at(-1), end: at(20), creators: ['maya'],
    brief: { text: 'Show the milky chrome set.', refs: [{ url: 'https://x/ref1.jpg', kind: 'image', label: 'Hook', tag: 'do' }, { url: 'http://insecure', label: 'no' }], shots: [{ text: 'First 2 seconds: the finished set', must: true, when: '0–2s' }], format: 'Reel 9:16', draft: true },
    pieces: [{ id: 'reel', kind: 'reel', due: at(2.5) }, { id: 'story', kind: 'story', due: at(10) }], pay: { feeCents: 6000 }, guard: { days: [2, 3, 4], maxUses: 20, capCents: 4500 } }, J, NOW);
  const cid = saved.id; const camp: any = (await S.getCampaign(db, 't1', cid, NOW)).campaign;
  check('saved: one reference kept (only https), a must-have shot, two pieces, Tue–Thu', camp.brief.refs.length === 1 && camp.brief.shots[0].must && camp.pieces.length === 2 && L.daysLabel(camp.guard.days) === 'Tue–Thu', camp.brief);
  const dz: any = (await db.doc(`${T}/discounts/ccamp_${cid}_maya`).get()).data();
  check('Maya’s offer during the campaign is its own approved discount: $20, Tue–Thu, up to 20 uses', dz?.value === 20 && dz.daysOfWeek.join() === '2,3,4' && dz.usageLimit === 20 && dz.isActive === true && dz.approvedBy === 'Jessica', dz);
  // A follower books on a Wednesday from the reel's link, and another on a Saturday.
  const book = async (id: string, start: string, cp?: string) => { await db.doc(`${T}/clients/${id}`).set({ id, name: `${id} New`, phone: `+1555555${id.length}${id.charCodeAt(0)}`.slice(0, 12) });
    await db.doc(`${T}/appointments/a_${id}`).set({ clientId: id, status: 'booked', startTime: start }); return RS.matchOnBooking(db, 't1', { clientId: id, appointmentId: `a_${id}`, code: 'MAYA20', cp: cp || null, serviceIds: ['gel'] }, NOW); };
  await book('wed', '2026-10-21T14:00:00-04:00', `${cid}.reel`); await book('sat', '2026-10-24T14:00:00-04:00');
  const wedA: any = (await db.doc(`${T}/appointments/a_wed`).get()).data(); const satA: any = (await db.doc(`${T}/appointments/a_sat`).get()).data();
  const refs = (await db.collection(`${T}/referrals`).get()).docs.map((d: any) => d.data());
  check('Wednesday from the reel: the campaign offer on the visit, and it counts for the reel', wedA.pendingDiscountCode === dz.code && refs.find((r: any) => r.friendClientId === 'wed')?.pieceId === 'reel' && refs.find((r: any) => r.friendClientId === 'wed')?.campaignId === cid);
  check('Saturday: no offer (outside its days), but it still counts for Maya and the campaign', !satA.pendingDiscountCode && refs.find((r: any) => r.friendClientId === 'sat')?.campaignId === cid);

  console.log('Campaigns — the creator hands in, the business reviews');
  const mine: any = await S.creatorCampaigns(db, 't1', 'maya', 'https://opal.example', NOW);
  check('Maya sees her brief, what she earns, and a link for each piece', mine.campaigns[0]?.name === 'Fall chrome' && mine.campaigns[0].earn.feeCents === 6000 && /\/c\/t1\/MAYA20\?p=.+\.reel$/.test(mine.campaigns[0].pieces[0].link), mine.campaigns[0]?.pieces?.[0]);
  check('handing in needs the post link and the paid-partnership confirmation', !((await S.handIn(db, 't1', 'maya', { campaignId: cid, pieceId: 'reel', url: 'nope' }, NOW)) as any).ok && !((await S.handIn(db, 't1', 'maya', { campaignId: cid, pieceId: 'reel', url: 'https://instagram.com/reel/abc' }, NOW)) as any).ok);
  check('someone else can’t hand in for her campaign', !((await S.handIn(db, 't1', 'wed', { campaignId: cid, pieceId: 'reel', url: 'https://instagram.com/reel/abc', ad: true }, NOW)) as any).ok);
  const h: any = await S.handIn(db, 't1', 'maya', { campaignId: cid, pieceId: 'reel', url: 'https://instagram.com/reel/abc', ad: true, rights: true, views: '3100' }, NOW);
  check('handed in: waiting for review, with views and permission to repost', h.ok && h.hand.status === 'submitted' && h.hand.views === 3100 && h.hand.rights === true);
  check('asking for a change needs a note', !((await S.reviewHand(db, 't1', { campaignId: cid, creatorId: 'maya', pieceId: 'reel', decision: 'changes' }, J, NOW)) as any).ok);
  await S.reviewHand(db, 't1', { campaignId: cid, creatorId: 'maya', pieceId: 'reel', decision: 'approve' }, J, NOW);
  const fees = await S.feesOwed(db, 't1');
  check('approved: the $60 fee is owed to Maya', fees.get('maya') === 6000);
  check('…and shows in Money with what’s owed to creators', ((await O.owedToClients(db, 't1', NOW)) as any).creatorsCents === 6000);
  const paid: any = await CS.circleAction(db, 't1', { do: 'cash_paid', clientId: 'maya', method: 'Zelle' }, J, NOW);
  check('marking Maya paid clears her fee too', paid.paidCents === 6000 && (await S.feesOwed(db, 't1')).get('maya') === undefined);

  console.log('Campaigns — reminders and the guard');
  await db.doc(`${T}/clients/maya`).set({ smsConsent: false }, { merge: true });   // no texts in a test
  const sw: any = await S.campaignSweep(db, 't1', (await db.doc(T).get()).data(), NOW + 8 * DAY);
  check('the story due in 2 days gets one reminder marked (3 days before)', Object.keys(((await db.doc(`${T}/creatorCampaigns/${cid}`).get()).data() as any).reminded || {}).some((k) => k.endsWith('.story.3')), sw);
  for (const id of ['x1', 'x2']) await db.doc(`${T}/referrals/g_${id}`).set({ id: `g_${id}`, referrerId: 'maya', friendClientId: id, campaignId: cid, status: 'rewarded', rewardedAt: at(0), rewardCents: 1000, cashOwedCents: 1000, offerCents: 2000 });
  await db.doc(`${T}/creatorCampaigns/${cid}`).set({ guard: { capCents: 2000 } }, { merge: true });
  await S.campaignSweep(db, 't1', (await db.doc(T).get()).data(), NOW + 8 * DAY);
  const after: any = (await db.doc(`${T}/creatorCampaigns/${cid}`).get()).data();
  check('cost per new client past the $20 cap → the campaign pauses and the offer switches off', !!after.paused?.why && (await db.doc(`${T}/discounts/ccamp_${cid}_maya`).get()).data()?.isActive === false, after.paused);

  console.log('Campaigns — scorecards');
  for (const [id, n] of [['x1', 3], ['x2', 1]] as [string, number][]) for (let i = 0; i < n; i++) await db.doc(`${T}/appointments/v_${id}${i}`).set({ clientId: id, status: 'completed', startTime: at(-60 + i * 20), price: 60 });
  const sc: any = await S.scorecards(db, 't1', 6, NOW);
  const m = sc.cards.find((c: any) => c.clientId === 'maya');
  check('Maya’s card: 2 paid first visits, half came back, spend and cost counted, a label', m.paidFirst === 2 && m.comeBack === 0.5 && m.spendCents === 24000 && m.costCents > 0 && !!m.label, m);
  check('her approved reel is listed with what it brought', sc.pieces.some((x: any) => x.label === 'Reel 1' && x.creator === 'Maya O.'), sc.pieces);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
