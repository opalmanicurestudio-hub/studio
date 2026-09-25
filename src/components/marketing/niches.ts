// src/components/marketing/niches.ts
//
// WHAT THE LANDING PAGE SAYS TO EACH KIND OF BUSINESS.
//
// The page tells one story — "a day at your business" — and this file tells
// it in each business's own world: their clients, their screens, the apps
// they'd be leaving. Change wording here; the design lives in Journey.tsx.
//
// Every moment shown is something the app does today. Deliberately NOT
// claimed: door access or a member app (fitness), shipping labels (shops).

export type NicheKey = 'salon' | 'spa' | 'fitness' | 'shop';

export type Screen =
  | { kind: 'notify'; app: string; title: string; lines: string[]; pill: string }
  | { kind: 'decide'; chip: string; title: string; sub: string; accept: string; others: string[] }
  | { kind: 'chat'; biz: string; bubbles: { me?: boolean; text: string }[]; done: string }
  | { kind: 'checkout'; lines: [string, string, ('offer' | 'credit')?][]; total: string; pay: string }
  | { kind: 'rows'; title: string; rows: [string, string, string, 'green' | 'amber'][]; footer: [string, string] }
  | { kind: 'campaign'; label: string; message: string; stats: [string, string][]; result: string };

export interface Chapter { time: string; line: string; body: string; screen: Screen }

export interface Niche {
  key: NicheKey; label: string; plural: string; slug: string; biz: string;
  sub: string; title: string; description: string;
  chapters: Chapter[];
  switchFrom: string; startLine: string;
}

export const NICHE_ORDER: NicheKey[] = ['salon', 'spa', 'fitness', 'shop'];

export const NICHES: Record<NicheKey, Niche> = {
  salon: {
    key: 'salon', label: 'Salon', plural: 'Salons & suites', slug: 'salons', biz: 'Opal Studio',
    sub: 'Staff and renters on one calendar. Deposits that stop no-shows. Rent collected on autopay.',
    title: 'ClarityFlow for salons & suites — staff, renters and rent in one place',
    description: 'Booking with deposits, staff and booth renters on one calendar, and rent collected on autopay. Built by a salon owner. Free during early access.',
    switchFrom: 'Vagaro, GlossGenius, Booksy or a spreadsheet',
    startLine: 'Your booking page could be live today.',
    chapters: [
      { time: '7:42 am', line: 'Booked while you slept.', body: 'Only truly free times. Deposit taken. No back-and-forth.',
        screen: { kind: 'notify', app: 'ClarityFlow', title: 'New booking', lines: ['Ana Lopez · Soft gel overlay', 'Friday 9:00 am · $160'], pill: '$20 deposit secured' } },
      { time: '8:15 am', line: 'One tap. Done.', body: 'Review every booking, some, or none. Everyone sees it at once.',
        screen: { kind: 'decide', chip: '1 awaiting you', title: 'Waiting on your answer', sub: 'Mia R. · Balayage · Sat 10:00', accept: 'Accept', others: ['10:30 · Jo T. · Brow shape', '1:00 · Sam P. · Pedicure'] } },
      { time: '8:58 am', line: 'They’re on their way.', body: 'Reminders go out on their own. Late? They tell you.',
        screen: { kind: 'chat', biz: 'Opal Studio', bubbles: [{ text: 'See you at 9:00, Ana! Your forms are ready ✨' }, { me: true, text: 'Running 5 min late!' }, { text: 'No problem — see you soon 💛' }], done: 'Ana has arrived' } },
      { time: '10:05 am', line: 'Paid before they stand up.', body: 'Their offer comes off by itself. Tips go to the right person.',
        screen: { kind: 'checkout', lines: [['Soft gel overlay', '$160.00'], ['Offer WELCOME15', '−$24.00', 'offer'], ['Tip · Kylie', '$27.00']], total: '$163.00', pay: 'Tap to pay' } },
      { time: '6:00 pm', line: 'Rent’s in. You didn’t chase anyone.', body: 'Booth and suite renters, their own portal, rent on autopay.',
        screen: { kind: 'rows', title: 'Renters', rows: [['Jess T.', 'Suite 2', 'rent paid ✓', 'green'], ['Kai M.', 'Chair 3', 'rent paid ✓', 'green'], ['Sam P.', 'Chair 4', 'due Fri', 'amber']], footer: ['Collected this month', '$4,800'] } },
      { time: 'Six weeks later', line: 'And they come back.', body: 'A friendly nudge when they’re due — and you see who rebooked.',
        screen: { kind: 'campaign', label: 'Win back · text', message: 'Hi Ana, it’s been a while — we’d love to see you again 💛', stats: [['84', 'Reached'], ['12', 'Booked'], ['$1.6k', 'Revenue']], result: 'Ana rebooked · Oct 9' } },
    ],
  },
  spa: {
    key: 'spa', label: 'Spa', plural: 'Spas & wellness', slug: 'spas', biz: 'Stillwater Spa',
    sub: 'Rooms and treatments that never double-book. Packages and memberships that renew themselves.',
    title: 'ClarityFlow for spas & wellness — rooms, packages and memberships in one place',
    description: 'Online booking for rooms and treatments, packages and memberships that renew themselves, and clients who come back. Free during early access.',
    switchFrom: 'Vagaro, Mangomint, Boulevard or paper cards',
    startLine: 'Your booking page could be live today.',
    chapters: [
      { time: '7:42 am', line: 'Booked while you slept.', body: 'The right room, the right therapist, never double-booked.',
        screen: { kind: 'notify', app: 'ClarityFlow', title: 'New booking', lines: ['Maya Chen · Deep tissue 60', 'Saturday 11:00 am · Room 2'], pill: 'Package · 3 of 5' } },
      { time: '8:15 am', line: 'One tap. Done.', body: 'Approve new clients first, or let regulars book straight in.',
        screen: { kind: 'decide', chip: '1 awaiting you', title: 'Waiting on your answer', sub: 'New client · Hydrafacial · Sat 2:00', accept: 'Accept', others: ['10:00 · Lena K. · Couples massage', '12:30 · Priya S. · Body wrap'] } },
      { time: '10:50 am', line: 'Arrived, forms done.', body: 'Intake forms signed at home. They check themselves in.',
        screen: { kind: 'chat', biz: 'Stillwater Spa', bubbles: [{ text: 'Your massage is tomorrow at 11. Intake form here 🌿' }, { me: true, text: 'Done! See you then' }, { text: 'Room 2 will be ready for you ✨' }], done: 'Maya has arrived' } },
      { time: '12:05 pm', line: 'Paid from their package.', body: 'Credits come off by themselves. Add-ons in a tap.',
        screen: { kind: 'checkout', lines: [['Deep tissue 60', '$120.00'], ['Package credit', '−$120.00', 'credit'], ['Hot stones add-on', '$25.00']], total: '$25.00', pay: 'Tap to pay' } },
      { time: '1st of the month', line: 'Memberships renewed. On their own.', body: 'Monthly members billed automatically, visits reset.',
        screen: { kind: 'rows', title: 'Members', rows: [['Maya C.', 'Monthly massage', 'renewed ✓', 'green'], ['Lena K.', 'Glow club', 'renewed ✓', 'green'], ['Priya S.', 'Monthly facial', 'card update', 'amber']], footer: ['Renewed this month', '$3,150'] } },
      { time: 'Six weeks later', line: 'And they come back.', body: 'A gentle reminder when they’re due — and you see who rebooked.',
        screen: { kind: 'campaign', label: 'Due for a visit · email', message: 'Maya, your next massage is waiting — two credits left 🌿', stats: [['62', 'Reached'], ['15', 'Booked'], ['$1.9k', 'Revenue']], result: 'Maya rebooked · Nov 2' } },
    ],
  },
  fitness: {
    key: 'fitness', label: 'Fitness studio', plural: 'Fitness studios', slug: 'fitness', biz: 'North Loop Pilates',
    sub: 'Classes that fill themselves. Members billed on autopay. Check-in in a tap.',
    title: 'ClarityFlow for fitness studios — classes, members and check-in in one place',
    description: 'Class booking, class packs and memberships on autopay, quick check-in, and members who come back. Free during early access.',
    switchFrom: 'Mindbody, Glofox or a paper sign-in sheet',
    startLine: 'Your schedule could be live today.',
    chapters: [
      { time: '6:10 am', line: 'The 6pm class filled itself.', body: 'Members book from their phone. You watch spots fill.',
        screen: { kind: 'notify', app: 'ClarityFlow', title: 'Class booked', lines: ['Leo Park · Reformer', 'Today 6:00 pm · 11 of 12'], pill: '1 spot left' } },
      { time: '9:30 am', line: 'One tap. Done.', body: 'Approve intro sessions and private lessons from anywhere.',
        screen: { kind: 'decide', chip: '1 awaiting you', title: 'Waiting on your answer', sub: 'Intro private · Ava R. · Thu 7:00', accept: 'Accept', others: ['12:00 · Mat Pilates · 8/14', '6:00 · Reformer · 11/12'] } },
      { time: '5:52 pm', line: 'Checked in at the door.', body: 'Reminders go out on their own. Arrivals show up live.',
        screen: { kind: 'chat', biz: 'North Loop Pilates', bubbles: [{ text: 'Reformer at 6 tonight, Leo — see you there 💪' }, { me: true, text: 'Stuck in traffic, 5 min late' }, { text: 'Got it — we’ll hold your spot' }], done: 'Leo checked in' } },
      { time: '7:05 pm', line: 'Class packs, sold in seconds.', body: 'Packs and drop-ins at the desk or online. Offers apply themselves.',
        screen: { kind: 'checkout', lines: [['10-class pack', '$180.00'], ['Offer NEWYOU10', '−$18.00', 'offer'], ['Grip socks', '$14.00']], total: '$176.00', pay: 'Tap to pay' } },
      { time: '1st of the month', line: 'Memberships renewed. On their own.', body: 'Autopay for unlimited and class-pack members.',
        screen: { kind: 'rows', title: 'Members', rows: [['Leo P.', 'Unlimited', 'renewed ✓', 'green'], ['Ava R.', '8 classes/mo', 'renewed ✓', 'green'], ['Jon D.', 'Unlimited', 'card update', 'amber']], footer: ['Renewed this month', '$7,420'] } },
      { time: 'Three weeks later', line: 'And they come back.', body: 'Notice who’s gone quiet — and bring them back to class.',
        screen: { kind: 'campaign', label: 'We miss you · text', message: 'Leo, the reformer misses you 😉 Your first class back is on us.', stats: [['140', 'Reached'], ['26', 'Booked'], ['$2.1k', 'Revenue']], result: 'Leo booked · Tue 6pm' } },
    ],
  },
  shop: {
    key: 'shop', label: 'Shop', plural: 'Shops & makers', slug: 'shops', biz: 'Fern & Clay',
    sub: 'Sell in store and online from one stock count. Workshops and bookings on the same system.',
    title: 'ClarityFlow for shops & makers — in store, online and workshops in one place',
    description: 'One stock count for in-store and online sales, orders packed in one pass, workshops and bookings, and customers who come back. Free during early access.',
    switchFrom: 'Square, Shopify plus a separate booking app',
    startLine: 'Your shop could be live today.',
    chapters: [
      { time: '7:42 am', line: 'Sold while you slept.', body: 'Online orders come straight off the same shelf count.',
        screen: { kind: 'notify', app: 'ClarityFlow', title: 'New order #1042', lines: ['2 items · Speckled mug, Linen towel', 'Pickup · $64.00'], pill: 'Paid online' } },
      { time: '9:15 am', line: 'One tap. Done.', body: 'Approve workshop bookings and custom orders from anywhere.',
        screen: { kind: 'decide', chip: '1 awaiting you', title: 'Waiting on your answer', sub: 'Wheel-throwing workshop · 2 seats · Sat', accept: 'Accept', others: ['Order #1041 · packed', 'Order #1043 · ready'] } },
      { time: '11:30 am', line: 'Ready for pickup.', body: 'Customers hear from you at every step — automatically.',
        screen: { kind: 'chat', biz: 'Fern & Clay', bubbles: [{ text: 'Your order #1042 is ready for pickup 🌿' }, { me: true, text: 'On my way!' }, { text: 'See you soon — it’s at the front desk' }], done: 'Order #1042 picked up' } },
      { time: '2:40 pm', line: 'Checkout in seconds.', body: 'In-store sales and online orders share one stock count.',
        screen: { kind: 'checkout', lines: [['Speckled mug × 2', '$56.00'], ['Offer MAKER10', '−$5.60', 'offer'], ['Gift wrap', '$4.00']], total: '$54.40', pay: 'Tap to pay' } },
      { time: '6:00 pm', line: 'Stock counts itself.', body: 'Every sale — in store or online — updates the shelf.',
        screen: { kind: 'rows', title: 'Stock', rows: [['Speckled mug', '14 left', 'in stock', 'green'], ['Linen towel', '22 left', 'in stock', 'green'], ['Bud vase', '3 left', 'reorder', 'amber']], footer: ['Sold today', '$1,240'] } },
      { time: 'A month later', line: 'And they come back.', body: 'Offers to past customers — and you see what they bought.',
        screen: { kind: 'campaign', label: 'New collection · email', message: 'The autumn glazes are in — first pick for our regulars 🍂', stats: [['310', 'Reached'], ['41', 'Bought'], ['$2.8k', 'Revenue']], result: 'Order #1107 · from this email' } },
    ],
  },
};
