// src/lib/month-review.ts — THE MONTH IN REVIEW, for the owner, on the first of each month: what the automatic parts of
// the business did last month, in one page. Waitlist openings filled (and how), rewards earned and used, what
// opportunities brought back, voice-assistant calls against the limit, texts that didn't go through and opt-outs, and
// gift card money owed between locations. Pure math here; loadMonthReview gathers the month; monthReviewNotice tells
// the owner (and managers) on the 1st, with an email to the owner.
import { locationSettlement } from '@/lib/gift-limits';
import { monthLabel, prevMonth } from '@/lib/mir-report';

const ms = (v: any) => Date.parse(String(v || '')) || 0;
export type MonthReview = ReturnType<typeof monthReview>;

export function monthReview(x: { month: string; openings: any[]; ledger: any[]; results: any[]; opportunities: any[]; callsUsed: number; callsAllowed: number; callsOn: boolean; messages: any[]; inbox: any[]; cards: any[]; startMs: number; endMs: number; locationNames?: Record<string, string> }) {
  const inMonth = (v: any) => { const t = ms(v); return t >= x.startMs && t < x.endMs; };
  const ops = x.openings.filter((o) => inMonth(o.createdAt));
  const filled = ops.filter((o) => o.status === 'filled');
  const how = { text: 0, call: 0, party: 0, auto: 0, moveUp: 0 };
  for (const o of filled) { const f = o.filledBy || {}; if (f.byCall) how.call++; else if (f.kind === 'party') how.party++; else if (f.auto) how.auto++; else if (f.kind === 'sooner') how.moveUp++; else how.text++; }
  const led = x.ledger.filter((l) => inMonth(l.at));
  const sumP = (t: string[]) => led.filter((l) => t.includes(l.type)).reduce((s, l) => s + (Number(l.points) || 0), 0);
  const redeems = led.filter((l) => l.type === 'redeem'); const givenBack = led.filter((l) => l.type === 'reverse' && l.of === 'redeem').length;
  const res = x.results.filter((r) => String(r.startTime || '') && inMonth(r.startTime));
  const paid = res.filter((r) => r.state === 'paid'); const oppMade = x.opportunities.filter((o) => inMonth(o.createdAt) && !o.renterId);
  const contacted = oppMade.filter((o) => (o.attempts || []).length > 0 || o.status === 'auto' || o.status === 'done');
  const msgs = x.messages.filter((m) => inMonth(m.sentAt) && m.channel !== 'email');
  const failed = msgs.filter((m) => m.status === 'failed' || m.bouncedAt);
  const stops = x.inbox.filter((i) => inMonth(i.at) && /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i.test(String(i.body || ''))).length;
  const cards = x.cards.map((c) => ({ ...c, history: (c.history || []).filter((h: any) => inMonth(h.at)) }));
  const owed = locationSettlement(cards).map((s) => ({ ...s, fromName: x.locationNames?.[s.from] || s.from, toName: x.locationNames?.[s.to] || s.to }));
  return {
    month: x.month, label: monthLabel(x.month),
    waitlist: { openings: ops.length, filled: filled.length, how, unfilled: ops.filter((o) => ['expired', 'closed'].includes(String(o.status))).length },
    rewards: { earned: sumP(['earn', 'bonus']), used: redeems.length, usedPoints: -sumP(['redeem']), usedValueCents: redeems.reduce((s, l) => s + (Number(l.cents) || 0), 0), costCents: redeems.reduce((s, l) => s + (Number(l.costCents ?? l.cents) || 0), 0), givenBack, expired: -sumP(['expire']) },
    opportunities: { found: oppMade.length, contacted: contacted.length, cameBack: paid.length, paidCents: paid.reduce((s, r) => s + (Number(r.paidCents) || 0), 0), stillBooked: res.filter((r) => r.state === 'booked').length },
    calls: { on: x.callsOn, used: x.callsUsed, allowed: x.callsAllowed },
    texts: { sent: msgs.length, failed: failed.length, stops },
    giftOwed: owed,
  };
}

export function reviewLines(r: MonthReview): string[] {
  const $ = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const out: string[] = []; const w = r.waitlist;
  if (w.openings) { const bits = [w.how.text && `${w.how.text} by text`, w.how.call && `${w.how.call} by a call`, w.how.party && `${w.how.party} by a party`, w.how.auto && `${w.how.auto} booked automatically`, w.how.moveUp && `${w.how.moveUp} by someone coming in sooner`].filter(Boolean);
    out.push(`Waitlist: ${w.filled} of ${w.openings} cancelled time${w.openings === 1 ? '' : 's'} filled again${bits.length ? ` (${bits.join(', ')})` : ''}.`); }
  const rw = r.rewards; if (rw.earned || rw.used) out.push(`Rewards: ${rw.earned.toLocaleString('en-US')} points earned, ${rw.used} reward${rw.used === 1 ? '' : 's'} used${rw.usedValueCents ? ` (${$(rw.usedValueCents)} off)` : ''}${rw.expired ? `, ${rw.expired.toLocaleString('en-US')} points expired` : ''}.`);
  const o = r.opportunities; if (o.found) out.push(`Opportunities: ${o.found} found, ${o.contacted} contacted, ${o.cameBack} came back and paid${o.paidCents ? ` (${$(o.paidCents)})` : ''}${o.stillBooked ? `, ${o.stillBooked} more booked` : ''}.`);
  if (r.calls.on || r.calls.used) out.push(`Calls about openings: ${r.calls.used} of about ${r.calls.allowed} in the monthly limit.`);
  if (r.texts.sent) out.push(`Texts: ${r.texts.sent.toLocaleString('en-US')} sent, ${r.texts.failed} didn’t go through${r.texts.stops ? `, ${r.texts.stops} opted out` : ''}.`);
  for (const g of r.giftOwed) out.push(`Gift cards: ${g.fromName} owes ${g.toName} ${$(g.cents)} for ${g.spends} gift card sale${g.spends === 1 ? '' : 's'} used there.`);
  return out;
}

export async function loadMonthReview(db: any, t: string, tenant: any, month: string) {
  const { tenantTimeZone, startOfDay } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const [y, m] = month.split('-').map(Number); const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  const startMs = startOfDay(`${month}-01`, tz).getTime(), endMs = startOfDay(`${next}-01`, tz).getTime(); const s = new Date(startMs).toISOString(), e = new Date(endMs).toISOString();
  const rows = (q: any) => q.get().then((x: any) => x.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))).catch(() => []); const T = `tenants/${t}`;
  const [openings, ledger, results, opportunities, messages, inbox, cards, locations] = await Promise.all([
    rows(db.collection(`${T}/openings`).where('createdAt', '>=', s).where('createdAt', '<', e)), rows(db.collection(`${T}/loyaltyLedger`).where('at', '>=', s).where('at', '<', e)),
    rows(db.collection(`${T}/results`).where('startTime', '>=', s).where('startTime', '<', e)), rows(db.collection(`${T}/opportunities`).where('createdAt', '>=', s).where('createdAt', '<', e)),
    rows(db.collection(`${T}/messageLog`).where('sentAt', '>=', s).where('sentAt', '<', e)), rows(db.collection(`${T}/smsInbox`).where('at', '>=', s).where('at', '<', e)),
    rows(db.collection(`${T}/giftCards`).where('status', 'in', ['active', 'used'])), rows(db.collection(`${T}/locations`))]);
  const { callSettingsOf, callsAllowed } = await import('@/lib/waitlist-calls'); const C = callSettingsOf(tenant);
  return monthReview({ month, openings, ledger, results, opportunities, callsUsed: Number(tenant?.waitlistCallsUsed?.[month]) || 0, callsAllowed: callsAllowed(C), callsOn: C.on, messages, inbox, cards, startMs, endMs,
    locationNames: Object.fromEntries(locations.map((l: any) => [l.id, l.name || l.id])) });
}

/** On the 1st–3rd (business time), once per month: last month's review to the owner and managers, and by email to the owner. */
export async function monthReviewNotice(db: any, t: string, tenant: any, now = Date.now(), o: { email?: (to: string, subject: string, lines: string[]) => Promise<boolean> } = {}) {
  const { tenantTimeZone, dayKey } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant); const today = dayKey(new Date(now), tz);
  const last = prevMonth(today.slice(0, 7)); if (Number(today.slice(8, 10)) > 3 || tenant?.monthReviewSentFor === last) return { sent: false };
  await db.doc(`tenants/${t}`).set({ monthReviewSentFor: last }, { merge: true });
  const r = await loadMonthReview(db, t, tenant, last); const lines = reviewLines(r); if (!lines.length) return { sent: false };
  const staff = (await db.collection(`tenants/${t}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((s: any) => ['owner', 'admin', 'manager'].includes(String(s.role)) && s.archived !== true);
  const b = db.batch(); const at = new Date(now).toISOString();
  for (const s of staff) { const ref = db.doc(`tenants/${t}/notifications/month_${last}_${s.id}`); b.set(ref, { id: ref.id, userId: s.id, type: 'month_review', title: `${r.label} in review`, message: lines[0], link: `/month?m=${last}`, createdAt: at, read: false }); }
  await b.commit();
  const to = String(tenant.ownerEmail || tenant.email || tenant.contactEmail || '').trim();
  if (to.includes('@')) {
    if (o.email) await o.email(to, `${r.label} in review`, lines);
    else { const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template'); const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, ''); const studio = String(tenant.name || 'Your business');
      await sendNotification(db, { tenantId: t, channel: 'email', to, subject: `${studio}: ${r.label} in review`, kind: 'month_review', recipientType: 'staff', text: lines.join('\n\n'),
        html: brandedEmailHtml({ studioName: studio, title: `${r.label} in review`, bodyLines: lines, cta: base ? { label: 'See the whole month', url: `${base}/month?m=${last}` } : null }) }).catch(() => null); }
  }
  return { sent: true, lines };
}
