// src/lib/swap-credit.ts — WHEN THE LEAD CHANGES PART-WAY THROUGH A VISIT, the credit is shared. The provider who started
// keeps a share of the service's commission for the time they worked (as the visit's assist, lib/commission splitShare),
// the one who finishes it gets the rest. The share starts at the time worked so far, rounded to 5%, and can be changed.
import { startedAt, expectedMinutes } from '@/lib/visit-clock';

/** The first provider's share, 0–95, from the time they worked out of the time the visit should take. */
export function swapShare(apt: any, service: any, allServices: any[] = [], now = Date.now()): number {
  const s = startedAt(apt); const exp = expectedMinutes(apt, service, allServices); if (!s || !exp) return 0;
  const pct = ((now - s) / 60000 / exp) * 100; if (pct <= 0) return 0;
  return Math.max(5, Math.min(95, Math.round(pct / 5) * 5));
}

/** What to write on the visit for a lead swap: the assist for whoever started, unless someone else already assists. */
export function swapAssist(apt: any, previousStaffId: string, nextStaffId: string, pct: number): { assist: { staffId: string; pct: number; fromSwap: true } | null; keepExisting: boolean } {
  const cur = apt?.assist;
  if (cur?.staffId && cur.staffId !== previousStaffId && cur.staffId !== nextStaffId) return { assist: null, keepExisting: true };
  if (!previousStaffId || previousStaffId === nextStaffId || !(pct > 0)) return { assist: null, keepExisting: false };
  return { assist: { staffId: previousStaffId, pct: Math.max(1, Math.min(99, Math.round(pct))), fromSwap: true }, keepExisting: false };
}
