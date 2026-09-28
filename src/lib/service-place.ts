// src/lib/service-place.ts — WHERE / HOW A SERVICE HAPPENS.
//   studio → "In person" (at your business — the default)
//   online → "Video call" (a meeting link; a booking can have its own)
//   phone  → "Phone call" (we call them, or they call us)
//   client → "At the client's location" (mobile — you go to them)
// One source for the words every message and the visit link use, so remote and
// mobile visits are never told to "check in when you arrive". Pure.
export type PlaceKind = 'studio' | 'online' | 'phone' | 'client';
export type PhoneWho = 'we_call' | 'they_call';
export interface ServicePlace { kind: PlaceKind; meetingLink: string | null; ownLink?: boolean; phoneWho?: PhoneWho }
const httpsOnly = (v: any) => (/^https:\/\//i.test(String(v || '').trim()) ? String(v).trim() : null);

export const PLACE_LABEL: Record<PlaceKind, string> = { studio: 'In person', online: 'Video call', phone: 'Phone call', client: 'At the client’s location' };

const KINDS: PlaceKind[] = ['studio', 'online', 'phone', 'client'];
/** The options a client may pick from when booking (the service's main one first). One option = no choice. */
export function placeOptionsOf(svc: any): PlaceKind[] {
  const main: PlaceKind = KINDS.includes(svc?.where) ? svc.where : 'studio';
  if (svc?.clientChoosesPlace !== true) return [main];
  const alts = (Array.isArray(svc?.placeAlternatives) ? svc.placeAlternatives : []).filter((k: any) => KINDS.includes(k) && k !== main);
  return [main, ...alts];
}

/** Where it happens. The client's choice on THIS booking wins (if the service allows it); for video calls, a link set on the booking wins over the service's shared one. */
export function placeOf(svc: any, appt?: any): ServicePlace {
  const chosen = appt?.place && placeOptionsOf(svc).includes(appt.place) ? appt.place : null;
  const w = chosen || svc?.where;
  const k: PlaceKind = w === 'online' || w === 'client' || w === 'phone' ? w : 'studio';
  if (k === 'phone') return { kind: k, meetingLink: null, phoneWho: svc?.phoneWho === 'they_call' ? 'they_call' : 'we_call' };
  if (k !== 'online') return { kind: k, meetingLink: null };
  const own = httpsOnly(appt?.meetingLink);
  return { kind: k, meetingLink: own || httpsOnly(svc?.meetingLink), ownLink: !!own };
}
/** Video, phone and mobile visits have no arriving at your door — no check-in; staff start them directly. */
export const skipsCheckIn = (kind: PlaceKind) => kind === 'online' || kind === 'phone' || kind === 'client';
/** Remote visits may be joined from another time zone — say which one the times are in. */
export const isRemote = (kind: PlaceKind) => kind === 'online' || kind === 'phone';

/** "Eastern Time", "Central European Time" … (falls back to the zone id). */
export function zoneLabel(timeZone?: string | null): string | null {
  if (!timeZone) return null;
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value || '';
    return part.replace(/\b(Standard|Daylight) /, '') || timeZone;   // "Eastern Time"; keeps "British Summer Time" whole
  } catch { return timeZone; }
}
const tail4 = (p?: string | null) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? `the number ending ${d.slice(-4)}` : 'your number on file'; };

/** The extra line for confirmations and reminders (null for in-person). */
export function placeLine(svc: any, clientAddress?: string | null, appt?: any, opts: { timeZone?: string | null; clientPhone?: string | null; businessPhone?: string | null } = {}): string | null {
  const p = placeOf(svc, appt);
  const tz = isRemote(p.kind) ? zoneLabel(opts.timeZone) : null;
  const zone = tz ? ` Times are in ${tz}.` : '';
  // The link goes LAST, with nothing after it — a full stop right after a link breaks it in some text apps.
  if (p.kind === 'online') return p.meetingLink ? `This is a video call${tz ? ` (times are in ${tz})` : ''} — join here: ${p.meetingLink}` : `This is a video call — we’ll send your link before it starts.${zone}`;
  if (p.kind === 'phone') return (p.phoneWho === 'they_call'
    ? `This is a phone call — please call us${opts.businessPhone ? ` at ${opts.businessPhone}` : ''} at your appointment time.`
    : `This is a phone call — we’ll call you on ${tail4(opts.clientPhone)} at your appointment time.`) + zone;
  if (p.kind === 'client') return clientAddress ? `We’ll come to you at ${clientAddress}.` : 'We’ll come to you — we’ll confirm your address before your appointment.';
  return null;
}
/** Replaces "show the code when you arrive" for visits that don't happen at your door. */
export function arrivalLine(svc: any): string {
  const p = placeOf(svc);
  return p.kind === 'online' ? 'Join from the link — no check-in needed.' : p.kind === 'phone' ? 'No check-in needed — just be near your phone.' : p.kind === 'client' ? 'We’ll come to you — no need to check in.' : 'Show the code below when you arrive to check in.';
}
/** A client's address, as one line (their profile). */
export function clientAddressOf(c: any): string | null {
  const a = c?.address; if (!a) return null;
  if (typeof a === 'string') return a.trim() || null;
  const s = [a.street || a.line1, a.line2, a.city, a.state, a.zip || a.postalCode].filter(Boolean).join(', ');
  return s || (a.formatted ? String(a.formatted) : null);
}
