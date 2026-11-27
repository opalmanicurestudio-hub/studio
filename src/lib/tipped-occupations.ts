// src/lib/tipped-occupations.ts — TREASURY TIPPED OCCUPATION CODES (IRS.gov/TTOC), for box 14b of the W-2 from 2026
// (lib/payroll-yearend). When a W-2 reports tips with box 12 code TP, box 14b says the occupation the tips were received
// in: up to two codes, and "000" when any were received in an occupation not on the list. The occupations here are the
// ones that customarily and regularly received tips on or before December 31, 2024 (the list as Treasury publishes it).
// A business's own kind (lib/niche) suggests the usual one; the owner or whoever runs payroll can pick another for a
// person (payrollTax.ttoc on the business, api/payroll/forms 'ttoc'), and say some tips were for work not on the list
// (payrollTax.ttoc000: "000" as the second code).
import { nicheOf, type Niche } from './niche';

export const NOT_LISTED = '000';

export const TTOC: { code: string; title: string; group: string }[] = [
  { code: '101', title: 'Bartenders', group: 'Food and drink' },
  { code: '102', title: 'Wait staff', group: 'Food and drink' },
  { code: '103', title: 'Food or beverage servers, non-restaurant', group: 'Food and drink' },
  { code: '104', title: 'Dining room and cafeteria attendants and bartender helpers', group: 'Food and drink' },
  { code: '105', title: 'Chefs and cooks', group: 'Food and drink' },
  { code: '106', title: 'Food preparation workers', group: 'Food and drink' },
  { code: '107', title: 'Fast food and counter workers', group: 'Food and drink' },
  { code: '108', title: 'Dishwashers', group: 'Food and drink' },
  { code: '109', title: 'Host staff, restaurant, lounge, and coffee shop', group: 'Food and drink' },
  { code: '110', title: 'Bakers', group: 'Food and drink' },
  { code: '201', title: 'Gambling dealers', group: 'Entertainment and events' },
  { code: '202', title: 'Gambling change persons and booth cashiers', group: 'Entertainment and events' },
  { code: '203', title: 'Gambling cage workers', group: 'Entertainment and events' },
  { code: '204', title: 'Gambling and sports book writers and runners', group: 'Entertainment and events' },
  { code: '205', title: 'Dancers', group: 'Entertainment and events' },
  { code: '206', title: 'Musicians and singers', group: 'Entertainment and events' },
  { code: '207', title: 'Disc jockeys, except radio', group: 'Entertainment and events' },
  { code: '208', title: 'Entertainers and performers', group: 'Entertainment and events' },
  { code: '209', title: 'Digital content creators', group: 'Entertainment and events' },
  { code: '210', title: 'Ushers, lobby attendants, and ticket takers', group: 'Entertainment and events' },
  { code: '211', title: 'Locker room, coatroom, and dressing room attendants', group: 'Entertainment and events' },
  { code: '301', title: 'Baggage porters and bellhops', group: 'Hospitality and guest services' },
  { code: '302', title: 'Concierges', group: 'Hospitality and guest services' },
  { code: '303', title: 'Hotel, motel, and resort desk clerks', group: 'Hospitality and guest services' },
  { code: '304', title: 'Maids and housekeeping cleaners', group: 'Hospitality and guest services' },
  { code: '401', title: 'Home maintenance and repair workers', group: 'Home services' },
  { code: '402', title: 'Home landscaping and groundskeeping workers', group: 'Home services' },
  { code: '403', title: 'Home electricians', group: 'Home services' },
  { code: '404', title: 'Home plumbers', group: 'Home services' },
  { code: '405', title: 'Home heating and air conditioning mechanics and installers', group: 'Home services' },
  { code: '406', title: 'Home appliance installers and repairers', group: 'Home services' },
  { code: '407', title: 'Home cleaning service workers', group: 'Home services' },
  { code: '408', title: 'Locksmiths', group: 'Home services' },
  { code: '409', title: 'Roadside assistance workers', group: 'Home services' },
  { code: '501', title: 'Personal care and service workers', group: 'Personal services' },
  { code: '502', title: 'Private event planners', group: 'Personal services' },
  { code: '503', title: 'Private event and portrait photographers', group: 'Personal services' },
  { code: '504', title: 'Private event videographers', group: 'Personal services' },
  { code: '505', title: 'Event officiants', group: 'Personal services' },
  { code: '506', title: 'Pet and show animal caretakers', group: 'Personal services' },
  { code: '507', title: 'Tutors', group: 'Personal services' },
  { code: '508', title: 'Nannies and babysitters', group: 'Personal services' },
  { code: '509', title: 'Visual artists', group: 'Personal services' },
  { code: '510', title: 'Floral designers', group: 'Personal services' },
  { code: '601', title: 'Skincare specialists', group: 'Personal appearance and wellness' },
  { code: '602', title: 'Massage therapists', group: 'Personal appearance and wellness' },
  { code: '603', title: 'Barbers, hairdressers, hairstylists, and cosmetologists', group: 'Personal appearance and wellness' },
  { code: '604', title: 'Shampooers', group: 'Personal appearance and wellness' },
  { code: '605', title: 'Manicurists and pedicurists', group: 'Personal appearance and wellness' },
  { code: '606', title: 'Eyebrow and eyelash technicians', group: 'Personal appearance and wellness' },
  { code: '607', title: 'Makeup artists', group: 'Personal appearance and wellness' },
  { code: '608', title: 'Exercise trainers and group fitness instructors', group: 'Personal appearance and wellness' },
  { code: '609', title: 'Tattoo artists and piercers', group: 'Personal appearance and wellness' },
  { code: '610', title: 'Tailors', group: 'Personal appearance and wellness' },
  { code: '611', title: 'Shoe and leather workers and repairers', group: 'Personal appearance and wellness' },
  { code: '701', title: 'Golf caddies', group: 'Recreation and instruction' },
  { code: '702', title: 'Self-enrichment teachers', group: 'Recreation and instruction' },
  { code: '703', title: 'Recreational and tour pilots', group: 'Recreation and instruction' },
  { code: '704', title: 'Tour guides', group: 'Recreation and instruction' },
  { code: '705', title: 'Travel guides', group: 'Recreation and instruction' },
  { code: '706', title: 'Sports and recreation instructors', group: 'Recreation and instruction' },
  { code: '801', title: 'Parking and valet attendants', group: 'Transportation and delivery' },
  { code: '802', title: 'Taxi and rideshare drivers and chauffeurs', group: 'Transportation and delivery' },
  { code: '803', title: 'Shuttle drivers', group: 'Transportation and delivery' },
  { code: '804', title: 'Goods delivery people', group: 'Transportation and delivery' },
  { code: '805', title: 'Personal vehicle and equipment cleaners', group: 'Transportation and delivery' },
  { code: '806', title: 'Private and charter bus drivers', group: 'Transportation and delivery' },
  { code: '807', title: 'Water taxi operators and charter boat workers', group: 'Transportation and delivery' },
  { code: '808', title: 'Rickshaw, pedicab, and carriage drivers', group: 'Transportation and delivery' },
  { code: '809', title: 'Home movers', group: 'Transportation and delivery' },
  { code: '810', title: 'Gas pump attendants', group: 'Transportation and delivery' },
];
const CODES = new Set([...TTOC.map((t) => t.code), NOT_LISTED]);

/** The occupation's name, or what "000" means. */
export const ttocTitle = (code: string) => (code === NOT_LISTED ? 'An occupation not on the list' : TTOC.find((t) => t.code === code)?.title || '');

/** A code as sent: one on the list, or "000", else null. */
export const cleanTtoc = (v: unknown): string | null => { const s = String(v ?? '').trim(); return CODES.has(s) ? s : null; };

const BY_NICHE: Partial<Record<Niche, string>> = { nails: '605', hair: '603', barber: '603', beauty: '603', lash: '606', spa: '602', medspa: '601', tattoo: '609', fitness: '608', hospitality: '102' };

/** The usual code for the business's kind, or null when there isn't one to suggest. */
export const usualTtoc = (tenant: any): string | null => BY_NICHE[nicheOf(tenant)] || null;

/** A person's code: the one picked for them, else the business's usual one. */
export function ttocOf(tenant: any, staffId: string): string | null {
  return cleanTtoc(tenant?.payrollTax?.ttoc?.[staffId]) || usualTtoc(tenant);
}

/** Box 14b's codes for a person, up to two: their occupation, and "000" too when some of their tips were for work not on
 *  the list (payrollTax.ttoc000[staffId]). */
export function ttocsOf(tenant: any, staffId: string): string[] {
  const c = ttocOf(tenant, staffId); const also = tenant?.payrollTax?.ttoc000?.[staffId] === true;
  return [...(c ? [c] : []), ...(also && c !== NOT_LISTED ? [NOT_LISTED] : [])];
}
