// src/lib/service-place.ts — WHERE A SERVICE HAPPENS: at the studio (default),
// online (with a meeting link), or at the client's place (mobile). One source
// for the words every message and the visit link use, so an online or mobile
// appointment is never told to "check in when you arrive". Pure.
export type PlaceKind = 'studio' | 'online' | 'client';
export interface ServicePlace { kind: PlaceKind; meetingLink: string | null }

export function placeOf(svc: any): ServicePlace {
  const k = svc?.where === 'online' || svc?.where === 'client' ? svc.where : 'studio';
  const link = k === 'online' && /^https?:\/\//i.test(String(svc?.meetingLink || '')) ? String(svc.meetingLink) : null;
  return { kind: k, meetingLink: link };
}
/** The extra line for confirmations and reminders (null for the studio). */
export function placeLine(svc: any, clientAddress?: string | null): string | null {
  const p = placeOf(svc);
  if (p.kind === 'online') return p.meetingLink ? `This is an online appointment — join here: ${p.meetingLink}` : 'This is an online appointment — we’ll send your link before it starts.';
  if (p.kind === 'client') return clientAddress ? `We’ll come to you at ${clientAddress}.` : 'We’ll come to you — we’ll confirm your address before your appointment.';
  return null;
}
/** Replaces "show the code when you arrive" for services that don't happen at the studio. */
export function arrivalLine(svc: any): string {
  const p = placeOf(svc);
  return p.kind === 'online' ? 'Join from the link — no check-in needed.' : p.kind === 'client' ? 'We’ll come to you — no need to check in.' : 'Show the code below when you arrive to check in.';
}
/** A client's address, as one line (their profile). */
export function clientAddressOf(c: any): string | null {
  const a = c?.address; if (!a) return null;
  if (typeof a === 'string') return a.trim() || null;
  const s = [a.street || a.line1, a.line2, a.city, a.state, a.zip || a.postalCode].filter(Boolean).join(', ');
  return s || (a.formatted ? String(a.formatted) : null);
}
