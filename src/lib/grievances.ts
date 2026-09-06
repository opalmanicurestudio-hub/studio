// src/lib/grievances.ts
//
// A CONCERN, RAISED PROPERLY.
//
// Renters already have a thread with the studio, and that is where most
// things belong. But "the dryer at my station has been dead for a week and
// this is the third time I have mentioned it" is not a chat message — it is a
// record that needs a reference number, a category, a date, a status the
// renter can see, and a documented response. Without that structure, the
// serious things arrive as texts, get answered verbally, and are un-findable
// the day a lease ends badly.
//
// The record is deliberately small. Everything conversational about it still
// happens in the renter's thread: filing one writes a line there, and every
// owner response goes through the same 'renter-message' door as any other
// message — emailed, texted, and logged with delivery status. So the concern
// shows up in the drawer's Messages tab, the account timeline and the Full
// Account Record with zero extra plumbing. This module only owns the
// structured part.

export type GrievanceCategory = 'space' | 'equipment' | 'cleanliness' | 'noise' | 'another_renter' | 'staff' | 'billing' | 'safety' | 'access' | 'other';
export type GrievanceStatus = 'open' | 'acknowledged' | 'resolved' | 'closed';

export const GRIEVANCE_CATEGORY_LABEL: Record<GrievanceCategory, string> = {
  space: 'My space',
  equipment: 'Equipment',
  cleanliness: 'Cleanliness',
  noise: 'Noise or disruption',
  another_renter: 'Another renter',
  staff: 'A staff member',
  billing: 'Rent or billing',
  safety: 'Safety',
  access: 'Access or hours',
  other: 'Something else',
};

export const GRIEVANCE_STATUS_LABEL: Record<GrievanceStatus, string> = {
  open: 'Received',
  acknowledged: 'Being looked at',
  resolved: 'Resolved',
  closed: 'Closed',
};

/**
 * Sensitive categories default to CONFIDENTIAL: a complaint about a person is
 * not something to broadcast in a shared thread by accident. The renter can
 * still untick it; the default just errs toward discretion.
 */
export const CONFIDENTIAL_BY_DEFAULT: GrievanceCategory[] = ['another_renter', 'staff', 'safety'];

export interface GrievanceRecord {
  id: string;
  ref: string;               // e.g. C-2609-4K7Q — what both sides quote
  renterId: string;
  renterName: string;
  category: GrievanceCategory;
  what: string;              // what happened
  when: string;              // YYYY-MM-DD the renter says it happened / started
  wanted: string;            // what they would like to see happen
  confidential: boolean;
  status: GrievanceStatus;
  filedAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolution?: string | null;
  responses?: number;        // count of owner responses sent through the thread
}

/** A short reference both sides can read aloud: C-YYMM-XXXX, no ambiguous glyphs. */
export function makeGrievanceRef(nowIso: string): string {
  const d = new Date(nowIso);
  const yymm = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `C-${yymm}-${tail}`;
}

export function isOpenGrievance(g: { status?: string }): boolean {
  return g.status === 'open' || g.status === 'acknowledged';
}
