// Practice a shift: register rules. Run: npx tsx scripts/verify/practice-register.verify.ts
import * as R from '../../src/lib/practice/register';
import * as $ from '../../src/lib/practice/currency';
let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` (${JSON.stringify(info)})`}`); if (!ok) fails++; };
const code = (k: string) => R.skuBy(k).code;
/** Handle the call you're on the right way, start to finish, whatever kind it is. */
const solve = (s: R.RegState) => {
  const c = s.onCall!.call; const f = c.facts; R.act(s, c.outbound ? 'greetOut' : 'greet'); if (c.kind !== 'wrong' && c.kind !== 'sales') R.act(s, 'identify');
  const form = (keys: string[]) => { for (const k of keys) { R.act(s, `ask:${k === 'slot' ? 'when' : k}`); R.setField(s, k, f[k]); } };
  switch (c.kind) {
    case 'reschedule': case 'cancel': R.callFind(s, c.booking!); R.offerAnotherDay(s); R.callReschedule(s, c.prefers!); break;
    case 'price': R.act(s, `quote:${f.service}`); R.act(s, 'offerBook'); form(['service', 'slot', 'name', 'phone', 'email']); R.act(s, 'policy'); R.act(s, 'depositLink'); R.bookNew(s); break;
    case 'book': form(['service', 'slot', 'name', 'phone', 'email']); R.act(s, 'policy'); R.act(s, 'depositLink'); R.bookNew(s); break;
    case 'giftcard': form(['amount', 'recipient', 'recipientEmail']); R.act(s, 'payLink'); R.sendGiftCard(s); break;
    case 'directions': R.act(s, 'giveInfo'); R.act(s, 'textInfo'); R.act(s, 'confirmAppt'); break;
    case 'upset': R.act(s, 'ask:details'); R.act(s, 'apologize'); R.offerRepair(s, R.REPAIR_SLOTS[1]); break;
    case 'provider': R.act(s, 'withClient'); R.act(s, 'ask:details'); R.takeMessage(s, c.say.details, 'Ana'); break;
    case 'wrong': R.act(s, 'thisIsSalon'); break;
    case 'sales': R.act(s, 'takeInfo'); break;
  }
  if (R.actsFor(s).some((a) => a.id === 'readBack')) R.act(s, 'readBack'); R.act(s, 'anythingElse'); return R.endCall(s)!;
};
/** Do arrivals and phone calls the right way (so other tests can focus on checkouts). */
const deskRight = (s: R.RegState) => {
  if (s.ringing && !s.onCall) { R.answer(s); solve(s); }
  const vm = !s.onCall && s.voicemails.find((v) => !v.returned); if (vm) { R.callBack(s, vm.id); solve(s); }
  const c = s.cur?.c; if (c && R.isArrival(c)) { const b = R.bookingBy(s, c.booking)!; R.pickBooking(s, b.id); R.confirmDetails(s, { phone: b.phone, email: b.email, promo: false }, 'client');
    if (R.consentNeeded(s)) R.signConsent(s, 'client'); if ((c.late || 0) > R.GRACE_MIN) R.chooseLate(s, 'short', true); R.notifyProvider(s); R.finishArrival(s); return true; }
  return false;
};
const until = (s: R.RegState, id: string) => {
  for (let i = 0; i < 4000 && s.cur?.c.id !== id; i++) { if (s.cur?.c.id !== id && !deskRight(s) && s.cur) { for (const it of s.cur.c.items) for (let k = 0; k < it.n; k++) R.scan(s, code(it.sku), 'usb'); R.pay(s); } if (s.cur?.c.id !== id) R.advance(s, 0.5); }
  s.mistakes = []; s.streak = 0;
};

console.log('Barcodes');
check('every product has a valid 12-digit UPC-A', R.SKUS.every((s) => /^\d{12}$/.test(s.code) && R.upcCheck(s.code.slice(0, 11)) === s.code[11]));
check('codes are unique', new Set(R.SKUS.map((s) => s.code)).size === R.SKUS.length);
check('known check digit (036000291452)', R.upcCheck('03600029145') === '2');
check('UPC-A draws 95 modules with guards', (() => { const m = R.upcModules(code('cuticle')); return m.length === 95 && m.slice(0, 3).join('') === '101' && m.slice(45, 50).join('') === '01010' && m.slice(92).join('') === '101'; })());

check('accepts the 13-digit form some scanners send', R.skuByCode('0' + code('beardoil'))?.key === 'beardoil');
check('accepts a code without its check digit', R.skuByCode(code('beardoil').slice(0, 11))?.key === 'beardoil');
check('ignores stray characters', R.skuByCode(` ${code('vitc')}\n`)?.key === 'vitc');
console.log('A clean checkout');
{ const s = R.newRegister(); R.advance(s, 0.5);
  check('the first client comes up to the register', s.cur?.c.id === 'rosa' && s.cur.lines[0].kind === 'service');
  const r = R.scan(s, code('cuticle'), 'gun'); check('scanning adds the line', r.ok && R.live(s.cur!).length === 2);
  const p = R.pay(s)!; check('clean checkout, with a tip', p.clean && p.tip.amount > 0 && s.streak === 1, p);
  check('no mistakes (only coaching notes)', s.mistakes.every((m) => m.minor)); }

console.log('Label won’t read');
{ const s = R.newRegister(); until(s, 'theo');
  check('the gun can’t read it', R.scan(s, code('beardoil'), 'gun').kind === 'unreadable');
  check('typing the number works', R.scan(s, code('beardoil'), 'typed').ok);
  check('clean', R.pay(s)!.clean); }
{ const s = R.newRegister(); until(s, 'theo'); R.scan(s, code('beardoil'), 'gun'); R.pay(s);
  check('giving up and taking payment = an unpaid item, found later', s.mistakes.some((m) => m.who === 'Theo' && /not rung up/.test(m.what) && /unpaid/.test(m.later))); }
{ const s = R.newRegister(); until(s, 'theo');
  check('a real USB scanner reads the printed label', R.scan(s, code('beardoil'), 'usb').ok); }

console.log('Scanned twice');
{ const s = R.newRegister(); until(s, 'grace'); R.scan(s, code('serum2'), 'gun'); const r = R.scan(s, code('shampoo'), 'gun');
  check('the scanner double-reads the shampoo', r.lines?.length === 2);
  R.pay(s); check('missed it: a refund later', s.mistakes.some((m) => m.who === 'Grace' && /2 × Bond shampoo/.test(m.what) && /refund/.test(m.later)) && s.streak === 0); }
{ const s = R.newRegister(); until(s, 'grace'); R.scan(s, code('serum2'), 'gun'); const r = R.scan(s, code('shampoo'), 'gun');
  R.voidLine(s, r.lines![1].id, 'Scanned twice'); check('voiding the extra line makes it clean', R.pay(s)!.clean); }

console.log('Two of the same is not a double scan');
{ const s = R.newRegister(); until(s, 'marcus'); R.scan(s, code('beardoil'), 'gun'); R.pay(s);
  check('one of two scanned = one unpaid', s.mistakes.some((m) => m.who === 'Marcus' && /not rung up/.test(m.what))); }
{ const s = R.newRegister(); until(s, 'marcus'); R.scan(s, code('beardoil'), 'gun'); R.scan(s, code('beardoil'), 'gun');
  check('both scanned = clean', R.pay(s)!.clean); }

console.log('Shelf price');
{ const s = R.newRegister(); until(s, 'lena'); R.scan(s, code('vitc'), 'gun');
  const e = R.editPrice(s, s.cur!.lines[1].id); check('editing a price is blocked', !e.ok && s.mistakes.some((m) => m.minor));
  const d = R.askDiscount(s); check('the manager approves a $6 discount', d?.price === -6 && d.approvedBy === R.MANAGER);
  check('the line price never changed', s.cur!.lines[1].price === 45);
  const p = R.pay(s)!; check('clean, and the training note does not break the streak', p.clean && p.total >= 85 + 39); }
{ const s = R.newRegister(); until(s, 'lena'); R.scan(s, code('vitc'), 'gun'); R.pay(s);
  check('ignoring her = a 3-star review later', s.mistakes.some((m) => /3-star/.test(m.later))); }
{ const s = R.newRegister(); until(s, 'lena'); R.scan(s, code('vitc'), 'gun'); const m0 = s.cur!.mood; R.refuseClaim(s);
  check('refusing is allowed but she’s less happy', s.cur!.mood < m0 && R.pay(s)!.clean); }

console.log('Unreadable label + allergy (Priya)');
{ const s = R.newRegister(); until(s, 'priya');
  check('the gun can’t read it', R.scan(s, code('serum4'), 'gun').kind === 'unreadable');
  check('name lookup shows all three scalp serums', R.lookup('scalp serum').length === 3);
  R.addByName(s, 'serum2'); R.pay(s);
  check('guessing the size wrong = short and stock off', s.mistakes.some((m) => m.who === 'Priya' && /instead of/.test(m.what))); }
{ const s = R.newRegister(); until(s, 'priya'); const r = R.scan(s, code('serum4'), 'typed');
  check('typing the number raises the allergy flag', !!r.flag && /fragrance/.test(r.flag));
  R.suggestSafe(s, r.lines![0].id); const p = R.pay(s)!;
  check('suggesting the fragrance-free one = clean', p.clean, s.mistakes); }
{ const s = R.newRegister(); until(s, 'priya'); R.scan(s, code('serum4'), 'typed'); R.pay(s);
  check('ignoring the flag = a reaction call later', s.mistakes.some((m) => /reaction/.test(m.later))); }


console.log('Currencies');
check('dollars format as $61.99', $.fmt('USD', 6199) === '$61.99');
check('euros format as 61,99 € (non-breaking space)', $.fmt('EUR', 6199).replace(/\s/g, ' ') === '61,99 €');
check('pounds format as £61.99', $.fmt('GBP', 6199) === '£61.99');
check('Canadian cash rounds to 5 cents', $.cashRound('CAD', 6199) === 6200 && $.cashRound('CAD', 6197) === 6195 && $.cashRound('USD', 6199) === 6199);
check('euro notes get bigger with value', (() => { const n = $.CURRENCIES.EUR.notes; return n.every((x, i) => i === 0 || x.w <= n[i - 1].w); })());
check('dollar notes are all the same size', new Set($.CURRENCIES.USD.notes.map((n) => n.w)).size === 1);
check('pounds: 20p and 50p have 7 sides, £1 has 12', $.CURRENCIES.GBP.coins.find((c) => c.value === 50)?.sides === 7 && $.CURRENCIES.GBP.coins.find((c) => c.value === 100)?.sides === 12);
check('denomination labels', $.denomLabel('USD', 2000) === '$20' && $.denomLabel('EUR', 2000) === '20 €' && $.denomLabel('GBP', 50) === '50p' && $.denomLabel('EUR', 200) === '2€' && $.denomLabel('USD', 25) === '25¢');
check('fewest pieces of change', JSON.stringify($.makeChange('USD', 3102)) === JSON.stringify([2000, 1000, 100, 1, 1]));
check('a client with no note big enough hands two (GBP has no £100)', JSON.stringify($.clientCash('GBP', 6898, 'one')) === JSON.stringify([5000, 5000]));

console.log('Cash at the register');
for (const code of $.CODES) {
  const s = R.newRegister(code); until(s, 'theo'); R.scan(s, code === 'USD' ? R.skuBy('beardoil').code : R.skuBy('beardoil').code, 'typed');
  const due = R.cashDue(s), given = R.handOver(s), kept = R.keepChoice(s), right = $.sum(given) - due - kept;
  const change = $.makeChange(code, right, s.drawer)!;
  const r = R.payCash(s, $.sum(given), change)!;
  check(`${code}: Theo keeps ${$.fmt(code, kept)} as a tip and gets ${$.fmt(code, right)} back`, r.ok && (r as any).clean && kept === 300 && s.tipJar === 300, { due, given, kept, right });
}
{ const s = R.newRegister('CAD'); until(s, 'theo'); R.scan(s, R.skuBy('beardoil').code, 'typed');
  check('CAD: $61.99 is $62.00 in cash', R.cashDue(s) === 6200); }
{ const s = R.newRegister('USD'); until(s, 'theo'); R.scan(s, R.skuBy('beardoil').code, 'typed');
  check('tender buttons include what was handed over', R.tenderOptions(s).includes($.sum(R.handOver(s))));
  const right = $.sum(R.handOver(s)) - R.cashDue(s) - R.keepChoice(s);
  R.payCash(s, $.sum(R.handOver(s)), $.makeChange('USD', right - 100, s.drawer)!);
  check('a dollar too little: the client calls, the drawer is over', s.mistakes.some((m) => /noticed at home/.test(m.later) && /\$1\.00 over/.test(m.later))); }
{ const s = R.newRegister('USD'); until(s, 'theo'); R.scan(s, R.skuBy('beardoil').code, 'typed');
  const right = $.sum(R.handOver(s)) - R.cashDue(s) - R.keepChoice(s);
  R.payCash(s, $.sum(R.handOver(s)), $.makeChange('USD', right + 100, s.drawer)!);
  check('a dollar too much: the drawer is short', s.mistakes.some((m) => /\$1\.00 short at close/.test(m.later))); }
{ const s = R.newRegister('USD'); until(s, 'theo'); R.scan(s, R.skuBy('beardoil').code, 'typed');
  const right = $.sum(R.handOver(s)) - R.cashDue(s) - R.keepChoice(s);
  const r = R.payCash(s, 10000, $.makeChange('USD', right, s.drawer)!);
  check('wrong amount typed but right change = training moment only', !!r && (r as any).clean && s.mistakes.some((m) => m.minor && /Entered/.test(m.what))); }
{ const s = R.newRegister('USD'); until(s, 'theo'); R.scan(s, R.skuBy('beardoil').code, 'typed'); s.drawer[100] = 0; s.drawer[1] = 0;
  const r = R.payCash(s, 7000, [100]); check('can’t hand over what isn’t in the drawer', !!r && !r.ok); }
console.log('Closing the drawer');
{ const s = R.newRegister('EUR'); let guard = 0;
  while (!R.finished(s) && guard++ < 3000) { R.advance(s, 0.5); if (deskRight(s)) continue; if (s.cur) { for (const it of s.cur.c.items) for (let k = 0; k < it.n; k++) R.scan(s, R.skuBy(it.sku).code, 'usb');
    if (R.paysCash(s.cur.c)) { const right = $.sum(R.handOver(s)) - R.cashDue(s) - R.keepChoice(s); R.payCash(s, $.sum(R.handOver(s)), $.makeChange('EUR', right, s.drawer)!); } else R.pay(s); } }
  const c = R.closeOut(s, { ...s.drawer });
  check('right change all day = the drawer balances', c.overShort === 0 && c.countOff === 0, c);
  check('cash sales are in the drawer, tips are not', c.actual === s.float + s.cashSales);
  const s2 = R.newRegister('USD'); const wrong = { ...s2.drawer, 100: s2.drawer[100] - 1 }; const c2 = R.closeOut(s2, wrong);
  check('miscounting the drawer is caught', c2.countOff === -100 && c2.off.includes(100)); }


console.log('Greeting people');
{ const s = R.newRegister(); R.advance(s, 0.5); const o = R.greetOptions(s.cur!.c);
  check('three greetings, one great', o.length === 3 && o.filter((x) => x.q === 'great').length === 1 && /Welcome back, Rosa/.test(o.find((x) => x.q === 'great')!.text));
  const m = s.cur!.mood; R.greet(s, 'great'); check('a warm greeting lifts the mood and scores', s.cur!.mood > m && s.points === 15); }
{ const s = R.newRegister(); R.advance(s, 0.5); R.greet(s, 'poor'); check('“Next!” to a regular is a training moment', s.mistakes.some((m) => m.minor && /Next!/.test(m.what))); }

console.log('A first-time client (Ava)');
{ const s = R.newRegister(); until(s, 'ava');
  check('she’s new and greeted as new', s.cur!.c.kind === 'new' && /first time/.test(R.greetOptions(s.cur!.c).find((x) => x.q === 'great')!.text));
  check('she reads out her number', /919, 555, 0142/.test(R.askDetail(s, 'phone')!));
  R.askDetail(s, 'email'); R.saveContact(s, { phone: '(919) 555-0142', email: ' Ava.Reyes@mailbox.com ', promo: false });
  check('details saved right = clean', !!R.pay(s)?.clean, s.mistakes); }
{ const s = R.newRegister(); until(s, 'ava'); R.saveContact(s, { phone: '9195550124', email: 'ava.reyes@mailbox.com', promo: true }); R.pay(s);
  check('a swapped digit: reminder goes to a stranger', s.mistakes.some((m) => /stranger/.test(m.later)));
  check('promo texts she said no to: complaint', s.mistakes.some((m) => /promo/.test(m.what))); }
{ const s = R.newRegister(); until(s, 'ava'); R.askDetail(s, 'phone'); const m = s.cur!.mood; R.askDetail(s, 'phone');
  check('asking again is fine but costs a little patience', s.cur!.mood < m && /^Sure\./.test(s.cur!.said)); }

console.log('A group splitting the bill');
const scanAllUsb = (s: R.RegState) => { for (const it of s.cur!.c.items) for (let k = 0; k < it.n; k++) R.scan(s, code(it.sku), 'usb'); };
for (const cc of ['USD', 'CAD'] as const) { const s = R.newRegister(cc); until(s, 'party'); scanAllUsb(s);
  check(`${cc}: three service lines`, s.cur!.lines.filter((l) => l.kind === 'service').length === 3);
  const parts = R.setSplit(s, 'even')!; const T = $.cents(R.totalOf(s.cur!));
  check(`${cc}: split evenly adds up exactly`, $.sum(parts.map((p) => p.amount)) === T && parts.length === 3, parts);
  check(`${cc}: Maya pays first by card`, R.payerName(s) === 'Maya' && R.prefers(s) === 'card');
  const r1 = R.pay(s)!; check(`${cc}: first part paid, ticket stays open`, r1.partial === true && !!s.cur && R.payerName(s) === 'Jo');
  check(`${cc}: Jo prefers cash`, R.prefers(s) === 'cash');
  const right = $.sum(R.handOver(s)) - R.cashDue(s) - R.keepChoice(s);
  const r2 = R.payCash(s, $.sum(R.handOver(s)), $.makeChange(cc, right, s.drawer)!)!; check(`${cc}: Jo pays cash`, r2.ok && r2.partial === true && R.payerName(s) === 'Sam');
  const r3 = R.pay(s)!; check(`${cc}: last part closes the ticket, clean`, r3.partial === false && (r3 as any).clean && !s.cur, s.mistakes);
  check(`${cc}: the receipt shows three payments`, s.lastReceipt?.tenders.length === 3 && s.lastReceipt.choice === 'print'); }
{ const s = R.newRegister(); until(s, 'party'); scanAllUsb(s); const parts = R.setSplit(s, 'own')!;
  check('each pays their own: retail goes with Maya', parts[0].amount === $.cents(45 + 18) && parts[1].amount === 5500 && parts[2].amount === 7500, parts);
  R.pay(s); R.pay(s); R.pay(s); check('wrong split: they had to redo it', s.mistakes.some((m) => /asked to split evenly/.test(m.what))); }

console.log('Card or cash for anyone');
{ const s = R.newRegister(); R.advance(s, 0.5); R.scan(s, code('cuticle'), 'usb');
  check('Rosa prefers card', R.prefers(s) === 'card');
  const right = $.sum(R.handOver(s)) - R.cashDue(s) - R.keepChoice(s);
  const r = R.payCash(s, $.sum(R.handOver(s)), $.makeChange('USD', right, s.drawer)!)!;
  check('but can pay cash, clean', r.ok && r.partial === false && (r as any).clean);
  check('receipt: she didn’t want one', s.lastReceipt?.choice === 'none' && s.lastReceipt.tenders[0].method === 'cash'); }


console.log('Rebooking');
{ const s = R.newRegister(); R.advance(s, 0.5); const o = R.rebookOptions(s).map((x) => x.weeks);
  check('presets 2, 4, 6, 8 plus her usual 3 weeks', JSON.stringify(o) === JSON.stringify([2, 3, 4, 6, 8]), o);
  check('Rosa picks her usual 3 weeks', R.rebookAnswer(s) === 3);
  const slot = R.rebook(s, 3); check('booked with Ana on Sat, Nov 7', !!slot && /Nov 7/.test(slot) && /Ana/.test(slot), slot);
  check('counts as a rebook', s.sales.rebooks === 1); }
{ const s = R.newRegister(); until(s, 'party'); check('the bridal party would rather book later', R.rebookAnswer(s) === 'no'); }

console.log('Memberships and packages');
{ const s = R.newRegister(); R.advance(s, 0.5);
  check('Nail Club fits Rosa’s manicure and is listed first', R.offersFor(s)[0].key === 'nailclub');
  check('she says yes to Nail Club', R.offerAnswer(s, 'nailclub') === 'yes');
  R.offer(s, 'nailclub', 'yes'); check('it goes on the ticket', s.cur!.lines.some((l) => l.kind === 'membership' && l.price === 39) && s.sales.members === 1);
  const m = s.cur!.mood; R.offer(s, 'facial5', R.offerAnswer(s, 'facial5')); check('a second offer that doesn’t fit costs goodwill', s.cur!.mood < m - 0.1); }
{ const s = R.newRegister(); until(s, 'lena'); R.offer(s, 'facial5', R.offerAnswer(s, 'facial5')); check('Lena buys the facial package', s.sales.packages === 1 && s.cur!.lines.some((l) => l.kind === 'package')); }

console.log('Card slips');
{ const s = R.newRegister(); until(s, 'lena'); R.scan(s, code('vitc'), 'usb');
  check('Lena’s first card is declined', R.cardAttempt(s, 'tap') === 'declined');
  R.declineReply(s, 'great'); check('the kind reply scores', s.points >= 20);
  check('her other card goes through', R.cardAttempt(s, 'tap', 'another') === 'approved'); }
{ const s = R.newRegister(); until(s, 'lena'); R.cardAttempt(s, 'tap'); R.declineReply(s, 'loud');
  check('saying “declined” out loud is a real mistake', s.mistakes.some((m) => !m.minor && /out loud/.test(m.what)));
  R.cardAttempt(s, 'tap'); check('running the same card again is a training moment', s.mistakes.some((m) => m.minor && /same declined card/.test(m.what))); }
{ const s = R.newRegister(); until(s, 'grace');
  check('Grace’s chip fails once', R.cardAttempt(s, 'insert') === 'chip-error' && R.cardAttempt(s, 'insert') === 'approved'); }
{ const s = R.newRegister(); until(s, 'priya');
  check('Priya: the reader is offline', R.cardAttempt(s, 'tap') === 'offline');
  check('card on file works with her OK', R.cardAttempt(s, 'onfile') === 'approved');
  R.reconnect(s); check('reconnecting works too', R.cardAttempt(s, 'tap') === 'approved');
  R.writeDownCard(s); check('writing the number down is a security mistake', s.mistakes.some((m) => /on paper/.test(m.what) && !m.minor)); }
{ const s = R.newRegister(); R.advance(s, 0.5); R.setTip(s, 25); const r = R.pay(s)!;
  check('a tip chosen on the client screen is used', Math.abs(r.tip.amount - 11) < 0.01, r.tip); }


console.log('Checking guests in');
const arrive = (id: string) => { const s = R.newRegister(); until(s, id); return s; };
{ const s = arrive('nina');
  check('Nina is an arrival with no ticket', R.isArrival(s.cur!.c) && s.cur!.lines.length === 0);
  check('searching “Nina” finds both Ninas', R.searchBookings(s, 'nina').length === 2);
  check('searching her number finds only her', R.searchBookings(s, '0178').map((b) => b.name).join() === 'Nina Patel');
  R.pickBooking(s, 'b-nina-patel'); check('her balayage needs a consent form', R.consentNeeded(s));
  R.confirmDetails(s, { phone: '919-555-0178', email: 'nina.patel@mailbox.com', promo: false }, 'client'); R.signConsent(s, 'client'); R.notifyProvider(s);
  const r = R.finishArrival(s)!; check('done right = clean, booking arrived, consent on file', r.clean && R.bookingBy(s, 'b-nina-patel')!.status === 'arrived' && R.bookingBy(s, 'b-nina-patel')!.consentOnFile, s.mistakes); }
{ const s = arrive('nina'); R.pickBooking(s, 'b-nina-park'); R.notifyProvider(s); R.finishArrival(s);
  check('the wrong Nina: wrong notes, the other provider waits', s.mistakes.some((m) => /instead of Nina Patel/.test(m.what)));
  check('and no consent form for the color', s.mistakes.some((m) => /consent/.test(m.what))); }
{ const s = arrive('nina'); R.pickBooking(s, 'b-nina-patel'); R.confirmDetails(s, { phone: '9195550178', email: 'nina.patel@mailbox.com', promo: false }, 'desk'); R.signConsent(s, 'client'); R.finishArrival(s);
  check('forgetting to tell Mei: she sat in the lounge', s.mistakes.some((m) => /know Nina was here/.test(m.what))); }
{ const s = arrive('jamal'); R.pickBooking(s, 'b-jamal'); R.signConsent(s, 'client'); R.notifyProvider(s); R.finishArrival(s);
  check('a first-timer without details is a real mistake', s.mistakes.some((m) => !m.minor && /contact details/.test(m.what))); }
{ const s = arrive('jamal'); R.pickBooking(s, 'b-jamal'); R.confirmDetails(s, { phone: '9195550161', email: 'jamal.wright@mailbox.com', promo: true }, 'desk'); R.signConsent(s, 'client'); R.notifyProvider(s); R.finishArrival(s);
  check('promo texts he didn’t ask for', s.mistakes.some((m) => /promo/.test(m.what))); }
{ const s = arrive('olivia'); check('Olivia is 15 minutes late (past the 10-minute grace)', R.minutesLate(s) === 15);
  R.pickBooking(s, 'b-olivia'); R.confirmDetails(s, { phone: '9195550109', email: 'olivia.chen@mailbox.com', promo: false }, 'client'); R.chooseLate(s, 'short', true); R.notifyProvider(s);
  check('a shorter style with her courtesy = clean', R.finishArrival(s)!.clean && R.bookingBy(s, 'b-olivia')!.courtesyLeft === 0, s.mistakes); }
{ const s = arrive('olivia'); R.pickBooking(s, 'b-olivia'); R.chooseLate(s, 'full', false); R.notifyProvider(s); R.finishArrival(s);
  check('the full service late: the next guest waits', s.mistakes.some((m) => /full blowout/.test(m.what)));
  check('a late fee despite her courtesy: coached', s.mistakes.some((m) => m.minor && /late fee/.test(m.what))); }

console.log('The phone');
const ring = (id: string, mode: R.PhoneMode = 'full') => { const s = R.newRegister('USD', mode); for (let i = 0; i < 4000 && s.ringing?.call.id !== id; i++) { if (s.ringing) { R.answer(s); solve(s); } if (!deskRight(s) && s.cur) { for (const it of s.cur.c.items) for (let k = 0; k < it.n; k++) R.scan(s, code(it.sku), 'usb'); R.pay(s); } R.advance(s, 0.5); } return s; };
{ const s = ring('call-dana'); check('the phone rings', !!s.ringing);
  R.answer(s); check('answering starts the call', !!s.onCall && !s.ringing);
  check('two Danas on Thursday', R.searchBookings(s, 'dana').length === 2);
  R.callFind(s, 'b-dana'); R.offerAnotherDay(s); R.callReschedule(s, 'Sat 10:00 AM'); const r = R.endCall(s)!;
  check('moved to Saturday morning, clean', r.clean && R.bookingBy(s, 'b-dana')!.movedTo === 'Sat 10:00 AM'); }
{ const s = ring('call-dana'); R.answer(s); R.callFind(s, 'b-dana-li'); R.callReschedule(s, 'Tue 4:30 PM'); R.endCall(s);
  check('moving the wrong Dana is a real mistake', s.mistakes.some((m) => /Dana Li’s booking instead/.test(m.what))); }
{ const s = ring('call-dana'); for (let i = 0; i < 80; i++) R.advance(s, 0.5);
  check('a call that rings out goes to voicemail', s.ringing?.call.id !== 'call-dana' && s.mistakes.some((m) => m.minor && /voicemail/.test(m.what)) && s.voicemails.some((v) => v.call.name === 'Dana Lee'));
  const vm = s.voicemails.find((v) => v.call.name === 'Dana Lee')!; R.callBack(s, vm.id); check('calling back starts an outbound call', !!s.onCall?.call.outbound && s.onCall.said === 'Hello?');
  const r = solve(s); check('and the callback can still be handled clean', r.clean, s.mistakes.slice(-3)); }
{ const s = ring('call-kim'); R.answer(s); R.callFind(s, 'b-kim'); R.offerAnotherDay(s);
  check('offered another day, Kim would rather move than cancel', /Saturday|Sat/.test(s.onCall!.said)); R.callReschedule(s, 'Sat 1:00 PM'); check('kept: clean', R.endCall(s)!.clean); }
{ const s = ring('call-kim'); R.answer(s); R.callFind(s, 'b-kim'); R.callCancel(s, true); R.endCall(s);
  check('cancel with a fee despite her courtesy = real mistake', s.mistakes.some((m) => !m.minor && /late-cancel fee/.test(m.what)));
  check('and not offering another day is coached', s.mistakes.some((m) => m.minor && /without offering another day/.test(m.what))); }
{ const s = ring('call-kim'); R.answer(s); R.callFind(s, 'b-kim'); R.offerAnotherDay(s); R.callCancel(s, false);
  check('cancel using her courtesy = no fee', R.endCall(s)!.clean && R.bookingBy(s, 'b-kim')!.courtesyLeft === 0 && R.bookingBy(s, 'b-kim')!.feeCharged === false); }
{ const s = ring('call-kim'); R.answer(s); R.endCall(s); check('hanging up without helping', s.mistakes.some((m) => /Hung up/.test(m.what))); }

console.log('Pace and the review');
{ const s = R.newRegister(); R.advance(s, 0.5); R.advance(s, 60);
  check('the line builds while you’re slow', R.line(s).length >= 2);
  check('people waiting lose patience', Object.values(s.waiting).some((v) => v < 1)); }
{ const s = R.newRegister(); let guard = 0;
  while (!R.finished(s) && guard++ < 3000) { R.advance(s, 0.5); if (deskRight(s)) continue; if (s.cur) { for (const it of s.cur.c.items) for (let k = 0; k < it.n; k++) R.scan(s, code(it.sku), 'usb'); R.pay(s); } }
  const rv = R.review(s);
  check('a whole shift runs to the end (9 checkouts, 3 check-ins, 5 calls, 1 voicemail callback)', rv.checkouts === 18, rv.checkouts);
  check('every call got a review with a perfect etiquette checklist', s.reviews.length === 6 && s.reviews.every((x) => x.score === 100), s.reviews.map((x) => [x.who, x.score, x.checklist.filter((i) => !i.ok).map((i) => i.label)]));
  check('scanning straight through trips on new-client details, the split, the shelf price and the allergy', rv.mistakes.filter((m) => !m.minor).length === 4 && rv.stars === 2, rv.mistakes.map((m) => m.what));
  check('and coaches on every missed rebook and membership', rv.mistakes.filter((m) => /next visit/.test(m.what)).length === 7 && rv.mistakes.filter((m) => /Didn’t mention/.test(m.what)).length === 3);
  check('the review names a best moment', !!rv.best); }

console.log('Hold');
{ const s = ring('call-kim'); const desk = !!s.cur; R.answer(s, false); check('picking up without a word to the guest at the desk is a coaching note', !desk || s.mistakes.some((m) => m.minor && /without a word/.test(m.what)));
  R.act(s, 'greet'); const before = s.mistakes.length; R.holdCall(s, true); check('asking first, then holding, is fine', !s.onCall && s.held.length === 1 && s.mistakes.length === before);
  for (let i = 0; i < 60; i++) R.advance(s, 0.5); R.resumeCall(s); check('a short hold, then back on the line', !!s.onCall && !s.onCall.hold && s.onCall.holdTotal >= 29 && /here/.test(s.onCall.said));
  R.act(s, 'identify'); R.callFind(s, 'b-kim'); R.offerAnotherDay(s); R.callReschedule(s, 'Sat 1:00 PM'); const r = R.endCall(s); check('the call still ends clean', !!r?.clean); }
{ const s = ring('call-kim'); R.answer(s); R.holdCall(s, false); check('holding without asking is a coaching note', s.mistakes.some((m) => m.minor && /without asking/.test(m.what))); }
{ const s = ring('call-dana'); R.answer(s); R.holdCall(s, true); for (let i = 0; i < 2 * (R.HOLD_LIMIT + 2); i++) R.advance(s, 0.5);
  check('a caller left on hold too long hangs up', !s.onCall && !s.held.length && s.mistakes.some((m) => /until they hung up/.test(m.what)) && s.done.some((d) => /Dana/.test(d.who) && !d.clean)); }

console.log('Two lines');
{ const s = ring('call-aisha', 'phones'); check('phone practice: two guests at the desk, ten calls, two voicemails', s.voicemails.filter((v) => v.overnight).length === 2);
  // Dana is on line 1 when Aisha rings on line 2.
  const s2 = R.newRegister('USD', 'phones'); let i = 0; while (!(s2.ringing?.call.id === 'call-dana') && i++ < 400) { R.advance(s2, 0.5); if (s2.ringing && s2.ringing.call.id !== 'call-dana' && !s2.onCall) { R.answer(s2); solve(s2); } }
  R.answer(s2); R.act(s2, 'greet'); for (let j = 0; j < 40 && !s2.ringing; j++) R.advance(s2, 0.5);
  check('line 2 rings while you’re on line 1', s2.ringing?.call.id === 'call-aisha' && !!s2.onCall);
  check('you can’t answer line 2 without holding line 1', R.answer(s2) === null);
  R.holdCall(s2, true); const a = R.answer(s2); check('hold Dana, answer Aisha on line 2', !!a && a.line === 2 && s2.held[0]?.call.id === 'call-dana');
  solve(s2); check('back to Dana', R.resumeCall(s2, 'call-dana') && s2.onCall?.call.id === 'call-dana' && s2.onCall.line === 1); }
{ const s = ring('call-dana'); R.answer(s); R.holdCall(s, true); for (let j = 0; j < 2 * 45; j++) R.advance(s, 0.5); R.checkBack(s, 'call-dana');
  for (let j = 0; j < 2 * 45; j++) R.advance(s, 0.5); check('checking back keeps a caller on hold', s.held.length === 1); }

console.log('Every kind of call');
for (const id of ['call-ben', 'call-aisha', 'call-carmen', 'call-tasha', 'call-sofia', 'call-nina', 'call-wrong', 'call-casey']) {
  const s = ring(id, 'phones'); s.mistakes = []; R.answer(s); const r = solve(s); check(`${id.slice(5)}: handled right = clean, perfect etiquette`, r.clean && r.review.score === 100 && !s.mistakes.length, [s.mistakes.map((m) => m.what), r.review.checklist]); }
{ const s = ring('call-aisha', 'phones'); R.answer(s); R.act(s, 'greet'); R.act(s, 'cardAloud'); check('taking a card number out loud is a real mistake', s.mistakes.some((m) => !m.minor && /card number/.test(m.what))); }
{ const s = ring('call-aisha', 'phones'); R.answer(s); R.act(s, 'greet'); for (const [k, v] of Object.entries({ service: 'gel', slot: 'Wed 11:00 AM', name: 'Aisha Grant', phone: '9195550109', email: 'aisha.grant@mailbox.com' })) R.setField(s, k, v);
  R.act(s, 'depositLink'); R.bookNew(s); check('a mistyped phone number is caught', s.mistakes.some((m) => /wrong phone number/.test(m.what)));
  check('and the booking exists for check-in later', R.bookingBy(s, 'b-new-call-aisha')?.deposit === R.DEPOSIT); }
{ const s = ring('call-aisha', 'phones'); R.answer(s); R.act(s, 'greet'); for (const [k, v] of Object.entries({ service: 'gel', slot: 'Wed 11:00 AM', name: 'Aisha Grant', phone: '9195550190', email: 'aisha.grant@mailbox.com' })) R.setField(s, k, v);
  R.bookNew(s); check('no deposit = mistake; no policy = coaching', s.mistakes.some((m) => !m.minor && /deposit/.test(m.what)) && s.mistakes.some((m) => m.minor && /24-hour/.test(m.what))); }
{ const s = ring('call-tasha', 'phones'); R.answer(s); R.act(s, 'greet'); R.act(s, 'blame'); R.offerRepair(s, R.REPAIR_SLOTS[1]);
  check('blaming her = real mistake, and she wants a manager', s.mistakes.some((m) => !m.minor && /picked at/.test(m.what)) && !s.onCall!.outcome && !!s.onCall!.did.wantsManager);
  R.transfer(s, R.MANAGER, true); const r = R.endCall(s)!; check('a warm transfer to the manager resolves it', s.reviews.at(-1)!.result.includes('warm') && !s.mistakes.some((m) => /unsolved/.test(m.what)), r); }
{ const s = ring('call-tasha', 'phones'); R.answer(s); R.act(s, 'greet'); R.offerRepair(s, R.REPAIR_SLOTS[0]); check('offering a fix before apologizing: she asks for a manager', !s.onCall!.outcome && /manager/.test(s.onCall!.said)); }
{ const s = ring('call-sofia', 'phones'); R.answer(s); R.act(s, 'greet'); R.act(s, 'promiseTime'); check('promising a callback time is coached (house rule)', s.mistakes.some((m) => m.minor && /callback at a set time/.test(m.what))); }
{ const s = ring('call-sofia', 'phones'); R.answer(s); R.act(s, 'greet'); R.transfer(s, 'Ana', false); check('putting a caller through to a provider mid-service is coached', s.mistakes.some((m) => m.minor && /middle of a service/.test(m.what))); }
{ const s = ring('call-casey', 'phones'); R.answer(s); R.act(s, 'greet'); R.act(s, 'giveCell'); check('giving out the owner’s cell = real mistake', s.mistakes.some((m) => !m.minor && /personal cell/.test(m.what))); }
{ const s = ring('call-ben', 'phones'); R.answer(s); R.act(s, 'greet'); R.act(s, 'quote:silk'); R.endCall(s);
  check('wrong price, no offer to book: coached and caught', s.mistakes.some((m) => /price of a Silk press/.test(m.what)) && s.mistakes.some((m) => /Didn’t give Ben the price/.test(m.what)) && s.mistakes.some((m) => /offer to book/.test(m.what))); }
{ const s = ring('call-ben', 'phones'); R.answer(s); const t = R.talkCall(s, 'Thank you for calling Opal Salon, this is Jess, how can I help?'); check('talking: the greeting is understood and he says why he called', s.onCall!.did.greeted === 'great' && /gel manicure/.test(t.reply), t);
  const t2 = R.talkCall(s, 'A gel manicure is $45. Would you like me to book that for you?'); check('talking: saying the price and offering to book both count', s.onCall!.did.quoted === 'gel' && !!s.onCall!.did.offeredBook, t2); }
{ const s = R.newRegister('USD', 'phones'); R.phoneWrapUp(s); check('voicemails nobody returned are caught at the end of the shift', s.mistakes.filter((m) => /call .* back/.test(m.what)).length === 2); }

console.log('Pacing');
{ const s = R.newRegister('USD', 'full', { pace: 'relaxed' }); R.advance(s, 0.5); const first = s.cur!.c.id;
  for (let i = 0; i < 2 * 200; i++) R.advance(s, 0.5);   // stand at the desk with the first client for 200 seconds
  check('relaxed: nobody new walks in while you’re with a client', R.line(s).length === 0 && s.cur?.c.id === first, R.line(s).map((c) => c.id));
  const rang = s.reviews.length + (s.ringing ? 1 : 0) + s.voicemails.filter((v) => !v.overnight).length;
  check('relaxed: the phone rings at most once during a checkout (the hold lesson)', rang <= 1, rang);
  check('relaxed: a ringing phone waits a full minute before voicemail', R.ringLimit(s) === 60 && R.holdLimit(s) === 180); }
{ const s = R.newRegister('USD', 'full', { pace: 'normal' }); R.advance(s, 0.5); for (let i = 0; i < 2 * 120; i++) R.advance(s, 0.5);
  check('normal: the line still builds when you’re slow', R.line(s).length >= 3); }
{ const s = R.newRegister('USD', 'full', { pace: 'relaxed', calls: 'off' }); check('calls off: no calls, no voicemails', s.calls.length === 0 && s.voicemails.length === 0); }
{ const s = R.newRegister('USD', 'full', { calls: 'few' }); check('a few calls: two', s.calls.length === 2); }
{ const s = R.newRegister('USD', 'drill', { client: 'grace' }); R.advance(s, 0.5);
  check('drill: one client, no phone, relaxed', s.cur?.c.id === 'grace' && s.queue.length === 0 && s.calls.length === 0 && s.voicemails.length === 0 && s.pace === 'relaxed');
  for (let i = 0; i < 2 * 600; i++) R.advance(s, 0.5); check('drill: she waits as long as you need', s.cur!.mood > 0.2, s.cur!.mood); }

{ const s = R.newRegister('USD', 'drill', { client: 'dani' }); R.advance(s, 0.5);
  check('Dani: the studio’s own products are on her counter, with photos', s.cur!.c.items.every((i) => !!R.skuBy(i.sku).img && R.skuBy(i.sku).brand === 'Opal'));
  const r1 = R.scan(s, code('bitball'), 'gun'); check('the scratched sticker won’t scan with the gun', !r1.ok && r1.kind === 'unreadable');
  check('looking up “drill bit” shows both shapes', R.lookup('drill bit').length === 2);
  R.addByName(s, 'bitbarrel'); R.scan(s, code('nipper'), 'gun'); R.pay(s);
  check('ringing up the barrel instead of the ball is caught in the review', s.mistakes.some((m) => /barrel\) instead of .*ball/.test(m.what) && /wrong item/.test(m.later)), s.mistakes.map((m) => m.what)); }
{ const s = R.newRegister('USD', 'drill', { client: 'dani' }); R.advance(s, 0.5); R.scan(s, code('bitball'), 'typed'); R.scan(s, code('nipper'), 'gun'); R.pay(s);
  check('typing the number under the barcode rings up the right bit', !s.mistakes.some((m) => /instead of|not rung up/.test(m.what)) && R.totalOf(s.cur || ({ lines: [] } as any)) >= 0, s.mistakes.map((m) => m.what)); }

console.log(fails ? `\n${fails} failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
