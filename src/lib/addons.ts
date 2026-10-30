// src/lib/addons.ts — PAID EXTRAS INSIDE A TOOL (pure). An add-on belongs to one tool and is switched on by the owner
// where it's used (Digital protection from a download's Protection card), or in Your ClarityFlow. It lives on
// tenant.addons[id] ({ active, since, by } or { active: false, endedAt }), which only the server writes
// (api/billing, firestore.rules). It's billed (lib/billing-plans ADDON_PRICES) and it works only while it's active
// AND its tool is on, so the two never disagree: what isn't billed doesn't run. Turning one off never locks a buyer out;
// it only stops the extra checks.
import { ADDON_PRICES } from './billing-plans';
import { fromTenantModules, type ToolId } from './module-catalog';

export type AddonId = 'digitalProtection';

export interface Addon { id: AddonId; name: string; tool: ToolId; line: string; amount: number; bullets: string[] }

export const ADDONS: Record<AddonId, Addon> = {
  digitalProtection: {
    id: 'digitalProtection', name: 'Digital protection', tool: 'inventory', line: 'Device limits on downloads', amount: ADDON_PRICES.digitalProtection.amount,
    bullets: ['Limit how many devices each buyer can open a download on', 'See each buyer’s devices, and reset them', 'More protection added to it as it’s built, at no extra cost'],
  },
};

export const isAddonId = (v: unknown): v is AddonId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ADDONS, v);

/** The owner switched it on (whether or not its tool is on right now). */
export function addonActive(t: any, id: AddonId): boolean {
  const a = t?.addons?.[id];
  return a === true || a?.active === true;
}

/** It works right now: switched on, and its tool is on. What's billed is exactly this. */
export function addonLive(t: any, id: AddonId, tools?: ToolId[]): boolean {
  return addonActive(t, id) && (tools || fromTenantModules(t?.modules)).includes(ADDONS[id].tool);
}

/** The add-ons to bill for this set of tools. */
export function billedAddons(t: any, tools?: ToolId[]): AddonId[] {
  return (Object.keys(ADDONS) as AddonId[]).filter((id) => addonLive(t, id, tools));
}
