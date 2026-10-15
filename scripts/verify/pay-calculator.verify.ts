// scripts/verify/pay-calculator.verify.ts — the public pay calculator: private link round trip, the math, the
// market range, asks, the offer, and every language having every word.
import { blank, encodeState, decodeState, compute, hoursOf, type CalcState } from '../../src/lib/pay-calc';
import { wageRange, OCCUPATIONS } from '../../src/lib/wage-data';
import { DICT, tr, OCC_TITLES, CONTRACTOR_Q } from '../../src/lib/pay-calc-i18n';
import { CONTRACTOR_QUESTIONS } from '../../src/lib/pay-extras';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };

const s: CalcState = { ...blank('job'), payType: 'commission', pct: 40, sales: 7500, tips: 768, costsMonthly: 120, commuteMin: 25, ptoDays: 5, soc: '39-5092', state: 'TX', minWage: 7.25, cq: { schedule: true }, est: ['tips'] };
const code = encodeState({ ...s, soc: '39-5092', self: { ...s.self, otherMonthly: 90 } });
ok(/^[A-Za-z0-9_-]+$/.test(code), 'link is address-safe', code.slice(0, 20));
const back = decodeState(code); ok(back && back.pct === 40 && back.cq.schedule === true && back.est[0] === 'tips', 'private link round trip', back);
ok(decodeState('not-a-state') === null && decodeState(encodeState({ ...s, mode: 'nope' as any })) === null, 'bad links are ignored');
ok(decodeState(encodeState({ ...s, offer: { ...s.offer, rate: 19 } }))?.offer.rate === 19, 'offer survives the link');
const accent = decodeState(encodeState({ ...s, soc: 'Tiếng Việt' })); ok(accent?.soc === 'Tiếng Việt', 'non-ASCII survives the link');

ok(hoursOf(s) === 160, '5 days × 8 hours × 4 weeks', hoursOf(s));
const r = compute(s);
ok(r.gross === 3768 && r.perHour === 23.55 && r.perHourNoTips === 18.75, 'commission + tips per hour', { g: r.gross, h: r.perHour, n: r.perHourNoTips });
ok(r.afterCosts !== null && r.afterCosts < r.perHour! && r.allIn.commuteHours > 16, 'after costs and the commute', r.allIn);
ok(r.market && r.market.median === 17.19 && r.market.scaled, 'market range scaled to 2025', r.market);
ok(r.rows.some((x) => x.key === 'self') && r.rows.some((x) => x.key === 'hourly') && r.rows[0].now, 'comparison rows', r.rows.map((x) => x.key));
ok(r.breakEven !== null && r.breakEven > 0, 'break-even for working for yourself', r.breakEven);
ok(r.asks.some((a) => a.k === 'askCosts') && r.asks.some((a) => a.k === 'askUnbooked'), 'worth asking about', r.asks);

const low = compute({ ...s, sales: 2000, tips: 0, costsMonthly: 0, minWage: 10 });
ok(low.asks[0]?.k === 'askMin', 'pay before tips under minimum wage is flagged', low.asks);
const tipped = compute({ ...blank('job'), payType: 'tips', rate: 2.13, tips: 1500, state: 'TX', minWage: 7.25 });
ok(!tipped.asks.some((a) => a.k === 'askMin'), 'tip credit state: tips can make up minimum wage', tipped.asks);
const tippedCA = compute({ ...blank('job'), payType: 'tips', rate: 2.13, tips: 1500, state: 'CA', minWage: 16.5 });
ok(tippedCA.asks.some((a) => a.k === 'askMin'), 'no tip credit in California', tippedCA.asks);

const paid = compute({ ...s, paid: 3200 });
ok(paid.payNoTips === 3200 && paid.gross === 3968, 'what you were actually paid wins over the plan', { p: paid.payNoTips, g: paid.gross });

const tax = compute({ ...s, tax: { on: true, filing: 'single', statePct: 4 } });
ok(tax.tax && tax.tax.takeHome < tax.monthBIT && tax.tax.federal > 0, 'rough take-home', tax.tax);

const self = compute({ ...blank('self'), sales: 6100, tips: 768 });
ok(self.rows[0].now && self.rows[0].plan.kind === 'self' && self.costs > 1000, 'working for yourself: costs come off', { c: self.costs, rows: self.rows.map((x) => x.key) });
const self2 = compute({ ...blank('self'), sales: 6100, tips: 768, tax: { on: true, filing: 'single', statePct: 0 } });
ok(self2.tax && self2.tax.federal > 0, 'self take-home uses self-employment tax', self2.tax);

const off = compute({ ...s, mode: 'offer', offer: { ...blank().offer, payType: 'hourly_commission', rate: 19, pct: 8, ptoDays: 10, healthMonthly: 150, matchPct: 3, suppliesMonthly: 0, commuteMin: 40 } });
ok(off.offer && off.offer.offerMonth > 0 && off.offer.nowMonth > 0, 'offer side by side', off.offer);
ok(off.offer && off.offer.crossOver !== null && off.offer.crossOver > 7500 * 30.44 / 28, 'sales where commission overtakes the offer', off.offer);

ok(OCCUPATIONS.length >= 30 && OCCUPATIONS.every((o) => wageRange(o.soc)), 'every job has a range');
const enKeys = Object.keys(DICT.en);
for (const l of ['es', 'vi'] as const) {
  const missing = enKeys.filter((k) => !(DICT[l] as any)[k]); ok(!missing.length, `${l}: every word translated`, missing);
  const ph = enKeys.filter((k) => ((DICT.en as any)[k].match(/\{\w+\}/g) || []).sort().join() !== (((DICT[l] as any)[k] || '').match(/\{\w+\}/g) || []).sort().join()); ok(!ph.length, `${l}: placeholders match`, ph);
  ok(OCCUPATIONS.every((o) => OCC_TITLES[l][o.soc]), `${l}: every job title`); ok(CONTRACTOR_QUESTIONS.every((q) => CONTRACTOR_Q[l][q.id]), `${l}: every contractor question`);
}
ok(tr('es', 'answerTitle', { v: '$24.60' }) === 'Tu trabajo te paga $24.60 por hora', 'fills placeholders');

console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
