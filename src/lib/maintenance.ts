// src/lib/maintenance.ts
//
// Single source of truth for the MAINTENANCE TICKET system — the shared
// vocabulary every surface uses: the owner's Booth Hub, the maintenance
// tech portal (/maintain), the renter portal, and the nightly SLA sweep.
//
// Design principles (built to scale from a team of one to many):
//   • ONE ticket lifecycle: open → in_progress → resolved (+ cancelled).
//     No bespoke statuses per surface — a renter, a tech, and the owner
//     all see the same word for the same state.
//   • The `updates` array is the ticket's PUBLIC thread. Everything on it
//     is visible to the reporter (renter), the tech, and the owner — so
//     "what's happening with my ticket?" is never a phone call.
//   • SLA is derived from priority at creation (dueAt) and enforced by
//     the nightly cron — overdue tickets surface themselves; nobody has
//     to remember to check.
//   • Workers authenticate by token link (same pattern as every other
//     portal in the app) — no accounts to provision, revocable instantly
//     by rotating the token.

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';
export type TicketPriority = 'urgent' | 'high' | 'normal' | 'low';
export type TicketCategory = 'equipment' | 'plumbing' | 'electrical' | 'cleaning' | 'safety' | 'request' | 'other';

export interface TicketUpdate {
  at: string;                          // ISO — real timestamps everywhere
  by: string;                          // display name
  byType: 'owner' | 'staff' | 'renter' | 'tech' | 'system';
  note?: string;
  status?: TicketStatus;               // present when this update changed status
  photoUrl?: string;
}

export interface Ticket {
  id: string;
  tenantId: string;
  locationId?: string | null;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  boothId?: string | null;
  boothName?: string | null;
  reporter: { type: 'owner' | 'staff' | 'renter' | 'tech'; name: string; phone?: string; email?: string; renterId?: string | null };
  assigneeId?: string | null;          // maintenanceWorkers doc id
  assigneeName?: string | null;
  photoUrls?: string[];
  updates: TicketUpdate[];
  createdAt: string;
  updatedAt: string;
  dueAt: string;                       // SLA deadline, derived from priority
  resolvedAt?: string | null;
  costCents?: number | null;           // materials, filled at resolution
  // Who paid for the materials: 'studio' = expense booked immediately
  // (studio money already left); 'tech' = the tech fronted it — accrues
  // as a reimbursement owed, ledger entry happens at payout.
  materialsPaidBy?: 'studio' | 'tech' | null;
  laborHours?: number | null;          // hours the tech logged at resolution
  laborCents?: number | null;          // laborHours × the OWNER-set hourly rate
  overdueNotifiedAt?: string | null;   // cron stamp — one nag, not nightly spam
  // JOB CLOCK — start/stop sessions tapped from the tech portal. The
  // timer is EVIDENCE, not the pay input: it pre-fills the hours field
  // at resolve, and the owner sees timed vs claimed side by side. Pay
  // still comes from hours × the owner-set rate.
  workSessions?: {
    startAt: string; endAt?: string | null; by?: string;
    // Location stamps captured at clock in/out (fail-soft — permission
    // denied records null and never blocks work). Proof of presence.
    startLoc?: { lat: number; lng: number; acc?: number } | null;
    endLoc?: { lat: number; lng: number; acc?: number } | null;
  }[];
  // MILEAGE — miles logged at resolve × the studio's per-mile rate (set
  // in Rules). Reimbursement rides the same payout balance as labor.
  mileage?: number | null;
  mileageCents?: number | null;
  // REQUESTS FILED AGAINST THIS JOB — they live on this work order's
  // thread, never as a separate ticket. Owner marks them handled.
  openRequests?: {
    id: string; kind: string; kindLabel: string; title: string;
    qty?: string | null; neededBy?: string | null; estCostCents?: number;
    forStaff?: string[]; by: string; at: string;
    status: 'open' | 'handled';
  }[];
  // MID-JOB PURCHASES logged by the owner from this ticket — already in
  // the ledger (one txn each). Kept separate from resolve-time costCents
  // so nothing is counted twice.
  purchasedCents?: number | null;
  // One-shot stamp: owner notified that timed work passed the agreement.
  agreementOverNotified?: boolean;
  // QUOTES — for jobs big enough to price before work starts. The tech
  // submits from their portal; the owner approves or declines; the work
  // order prints quoted vs actual so overruns are visible, not felt.
  quoteRequested?: boolean;
  quote?: {
    hours?: number;
    materialsCents?: number;
    laborCents?: number;
    totalCents: number;
    note?: string;
    by: string;
    at: string;
    status: 'pending' | 'approved' | 'declined';
    decidedAt?: string | null;
    // Owner countered before approving — hours/total are the OWNER'S
    // numbers now. The approved quote is the working agreement either way.
    countered?: boolean;
  } | null;
}

export interface MaintenanceWorker {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  token: string;                       // portal auth — rotate to revoke
  active: boolean;
  createdAt: string;
  // ── Pay & payroll integration ──────────────────────────────────────
  // 'payroll'  — an employee: wages, timesheets, and payday live on the
  //              Staff page (the existing payroll system). Ticket labor
  //              is NOT accrued here — it's covered by their wages.
  // 'per_job'  — a contractor paid per ticket: labor entered at resolve
  //              accrues to unpaidLaborCents until the owner pays it out
  //              (one tap → 'Contract Labor' expense in the ledger).
  payType?: 'payroll' | 'per_job';
  // Set by the OWNER. Techs log hours; the server prices them at this rate.
  // 0 / unset = hours are recorded but no labor money accrues.
  hourlyRateCents?: number;
  // Two SEPARATE balances, because they're different money:
  // - unpaidLaborCents: earned labor + mileage → pays out as Contract Labor
  // - unpaidMaterialsCents: materials the tech FRONTED from their own
  //   pocket → a reimbursement liability, NOT an expense until paid.
  //   Pays out as Maintenance & Repairs. Booking it at resolve would put
  //   an expense in the ledger before any studio cash moved.
  unpaidLaborCents?: number;
  unpaidMaterialsCents?: number;
  laborPayments?: { at: string; amountCents: number; method?: string; laborCents?: number; materialsCents?: number }[];
  // Round-robin cursor — auto-rotation assigns the least-recently-assigned
  // active worker. Bumped on every assignment (manual or automatic).
  lastAssignedAt?: string | null;
  providerId?: string | null;          // set when promoted from the directory
}

// Round-robin pick: least-recently-assigned ACTIVE worker. Pure — both the
// client (owner-created tickets) and the server (renter/plan tickets) use
// this same function so rotation order can never diverge.
export function pickRotationWorker<T extends { active?: boolean; lastAssignedAt?: string | null }>(workers: T[]): T | null {
  const active = (workers || []).filter(w => w.active !== false);
  if (active.length === 0) return null;
  return active.slice().sort((a, b) => String(a.lastAssignedAt || '').localeCompare(String(b.lastAssignedAt || '')))[0];
}

// ── Preventive maintenance plan — recurring work that opens its own
// tickets on schedule (deep-clean stations monthly, HVAC filter
// quarterly…). The nightly cron is the engine: when nextRunAt arrives it
// creates a normal ticket (same queue, same SLA, same notifications) and
// advances nextRunAt by everyDays. Idempotent by construction — the
// advance happens in the same write as the ticket creation.
export interface MaintenancePlan {
  id: string;
  title: string;
  description?: string;
  category: TicketCategory;
  priority: TicketPriority;
  boothId?: string | null;             // a specific station, or null = facility-wide
  boothName?: string | null;
  assigneeId?: string | null;          // pre-assign every generated ticket
  assigneeName?: string | null;
  everyDays: number;                   // 7 / 14 / 30 / 90 / custom
  nextRunAt: string;                   // YYYY-MM-DD — next ticket creation date
  lastRunAt?: string | null;
  active: boolean;
  createdAt: string;
}

// Date-only add — plans run on calendar days, not millisecond math.
export const addDaysISO = (dateOnly: string, days: number): string => {
  const d = new Date(`${dateOnly}T00:00:00`);
  d.setDate(d.getDate() + Math.max(1, Math.round(days)));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const PLAN_INTERVALS: { days: number; label: string }[] = [
  { days: 7, label: 'Weekly' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Monthly' },
  { days: 90, label: 'Quarterly' },
  { days: 180, label: 'Twice a year' },
  { days: 365, label: 'Yearly' },
];

// SLA hours by priority — how long until a ticket is considered overdue.
export const SLA_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high: 24,
  normal: 72,
  low: 168,
};

export const dueAtFor = (priority: TicketPriority, fromIso?: string): string =>
  new Date(new Date(fromIso || Date.now()).getTime() + (SLA_HOURS[priority] || 72) * 3600_000).toISOString();

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open', in_progress: 'In progress', resolved: 'Resolved', cancelled: 'Cancelled',
};
export const TICKET_STATUS_TONES: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low',
};
export const TICKET_PRIORITY_TONES: Record<TicketPriority, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  normal: 'bg-slate-100 text-slate-600',
  low: 'bg-slate-50 text-slate-400',
};
export const TICKET_CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: 'equipment', label: 'Equipment' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'safety', label: 'Safety' },
  // Techs file these from their portal: "need more caulk", "buy a new
  // filter", "key for the back room". Same queue, same thread, same
  // notifications — resolving one with a Materials $ logs the purchase.
  { value: 'request', label: 'Supplies / request' },
  { value: 'other', label: 'Other' },
];

// ── APPROVAL RULES — each business sets its own thresholds ─────────────
// Stored at tenants/{id}.maintenanceRules and enforced SERVER-SIDE (the
// portal warns early, but the API is the gate — rules can't be bypassed
// by a creative client). All amounts in cents; 0/absent = rule off.
export interface MaintenanceRules {
  // Quotes at or under this auto-approve instantly — small jobs don't
  // wait on the owner. ("Don't ask me about anything under $50.")
  autoApproveUnderCents?: number;
  // Resolving a job whose total (materials + labor) exceeds this WITHOUT
  // an approved quote is blocked. ("Nothing over $200 without sign-off.")
  requireQuoteOverCents?: number;
  // Resolving with materials over this requires a photo on the ticket
  // (the receipt). ("Spend over $75 shows me the receipt.")
  receiptRequiredOverCents?: number;
  // Per-mile reimbursement rate. 0 = mileage not reimbursed (field stays
  // hidden in the tech portal). E.g. 67 = $0.67/mile.
  mileageRateCents?: number;
}
// Total timed minutes across a ticket's work sessions. An open session
// counts up to `now` (pass it in — keeps this pure and testable).
export function timedMinutesOf(
  t: { workSessions?: { startAt: string; endAt?: string | null }[] },
  nowMs: number,
): number {
  return Math.round((t.workSessions || []).reduce((acc, s) => {
    const start = new Date(s.startAt).getTime();
    const end = s.endAt ? new Date(s.endAt).getTime() : nowMs;
    return acc + Math.max(0, end - start);
  }, 0) / 60000);
}
export const fmtMinutes = (m: number) => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim();

export function normalizeRules(raw: any): Required<MaintenanceRules> {
  const n = (v: any) => Math.max(0, Math.round(Number(v) || 0));
  return {
    autoApproveUnderCents: n(raw?.autoApproveUnderCents),
    requireQuoteOverCents: n(raw?.requireQuoteOverCents),
    receiptRequiredOverCents: n(raw?.receiptRequiredOverCents),
    mileageRateCents: n(raw?.mileageRateCents),
  };
}

// A ticket blocks its station when it's serious and unfinished — the floor
// derives 'maintenance' status from this, so the map and the ticket system
// can never disagree.
export const ticketBlocksBooth = (t: Pick<Ticket, 'status' | 'priority'>): boolean =>
  (t.status === 'open' || t.status === 'in_progress') && (t.priority === 'urgent' || t.priority === 'high');

export const isTicketOverdue = (t: Pick<Ticket, 'status' | 'dueAt'>, nowIso?: string): boolean =>
  (t.status === 'open' || t.status === 'in_progress') && !!t.dueAt && t.dueAt < (nowIso || new Date().toISOString());
