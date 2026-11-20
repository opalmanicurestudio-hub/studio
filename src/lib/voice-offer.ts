// src/lib/voice-offer.ts — WHAT THE DRIVE-THRU'S VOICE ASSISTANT OFFERS (pure; design canvas "Food numbers": Offers at
// the speaker). Right after it adds something, the assistant may offer what that item offers (set on the Menu page under
// Offered at the end; lib/menu-upgrades): the next size up and something to go with it, as one short question. How
// often is the business's choice (Menu page → Voice assistant; tenant.driveThru.offers): with each item (the first time
// that item is added on the call), once per order, or never. Nothing is offered while the line is long, nothing sold out
// or already on the order, and every price said is the menu's. Only an assistant made with the instructions and tools
// for it is asked to offer (lib/drive-thru-voice assistantVersion, VOICE_OFFERS_FROM).
import { offersFor } from '@/lib/menu-upgrades';
import { orderableNow } from '@/lib/voice-order';
import type { Picks } from '@/lib/menu-choices';

export type VoiceOfferMode = 'item' | 'order' | 'off';
/** The assistant version that knows how to offer and size up (lib/drive-thru-voice-setup VOICE_VERSION 3). */
export const VOICE_OFFERS_FROM = 3;
export const VOICE_OFFER_MODES: { value: VoiceOfferMode; label: string }[] = [
  { value: 'item', label: 'With each item' }, { value: 'order', label: 'Once per order' }, { value: 'off', label: 'Don’t offer' },
];
/** How often this business's assistant offers: with each item unless it chose otherwise. */
export const voiceOfferMode = (tenant: any): VoiceOfferMode => {
  const v = String(tenant?.driveThru?.offers || '');
  return v === 'order' || v === 'off' ? v : 'item';
};

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
/** "a butter croissant", "an iced coffee", "fries"; a name with other capitals in it ("BLT", "Caesar Salad") keeps them:
 *  "the BLT". */
const spoken = (name: string) => {
  if (!/^[A-Z][^A-Z]*$/.test(name)) return `the ${name}`;
  const low = `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  return /[^s]s$/i.test(name.trim()) ? low : `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${low}`;
};

export type VoiceOffer = { say: string; size: { to: string; adds: number } | null; items: { id: string; name: string; price: number }[] };

/** What to offer now that `item` was just added (`quantity` of it, with `picks`), or null. `offered`: the items already
 *  offered with on this call; `have`: what's on the order. At most two things in the question: the bigger size and one
 *  thing to go with it, or two things to go with it. */
export function voiceOffer<T extends { id: string; name: string; price: number; from?: boolean; startPrice?: number; soldOut: boolean; onMenu: boolean; membersOnly: boolean; inStock: boolean; upgrades?: unknown; choices?: unknown }>(
  o: { mode: VoiceOfferMode; busy: boolean; offered: string[]; item: T; picks: Picks; quantity: number; menu: T[]; have: (id: string) => boolean },
): VoiceOffer | null {
  if (o.mode === 'off' || o.busy) return null;
  if (o.mode === 'order' ? o.offered.length > 0 : o.offered.includes(o.item.id)) return null;
  const find = (id: string) => o.menu.find((m) => m.id === id && orderableNow(m as any));
  const { size, items } = offersFor(o.item, o.picks, find, o.have);
  const q = Math.max(1, Math.floor(o.quantity) || 1);
  const take = items.slice(0, size ? 1 : 2);
  if (!size && !take.length) return null;
  const parts = [
    ...(size ? [`make ${q > 1 ? 'those' : 'that'} ${size.to} for ${money(size.adds * q)} more`] : []),
    ...take.map((m) => `add ${spoken(m.name)} ${m.from ? `starting at ${money(Number(m.startPrice) || m.price)}` : `for ${money(m.price)}`}`),
  ];
  return { say: `Would you like to ${parts.join(', or ')}?`, size: size ? { to: size.to, adds: size.adds } : null, items: take.map((m) => ({ id: m.id, name: m.name, price: m.price })) };
}

/** What the assistant is told to do with it, after "Added …". */
export const offerInstruction = (v: VoiceOffer) => [
  `Offer it once, as one short question: "${v.say}"`,
  v.size ? 'If they want the bigger size, call size_up.' : '',
  v.items.length ? `If they want ${v.items.length > 1 ? 'one of the things to go with it' : `the ${v.items[0].name}`}, call add_item for it.` : '',
  'If they say no, don’t offer again: ask if there’s anything else.',
].filter(Boolean).join(' ');
