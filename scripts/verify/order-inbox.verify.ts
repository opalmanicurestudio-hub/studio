// Checks the order-page-first rule: full message on the order page, one nudge, receipt still in full, others untouched.
// Run: npx tsx scripts/verify/order-inbox.verify.ts
import { cardText, linksIn, nudgeLine, routeThroughOrderPage } from '../../src/lib/order-inbox';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };

function fakeDb(docs: Record<string, any>) {
  const store: Record<string, any> = { ...docs }; let n = 0;
  const ref = (path: string): any => ({ id: path.split('/').pop(), path, get: async () => ({ exists: path in store, data: () => store[path] }), set: async (v: any, o?: any) => { store[path] = o?.merge ? deepMerge(store[path] || {}, v) : v; } });
  const deepMerge = (a: any, b: any): any => { const o = { ...a }; for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? deepMerge(a?.[k] || {}, b[k]) : b[k]; return o; };
  return { store, doc: ref, collection: (p: string) => ({ doc: () => ref(`${p}/auto${++n}`) }), runTransaction: async (fn: any) => fn({ get: (r: any) => r.get(), set: (r: any, v: any, o: any) => r.set(v, o) }) };
}

async function main() {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';
  delete process.env.TWILIO_ACCOUNT_SID;
  const order = { orderNumber: 42, customerEmail: 'dana@x.com', customerPhone: '', customerName: 'Dana' };
  const db = fakeDb({ 'tenants/t': { name: 'Opal' }, 'tenants/t/retailOrders/o1': order });
  const sent: any[] = []; const send = async (i: any) => { sent.push(i); return { ok: true, status: 'sent' }; };
  const html = '<p>Hi Dana,</p><p>Your return label is ready.</p><a href="https://labels.test/1.pdf">Open my return label</a><a href="https://app.test/shop/t/order/o1">View my order</a><p>If you have any questions, just reply to this email.</p>';

  const r = await routeThroughOrderPage(db as any, { tenantId: 't', channel: 'email', to: 'Dana@x.com', subject: 'Your label', html, kind: 'return_label', recipientId: 'o1' }, send);
  const card = Object.entries(db.store).find(([k]) => k.includes('/inbox/'))?.[1];
  ok(!!r && sent.length === 1 && sent[0].channel === 'email' && sent[0].subject === 'Your return label for order #0042 is ready.' && /app\.test\/shop\/t\/order\/o1/.test(sent[0].text), 'buyer gets a one-line nudge with the order link');
  ok(!!card && /return label is ready/.test(card.body) && !/reply to this email/.test(card.body) && !/^Hi Dana/.test(card.body), 'full message on the order page, minus email-only lines');
  ok(card?.links?.length === 1 && card.links[0].url === 'https://labels.test/1.pdf', 'the label button comes along; the order page link does not');

  const r2 = await routeThroughOrderPage(db as any, { tenantId: 't', channel: 'email', to: 'dana@x.com', subject: 'x', html, kind: 'return_label', orderId: 'o1' }, send);
  ok(!!r2 && sent.length === 1, 'the same news twice in ten minutes nudges once');

  ok((await routeThroughOrderPage(db as any, { tenantId: 't', channel: 'email', to: 'sam@gift.com', html, kind: 'return_label', orderId: 'o1' }, send)) === null, 'someone who isn’t the buyer (a gift recipient) is written to as before');
  ok((await routeThroughOrderPage(db as any, { tenantId: 't', channel: 'email', to: 'dana@x.com', html: '<p>Receipt</p>', kind: 'order_confirmation', orderId: 'o1' }, send)) === null, 'the receipt still goes in full');
  ok(Object.keys(db.store).some((k) => k.includes('/inbox/order_confirmation')), '…and is on the order page too');
  ok((await routeThroughOrderPage(db as any, { tenantId: 't', channel: 'email', to: 'dana@x.com', html, kind: 'booking_confirmation', orderId: 'o1' }, send)) === null, 'non-order messages are untouched');
  const before = sent.length;
  await routeThroughOrderPage(db as any, { tenantId: 't', channel: 'email', to: 'dana@x.com', html, kind: 'support_received', orderId: 'o1' }, send);
  ok(sent.length === before, 'a “we got your message” note isn’t sent; they’re on the page');

  process.env.TWILIO_ACCOUNT_SID = 'x'; process.env.TWILIO_AUTH_TOKEN = 'y'; process.env.TWILIO_FROM = '+1555';
  const db2 = fakeDb({ 'tenants/t': { businessName: 'Opal' }, 'tenants/t/retailOrders/o2': { ...order, customerPhone: '(555) 123-4567' } });
  const s2: any[] = []; await routeThroughOrderPage(db2 as any, { tenantId: 't', channel: 'email', to: 'dana@x.com', html, kind: 'order_ready', orderId: 'o2' }, async (i: any) => { s2.push(i); return { ok: true }; });
  ok(s2.length === 1 && s2[0].channel === 'sms' && s2[0].text.startsWith('Opal: Your order #0042 is ready for pickup.'), 'with a phone on file, the nudge is a text');

  ok(nudgeLine('support_reply', '#0001', 'Opal') === 'Opal replied about your order #0001.', 'reply nudge names the shop');
  ok(cardText('<p>Kind regards,</p><p>Opal</p>') === 'Opal' && linksIn('<a href="http://x">x</a>', '').length === 0, 'sign-offs dropped; only secure links kept');
  if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
}
void main();
