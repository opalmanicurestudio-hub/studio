// Checks row 15, part 3b: the customer sees their return, and where it is, on their order page (lib/return-view,
// api/retail/order-status, the order page).
//   - three steps: on its way back (or to be brought in), the shop has it and checks it, and how it was put right;
//     closed with the shop's note;
//   - only what's theirs: no team names, the label only with their pass, a gift recipient's exchange kept apart.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/customer-return.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const V = await import('../../src/lib/return-view');
  const raw = { id: 'r1', status: 'open', resolution: 'refund', openedBy: 'Customer — Jordan Tate', openedAt: '2026-10-28T15:00:00Z', lines: [{ name: 'Mini Gel Lamp', qty: 1, reason: 'defective', disposition: null }], refundCents: 4800, labelUrl: 'https://labels.example/r1.pdf', labelCarrier: 'USPS', labelCostCents: 812 };
  const pub = V.publicReturn(raw, true);
  check('what a customer sees of a return: items, where it is and the money, never who on the team did what', pub.lines[0].name === 'Mini Gel Lamp' && pub.refundCents === 4800 && pub.labelUrl === 'https://labels.example/r1.pdf' && !JSON.stringify(pub).includes('Jordan') && !('labelCostCents' in pub) && !JSON.stringify(pub).includes('defective'));
  check('…the label, and the shop’s note on a closed one, only with their pass', V.publicReturn(raw, false).labelUrl === null && V.publicReturn(raw, false).hasLabel === true && V.publicReturn({ ...raw, status: 'cancelled', closedNote: 'Call Jo' }, false).closedNote === null && V.publicReturn({ ...raw, status: 'cancelled', closedNote: 'Kept it' }, true).closedNote === 'Kept it');
  check('…without their pass, a ready label says it was emailed (never a button they can’t press)', /was emailed to you/.test(V.customerReturnStatus(V.publicReturn(raw, false), 'ship').line));
  check('…return shipping that comes off is said before they send it', /Return shipping of \$8\.12 comes off your refund/.test(V.customerReturnStatus(V.publicReturn({ ...raw, labelDeductCents: 812 }, true), 'ship').line));
  check('a return the shop started with them at the counter never promises a label', V.customerReturnStatus(V.publicReturn({ ...raw, labelUrl: null, openedBy: 'Kai Park' }, true), 'ship').label === 'Bring it by');
  const day = (iso: string) => iso.slice(5, 10);
  let v = V.customerReturnStatus(pub, 'ship', day);
  check('by post, not back yet: send it back with the label, the first step under way', v.title === 'Return: Mini Gel Lamp' && v.label === 'Send it back' && /prepaid label is ready/.test(v.line) && v.steps.map((s) => s.label).join('|') === 'On its way back to us|We have it and check it|Refunded' && v.steps[0].now && !v.steps[0].done && v.sub === 'Started 10-28 · a refund to how you paid');
  v = V.customerReturnStatus({ ...pub, hasLabel: false, labelFailed: true }, 'ship', day);
  check('…a label that couldn’t be made says the shop will email it', /couldn’t make your return label/.test(v.line));
  v = V.customerReturnStatus(V.publicReturn({ ...raw, labelUrl: null }, true), 'pickup', day);
  check('a pickup order: bring it to the shop', v.label === 'Bring it by' && v.steps[0].label === 'Bring it to the shop' && /Bring the items to the shop/.test(v.line));
  v = V.customerReturnStatus({ ...pub, status: 'received' }, 'ship', day);
  check('the shop has it: checking it, the second step under way, and what happens next', v.label === 'We have it and are checking it' && v.steps[0].done && v.steps[1].now && /your refund is sent/.test(v.line));
  v = V.customerReturnStatus(V.publicReturn({ ...raw, status: 'resolved', refundNetCents: 4320, restockingFeeCents: 480 }, true), 'ship', day);
  v = V.customerReturnStatus(V.publicReturn({ ...raw, status: 'resolved', refundNetCents: 4320 }, true, { refundWaiting: true }), 'ship', day);
  check('a refund approved but not sent yet is never called Refunded', v.label === 'Refund approved' && v.steps[2].now && !v.steps[2].done && /We’re sending your \$43\.20 refund/.test(v.line), v);
  check('…a store credit capped at what was left says so, and one with nothing left says that', /The other \$10\.00 couldn’t be added/.test(V.customerReturnStatus(V.publicReturn({ ...raw, status: 'resolved', resolution: 'store_credit', creditNetCents: 3800, creditCappedCents: 1000 }, true), 'ship').line) && /No store credit was added/.test(V.customerReturnStatus(V.publicReturn({ ...raw, status: 'resolved', resolution: 'store_credit', creditNetCents: 0 }, true), 'ship').line));
  v = V.customerReturnStatus(V.publicReturn({ ...raw, status: 'resolved', refundNetCents: 4320, restockingFeeCents: 480 }, true), 'ship', day);
  check('refunded: the amount after any fee, and the fee said plainly', v.label === 'Refunded' && v.tone === 'ok' && v.steps.every((s) => s.done) && /^\$43\.20 back to how you paid/.test(v.line) && /\$4\.80 restocking fee/.test(v.line));
  v = V.customerReturnStatus(V.publicReturn({ ...raw, status: 'resolved', resolution: 'store_credit', creditNetCents: 4800 }, true), 'ship', day);
  check('store credit: the amount, ready at checkout', v.label === 'Store credit issued' && /^\$48\.00 store credit, ready to use at checkout/.test(v.line));
  v = V.customerReturnStatus(V.publicReturn({ ...raw, status: 'resolved', resolution: 'replacement' }, true), 'pickup', day);
  check('a replacement: another on its way (or being got ready to collect)', v.label === 'Another on its way' && /getting another ready/.test(v.line));
  v = V.customerReturnStatus(V.publicReturn({ ...raw, status: 'cancelled', closedNote: 'You told us you’re keeping it.' }, true), 'ship', day);
  check('closed: the shop’s note, and no steps', v.label === 'Closed' && v.line === 'You told us you’re keeping it.' && v.steps.length === 0 && v.tone === 'no');
  check('newest first, closed ones last', V.sortReturns([{ id: 'a', status: 'cancelled', openedAt: '2026-10-30' }, { id: 'b', status: 'open', openedAt: '2026-10-20' }, { id: 'c', status: 'resolved', openedAt: '2026-10-25' }]).map((r) => r.id).join() === 'c,b,a');

  const os = src('src/app/api/retail/order-status/route.ts');
  check('the order page is sent the order’s returns, the label only with their pass, a gift recipient’s exchange kept apart', /\.filter\(\(r: any\) => !r\.giftRecipient && r\.isGiftReturn !== true\)/.test(os) && /publicReturn\(r, passOk, \{ refundWaiting: \(Number\(order\.pendingRefundCents\) \|\| 0\) > 0 \}\)/.test(os) && /if \(\['shipped', 'completed'\]\.includes\(String\(order\.stage\)\)\) \{/.test(os) && /active: active \|\| returnMoving,/.test(os) && /support: supportTickets,\s+returns,/.test(os));
  const page = src('src/components/shop/CustomerReturns.tsx');
  check('the order page shows each return, where it is, and the label while it’s still to come back', /<CustomerReturns returns=\{\(order as any\)\.returns\}/.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')) && /const v = customerReturnStatus\(r\.id === labelFailedId && !r\.hasLabel \? \{ \.\.\.r, labelFailed: true \} : r, method, day\);/.test(page) && /aria-current=\{st\.now \? 'step' : undefined\}/.test(page) && /\{r\.labelUrl && r\.status === 'open' && \(/.test(page) && /Print your label/.test(page));
  const op = src('src/app/shop/[tenantId]/order/[orderId]/page.tsx');
  check('a return just started shows in their list straight away, with no second confirmation beside it', /void load\(\);/.test(op) && /setRetDone\(true\); setStartedId\(String\(data\.returnId \|\| ''\)\);/.test(op) && /\{retDone && !\(startedId && Array\.isArray/.test(op));
  check('a label this page couldn’t ask for says the shop will email it (never that one is on its way)', /labelFailedId=\{retLabelFailed && !retLabel \? startedId : ''\}/.test(op) && /r\.id === labelFailedId && !r\.hasLabel \? \{ \.\.\.r, labelFailed: true \} : r/.test(page));
  check('a finished order with a return on its way is asked about now and then, not every few seconds', /slowPoll: !active && returnMoving,/.test(os) && /listening \|\| slowPoll \? LISTEN_POLL_MS : ACTIVE_POLL_MS/.test(op));
  check('each step says done, now or next to a screen reader', /<span className="sr-only">\{st\.done \? ', done' : st\.now \? ', now' : ', next'\}<\/span>/.test(page));
  const words = src('src/lib/return-view.ts') + page;
  check('the words: no mention of the tool, no "call us", US spelling, no emojis', !new RegExp(['cl', 'aude|anth', 'ropic'].join(''), 'i').test(words) && !/call us/i.test(words) && !/cancelled/.test(words.replace(/'cancelled'/g, '')) && !/[\u{1F300}-\u{1FAFF}]/u.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
