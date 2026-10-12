// Practice a shift: register rules. Run: npx tsx scripts/verify/practice-register.verify.ts
import * as R from '../../src/lib/practice/register';
let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` (${JSON.stringify(info)})`}`); if (!ok) fails++; };
const code = (k: string) => R.skuBy(k).code;
const until = (s: R.RegState, id: string) => {
  for (let i = 0; i < 4000 && s.cur?.c.id !== id; i++) { if (s.cur) { for (const it of s.cur.c.items) for (let k = 0; k < it.n; k++) R.scan(s, code(it.sku), 'usb'); R.pay(s); } R.advance(s, 0.5); }
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
  check('no mistakes', s.mistakes.length === 0); }

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

console.log('Pace and the review');
{ const s = R.newRegister(); R.advance(s, 0.5); R.advance(s, 60);
  check('the line builds while you’re slow', R.line(s).length >= 2);
  check('people waiting lose patience', Object.values(s.waiting).some((v) => v < 1)); }
{ const s = R.newRegister(); let guard = 0;
  while (!R.finished(s) && guard++ < 3000) { R.advance(s, 0.5); if (s.cur) { for (const it of s.cur.c.items) for (let k = 0; k < it.n; k++) R.scan(s, code(it.sku), 'usb'); R.pay(s); } }
  const rv = R.review(s);
  check('a whole shift runs to the end', rv.checkouts === 6, rv);
  check('scanning straight through still trips on the shelf price and the allergy', rv.mistakes.length === 2 && rv.stars === 2, rv.mistakes.map((m) => m.what));
  check('the review names a best moment', !!rv.best); }

console.log(fails ? `\n${fails} failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
