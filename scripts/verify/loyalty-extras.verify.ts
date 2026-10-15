// scripts/verify/loyalty-extras.verify.ts — what makes the program feel special (lib/loyalty, lib/loyalty-server):
// tier perks, visit cues, surprises, goal and head start, rhythm, boosts.
import { makeDb, check, failures } from './fake-db';
import * as Lo from '../../src/lib/loyalty';
import * as E from '../../src/lib/waitlist-engine';

const DAY = 864e5; const NOW = Date.parse('2026-10-15T15:00:00Z');
(async () => {
  console.log('Loyalty extras — the rules');
  const base = { on: true, earn: { mode: 'per_dollar', perDollar: 1 }, rewards: [{ id: 'r10', name: '$10 off', points: 300, kind: 'amount_off', cents: 1000 }, { id: 'ped', name: 'Free pedicure', points: 800, kind: 'free_service', serviceId: 'pedi', costCents: 1500 }],
    tiers: [{ id: 'gold', name: 'Gold', points: 1000, multiplier: 1.5, waitlistFirst: true, earlyDays: 7, upgrade: { fromServiceId: 'gel', toServiceId: 'sgel' } }],
    headStart: 60, rhythm: { on: true, points: 25, graceDays: 4, defaultWeeks: 4 }, referralPoints: 200,
    boosts: [{ id: 'b', label: 'Double points: Opal products', from: '2026-10-23', to: '2026-10-25', multiplier: 2, scope: 'products', ids: ['oil'] }],
    surprises: { on: true, perMonth: 2, items: [{ id: 'ann', name: 'Free paraffin', when: 'anniversary', kind: 'amount_off', cents: 800, costCents: 400 }, { id: 'mr', name: '$10 off', when: 'made_right', kind: 'amount_off', cents: 1000 }, { id: 'tm', name: 'A treat', when: 'team', kind: 'amount_off', cents: 500 }] } };
  const S = Lo.loyaltyOf({ loyalty: base });
  check('settings keep the extras', S.tiers[0].waitlistFirst === true && S.tiers[0].earlyDays === 7 && S.tiers[0].upgrade?.toServiceId === 'sgel' && S.headStart === 60 && S.rhythm.on && S.boosts.length === 1 && S.surprises.items.length === 3 && S.referralPoints === 200);
  check('changing the rhythm makes a new rules version', Lo.nextLoyalty(S, { ...base, rhythm: { ...base.rhythm, points: 30 } }).version === S.version + 1);
  check('perks in plain words', Lo.perkWords(S.tiers[0], (id) => (id === 'sgel' ? 'Structured gel' : id === 'gel' ? 'Gel manicure' : null)).slice(0, 3).join(' | ') === 'First pick of cancellations | Book 7 days early | Free upgrade from gel manicure to structured gel');
  check('free upgrade: the price difference, only when the upgraded service is on the bill', Lo.upgradeCents(S.tiers[0], [{ serviceId: 'sgel', cents: 6500 }], (id) => (id === 'sgel' ? 6500 : 4500)) === 2000 && Lo.upgradeCents(S.tiers[0], [{ serviceId: 'gel', cents: 4500 }], () => 6500) === 0);
  // Waitlist: first pick, but someone owed (missed out last time) still comes first.
  const r = E.rank([{ e: { id: 'a', createdAt: '2026-09-01' }, leftover: 0 }, { e: { id: 'g', createdAt: '2026-10-10', vip: true }, leftover: 0 }, { e: { id: 'o', createdAt: '2026-10-12' }, leftover: 0, pri: 'missed' }] as any);
  check('waitlist: owed first, then the tier member, then everyone else', r.map((x: any) => x.e.id).join() === 'o,g,a', r.map((x: any) => x.e.id));
  // Goal.
  check('goal: the one they chose, with how far along', JSON.stringify(Lo.goalOf(S, 'ped', 740)) === JSON.stringify({ reward: S.rewards[1], toGo: 60, pct: 93, chosen: true }));
  check('goal: none chosen → the next one up', Lo.goalOf(S, null, 100)?.reward.id === 'r10' && Lo.goalOf(S, null, 100)?.chosen === false);
  // Rhythm.
  const v = ['2026-08-01T15:00:00Z', '2026-08-22T15:00:00Z', '2026-09-12T15:00:00Z', '2026-10-03T15:00:00Z'];
  check('their usual gap: 21 days', Lo.usualGapDays(v, 28) === 21);
  check('back in 12 days (within 21 + 4) → bonus', Lo.rhythmBonus(S, v, NOW)?.points === 25);
  check('back in 40 days → no bonus', Lo.rhythmBonus(S, v, Date.parse('2026-11-12T15:00:00Z')) === null);
  check('first visit → no rhythm yet', Lo.rhythmBonus(S, [], NOW) === null);
  // Boosts.
  const sale = { services: [{ serviceId: 'gel', cents: 4500 }], products: [{ productId: 'oil', cents: 1800 }, { productId: 'nipper', cents: 2500 }], giftSpentCents: 0, giftBoughtCents: 0, visits: 1, rebooked: false, renter: false };
  check('boost on the chosen product only, on its dates', Lo.boostBonus(S, sale, '2026-10-24')?.points === 18 && Lo.boostBonus(S, sale, '2026-10-26') === null);
  // Surprises.
  const ann = Lo.surpriseFor(S, { firstVisitAt: '2025-10-18T15:00:00Z', usedThisMonth: 0, now: NOW });
  check('anniversary week → the anniversary surprise', ann?.item.id === 'ann' && ann.why === '1 year with us');
  check('given already this year → not again', Lo.surpriseFor(S, { firstVisitAt: '2025-10-18T15:00:00Z', lastSurpriseAt: '2026-10-14T15:00:00Z', usedThisMonth: 0, now: NOW }) === null);
  check('after a case was closed → the made-right surprise', Lo.surpriseFor(S, { firstVisitAt: '2026-03-01T00:00:00Z', madeRightAt: '2026-10-01T00:00:00Z', usedThisMonth: 0, now: NOW })?.item.id === 'mr');
  check('budget used up → no surprise, and none for the team to pick', Lo.surpriseFor(S, { firstVisitAt: '2025-10-18T15:00:00Z', usedThisMonth: 2, now: NOW }) === null && Lo.teamSurprises(S, 2).length === 0 && Lo.teamSurprises(S, 1).length === 1);
  // Cues.
  check('cues: 50th visit, 2 years this week, birthday Saturday', Lo.visitCues({ visitNumber: 50, firstVisitAt: '2024-10-17T15:00:00Z', birthday: '1990-10-17', at: NOW }).join(' | ') === 'Their 50th visit | 2 years with us this week | Birthday Saturday');
  check('cues: nothing notable → nothing', Lo.visitCues({ visitNumber: 7, firstVisitAt: '2026-02-01T00:00:00Z', at: NOW }).length === 0);

  console.log('Loyalty extras — the ledger');
  const db = makeDb(); const tenant = { timezone: 'America/New_York', loyalty: base };
  const LS = await import('../../src/lib/loyalty-server');
  const e1: any = await LS.earnForSale(db, 't', tenant, { clientId: 'c', saleId: 's1', sale, by: 'Desk', at: '2026-09-01T15:00:00Z' });
  check('first sale: points plus the head start', e1.points === 88 + 60, e1);
  const e2: any = await LS.earnForSale(db, 't', tenant, { clientId: 'c', saleId: 's2', sale, by: 'Desk', at: '2026-09-20T15:00:00Z' });
  check('back in 19 days: points plus the rhythm bonus, no second head start', e2.points === 88 + 25, e2);
  const e3: any = await LS.earnForSale(db, 't', tenant, { clientId: 'c', saleId: 's3', sale, by: 'Desk', at: '2026-10-24T15:00:00Z' });
  check('during the boost, 34 days later: points plus 18 boost, no rhythm', e3.points === 88 + 18, e3);
  await LS.reverseSale(db, 't', { saleId: 's3', full: true, by: 'Desk' });
  check('undoing the sale takes the boost back too', (await LS.balanceFor(db, 't', 'c')) === 148 + 113);
  await LS.recordGift(db, 't', { kind: 'surprise', clientId: 'c', saleId: 's4', name: 'Free paraffin', cents: 800, costCents: 400, by: 'Desk' });
  check('a surprise is recorded at no points', (await LS.balanceFor(db, 't', 'c')) === 261 && (await LS.surprisesThisMonth(db, 't', tenant)) === 1);
  check('a head start on joining, once', (await LS.grantHeadStart(db, 't', tenant, 'new')) === 60 && (await LS.grantHeadStart(db, 't', tenant, 'new')) === 0);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
