// src/lib/owner-taxes-server.ts — THE OWNER'S TAX SET-ASIDE (server; the Money page's Taxes tab, api/owner-taxes;
// lib/renter-taxes works out the plan, the same as a renter's). For a business that files on Schedule C (a sole
// proprietor or a one-owner LLC): the books' tentative profit month by month, as the Tax summary in Reports works it out
// (lib/report-builders profitByMonth), less business miles from the owner's mileage log. What the owner says (how they
// file, their state, other income, last year's tax, how the business files) and the payments they record are kept with
// the business, server only (tenants/{t}/private/ownerTaxes_{year}); reminders the week before each date go to the owner
// alone: on the Money page (ownerTaxDueSoon) and, if they ask, an email to their own address (remindOwnerTaxes, from
// the nightly job). The business's message log keeps only that a reminder went out.
import { profitByMonth } from '@/lib/report-builders';
import { dayOf } from '@/lib/write-offs';
import { tripsOf, todayFor } from '@/lib/trip-log-server';
import { amountCents } from '@/lib/trip-log';
import { dueSoon, paidToward, remindChannelOf } from '@/lib/renter-taxes';
import { brandedEmailHtml } from '@/lib/email-template';
import { sendNotification } from '@/lib/notify';

const IN = 30;
export const ownerTaxRef = (db: any, t: string, year: number) => db.doc(`tenants/${t}/private/ownerTaxes_${year}`);
export const ownerRemindRef = (db: any, t: string) => db.doc(`tenants/${t}/private/ownerTaxReminders`);

/** The year's lines from a day on (`from`, yyyy-mm-dd), dated as text or (older lines) as a stored time, and the lines
 *  their take-backs point at. A failed read throws, so it's never taken for a year with nothing in it. */
async function yearLines(db: any, t: string, year: number, from: string): Promise<{ lines: any[]; lookup: any[] }> {
  const col = db.collection(`tenants/${t}/transactions`); const byId = new Map<string, any>();
  const add = (snap: any) => { for (const d of snap?.docs || []) byId.set(d.id, { ...(d.data() || {}), id: d.id }); };
  add(await col.where('date', '>=', from).where('date', '<', `${year + 1}-01-01`).get());
  try {
    const { Timestamp } = await import('firebase-admin/firestore');
    add(await col.where('date', '>=', Timestamp.fromMillis(Date.parse(`${from}T00:00:00Z`) - 86400e3)).where('date', '<', Timestamp.fromMillis(Date.UTC(year + 1, 0, 1) + 86400e3)).get());
  } catch { /* text dates are the rule; older stored times are a bonus */ }
  const lines = [...byId.values()].filter((x) => { const d = dayOf(x.date); return d.slice(0, 4) === String(year) && d >= from; });
  // (A take-back this year of a line from before: its line is read too, so it's counted as what it takes back.)
  const want = [...new Set(lines.flatMap((x) => [x.reversalOf, x.voidOf, x.correctionOf].filter(Boolean).map(String)))].filter((id) => !byId.has(id));
  for (let i = 0; i < want.length; i += IN) {
    const refs = want.slice(i, i + IN).map((id) => col.doc(id));
    const got = await db.getAll(...refs).catch(() => []);
    for (const s of got) if (s?.exists) byId.set(s.id, { ...(s.data() || {}), id: s.id });
  }
  return { lines, lookup: [...byId.values()] };
}

const VEHICLE = /^vehicle$/i; const NOT_CAR = /park|toll/i;
const monthAfter = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };

/** The year's figures for the plan: the books' profit by month, and business miles by month at the year's rate (left out
 *  when the books have car costs other than parking and tolls: the mileage rate stands in for those). Months before last
 *  month are kept once worked out (ownerTaxes_{year}.figures), so a visit reads only the latest lines; `fresh` reads the
 *  whole year again (a line added since to an earlier month). */
export async function ownerTaxFigures(db: any, t: string, year: number, today: string, fresh = false): Promise<{ earnedByMonth: Record<string, number>; writeOffsByMonth: Record<string, number>; milesLeftOut: boolean; countedAt: string | null }> {
  const ref = ownerTaxRef(db, t, year); const kept: any = (await ref.get()).data() || {};
  const cache = !fresh && kept.figures && typeof kept.figures === 'object' ? kept.figures : null;
  const upTo = cache && /^\d{4}-\d{2}$/.test(String(cache.upTo || '')) && String(cache.upTo).slice(0, 4) === String(year) ? String(cache.upTo) : null;
  const from = upTo ? `${monthAfter(upTo)}-01` : `${year}-01-01`;
  const [{ lines, lookup }, trips] = await Promise.all([from.slice(0, 4) === String(year) ? yearLines(db, t, year, from) : Promise.resolve({ lines: [], lookup: [] }), tripsOf(db, t, year, null).catch(() => [])]);
  const fresher = profitByMonth(lines, year, lookup);
  const months: Record<string, number> = { ...(upTo ? cache.months || {} : {}), ...fresher };
  const car = (upTo && cache.car === true) || lines.some((x) => String(x.context || '').toLowerCase() !== 'personal' && x.type === 'expense' && VEHICLE.test(String(x.category || '').trim()) && !NOT_CAR.test(`${x.description || ''} ${x.clientOrVendor || ''}`));
  // (Months before last month are kept: a month's lines rarely change once it's two months gone.)
  const [ty, tm] = today.split('-').map(Number); const twoAgo = new Date(Date.UTC(ty, tm - 3, 1)).toISOString().slice(0, 7);
  const keepTo = year < ty ? (tm >= 3 ? `${year}-12` : twoAgo < `${year}-01` ? null : twoAgo) : twoAgo.slice(0, 4) === String(year) ? twoAgo : null;
  if (keepTo && keepTo !== upTo) {
    const keepMonths = Object.fromEntries(Object.entries(months).filter(([m]) => m <= keepTo));
    await ref.set({ figures: { upTo: keepTo, months: keepMonths, car, at: new Date().toISOString() } }, { merge: true }).catch(() => {});
  }
  const miles: Record<string, number> = {};
  if (!car) for (const x of trips as any[]) if (x && x.kind === 'trip' && !x.removed && x.use === 'business' && String(x.day || '').slice(0, 4) === String(year)) { const m = String(x.day).slice(0, 7); miles[m] = (miles[m] || 0) + amountCents(Number(x.tenths) || 0, year); }
  return { earnedByMonth: months, writeOffsByMonth: miles, milesLeftOut: car, countedAt: fresh || !upTo ? new Date().toISOString() : String(cache.at || '') || null };
}

const mdy = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The week before each date: an email to the owner's own address (their sign-in), when they asked for one, once per
 *  date, unless the business doesn't file on Schedule C or they've recorded paying the IRS toward it; one that didn't go
 *  is tried again the next night. (In ClarityFlow, the Money page shows the owner alone the same reminder, api/owner-taxes
 *  'status'.) Returns emails sent. */
export async function remindOwnerTaxes(db: any, t: string, tenant: any, today: string = todayFor(tenant), emailOf: (uid: string) => Promise<string> = ownerSignInEmail): Promise<number> {
  const soon = dueSoon(today, 7); if (!soon || soon.inDays < 1) return 0;
  const rRef = ownerRemindRef(db, t); const rem: any = (await rRef.get()).data() || {};
  if (remindChannelOf(rem.channel) !== 'email' || rem.mailed?.[soon.due]) return 0;
  const yr: any = (await ownerTaxRef(db, t, soon.forYear).get()).data() || {};
  if (yr.structure !== 'schedule_c' || paidToward(yr.payments, soon.due)) return 0;
  const to = String(await emailOf(String(tenant?.ownerId || '')).catch(() => '') || tenant?.ownerEmail || '').trim();
  if (!EMAIL.test(to)) return 0;
  const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(rRef)).data() || {}; if (cur.mailed?.[soon.due]) return false; tx.set(rRef, { mailed: { [soon.due]: new Date().toISOString() } }, { merge: true }); return true; });
  if (!mine) return 0;
  const unclaim = () => rRef.set({ mailed: { [soon.due]: null } }, { merge: true }).catch(() => {});
  const when = mdy(soon.due);
  try {
    const res: any = await sendNotification(db, { tenantId: t, channel: 'email', to, subject: `Estimated taxes are due ${when}`,
      html: brandedEmailHtml({ studioName: String(tenant?.name || 'ClarityFlow'), title: `Estimated taxes are due ${when}`, bodyLines: [
        `Your next estimated tax payment toward ${soon.forYear} is due ${when}.`,
        'Open Money, then Taxes, to see what to send the IRS and your state, then mark it paid there.',
        'An estimate to set money aside by: your accountant works out what you owe. To stop these emails, choose In ClarityFlow or Off under Reminders on that tab.',
      ] }),
      kind: 'owner_tax_reminder', recipientType: 'other', privateToRecipient: true } as any);
    if (res && res.ok === false && res.status !== 'skipped_by_policy') { await unclaim(); return 0; }
    return 1;
  } catch { await unclaim(); return 0; }
}

/** The owner's own email: their sign-in, never the business's shared address. */
export async function ownerSignInEmail(uid: string): Promise<string> {
  if (!uid) return '';
  const { getAdminAuth } = await import('@/lib/firebase-admin');
  return String((await getAdminAuth().getUser(uid)).email || '');
}

/** What the Money page shows the owner alone: the next date when it's a week away or less, unless reminders are off,
 *  the business doesn't file on Schedule C, or they've recorded paying the IRS toward it. */
export async function ownerTaxDueSoon(db: any, t: string, today: string): Promise<{ due: string; inDays: number } | null> {
  const soon = dueSoon(today, 7); if (!soon) return null;
  const rem: any = (await ownerRemindRef(db, t).get()).data() || {};
  if (remindChannelOf(rem.channel) === 'off') return null;
  const yr: any = (await ownerTaxRef(db, t, soon.forYear).get()).data() || {};
  if (yr.structure !== 'schedule_c' || paidToward(yr.payments, soon.due)) return null;
  return { due: soon.due, inDays: soon.inDays };
}
