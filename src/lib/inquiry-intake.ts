// src/lib/inquiry-intake.ts — AN INQUIRY FROM THE PUBLIC FORM, CHECKED AND TIDIED BEFORE IT'S SAVED (api/inquiry).
// What someone planning an event asks a business for: who they are, what and when, what they'd like, where, roughly
// what they'd spend, and anything else. Every field is trimmed and capped; a service is named and priced from the
// business's own list, never from what the form sends; a picture must be one uploaded through the form. Nothing here
// is made up: no distance or travel cost (the business works that out on the quote). Pure.

/** What kind of event, in words that fit any business. */
export const INQUIRY_EVENT_TYPES = [
  { id: 'celebration', label: 'Celebration or party', short: 'celebration' },
  { id: 'wedding', label: 'Wedding', short: 'wedding' },
  { id: 'corporate', label: 'Work or team event', short: 'team event' },
  { id: 'shoot', label: 'Photo or video shoot', short: 'shoot' },
  { id: 'class', label: 'Class or workshop', short: 'class' },
  { id: 'other', label: 'Something else', short: 'event' },
] as const;

export const INQUIRY_BUDGETS = [
  { id: 'under_500', label: 'Under $500' },
  { id: '500_1000', label: '$500 to $1,000' },
  { id: '1000_2500', label: '$1,000 to $2,500' },
  { id: '2500_5000', label: '$2,500 to $5,000' },
  { id: '5000_10000', label: '$5,000 to $10,000' },
  { id: 'over_10000', label: '$10,000 or more' },
  { id: 'flexible', label: 'Not sure yet' },
] as const;

export const INQUIRY_TIMELINES = [
  { id: 'asap', label: 'As soon as possible' },
  { id: '1_month', label: 'Within a month' },
  { id: '3_months', label: 'In 1 to 3 months' },
  { id: '6_months', label: 'In 3 to 6 months' },
  { id: '1_year', label: 'In 6 to 12 months' },
  { id: 'over_year', label: 'More than a year away' },
] as const;

export const INQUIRY_PLACES = [
  { id: 'at_business', label: 'At the business' },
  { id: 'on_site', label: 'At my place or venue' },
  { id: 'destination', label: 'Somewhere farther away' },
  { id: 'unsure', label: 'Not sure yet' },
] as const;

export const INQUIRY_HEARD_FROM = ['Instagram', 'Google', 'A friend', 'Facebook', 'TikTok', 'Pinterest', 'Other'] as const;

const s = (v: any, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const long = (v: any, max = 2000) => String(v ?? '').trim().slice(0, max);
const day = (v: any) => { const x = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(`${x}T12:00:00Z`)) ? x : null; };
const time = (v: any) => { const x = String(v ?? '').slice(0, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? x : null; };
const count = (v: any, max = 10000) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
const oneOf = <T extends readonly { id: string }[]>(list: T, v: any) => (list.some((x) => x.id === v) ? String(v) : null);
const labelOf = (list: readonly { id: string; label: string }[], id: string | null) => (id ? list.find((x) => x.id === id)?.label || null : null);

export type InquiryResult = { ok: true; data: Record<string, any> } | { ok: false; error: string };

/** A picture uploaded through this business's inquiry form (api/inquiry/upload-image), and nothing else. */
export const isInquiryUpload = (u: string, tenantId: string) =>
  new RegExp(`^https://storage\\.googleapis\\.com/[^/]+/tenants/${tenantId.replace(/[^A-Za-z0-9_-]/g, '')}/inquiryInspo/[A-Za-z0-9_-]+\\.[A-Za-z0-9]{1,5}$`).test(u);

/** The inquiry as it's saved, or why it can't be. `services` is the business's own list; `today` is its day. */
export function cleanInquiry(body: any, services: any[], today: string, tenantId: string): InquiryResult {
  const b = body || {};
  const firstName = s(b.firstName, 60), lastName = s(b.lastName, 60);
  const email = s(b.email, 160).toLowerCase(), phone = s(b.phone, 40);
  if (!firstName) return { ok: false, error: 'Please add your first name.' };
  if (!email && !phone) return { ok: false, error: 'Please add an email or a phone number, so they can reply.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'That email doesn’t look right.' };
  if (b.agreedToContact !== true) return { ok: false, error: 'Please agree to be contacted about your inquiry.' };
  const eventDate = day(b.eventDate);
  if (b.eventDate && !eventDate) return { ok: false, error: 'That date doesn’t look right.' };
  if (eventDate && eventDate < today) return { ok: false, error: 'That date has passed. Choose a date that’s coming up.' };

  // Services by their id on the business's own list: its name, price and length, not what the form says.
  const byId = new Map((Array.isArray(services) ? services : []).map((x: any) => [String(x.id), x]));
  const ids = (Array.isArray(b.interestedServiceIds) ? b.interestedServiceIds : []).map(String).filter((id: string) => byId.has(id)).slice(0, 30);
  const interestedServices = ids.map((id: string) => { const x: any = byId.get(id); return { id, name: s(x.name, 120), price: Number(x.price) || 0, duration: Number(x.duration) || 60 }; });
  const customServiceNote = long(b.customServiceNote, 1000) || null;
  if (!ids.length && !customServiceNote) return { ok: false, error: 'Choose at least one thing you’d like, or describe it.' };

  const eventType = oneOf(INQUIRY_EVENT_TYPES, b.eventType) || 'other';
  const venueType = oneOf(INQUIRY_PLACES, b.venueType);
  const venue = { name: s(b.venueName, 120), street: s(b.venueStreet, 160), city: s(b.venueCity, 80), state: s(b.venueState, 40), zip: s(b.venueZip, 20) };
  const eventLocation = [venue.street, venue.city, venue.state, venue.zip].filter(Boolean).join(', ') || null;
  const guestCount = count(b.guestCount);
  const pics = (Array.isArray(b.inspirationImages) ? b.inspirationImages : []).map((u: any) => String(u || ''))
    .filter((u: string) => isInquiryUpload(u, tenantId)).slice(0, 8);
  const budgetRange = oneOf(INQUIRY_BUDGETS, b.budgetRange), timeline = oneOf(INQUIRY_TIMELINES, b.timeline);
  const preferredContact = ['email', 'phone', 'text'].includes(b.preferredContact) ? b.preferredContact : (email ? 'email' : 'text');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return {
    ok: true,
    data: {
      status: 'new', viewed: false, source: 'inquiry_form',
      firstName, lastName, fullName: `${firstName} ${lastName}`.trim(), email, phone, preferredContact,
      bestDays: (() => { const d = (Array.isArray(b.bestDays) ? b.bestDays : []).filter((x: any) => days.includes(x)).slice(0, 7); return d.length ? d : null; })(),
      bestTimeSlot: s(b.bestTimeSlot, 40) || null,
      eventType, eventTypeLabel: labelOf(INQUIRY_EVENT_TYPES, eventType),
      eventName: s(b.eventName, 120) || `${firstName}’s ${INQUIRY_EVENT_TYPES.find((x) => x.id === eventType)?.short || 'event'}`,
      eventDate, alternateDateA: day(b.alternateDateA), startTime: time(b.startTime), endTime: time(b.endTime),
      guestCount, partySize: count(b.partySize) || guestCount,
      interestedServiceIds: ids, interestedServices, customServiceNote,
      estimatedHours: interestedServices.reduce((a: number, x: any) => a + x.duration / 60, 0) || null,
      venueType, venueTypeLabel: labelOf(INQUIRY_PLACES, venueType), venueName: venue.name || null, venueStreet: venue.street || null, venueCity: venue.city || null, venueState: venue.state || null, venueZip: venue.zip || null,
      eventLocation,
      budgetRange, budgetLabel: labelOf(INQUIRY_BUDGETS, budgetRange), timeline, timelineLabel: labelOf(INQUIRY_TIMELINES, timeline),
      readyToDeposit: b.readyToDeposit === true,
      referralSource: INQUIRY_HEARD_FROM.includes(b.referralSource) ? b.referralSource : null,
      referralCode: s(b.referralCode, 40).toUpperCase() || null,
      specialRequests: long(b.specialRequests, 2000) || null,
      inspirationImages: pics.length ? pics : null,
      priority: guestCount >= 20 ? 'high' : 'normal',
    },
  };
}
