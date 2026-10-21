// Checks getting the address right: what counts as a real difference, the apartment question, when a change goes
// straight through, the signed check, the carrier check's answers and the Needs you list.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/address-flow.verify.ts
import { addressKey, carrierAddress, changeMode, changePolicy, meaningfulChanges, oneLine, openRequest, sameAddress, tidyCase, unitLooksMissing, unitOf } from '../../src/lib/address-flow';
import { checkFromToken, signCheck } from '../../src/lib/address-flow-server';
import { validateAddress, shouldBlock } from '../../src/lib/address-validation';
import { needsYou } from '../../src/lib/orders-view';
import { voidOrderLabels } from '../../src/lib/label-void';
import { togetherKey } from '../../src/lib/ship-together';

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
  ok(!!openRequest({ addressRequest: { status: 'waiting' } }) && !!openRequest({ addressRequest: { status: 'approving' } }) && !openRequest({ addressRequest: { status: 'kept' } }), 'a change being approved this moment still holds the label and shipping');

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
    { id: 'f', stage: 'packed', method: 'ship', customerName: 'Lena Fox', labelUrl: 'x', addressRequest: { status: 'approving' } },
  ], now);
  ok(n.find((x) => x.orderId === 'a')?.text === 'Dana changed the address after the label was bought', 'a change after the label is listed');
  ok(n.find((x) => x.orderId === 'b')?.text === 'Sam asked to change the address', 'a change waiting for approval is listed');
  ok(n.find((x) => x.orderId === 'c')?.kind === 'unconfirmed' && !n.some((x) => x.orderId === 'd'), 'no answer after a day is listed; a fresh question isn’t');
  ok(!n.some((x) => x.orderId === 'e'), 'nothing for orders that have gone');
  ok(n.some((x) => x.orderId === 'f'), 'a change being approved stays on the list until it’s done');

  // Voiding every box's label: all or nothing, honestly.
  const fakeDb = { doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), create: async () => {} }) };
  const realFetch2 = globalThis.fetch;
  const shippo = (o: { lookupFails?: boolean; extra?: string[]; refund?: (id: string) => { ok: boolean; body: any } }) => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/transactions/?rate=')) { if (o.lookupFails) throw new Error('down'); return { ok: true, json: async () => ({ results: [{ object_id: 'm', status: 'SUCCESS' }, ...(o.extra || []).map((id) => ({ object_id: id, status: 'SUCCESS' }))] }) }; }
      if (u.includes('/transactions/m')) { if (o.lookupFails) throw new Error('down'); return { ok: true, json: async () => ({ rate: 'rate1' }) }; }
      if (u.endsWith('/refunds/')) { const id = JSON.parse(init.body).transaction; calls.push(id); const r = o.refund ? o.refund(id) : { ok: true, body: { status: 'QUEUED' } }; return { ok: r.ok, json: async () => r.body }; }
      return { ok: false, json: async () => ({}) };
    }) as any;
    return calls;
  };
  let calls = shippo({});
  let vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm', trackingNumber: '9400' }, 'k');
  ok(vr.ok && vr.count === 1 && calls.join() === 'm' && vr.trackingNumbers.join() === '9400', 'one box: its label is voided');
  calls = shippo({ extra: ['b2', 'b3'] });
  vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm', extraLabelUrls: ['x', 'y'], trackingNumber: '1', extraTrackingNumbers: ['2', '3'] }, 'k');
  ok(vr.ok && vr.count === 3 && calls.join() === 'm,b2,b3' && vr.trackingNumbers.length === 3, 'three boxes: every label is voided');
  calls = shippo({ lookupFails: true });
  vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm', extraLabelUrls: ['x'] }, 'k');
  ok(!vr.ok && calls.length === 0, 'can’t find the other boxes: nothing is voided, and it says so');
  calls = shippo({ extra: ['b2'] });
  vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm', extraLabelUrls: ['x', 'y'] }, 'k');
  ok(!vr.ok && calls.length === 0, 'fewer boxes found than were bought: nothing is voided');
  calls = shippo({ extra: ['b2', 'b3'], refund: (id) => (id === 'b2' ? { ok: false, body: { detail: 'Carrier timeout' } } : { ok: true, body: { status: 'QUEUED' } }) });
  vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm', extraLabelUrls: ['x', 'y'] }, 'k');
  ok(!vr.ok && vr.voidedIds.join() === 'm,b3' && /2 of 3/.test(String(vr.error)), 'one box fails: the others are reported as voided, and the count is honest');
  calls = shippo({ extra: ['b2', 'b3'] });
  vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm', extraLabelUrls: ['x', 'y'] }, 'k', { alreadyVoided: ['m', 'b3'] });
  ok(vr.ok && calls.join() === 'b2', 'trying again only voids what’s left');
  calls = shippo({ refund: () => ({ ok: false, body: { detail: 'This transaction has already been refunded.' } }) });
  vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm' }, 'k');
  ok(vr.ok, 'a label the carrier already refunded counts as voided');
  calls = shippo({ refund: () => ({ ok: false, body: { detail: 'Label already used and cannot be refunded.' } }) });
  vr = await voidOrderLabels(fakeDb, 't', { shippoTransactionId: 'm' }, 'k');
  ok(!vr.ok, 'a label the carrier already scanned is not counted as voided');
  globalThis.fetch = realFetch2;

  // Orders with a change waiting aren't put in one box with others.
  const tg = (extra: any = {}) => ({ method: 'ship', stage: 'packed', customerEmail: 'a@x.com', shippingAddress: { name: 'A', line1: '1 Main St', city: 'X', state: 'TX', postalCode: '78704' }, ...extra });
  ok(togetherKey(tg()) !== '' && togetherKey(tg({ addressRequest: { status: 'waiting' } })) === '' && togetherKey(tg({ addressRequest: { status: 'kept' } })) !== '', 'a waiting change keeps an order out of shipping together');

  if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
})();
