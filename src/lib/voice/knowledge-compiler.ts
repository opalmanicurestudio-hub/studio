/**
 * knowledge-compiler — v1: the uniform knowledge base.
 *
 * Replaces the freeform-textarea model with three layers, compiled fresh
 * on every call:
 *
 *   1. AUTO-DERIVED (zero typing, never stale) — assembled from data the
 *      platform already owns:
 *        · Hours       ← the active scheduleProfile, grouped into natural
 *                        speech ("Tuesday to Saturday, 9 AM to 7 PM")
 *        · Services    ← live menu + prices (existing behavior)
 *        · Team        ← active staff roster
 *        · Policies    ← the tenant's REAL policy config: the text fields
 *                        (cancellationPolicy / noShowPolicy /
 *                        lateArrivalPolicy) when written, else sentences
 *                        GENERATED from the numeric levers
 *                        (cancellationFee, cancellationWindowHours,
 *                        lateArrivalGracePeriod/Fee, rescheduleFee, ...)
 *   2. FAQ COLLECTION — tenants/{tid}/voiceFaq docs
 *        { question, answer, enabled, needsAnswer?, createdAt }
 *      Uniform Q&A cards managed in VoiceKnowledgeManager; only
 *      enabled entries with answers compile in.
 *   3. FREEFORM NOTES — the legacy voiceAgent.knowledgeBase field, kept
 *      last as "anything else" (migration-friendly; existing tenants lose
 *      nothing).
 *
 * The pure helpers (summarizeWeekHours, generatedPolicyLines) are exported
 * without server-only code so the client-side manager can render the same
 * derivations the agent will speak — what you see is what it says.
 */

import type { Firestore } from 'firebase-admin/firestore';

// ── Pure helpers (safe for client import) ────────────────────────────────────

const DAY_ORDER = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABEL: Record<string,string> = {
  monday:'Monday', tuesday:'Tuesday', wednesday:'Wednesday', thursday:'Thursday',
  friday:'Friday', saturday:'Saturday', sunday:'Sunday',
};

const cleanTime = (t: any): string => {
  if (!t || typeof t !== 'string') return '';
  return t.trim().replace(/^0(\d:)/, '$1');
};

/** Groups consecutive same-hours days into natural speech lines. */
export function summarizeWeekHours(week: any): string[] {
  if (!week || typeof week !== 'object') return [];
  const days = DAY_ORDER.map((d) => {
    const h = week[d];
    const open = !!h?.enabled;
    return {
      day: d,
      key: open ? `${cleanTime(h.start)}|${cleanTime(h.end)}` : 'closed',
      start: cleanTime(h?.start),
      end: cleanTime(h?.end),
      open,
    };
  });
  const lines: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1].key === days[i].key) j++;
    const span =
      i === j
        ? DAY_LABEL[days[i].day]
        : `${DAY_LABEL[days[i].day]} to ${DAY_LABEL[days[j].day]}`;
    lines.push(
      days[i].open
        ? `${span}: ${days[i].start} to ${days[i].end}`
        : `${span}: closed`,
    );
    i = j + 1;
  }
  return lines;
}

/** Policy sentences: the tenant's written text wins; numbers fill gaps. */
export function derivePolicyLines(tenant: any): string[] {
  const lines: string[] = [];
  const money = (n: any) => `$${Number(n)}`;

  if ((tenant?.cancellationPolicy || '').trim()) {
    lines.push(`Cancellations: ${tenant.cancellationPolicy.trim()}`);
  } else if (tenant?.cancellationFee || tenant?.cancellationWindowHours) {
    const windowH = Number(tenant.cancellationWindowHours) || 24;
    lines.push(
      `Cancellations: cancelling within ${windowH} hours of the appointment may incur ${
        tenant.cancellationFee ? `a ${money(tenant.cancellationFee)} fee` : 'a fee'
      }.`,
    );
  }

  if ((tenant?.lateArrivalPolicy || '').trim()) {
    lines.push(`Late arrivals: ${tenant.lateArrivalPolicy.trim()}`);
  } else if (tenant?.lateArrivalGracePeriod || tenant?.lateArrivalFee) {
    const grace = Number(tenant.lateArrivalGracePeriod) || 0;
    lines.push(
      `Late arrivals: ${grace > 0 ? `there's a ${grace}-minute grace period` : 'please call ahead if running late'}${
        tenant.lateArrivalFee ? `; after that a ${money(tenant.lateArrivalFee)} late fee may apply` : ''
      }.`,
    );
  }

  if ((tenant?.noShowPolicy || '').trim()) {
    lines.push(`No-shows: ${tenant.noShowPolicy.trim()}`);
  } else if (tenant?.noShowFee) {
    lines.push(`No-shows: a ${money(tenant.noShowFee)} no-show fee may apply.`);
  }

  if (tenant?.rescheduleFee && tenant?.rescheduleFeeWindowHours) {
    lines.push(
      `Reschedules: moving an appointment within ${Number(tenant.rescheduleFeeWindowHours)} hours may incur a ${money(tenant.rescheduleFee)} fee.`,
    );
  }

  if (tenant?.depositsLive === true) {
    lines.push('Deposits: some services require a deposit to hold the booking, collected through a secure link.');
  }

  return lines;
}

// ── Server-side compile (Admin SDK) ──────────────────────────────────────────

export async function compileKnowledgeBase(
  db: Firestore,
  tenantId: string,
  tenant: any,
): Promise<string> {
  const va = tenant?.voiceAgent || {};

  const [servicesSnap, staffSnap, profilesSnap, faqSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/services`).get(),
    db.collection(`tenants/${tenantId}/staff`).get(),
    db.collection(`tenants/${tenantId}/scheduleProfiles`).get().catch(() => null),
    db.collection(`tenants/${tenantId}/voiceFaq`).get().catch(() => null),
  ]);

  const services = servicesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const staff = staffSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const profiles = profilesSnap
    ? profilesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    : [];
  const faqs = faqSnap ? faqSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) : [];

  const sections: string[] = [];

  // HOURS — auto from the active schedule profile
  const activeProfile = profiles.find((p: any) => p.isActive);
  if (activeProfile?.week) {
    const lines = summarizeWeekHours(activeProfile.week);
    if (lines.length > 0) sections.push(`HOURS:\n${lines.join('\n')}`);
  }

  // LOCATION — whatever the tenant doc carries (tolerant)
  const addr =
    typeof tenant?.address === 'string'
      ? tenant.address
      : tenant?.address?.formatted ||
        [tenant?.address?.street, tenant?.address?.city, tenant?.address?.state]
          .filter(Boolean)
          .join(', ');
  if (addr) sections.push(`LOCATION: ${addr}`);

  // SERVICES & PRICES — existing behavior, opt-out preserved
  if (va.includeServicePrices !== false) {
    const lines = services
      .filter((s: any) => s.type === 'service' && s.name && s.isActive !== false)
      .map((s: any) => {
        const price = Number(s.price) || 0;
        const duration = Number(s.duration) || 0;
        return `- ${s.name}: ${price > 0 ? `$${price}` : 'price varies'}${
          duration > 0 ? `, about ${duration} minutes` : ''
        }`;
      });
    if (lines.length > 0) {
      sections.push(
        `SERVICES AND STANDARD STARTING PRICES (specific providers may vary slightly):\n${lines.join('\n')}`,
      );
    }
  }

  // TEAM — active roster
  const roster = staff
    .filter((s: any) => s.active !== false && s.name)
    .map((s: any) => s.name.split(' ')[0]);
  if (roster.length > 0) sections.push(`TEAM: ${roster.join(', ')}`);

  // POLICIES — written text wins, numbers fill gaps
  const policyLines = derivePolicyLines(tenant);
  if (policyLines.length > 0) sections.push(`POLICIES:\n${policyLines.join('\n')}`);

  // FAQ — enabled, answered entries only
  const faqLines = faqs
    .filter((f: any) => f.enabled !== false && (f.answer || '').trim() && (f.question || '').trim())
    .map((f: any) => `Q: ${f.question.trim()}\nA: ${f.answer.trim()}`);
  if (faqLines.length > 0) sections.push(`FREQUENTLY ASKED:\n${faqLines.join('\n')}`);

  // FREEFORM NOTES — legacy field, kept last
  const manual = (va.knowledgeBase || '').trim();
  if (manual) sections.push(`OTHER NOTES:\n${manual}`);

  return sections.join('\n\n') || 'No additional business details provided.';
}
