// src/lib/outreach-pause.ts — "Hold automatic offers today": one switch for a busy or short-staffed day. While it's on,
// nothing goes out on its own: waitlist offers, party offers and calls, opportunity texts and tasks, reward texts,
// automations and scheduled campaigns. Reminders, confirmations and receipts still go — those are service, not offers.
// It ends on its own at midnight (the business's time), or sooner if someone turns it off. tenant.outreachPause.
import { endOfDay, dayKey, tenantTimeZone } from '@/lib/tenant-time';

export type OutreachPause = { until: string; by: string | null; at: string; why?: string | null };
export function pauseOf(tenant: any): OutreachPause | null { const p = tenant?.outreachPause; return p && typeof p.until === 'string' ? p : null; }
export function pausedNow(tenant: any, now = Date.now()): boolean { const p = pauseOf(tenant); return !!p && Date.parse(p.until) > now; }
/** Until the end of today, in the business's own time. */
export function pauseUntil(tenant: any, now = Date.now()): string { const tz = tenantTimeZone(tenant); return endOfDay(dayKey(new Date(now), tz), tz).toISOString(); }
