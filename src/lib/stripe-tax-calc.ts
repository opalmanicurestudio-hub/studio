// src/lib/stripe-tax-calc.ts — SALES TAX ON THE FULL PRICE WHEN A GIFT CARD OR STORE CREDIT PAYS PART (server).
// Stripe's payment page works its tax out on what's left after its discount. A promo code is a discount, but a gift
// card or store credit is a way of paying: taxed on what's left, the shop would collect too little and owe the rest.
// So when one of them pays part of a shipped order at a shop that uses Stripe Tax, the tax is worked out first with
// Stripe Tax (the items after any promo code, and the shipping, at the shipping address), shown on the payment page as
// a line of its own, and recorded with Stripe Tax once the order is paid, so the shop's Stripe Tax report counts it.

const c0 = (v: any): number => Math.max(0, Math.round(Number(v) || 0));

export type TaxLine = { amountCents: number; quantity: number; reference: string; taxCode: string };

/** The tax on the full price (promo codes off, gift cards and store credit not), by Stripe Tax. */
export async function fullPriceTax(stripe: any, stripeAccount: string, o: {
  lines: TaxLine[]; shippingCents: number; address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string } | null;
}): Promise<{ id: string; cents: number }> {
  const a = o.address || {};
  const calc: any = await stripe.tax.calculations.create({
    currency: 'usd',
    line_items: o.lines.filter((l) => c0(l.amountCents) > 0).map((l) => ({
      amount: c0(l.amountCents), quantity: Math.max(1, c0(l.quantity)), reference: String(l.reference).slice(0, 200), tax_code: l.taxCode, tax_behavior: 'exclusive',
    })),
    ...(c0(o.shippingCents) > 0 ? { shipping_cost: { amount: c0(o.shippingCents), tax_code: 'txcd_92010001', tax_behavior: 'exclusive' } } : {}),
    customer_details: {
      address: { line1: a.line1 || undefined, line2: a.line2 || undefined, city: a.city || undefined, state: a.state || undefined, postal_code: a.postalCode || undefined, country: a.country || 'US' },
      address_source: 'shipping',
    },
  }, { stripeAccount });
  return { id: String(calc.id), cents: c0(calc.tax_amount_exclusive) };
}

/** Records a paid order's tax with Stripe Tax (once: the order id is the record's reference). */
export async function recordFullPriceTax(stripe: any, stripeAccount: string, calculationId: string, reference: string): Promise<{ id: string } | { already: true }> {
  try {
    const t: any = await stripe.tax.transactions.createFromCalculation({ calculation: calculationId, reference }, { stripeAccount });
    return { id: String(t.id) };
  } catch (e: any) {
    // Recorded already under this order (a retry): Stripe refuses a second record with the same reference.
    if (/reference/i.test(String(e?.raw?.message || e?.message || '')) && /already|exists|unique/i.test(String(e?.raw?.message || e?.message || ''))) return { already: true };
    throw e;
  }
}
