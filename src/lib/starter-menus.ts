// src/lib/starter-menus.ts — A MENU TO START FROM for a business starting fresh (Getting started → Your services).
// Common services with typical lengths. Prices are left for the business: every one comes in hidden from booking with no
// price, and goes live only when they set a price and switch it on — nothing is offered to clients at a made-up price.
export type StarterService = { name: string; category: string; duration: number; description?: string };
export type StarterMenu = { id: string; label: string; services: StarterService[] };

const s = (category: string, name: string, duration: number, description?: string): StarterService => ({ name, category, duration, ...(description ? { description } : {}) });

export const STARTER_MENUS: StarterMenu[] = [
  { id: 'nails', label: 'Nail salon', services: [
    s('Manicures', 'Classic manicure', 30), s('Manicures', 'Gel manicure', 45), s('Manicures', 'Gel removal', 15), s('Manicures', 'Dip powder manicure', 60),
    s('Enhancements', 'Gel-X full set', 90), s('Enhancements', 'Acrylic full set', 90), s('Enhancements', 'Acrylic fill', 60), s('Enhancements', 'Builder gel overlay', 75), s('Enhancements', 'Nail repair (per nail)', 10),
    s('Pedicures', 'Classic pedicure', 45), s('Pedicures', 'Gel pedicure', 60), s('Pedicures', 'Spa pedicure', 75),
    s('Nail art', 'Nail art — simple (per nail)', 5), s('Nail art', 'Nail art — detailed', 20), s('Nail art', 'French tips', 15), s('Nail art', 'Chrome', 10),
    s('Add-ons', 'Paraffin wax', 15), s('Add-ons', 'Hand massage', 10),
  ] },
  { id: 'hair', label: 'Hair salon', services: [
    s('Cuts', 'Women’s haircut', 60), s('Cuts', 'Men’s haircut', 30), s('Cuts', 'Kids’ haircut', 30), s('Cuts', 'Bang trim', 15),
    s('Color', 'Single-process color', 90), s('Color', 'Root touch-up', 75), s('Color', 'Partial highlights', 120), s('Color', 'Full highlights', 150), s('Color', 'Balayage', 180), s('Color', 'Toner / gloss', 30),
    s('Styling', 'Blowout', 45), s('Styling', 'Updo', 60), s('Treatments', 'Deep conditioning treatment', 30), s('Treatments', 'Keratin smoothing', 180),
  ] },
  { id: 'lash', label: 'Lash and brow', services: [
    s('Lashes', 'Classic lash full set', 120), s('Lashes', 'Hybrid lash full set', 135), s('Lashes', 'Volume lash full set', 150), s('Lashes', 'Lash fill (2 weeks)', 60), s('Lashes', 'Lash lift and tint', 60), s('Lashes', 'Lash removal', 30),
    s('Brows', 'Brow shaping', 20), s('Brows', 'Brow tint', 15), s('Brows', 'Brow lamination', 45), s('Brows', 'Brow lamination and tint', 60),
  ] },
  { id: 'spa', label: 'Spa and massage', services: [
    s('Massage', 'Swedish massage — 60 min', 60), s('Massage', 'Swedish massage — 90 min', 90), s('Massage', 'Deep tissue massage — 60 min', 60), s('Massage', 'Hot stone massage', 75), s('Massage', 'Prenatal massage', 60),
    s('Facials', 'Signature facial', 60), s('Facials', 'Express facial', 30), s('Facials', 'Hydrating facial', 75),
    s('Waxing', 'Brow wax', 15), s('Waxing', 'Full leg wax', 60),
  ] },
  { id: 'barber', label: 'Barbershop', services: [
    s('Cuts', 'Haircut', 30), s('Cuts', 'Skin fade', 45), s('Cuts', 'Kids’ cut', 30), s('Cuts', 'Haircut and beard', 45), s('Beard', 'Beard trim', 20), s('Beard', 'Hot towel shave', 30), s('Extras', 'Line-up', 15), s('Extras', 'Eyebrow cleanup', 10),
  ] },
];

/** The menu most likely to fit, from what they told us at sign-up. */
export function suggestMenu(t: any): string {
  const txt = `${t?.businessType || ''} ${t?.category || ''} ${t?.name || ''}`.toLowerCase();
  if (/nail|manicure|pedicure/.test(txt)) return 'nails';
  if (/lash|brow/.test(txt)) return 'lash';
  if (/barber/.test(txt)) return 'barber';
  if (/spa|massage|skin|facial|wellness/.test(txt)) return 'spa';
  if (/hair|salon/.test(txt)) return 'hair';
  return 'nails';
}
