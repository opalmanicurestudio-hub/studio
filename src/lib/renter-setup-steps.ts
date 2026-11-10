// src/lib/renter-setup-steps.ts — A RENTER'S SETUP STEPS, each opening the exact screen that finishes it.
//
// "Getting set up" on the portal's Today (components/rent/setup GettingSetUp) lists what a renter still has to do:
// sign the lease, pay the deposit, save a card, put insurance and a license on file, add a W-9, and, for someone who
// takes bookings here, set hours and a service (and, if they want deposits, connect card payments). Every step is
// worked out from what's on file now, never a stored "done" flag, so a step comes back if its reason does (an
// insurance date runs out, the last service is deleted). Each step names the place and screen that finishes it
// (components/rent/portal-map), so a tap goes straight there.
import { credentialViews } from '@/lib/compliance';

export type SetupPlace = 'today' | 'calendar' | 'clients' | 'money' | 'space';
export type SetupStep = {
  key: string; label: string; hint: string; done: boolean; optional: boolean;
  /** What a done step says instead ("Lease signed", not "Sign your lease"). */
  doneLabel: string;
  place: SetupPlace; view: string | null;
  /** Clients can't book them until this is done. */
  blocksBooking?: boolean;
};
export type SetupChecklist = {
  mode: 'studio' | 'own'; modeChosen: boolean; dismissed: boolean;
  /** The business has set them up to take bookings here, so how they take bookings is theirs to choose. */
  canBook: boolean;
  items: SetupStep[]; remaining: number; allDone: boolean; bookingReady: boolean;
  /** Optional steps still open (a W-9, a card), shown even once the required ones are done. */
  optionalLeft: number;
};

const money = (c: number) => `$${(Math.max(0, c || 0) / 100).toFixed(2)}`;

export function renterSetupSteps(o: {
  renter: any; lease: any | null; deposit: any | null; provider: any | null; serviceCount: number;
  rules: { requireInsurance?: boolean; requireLicense?: boolean } | null;
  todayIso: string; businessTakesCards: boolean; cardUsable: boolean; businessName?: string;
  /** Signed in as this renter, not only matched by phone or email: what saving their own papers needs. */
  linked?: boolean;
}): SetupChecklist | null {
  const r = o.renter; if (!r) return null;
  const biz = String(o.businessName || '').trim() || 'the business';
  const Biz = biz.charAt(0).toUpperCase() + biz.slice(1);
  const mode: 'studio' | 'own' = r.bookingMode === 'own' ? 'own' : 'studio';
  const modeChosen = r.bookingMode === 'own' || r.bookingMode === 'studio';
  const items: SetupStep[] = [];
  const lease = o.lease;

  // The space: lease, deposit, card.
  if (lease && ['pending_signature', 'active', 'on_leave'].includes(String(lease.status || ''))) {
    const signed = lease.status !== 'pending_signature';
    items.push({ key: 'lease', label: 'Sign your lease', doneLabel: 'Lease signed', hint: signed ? '' : 'Read it and sign it here. Rent starts once you sign.', done: signed, optional: false, place: 'space', view: 'lease' });
    const d = o.deposit;
    if (d && Number(d.agreedCents) > 0) {
      // Paid in full, or already settled (returned, partly returned or kept: lib/deposit-accounting).
      const collected = Number(d.collectedCents) || 0;
      const paid = ['returned', 'partly_returned', 'forfeited'].includes(String(d.status)) || (d.status !== 'not_collected' && collected >= Number(d.agreedCents));
      const part = !paid && collected > 0;
      items.push({
        key: 'deposit', label: part ? 'Pay the rest of your deposit' : 'Pay your security deposit', doneLabel: 'Deposit paid',
        hint: paid ? '' : part ? `${money(collected)} of ${money(d.agreedCents)} paid so far. The rest at the front desk.` : d.canPayOnline ? `${money(d.agreedCents)}, payable here by card.` : signed ? `${money(d.agreedCents)}, at the front desk.` : `${money(d.agreedCents)}, once your lease is signed.`,
        done: paid, optional: false, place: 'money', view: null,
      });
    }
    if (o.businessTakesCards) {
      items.push({ key: 'card', label: 'Save a card for rent', doneLabel: 'Card saved for rent', hint: o.cardUsable ? '' : 'Pay rent in a tap, or turn on autopay.', done: o.cardUsable, optional: true, place: 'money', view: null });
    }
  }

  // Papers: what the business requires on file, and a W-9.
  const rules = o.rules || {};
  for (const v of credentialViews(r, { bookingPageSettings: { automationRules: rules } }, o.todayIso)) {
    if (!v.required) continue;
    const what = v.kind === 'insurance' ? 'your liability insurance' : 'your license';
    const onFile = v.kind === 'insurance' ? 'Liability insurance on file' : 'License on file';
    // Expiring soon: still on file, so it doesn't hold anything up, but it's listed to renew.
    if (v.state === 'expiring') {
      items.push({ key: v.kind, label: `Renew ${what}`, doneLabel: onFile, hint: `The one on file expires in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}.`, done: false, optional: true, place: 'space', view: 'insurance' });
      continue;
    }
    const ok = v.state === 'ok';
    items.push({
      key: v.kind, label: v.state === 'expired' ? `Renew ${what}` : `Add ${what}`, doneLabel: onFile,
      hint: ok ? '' : v.state === 'expired' ? `The one on file has run out. ${Biz} needs a current one.` : `${Biz} needs it on file to rent here.`,
      done: ok, optional: false, place: 'space', view: 'insurance',
    });
  }
  // A W-9, for anyone signed in as their renter record (lib/w9-store: on file, either way it was stored).
  if (o.linked !== false) {
    const w9 = r.w9OnFile === true || !!(r.w9 && r.w9.tinLast4);
    items.push({ key: 'w9', label: 'Add your W-9', doneLabel: 'W-9 on file', hint: w9 ? '' : `For year-end tax forms if ${biz} pays you anything. Encrypted; only the last 4 digits show.`, done: w9, optional: true, place: 'space', view: 'w9' });
  }

  // Bookings, for someone who takes them here.
  const week = (o.provider as any)?.week || {};
  const hasHours = Object.keys(week).some((k) => week[k]?.enabled && week[k]?.start && week[k]?.end);
  if (modeChosen && mode === 'studio' && o.provider) {
    items.push({ key: 'hours', label: 'Set the hours you work', doneLabel: 'Hours set', hint: hasHours ? '' : 'Until this is set, nobody can book you.', done: hasHours, optional: false, place: 'today', view: 'setup:hours', blocksBooking: true });
    items.push({ key: 'services', label: 'Add at least one service', doneLabel: o.serviceCount === 1 ? '1 service on your menu' : `${o.serviceCount} services on your menu`, hint: o.serviceCount > 0 ? '' : 'Your prices and your menu. Clients see only yours.', done: o.serviceCount > 0, optional: false, place: 'today', view: 'setup:services', blocksBooking: true });
    items.push({ key: 'deposits', label: 'Take deposits by card', doneLabel: 'Taking deposits by card', hint: r.stripeChargesEnabled ? '' : 'Without it, clients pay you in person.', done: r.stripeChargesEnabled === true, optional: true, place: 'today', view: 'setup:payments' });
  }

  const required = items.filter((i) => !i.optional);
  return {
    mode, modeChosen, canBook: !!o.provider, dismissed: !!r.checklistDismissedAt, items,
    remaining: required.filter((i) => !i.done).length,
    allDone: required.every((i) => i.done) && (modeChosen || !o.provider),
    // Bookable once hours and a service are set, whether or not those steps are listed yet.
    bookingReady: !!o.provider && hasHours && o.serviceCount > 0,
    optionalLeft: items.filter((i) => i.optional && !i.done).length,
  };
}
