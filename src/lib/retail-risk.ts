// src/lib/retail-risk.ts — SHOULD THIS ORDER WAIT FOR A PERSON? Read once, when the payment lands. A held order is paid
// but stays out of the packing line until a manager looks and releases it; the customer isn't told. It holds when the
// card network or Stripe say the payment is risky, or when two smaller signs line up (card from another country than
// the shipping address, failed security-code or postcode checks, a large first order shipped somewhere new).
// Pickup orders are only held for the strong signs: the person has to come in and show the order code. Pure.

export interface RiskPolicy { mode: 'auto' | 'off'; bigFirstOrderCents: number }
export const riskPolicy = (rs: any): RiskPolicy => ({
  mode: rs?.policies?.fraudHold === 'off' ? 'off' : 'auto',
  bigFirstOrderCents: Math.max(0, Number(rs?.policies?.fraudBigFirstOrderCents) || 30000),
});

export interface RiskResult { hold: boolean; reasons: string[]; strong: string[]; weak: string[]; riskLevel: string | null; riskScore: number | null }

export function assessRisk(order: any, charge: any | null, priorOrders: number, pol: RiskPolicy): RiskResult {
  const strong: string[] = []; const weak: string[] = [];
  const outcome = charge?.outcome || {};
  const level = typeof outcome.risk_level === 'string' ? outcome.risk_level : null;
  const score = Number.isFinite(Number(outcome.risk_score)) ? Number(outcome.risk_score) : null;
  if (level === 'highest') strong.push('Stripe rates this payment highest risk');
  else if (level === 'elevated') strong.push('Stripe rates this payment elevated risk');
  else if (score != null && score >= 65) strong.push(`Stripe risk score ${score}`);
  const card = charge?.payment_method_details?.card || {};
  const checks = card.checks || {};
  if (checks.cvc_check === 'fail') strong.push('The card’s security code didn’t match');
  const ship = order.method === 'ship';
  const shipCountry = String(order.shippingAddress?.country || 'US').toUpperCase();
  if (ship && card.country && String(card.country).toUpperCase() !== shipCountry) weak.push(`Card from ${String(card.country).toUpperCase()}, shipping to ${shipCountry}`);
  if (checks.address_postal_code_check === 'fail') weak.push('The billing postcode didn’t match the card');
  const billingCountry = charge?.billing_details?.address?.country;
  if (ship && billingCountry && String(billingCountry).toUpperCase() !== shipCountry) weak.push('Billing and shipping countries differ');
  if (ship && priorOrders === 0 && (Number(order.totalCents) || 0) >= pol.bigFirstOrderCents && pol.bigFirstOrderCents > 0) weak.push(`A first order of $${((Number(order.totalCents) || 0) / 100).toFixed(0)}`);
  const hold = pol.mode === 'auto' && (strong.length > 0 || (ship && weak.length >= 2));
  return { hold, reasons: [...strong, ...weak], strong, weak, riskLevel: level, riskScore: score };
}
