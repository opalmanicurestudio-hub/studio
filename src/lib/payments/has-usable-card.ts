/**
 * has-usable-card — v1: the ONE place card-on-file usability is checked.
 *
 * Previously this exact logic was copy-pasted independently across FIVE
 * files: lib/booking/create-booking.ts, log-call-intent's cancel branch,
 * log-call-intent's reschedule branch, sell-package's route, and
 * enroll-membership's two functions. If the cardOnFile field shape ever
 * changed, every one of those needed updating separately — easy to miss
 * one, and a missed one means a genuinely confusing bug: "my card works
 * everywhere except this one specific flow," with no obvious reason why.
 *
 * A card is treated as unusable (same as having none at all) if it's
 * missing the payment method reference, missing the Stripe customer
 * reference, or expired. An expired card is never silently trusted just
 * because it was once on file.
 */

export function hasUsableCard(client: any): boolean {
  const cardOnFile = client?.cardOnFile;
  if (!cardOnFile) return false;

  const hasPaymentMethod = !!(cardOnFile.paymentMethodId || cardOnFile.token);
  const hasCustomerRef = !!(cardOnFile.customerId || cardOnFile.stripeCustomerId);
  if (!hasPaymentMethod || !hasCustomerRef) return false;

  if (cardOnFile.expMonth && cardOnFile.expYear) {
    const expDate = new Date(Number(cardOnFile.expYear), Number(cardOnFile.expMonth), 0);
    if (expDate < new Date()) return false;
  }

  return true;
}
