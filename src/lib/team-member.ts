// src/lib/team-member.ts — WHO IS ON THE TEAM, AND WHO IS CLOCKED IN (client and server safe).
// A team member's `active` flag belongs to the time clock: true while they're clocked in, false once they clock out
// (lib/punch), and false for someone just added who hasn't clocked in yet. It never meant "still works here". Reading it
// that way hid everyone who wasn't clocked in from the booking page, "Any available", the planner and the team counts, so
// a business that doesn't use the time clock looked as if it had nobody. Whether someone works here is the record's own:
// not archived and not switched off.

/** Works here: not archived, not switched off. Clocked in or not doesn't matter. */
export const onTeam = (m: any): boolean => !!m && m.archived !== true && m.isActive !== false && m.status !== 'archived' && m.status !== 'inactive';

/** Clocked in right now (the time clock). */
export const onClock = (m: any): boolean => !!m && m.active === true;

/** Clocked out earlier today, so gone for the day: not offered for later today. Someone who simply hasn't clocked in
 *  yet (or a business that doesn't use the time clock) is not gone. `isToday` decides "today" the way the caller does. */
export const goneForToday = (m: any, isToday: (d: Date) => boolean): boolean => {
  if (!m || m.active !== false || !m.lastClockOut) return false;
  const at = new Date(m.lastClockOut);
  return Number.isFinite(at.getTime()) && isToday(at);
};
