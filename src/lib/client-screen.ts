// src/lib/client-screen.ts — THE CLIENT SCREEN (an iPad at the desk): the business's settings (pure).
export interface ClientScreenSettings {
  tipPresets: number[]; allowCustomTip: boolean; showNoTip: boolean; tipOn: 'before_tax' | 'after_tax';
  signCardOnFile: boolean; signOver: number; reviewTicket: boolean; welcome: string; offerReceipt: boolean;
  auto: boolean; autoTip: boolean; offerKeepChange: boolean; offerSaveCard: boolean; payOnScreen: boolean; payOnPhone: boolean; motion: 'lively' | 'calm' | 'off'; confetti: boolean; returnAfter: number; moments?: any;
}
export function clientScreenSettingsOf(t: any): ClientScreenSettings {
  const c = t?.clientScreen || {};
  const presets = (Array.isArray(c.tipPresets) ? c.tipPresets : [18, 20, 25]).map(Number).filter((n: number) => Number.isFinite(n) && n > 0 && n <= 100).slice(0, 4);
  return { tipPresets: presets.length ? presets : [18, 20, 25], allowCustomTip: c.allowCustomTip !== false, showNoTip: c.showNoTip !== false, tipOn: c.tipOn === 'after_tax' ? 'after_tax' : 'before_tax',
    signCardOnFile: c.signCardOnFile !== false, signOver: Math.max(0, Number(c.signOver) || 0), reviewTicket: c.reviewTicket !== false,
    welcome: String(c.welcome || '').slice(0, 120) || 'Welcome — we’ll be with you in a moment.', offerReceipt: c.offerReceipt !== false,
    auto: c.auto !== false, autoTip: c.autoTip !== false, offerKeepChange: c.offerKeepChange !== false, offerSaveCard: c.offerSaveCard !== false, payOnScreen: c.payOnScreen !== false, payOnPhone: c.payOnPhone !== false,
    motion: ['calm', 'off'].includes(c.motion) ? c.motion : 'lively', confetti: c.confetti !== false, returnAfter: Math.max(5, Math.min(120, Number(c.returnAfter) || 20)), ...(c.moments ? { moments: c.moments } : {}) };
}
/** Does this charge need a signature on the client screen? */
export const needsSignature = (s: ClientScreenSettings, amount: number) => s.signCardOnFile && (!s.signOver || amount >= s.signOver);

/** BOOK THE NEXT VISIT on the client screen — the business's settings. */
export interface RebookSettings { on: boolean; suggestCount: number; quickWeeks: number[]; otherProviders: boolean; cardMode: 'hold' | 'charge'; payNow: boolean; payLater: boolean; prebookPct: number; standing: boolean; standingCount: number; waitlist: boolean; visitLink: boolean }
export function rebookSettingsOf(t: any): RebookSettings {
  const r = t?.clientScreen?.rebook || {};
  const weeks = (Array.isArray(r.quickWeeks) ? r.quickWeeks : [2, 4, 6, 8]).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 52).slice(0, 6);
  return { on: r.on !== false, suggestCount: Math.max(1, Math.min(6, Number(r.suggestCount) || 3)), quickWeeks: weeks.length ? weeks : [2, 4, 6, 8], otherProviders: r.otherProviders !== false,
    cardMode: r.cardMode === 'charge' ? 'charge' : 'hold', payNow: r.payNow !== false, payLater: r.payLater !== false, prebookPct: Math.max(0, Math.min(50, Number(r.prebookPct) || 0)),
    standing: r.standing === true, standingCount: Math.max(2, Math.min(6, Number(r.standingCount) || 3)), waitlist: r.waitlist !== false, visitLink: r.visitLink !== false };
}
