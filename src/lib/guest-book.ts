// src/lib/guest-book.ts
//
// ONE PERSON, ONE RECORD.
//
// The booth business touches the same human in four separate collections —
// they enquire (boothApplications), they tour (boothApplications kind:'tour'),
// they book a day (bookings), they sign a lease (leases + renters) — and until
// now the logic that merged those into a single identity lived INSIDE
// components (the guestBook memo in booths-page and again in GuestsToday). A
// page that wanted "who is this person and what have they done with us" had to
// re-derive it or go without, which is why prospects, applicants and renters
// have been managed on three screens that never met.
//
// This module is that merge, lifted out and made pure: give it the raw
// collections, get back one row per person. No Firestore, no React, no
// component state — so any page can ask the same question and get the same
// answer.
//
// Identity is keyed on normalized phone, falling back to email. Value and
// stage are DERIVED live and never stored; the persisted overlay (pipeline
// stage, follow-up date, lost reason, owner notes — see booth-contacts.ts) is
// merged on top by key.

const FREQ_TO_MONTHLY: Record<string, number> = {
  daily: 30,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
};

/** How far a person has come with us. Rank only ever goes up. */
export type GuestStage = 'inquiry' | 'tour' | 'applicant' | 'guest' | 'renter' | 'repeat';

const STAGE_RANK: Record<GuestStage, number> = {
  inquiry: 0, tour: 1, applicant: 2, guest: 3, renter: 4, repeat: 5,
};

export const STAGE_LABEL: Record<GuestStage, string> = {
  inquiry: 'Enquired',
  tour: 'Toured',
  applicant: 'Applied',
  guest: 'Day guest',
  renter: 'Renter',
  repeat: 'Repeat guest',
};

/** Recurring-guest tier — the same thresholds the server uses at booking time. */
export type GuestTier = 'resident' | 'regular' | 'returning' | 'new';

export interface GuestBookEntry {
  key: string;
  name: string;
  phone: string;
  email: string;
  stage: GuestStage;
  stageRank: number;
  tier: GuestTier;
  visits: number;
  visits90: number;
  totalCents: number;
  monthlyRentCents: number;
  firstDate: string;
  lastDate: string;
  isRenter: boolean;
  renterId: string | null;
  lastRating: number | null;
  tags: string[];
  // Persisted overlay — null until the owner has acted on this person.
  pipelineStage: string | null;
  nextFollowUpAt: string | null;
  lostReason: string | null;
  ownerNotes: string | null;
  convertedRenterId: string | null;
  photoUrl: string | null;
  /** Owner-written journey entries from the contact record. */
  history: any[];
}

export interface GuestBookInput {
  /** tenants/{t}/bookings — day and hourly stays. */
  reservations?: any[];
  /** tenants/{t}/boothApplications — enquiries, tours, waitlist. */
  applications?: any[];
  /** tenants/{t}/leases — long-term agreements. */
  leases?: any[];
  /** Renter records by id, for the contact details a lease does not carry. */
  renterById?: Map<string, any>;
  /** tenants/{t}/contacts, keyed the same way, for the managed overlay. */
  contactByKey?: Map<string, any>;
}

const norm = (v: any): string => String(v || '').trim().toLowerCase();

/** The identity key for a person: phone if we have one, else email. */
export function contactKeyOf(phone: any, email: any): string {
  return norm(phone) || norm(email);
}

export function buildGuestBook(input: GuestBookInput): GuestBookEntry[] {
  const reservations = input.reservations || [];
  const applications = input.applications || [];
  const leases = input.leases || [];
  const renterById = input.renterById || new Map<string, any>();
  const contactByKey = input.contactByKey || new Map<string, any>();

  const byContact = new Map<string, any>();

  const get = (phone: any, email: any, name: any) => {
    const key = contactKeyOf(phone, email);
    if (!key) return null;
    let g = byContact.get(key);
    if (!g) {
      g = {
        key, name: name || 'Guest', phone: phone || '', email: email || '',
        visits: 0, visits90: 0, totalCents: 0, monthlyRentCents: 0,
        lastDate: '', firstDate: '9999',
        stage: 'inquiry' as GuestStage, stageRank: 0,
        isRenter: false, renterId: null, lastRating: null, lastReviewedAt: '',
        tags: new Set<string>(),
      };
      byContact.set(key, g);
    }
    if (name && (!g.name || g.name === 'Guest')) g.name = name;
    if (phone && !g.phone) g.phone = phone;
    if (email && !g.email) g.email = email;
    return g;
  };

  const promote = (g: any, stage: GuestStage) => {
    if (STAGE_RANK[stage] > g.stageRank) { g.stage = stage; g.stageRank = STAGE_RANK[stage]; }
  };

  // Day and hourly stays — visits, lifetime value, ratings.
  for (const r of reservations) {
    if (!['confirmed', 'checked_in', 'completed', 'cancel_requested'].includes(r.status)) continue;
    const g = get(r.phone, r.email, r.name);
    if (!g) continue;
    if (['confirmed', 'checked_in', 'completed'].includes(r.status)) {
      g.visits += 1;
      g.totalCents += (r.amountCents || 0) + (r.overageStatus === 'charged' ? (r.overageDueCents || 0) : 0);
      const vt = new Date(r.createdAt || r.startDate || 0).getTime();
      if (vt >= Date.now() - 90 * 24 * 60 * 60 * 1000) g.visits90 += 1;
      promote(g, g.visits > 1 ? 'repeat' : 'guest');
    }
    if ((r.startDate || '') > g.lastDate) g.lastDate = r.startDate;
    if ((r.startDate || '') < g.firstDate) g.firstDate = r.startDate;
    if (Number(r.rating) >= 1 && (r.reviewedAt || '') > (g.lastReviewedAt || '')) {
      g.lastRating = r.rating;
      g.lastReviewedAt = r.reviewedAt || '';
    }
  }

  // Enquiries and tours — the top of the funnel. A lead is never dropped here
  // just because it never became anything; that history is the point.
  for (const app of applications) {
    const g = get(app.phone, app.email, app.name);
    if (!g) continue;
    const when = String(app.decidedAt || app.createdAt || '').slice(0, 10);
    if (when && when > g.lastDate) g.lastDate = when;
    if (when && when < g.firstDate) g.firstDate = when;
    const kind = app.kind || 'application';
    if (kind === 'tour') { promote(g, 'tour'); g.tags.add('toured'); }
    else if (kind === 'waitlist') { g.tags.add('waitlist'); }
    else if (kind === 'application') { promote(g, 'applicant'); }
    else { g.tags.add(String(kind)); }
    // NOTE: only a real application counts as "Applied". The component copies
    // this replaced promoted anything that wasn't a tour — so someone who only
    // ever asked a question showed up as an applicant.
    if (app.status === 'approved') g.tags.add('approved');
    if (app.status === 'converted') g.tags.add('converted');
  }

  // Leases — renters, valued at their rent normalized to a month.
  for (const l of leases) {
    if (!['active', 'on_leave', 'pending_signature'].includes(l.status)) continue;
    const rt = renterById.get(l.renterId);
    if (!rt) continue;
    const g = get(rt.phone, rt.email, `${rt.firstName || ''} ${rt.lastName || ''}`.trim());
    if (!g) continue;
    promote(g, 'renter');
    g.tags.add('renter');
    g.isRenter = true;
    g.renterId = rt.id;
    g.monthlyRentCents = (l.rentAmountCents || 0) * (FREQ_TO_MONTHLY[l.frequency] ?? 1);
  }

  const out: GuestBookEntry[] = Array.from(byContact.values()).map((g) => {
    const c = contactByKey.get(g.key);
    return {
      key: g.key,
      name: g.name,
      phone: g.phone,
      email: g.email,
      stage: g.stage,
      stageRank: g.stageRank,
      tier: g.isRenter ? 'resident'
        : g.visits90 >= 4 ? 'regular'
        : g.visits >= 2 ? 'returning'
        : 'new',
      visits: g.visits,
      visits90: g.visits90,
      totalCents: g.totalCents,
      monthlyRentCents: Math.round(g.monthlyRentCents || 0),
      firstDate: g.firstDate === '9999' ? '' : g.firstDate,
      lastDate: g.lastDate,
      isRenter: g.isRenter,
      renterId: g.renterId,
      lastRating: g.lastRating,
      tags: Array.from(g.tags) as string[],
      pipelineStage: c?.pipelineStage || null,
      nextFollowUpAt: c?.nextFollowUpAt || null,
      lostReason: c?.lostReason || null,
      ownerNotes: c?.ownerNotes || null,
      convertedRenterId: c?.convertedRenterId || (g.isRenter ? g.renterId : null),
      photoUrl: c?.photoUrl || null,
      history: Array.isArray(c?.history) ? c.history : [],
    };
  });

  // Most recently active first — the person you last dealt with is the person
  // you are most likely looking for.
  return out.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
}

/** Free-text match across the fields a person is actually searched by. */
export function guestMatches(g: GuestBookEntry, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [g.name, g.phone, g.email, ...(g.tags || [])]
    .some((v) => String(v || '').toLowerCase().includes(q));
}
