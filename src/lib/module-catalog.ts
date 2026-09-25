// src/lib/module-catalog.ts
//
// CLARITYFLOW À LA CARTE — the tools a business can turn on.
//
// One catalog for every place a business chooses what it needs: the landing
// page ("Unlock what your business needs"), sign-up ("What do you need?"), and
// "Your ClarityFlow" (/subscriptions — after sign-up and later from the app).
// Each tool maps onto the gates in src/lib/modules.ts, so choosing really
// shows/hides those parts of the app; `toTenantModules()` builds the
// tenant.modules map that the sidebar already reads.
//
// Wording rules: every tool describes something the app does today. "Gives
// back" is a typical estimate for a small team — always shown as "about",
// never promised. "Others" is what comparable platforms usually lack or
// charge extra for, in general terms.

import type { ModuleId as GateId } from './modules';

export type ToolId =
  | 'booking' | 'guest' | 'kiosk' | 'marketing' | 'memberships' | 'books'
  | 'inventory' | 'team' | 'renters' | 'classes' | 'voice' | 'lounge' | 'academy';

export interface Tool {
  id: ToolId; emoji: string; name: string; line: string; includes: string[];
  gives: string; hours: number; profit?: string; others: string;
  gates: GateId[];   // registry switches this tool controls; [] = always included
  early?: boolean;   // works today, still being finished — labelled "early" in the picker
}

export const TOOLS: Tool[] = [
  { id: 'booking', emoji: '📅', name: 'Booking & payments', gates: [], line: 'Online booking that can’t double-book, with deposits and card on file.',
    includes: ['Your own booking page', 'Deposits & no-show protection', 'Approve requests — or instant', 'Reminders on autopilot'],
    gives: 'About 4 hrs a week of back-and-forth', hours: 4, profit: 'Deposits turn no-shows into paid time', others: 'Most charge extra for deposits or approvals' },
  { id: 'guest', emoji: '✨', name: 'Guest experience', gates: [], line: 'Live updates from booking to goodbye — they always know, so you don’t field the calls.',
    includes: ['Running-late & arrived, live', 'Self check-in from their phone', 'Forms, consent & photo ID before they arrive', 'Service recovery when something goes wrong'],
    gives: 'About 3 hrs a week of calls and texts', hours: 3, others: 'Most stop at a reminder text' },
  { id: 'kiosk', emoji: '📲', name: 'Front desk & walk-ins', gates: ['kiosk'], line: 'A tablet front desk for walk-ins and a lobby screen that shows who’s next.',
    includes: ['Walk-in kiosk & live waitlist', 'Text-when-ready', 'Lobby board for the waiting room', 'Waitlist that fills cancellations'],
    gives: 'A front desk that runs itself', hours: 3, others: 'Usually a separate app or add-on' },
  { id: 'marketing', emoji: '💌', name: 'Marketing & reputation', gates: ['marketing'], line: 'Clients come back on their own — and you see who, and what it earned.',
    includes: ['Win-back & “you’re due” nudges', 'Campaigns with real results', 'Offers applied at checkout', 'Reviews collected & shown off'],
    gives: 'About 2 hrs a week of chasing', hours: 2, profit: 'Rebookings you’d have lost, counted in dollars', others: 'Often a paid add-on, measured in opens instead of bookings' },
  { id: 'memberships', emoji: '🔁', name: 'Memberships & packages', gates: ['memberships'], line: 'Recurring revenue that renews itself, with credits that apply themselves.',
    includes: ['Monthly memberships on autopay', 'Packages & credits', 'Member perks & early booking', 'Failed-payment follow-up'],
    gives: 'Predictable income every month', hours: 1, profit: 'Revenue before the month starts', others: 'Often limited to higher plans' },
  { id: 'books', emoji: '📒', name: 'Automated bookkeeping', gates: ['money'], line: 'Books that keep themselves — every sale, tip, fee and bill in the right place.',
    includes: ['Live ledger from every sale', 'Bank feeds & bills', 'True profit per service', 'An AI adviser on your numbers'],
    gives: 'About 3 hrs a week of bookkeeping', hours: 3, profit: 'See what actually makes money', others: 'Booking apps leave this to separate accounting software' },
  { id: 'inventory', emoji: '📦', name: 'Inventory & retail', gates: ['retail'], line: 'One stock count for the backbar, the shelf and your online shop.',
    includes: ['Stock that counts itself', 'Online shop & fulfilment', 'Low-stock alerts & reorders', 'Returns handled'],
    gives: 'About 2 hrs a week of counting', hours: 2, profit: 'Know product cost per service', others: 'Usually a second system to keep in sync' },
  { id: 'team', emoji: '👥', name: 'Team & onboarding', gates: ['team', 'maintenance'], line: 'Hire, onboard and run your team — schedules, hours and pay in one place.',
    includes: ['Job posts, applicants & interviews', 'Onboarding checklists & handbooks', 'Shifts, time clock & timesheets', 'Commission & payroll', 'A staff portal on their phone'],
    gives: 'About 3 hrs a week of admin', hours: 3, others: 'Hiring and onboarding are rarely included' },
  { id: 'renters', emoji: '🔑', name: 'Booth & suite rental', gates: ['booth_rental', 'maintenance'], line: 'Renters get their own portal and clients — rent collects itself.',
    includes: ['Leases & rent on autopay', 'A portal for every renter', 'Their own booking, offers & books', 'Tours, day rentals & a check-in kiosk', 'Maintenance requests'],
    gives: 'No more chasing rent', hours: 2, profit: 'Rent in on time, every time', others: 'Built for owners with renters — most platforms aren’t' },
  { id: 'classes', emoji: '🎟️', name: 'Classes & events', gates: ['classes_events'], line: 'Classes, workshops and events — spots, waitlists and quotes.',
    includes: ['Class schedules & capacity', 'Workshops & group bookings', 'Inquiries, event quotes & deposits', 'Waitlists that fill themselves'],
    gives: 'Full rooms without the spreadsheet', hours: 2, others: 'Usually a different platform from appointments' },
  { id: 'voice', emoji: '🎙️', name: 'AI receptionist', gates: ['voice'], line: 'Answers the phone, books, moves and cancels — while you work.',
    includes: ['Answers calls 24/7', 'Books into your real calendar', 'Reschedules & cancels by policy', 'Hands off to you when needed'],
    gives: 'Every call answered', hours: 3, others: 'Rare — and usually a separate subscription' },
  { id: 'lounge', emoji: '☕', name: 'Lounge & hospitality', gates: ['hospitality'], early: true, line: 'A guest lounge, café or bar — menu, orders, host stand and a kitchen screen.',
    includes: ['Guest lounge menu & orders', 'Host stand & seating', 'Floor service for your team', 'Kitchen & bar display'],
    gives: 'Drinks and extras that add to every visit', hours: 1, profit: 'Turns waiting time into sales', others: 'Appointment platforms don’t run a lounge or café' },
  { id: 'academy', emoji: '🎓', name: 'Online academy', gates: ['academy'], early: true, line: 'Sell courses online — video lessons, a student portal, progress and pay-later.',
    includes: ['Courses, modules & video lessons', 'Free preview lessons', 'A student portal that remembers their place', 'Card or pay-later checkout'],
    gives: 'Income that isn’t tied to the chair', hours: 1, profit: 'Sell what you know, again and again', others: 'Booking platforms don’t teach — you’d pay for a separate course platform' },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, Tool>;

export const RECOMMENDED: Record<string, ToolId[]> = {
  salon: ['booking', 'guest', 'marketing', 'books', 'renters', 'team'],
  spa: ['booking', 'guest', 'memberships', 'marketing', 'books'],
  fitness: ['booking', 'classes', 'memberships', 'kiosk', 'marketing'],
  shop: ['booking', 'inventory', 'classes', 'marketing', 'books'],
  tattoo: ['booking', 'guest', 'marketing', 'books', 'renters'],
  events: ['booking', 'classes', 'marketing', 'books'],
  hospitality: ['booking', 'lounge', 'kiosk', 'inventory', 'books', 'team'],
  other: ['booking', 'guest', 'marketing', 'books'],
};

export const hoursFor = (ids: ToolId[]) => ids.reduce((n, id) => n + (TOOL_BY_ID[id]?.hours || 0), 0);

/** The tenant.modules map for a chosen set of tools (every gate explicitly on or off). */
export function toTenantModules(ids: ToolId[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const t of TOOLS) for (const g of t.gates) out[g] = out[g] || ids.includes(t.id);
  return out;
}

/** The tools a tenant has on, read back from tenant.modules (absent = on). */
export function fromTenantModules(modules: Record<string, boolean> | null | undefined): ToolId[] {
  return TOOLS.filter((t) => t.gates.length === 0 || t.gates.some((g) => modules?.[g] !== false)).map((t) => t.id);
}

/** What sign-up used to call "category" — kept for the parts of the app that read it. */
export const CATEGORY_FOR: Record<string, string> = { salon: 'hair', spa: 'skin', fitness: 'fitness', shop: 'other', tattoo: 'tattoo', events: 'other', hospitality: 'other', other: 'other' };
