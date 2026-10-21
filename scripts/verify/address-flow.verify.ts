// Checks getting the address right: what counts as a real difference, the apartment question, when a change goes
// straight through, the signed check, the carrier check's answers and the Needs you list.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/address-flow.verify.ts
import { addressKey, carrierAddress, changeMode, changePolicy, meaningfulChanges, oneLine, sameAddress, tidyCase, unitLooksMissing, unitOf } from '../../src/lib/address-flow';
import { checkFromToken, signCheck } from '../../src/lib/address-flow-server';
import { validateAddress, shouldBlock } from '../../src/lib/address-validation';
import { needsYou } from '../../src/lib/orders-view';

let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };

(async () => {
  const typed = { name: 'Dana Whitfield', line1: '12 Oak Street', line2: 'Apt 4B', city: 'Austin', state: 'Texas', postalCode: '78704' };
  const shippoSame = { street1: '12 OAK ST', street2: 'APT 4B', city: 'AUSTIN', state: 'TX', zip: '78704-1234', country: 'US' };
  ok(meaningfulChanges(typed, carrierAddress(typed, shippoSame)).length === 0, 'Street and St, capitals, Texas and TX, and a ZIP+4 never ask anything');
  ok(meaningfulChanges({ ...typed, postalCode: '78705' }, carrierAddress(typed, shippoSame)).join() === 'postalCode', 'a different ZIP is worth asking about');
  ok(meaningfulChanges({ ...typed, line1: '12 Oack St' }, carrierAddress(typed, shippoSame)).join() === 'street', 'a typo in the street is worth asking about');
  ok(meaningfulChanges({ ...typed, city: 'Saint Louis', state: 'MO' }, { ...typed, city: 'St Louis', state: 'MO' }).length === 0, 'Saint and St in a city match');
  ok(meaningfulChanges({ ...typed, line1: '12 Oak St #4B', line2: '' }, carrierAddress(typed, shippoSame)).length === 0, 'a unit typed on the first line matches one on the second');
  const dropped = carrierAddress({ ...typed, line1: '12 Oak St #4B', line2: '' }, { ...shippoSame, street2: '' });
  ok(dropped.line2 === '#4B' && meaningfulChanges({ ...typed, line1: '12 Oak St #4B', line2: '' }, dropped).length === 0, 'the carrier leaving off their unit never suggests dropping it');
  ok(unitOf({ line1: '500 Main St Suite 210' }) === 'Suite 210' && unitOf({ line1: '500 Main St' }) === '', 'finds the unit wherever it was typed');
  ok(tidyCase('12 OAK ST APT 4B') === '12 Oak St Apt 4B' && tidyCase('PO BOX 12') === 'PO Box 12' && tidyCase('N MAIN ST') === 'N Main St', 'the carrier’s capitals read like a person wrote them');
  ok(sameAddress(typed, { ...typed, line1: '12 OAK ST', state: 'TX', postalCode: '78704-0001' }) && !sameAddress(typed, { ...typed, line2: 'Apt 5B' }), 'same place however it’s written; a different unit is a different place');
  ok(oneLine(typed) === '12 Oak Street, Apt 4B, Austin, TX 78704', 'one line for messages');

  const house = { name: 'Dana', line1: '12 Oak St', line2: '', city: 'Austin', state: 'TX', postalCode: '78704' };
  ok(unitLooksMissing(house, 'unconfirmed') === true, 'no unit and the carrier couldn’t confirm it: ask for one');
  ok(unitLooksMissing(house, 'valid') === false, 'a confirmed address without a unit isn’t asked');
  ok(unitLooksMissing(house, 'valid', ['This address is a default match; an apartment or suite number may be needed.']) === true, 'the carrier hinting at a missing unit asks');
  ok(unitLooksMissing({ ...house, line2: '4B' }, 'unconfirmed') === false && unitLooksMissing({ ...house, line1: '12 Oak St Apt 4' }, 'unconfirmed') === false, 'a unit already given is never asked again');
  ok(unitLooksMissing({ ...house, line1: 'PO Box 77' }, 'unconfirmed') === false, 'PO boxes aren’t asked for a unit');

  // Changes, by the shop's policy.
  const rs = (p: any = {}) => ({ policies: p });
  const ord = (extra: any = {}) => ({ method: 'ship', stage: 'paid', ...extra });
  ok(changePolicy({}).until === 'label' && changePolicy({}).heldNeedsManager === true, 'by default: until the label, and held orders wait for a manager');
  ok(changeMode(ord(), rs()).mode === 'direct' && changeMode(ord({ stage: 'packed' }), rs()).mode === 'direct', 'until the label, a change goes straight through, even once packed');
  ok(changeMode(ord({ stage: 'packed', labelUrl: 'https://x' }), rs()).why === 'label', 'after the label it becomes a request');
  ok(changeMode(ord({ stage: 'picking' }), rs({ addressChangeUntil: 'packing' })).why === 'packing' && changeMode(ord(), rs({ addressChangeUntil: 'packing' })).mode === 'direct', '“until packing”: fine before packing, a request after');
  ok(changeMode(ord(), rs({ addressChangeUntil: 'never' })).mode === 'request', '“never”: every change is a request');
  ok(changeMode(ord({ holdForReview: true }), rs()).why === 'held' && changeMode(ord({ holdForReview: true }), rs({ addressHeldNeedsManager: false })).mode === 'direct', 'held orders ask, unless the shop turned that off');
  ok(changeMode(ord({ stage: 'shipped' }), rs()).mode === 'carrier' && changeMode(ord({ stage: 'shipped', deliveredAt: 'x' }), rs()).mode === 'none', 'shipped: the carrier’s own options; delivered: nothing');
  ok(changeMode(ord({ method: 'counter' }), rs()).mode === 'none' && changeMode(ord({ stage: 'cancelled' }), rs()).mode === 'none', 'pickups and cancelled orders have no address to change');

  // The signed check: used once at checkout instead of asking the carrier again.
  const check: any = { verdict: 'corrected', suggestion: { postalCode: '78704' }, carrier: { ...house, postalCode: '78704-1234' }, unitMissing: false, messages: [], checkedAt: 'now' };
  const wrongZip = { ...house, postalCode: '78705' };
  const tok = signCheck('t1', wrongZip, check);
  ok(checkFromToken('t1', tok, wrongZip)?.picked === 'typed' && checkFromToken('t1', tok, wrongZip)?.check.verdict === 'corrected', 'kept what they typed: the check is reused as it was');
  const picked = checkFromToken('t1', tok, { ...house, postalCode: '78704-1234' });
  ok(picked?.picked === 'suggested' && picked.check.verdict === 'valid', 'took the carrier’s version: it counts as confirmed');
  ok(checkFromToken('t1', tok, { ...house, line1: '99 Elm St' }) === null, 'a different address needs its own check');
  ok(checkFromToken('t2', tok, wrongZip) === null, 'another shop can’t use it');
  ok(checkFromToken('t1', tok.slice(0, -2) + 'xx', wrongZip) === null && checkFromToken('t1', 'nonsense', wrongZip) === null, 'an altered token is refused');
  const realNow = Date.now; Date.now = () => realNow() + 3 * 3600e3;
  ok(checkFromToken('t1', tok, wrongZip) === null, 'an old token is refused');
  Date.now = realNow;
  ok(addressKey(wrongZip) !== addressKey(house), 'the ZIP is part of the key');

  // The carrier check itself, with the carrier's answers stubbed.
  const realFetch = globalThis.fetch;
  const answer = (data: any) => { globalThis.fetch = (async () => ({ ok: true, json: async () => data })) as any; };
  const policy = { enabled: true, blockUndeliverable: false };
  answer({ ...shippoSame, validation_results: { is_valid: true, messages: [] } });
  let c = await validateAddress({ address: typed, apiKey: 'k', policy });
  ok(c.verdict === 'valid' && !c.carrier, 'the carrier only tidied it: valid, nothing to ask');
  answer({ ...shippoSame, validation_results: { is_valid: true, messages: [] } });
  c = await validateAddress({ address: { ...typed, postalCode: '78705' }, apiKey: 'k', policy });
  ok(c.verdict === 'corrected' && c.carrier?.postalCode === '78704-1234' && c.carrier?.line1 === '12 Oak St' && c.carrier?.name === 'Dana Whitfield', 'a different ZIP: corrected, with the carrier’s whole version, tidy, and their name kept');
  answer({ street1: '12 OAK ST', city: 'AUSTIN', state: 'TX', zip: '78704', validation_results: { messages: [{ text: 'Address could not be verified.' }] } });
  c = await validateAddress({ address: house, apiKey: 'k', policy });
  ok(c.verdict === 'unconfirmed' && c.unitMissing === true, 'couldn’t confirm and no unit: ask for one');
  answer({ validation_results: { is_valid: false, messages: [{ text: 'Address Not Found' }] } });
  c = await validateAddress({ address: house, apiKey: 'k', policy });
  ok(c.verdict === 'undeliverable' && !shouldBlock(c, policy) && shouldBlock(c, { enabled: true, blockUndeliverable: true }), 'not found: refused only when the shop turns those away');
  globalThis.fetch = (async () => { throw new Error('down'); }) as any;
  c = await validateAddress({ address: house, apiKey: 'k', policy });
  ok(c.verdict === 'skipped', 'the carrier being down never stops a sale');
  globalThis.fetch = realFetch;
  ok((await validateAddress({ address: house, apiKey: 'k', policy: { enabled: false, blockUndeliverable: false } })).verdict === 'skipped', 'checks off: nothing is asked (and nothing is spent)');

  // The team sees what needs them.
  const now = Date.now();
  const n = needsYou([
    { id: 'a', stage: 'packed', method: 'ship', customerName: 'Dana Whitfield', labelUrl: 'https://x', addressRequest: { status: 'waiting' } },
    { id: 'b', stage: 'paid', method: 'ship', customerName: 'Sam Lee', addressRequest: { status: 'waiting' } },
    { id: 'c', stage: 'paid', method: 'ship', customerName: 'Priya Shah', addressConfirm: { status: 'waiting', askedAt: new Date(now - 30 * 3600e3).toISOString() } },
    { id: 'd', stage: 'paid', method: 'ship', customerName: 'Marcus T', addressConfirm: { status: 'waiting', askedAt: new Date(now - 2 * 3600e3).toISOString() } },
    { id: 'e', stage: 'shipped', method: 'ship', customerName: 'Old', addressRequest: { status: 'waiting' } },
  ], now);
  ok(n.find((x) => x.orderId === 'a')?.text === 'Dana changed the address after the label was bought', 'a change after the label is listed');
  ok(n.find((x) => x.orderId === 'b')?.text === 'Sam asked to change the address', 'a change waiting for approval is listed');
  ok(n.find((x) => x.orderId === 'c')?.kind === 'unconfirmed' && !n.some((x) => x.orderId === 'd'), 'no answer after a day is listed; a fresh question isn’t');
  ok(!n.some((x) => x.orderId === 'e'), 'nothing for orders that have gone');

  if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
})();
