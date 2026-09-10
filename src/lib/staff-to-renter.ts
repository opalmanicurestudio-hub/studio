// src/lib/staff-to-renter.ts
//
// AN EMPLOYEE BECOMES A BOOTH RENTER.
//
// This is the most consequential change one person's record can undergo in
// this app, and until now there was no path for it: `convertToRenter` on the
// booths page turns an APPLICANT into a renter and never touches a staff
// record. Doing it by hand means flipping a flag, which quietly gets four
// other things wrong.
//
// What it must decide, out loud:
//
//   1. THE CLIENT BOOK. Do the clients they served follow them, stay with the
//      studio, or does the owner pick person by person? Most booth agreements
//      say the clients follow the stylist; plenty say the shop's clients are
//      the shop's. There is no safe default, so this module does not have one
//      — the owner chooses, and the choice is recorded. This is the single
//      most common source of a bitter exit, and the reason it is a question
//      rather than a behaviour.
//
//   2. BOOKINGS ALREADY ON THE CALENDAR. Someone booked for next Tuesday was
//      booked as studio work. Honour it as studio work (the studio keeps the
//      money and the last paycheck covers it), or hand it over from the
//      effective date so it becomes theirs.
//
//   3. THE EFFECTIVE DATE. Which also decides their final pay period and their
//      first rent day, so it is a real date, not "now".
//
// Nothing here writes. It computes what WOULD move, so the owner sees counts
// and money before deciding, and the caller applies it.

export type ClientBookChoice = 'follow' | 'stay' | 'pick';
export type InFlightChoice = 'studio_keeps' | 'transfer';

export interface ConversionChoices {
  effectiveDate: string;          // YYYY-MM-DD
  clientBook: ClientBookChoice;
  clientIds?: string[];           // when clientBook === 'pick'
  inFlight: InFlightChoice;
  seedMenu: boolean;              // copy their assigned house services to their own menu
}

export interface ConversionPreview {
  clientsMoving: { id: string; name: string; visits: number; lastVisit: string | null }[];
  clientsStaying: number;
  inFlightCount: number;
  inFlightValueCents: number;
  pastAppointments: number;
  servicesToSeed: { id: string; name: string; price: number; duration: number }[];
  warnings: string[];
}

const day = (iso: any) => String(iso || '').slice(0, 10);

/**
 * Clients this person actually served for the studio — the book under
 * discussion. Only clients the STUDIO owns are in play: anything already
 * carrying an ownerRenterId belongs to some other renter and is untouchable.
 */
export function servedClients(appointments: any[], clients: any[], staffId: string): { id: string; name: string; visits: number; lastVisit: string | null }[] {
  const seen = new Map<string, { visits: number; last: string | null }>();
  for (const a of appointments || []) {
    if (a.staffId !== staffId || !a.clientId) continue;
    if (a.status === 'cancelled') continue;
    const cur = seen.get(a.clientId) || { visits: 0, last: null };
    cur.visits += 1;
    if (!cur.last || String(a.startTime) > cur.last) cur.last = String(a.startTime);
    seen.set(a.clientId, cur);
  }
  const out: { id: string; name: string; visits: number; lastVisit: string | null }[] = [];
  for (const c of clients || []) {
    const hit = seen.get(c.id);
    if (!hit || c.ownerRenterId) continue;
    out.push({ id: c.id, name: c.name || 'Client', visits: hit.visits, lastVisit: hit.last });
  }
  return out.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
}

/** Bookings on or after the effective date that are still live. */
export function inFlightAppointments(appointments: any[], staffId: string, effectiveDate: string): any[] {
  return (appointments || []).filter((a) =>
    a.staffId === staffId
    && !a.isRenterBooking
    && day(a.startTime) >= effectiveDate
    && !['cancelled', 'completed', 'no_show'].includes(String(a.status || '')));
}

export function previewConversion(input: {
  staffId: string;
  appointments: any[];
  clients: any[];
  services: any[];
  choices: ConversionChoices;
}): ConversionPreview {
  const { staffId, appointments, clients, services, choices } = input;
  const served = servedClients(appointments, clients, staffId);
  const picked = new Set(choices.clientIds || []);
  const moving = choices.clientBook === 'follow' ? served
    : choices.clientBook === 'pick' ? served.filter((c) => picked.has(c.id))
    : [];
  const inFlight = inFlightAppointments(appointments, staffId, choices.effectiveDate);
  const mine = (services || []).filter((sv: any) =>
    sv.isActive !== false && (Array.isArray(sv.staffIds) ? sv.staffIds.includes(staffId) : sv.staffId === staffId));

  const warnings: string[] = [];
  if (choices.inFlight === 'transfer' && inFlight.length > 0) {
    warnings.push(`${inFlight.length} booking${inFlight.length === 1 ? '' : 's'} will become theirs — deposits already taken by the studio are NOT moved, so settle those separately.`);
  }
  if (choices.inFlight === 'studio_keeps' && inFlight.length > 0) {
    warnings.push(`${inFlight.length} booking${inFlight.length === 1 ? '' : 's'} stay studio work — they are still paid for these, so include them in the final pay period.`);
  }
  if (choices.clientBook === 'follow' && served.length > 0) {
    warnings.push(`${served.length} client${served.length === 1 ? '' : 's'} leave your book and you will no longer see their history. Check the agreement they signed before choosing this.`);
  }
  if (moving.length === 0 && choices.clientBook !== 'stay') {
    warnings.push('No clients match — they may have served none under this record, or every client is already owned by another renter.');
  }
  if (mine.length === 0 && choices.seedMenu) {
    warnings.push('No house services are assigned to them, so there is nothing to copy into their menu. They can add services themselves.');
  }

  return {
    clientsMoving: moving,
    clientsStaying: served.length - moving.length,
    inFlightCount: inFlight.length,
    inFlightValueCents: inFlight.reduce((n, a) => n + Math.round((Number(a.price) || 0) * 100), 0),
    pastAppointments: (appointments || []).filter((a) => a.staffId === staffId && day(a.startTime) < choices.effectiveDate).length,
    servicesToSeed: mine.map((sv: any) => ({ id: sv.id, name: sv.name || 'Service', price: Number(sv.price) || 0, duration: Number(sv.duration) || 60 })),
    warnings,
  };
}

/**
 * What the staff record becomes. `employedUntil` is the load-bearing field:
 * every historical report reads it to know this person WAS an employee for
 * the period being reported on, so converting never rewrites the past.
 * Pay structure and commission are cleared because leaving them attached is
 * how a booth renter ends up on a payroll draft.
 */
export function staffPatchForConversion(renterId: string, effectiveDate: string): Record<string, any> {
  return {
    isRenter: true,
    renterId,
    employedUntil: effectiveDate,
    becameRenterAt: new Date().toISOString(),
    payStructure: 'none',
    commissionRate: 0,
    pricingTierId: null,
    hourlyRate: 0,
    active: false,
    onBreak: false,
    status: 'idle',
  };
}

/** A plain-words record of what was decided, for the audit line and the file. */
export function conversionSummary(name: string, c: ConversionChoices, p: ConversionPreview): string {
  const book = c.clientBook === 'follow' ? `all ${p.clientsMoving.length} clients follow them`
    : c.clientBook === 'stay' ? 'the client book stays with the studio'
    : `${p.clientsMoving.length} of ${p.clientsMoving.length + p.clientsStaying} clients follow them`;
  const flight = p.inFlightCount === 0 ? 'no bookings were outstanding'
    : c.inFlight === 'transfer' ? `${p.inFlightCount} outstanding bookings transferred to them`
    : `${p.inFlightCount} outstanding bookings stayed studio work`;
  return `${name} became a booth renter on ${c.effectiveDate} — ${book}; ${flight}.`;
}
