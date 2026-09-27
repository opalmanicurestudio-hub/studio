// src/lib/ics.ts — "Add to calendar" for an event (browser-safe).
//   icsHref(ev)    a .ics file (Apple Calendar, Outlook, most phones)
//   googleHref(ev) Google Calendar's add-event page
export interface CalEvent { title: string; start: string; end?: string | null; location?: string | null; details?: string | null; uid?: string }

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const endOf = (e: CalEvent) => e.end || new Date(new Date(e.start).getTime() + 60 * 60000).toISOString();
const escIcs = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);

export function icsText(e: CalEvent) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClarityFlow//Academy//EN', 'BEGIN:VEVENT',
    `UID:${e.uid || stamp(e.start)}@clarityflow`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(endOf(e))}`,
    `SUMMARY:${escIcs(e.title)}`, ...(e.location ? [`LOCATION:${escIcs(e.location)}`] : []), ...(e.details ? [`DESCRIPTION:${escIcs(e.details.slice(0, 1500))}`] : []),
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
export const icsHref = (e: CalEvent) => `data:text/calendar;charset=utf-8,${encodeURIComponent(icsText(e))}`;
export const googleHref = (e: CalEvent) => `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${stamp(e.start)}/${stamp(endOf(e))}${e.location ? `&location=${encodeURIComponent(e.location)}` : ''}${e.details ? `&details=${encodeURIComponent(e.details.slice(0, 1000))}` : ''}`;
