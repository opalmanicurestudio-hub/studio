// src/lib/agent-access.ts — WHAT AI ASSISTANTS MAY DO WITH A BUSINESS (the agent plan, Phase 1).
// Reading the public menu and open times is free for every business (it is already public on the booking page) and
// can be switched off. Holding a time for a client to confirm needs the ClarityFlow Assistant add-on AND the owner
// turning it on. Every answer to an assistant carries a short code plus plain words (agentErr), so an assistant can
// act on it and a person can read it.

export const ADDON_ID = 'assistant';

/** The ClarityFlow Assistant add-on is active for this business. */
export const assistantAddon = (t: any) => {
  const a = t?.addons?.[ADDON_ID];
  return a === true || a?.active === true || a?.status === 'active';
};

export function agentPolicy(t: any) {
  const s = t?.agents || {};
  const menu = s.menu !== false;
  return {
    menu,
    openTimes: menu && s.openTimes !== false,
    holds: menu && assistantAddon(t) && s.holds === true,
    holdServices: Array.isArray(s.holdServiceIds) && s.holdServiceIds.length ? s.holdServiceIds.map(String) : null,   // null = any eligible service
    holdMinutes: Math.max(5, Math.min(60, Math.round(Number(s.holdMinutes) || 15))),
  };
}

export type AgentCode = 'ok' | 'business_not_found' | 'business_not_taking_agent_requests' | 'service_not_found' | 'provider_not_found'
  | 'bad_request' | 'time_taken' | 'outside_booking_window' | 'service_needs_consultation' | 'holds_not_offered' | 'too_many_requests' | 'hold_expired';

/** An answer an assistant can act on: { ok, code, message, ...extra }. */
export function agentErr(code: AgentCode, message: string, extra: Record<string, any> = {}) {
  return { ok: false, code, message, ...extra };
}

/** Services an assistant may see: the public menu (bookable, listed, not private, not an add-on on its own). */
export const publicService = (s: any) => !!s?.name && s.status !== 'archived' && s.isActive !== false && !s.isPrivate && s.type !== 'addon' && !s.isAddon;
export const publicAddOn = (s: any) => !!s?.name && s.status !== 'archived' && s.isActive !== false && !s.isPrivate && (s.type === 'addon' || s.isAddon);
/** Services an assistant may hold: not consultation-only, not approval-only, not members-only, not a renter's own menu. */
export const holdable = (s: any) => publicService(s) && !s.consultationRequired && !s.requiresConsultation && s.bookingMode !== 'request' && s.requiresApproval !== true && !s.membersOnly;
