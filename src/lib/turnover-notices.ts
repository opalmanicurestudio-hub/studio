// src/lib/turnover-notices.ts — PROGRESSIVE TURNOVER NOTICES (O3). A station that needs resetting gets quieter-to-louder
// nudges, each sent once per visit:
//   1 → its owner (the provider who just finished, or whoever said "I'll do it"): it's overdue, or the next client is close.
//   2 → the managers: still not ready and it's now well overdue, or the next client is about to walk in.
// Only stations whose turnover has steps to confirm are chased — the others become ready on their own when time is up.
import type { StationRow } from '@/lib/readiness';

export type TurnoverNotice = { resourceId: string; visitId: string; level: 1 | 2; ownerId: string | null; message: string };
export const TURNOVER_NOTICE = { ownerNextMin: 10, managerOverdueMin: 10, managerNextMin: 3 };
const clock = (iso: string, tz?: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }); } catch { return ''; } };

/** What to send now. `resources` carries what was already sent (resource.readiness.notice = { visitId, level }). */
export function turnoverNotices(rows: StationRow[], resources: any[], now = Date.now(), tz?: string): TurnoverNotice[] {
  const out: TurnoverNotice[] = [];
  for (const r of rows) {
    if (r.status !== 'turnover' || !r.needsConfirm || !r.visitId) continue;
    const sent = (resources.find((x: any) => x?.id === r.id)?.readiness?.notice) || {};
    const already = sent.visitId === r.visitId ? Number(sent.level) || 0 : 0;
    const nextIn = r.next ? Math.round((Date.parse(r.next.at) - now) / 60000) : Infinity;
    const overdue = r.overdueMin || 0;
    const nextBit = r.next && nextIn <= 30 ? ` — ${r.next.clientName ? r.next.clientName.split(' ')[0] : 'the next client'} is due at ${clock(r.next.at, tz)}` : '';
    const level: 0 | 1 | 2 = overdue >= TURNOVER_NOTICE.managerOverdueMin || nextIn <= TURNOVER_NOTICE.managerNextMin ? 2 : overdue >= 1 || nextIn <= TURNOVER_NOTICE.ownerNextMin ? 1 : 0;
    if (!level || level <= already) continue;
    out.push({ resourceId: r.id, visitId: r.visitId, level, ownerId: r.ownerId || null,
      message: level === 1 ? `${r.name} still needs resetting${nextBit}` : `${r.name} isn’t ready yet${r.ownerName ? ` (${r.ownerName}’s turnover)` : ''}${nextBit}` });
  }
  return out;
}
