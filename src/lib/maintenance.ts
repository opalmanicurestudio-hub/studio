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
export type TicketCategory = 'equipment' | 'plumbing' | 'electrical' | 'cleaning' | 'safety' | 'other';

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
  costCents?: number | null;           // filled at resolution if there was a cost
  overdueNotifiedAt?: string | null;   // cron stamp — one nag, not nightly spam
}

export interface MaintenanceWorker {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  token: string;                       // portal auth — rotate to revoke
  active: boolean;
  createdAt: string;
}

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
  { value: 'other', label: 'Other' },
];

// A ticket blocks its station when it's serious and unfinished — the floor
// derives 'maintenance' status from this, so the map and the ticket system
// can never disagree.
export const ticketBlocksBooth = (t: Pick<Ticket, 'status' | 'priority'>): boolean =>
  (t.status === 'open' || t.status === 'in_progress') && (t.priority === 'urgent' || t.priority === 'high');

export const isTicketOverdue = (t: Pick<Ticket, 'status' | 'dueAt'>, nowIso?: string): boolean =>
  (t.status === 'open' || t.status === 'in_progress') && !!t.dueAt && t.dueAt < (nowIso || new Date().toISOString());
