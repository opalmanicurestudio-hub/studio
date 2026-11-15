// src/lib/kitchen-pace-server.ts — how far behind the kitchen is right now (lib/kitchen-pace), read from its tickets:
// what's being made, and what came out in the last twenty minutes. Read at most every twenty seconds a business, however
// many screens and guests ask (one read at a time: everyone asking while it's being read waits for the same answer).
import { CALM, kitchenPace, paceSettingsOf, RECENT_MIN, type Pace } from '@/lib/kitchen-pace';
import { finishTogetherOn } from '@/lib/table-service';

const PACE_MS = 20000;
const cache = new Map<string, { at: number; v: Pace }>();
const reading = new Map<string, Promise<Pace>>();
export const forgetPace = (T: string) => { cache.delete(T); reading.delete(T); };

export async function paceNow(db: any, T: string, tenant: any): Promise<Pace> {
  const s = paceSettingsOf(tenant); if (!s.on) return CALM;
  const hit = cache.get(T); if (hit && Date.now() - hit.at < PACE_MS) return hit.v;
  const busy = reading.get(T); if (busy) return busy;
  const at = Date.now();
  const read = async (): Promise<Pace> => {
    const since = new Date(at - RECENT_MIN * 60000).toISOString();
    try {
      const [making, done] = await Promise.all([
        db.collection(`${T}/kdsTickets`).where('status', 'in', ['pending', 'in_progress']).limit(800).get(),
        db.collection(`${T}/kdsTickets`).where('readyAt', '>=', since).limit(800).get(),
      ]);
      const seen = new Set<string>(); const list: any[] = [];
      for (const d of [...making.docs, ...done.docs]) { if (seen.has(d.id)) continue; seen.add(d.id); list.push(d.data() || {}); }
      return kitchenPace(list, at, s, { together: finishTogetherOn(tenant) });
    } catch (e) { console.warn('[pace]', (e as any)?.message || e); return CALM; }
  };
  // A read that failed is calm (never a wrong delay), and isn't tried again for every caller in the meantime. One that
  // was forgotten while it was being read (the setting changed) isn't kept.
  const p: Promise<Pace> = read().then((v) => {
    if (reading.get(T) === p) { reading.delete(T); cache.set(T, { at, v }); if (cache.size > 2000) cache.delete(cache.keys().next().value as string); }
    return v;
  });
  reading.set(T, p);
  return p;
}
