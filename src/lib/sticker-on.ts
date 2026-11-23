// src/lib/sticker-on.ts — THE ORDERS A STICKER PRINTER CAN KEEP TO (pure; design board "A sticker on each item", C: only
// where it counts). A printer that prints item stickers (Settings, Printers) prints them on every order, or only on
// these, where a wrong or missing item costs most: a delivery app's, the business's own drivers', one that fills two or
// more bags, one with an allergy (lib/item-stickers stickersFor). Kept small on its own, for the printers page.
export const STICKER_ON = ['apps', 'drivers', 'bags', 'allergy'] as const;
export type StickerOn = typeof STICKER_ON[number];
/** Each as the printers page offers it, and in the middle of a sentence. */
export const STICKER_ON_WORDS: { id: StickerOn; label: string; words: string }[] = [
  { id: 'apps', label: 'Delivery apps', words: 'delivery apps' }, { id: 'drivers', label: 'Our drivers', words: 'our drivers' },
  { id: 'bags', label: 'Two or more bags', words: 'two or more bags' }, { id: 'allergy', label: 'An allergy', words: 'an allergy' },
];
