// src/lib/ai-credits.ts
//
// AI CREDITS — AI costs real money per request, so each business gets a
// monthly allowance that follows its plan; nothing runs up a silent bill.
//   Without the Academy add-on: 50 / month
//   Academy on Core Solo: 300 / month · Academy on Studio: 800 / month
//   HQ can override (tenant.ai.monthlyCredits) or add bonus credits for a
//   month (tenant.ai.bonus["YYYY-MM"]).
// What things cost (credits): interactive (built on Claude Opus) 8 ·
// build a course 10 · generate questions 3 ·
// lesson plan / worksheet / assignment / quiz & flashcard draft 2 ·
// grading feedback 1. Students' AI tutor has its own per-student limits and
// never uses the school's credits. Failed AI attempts are refunded.

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export const AI_WEIGHTS: Record<string, number> = {
  'ai-interactive': 8, 'ai-game': 2, 'ai-file-lesson': 4, 'ai-cases': 2, 'ai-video-questions': 2, 'ai-hotspots': 1,
  'ai-course': 10, 'qbank-ai': 3, 'ai-plan': 2, 'worksheet-ai': 2, 'ai-assignment': 2, 'ai-draft': 2, 'submission-ai': 1,
};
export const PLAN_CREDITS = { none: 50, solo: 300, studio: 800 };
const month = () => new Date().toISOString().slice(0, 7);

export function allowanceFor(t: any) {
  const m = month();
  const base = Number(t?.ai?.monthlyCredits) > 0 ? Number(t.ai.monthlyCredits)
    : t?.modules?.academy === true || t?.academy?.mode ? (t?.teamSize === 'team' ? PLAN_CREDITS.studio : PLAN_CREDITS.solo) : PLAN_CREDITS.none;
  return base + (Number(t?.ai?.bonus?.[m]) || 0);
}

export async function creditStatus(tenantId: string) {
  const db = getAdminDb(); const m = month();
  const [t, u] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/aiUsage/${m}`).get()]);
  const allowance = allowanceFor(t.data());
  const used = Number((u.data() as any)?.credits) || 0;
  const now = new Date(); const reset = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  return { month: m, allowance, used, left: Math.max(0, allowance - used), byPurpose: (u.data() as any)?.byPurpose || {}, resetsAt: reset };
}

/** Take credits before an AI action (atomic). */
export async function takeCredits(tenantId: string, action: string, weight: number): Promise<{ ok: boolean; error?: string; left?: number }> {
  const db = getAdminDb(); const m = month();
  const tRef = db.doc(`tenants/${tenantId}`), uRef = db.doc(`tenants/${tenantId}/aiUsage/${m}`);
  return db.runTransaction(async (tx: any) => {
    const [t, u] = await Promise.all([tx.get(tRef), tx.get(uRef)]);
    const allowance = allowanceFor(t.data()); const used = Number((u.data() as any)?.credits) || 0;
    if (used + weight > allowance) return { ok: false, error: `You’ve used this month’s AI credits (${used} of ${allowance}). They reset on the 1st — or ask us about more.` };
    tx.set(uRef, { month: m, credits: FieldValue.increment(weight), byPurpose: { [action]: FieldValue.increment(weight) }, updatedAt: new Date().toISOString() }, { merge: true });
    return { ok: true, left: allowance - used - weight };
  });
}

/** Give credits back when the AI attempt didn't produce anything usable. */
export async function refundCredits(tenantId: string, action: string, weight: number) {
  const m = month();
  await getAdminDb().doc(`tenants/${tenantId}/aiUsage/${m}`).set({ credits: FieldValue.increment(-weight), byPurpose: { [action]: FieldValue.increment(-weight) } }, { merge: true });
}
