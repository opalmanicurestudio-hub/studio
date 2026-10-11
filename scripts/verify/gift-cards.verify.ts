// scripts/verify/gift-cards.verify.ts — checks the gift card server logic against an in-memory database.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/gift-cards.verify.ts
import { makeDb, check, failures } from './fake-db';

(async () => {
  const gc = await import('../../src/lib/gift-cards');
  const gs = await import('../../src/lib/gift-shop');
  const gd = await import('../../src/lib/gift-designs');
  const T = 't1';
  const fresh = (settings: any = {}) => { const db = makeDb(); db._store.set('tenants/t1', { name: 'Opal', userId: 'owner1', stripeAccountId: 'acct_1', timezone: 'America/New_York', giftCardSettings: { online: true, ...settings } }); return db; };

  console.log('Issuing');
  { const db = fresh(); db._store.set('tenants/t1/clients/c1', { name: 'Tia' });
    const r: any = await gc.issueGiftCard(db, T, { amountCents: 7500, by: 'Desk', source: 'desk', recipient: { id: 'c1', name: 'Tia' } });
    check('code looks like XXXX-XXXX', /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(r.card.code), r.card.code);
    check('balance = amount, active', r.card.balanceCents === 7500 && r.card.status === 'active');
    check('never expires by default', r.card.expiresAt === null);
    await new Promise((res) => setTimeout(res, 20));
    check('client total kept on the client', db._store.get('tenants/t1/clients/c1').giftBalanceCents === 7500, db._store.get('tenants/t1/clients/c1'));
    const bad: any = await gc.issueGiftCard(db, T, { amountCents: 0, by: 'Desk', source: 'desk' }); check('$0 refused', !bad.ok);
    const big: any = await gc.issueGiftCard(db, T, { amountCents: 600000, by: 'Desk', source: 'desk' }); check('over $5,000 refused', !big.ok);
    const dupe: any = await gc.issueGiftCard(db, T, { amountCents: 100, code: r.card.code, by: 'x', source: 'import' }); check('duplicate imported code refused', !dupe.ok && dupe.duplicate);
    const db5 = fresh({ expiryYears: 5 }); const e: any = await gc.issueGiftCard(db5, T, { amountCents: 100, by: 'x', source: 'desk' });
    check('5-year expiry when chosen', e.card.expiresAt && new Date(e.card.expiresAt).getFullYear() === new Date().getFullYear() + 5);
    const imp: any = await gc.issueGiftCard(db5, T, { amountCents: 100, by: 'x', source: 'import' }); check('imported cards keep no expiry', imp.card.expiresAt === null); }

  console.log('Holds and spending');
  { const db = fresh(); const { card } = (await gc.issueGiftCard(db, T, { amountCents: 5000, by: 'x', source: 'desk' })) as any;
    const h1: any = await gc.holdGiftCard(db, T, { id: card.id, holdId: 'tillA', cents: 3000 }); check('hold A takes $30', h1.ok && h1.cents === 3000);
    const h2: any = await gc.holdGiftCard(db, T, { code: card.code.toLowerCase().replace('-', ' '), holdId: 'tillB', cents: 3000 }); check('hold B only gets the $20 left (found by code, any case)', h2.ok && h2.cents === 2000, h2);
    const h3: any = await gc.holdGiftCard(db, T, { id: card.id, holdId: 'tillC', cents: 100 }); check('a third till gets nothing', !h3.ok);
    const sOver: any = await gc.spendGiftCard(db, T, { id: card.id, cents: 3500, holdId: 'tillA', by: 'x' }); check('can’t spend more than its hold allows', !sOver.ok, sOver);
    const s1: any = await gc.spendGiftCard(db, T, { id: card.id, cents: 3000, holdId: 'tillA', by: 'x', clientId: 'c9' }); check('spend $30 with its hold', s1.ok && s1.balanceAfter === 2000);
    const g: any = db._store.get(`tenants/t1/giftCards/${card.id}`); check('hold A cleared, B still there', !g.holds.tillA && !!g.holds.tillB); check('spending links the card to the client', g.recipientId === 'c9');
    const s2: any = await gc.spendGiftCard(db, T, { id: card.id, cents: 2000, holdId: 'tillB', by: 'x' }); check('spend the rest → used', s2.ok && db._store.get(`tenants/t1/giftCards/${card.id}`).status === 'used');
    const s3: any = await gc.spendGiftCard(db, T, { id: card.id, cents: 1, by: 'x' }); check('nothing left to spend', !s3.ok);
    // expired
    db._store.set('tenants/t1/giftCards/old', { id: 'old', code: 'AAAA-BBBB', codeKey: 'AAAABBBB', balanceCents: 1000, initialCents: 1000, status: 'active', holds: {}, history: [], expiresAt: '2020-01-01T00:00:00.000Z' });
    const ex: any = await gc.holdGiftCard(db, T, { code: 'AAAABBBB', holdId: 'h', cents: 100 }); check('an expired card can’t be held', !ex.ok && /expired/.test(ex.error), ex);
    const ex2: any = await gc.spendGiftCard(db, T, { id: 'old', cents: 100, by: 'x' }); check('…or spent', !ex2.ok); }

  console.log('Corrections, cancel, transfer');
  { const db = fresh(); const { card } = (await gc.issueGiftCard(db, T, { amountCents: 5000, by: 'x', source: 'desk', recipient: { id: 'c1', name: 'Tia' } })) as any;
    check('add $10', (await gc.adjustGiftCard(db, T, { id: card.id, kind: 'add', cents: 1000, by: 'm' }) as any).balanceCents === 6000);
    check('set to $40', (await gc.adjustGiftCard(db, T, { id: card.id, kind: 'set', cents: 4000, by: 'm' }) as any).balanceCents === 4000);
    check('negative balance refused', !(await gc.adjustGiftCard(db, T, { id: card.id, kind: 'set', cents: -1, by: 'm' }) as any).ok);
    const tr: any = await gc.transferGiftCard(db, T, { id: card.id, name: 'Rosa', clientId: 'c2', by: 'm' }); const g: any = db._store.get(`tenants/t1/giftCards/${card.id}`);
    check('transfer moves it to Rosa, history keeps Tia', tr.ok && g.recipientName === 'Rosa' && g.history.some((h: any) => h.type === 'transfer' && h.from?.name === 'Tia'));
    await new Promise((res) => setTimeout(res, 30));
    check('Tia’s total drops, Rosa’s rises', db._store.get('tenants/t1/clients/c1')?.giftBalanceCents === 0 && db._store.get('tenants/t1/clients/c2')?.giftBalanceCents === 4000, [db._store.get('tenants/t1/clients/c1'), db._store.get('tenants/t1/clients/c2')]);
    await gc.adjustGiftCard(db, T, { id: card.id, kind: 'void', by: 'm' }); check('void → cancelled, $0', db._store.get(`tenants/t1/giftCards/${card.id}`).status === 'void');
    check('a cancelled card can’t be held', !(await gc.holdGiftCard(db, T, { id: card.id, holdId: 'h', cents: 1 }) as any).ok); }

  console.log('Wrong-code limit');
  { const db = fresh(); let r: any; for (let i = 0; i < 7; i++) r = await gc.codeTries(db, T, 'u1', true); check('7 misses still allowed', !r.blocked);
    r = await gc.codeTries(db, T, 'u1', true); check('8th miss pauses them', r.blocked && r.justBlocked);
    check('…and a right code is refused while paused', (await gc.codeTries(db, T, 'u1', false)).blocked);
    check('someone else isn’t affected', !(await gc.codeTries(db, T, 'u2', false)).blocked); }

  console.log('Who a card can pay for (front desk)');
  { const P = gc.planGiftUse;
    let p = P({ cards: [{ id: 'a', code: 'A', wantCents: 10000, holdId: null, owner: null }], byRenter: {}, studioLeft: 6000, salonForRenters: true });
    check('studio card pays only what’s owed', !p.error && p.uses[0].cents === 6000, p);
    p = P({ cards: [{ id: 'a', code: 'A', wantCents: 10000, holdId: null, owner: null }], byRenter: { r1: 5500 }, studioLeft: 2000, salonForRenters: true });
    check('studio card: studio part, then the renter’s visit (owed to them)', p.uses[0].cents === 7500 && p.uses[0].forRenters.r1 === 5500, p);
    p = P({ cards: [{ id: 'a', code: 'A', wantCents: 10000, holdId: null, owner: null }], byRenter: { r1: 5500 }, studioLeft: 2000, salonForRenters: false });
    check('switch off: studio card skips the renter’s visit', p.uses[0].cents === 2000 && !p.uses[0].forRenters.r1, p);
    p = P({ cards: [{ id: 'a', code: 'A', wantCents: 5500, holdId: null, owner: null }], byRenter: { r1: 5500 }, studioLeft: 0, salonForRenters: false });
    check('switch off + only a renter’s visit: clear refusal', !!p.error, p);
    p = P({ cards: [{ id: 'b', code: 'B', wantCents: 9000, holdId: null, owner: 'r1', ownerName: 'Maya' }], byRenter: { r1: 5500 }, studioLeft: 3000, salonForRenters: true });
    check('renter’s own card pays only her visit', p.uses[0].cents === 5500 && p.uses[0].owner === 'r1', p);
    p = P({ cards: [{ id: 'b', code: 'B', wantCents: 9000, holdId: null, owner: 'r2', ownerName: 'Lee' }], byRenter: { r1: 5500 }, studioLeft: 3000, salonForRenters: true });
    check('another renter’s card is refused', !!p.error && /Lee/.test(p.error!), p);
    p = P({ cards: [{ id: 'a', code: 'A', wantCents: 3000, holdId: null, owner: null }, { id: 'c', code: 'C', wantCents: 3000, holdId: null, owner: null }], byRenter: {}, studioLeft: 3000, salonForRenters: true });
    check('second card not needed: skipped quietly', !p.error && p.uses.length === 1, p); }

  console.log('Rules and designs');
  { const s = gd.shopSettings({ giftCardSettings: {} }); check('default rules mention never expires', /Never expires/.test(s.rules));
    const s2 = gd.shopSettings({ giftCardSettings: { expiryYears: 3 } }); check('an expiry under 5 years is ignored', s2.expiryYears === 0);
    const hol = gd.designsSync().find((d) => d.id === 'o-holiday')!; check('holiday card in season Dec 20, not Oct 11', gd.inSeason(hol, new Date('2026-12-20T12:00:00')) && !gd.inSeason(hol, new Date('2026-10-11T12:00:00')));
    check('every design has art or a background', gd.designsSync().every((d) => d.bg || d.svg)); }

  console.log('Buying online (after payment)');
  { const db = fresh(); db._store.set('tenants/t1/giftOrders/o1', { id: 'o1', status: 'pending', amountCents: 5000, design: 'pour', line: null, buyerName: 'Jess', buyerEmail: 'j@x.com', recipientName: 'Tia', forSelf: false, via: 'email', recipientEmail: 't@x.com', sendAt: new Date(Date.now() + 864e5).toISOString() });
    const [a, b] = await Promise.all([gs.completeGiftOrder(db, T, 'o1', { sessionId: 's1', amountTotal: 5000 }), gs.completeGiftOrder(db, T, 'o1', { sessionId: 's1', amountTotal: 5000 })]) as any[];
    const cards = [...db._store.keys()].filter((k) => k.includes('/giftCards/')); const txs = [...db._store.entries()].filter(([k]) => k.includes('/transactions/'));
    check('paid twice at once → one card', cards.length === 1 && (a.already || b.already), { a, b, cards });
    check('recorded as held money (Gift Card Sales, transfer)', txs.length === 1 && txs[0][1].category === 'Gift Card Sales' && txs[0][1].taxBucket === 'transfer');
    check('scheduled for tomorrow, not sent yet', !!db._store.get(cards[0]).sendAt && !db._store.get(cards[0]).sentAt);
    db._store.set('tenants/t1/giftOrders/o2', { id: 'o2', status: 'pending', amountCents: 2500, design: 'frost', buyerName: 'Ann', buyerEmail: 'a@x.com', recipientName: 'Bo', via: 'me', ownerRenterId: 'r1', ownerName: 'Maya' });
    await gs.completeGiftOrder(db, T, 'o2', { sessionId: 's2', amountTotal: 2500 });
    const c2 = [...db._store.values()].find((v: any) => v.orderId === 'o2'); const tx2 = [...db._store.values()].filter((v: any) => v.giftOrderId === 'o2' && v.category);
    check('a renter’s card is theirs: owner set, nothing in the studio’s books', c2?.ownerRenterId === 'r1' && tx2.length === 0, { c2, tx2 });
    const ch: any = await gs.changeOrder(db, T, 'o1', { sendAt: new Date(Date.now() - 1000).toISOString() }); check('can’t move the send time into the past', !ch.ok);
    const ch2: any = await gs.changeOrder(db, T, 'o1', { recipientEmail: 'new@x.com' }); check('fix their email before it sends', ch2.ok && db._store.get(cards[0]).recipientEmail === 'new@x.com');
    const v: any = await gs.orderView(db, T, 'o1'); check('buyer’s page shows the corrected email', v.recipientEmail === 'new@x.com'); }

  console.log('Starting an order (checks before payment)');
  { const db = fresh(); const base = { amount: 50, design: 'pour', buyerName: 'Jess', buyerEmail: 'j@x.com', recipientName: 'Tia', via: 'email', recipientEmail: 't@x.com' };
    const try1 = async (o: any) => (await gs.startGiftOrder(db, T, { ...base, ...o }, '')) as any;
    check('too little refused', !(await try1({ amount: 2 })).ok); check('unknown design refused', !(await try1({ design: 'nope' })).ok);
    check('no buyer email refused', !(await try1({ buyerEmail: 'x' })).ok); check('text without a number refused', !(await try1({ via: 'text', recipientPhone: '123' })).ok);
    check('send date over a year away refused', !(await try1({ sendAt: new Date(Date.now() + 400 * 864e5).toISOString() })).ok);
    const off = fresh({ online: false }); check('shop switched off refused', !((await gs.startGiftOrder(off, T, base, '')) as any).ok); }

  console.log('Service gift cards');
  { const db = fresh(); db._store.set('tenants/t1/services/gel', { name: 'Gel manicure', price: 55, isActive: true });
    db._store.set('tenants/t1/giftOrders/o3', { id: 'o3', status: 'pending', amountCents: 5500, design: 'frost', buyerName: 'Jess', buyerEmail: 'j@x.com', recipientName: 'Tia', via: 'me', serviceId: 'gel', serviceName: 'Gel manicure' });
    await gs.completeGiftOrder(db, T, 'o3', { sessionId: 's3', amountTotal: 5500 });
    const c = [...db._store.values()].find((v: any) => v.orderId === 'o3'); check('a service card remembers its service', c?.kind === 'service' && c?.serviceId === 'gel' && c?.balanceCents === 5500, c);
    const off = fresh({ serviceCards: false }); off._store.set('tenants/t1/services/gel', { name: 'Gel manicure', price: 55 });
    check('service cards switched off: refused', !((await gs.startGiftOrder(off, T, { serviceId: 'gel', amount: 1, design: 'frost', buyerName: 'J', buyerEmail: 'j@x.com', recipientName: 'T', via: 'me' }, '')) as any).ok);
    db._store.set('tenants/t1/services/hidden', { name: 'Secret', price: 40, isPrivate: true });
    check('a private service can’t be gifted', !((await gs.startGiftOrder(db, T, { serviceId: 'hidden', amount: 1, design: 'frost', buyerName: 'J', buyerEmail: 'j@x.com', recipientName: 'T', via: 'me' }, '')) as any).ok); }

  console.log('Offers');
  { const go = await import('../../src/lib/gift-offers');
    const offers = go.cleanOffers([{ name: 'Holiday bonus', tiers: [{ buyCents: 20000, bonusCents: 5000 }, { buyCents: 10000, bonusCents: 2000 }, { buyCents: 100, bonusCents: 900 }], startsOn: '2026-11-01', endsOn: '2026-12-31', usableFrom: '2027-01-01', bonusDays: 90, desk: false }]);
    check('steps sorted, a bonus bigger than its card dropped', offers[0].tiers.length === 2 && offers[0].tiers[0].buyCents === 10000, offers[0].tiers);
    check('not running before it starts', go.liveOffer({ offers }, 'online', '2026-10-31') === null);
    check('running in its dates online', go.liveOffer({ offers }, 'online', '2026-12-01')?.name === 'Holiday bonus');
    check('…but not at the desk when switched off there', go.liveOffer({ offers }, 'desk', '2026-12-01') === null);
    check('not running after it ends', go.liveOffer({ offers }, 'online', '2027-01-01') === null);
    check('$99 earns nothing, $100 earns $20, $250 earns $50', go.bonusFor(offers[0], 9900) === 0 && go.bonusFor(offers[0], 10000) === 2000 && go.bonusFor(offers[0], 25000) === 5000);
    const dts = go.bonusDates(offers[0], '2026-12-01'); check('bonus starts Jan 1 and lasts 90 days', dts.usableFrom === '2027-01-01T00:00:00.000Z' && dts.expiresAt.startsWith('2027-04-01'), dts);
    check('the line buyers see', go.offerLine({ ...offers[0], tiers: [offers[0].tiers[0]] }) === 'Buy a $100 gift card, get $20 for you');
    // A bonus made when the gift card is bought online
    const today = go.todayIn('America/New_York');
    const db = fresh({ offers: [{ id: 'hol', name: 'Holiday bonus', tiers: [{ buyCents: 10000, bonusCents: 2000 }], startsOn: today, endsOn: null, usableFrom: null, bonusDays: 60 }] });
    db._store.set('tenants/t1/giftOrders/o9', { id: 'o9', status: 'pending', amountCents: 10000, design: 'frost', buyerName: 'Jess', buyerEmail: 'j@x.com', recipientName: 'Tia', via: 'me' });
    await gs.completeGiftOrder(db, T, 'o9', { sessionId: 's9', amountTotal: 10000 });
    const all = [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/giftCards/')).map(([, v]) => v as any);
    const gift = all.find((c) => !c.promo), bonus = all.find((c) => c.promo);
    check('the gift stays whole at $100', gift?.initialCents === 10000, gift);
    check('a separate $20 bonus for the buyer', bonus?.initialCents === 2000 && bonus?.recipientEmail === 'j@x.com' && bonus?.offerId === 'hol', bonus);
    check('the bonus ends (60 days)', !!bonus?.expiresAt && Math.round((Date.parse(bonus.expiresAt) - Date.now()) / 864e5) >= 59);
    check('the order remembers the bonus', db._store.get('tenants/t1/giftOrders/o9').bonusCents === 2000);
    const tx = [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/transactions/')).map(([, v]) => v as any);
    check('only the $100 is recorded as a sale', tx.length === 1 && tx[0].amount === 100, tx);
    const info: any = await gs.shopInfo(db, T); check('the shop shows the offer', info.offer?.line === 'Buy a $100 gift card, get $20 for you', info.offer);
    db._store.set('tenants/t1/appointments/a9', { status: 'pending_payment', depositAmountCents: 1000, clientId: 'c1', clientName: 'Jess', clientEmail: 'j@x.com', serviceName: 'Gel manicure', startTime: '2026-12-20T14:00:00.000Z' });
    const dep: any = await gs.payDepositWithGiftCard(db, T, 'a9', bonus.code, ''); check('a bonus can’t pay a deposit', !dep.ok && /Bonus cards/.test(dep.error), dep);
    // A bonus that starts later can't be used yet
    db._store.set('tenants/t1/giftCards/later', { id: 'later', code: 'LATE-RRRR', codeKey: 'LATERRRR', balanceCents: 2000, initialCents: 2000, status: 'active', holds: {}, history: [], promo: true, usableFrom: '2099-01-01T00:00:00.000Z', expiresAt: '2099-04-01T00:00:00.000Z' });
    const h: any = await gc.holdGiftCard(db, T, { id: 'later', holdId: 'h', cents: 500 }); check('a bonus can’t be used before its start date', !h.ok && /can be used from/.test(h.error), h);
    // No offer running → no bonus
    const db2 = fresh(); db2._store.set('tenants/t1/giftOrders/o8', { id: 'o8', status: 'pending', amountCents: 10000, design: 'frost', buyerName: 'Jess', buyerEmail: 'j@x.com', recipientName: 'Tia', via: 'me' });
    await gs.completeGiftOrder(db2, T, 'o8', { sessionId: 's8', amountTotal: 10000 });
    check('no offer, no bonus', ![...db2._store.values()].some((v: any) => v?.promo)); }

  console.log('Chip in');
  { const G = await import('../../src/lib/gift-groups'); const db = fresh();
    const soon = new Date(Date.now() + 3 * 864e5).toISOString();
    db._store.set('tenants/t1/giftGroups/g1', { id: 'g1', status: 'collecting', design: 'o-birthday', line: 'HAPPY BIRTHDAY', organizerName: 'Jess Marshall', organizerEmail: 'jess@x.com', recipientName: 'Tia Grant', via: 'me', recipientEmail: null, recipientPhone: null, message: 'Happy birthday!', sendAt: soon, goalCents: 25000, totalCents: 0, count: 0, names: [] });
    const chip = (id: string, name: string, cents: number, msg: string | null, organizer = false) => db._store.set(`tenants/t1/giftOrders/${id}`, { id, status: 'pending', kind: 'chip', groupId: 'g1', organizer, amountCents: cents, design: 'o-birthday', buyerName: name, buyerEmail: `${id}@x.com`, message: msg, recipientName: 'Tia Grant', via: 'me', stripeAccountId: 'acct_1' });
    chip('c1', 'Jess Marshall', 5000, null, true); chip('c2', 'Maya Lee', 3000, 'Can’t wait to see the new set'); chip('c3', 'Ana Ruiz', 2000, 'Love you!'); chip('c4', 'Rosa Diaz', 4000, null);
    for (const [id, c] of [['c1', 5000], ['c2', 3000], ['c3', 2000]] as const) await gs.completeGiftOrder(db, T, id, { sessionId: `s_${id}`, paymentIntent: `pi_${id}`, amountTotal: c });
    await gs.completeGiftOrder(db, T, 'c2', { sessionId: 's_c2', amountTotal: 3000 });
    const g: any = db._store.get('tenants/t1/giftGroups/g1');
    check('three shares add up to $100 (a repeat confirm counts once)', g.totalCents === 10000 && g.count === 3, g);
    check('no card yet — it’s made on the day', ![...db._store.keys()].some((k) => k.startsWith('tenants/t1/giftCards/')));
    const tx = [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/transactions/')).map(([, v]) => v as any);
    check('each share is recorded as gift card money held', tx.length === 3 && tx.every((x) => x.category === 'Gift Card Sales' && x.taxBucket === 'transfer'), tx);
    const share: any = await G.groupView(db, T, 'g1', 'share'); const org: any = await G.groupView(db, T, 'g1', 'org');
    check('friends see names, not amounts', share.names.join(',') === 'Jess,Maya,Ana' && !share.chips, share);
    check('the organizer sees each share', org.chips.length === 3 && org.chips.some((c: any) => c.cents === 3000 && c.name === 'Maya Lee'), org.chips);
    check('the two links are different, and a made-up one fails', G.roleFor(T, 'g1', G.groupKey(T, 'g1', 'share'), null) === 'share' && G.roleFor(T, 'g1', null, G.groupKey(T, 'g1', 'org')) === 'org' && G.roleFor(T, 'g1', 'nope', 'nope') === null && G.roleFor(T, 'g1', G.groupKey(T, 'g1', 'share'), G.groupKey(T, 'g1', 'share')) === 'share');
    const f: any = await G.finishGroup(db, T, 'g1'); const card: any = db._store.get(`tenants/t1/giftCards/${f.cardId}`);
    check('one $100 card for Tia', f.ok && card.initialCents === 10000 && card.recipientName === 'Tia Grant', { f, card });
    check('it’s from everyone, with their notes', card.purchaserName === 'Jess, Maya and Ana' && card.givers === 3 && card.notes.length === 2, card);
    check('only the shares were sales — making the card adds nothing', [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/transactions/')).length === 3);
    check('sent once only', !(await G.finishGroup(db, T, 'g1') as any).ok);
    await gs.completeGiftOrder(db, T, 'c4', { sessionId: 's_c4', amountTotal: 4000 });
    const late: any = db._store.get('tenants/t1/giftOrders/c4'); check('a share paid after it was sent isn’t added (it’s refunded)', late.late === true && db._store.get(`tenants/t1/giftCards/${f.cardId}`).balanceCents === 10000, late);
    check('the names line', G.namesLine(['Jess M', 'Maya', 'Ana', 'Rosa', 'Kim']) === 'Jess, Maya, Ana and 2 others' && G.namesLine(['Jess', 'Maya']) === 'Jess and Maya');
    // nobody paid → cancelled, no card
    db._store.set('tenants/t1/giftGroups/g2', { id: 'g2', status: 'collecting', design: 'frost', organizerName: 'J', organizerEmail: 'j@x.com', recipientName: 'Kim', via: 'me', sendAt: soon, totalCents: 0, count: 0, names: [] });
    const e: any = await G.finishGroup(db, T, 'g2'); check('nothing paid → nothing made', !e.ok && db._store.get('tenants/t1/giftGroups/g2').status === 'cancelled');
    const mv: any = await G.moveGroup(db, T, 'g1', new Date(Date.now() + 864e5).toISOString()); check('can’t move a gift that’s been sent', !mv.ok); }

  console.log('Company orders');
  { const B = await import('../../src/lib/gift-bulk'); const db = fresh();
    const rows = B.parseList('Name\tEmail\tAmount\nAna Ruiz\tana@acme.co\t75\nBen Ortiz\t(713) 555-0142\nCara Lee, cara@acme\n, dev@acme.co, 50\n"Park, Eli", eli@acme.co, $150', 5000);
    check('reads a pasted list (tabs or commas, header skipped)', rows.length === 5 && rows[0].cents === 7500 && rows[1].phone && rows[1].cents === 5000 && rows[4].name === 'Park, Eli' && rows[4].cents === 15000, rows);
    check('flags a bad email and a missing name', rows[2].problem === 'Check the email or number' && rows[3].problem === 'Add a name', rows);
    const bad: any = await B.saveBulk(db, T, { company: 'Acme', contactEmail: 'dana@acme.co', defaultAmount: 50, rows }, 'Jess'); const id = bad.order.id;
    check('saved: 3 good rows, $275, 2 to fix', bad.ok && bad.order.count === 3 && bad.order.totalCents === 27500 && bad.order.problems === 2, bad.order);
    const inv: any = await B.sendBulkInvoice(db, T, id, ''); check('no invoice while rows need fixing', !inv.ok && /Fix the 2/.test(inv.error), inv);
    const ok: any = await B.saveBulk(db, T, { id, company: 'Acme', contactEmail: 'dana@acme.co', defaultAmount: 50, message: 'Thank you for a great year', design: 'marble', line: 'THANK YOU', rows: rows.filter((r) => !r.problem).map((r) => ({ name: r.name, contact: r.email || r.phone, cents: r.cents })) }, 'Jess');
    check('fixed: 3 cards, $275, nothing to fix', ok.order.count === 3 && ok.order.problems === 0);
    check('no cards until it’s paid', ![...db._store.keys()].some((k) => k.startsWith('tenants/t1/giftCards/')));
    const view: any = await B.bulkView(db, T, id); check('the company’s page hides the contacts', view.rows[0].to === 'a•••@acme.co' && /•••\d{4}/.test(view.rows[1].to), view.rows);
    const paid: any = await B.markBulkPaid(db, T, id, { via: 'check', by: 'Jess' });
    const cards = [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/giftCards/')).map(([, v]) => v as any);
    check('paid by check: one card each', paid.ok && paid.made === 3 && cards.length === 3 && cards.every((c) => c.purchaserName === 'Acme' && c.bulkId === id && c.message === 'Thank you for a great year'), paid);
    check('each person’s own amount', cards.map((c) => c.initialCents).sort().join(',') === '15000,5000,7500', cards.map((c) => c.initialCents));
    const tx = [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/transactions/')).map(([, v]) => v as any);
    check('the money is recorded once, as gift card money held', tx.length === 1 && tx[0].amount === 275 && tx[0].paymentMethod === 'Check' && tx[0].taxBucket === 'transfer', tx);
    check('paying twice makes nothing more', !(await B.markBulkPaid(db, T, id, { via: 'card', by: 'Online' }) as any).ok && [...db._store.keys()].filter((k) => k.startsWith('tenants/t1/giftCards/')).length === 3);
    check('a paid order can’t be changed or cancelled', !(await B.saveBulk(db, T, { id, company: 'Acme', rows: [] }, 'x') as any).ok && !(await B.cancelBulk(db, T, id, 'x') as any).ok);
    const req: any = await B.requestBulk(db, T, { company: 'Bayou Dental', contactName: 'Dana', contactEmail: 'dana@bayou.com', count: 24, each: 75 });
    const r: any = [...db._store.values()].find((v: any) => v?.company === 'Bayou Dental'); check('a company can ask from the shop', req.ok && r.status === 'requested' && r.askedCount === 24 && r.defaultCents === 7500, r);
    check('…and its page isn’t open until it’s set up', (await B.bulkView(db, T, r.id)) === null); }

  console.log('Find my card + wallet');
  { const db = fresh(); db._store.set('tenants/t1/clients/c1', { name: 'Tia', phone: '(832) 555-0100', email: 'tia@x.com' });
    await gc.issueGiftCard(db, T, { amountCents: 3000, by: 'x', source: 'desk', recipient: { name: 'Tia', email: 'tia@x.com' } });
    await gc.issueGiftCard(db, T, { amountCents: 2000, by: 'x', source: 'desk', recipient: { id: 'c1', name: 'Tia' } });
    await gc.issueGiftCard(db, T, { amountCents: 1000, by: 'x', source: 'desk', recipient: { name: 'Bo', phone: '+18325550199' } });
    const r: any = await gs.findMyCards(db, T, 'Nobody@x.com', ''); check('unknown contact: same calm answer', r.ok);
    const bad: any = await gs.findMyCards(db, T, 'hi', ''); check('nonsense refused', !bad.ok);
    const ck = 'e:tia@x.com'; const path = gs.walletPath(T, ck); const u = new URL('http://x' + path);
    const w: any = await gs.walletView(db, T, u.searchParams.get('c')!, u.searchParams.get('k')!); check('wallet by email finds both of Tia’s cards', w && w.length === 2, w?.map((x: any) => x.balanceCents));
    const wp: any = await gs.walletView(db, T, Buffer.from('p:8325550100').toString('base64url'), new URL('http://x' + gs.walletPath(T, 'p:8325550100')).searchParams.get('k')!);
    check('wallet by phone finds her card through her client record', wp && wp.length === 1, wp);
    const forged: any = await gs.walletView(db, T, u.searchParams.get('c')!, 'wrongkey'); check('a forged link shows nothing', forged === null); }

  console.log('Deposit with a gift card');
  { const db = fresh(); db._store.set('tenants/t1/appointments/a1', { status: 'pending_payment', depositAmountCents: 2000, clientId: 'c1', clientName: 'Tia', clientEmail: 'tia@x.com', serviceName: 'Gel manicure', startTime: '2026-10-20T14:00:00.000Z' });
    const { card } = (await gc.issueGiftCard(db, T, { amountCents: 7500, by: 'x', source: 'desk' })) as any; const { card: small } = (await gc.issueGiftCard(db, T, { amountCents: 1000, by: 'x', source: 'desk' })) as any;
    const s: any = await gs.payDepositWithGiftCard(db, T, 'a1', small.code, ''); check('a card with less than the deposit is kept for the visit', !s.ok && /not quite/.test(s.error), s);
    const r: any = await gs.payDepositWithGiftCard(db, T, 'a1', card.code, ''); const a = db._store.get('tenants/t1/appointments/a1');
    check('covers it: booking confirmed, paid by gift card', r.ok && a.status === 'confirmed' && a.depositStatus === 'paid' && a.depositPaidVia === 'gift_card', { r, a });
    check('$55 left on the card', db._store.get(`tenants/t1/giftCards/${card.id}`).balanceCents === 5500);
    const credits = [...db._store.entries()].filter(([k]) => k.includes('/depositCredits/')); check('one deposit credit for the visit', credits.length === 1 && credits[0][1].amountCents === 2000);
    const again: any = await gs.payDepositWithGiftCard(db, T, 'a1', card.code, ''); check('paying again takes nothing more', again.ok && again.already && db._store.get(`tenants/t1/giftCards/${card.id}`).balanceCents === 5500);
    db._store.set('tenants/t1/appointments/a2', { status: 'pending_payment', depositAmountCents: 2000, isRenterBooking: true });
    check('a renter’s booking deposit stays on card', !((await gs.payDepositWithGiftCard(db, T, 'a2', card.code, '')) as any).ok); }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
