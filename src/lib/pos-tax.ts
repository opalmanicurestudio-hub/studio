// src/lib/pos-tax.ts — SALES TAX AT CHECKOUT (pure).
// The POS used to add 7% to the whole bill for every business — services and unpaid fees included.
// Now it follows the business's own settings (Settings → Payments → Sales tax):
//   • products use the SAME rate as the online store (retailSettings.taxRatePercent)
//   • services are taxed only if the business says so, at its own rate
//   • fees (late-cancel, no-show, change fees, balances) are never taxed
// A business that hasn't set its tax yet keeps the old behaviour (7% on services and products) until it
// does — and checkout says so, so nobody is surprised.
export interface PosTax { productsPct: number; servicesPct: number; legacy: boolean }

export function posTaxOf(t: any): PosTax {
  const st = t?.salesTax;
  if (!st || st.configured !== true) return { productsPct: 7, servicesPct: 7, legacy: true };
  const productsPct = Math.max(0, Math.min(25, Number(t?.retailSettings?.taxRatePercent ?? st.productsPct) || 0));
  const servicesPct = st.servicesTaxed === true ? Math.max(0, Math.min(25, Number(st.servicesPct ?? productsPct) || 0)) : 0;
  return { productsPct, servicesPct, legacy: false };
}

/** Tax on this checkout, in dollars (rounded to the cent). Fees are never passed in. */
export function posTaxAmount(t: any, parts: { services: number; products: number }): number {
  const x = posTaxOf(t);
  const cents = Math.round((Math.max(0, parts.services) * x.servicesPct + Math.max(0, parts.products) * x.productsPct));
  return cents / 100;
}

/** "Sales tax (7% products · services not taxed)" — what the receipt and checkout say. */
export function posTaxLabel(t: any): string {
  const x = posTaxOf(t);
  if (x.legacy) return 'Sales tax (7% — check your tax settings)';
  if (x.servicesPct === x.productsPct) return x.productsPct ? `Sales tax (${x.productsPct}%)` : 'Sales tax (none)';
  return `Sales tax (${x.productsPct}% products · ${x.servicesPct ? `${x.servicesPct}% services` : 'services not taxed'})`;
}
