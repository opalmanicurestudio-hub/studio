// scripts/verify/digital-gift.verify.ts — a download bought as a gift (lib/digital-gift): what the buyer types, when the
// email is due, that the gift pass and the buyer's pass never open each other's view, and that the routes and pages
// keep the gift to the person it was for.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/digital-gift.verify.ts
import fs from 'fs';
import { buildEntitlement } from '../../src/lib/entitlements';
import { cleanDigitalGift, giftDead, giftDue, giftPassKey, accessPassKey, giftWhen } from '../../src/lib/digital-gift';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } else console.log('  ✓', m); };
const today = '2026-10-29';
const read = (p: string) => fs.readFileSync(p, 'utf8');

// ── what the buyer types
const good = cleanDigitalGift({ to: '  Maya  ', toEmail: ' Maya@Example.COM ', message: 'Happy birthday!', sendOn: '2026-11-02' }, today) as any;
ok(good.ok && good.gift.toName === 'Maya' && good.gift.toEmail === 'maya@example.com' && good.gift.sendOn === '2026-11-02', 'name and email cleaned, the day kept');
ok(!(cleanDigitalGift({ toEmail: 'a@b.co' }, today) as any).ok, 'needs who it is for');
ok(!(cleanDigitalGift({ to: 'M', toEmail: 'not-an-email' }, today) as any).ok, 'needs a real email');
ok(!(cleanDigitalGift({ to: 'M', toEmail: 'a@b.co', sendOn: '2026-10-28' }, today) as any).ok, 'not a day already gone');
ok(!(cleanDigitalGift({ to: 'M', toEmail: 'a@b.co', sendOn: '2028-01-01' }, today) as any).ok, 'up to a year ahead');
ok((cleanDigitalGift({ to: 'M', toEmail: 'a@b.co', sendOn: today }, today) as any).gift.sendOn === null, 'today means at once');
ok((cleanDigitalGift({ to: 'M', toEmail: 'a@b.co', message: 'x'.repeat(500) }, today) as any).gift.message.length === 300, 'message kept to 300');

// ── when it goes
const paid = { stage: 'completed', paidAt: '2026-10-29T10:00:00Z', qrToken: 'qr1' };
ok(giftDue({ ...paid, digitalGift: { sendOn: null, sentAt: null } }, today), 'no day: due once paid');
ok(!giftDue({ ...paid, paidAt: null, digitalGift: { sendOn: null, sentAt: null } }, today), 'not before it is paid');
ok(!giftDue({ ...paid, stage: 'cancelled', digitalGift: { sendOn: null, sentAt: null } }, today), 'not on a cancelled order');
ok(!giftDue({ ...paid, digitalGift: { sendOn: '2026-11-02', sentAt: null } }, today) && giftDue({ ...paid, digitalGift: { sendOn: '2026-11-02', sentAt: null } }, '2026-11-02'), 'a chosen day waits for that day');
ok(!giftDue({ ...paid, digitalGift: { sendOn: null, sentAt: '2026-10-29T10:01:00Z' } }, today), 'sent once');
ok(!(cleanDigitalGift({ to: 'M', toEmail: 'a@b.co', sendOn: '2027-02-45' }, today) as any).ok && !(cleanDigitalGift({ to: 'M', toEmail: 'a@b.co', sendOn: '2027-02-29' }, today) as any).ok, 'only a real calendar day');
ok(!giftDue({ ...paid, totalCents: 1800, refundedCents: 1800, digitalGift: { sendOn: null, sentAt: null } }, today) && giftDead({ ...paid, totalCents: 1800, refundedCents: 1800, digitalGift: { sentAt: null } }), 'a refunded gift never goes');
ok(!giftDue({ ...paid, digitalHolds: { pi: { status: 'open' } }, digitalGift: { sendOn: null, sentAt: null } }, today) && !giftDead({ ...paid, digitalHolds: { pi: { status: 'open' } }, digitalGift: { sentAt: null } }), 'a chargeback holds it, without giving up');
ok(giftDead({ ...paid, digitalGift: { sentAt: null, failedAt: '2026-10-29T11:00:00Z' } }) && /not sent/.test(giftWhen({ sendOn: null, sentAt: null, failedAt: '2026-10-29T11:00:00Z' })), 'a gift that could not be delivered stops, and the buyer is told');
ok(giftWhen({ sendOn: null, sentAt: null }) === 'sending now' && giftWhen({ sendOn: '2026-11-02', sentAt: null }) === 'sending Nov 2', 'the buyer is told when');

// ── two passes, never the same
ok(giftPassKey('qr1') !== 'qr1' && accessPassKey({ ...paid, digitalGift: {} }) === giftPassKey('qr1') && accessPassKey(paid) === 'qr1', 'a gift opens with the gift pass only; an ordinary order with the buyer pass');

// ── the access record is the recipient's
const gl = { lineId: 'l1', productId: 'p1', digital: true, qtyOrdered: 1 };
const ge = buildEntitlement('t1', { ...paid, id: 'o1', customerEmail: 'buyer@x.co', clientId: 'c1', lines: [gl], digitalGift: { toEmail: 'maya@example.com' } }, gl, { digitalDownloadLimit: 3 }) as any;
ok(ge.email === 'maya@example.com' && !ge.clientId, 'a gift’s access record carries the recipient’s email, not the buyer’s account');

// ── the routes and pages
const checkout = read('src/app/api/retail/checkout/route.ts');
ok(/digitalOnly && body\.gift\?\.isGift === true/.test(checkout) && !/digitalGiftPending/.test(checkout), 'checkout: only an all-download cart is sent by email; nothing waits on the list until it is paid');
const access = read('src/app/api/retail/digital-access/route.ts');
ok(/accessPassKey\(order\)/.test(access), 'opening a file checks the right pass');
const lib = read('src/app/api/retail/gift-library/route.ts');
ok(/!g\.sentAt/.test(lib) && /timingSafeEqual/.test(lib) && !/customerEmail|customerPhone|shippingAddress|chargedCents/.test(lib), 'gift library: nothing before it is sent, the link compared safely, nothing of the buyer’s');
const pass = read('src/app/api/retail/order-pass/route.ts');
ok(/b\.gift === true/.test(pass) && /String\(g\.toEmail\)/.test(pass) && /giftPassKey/.test(pass), 'codes for a gift go to the person it was for');
const status = read('src/app/api/retail/order-status/route.ts');
ok(/digitalGift/.test(status), 'the buyer’s order page knows it was a gift');
const acct = read('src/app/api/retail/account/orders/route.ts');
ok(/digitalGift/.test(acct), 'a gift is not on the buyer’s account shelf');
const server = read('src/lib/digital-gift-server.ts');
ok(/runTransaction/.test(server) && /giftDue\(o, today\)/.test(server) && /digitalGiftPending: false/.test(server) && /sending: null/.test(server), 'sending: claimed first, once, and the claim given back when it fails');
const cron = read('src/app/api/cron/retail-payments/route.ts');
ok(/sweepDueGifts\(db, t\.id\)/.test(cron), 'the five-minute check sends gifts whose day has come');
const hook = read('src/lib/retail-webhook.ts');
ok(/digitalGiftPending: true/.test(hook) && /sendDueGift\(/.test(hook) && /Your gift/.test(hook), 'paying puts it on the list and sends it at once when due; the receipt says so');
const rules = read('firestore.rules');
ok(/'digitalGift', 'digitalGiftPending'/.test(rules), 'the browser can never write the gift or its token');
const page = read('src/app/shop/[tenantId]/library/[orderId]/page.tsx');
ok(/gift-library', \{ method: 'POST'/.test(page) && /gift: giftMode\.current/.test(page) && /replaceState/.test(page), 'library: gift mode, gift codes, the token sent in a body and taken out of the address');
ok(/export async function POST/.test(lib) && !/export async function GET/.test(lib), 'the gift token never travels in a query string');
ok(/order\.digitalGift \|\| !linkOpen\(order, rs\)/.test(status), 'without the buyer’s pass, a gift order shows nothing of the buyer or the prices');
const da = read('src/app/api/retail/digital-access/route.ts');
ok(/g \? g\.toName : o\.customerName/.test(da) && /askShop\(/.test(da) && !/send the shop a message from your order page for more\.'/.test(da), 'the file is stamped with the recipient, and their messages point to their gift email');
const gs = read('src/lib/digital-gift-server.ts');
ok(/GIFT_TRIES/.test(gs) && !/\\n\\n\$\{url\}/.test(gs), 'sending gives up after its tries, and the logged text never holds the link');
const co = read('src/app/shop/[tenantId]/checkout/page.tsx');
ok(/toEmail: giftEmail\.trim\(\)/.test(co) && /search\?\.get\('gift'\) === '1'/.test(co), 'checkout: the gift form for downloads, opened from the product page');
const prod = read('src/components/shop/product/ProductLayouts.tsx');
ok((prod.match(/<GiftLink v=\{v\} \/>/g) || []).length === 5, 'every product layout offers it');

console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
