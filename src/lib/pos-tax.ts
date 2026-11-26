// src/lib/pos-tax.ts — SALES TAX AT CHECKOUT (pure).
// From the business's own settings (Settings → Payments → Sales tax):
//   • products use the SAME rate as the online store (retailSettings.taxRatePercent)
//   • services are taxed only if the business says so, at its own rate
//   • fees (late-cancel, no-show, change fees, balances) are never taxed
//   • a location can have its own rates (salesTax.byLocation[locationId]): the city or county it's in may charge a
//     different rate. The desk, the counter, the kiosk and ordering ahead pass the location the sale is at.
// Before its rates are saved:
//   • a business that signed up from November 2026 on (salesTax.startsUnset, api/signup) has none added, or only its
//     shop's rate on products when that's set; checkout, the setup guide and Settings say it isn't set up yet
//   • a business from before keeps what it always had (7% on services and products) until its owner saves the rates,
//     so it never stops collecting tax it owes; Settings asks them to check (`legacy`)
export interface PosTax { productsPct: number; servicesPct: number; legacy: boolean; unset: boolean; atLocation: boolean }

const pctOf = (v: unknown) => Math.max(0, Math.min(25, Number(v) || 0));

/** The rates for a sale, at a location when it has its own. */
export function posTaxOf(t: any, at?: string | null): PosTax {
  const st = t?.salesTax;
  if (!st || st.configured !== true) {
    if (st?.startsUnset !== true) return { productsPct: 7, servicesPct: 7, legacy: true, unset: false, atLocation: false };
    const shop = Number(t?.retailSettings?.taxRatePercent);
    return Number.isFinite(shop) && shop > 0 ? { productsPct: pctOf(shop), servicesPct: 0, legacy: false, unset: false, atLocation: false }
      : { productsPct: 0, servicesPct: 0, legacy: false, unset: true, atLocation: false };
  }
  const own = at && st.byLocation && typeof st.byLocation === 'object' ? st.byLocation[String(at)] : null;
  if (own && own.productsPct !== undefined && own.productsPct !== null) {
    const productsPct = pctOf(own.productsPct);
    return { productsPct, servicesPct: own.servicesTaxed === true ? pctOf(own.servicesPct ?? productsPct) : 0, legacy: false, unset: false, atLocation: true };
  }
  const productsPct = pctOf(t?.retailSettings?.taxRatePercent ?? st.productsPct);
  const servicesPct = st.servicesTaxed === true ? pctOf(st.servicesPct ?? productsPct) : 0;
  return { productsPct, servicesPct, legacy: false, unset: false, atLocation: false };
}

/** Tax on this checkout, in dollars (rounded to the cent). Fees are never passed in. */
export function posTaxAmount(t: any, parts: { services: number; products: number }, at?: string | null): number {
  const x = posTaxOf(t, at);
  const cents = Math.round((Math.max(0, parts.services) * x.servicesPct + Math.max(0, parts.products) * x.productsPct));
  return cents / 100;
}

/** The rate a tax line was worked out at, kept on the books line so the sales tax report can add it up by rate. */
export function posTaxRates(t: any, at?: string | null): { productsPct: number; servicesPct: number } {
  const x = posTaxOf(t, at); return { productsPct: x.productsPct, servicesPct: x.servicesPct };
}

/** "Sales tax (8.25% on products, services not taxed)": what the receipt and checkout say. */
export function posTaxLabel(t: any, at?: string | null): string {
  const x = posTaxOf(t, at);
  if (x.unset) return 'Sales tax (not set up yet)';
  if (x.legacy) return 'Sales tax (7%, check your tax settings)';
  if (x.servicesPct === x.productsPct) return x.productsPct ? `Sales tax (${x.productsPct}%)` : 'Sales tax (none)';
  return `Sales tax (${x.productsPct}% on products, ${x.servicesPct ? `${x.servicesPct}% on services` : 'services not taxed'})`;
}
