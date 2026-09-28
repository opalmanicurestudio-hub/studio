// src/lib/card-on-file.ts — DOES THIS CLIENT REALLY HAVE A CARD ON FILE?
// A real card is one saved through Stripe (a payment method id) — or a genuine
// token from an older integration. The retired "Simulated Card Entry" field
// saved fake tokens ("sim_tok_…"); those never count, so no screen offers to
// charge a card that doesn't exist.
export const isFakeCardToken = (t: any) => typeof t === 'string' && t.startsWith('sim_tok_');
export function hasRealCard(client: any): boolean {
  const c = client?.cardOnFile;
  if (!c) return false;
  if (c.paymentMethodId) return true;
  return !!c.token && !isFakeCardToken(c.token);
}
