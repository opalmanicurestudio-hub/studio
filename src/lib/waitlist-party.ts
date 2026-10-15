// src/lib/waitlist-party.ts — PARTIES ON THE WAITLIST (a bridal party, friends, a mother and daughter). When enough times
// open together — one per person, with different providers, all starting within 30 minutes of each other on the same
// day — they're offered to a party that fits BEFORE anyone on their own. The organizer gets one text, one link, and
// confirms for everyone; the whole party's deposit is theirs to pay up front. If no party takes them, the times go to
// individuals as usual. Pure rules here; the server half is in lib/waitlist-server.
const H = 3600e3, MIN = 60000;
export const PARTY_MAX = 6, PARTY_SPREAD_MIN = 30;
export const partyOf = (e: any) => { const n = Math.round(Number(e?.party) || 1); return n >= 2 && n <= PARTY_MAX ? n : 1; };
export const partyHoldMin = (startMs: number, now: number) => (startMs - now >= 24 * H ? 30 : 15);
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : Number(v) || 0);

/** The best set of `size` openings for one party: same day, different providers, starts within the spread. Earliest first, then tightest. */
export function partySet<O extends { id: string; staffId: string; start: string; date?: string }>(ops: O[], size: number, ok: (o: O) => boolean = () => true): O[] | null {
  const pool = ops.filter(ok).sort((a, b) => ms(a.start) - ms(b.start)); let best: O[] | null = null, bestKey = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const lead = pool[i]; const day = lead.date || lead.start.slice(0, 10); const pick: O[] = [lead]; const staff = new Set([lead.staffId]);
    for (let j = i + 1; j < pool.length && pick.length < size; j++) { const o = pool[j]; if ((o.date || o.start.slice(0, 10)) !== day || ms(o.start) - ms(lead.start) > PARTY_SPREAD_MIN * MIN || staff.has(o.staffId)) continue; pick.push(o); staff.add(o.staffId); }
    if (pick.length < size) continue;
    const key = ms(lead.start) + (ms(pick[pick.length - 1].start) - ms(lead.start)) / 1000;   // earliest, then tightest
    if (key < bestKey) { best = pick; bestKey = key; }
  }
  return best;
}

export function partyOfferText(o: { first: string; size: number; service: string; when: string; spread: boolean; link: string; holdMin: number }) {
  return `Hi ${o.first}, good news: we have times for all ${o.size} of you for ${o.service}: ${o.when}${o.spread ? ' (start times a few minutes apart)' : ''}. They're held for your party for the next ${o.holdMin} minutes. You can confirm for everyone here: ${o.link}`;
}
