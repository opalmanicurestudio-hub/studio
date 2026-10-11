// scripts/verify/moving-in.verify.ts — checks the moving-in server logic (membership renewals that wait for a card,
// the cards-on-file list, the welcome page, starter menus) against an in-memory database.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/moving-in.verify.ts
import { makeDb, check, failures } from './fake-db';

(async () => {
  const R = await import('../../src/lib/memberships/renewals');
  const C = await import('../../src/lib/card-save');
  const W = await import('../../src/lib/welcome');
  const S = await import('../../src/lib/starter-menus');
  const T = 't1'; const past = new Date(Date.now() - 864e5).toISOString(); const soon = new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString();
  const fresh = () => { const db = makeDb(); db._store.set('tenants/t1', { name: 'Opal', timezone: 'America/New_York' });
    db._store.set('tenants/t1/memberships/gel', { name: 'Gel monthly', price: 65, interval: 'monthly' }); db._store.set('tenants/t1/memberships/free', { name: 'Friends', price: 0, interval: 'monthly' });
    db._store.set('tenants/t1/staff/o1', { name: 'Jess', role: 'owner' }); return db; };

  console.log('Membership renewals');
  { const db = fresh();
    db._store.set('tenants/t1/clients/maria', { name: 'Maria Lopez', phone: '7135550101', subscription: { membershipId: 'gel', status: 'active', nextBillingDate: past }, cardLink: { sentAt: past, count: 1 } });
    db._store.set('tenants/t1/clients/keisha', { name: 'Keisha Moore', phone: '7135550102', subscription: { membershipId: 'gel', status: 'active', nextBillingDate: past } });
    db._store.set('tenants/t1/clients/dana', { name: 'Dana Reed', subscription: { membershipId: 'free', status: 'active', nextBillingDate: past } });
    db._store.set('tenants/t1/clients/tia', { name: 'Tia', subscription: { membershipId: 'gel', status: 'active', nextBillingDate: soon } });
    const dry: any = await R.runRenewals(db, T, { dryRun: true });
    check('dry run: a moved-in member waits, one with no card goes past due, a free plan renews', dry.results.find((r: any) => r.clientId === 'maria')?.outcome === 'would_wait_for_card' && dry.results.find((r: any) => r.clientId === 'keisha')?.outcome === 'would_mark_past_due' && dry.results.find((r: any) => r.clientId === 'dana')?.outcome === 'would_renew_free', dry.results);
    check('dry run writes nothing', db._store.get('tenants/t1/clients/maria').subscription.status === 'active' && !db._store.get('tenants/t1/clients/maria').subscription.waitingForCardSince);
    const r: any = await R.runRenewals(db, T, {});
    const maria = db._store.get('tenants/t1/clients/maria'); const keisha = db._store.get('tenants/t1/clients/keisha'); const dana = db._store.get('tenants/t1/clients/dana');
    check('waiting for a card: still active, nothing failed', maria.subscription.status === 'active' && !!maria.subscription.waitingForCardSince && r.waiting === 1, maria.subscription);
    check('no card and never asked: past due', keisha.subscription.status === 'past_due' && !!keisha.subscription.pastDueSince);
    check('a free plan moves on a month', dana.subscription.status === 'active' && Date.parse(dana.subscription.nextBillingDate) > Date.now());
    check('not due yet: left alone', db._store.get('tenants/t1/clients/tia').subscription.nextBillingDate === soon);
    const notes = [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/notifications/')).map(([, v]) => v as any);
    check('the owner is told once about each', notes.filter((n) => n.type === 'membership_waiting_card').length === 1 && notes.filter((n) => n.type === 'membership_payment_failed').length === 1, notes.map((n) => n.type));
    await R.runRenewals(db, T, {});
    const notes2 = [...db._store.entries()].filter(([k]) => k.startsWith('tenants/t1/notifications/')).length;
    check('the next day: no repeat notices', notes2 === notes.length, notes2);
    const tx = [...db._store.keys()].filter((k) => k.startsWith('tenants/t1/transactions/')).length; check('nothing recorded as paid when nothing was charged', tx === 1, tx);   // the free renewal only
    // grace period: past due for 6 days → lapses
    db._store.set('tenants/t1/clients/keisha', { ...keisha, subscription: { ...keisha.subscription, pastDueSince: new Date(Date.now() - 6 * 864e5).toISOString() } });
    await R.runRenewals(db, T, {}); const k2 = db._store.get('tenants/t1/clients/keisha');
    check('past the 5-day grace period: the membership lapses', k2.subscription.status === 'canceled' && k2.activeMembershipId === null, k2.subscription);
    // a card that's saved without a customer can't be charged — still waits
    db._store.set('tenants/t1/clients/maria', { ...db._store.get('tenants/t1/clients/maria'), cardOnFile: { paymentMethodId: null, brand: 'visa', last4: '4242' } });
    const r3: any = await R.runRenewals(db, T, { dryRun: true }); check('a card with no customer isn’t treated as chargeable', r3.results.find((x: any) => x.clientId === 'maria')?.hasUsableCard === false); }

  console.log('Long-overdue renewals');
  { const db = fresh(); const old = new Date(Date.now() - 60 * 864e5).toISOString();
    db._store.set('tenants/t1/clients/z', { name: 'Old Data', subscription: { membershipId: 'gel', status: 'active', nextBillingDate: old }, cardOnFile: { paymentMethodId: 'pm_1', customerId: 'cus_1' } });
    const r: any = await R.runRenewals(db, T, {}); const z = db._store.get('tenants/t1/clients/z');
    check('a renewal 60 days overdue is held, not charged', r.results[0]?.outcome === 'held_overdue' && !!z.subscription.renewalHeld && z.subscription.status === 'active', r.results);
    check('…and the owner is asked to check it', [...db._store.values()].some((v: any) => v?.type === 'membership_renewal_held')); }

  console.log('Cards on file');
  { const db = fresh();
    db._store.set('tenants/t1/clients/a', { name: 'Has Card', subscription: { membershipId: 'gel', status: 'active', nextBillingDate: soon }, cardOnFile: { paymentMethodId: 'pm_1', customerId: 'cus_1', brand: 'visa', last4: '4242', savedAt: past } });
    db._store.set('tenants/t1/clients/b', { name: 'No Customer', phone: '7135550199', subscription: { membershipId: 'gel', status: 'active', nextBillingDate: soon }, cardOnFile: { paymentMethodId: 'pm_2', brand: 'visa', last4: '1111' } });
    db._store.set('tenants/t1/clients/c', { name: 'Lapsed', subscription: { membershipId: 'gel', status: 'canceled', nextBillingDate: soon } });
    const list: any[] = await C.membersCards(db, T);
    check('only current members, the ones without a usable card first', list.length === 2 && list[0].clientId === 'b' && !list[0].card && list[1].card?.last4 === '4242', list);
    check('a card saved with no customer needs adding again', list[0].card === null);
    check('links are private to each client', C.cardKey(T, 'a') !== C.cardKey(T, 'b') && C.cardPath(T, 'a').includes(`k=${C.cardKey(T, 'a')}`));
    const view: any = await C.cardView(db, T, 'b'); check('the add-your-card page shows their plan and next charge', view.membership?.name === 'Gel monthly' && view.membership.price === 65 && view.membership.nextCharge === soon && view.card === null, view);
    const nothing = await C.cardReminderSweep(db, T); check('no reminder before a link was ever sent', nothing === 0); }

  console.log('Welcome page');
  { const db = fresh(); const next = new Date(Date.now() + 9 * 864e5).toISOString();
    db._store.set('tenants/t1/clients/m', { name: 'Maria Lopez', giftBalanceCents: 4000, subscription: { membershipId: 'gel', status: 'active', nextBillingDate: soon } });
    db._store.set('tenants/t1/services/gel', { name: 'Gel manicure', isActive: true }); db._store.set('tenants/t1/staff/ana', { name: 'Ana Ruiz' });
    db._store.set('tenants/t1/appointments/p1', { clientId: 'm', serviceId: 'gel', staffId: 'ana', startTime: new Date(Date.now() - 20 * 864e5).toISOString(), status: 'completed' });
    db._store.set('tenants/t1/appointments/n1', { clientId: 'm', serviceId: 'gel', staffId: 'ana', serviceName: 'Gel manicure', startTime: next, status: 'confirmed' });
    db._store.set('tenants/t1/appointments/x1', { clientId: 'm', startTime: new Date(Date.now() + 2 * 864e5).toISOString(), status: 'cancelled' });
    const v: any = await W.helloView(db, T, 'm');
    check('first name, history, next visit (not the cancelled one), gift card, membership', v.firstName === 'Maria' && v.history === 1 && v.next?.at === next && v.giftCents === 4000 && v.membership === 'Gel monthly', v);
    check('book her usual with the same person', v.again?.label === 'Book with Ana again — Gel manicure' && v.again.href.includes('service=gel') && v.again.href.includes('staff=ana'), v.again);
    db._store.set('tenants/t1/services/gel', { name: 'Gel manicure', isPrivate: true }); const v2: any = await W.helloView(db, T, 'm');
    check('a hidden service isn’t offered', v2.again === null);
    check('the link is signed per client', W.helloKey(T, 'm') !== W.helloKey(T, 'n') && W.helloPath(T, 'm').endsWith(`k=${W.helloKey(T, 'm')}`)); }

  console.log('Moving in, part 3 — reading files');
  { const IR = await import('../../src/lib/import-records');
    const read = (kind: any, csv: string) => { const rows = IR.parseCsv(csv); const map = IR.autoMatch(kind, rows[0]); return rows.slice(1).map((c, i) => IR.cleanRow(kind, c, map, i + 2)); };
    const m = read('memberships', 'Member Name,Email,Membership,Price,Billing Frequency,Next Billing Date,Status\nMaria Lopez,maria@x.com,Gel monthly,$65.00,Monthly,10/28/2026,Active\nKeisha Moore,k@x.com,Mani club,45,Every 2 weeks,11/02/2026,Active\nOld One,o@x.com,Gel monthly,65,Monthly,10/28/2026,Cancelled\nNo Date,n@x.com,Gel monthly,65,Monthly,,Active');
    check('members: plan, price, monthly, next charge', m[0].data.plan === 'Gel monthly' && m[0].data.price === 65 && m[0].data.interval === 'monthly' && m[0].data.next === '2026-10-28', m[0]);
    check('an unusual billing cycle is flagged (set up as monthly)', m[1].problems.some((p: string) => /monthly/.test(p)));
    check('cancelled members and members with no next date are left out', !!m[2].skip && !!m[3].skip, [m[2].skip, m[3].skip]);
    const b = read('balances', 'Client,Email,Account Balance,Notes\nAna Ruiz,ana@x.com,25.00,Refund credit\nBen Ortiz,ben@x.com,-40,No-show fee\nCara Lee,cara@x.com,0,');
    check('a positive balance is credit, a negative one is owed, zero is left out', b[0].data.credit === 25 && b[1].data.owed === 40 && !!b[2].skip, b.map((x: any) => x.data));
    const b2 = read('balances', 'Client,Store Credit,Amount Owed\nDee,10,5');
    check('credit and owed in separate columns', b2[0].data.credit === 10 && b2[0].data.owed === 5);
    const f = read('formulas', 'Client,Date,Stylist,Formula\nMaria Lopez,2026-09-01,Ana,6N + 20 vol 35 min');
    check('formula notes with date and who did it', f[0].data.formula === '6N + 20 vol 35 min' && f[0].data.date === '2026-09-01' && f[0].data.staff === 'Ana', f[0].data);
    const d = read('discounts', 'Promo Code,Discount,Type,Expiration Date,Usage Limit,Times Used\nWELCOME10,10%,,,100,12\nSAVE5,5,Fixed,,,\nTWENTY,20,,,,\nOLD,15%,,2020-01-01,,');
    check('discount codes: percent, dollars, a bare number read as percent (flagged), ended ones left out', d[0].data.type === 'percentage' && d[0].data.value === 10 && d[0].data.limit === 100 && d[0].data.used === 12 && d[1].data.type === 'fixed' && d[1].data.value === 5 && d[2].data.type === 'percentage' && d[2].problems.length === 1 && !!d[3].skip, d.map((x: any) => x.data));
    check('files are recognized by their columns', IR.guessKind(['Client', 'Membership', 'Next Billing Date']) === 'memberships' && IR.guessKind(['Promo Code', 'Discount']) === 'discounts' && IR.guessKind(['Client', 'Color Formula']) === 'formulas' && IR.guessKind(['Client', 'Store Credit']) === 'balances'); }

  console.log('Moving in, part 3 — saving');
  { const M = await import('../../src/lib/import-more'); const db = fresh(); const o = { importId: 'imp1', app: 'Vagaro' };
    db._store.set('tenants/t1/clients/maria', { name: 'Maria Lopez', email: 'maria@x.com' });
    const mm: any = await M.saveMemberships(db, T, [{ client: 'Maria Lopez', name: 'Maria Lopez', email: 'maria@x.com', plan: 'Gel monthly', price: 65, interval: 'monthly', next: '2026-10-28' }, { client: 'New Member', name: 'New Member', email: 'nm@x.com', plan: 'VIP club', price: 99, interval: 'monthly', next: '2026-11-05' }], o);
    const maria = db._store.get('tenants/t1/clients/maria');
    check('a member joins your existing plan with their next charge', maria.subscription?.membershipId === 'gel' && maria.subscription.nextBillingDate.startsWith('2026-10-28') && maria.activeMembershipId === 'gel', maria.subscription);
    const vip: any = [...db._store.values()].find((v: any) => v?.name === 'VIP club'); check('a plan that isn’t here is made, hidden from sale', vip?.isPrivate === true && vip.price === 99 && mm.made === 1 && mm.clientsAdded === 1);
    const cards: any[] = await C.membersCards(db, T); check('they show on Cards on file without a card', cards.length === 2 && cards.every((c) => !c.card));
    const again: any = await M.saveMemberships(db, T, [{ client: 'Maria Lopez', name: 'Maria Lopez', email: 'maria@x.com', plan: 'Gel monthly', price: 65, interval: 'monthly', next: '2026-12-01' }], { importId: 'imp2', app: 'Vagaro' });
    check('someone already a member here is left as they are', again.skipped === 1 && db._store.get('tenants/t1/clients/maria').subscription.nextBillingDate.startsWith('2026-10-28'));
    const bb: any = await M.saveBalances(db, T, [{ client: 'Maria Lopez', name: 'Maria Lopez', email: 'maria@x.com', credit: 25, owed: 0, note: 'Refund credit' }, { client: 'Ben', name: 'Ben', email: 'ben@x.com', credit: 0, owed: 40, note: 'No-show fee' }], o);
    const credit: any = [...db._store.entries()].find(([k]) => k.includes('/depositCredits/'))?.[1]; const ben: any = [...db._store.values()].find((v: any) => v?.name === 'Ben');
    check('store credit becomes credit they can use', credit?.amountCents === 2500 && credit.status === 'available' && credit.clientId === 'maria' && bb.creditCents === 2500, credit);
    check('what they owe goes on their balance', ben?.outstandingBalance === 40 && ben.unpaidFees?.[0]?.feeAmount === 40 && /No-show/.test(ben.unpaidFees[0].reason), ben);
    const ff: any = await M.saveFormulas(db, T, [{ client: 'Maria Lopez', name: 'Maria Lopez', email: 'maria@x.com', formula: '6N + 20 vol', date: '2026-09-01', staff: 'Ana', service: 'Color' }], o);
    const mf = db._store.get('tenants/t1/clients/maria').customFormulas; check('formula notes are kept on the client, newest first', ff.added === 1 && mf[0].text === '6N + 20 vol' && mf[0].name === 'Color · Ana', mf);
    const ff2: any = await M.saveFormulas(db, T, [{ client: 'Maria Lopez', name: 'Maria Lopez', email: 'maria@x.com', formula: '6N + 20 vol', date: '2026-09-01' }], o); check('the same note isn’t added twice', ff2.added === 0);
    db._store.set('tenants/t1/discounts/x', { code: 'WELCOME10' });
    const dd: any = await M.saveDiscounts(db, T, [{ code: 'WELCOME10', type: 'percentage', value: 10 }, { code: 'SAVE5', type: 'fixed', value: 5, limit: 50, used: 3, ends: '2027-01-31' }], o);
    const save5: any = [...db._store.values()].find((v: any) => v?.code === 'SAVE5'); check('codes come in with limits and uses; one already here is skipped', dd.added === 1 && dd.skipped === 1 && save5.usageLimit === 50 && save5.usageCount === 3 && save5.validUntil === '2027-01-31' && save5.isActive === true, save5); }

  console.log('Starter menus');
  { check('five menus, every service with a length and no price', S.STARTER_MENUS.length === 5 && S.STARTER_MENUS.every((m) => m.services.every((x: any) => x.duration > 0 && !('price' in x))));
    check('the nail menu has 18 services', S.STARTER_MENUS.find((m) => m.id === 'nails')?.services.length === 18);
    check('the right menu is suggested', S.suggestMenu({ name: 'Opal Nail Bar', businessType: 'salon' }) === 'nails' && S.suggestMenu({ businessType: 'spa' }) === 'spa' && S.suggestMenu({ name: 'Fade Kings Barber' }) === 'barber' && S.suggestMenu({ businessType: 'salon', name: 'Curl Studio' }) === 'hair'); }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
