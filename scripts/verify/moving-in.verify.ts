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

  console.log('Starter menus');
  { check('five menus, every service with a length and no price', S.STARTER_MENUS.length === 5 && S.STARTER_MENUS.every((m) => m.services.every((x: any) => x.duration > 0 && !('price' in x))));
    check('the nail menu has 18 services', S.STARTER_MENUS.find((m) => m.id === 'nails')?.services.length === 18);
    check('the right menu is suggested', S.suggestMenu({ name: 'Opal Nail Bar', businessType: 'salon' }) === 'nails' && S.suggestMenu({ businessType: 'spa' }) === 'spa' && S.suggestMenu({ name: 'Fade Kings Barber' }) === 'barber' && S.suggestMenu({ businessType: 'salon', name: 'Curl Studio' }) === 'hair'); }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
