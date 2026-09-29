// src/lib/client-screen.ts — THE CLIENT SCREEN (an iPad at the desk): the business's settings (pure).
export interface ClientScreenSettings {
  tipPresets: number[]; allowCustomTip: boolean; showNoTip: boolean; tipOn: 'before_tax' | 'after_tax';
  signCardOnFile: boolean; signOver: number; reviewTicket: boolean; welcome: string; offerReceipt: boolean;
  auto: boolean; autoTip: boolean; offerKeepChange: boolean; offerSaveCard: boolean; payOnScreen: boolean; payOnPhone: boolean; moments?: any;
}
export function clientScreenSettingsOf(t: any): ClientScreenSettings {
  const c = t?.clientScreen || {};
  const presets = (Array.isArray(c.tipPresets) ? c.tipPresets : [18, 20, 25]).map(Number).filter((n: number) => Number.isFinite(n) && n > 0 && n <= 100).slice(0, 4);
  return { tipPresets: presets.length ? presets : [18, 20, 25], allowCustomTip: c.allowCustomTip !== false, showNoTip: c.showNoTip !== false, tipOn: c.tipOn === 'after_tax' ? 'after_tax' : 'before_tax',
    signCardOnFile: c.signCardOnFile !== false, signOver: Math.max(0, Number(c.signOver) || 0), reviewTicket: c.reviewTicket !== false,
    welcome: String(c.welcome || '').slice(0, 120) || 'Welcome — we’ll be with you in a moment.', offerReceipt: c.offerReceipt !== false,
    auto: c.auto !== false, autoTip: c.autoTip !== false, offerKeepChange: c.offerKeepChange !== false, offerSaveCard: c.offerSaveCard !== false, payOnScreen: c.payOnScreen !== false, payOnPhone: c.payOnPhone !== false, ...(c.moments ? { moments: c.moments } : {}) };
}
/** Does this charge need a signature on the client screen? */
export const needsSignature = (s: ClientScreenSettings, amount: number) => s.signCardOnFile && (!s.signOver || amount >= s.signOver);
