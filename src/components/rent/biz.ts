// src/components/rent/biz.ts — THE BUSINESS'S OWN NAME, for every label in the renter portal.
// The portal says "Northside Studio", never "the studio" (a renter may rent from a barbershop, a kitchen or a gym).
// The portal page sets the name once it has loaded (app/rent/[tenantId]/page.tsx); every component reads it here.
let current = '';

export function setBusinessName(name: unknown): void { current = String(name || '').trim(); }

/** The business's name, or "the business" until it's known. */
export function biz(capital = false): string { return current || (capital ? 'The business' : 'the business'); }

/** "Northside Studio’s", or "the business’s". */
export function bizs(capital = false): string { return current ? `${current}’s` : capital ? 'The business’s' : 'the business’s'; }
