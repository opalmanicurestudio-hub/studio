// src/lib/visit-moments.ts — BEFORE THEY LEAVE (design canvas OE5). While the client is still here, one quiet line each
// for what's worth a word in person — instead of a text later. Pure: the server (opportunities-server visitMoments)
// loads the records. Only what's true for this client:
//   next     — nothing booked after today: their usual gap, and a real open time that fits it
//   balance  — money left on a gift card, or visits left in a package
//   product  — something they buy again and again, and it's about the time they usually run out
//   nudge    — a membership or package that really would cost them less (lib/checkout-nudges: same rules, same
//              "not now" quiet days, and only when the business has those suggestions on)
// Booking the next visit and balances are part of a good checkout, so they always show; selling ones follow the setting.
export type MomentKind = 'next' | 'balance' | 'product' | 'nudge';
export interface Moment { key: string; kind: MomentKind; line: string; sub?: string }
const DAY = 864e5;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : Number(v) || 0);
const dollars = (cents: number) => { const d = (Number(cents) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function visitMomentsFor(o: {
  visit: any; appointments: any[]; receipts: any[]; giftCards: any[]; client: any; nextSlot?: { label: string; dayLabel: string; staffName?: string } | null;
  nudges?: { key: string; title: string; line: string }[]; now: number;
}): Moment[] {
  const { now } = o; const out: Moment[] = []; const cid = String(o.visit?.clientId || ''); if (!cid) return out;
  const DONE = ['completed', 'checked_out', 'paid']; const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired'];
  const mine = o.appointments.filter((a) => String(a.clientId || '') === cid);
  const upcoming = mine.some((a) => a.id !== o.visit.id && ms(a.startTime) > now + 2 * 3600e3 && !DEAD.includes(String(a.status || '')));
  if (!upcoming) {
    const past = mine.filter((a) => DONE.includes(String(a.status || '')) || a.id === o.visit.id).map((a) => ms(a.startTime)).filter(Boolean).sort((a, b) => a - b);
    const gaps = past.slice(1).map((t, i) => (t - past[i]) / DAY).filter((g) => g >= 5 && g <= 120); const g = median(gaps);
    const weeks = g ? Math.max(1, Math.round(g / 7)) : null;
    const slot = o.nextSlot ? `${String(o.nextSlot.dayLabel || '').replace(/,/g, '')} at ${o.nextSlot.label}${o.nextSlot.staffName ? ` with ${o.nextSlot.staffName}` : ''} is open` : null;
    out.push({ key: 'next', kind: 'next', line: `Next visit: ${weeks ? `usually every ${weeks} week${weeks === 1 ? '' : 's'}` : 'nothing booked yet'}${slot ? ` · ${slot}` : ''}`, sub: 'Ask before they leave. The client screen offers two times at checkout.' });
  }
  const cards = o.giftCards.filter((c) => c.status === 'active' && Number(c.balanceCents) > 0 && !c.promo && (String(c.recipientClientId || c.recipient?.id || c.clientId || '') === cid));
  const bal = cards.reduce((s, c) => s + (Number(c.balanceCents) || 0), 0);
  if (bal > 0) out.push({ key: 'gift', kind: 'balance', line: `${dollars(bal)} left on ${cards.length === 1 ? 'a gift card' : `${cards.length} gift cards`}`, sub: 'It can go toward today.' });
  const pk = (Array.isArray(o.client?.activePackages) ? o.client.activePackages : []).filter((p: any) => Number(p.sessionsRemaining) > 0);
  for (const p of pk.slice(0, 2)) out.push({ key: `pkg_${p.packageId || p.name}`, kind: 'balance', line: `${p.sessionsRemaining} visit${Number(p.sessionsRemaining) === 1 ? '' : 's'} left on ${p.name || 'their package'}` });
  // Products they buy again and again: the median gap between their own purchases says when they usually run out.
  const buys = new Map<string, { name: string; at: number[] }>();
  for (const r of o.receipts) { if (String(r.clientId || '') !== cid) continue; const at = ms(r.date || r.createdAt); if (!at) continue;
    for (const p of (r.reversal?.products || r.products || [])) { if (!p?.id) continue; const e = buys.get(String(p.id)) || { name: String(p.name || 'a product'), at: [] }; e.at.push(at); buys.set(String(p.id), e); } }
  const due: { name: string; weeks: number; since: number }[] = [];
  for (const [, e] of buys) { const t = [...new Set(e.at)].sort((a, b) => a - b); if (t.length < 2) continue;
    const g = median(t.slice(1).map((x, i) => (x - t[i]) / DAY).filter((d) => d >= 7)); if (!g) continue;
    const since = (now - t[t.length - 1]) / DAY; if (since >= g * 0.85 && since <= g * 2.5) due.push({ name: e.name, weeks: Math.round(g / 7), since: Math.round(since / 7) }); }
  for (const d of due.slice(0, 2)) out.push({ key: `product_${d.name}`, kind: 'product', line: `${d.name}: bought ${d.since} week${d.since === 1 ? '' : 's'} ago, usually lasts about ${d.weeks}`, sub: 'They may be running low.' });
  for (const n of (o.nudges || []).slice(0, 1)) out.push({ key: n.key, kind: 'nudge', line: n.title, sub: n.line });
  return out;
}
