// src/lib/callback-reasons.ts — "WHAT ARE THEY CALLING ABOUT?"
// Quick choices for a call-back, by module (a business only sees the modules it
// has). Each reason carries an INTERNAL target — how soon it should ideally be
// returned — used only to sort the Callbacks list and flag what's slipping.
// It is never told to the client; only a time staff choose to promise is.
import { moduleEnabled, type ModuleId } from '@/lib/modules';

export interface CallbackReason { id: string; label: string; module: ModuleId | null; targetMinutes: number; urgent?: boolean }

const ALL: CallbackReason[] = [
  // Appointments (every business)
  { id: 'book', label: 'Book an appointment', module: null, targetMinutes: 120 },
  { id: 'change', label: 'Change or cancel', module: null, targetMinutes: 60 },
  { id: 'running_late', label: 'Running late', module: null, targetMinutes: 15, urgent: true },
  { id: 'service_question', label: 'Question about a service', module: null, targetMinutes: 240 },
  // Modules
  { id: 'order', label: 'Order or delivery', module: 'retail', targetMinutes: 240 },
  { id: 'return', label: 'Return or exchange', module: 'retail', targetMinutes: 240 },
  { id: 'product', label: 'Product question', module: 'retail', targetMinutes: 480 },
  { id: 'enrolment', label: 'Enrolment', module: 'academy', targetMinutes: 480 },
  { id: 'clinic', label: 'Clinic appointment', module: 'academy', targetMinutes: 120 },
  { id: 'booth', label: 'Booth or suite rental', module: 'booth_rental', targetMinutes: 480 },
  { id: 'for_renter', label: 'For one of our renters', module: 'booth_rental', targetMinutes: 120 },
  { id: 'event', label: 'Event or party', module: 'classes_events', targetMinutes: 480 },
  { id: 'membership', label: 'Membership or package', module: 'memberships', targetMinutes: 240 },
  { id: 'reservation', label: 'Reservation', module: 'hospitality', targetMinutes: 60 },
  // Everyone
  { id: 'concern', label: 'A concern', module: null, targetMinutes: 60, urgent: true },
  { id: 'other', label: 'Something else', module: null, targetMinutes: 480 },
];

/** The reasons this business offers (only modules it has). */
export function callbackReasonsFor(tenant: any): CallbackReason[] {
  return ALL.filter((r) => !r.module || moduleEnabled(tenant, r.module));
}
export function callbackReason(id?: string | null): CallbackReason {
  return ALL.find((r) => r.id === id) || ALL[ALL.length - 1];
}
/** When it should ideally be returned (internal — never promised to the client). */
export const callbackTargetIso = (id?: string | null, from = Date.now()) => new Date(from + callbackReason(id).targetMinutes * 60000).toISOString();
