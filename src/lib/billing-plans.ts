// src/lib/billing-plans.ts
//
// WHAT CLARITYFLOW CHARGES — the price list, in one place.
//
// Core (booking & payments + guest experience) is Solo or Team; every other
// tool is an add-on, matching "Your ClarityFlow". Each price has a stable
// lookup key in Stripe (cf_*_v2). To CHANGE a price, bump its version (v3):
// Stripe prices can't be edited, so new subscribers get the new price and
// existing ones keep theirs until you move them.
//
// Amounts are whole US dollars per month.

import type { ToolId } from '@/lib/module-catalog';

export interface PriceDef { key: string; name: string; amount: number; description: string }

export const CORE = {
  solo: { key: 'cf_core_solo_v2', name: 'ClarityFlow Core — Solo', amount: 39, description: 'Booking & payments + guest experience, for one person' },
  team: { key: 'cf_core_team_v2', name: 'ClarityFlow Core — Studio', amount: 129, description: 'Booking & payments + guest experience, up to 5 team members' },
} as const;
export const TEAM_INCLUDED = 5;
export const EXTRA_STAFF: PriceDef = { key: 'cf_extra_staff_v2', name: 'Additional team member', amount: 15, description: 'Each team member beyond 5' };
export const RENTERS_INCLUDED = 10;
export const EXTRA_RENTER: PriceDef = { key: 'cf_extra_renter_v2', name: 'Additional renter', amount: 8, description: 'Each renter beyond 10' };

// Texts: an allowance each month, then a small charge per text (Twilio costs
// ClarityFlow ~1.2¢). Billed on the next invoice for the month before.
export const TEXTS = { soloIncluded: 300, teamIncluded: 1000, overageCents: 3 };

export const TOOL_PRICES: Partial<Record<ToolId, PriceDef>> = {
  marketing: { key: 'cf_tool_marketing_v2', name: 'Marketing & reputation', amount: 29, description: 'Campaigns, automations, offers, reviews' },
  books: { key: 'cf_tool_books_v2', name: 'Automated bookkeeping', amount: 49, description: 'Ledger, bank feeds, bills, profit per service' },
  team: { key: 'cf_tool_team_v2', name: 'Team & onboarding', amount: 29, description: 'Hiring, onboarding, shifts, time clock, payroll' },
  renters: { key: 'cf_tool_renters_v2', name: 'Booth & suite rental', amount: 99, description: 'Leases, rent autopay, renter portals — includes 10 renters' },
  inventory: { key: 'cf_tool_inventory_v2', name: 'Inventory & retail', amount: 49, description: 'Stock, online shop, fulfilment' },
  memberships: { key: 'cf_tool_memberships_v2', name: 'Memberships & packages', amount: 29, description: 'Recurring memberships, packages, credits' },
  classes: { key: 'cf_tool_classes_v2', name: 'Classes & events', amount: 29, description: 'Classes, workshops, events, quotes' },
  kiosk: { key: 'cf_tool_kiosk_v2', name: 'Front desk & walk-ins', amount: 19, description: 'Walk-in kiosk, waitlist, lobby board' },
  voice: { key: 'cf_tool_voice_v2', name: 'AI receptionist', amount: 99, description: 'Answers, books and reschedules by phone' },
  lounge: { key: 'cf_tool_lounge_v2', name: 'Lounge & hospitality', amount: 39, description: 'Guest lounge menu, host stand, kitchen display' },
  academy: { key: 'cf_tool_academy_v2', name: 'Online academy', amount: 49, description: 'Courses, video lessons, student portal' },
};

export const ALL_PRICES: PriceDef[] = [CORE.solo, CORE.team, EXTRA_STAFF, EXTRA_RENTER, ...Object.values(TOOL_PRICES) as PriceDef[]];

export interface QuoteLine { key: string; name: string; unit: number; qty: number; total: number }

/** What a business would pay each month for these tools and this size. */
export function quote(input: { tools: ToolId[]; staff: number; renters: number; team: boolean }): { lines: QuoteLine[]; total: number; textsIncluded: number } {
  const lines: QuoteLine[] = [];
  const team = input.team || input.staff > 1;
  const core = team ? CORE.team : CORE.solo;
  lines.push({ key: core.key, name: core.name, unit: core.amount, qty: 1, total: core.amount });
  const extraStaff = team ? Math.max(0, input.staff - TEAM_INCLUDED) : 0;
  if (extraStaff) lines.push({ key: EXTRA_STAFF.key, name: EXTRA_STAFF.name, unit: EXTRA_STAFF.amount, qty: extraStaff, total: extraStaff * EXTRA_STAFF.amount });
  for (const t of input.tools) {
    const p = TOOL_PRICES[t]; if (!p) continue;
    lines.push({ key: p.key, name: p.name, unit: p.amount, qty: 1, total: p.amount });
  }
  if (input.tools.includes('renters')) {
    const extra = Math.max(0, input.renters - RENTERS_INCLUDED);
    if (extra) lines.push({ key: EXTRA_RENTER.key, name: EXTRA_RENTER.name, unit: EXTRA_RENTER.amount, qty: extra, total: extra * EXTRA_RENTER.amount });
  }
  return { lines, total: lines.reduce((n, l) => n + l.total, 0), textsIncluded: team ? TEXTS.teamIncluded : TEXTS.soloIncluded };
}
