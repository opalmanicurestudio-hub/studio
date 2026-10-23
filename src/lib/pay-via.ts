// src/lib/pay-via.ts — HOW A PAYMENT WAS TAKEN, IN WORDS (shared by the desk and the server).
// "…was paid $45.00 on the card reader". Used wherever a sale's started ticket is already paid, or paid twice.

/** How a payment was taken, in words for the desk ("…paid $45.00 on the card reader"). */
export function viaWords(via: any): string {
  const v = String(via || '');
  if (v === 'card_reader' || v === 'terminal') return 'on the card reader';
  if (v === 'client_screen') return 'on the client screen';
  if (v === 'card_on_file' || v === 'saved_card') return 'on their saved card';
  if (v === 'split') return 'in a split';
  return 'by card';
}

/** How a payment taken by this checkout method is named on a ticket. */
export const viaOfMethod = (method: any): string => (method === 'terminal' ? 'card_reader' : method === 'card_on_file' ? 'card_on_file' : 'card');

/** The checkout method that records a sale with a payment taken this way. */
export const methodOfVia = (via: any): string => (via === 'card_reader' ? 'terminal' : via === 'card_on_file' ? 'card_on_file' : 'card');

export const dollars = (cents: any) => `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
