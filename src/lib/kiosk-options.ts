// src/lib/kiosk-options.ts — "WHAT BRINGS YOU IN?" (K1): the kiosk's first screen.
// Each option is a visit type in the business's own words. Defaults follow the modules the business uses (no order
// pickup without the shop, no renter visits without booth rental…). The owner reorders, renames, hides and adds their
// own (Settings → Experience → Front door); saved as tenants.kioskOptions. Shared by the kiosk and the settings editor.
import { moduleEnabled } from '@/lib/modules';

export type KioskIntent = 'appointment' | 'walkin' | 'pickup' | 'class' | 'renter' | 'tour' | 'help' | 'custom';
export interface KioskOption { id: string; intent: KioskIntent; label: string; hint?: string; hidden?: boolean }

const DEFAULTS: (KioskOption & { needs?: string[] })[] = [
  { id: 'appointment', intent: 'appointment', label: 'I have an appointment', hint: 'Check in for your booking' },
  { id: 'walkin', intent: 'walkin', label: 'Walk in', hint: 'No booking — see who’s free' },
  { id: 'pickup', intent: 'pickup', label: 'Pick up an order', hint: 'Collect something you ordered', needs: ['retail'] },
  { id: 'class', intent: 'class', label: 'Class or student clinic', hint: 'Check in for a class, workshop or clinic', needs: ['classes_events', 'academy'] },
  { id: 'renter', intent: 'renter', label: 'Here to see a renter', hint: 'We’ll let them know you’ve arrived', needs: ['booth_rental'] },
  { id: 'tour', intent: 'tour', label: 'A tour or information', hint: 'Someone will come and say hello' },
  { id: 'help', intent: 'help', label: 'I need help', hint: 'We’ll send someone over' },
];
export const INTENT_LABEL: Record<KioskIntent, string> = { appointment: 'Appointment', walkin: 'Walk-in', pickup: 'Order pickup', class: 'Class or clinic', renter: 'Renter visit', tour: 'Tour or information', help: 'Needs help', custom: 'Custom' };

/** Is this visit type usable at all for this business (its module on)? */
export function intentAvailable(tenant: any, o: { id: string; intent: KioskIntent }): boolean {
  const d = DEFAULTS.find((x) => x.id === o.id || (o.intent !== 'custom' && x.intent === o.intent));
  return !d?.needs || d.needs.some((m) => { try { return moduleEnabled(tenant, m as any); } catch { return false; } });
}

/** Every option for the editor (saved order first, new defaults appended), unavailable ones left out. */
export function kioskOptionsAll(tenant: any): KioskOption[] {
  const saved: KioskOption[] = Array.isArray(tenant?.kioskOptions) ? tenant.kioskOptions.filter((o: any) => o && o.id && o.intent) : [];
  const out: KioskOption[] = saved.map((o) => ({ id: String(o.id), intent: o.intent, label: String(o.label || '').slice(0, 60) || (DEFAULTS.find((d) => d.id === o.id)?.label ?? 'Something else'), hint: o.hint ? String(o.hint).slice(0, 90) : DEFAULTS.find((d) => d.id === o.id)?.hint, hidden: !!o.hidden }));
  for (const d of DEFAULTS) if (!out.some((o) => o.id === d.id)) out.push({ id: d.id, intent: d.intent, label: d.label, hint: d.hint });
  return out.filter((o) => intentAvailable(tenant, o));
}
/** What the kiosk shows. */
export const kioskOptionsShown = (tenant: any) => kioskOptionsAll(tenant).filter((o) => !o.hidden);
/** Clean what the editor saves. */
export function cleanKioskOptions(list: KioskOption[]): KioskOption[] {
  return (list || []).slice(0, 16).map((o) => ({ id: String(o.id).slice(0, 40), intent: (Object.keys(INTENT_LABEL) as KioskIntent[]).includes(o.intent) ? o.intent : 'custom', label: String(o.label || '').trim().slice(0, 60) || 'Something else', ...(o.hint ? { hint: String(o.hint).trim().slice(0, 90) } : {}), ...(o.hidden ? { hidden: true } : {}) }));
}
