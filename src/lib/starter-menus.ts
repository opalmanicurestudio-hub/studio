// src/lib/starter-menus.ts — A MENU TO START FROM for a business starting fresh (Getting started → Your services).
// Common services with typical lengths. Prices are left for the business: every one comes in hidden from booking with no
// price, and goes on the booking page when they give it its first price (services page) — nothing is offered to clients
// at a made-up price.
import { nicheOf } from './niche';
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
  { id: 'medspa', label: 'Med spa or clinic', services: [
    s('Consultations', 'New client consultation', 30), s('Consultations', 'Follow-up visit', 15),
    s('Skin', 'Chemical peel', 45), s('Skin', 'Microneedling', 60), s('Skin', 'Dermaplaning', 45), s('Skin', 'Hydrating facial', 60),
    s('Injectables', 'Neurotoxin treatment', 30), s('Injectables', 'Dermal filler', 45),
    s('Laser', 'Laser hair removal — small area', 20), s('Laser', 'Laser hair removal — large area', 45),
  ] },
  { id: 'tattoo', label: 'Tattoo and piercing', services: [
    s('Tattoos', 'Tattoo consultation', 30), s('Tattoos', 'Small tattoo', 60), s('Tattoos', 'Medium tattoo', 120), s('Tattoos', 'Half-day session', 240), s('Tattoos', 'Full-day session', 480), s('Tattoos', 'Touch-up', 30),
    s('Piercing', 'Ear lobe piercing', 15), s('Piercing', 'Cartilage piercing', 20), s('Piercing', 'Nose piercing', 20), s('Piercing', 'Navel piercing', 20), s('Piercing', 'Jewelry change', 15), s('Piercing', 'Piercing check-up', 15),
  ] },
  { id: 'fitness', label: 'Fitness and classes', services: [
    s('Personal training', 'Intro session', 30), s('Personal training', 'Personal training — 30 min', 30), s('Personal training', 'Personal training — 60 min', 60), s('Personal training', 'Partner training — 60 min', 60), s('Personal training', 'Fitness assessment', 45),
    s('Classes', 'Group class', 60), s('Classes', 'Yoga class', 60), s('Classes', 'Pilates mat class', 50), s('Classes', 'HIIT class', 45),
    s('Recovery', 'Assisted stretch', 30),
  ] },
  { id: 'events', label: 'Venue and events', services: [
    s('Planning', 'Venue tour', 30), s('Planning', 'Event planning consultation', 60), s('Planning', 'Menu tasting', 60),
    s('Hire', 'Private room — 2 hours', 120), s('Hire', 'Private room — 4 hours', 240), s('Hire', 'Full venue — evening', 300),
  ] },
  { id: 'general', label: 'Appointments', services: [
    s('Appointments', 'Consultation', 30), s('Appointments', 'Short appointment', 30), s('Appointments', 'Standard appointment', 60), s('Appointments', 'Extended appointment', 90), s('Appointments', 'Follow-up', 30),
  ] },
];

/** The menu most likely to fit, from the kind of business (lib/niche); '' when none of the starter menus fits (a café
 *  or a shop sells things rather than booking time), so nothing is picked for them. */
export function suggestMenu(t: any): string {
  const n = nicheOf(t);
  if (['nails', 'hair', 'lash', 'barber', 'spa', 'medspa', 'tattoo', 'fitness', 'events', 'general'].includes(n)) return n;
  if (n === 'beauty') return 'hair';   // a salon that hasn't said more: most often hair, as before
  return '';
}
