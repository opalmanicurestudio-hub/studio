// src/lib/renter-comms.ts
//
// EVERYTHING A RENTER'S CLIENT HEARS ABOUT A PACKAGE OR MEMBERSHIP, AND
// EVERYTHING THE RENTER IS TOLD ABOUT THEM — IN ONE PLACE.
//
// Until this file, the only party notified of a package sale or a new member
// was the STUDIO OWNER (a bell in the main app). The renter learned nothing;
// the client got only Stripe's receipt. Now each event has two outputs:
//
//   1. tellClient()  — an email (and a text if there is a phone) in the
//      RENTER'S name, from the shared email template, never in the studio's
//      voice. Kinds are `renter_*` and deliberately NOT in Settings → Messages:
//      these are the renter's messages.
//   2. alertRenter() — a line in `renterAlerts`, which the portal's Today
//      inbox reads, so the renter sees "Kylie's card failed" the moment it
//      happens, not when they notice a missing payout.
//
// The webhook, the portal route and the client's self-cancel all import from
// here so the wording is one wording.

import { brandedEmailHtml } from '@/lib/email-template';
import { sendNotification } from '@/lib/notify';

export interface RenterVoice { tenantId: string; renterId: string; renterName: string; studioName: string; bookingUrl?: string | null }

export async function renterVoice(db: any, tenantId: string, renterId: string): Promise<RenterVoice> {
  const [rSnap, tSnap] = await Promise.all([db.doc(`tenants/${tenantId}/renters/${renterId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const r = (rSnap.data() as any) || {};
  const t = (tSnap.data() as any) || {};
  const renterName = String(r.businessName || '').trim() || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Your provider';
  const origin = String(t.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
  let bookingUrl: string | null = null;
  try {
    const st = await db.collection(`tenants/${tenantId}/staff`).where('renterId', '==', renterId).limit(1).get();
    if (!st.empty && origin) bookingUrl = `${origin}/book/${tenantId}?provider=${st.docs[0].id}`;
  } catch { /* no link */ }
  return { tenantId, renterId, renterName, studioName: t.name || 'the studio', bookingUrl };
}

export async function tellClient(db: any, v: RenterVoice, to: { email?: string | null; phone?: string | null; clientId?: string | null; name?: string | null }, subject: string, lines: string[], kind: string) {
  const email = String(to.email || '').trim();
  const phone = String(to.phone || '').trim();
  if (!email && !phone) return;
  try {
    if (email.includes('@')) {
      await sendNotification(db, { tenantId: v.tenantId, channel: 'email', to: email, subject,
        html: brandedEmailHtml({ studioName: v.renterName, title: subject, bodyLines: lines, footerNote: `Sent by ${v.renterName}, renting at ${v.studioName}.` }),
        kind, recipientType: 'client', recipientId: to.clientId || null, recipientName: to.name || null } as any);
    }
    if (phone) {
      await sendNotification(db, { tenantId: v.tenantId, channel: 'sms', to: phone, text: `${v.renterName}: ${lines[0]}`, kind, recipientType: 'client', recipientId: to.clientId || null, recipientName: to.name || null } as any);
    }
  } catch { /* best-effort; the event itself already stands */ }
}

export async function alertRenter(db: any, tenantId: string, renterId: string, kind: string, text: string, tab: 'book' | 'rent' | 'studio' = 'book', tone: 'red' | 'amber' | 'green' | 'slate' = 'slate') {
  try {
    const ref = db.collection(`tenants/${tenantId}/renterAlerts`).doc();
    await ref.set({ id: ref.id, renterId, kind, text, tab, tone, at: new Date().toISOString() });
  } catch { /* best-effort */ }
}

/** The lines a client reads when they join. Perks are listed exactly as the renter wrote them. */
export function membershipWelcomeLines(v: RenterVoice, m: { name: string; includedVisits: number; discountPct: number; perks: string[]; priceCents: number }, manageUrl?: string | null): string[] {
  const perks = [
    m.includedVisits > 0 ? `${m.includedVisits} visit${m.includedVisits === 1 ? '' : 's'} included every month — just book as usual and tell me it's a member visit` : null,
    m.discountPct > 0 ? `${m.discountPct}% off every other service` : null,
    ...(m.perks || []),
  ].filter(Boolean) as string[];
  return [
    `Welcome to ${m.name}! You're in.`,
    perks.length ? `What you get: ${perks.join(' · ')}.` : '',
    `$${(m.priceCents / 100).toFixed(2)} a month, billed to the card you used. Cancel any time${manageUrl ? ` here: ${manageUrl}` : ' — just ask me'}.`,
    v.bookingUrl ? `Book your first member visit: ${v.bookingUrl}` : '',
  ].filter(Boolean);
}

// ── Tell the RENTER — not just their inbox, their phone ────────────────────
// Every event about a renter's own client used to land only in the portal's
// Today list (or, for requests, in the STUDIO OWNER's email). Now each kind
// of event reaches the renter by the channel they chose in My client
// messages → "Tell me when…". Defaults: requests and cancellations by text
// and email (they need action or change the day), everything else inbox-only.

export type RenterNotifyKind = 'new_booking' | 'request' | 'cancelled' | 'rescheduled' | 'running_late' | 'arrived' | 'money';
export type RenterChannel = 'off' | 'inbox' | 'sms' | 'email' | 'both';

export const RENTER_NOTIFY_DEFAULTS: Record<RenterNotifyKind, RenterChannel> = {
  new_booking: 'sms', request: 'both', cancelled: 'both', rescheduled: 'sms', running_late: 'sms', arrived: 'inbox', money: 'inbox',
};
export const RENTER_NOTIFY_LABELS: Record<RenterNotifyKind, string> = {
  new_booking: 'Someone books with me',
  request: 'Someone requests a time (needs my answer)',
  cancelled: 'A client cancels',
  rescheduled: 'A client moves their visit',
  running_late: 'A client says they\'re running late',
  arrived: 'A client checks in',
  money: 'Packages, memberships and payments',
};

export function channelFor(prefs: any, kind: RenterNotifyKind): RenterChannel {
  const v = prefs && typeof prefs === 'object' ? prefs[kind] : undefined;
  return (['off', 'inbox', 'sms', 'email', 'both'] as const).includes(v) ? v : RENTER_NOTIFY_DEFAULTS[kind];
}

export async function notifyRenter(db: any, tenantId: string, renterId: string, kind: RenterNotifyKind, text: string, opts: { tone?: 'red' | 'amber' | 'green' | 'slate'; tab?: 'book' | 'rent' | 'studio'; subject?: string; link?: string | null } = {}) {
  let r: any = {};
  try { r = ((await db.doc(`tenants/${tenantId}/renters/${renterId}`).get()).data() as any) || {}; } catch { /* inbox still works */ }
  const ch = channelFor(r.renterNotify, kind);
  if (ch === 'off') return;
  await alertRenter(db, tenantId, renterId, kind, text, opts.tab || 'book', opts.tone || 'slate');
  if (ch === 'inbox') return;
  const email = String(r.email || '').trim();
  const phone = String(r.phone || '').trim();
  const body = opts.link ? `${text}\n${opts.link}` : text;
  try {
    if ((ch === 'sms' || ch === 'both') && phone) {
      await sendNotification(db, { tenantId, channel: 'sms', to: phone, text: body, kind: `renter_self_${kind}`, recipientType: 'renter', recipientId: renterId } as any);
    }
    if ((ch === 'email' || ch === 'both') && email.includes('@')) {
      await sendNotification(db, { tenantId, channel: 'email', to: email, subject: opts.subject || text.slice(0, 80),
        html: brandedEmailHtml({ studioName: 'Your book', title: opts.subject || 'An update on your book', bodyLines: [text, opts.link ? `Open your portal: ${opts.link}` : ''].filter(Boolean) }),
        kind: `renter_self_${kind}`, recipientType: 'renter', recipientId: renterId } as any);
    }
  } catch { /* best-effort; the inbox line already stands */ }
}

/** The renter's portal link, for "open it" lines. */
export async function renterPortalUrl(db: any, tenantId: string): Promise<string | null> {
  try {
    const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const origin = String(t.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
    return origin ? `${origin}/rent/${tenantId}` : null;
  } catch { return null; }
}
