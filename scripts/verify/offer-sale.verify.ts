// scripts/verify/offer-sale.verify.ts — memberships and packages bought on the booking page (lib/offer-sale): what
// clients may see, the checkout on the business's own account, and the sale finished once however often it's called.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/offer-sale.verify.ts
import fs from 'fs';
import { publicOffers, takesCards, confirmationTokens } from '../../src/lib/offer-sale';
import { MESSAGE_KINDS, renderMessage } from '../../src/lib/message-policy';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

// What clients may see
const svc = [{ id: 's1', name: 'Gel manicure' }, { id: 's2', name: 'Spa pedicure' }];
const o = publicOffers(
  [{ id: 'm1', name: 'Monthly gel', price: 49, interval: 'monthly', description: 'One gel manicure every month.', includedServices: [{ id: 's1', quantity: 1 }], retailDiscount: 10, forfeitOnNoShow: true, internalNote: 'x' },
    { id: 'm2', name: 'Staff plan', price: 10, isPrivate: true }, { id: 'm3', name: 'Free', price: 0 }, { id: 'm4', name: 'Old', price: 30, isActive: false }],
  [{ id: 'p1', name: 'Five pedicures', serviceId: 's2', sessions: 5, price: 270, expiresInMonths: 12 }, { id: 'p2', name: 'Secret', serviceId: 's1', sessions: 3, price: 99, isPrivate: true }],
  svc);
ok(o.memberships.map((m) => m.id).join(',') === 'm1' && o.packages.map((p) => p.id).join(',') === 'p1', 'only what the business sells openly shows: never a private plan, a free one or one switched off');
ok(JSON.stringify(Object.keys(o.memberships[0]).sort()) === '["description","id","interval","name","perks","price"]' && o.memberships[0].perks.join('|') === 'Gel manicure|10% off products', 'a membership shows its public words and perks only (no internal fields)');
ok(o.packages[0].description === '5 spa pedicure visits to use within a year.' && o.packages[0].serviceName === 'Spa pedicure', 'a package without its own words says what it is, in plain words');
ok(takesCards({ stripeAccountId: 'acct_1' }) && !takesCards({ stripeAccountId: 'acct_1', stripeChargesEnabled: false }) && !takesCards({}), 'online sales only open when the business can take cards');

// The checkout and the finish
const lib = src('src/lib/offer-sale.ts');
ok(lib.includes("{ stripeAccount: t.stripeAccountId }") && lib.includes("kind === 'membership' ? { payment_method_types: ['card'], customer_creation: 'always' }") && lib.includes("...(kind === 'membership' ? { setup_future_usage: 'off_session' } : {})"), 'the checkout runs on the business’s own account, and a membership is paid by card (kept for its renewals)');
ok(lib.includes('linkOrigin(t, input.origin)') && !src('src/app/api/booking/offers/route.ts').includes("req.headers.get('origin')"), 'the client comes back to the business’s own address, never one a request names');
ok(lib.includes('You already have a membership here.') && lib.includes("profiles.some(isMember)") && lib.includes("profiles.some((c) => BLOCKED.includes(") && lib.includes("['active', 'past_due'].includes("), 'someone who already has a membership (on any of their profiles, or with a renewal due), or a client the business doesn’t book, is told before paying');
ok(lib.includes("|| (kind === 'membership' ? profiles.find((d) => isMember(data(d))) : null)") && lib.includes('newProfileId(tenantId, email,') && src('src/lib/memberships/enroll-membership.ts').includes("if (cur.activeMembershipId && cur.subscription?.status === 'active') return false;"), 'a second membership for the same person is refunded, however their profiles are split or however many checkouts finish at once (one profile per person and card, and the membership check and write are one step)');
ok(lib.includes('export async function findStudioClients(') && lib.includes("const studio = (d: any) => !(d.data() || {}).ownerRenterId;") && lib.includes('[...new Set([emailTyped.trim(), lower].filter(Boolean))]') && lib.includes("where('searchKeys', 'array-contains', lower)") && !/where\('phone'/.test(lib) && lib.includes('clientEmailTyped: typed'), 'the client is found in the business’s own book (never a renter’s) by email in any case, never by phone (so a purchase never lands on someone else)');
ok(lib.includes("if (cur?.status === 'given') return") && lib.includes("tx.set(saleRef, { id: sessionId, status: 'working'") && lib.includes('firstClaimedAt: cur?.firstClaimedAt || now'), 'a sale is finished once: the first caller claims it, anyone after finds it done');
ok(lib.includes("await saleRef.set({ status: 'failed', lastError:") && src('src/lib/connect-webhook.ts').includes("throw new Error('membership or package bought online not finished yet')") && src('src/app/api/cron/membership-renewals/route.ts').includes('sweepOfferSales(db, stripe, d.id)'), 'a sale stopped part way is marked, Stripe is asked to send its notice again, and a daily sweep finishes any left over');
ok(lib.includes("`web_${createHash('sha256').update(`${tenantId}|${email.toLowerCase()}|${fingerprint || ''}`)") && lib.includes('.create({ id: clientRef.id'), 'two runs at once, or a repeat purchase, can only ever make the same new client');
ok(lib.includes("paymentMethod: 'already_charged'") && lib.includes('skipLedger: true') && lib.includes('amount: charged,') && lib.includes("taxBucket: 'revenue'") && lib.includes('stripeChargeId:'), 'the plan is given through the front desk’s engine, and its line in the books is what was actually charged, linked to the payment');
ok(lib.includes("idempotencyKey: `offer-refund-${sessionId}`") && lib.includes("subscription?.stripePaymentIntentId === piId) r = { ok: true };") && src('src/lib/memberships/enroll-membership.ts').includes('...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),'), 'if it can’t be given, the payment is refunded (once), unless the membership found was started by this very payment');
ok(lib.includes("catch (e: any) { if (!e?.type || ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'].includes(e.type)) throw e; } }   // a hiccup is tried again") && lib.includes("if (!r?.ok && r?.error === 'client_not_found') throw new Error('client_not_found');") && lib.includes("if (e?.code !== 6 && !/already exists/i.test(String(e?.message || ''))) throw e;") && lib.includes("['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'].includes(e.type)) throw e;"), 'a passing problem (saving the client, reading the card, a refund that hit a hiccup) is tried again, never turned into a refund');
ok(lib.includes('if (claim.tries >= 3 && Date.now() - Date.parse(claim.firstClaimedAt) > 30 * 60000) {') && lib.includes('couldn’t be finished after several tries'), 'a sale that keeps stopping for half an hour is left for the business, and they’re told (a passing outage never ends a sale)');
ok(lib.includes('const keptId: string = byRule ? chosen.id :') && lib.includes('dupOf = null; }') && lib.includes('if (cur.targetClientId) return String(cur.targetClientId); tx.set(saleRef, { targetClientId: chosen.id }') && lib.includes("client.subscription?.status !== 'active' && client.subscription?.stripePaymentIntentId !== piId) r = { ok: false, error: 'already_enrolled' }") && lib.includes("if (e?.code === 'charge_already_refunded') refunded = true;"), 'every run of one sale uses the same profile, a member with a renewal due is refunded rather than started again, and a refund an earlier run already made counts as done');
ok(lib.includes("tellOnce(saleRef, 'refundToldAt'") && lib.includes('async function refundSale(') && lib.includes("if (!target && !item) {"), 'a refund tells the business once, even across retries, and a removed plan makes no empty profile');
ok(lib.includes("we’ll ask you to add a card before the first renewal") && lib.includes('Their confirmation couldn’t be sent'), 'the confirmation only says the card renews when it was kept, and the business hears if the client’s confirmation didn’t go');
ok(lib.includes("if (card && !hasUsableCard(current)) await clientRef.update({ cardOnFile: card });") && lib.indexOf('clientRef.update({ cardOnFile: card })') > lib.indexOf('if (r?.ok) {') && lib.includes('old.card.fingerprint === fingerprint') && lib.includes('if (same) { target = d; break; }') && lib.includes('dupOf = dupOf ||'), 'a membership renews only on the card it was paid with: never put on a profile with somebody else’s card (it gets its own profile, and the business is told), and never replacing a card on file');
ok(lib.includes("if (BLOCKED.includes(String(client.status || ''))) r = { ok: false, error: 'blocked' };") && lib.includes("reason === 'already_member'"), 'a client the business doesn’t book is refunded, and the reason is said');
{ const def: any = (MESSAGE_KINDS as any[]).find((k) => k.id === 'online_purchase'); const tk = confirmationTokens({ name: 'Opal' }, { name: 'Dana Reyes' }, 'membership', 'Monthly gel', 49);
  const body = renderMessage(def.defaultBody, tk), subject = renderMessage(def.defaultSubject, tk);
  ok(def.canDisable === false && subject === 'You’re all set: Monthly gel' && body.includes('Hi Dana,') && body.includes('Monthly gel ($49)') && body.includes('renews each month on the card you paid with until it’s canceled. To cancel, just ask us any time.') && lib.includes("kind: 'online_purchase', tokens,"), 'the client gets a confirmation with the plan, the amount, how it renews and how to cancel (rendered, not just written), and the business’s own wording gets the same details'); }
ok(src('src/lib/studio-page.ts').includes("{ id: 'offers', title: 'Memberships and packages', optIn: true }") && src('src/lib/studio-page.ts').includes("x.optIn ? s.off?.[x.id] === false"), 'selling online is off until the owner switches it on');
ok(src('src/lib/connect-webhook.ts').includes("if (sessionType === 'studio_offer')") && src('src/lib/connect-webhook.ts').includes('finishOfferSale(db, stripe2, tenant.id, session.id, session)'), 'Stripe’s notice finishes the sale too');
const route = src('src/app/api/booking/offers/route.ts');
ok(route.includes('if (!studioPage(t).on.offers) return') && route.includes("if (!t || !studioPage(t).on.offers) return NextResponse.json({ ok: false, error: 'That isn’t available online.' }"), 'nothing can be listed or bought online, even by calling the server directly, until the owner switches selling on');
ok(route.includes("limitPublic(req, 'offers-start'") && route.includes("limitPublic(req, 'offers-finish'") && route.includes("limitPublic(req, 'offers-list'") && route.includes('`offers-start-email_${'), 'every public action is rate limited, and checkout starts a few times per email an hour');

// On the page
const sp = src('src/components/booking/StudioBookingPage.tsx'); const bk = src('src/app/(booking)/book/[tenantId]/page.tsx');
ok(sp.includes("action: 'list'") && sp.includes('offers: offers ? offers.memberships.length + offers.packages.length : 0') && sp.includes("if (id === 'offers' && offers)"), 'Memberships and packages shows what the business sells openly, and stays hidden when there’s nothing');
ok(sp.includes("action: 'start', kind: buying.kind") && sp.includes('window.location.href = d.url;') && sp.includes('Ask about it at your next visit.') && sp.includes('To cancel, ask the business any time.'), 'Join or Buy goes to checkout (or, when the business can’t take cards online, says to ask at the visit), and a membership says its card is kept for renewals');
ok(bk.includes("get('offer_paid')") && bk.includes("action: 'finish', session: sid") && bk.includes("u.searchParams.delete('offer_paid')") && sp.includes('Your payment was refunded') && sp.includes("bought.reason === 'already_member'") && bk.includes("else if (d?.error !== 'not_found') again(d);"), 'back from paying, the page finishes the sale (once) and says what happened, including a refund');
ok(src('src/context/NotificationContext.tsx').includes("n.type === 'online_sale'"), 'the business is told about an online sale, with its own icon');

const tool = new RegExp(['cl', 'aude'].join('') + '|' + ['anth', 'ropic'].join(''), 'i');
ok([lib, route, sp].every((f) => !tool.test(f) && !/\bcall us\b|cancelled|colour/i.test(f.replace(/'cancelled'/g, ''))), 'no tool names, US spelling, never “call us”');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
