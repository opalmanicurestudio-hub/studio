// src/lib/making-it-right.ts — MAKING IT RIGHT: the business's own rules for complaints, redos and refunds, started from
// a set that fits its kind of business, and the FAIR-USE checks run on every case. Pure (no database) — used by the
// settings screen, the case API and the tests.
//   tenant.makingItRight = { reasons, fixes, redoWindowDays, serviceWindows, deskLimitCents, deskRedos, providersCanOfferRedo,
//                            replyHours, followUpDays, channels, fairUse, retentionYears, payRules }
export type Reason = { id: string; label: string; safety?: boolean; on?: boolean };
export type FixKind = 'redo' | 'refund' | 'credit' | 'replace' | 'addon' | 'note';
export const FIX_LABEL: Record<FixKind, string> = { redo: 'Free redo', refund: 'Refund', credit: 'Credit', replace: 'Replace a product', addon: 'A free add-on next time', note: 'Record it only' };
export const FIX_HINT: Record<FixKind, string> = { redo: 'We fix it at no charge', refund: 'Back to the card they paid with', credit: 'Money off their next visit', replace: 'For retail', addon: 'Something extra next time', note: 'When no fix is needed' };

const r = (id: string, label: string, safety = false): Reason => ({ id, label, safety, on: true });
const COMMON = [r('manner', 'Something about how I was treated'), r('charge', 'The price or charge'), r('clean', 'Cleanliness'), r('time', 'It took too long')];
export const PRESETS: Record<string, { name: string; reasons: Reason[]; window: number; wearDays: number }> = {
  nails: { name: 'Nail salon', window: 7, wearDays: 10, reasons: [r('lifting', 'Lifting or chipping'), r('shape', 'Shape or length'), r('color', 'Color wasn’t what I asked for'), r('cut', 'Cut, pain or skin reaction', true), r('infection', 'Signs of infection', true), ...COMMON] },
  hair: { name: 'Hair salon', window: 14, wearDays: 21, reasons: [r('color', 'Color wasn’t what I asked for'), r('cut', 'Uneven or not the cut I asked for'), r('damage', 'Hair feels damaged'), r('burn', 'Burn, cut or scalp reaction', true), ...COMMON] },
  spa: { name: 'Spa or massage', window: 3, wearDays: 3, reasons: [r('pressure', 'Pressure wasn’t right'), r('pain', 'Pain or soreness after', true), r('room', 'The room or temperature'), r('reaction', 'Skin reaction to a product', true), ...COMMON] },
  medspa: { name: 'Med spa or clinic', window: 14, wearDays: 30, reasons: [r('results', 'Results weren’t as expected'), r('bruising', 'Bruising or swelling', true), r('reaction', 'Reaction or allergy', true), r('pain', 'Pain', true), r('infection', 'Signs of infection', true), ...COMMON] },
  tattoo: { name: 'Tattoo or piercing', window: 30, wearDays: 60, reasons: [r('healing', 'Healing problems', true), r('blowout', 'Blowout or fading'), r('design', 'Design isn’t what we agreed'), r('infection', 'Signs of infection', true), ...COMMON] },
  fitness: { name: 'Fitness studio', window: 7, wearDays: 7, reasons: [r('injury', 'Injury during class or session', true), r('coach', 'The trainer or coach'), r('equipment', 'Equipment'), ...COMMON] },
  hospitality: { name: 'Restaurant or bar', window: 1, wearDays: 1, reasons: [r('food', 'Food wasn’t right'), r('allergy', 'Allergic reaction', true), r('wait', 'Waited too long'), r('order', 'Wrong order'), r('service', 'Service'), ...COMMON] },
  shop: { name: 'Shop', window: 30, wearDays: 30, reasons: [r('damaged', 'Arrived damaged'), r('wrong', 'Wrong item'), r('quality', 'Quality problem'), r('injury', 'Caused an injury or reaction', true), ...COMMON] },
  general: { name: 'Any business', window: 7, wearDays: 14, reasons: [r('quality', 'Not what I expected'), r('injury', 'Injury or reaction', true), ...COMMON] },
};
export function presetKey(tenant: any): string {
  const k = String(tenant?.makingItRight?.preset || tenant?.businessType || tenant?.category || '').toLowerCase();
  if (PRESETS[k]) return k;
  if (/nail|mani|pedi/.test(k) || k === 'salon') return 'nails';
  if (/hair|barber/.test(k)) return 'hair';
  if (/med|clinic|aesthetic|inject/.test(k)) return 'medspa';
  if (/spa|massage|wellness/.test(k)) return 'spa';
  if (/tattoo|pierc/.test(k)) return 'tattoo';
  if (/fit|gym|yoga|pilates/.test(k)) return 'fitness';
  if (/hospitality|restaurant|bar|cafe/.test(k)) return 'hospitality';
  if (/shop|retail|store/.test(k)) return 'shop';
  return 'general';
}

export type MirSettings = {
  preset: string; reasons: Reason[]; fixes: Record<FixKind, boolean>; redoWindowDays: number; serviceWindows: Record<string, number>;
  deskLimitCents: number; deskRedos: number; providersCanOfferRedo: boolean; replyHours: number; followUpDays: number;
  channels: { survey: boolean; visitLink: boolean; calls: boolean; staff: boolean };
  fairUse: { maxFixes: number; perMonths: number; requirePhotos: boolean; sameServiceOnly: boolean; originalProviderFirst: boolean; refundToOriginalCard: boolean; wearDays: number; wearDaysByService: Record<string, number>; clientConfirms: boolean };
  retentionYears: number; payRules: { redoProvider: 'none' | 'half' | 'normal'; originalProvider: 'keep' | 'pays' | 'split'; refund: 'take_back' | 'keep' };
};
/** The business's settings, with anything not set yet filled from its starting set. */
export function settingsOf(tenant: any): MirSettings {
  const key = presetKey(tenant); const P = PRESETS[key]; const s: any = tenant?.makingItRight || {};
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    preset: key, reasons: Array.isArray(s.reasons) && s.reasons.length ? s.reasons : P.reasons,
    fixes: { redo: true, refund: true, credit: true, replace: key === 'shop', addon: false, note: true, ...(s.fixes || {}) },
    redoWindowDays: num(s.redoWindowDays, P.window), serviceWindows: s.serviceWindows || {},
    deskLimitCents: num(s.deskLimitCents, 2500), deskRedos: num(s.deskRedos, 1), providersCanOfferRedo: s.providersCanOfferRedo !== false,
    replyHours: num(s.replyHours, 24), followUpDays: num(s.followUpDays, 3),
    channels: { survey: true, visitLink: true, calls: true, staff: true, ...(s.channels || {}) },
    fairUse: { maxFixes: 2, perMonths: 6, requirePhotos: true, sameServiceOnly: true, originalProviderFirst: true, refundToOriginalCard: true, wearDays: P.wearDays, wearDaysByService: {}, clientConfirms: true, ...(s.fairUse || {}) },
    retentionYears: num(s.retentionYears, 7),
    payRules: { redoProvider: 'half', originalProvider: 'keep', refund: 'take_back', ...(s.payRules || {}) },
  };
}

export type Check = { ok: boolean; title: string; detail: string; key: string };
const DAY = 86400000;
/** The fair-use checks for a case. A failed check never refuses the client — it sends the case to a manager. */
export function fairUseChecks(input: { settings: MirSettings; visit: { startTime?: string; serviceId?: string; paid?: number } | null; reason: Reason | null; photos: number; priorFixes: { at: string }[]; wants?: string; now?: number; afterDiscount?: number }): Check[] {
  const { settings: S, visit, reason } = input; const now = input.now ?? Date.now(); const out: Check[] = [];
  if (reason?.safety) return [{ ok: false, key: 'safety', title: 'A safety reason', detail: 'A manager handles this — nothing is offered automatically.' }];
  if (visit?.startTime) {
    const days = Math.floor((now - Date.parse(visit.startTime)) / DAY); const win = (visit.serviceId && S.serviceWindows[visit.serviceId]) || S.redoWindowDays;
    out.push({ ok: days <= win, key: 'window', title: days <= win ? 'Within the redo window' : 'Past the redo window', detail: `Day ${Math.max(0, days)} of ${win}` });
    const wear = (visit.serviceId && S.fairUse.wearDaysByService[visit.serviceId]) || S.fairUse.wearDays;
    if (days > wear) out.push({ ok: false, key: 'wear', title: 'Could be normal wear', detail: `After day ${wear} this is usually wear, not a fault` });
    out.push({ ok: (visit.paid ?? 0) > 0, key: 'paid', title: (visit.paid ?? 0) > 0 ? 'A paid visit on their account' : 'No payment found for this visit', detail: (visit.paid ?? 0) > 0 ? `$${(visit.paid as number).toFixed(2)} paid` : 'Check the visit was checked out' });
  } else out.push({ ok: false, key: 'visit', title: 'No visit linked', detail: 'Link the visit this is about' });
  const since = now - S.fairUse.perMonths * 30 * DAY; const recent = input.priorFixes.filter((f) => Date.parse(f.at) >= since).length;
  out.push({ ok: recent < S.fairUse.maxFixes, key: 'limit', title: recent === 0 ? `First case in ${S.fairUse.perMonths} months` : `${recent + 1}${recent === 0 ? 'st' : recent === 1 ? 'nd' : recent === 2 ? 'rd' : 'th'} fix in ${S.fairUse.perMonths} months`, detail: `Your limit is ${S.fairUse.maxFixes}` });
  if (S.fairUse.requirePhotos) out.push({ ok: input.photos > 0, key: 'photos', title: input.photos > 0 ? 'Photos sent' : 'No photos yet', detail: input.photos > 0 ? `${input.photos} photo${input.photos === 1 ? '' : 's'}` : 'Photos are needed for a free redo' });
  if (input.wants === 'refund') out.push({ ok: false, key: 'refund', title: 'Asked for a refund', detail: 'Refunds over your limit need a manager' });
  if ((input.afterDiscount ?? 0) >= 2) out.push({ ok: false, key: 'discount', title: 'Complaints follow discounts', detail: `${input.afterDiscount} recent complaints were on discounted visits` });
  return out;
}

/** May this person give this fix without a manager? */
export function canDecide(S: MirSettings, who: { isManager: boolean; role: string; isProvider: boolean }, fix: { kind: FixKind; amountCents?: number }, checks: Check[]): { ok: boolean; why?: string } {
  if (who.isManager) return { ok: true };
  if (checks.some((c) => !c.ok)) return { ok: false, why: 'A fair-use check didn’t pass — a manager decides this one.' };
  if (!S.fixes[fix.kind]) return { ok: false, why: 'Your business doesn’t offer that fix.' };
  if (who.isProvider && who.role !== 'front_desk') return fix.kind === 'redo' && S.providersCanOfferRedo ? { ok: true } : fix.kind === 'note' ? { ok: true } : { ok: false, why: 'Providers can offer a redo or record it — anything else goes to the desk or a manager.' };
  if (fix.kind === 'refund' || fix.kind === 'credit') return (fix.amountCents || 0) <= S.deskLimitCents ? { ok: true } : { ok: false, why: `Over $${(S.deskLimitCents / 100).toFixed(0)} needs a manager.` };
  return { ok: true };
}
export const STAGES = ['Heard', 'Owned', 'Fix chosen', 'Done', 'Checked back'] as const;
export const stageIndex = (status: string) => ({ heard: 0, owned: 1, fix_chosen: 2, done: 3, checked_back: 4, closed: 5 } as any)[status] ?? 0;
