// src/lib/push-tier.ts — which kinds of alert can buzz a phone at all (shared by the sender and people's settings).
/** WHICH NOTIFICATIONS BUZZ A PHONE. Everything still appears in the app's notification list; this only decides the
 *  buzz. 'now' = someone needs to act in minutes · 'today' = needs attention today · anything not listed is quiet
 *  (reports, receipts, "for your records") — so phones never get noisier by accident when a new type is added. */
export const PUSH_TIER: Record<string, 'now' | 'today'> = {
  // Front desk & visits — a person is waiting
  walk_in_assigned: 'now', visit_cancelled: 'now', visit_moved: 'now', visit_added: 'now', visit_removed: 'now', appointment_assigned: 'now', renter_arrived: 'now', guest_arrived: 'now', front_door: 'now', guest_running_late: 'now', late_choice: 'now',
  clock_reminder: 'now', shift_no_show: 'now', timeclock: 'now',
  suspected_no_show: 'now', no_show_escalation: 'now', appointment_overdue: 'now', addon_handoff: 'now', escalation: 'now',
  provider_delay_reply: 'now', disruption_reply: 'now', cover_request: 'now', provider_ask: 'now', provider_offer_reply: 'now', change_request: 'now',
  // Station Assist & lounge
  assist: 'now', assist_escalation: 'now', floor_assist: 'now',
  // Housekeeping — stations, kits, cleansing, sterilising, laundry, delays
  turnover_due: 'now', turnover_escalation: 'now', kit_timer: 'now', kit_cleansed: 'now', contact_reached: 'now', cycle_done: 'now', linen_timer: 'now', kit_none_usable: 'now', kit_short: 'now', visit_delay: 'now', delay_affects_you: 'now',
  // Clients reaching out
  sms: 'now', sms_escalation: 'now', sms_escalation_unassigned: 'now', call_message: 'now', call_reply: 'now',
  // The team
  staff_message: 'now', pay_question: 'today', case_safety: 'now', case_new: 'now', case_yours: 'today', case_approval: 'now', case_redo: 'now', case_reopened: 'now', case_late: 'now', case_check_back: 'today', pay_question_update: 'now', shift_changed: 'now', clock_fix: 'today', clock_fix_approved: 'today', clock_fix_declined: 'today', shoutout: 'today', staff_details: 'today', approval_request: 'now', pin_reset: 'now', test: 'now',
  swap_request: 'today', request_approved: 'today', request_denied: 'today', day_off_approved: 'today', swap_approved: 'today', schedule_published: 'today', task: 'today',
  // Booth rental
  booth_reservation: 'today', booth_tour: 'today', booth_application: 'today', booth_no_show: 'today', renter_leave: 'today', renter_document: 'today',
  renter_concern: 'today', renter_message: 'today', renter_swap: 'today', credential: 'today', rent_late: 'today', renter_barred: 'today', tour_followup: 'today',
  // Other tools
  school_tour: 'today', quote_accepted: 'today', quote_declined: 'today', quote_revision: 'today', maintenance: 'today', maintenance_collision: 'today',
  membership_payment_failed: 'today', payroll_draft: 'today', waitlist_join: 'today', appointment: 'today', user: 'today',
};
