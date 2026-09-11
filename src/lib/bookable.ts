// src/lib/bookable.ts
//
// CAN CLIENTS BOOK THIS PERSON YET?
//
// The same question, asked on two pages, answered two different ways — or on
// the staff page, not answered at all. An employee could be added, given a
// service, and never appear on the booking site because their hours live on a
// third page nobody mentioned. A renter had a chip that said why; an employee
// had nothing, so "why isn't this person showing up" meant loading the public
// site and guessing.
//
// One function, both pages. It returns the FIRST thing missing, not a list,
// because a checklist of five items is a worse answer than the one next step —
// and it returns where to fix it, so the chip can be a link.
//
// Deliberately not a hard gate: nothing here blocks a booking. It describes
// what the availability engine will conclude, in words an owner can act on.

export type BookableReason =
  | 'ok'
  | 'own_system'      // renter takes bookings elsewhere — correct, not a problem
  | 'no_provider'     // renter has no staff record: bookings never switched on
  | 'inactive'        // archived or deactivated
  | 'opted_out'       // explicitly switched off
  | 'no_services'     // nothing to book
  | 'no_hours';       // the one everybody hits

export interface BookableState {
  ok: boolean;
  /** True when this is simply how they work, not something to fix. */
  byDesign: boolean;
  reason: BookableReason;
  /** For a chip: short. */
  label: string;
  /** For a tooltip or a line under it: what to do. */
  fix: string;
  /** Where to go. Empty when there is nothing to fix here. */
  href: string;
}

const OK: BookableState = { ok: true, byDesign: false, reason: 'ok', label: 'Bookable', fix: '', href: '' };

/** Does this person have real working hours on their record? */
export function hasHours(staffDoc: any): boolean {
  const week = staffDoc?.availability?.week || staffDoc?.week || {};
  return Object.keys(week).some((k) => week[k]?.enabled && week[k]?.start && week[k]?.end);
}

/** House services assigned to this staff member. */
export function serviceCountFor(services: any[] | null | undefined, staffId: string): number {
  return (services || []).filter((sv: any) =>
    sv?.isActive !== false && (Array.isArray(sv.staffIds) ? sv.staffIds.includes(staffId) : sv.staffId === staffId)).length;
}

export function bookableState(input: {
  staff: any | null;
  isRenter?: boolean;
  /** Renter's own answer to "how do you take bookings?" */
  bookingMode?: string | null;
  /** House services for an employee, or their own menu count for a renter. */
  serviceCount: number;
}): BookableState {
  const { staff, isRenter, bookingMode, serviceCount } = input;

  // A renter who runs their own booking system is not broken.
  if (isRenter && bookingMode === 'own') {
    return { ok: false, byDesign: true, reason: 'own_system', label: 'Books elsewhere', fix: 'They take bookings through their own system.', href: '' };
  }
  if (!staff) {
    return { ok: false, byDesign: false, reason: 'no_provider', label: 'Bookings off', fix: 'Turn on bookings to give them a menu, hours and a booking link.', href: '/renters' };
  }
  if (staff.isActive === false || staff.archived === true) {
    return { ok: false, byDesign: false, reason: 'inactive', label: 'Not active', fix: 'They are archived — restore them to take bookings again.', href: '' };
  }
  if (staff.bookingOptOut === true) {
    return { ok: false, byDesign: true, reason: 'opted_out', label: 'Booking off', fix: 'Booking is switched off for them on purpose.', href: '' };
  }
  // Services before hours: hours with nothing to book is the emptier failure,
  // and it is the one an owner is likelier to have already half-done.
  if (serviceCount <= 0) {
    return {
      ok: false, byDesign: false, reason: 'no_services',
      label: 'No services',
      fix: isRenter ? 'They build their own menu from their portal — nothing on it yet.' : 'Give them at least one service they can perform.',
      href: isRenter ? '' : '/services',
    };
  }
  if (!hasHours(staff)) {
    return {
      ok: false, byDesign: false, reason: 'no_hours',
      label: 'No hours',
      fix: isRenter
        ? 'They set their own hours from their portal — none set yet.'
        : 'Open their card and set their bookable hours — clients need times to pick.',
      // NOT /schedule: that page writes shift preferences, a different
      // collection entirely. The bookable week lives on the staff record and
      // is edited in Edit staff, which is where this points.
      href: '',
    };
  }
  return OK;
}
