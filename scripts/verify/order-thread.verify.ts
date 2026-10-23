// Checks one order's conversation and record (lib/order-thread), as the order workspace shows them: the customer's
// messages and the shop's replies from each case, the shop's own messages and the updates the customer was sent from
// the order page, in one order of time, without saying anything twice. Which case a reply goes to, whether the shop
// owes an answer, and the record's sides (what the customer was told, what they wrote, what the team did, what
// happened automatically).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-thread.verify.ts
import { check, failures } from './fake-db';
import { conversationOf, filterRecord, openCase, recordOf, waitingOnShop } from '../../src/lib/order-thread';

const at = (h: number) => new Date(Date.UTC(2026, 9, 20, h)).toISOString();

const tickets = [
  { id: 's1', status: 'open', createdAt: at(9), message: 'Could you add a card that says Happy birthday, Mom?', photoUrls: ['https://p/1.jpg'],
    followUps: [{ at: at(11), message: 'Just checking on this.', kind: 'chaser' }, { at: at(12), message: '', photoUrls: [] }],
    replies: [{ at: at(10), text: 'Of course. We’ll tuck one in.', by: 'Ana' }] },
  { id: 's0', status: 'resolved', createdAt: at(2), message: 'Is this in stock?', replies: [{ at: at(3), text: 'Yes, it is.', by: 'Kai' }] },
];
const inbox = [
  { id: 'c1', kind: 'order_confirmation', at: at(1), title: 'Thank you for your order #1204', body: 'Your receipt' },
  { id: 'c2', kind: 'shop_message', at: at(8), title: 'A message about your order #1204', body: 'Your order is being packed now.', by: 'Ana' },
  { id: 'c3', kind: 'support_reply', at: at(10), title: 'A reply about your order', body: 'Of course. We’ll tuck one in.' },
  { id: 'c4', kind: 'support_received', at: at(9), title: 'We have your message', body: 'Thanks' },
];

const conv = conversationOf(inbox, tickets);
check('the conversation is in order of time, oldest first', conv.every((m, i) => i === 0 || Date.parse(conv[i - 1].at) <= Date.parse(m.at)), conv.map((m) => m.at));
check('the update she was sent shows as an update, with its title', conv[0].who === 'update' && conv[0].title === 'Thank you for your order #1204');
check('the shop’s own message on the order page shows as the shop speaking, with who wrote it', conv.some((m) => m.id === 'in-c2' && m.who === 'shop' && m.by === 'Ana'));
check('a reply already in its case isn’t shown a second time from the order page', !conv.some((m) => m.id === 'in-c3' || m.id === 'in-c4') && conv.filter((m) => /tuck one in/.test(m.text)).length === 1);
check('her message keeps its photos and its case', conv.some((m) => m.id === 's1-0' && m.who === 'customer' && m.ticketId === 's1' && m.photos?.[0] === 'https://p/1.jpg'));
check('a follow-up that only chased is marked as one; an empty one isn’t shown', conv.some((m) => m.id === 's1-f0' && m.chaser === true) && !conv.some((m) => m.id === 's1-f1'));
check('a closed case’s messages still show, in their place in time', conv.findIndex((m) => m.id === 's0-0') < conv.findIndex((m) => m.id === 'in-c2'));

check('a reply goes to the newest case still open', openCase(tickets)?.id === 's1' && openCase([{ id: 'x', status: 'resolved' }]) === null);
check('the shop owes an answer when she spoke last in an open case', waitingOnShop(conv, tickets) === true);
const answered = conversationOf(inbox, [{ ...tickets[0], replies: [...tickets[0].replies, { at: at(13), text: 'Done, it’s in the box.', by: 'Ana' }] }]);
check('…and doesn’t once the shop has answered', waitingOnShop(answered, [{ ...tickets[0] }]) === false);
check('…nor when every case is closed', waitingOnShop(conv, [{ ...tickets[0], status: 'resolved' }]) === false);
check('an update sent after her message doesn’t count as an answer', waitingOnShop(conversationOf([...inbox, { id: 'c9', kind: 'order_shipped', at: at(14), title: 'On its way' }], tickets), tickets) === true);

const events = [
  { id: 'e1', type: 'payment_confirmed', at: at(1), actorId: 'stripe', actorName: 'Payments' },
  { id: 'e2', type: 'packed', at: at(12), actorId: 'u1', actorName: 'Ana Ruiz' },
  { id: 'e3', type: 'note', at: at(10), actorId: 'u1', actorName: 'Ana Ruiz', meta: { text: 'Support reply sent: Of course.' } },
  { id: 'e4', type: 'carrier_update', at: at(15), actorId: 'shippo', actorName: 'Carrier' },
];
const line = (e: any) => ({ text: `${e.type} · ${e.actorName}`, tone: 'plain' as const });
const rec = recordOf(events, inbox, tickets, line);
check('the record runs in order of time', rec.every((r, i) => i === 0 || Date.parse(rec[i - 1].at) <= Date.parse(r.at)));
check('a person at the shop is the team; payments and the carrier are automatic', rec.find((r) => r.id === 'ev-e2')?.side === 'team' && rec.find((r) => r.id === 'ev-e1')?.side === 'system' && rec.find((r) => r.id === 'ev-e4')?.side === 'system');
check('the team’s line doesn’t repeat who did it after their name', rec.find((r) => r.id === 'ev-e2')?.text === 'packed' && rec.find((r) => r.id === 'ev-e2')?.who === 'Ana Ruiz', rec.find((r) => r.id === 'ev-e2'));
check('the note that a reply went out isn’t on the record (the reply itself is)', !rec.some((r) => r.id === 'ev-e3') && rec.some((r) => r.side === 'told' && /tuck one in/.test(r.text)));
check('what she was sent and what she wrote are on the record', rec.some((r) => r.side === 'told' && r.who === 'Update sent' && /Thank you for your order/.test(r.text)) && rec.some((r) => r.side === 'customer' && /Happy birthday/.test(r.text)));
check('the filters keep one side each, and all keeps everything', filterRecord(rec, 'team').every((r) => r.side === 'team') && filterRecord(rec, 'system').length === 2 && filterRecord(rec, 'all').length === rec.length
  && filterRecord(rec, 'told').every((r) => r.side === 'told') && filterRecord(rec, 'customer').every((r) => r.side === 'customer'));
check('nothing breaks on an order with no messages, cases or events', conversationOf([], []).length === 0 && recordOf([], [], [], line).length === 0 && openCase([]) === null && !waitingOnShop([], []));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
