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
