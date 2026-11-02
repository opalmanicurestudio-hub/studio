// src/lib/visit-email.ts — THE WORDS AT THE TOP OF A VISIT EMAIL (ClientEmails board 15G): "See you Saturday",
// "Sat, Nov 8 · 3:30 PM". Works on a wall-clock Date, an instant already moved into the business's local time and
// read in UTC (how the booking route and the reminders keep their times), so it agrees with every other time those
// messages print.

const DAY = 864e5;
const ymd = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** "today", "tomorrow", the weekday within the coming week ("Saturday"), or the date ("Sat, Nov 22"). */
export function seeYouDay(wall: Date, wallNow: Date): string {
  const days = Math.round((ymd(wall) - ymd(wallNow)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return wall.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return wall.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The time ("3:30 PM") and the line for the details panel ("Sat, Nov 8 · 3:30 PM"). */
export function wallWhen(wall: Date): { time: string; big: string } {
  const time = wall.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return { time, big: `${wall.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${time}` };
}

/** "Gel manicure with Mia · 60 min" — what and with whom, for the details panel. */
export function whatLine(service: string, staffName?: string | null, minutes?: number | null): string {
  const m = Number(minutes) || 0;
  return `${service}${staffName ? ` with ${staffName}` : ''}${m > 0 ? ` · ${m >= 60 && m % 60 === 0 ? `${m / 60} hr` : `${m} min`}` : ''}`;
}

/** The names a desk puts on a sale or visit with no client ("Guest", "Walk-in customer"): never used as a first name. */
export function isPlaceholderName(name: unknown): boolean {
  return /^(an? |the )?(walk[\s-]?in( guest| client| customer)?|guest|client|customer|there)$/i.test(String(name || '').trim());
}
