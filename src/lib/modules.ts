/**
 * ─── MODULE REGISTRY ─────────────────────────────────────────────────────────
 * The single answer to "which subscriber sees what."
 *
 * ClarityFlow grew page by page with nothing deciding ownership, which is how
 * the sidebar came to show every tenant everything. This registry is the
 * spine that fixes it: each module declares the PAGES it owns and the MESSAGE
 * KINDS it may send. The sidebar filters by it today; the Communications
 * Center will list only a tenant's own message kinds tomorrow; plan tiers,
 * when they exist, become flags on the tenant doc instead of surgery.
 *
 * Gating contract (deliberately conservative):
 *   tenant.modules = { [ModuleId]: boolean }
 *   - field absent, or a module unmentioned  →  ON. Every existing tenant
 *     keeps every page the day this ships; gating is opt-out per module.
 *   - only an explicit `false` hides a module.
 * A page not claimed by any module is CORE and always visible.
 */

export type ModuleId =
  | 'booth_rental'   // booths, pipeline, renters, rent
  | 'maintenance'
  | 'retail'
  | 'classes_events'
  | 'money';         // financial suite

export const MODULES: Record<ModuleId, {
  label: string;
  pages: string[];          // sidebar hrefs this module owns
  messageKinds: string[];   // outbound comms this module may send
}> = {
  booth_rental: {
    label: 'Booth rental',
    pages: ['/booths', '/pipeline', '/renters', '/rent'],
    messageKinds: ['booth_tour', 'tour_reminder', 'tour_followup', 'tour_confirmation',
      'booth_reservation', 'rent_late', 'rent_paid', 'balance_due', 'lease',
      'lease_renewal', 'license_expiry', 'credential', 'booth_no_show', 'booth_review'],
  },
  maintenance: {
    label: 'Maintenance',
    pages: ['/maintenance'],
    messageKinds: ['maintenance', 'maintenance_collision'],
  },
  retail: {
    label: 'Retail',
    pages: ['/retail', '/retail-orders', '/inventory/distribution', '/inventory/formulas'],
    messageKinds: [],
  },
  classes_events: {
    label: 'Classes & events',
    pages: ['/classes', '/events', '/quotes'],
    messageKinds: [],
  },
  money: {
    label: 'Financial suite',
    pages: ['/financials', '/ledger', '/payday', '/bills', '/ai-cfo', '/money'],
    messageKinds: [],
  },
};

const PAGE_TO_MODULE: Record<string, ModuleId> = Object.fromEntries(
  (Object.entries(MODULES) as [ModuleId, (typeof MODULES)[ModuleId]][])
    .flatMap(([id, m]) => m.pages.map((p) => [p, id]))
);

export function moduleEnabled(tenant: any, id: ModuleId): boolean {
  return tenant?.modules?.[id] !== false;
}

/** Core pages (unclaimed by any module) are always visible. */
export function pageVisible(tenant: any, href: string): boolean {
  const owner = PAGE_TO_MODULE[href];
  return owner ? moduleEnabled(tenant, owner) : true;
}
