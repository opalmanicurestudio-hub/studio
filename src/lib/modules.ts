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
  | 'money'          // financial suite
  // Added with ClarityFlow à la carte (src/lib/module-catalog.ts). Same
  // contract: absent = ON, so every existing business keeps every page.
  | 'guest_experience'
  | 'kiosk'
  | 'marketing'
  | 'memberships'
  | 'team'
  | 'voice'
  | 'hospitality'    // host stand, floor service, guest lounge, kitchen display
  | 'academy';       // online courses (/academy builder; students use /learn)

export const MODULES: Record<ModuleId, {
  label: string;
  pages: string[];          // sidebar hrefs this module owns
  messageKinds: string[];   // outbound comms this module may send
}> = {
  booth_rental: {
    label: 'Booth rental',
    pages: ['/booths', '/pipeline', '/renters', '/rent', '/kiosk'],   // /kiosk = the renters' check-in kiosk
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
    pages: ['/retail', '/retail-orders', '/inventory/distribution', '/inventory/formulas', '/shop',
      '/retail-orders/bench', '/retail-orders/claims', '/retail-orders/customers', '/retail-orders/designer',
      '/retail-orders/history', '/retail-orders/kpis', '/retail-orders/returns', '/retail-orders/reviews',
      '/retail-orders/settings', '/retail-orders/support', '/retail-orders/waves', '/retail-orders/wholesale'],
    messageKinds: [],
  },
  classes_events: {
    label: 'Classes & events',
    pages: ['/classes', '/events', '/quotes', '/quotes/new'],
    messageKinds: [],
  },
  money: {
    label: 'Financial suite',
    pages: ['/financials', '/ledger', '/payday', '/bills', '/ai-cfo', '/money'],
    messageKinds: [],
  },
  // Guest experience (live updates, self check-in, forms) is part of every
  // booking now — no pages of its own to hide. Kept so saved choices still read.
  guest_experience: { label: 'Guest experience', pages: [], messageKinds: [] },
  kiosk: { label: 'Front desk & walk-ins', pages: ['/walk-in', '/lobby'], messageKinds: [] },
  marketing: { label: 'Marketing & reputation', pages: ['/campaigns', '/discounts', '/reviews'], messageKinds: [] },
  memberships: { label: 'Memberships & packages', pages: ['/memberships', '/memberships/ledger'], messageKinds: [] },
  team: { label: 'Team & onboarding', pages: ['/applicants', '/timesheets', '/documents', '/schedule', '/schedule/requests', '/timeclock', '/staff-portal'], messageKinds: [] },
  voice: { label: 'AI receptionist', pages: ['/voice'], messageKinds: [] },
  hospitality: { label: 'Lounge & hospitality', pages: ['/host', '/floor', '/concierge', '/kds', '/settings/hosting'], messageKinds: [] },
  academy: { label: 'Online academy', pages: ['/academy'], messageKinds: [] },
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

/** Which tool a link belongs to — by its page, or any parent page it sits under (/retail-orders/policies → retail). */
export function hrefModule(href: string): ModuleId | null {
  const path = String(href || '').split(/[?#]/)[0];
  let best: { id: ModuleId; len: number } | null = null;
  for (const [id, m] of Object.entries(MODULES) as [ModuleId, any][]) for (const pg of m.pages || []) {
    if ((path === pg || path.startsWith(pg + '/')) && (!best || pg.length > best.len)) best = { id, len: pg.length };
  }
  return best?.id || null;
}
/** Settings tabs that belong to a tool (the rest are part of every plan). */
export const SETTINGS_TAB_MODULE: Record<string, ModuleId> = { kiosk: 'kiosk', timeclock: 'team' };
/** Should this setting show for this business? Only if it's part of their plan — by an explicit tool, a settings tab,
 *  or the page the link opens. Every settings screen, search, "Finish setting up" and Quick settings use this. */
export function settingVisible(tenant: any, href: string, module?: string | null): boolean {
  if (module && !moduleEnabled(tenant, module as ModuleId)) return false;
  const tab = String(href || '').match(/[?&]tab=([a-z]+)/)?.[1];
  if (tab && SETTINGS_TAB_MODULE[tab] && !moduleEnabled(tenant, SETTINGS_TAB_MODULE[tab])) return false;
  const m = hrefModule(href); return !m || moduleEnabled(tenant, m);
}
