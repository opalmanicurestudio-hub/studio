// src/lib/hq-health.ts
//
// HOW HQ JUDGES A BUSINESS — plain rules, every score explains itself.
//
// SETUP  — the steps that make ClarityFlow useful, in order. A business
//          stuck early is the one to help first.
// HEALTH — is it being used, and is anything going wrong? 0–100, with the
//          reasons listed, so "at risk" always says WHY.
//
// Pure functions: the numbers come from /api/hq; this only interprets them.

export interface TenantSignals {
  services: number;
  clients: number;
  staff: number;
  appointmentsTotal: number;
  bookings7d: number;          // appointments created in the last 7 days
  bookingsPrev7d: number;      // the 7 days before that
  messagesFailed7d: number;
  messagesSent7d: number;
  openTickets: number;
  daysSinceOwnerSignIn: number | null;
  stripeConnected: boolean;
  active: boolean;             // finished "Your ClarityFlow"
  teamSize: 'solo' | 'team' | string;
  ageDays: number;             // since sign-up
}

export interface SetupStep { key: string; label: string; done: boolean }

export function setupSteps(s: TenantSignals): SetupStep[] {
  return [
    { key: 'active', label: 'Entered ClarityFlow', done: s.active },
    { key: 'services', label: 'Added services', done: s.services > 0 },
    { key: 'stripe', label: 'Connected payments (Stripe)', done: s.stripeConnected },
    { key: 'clients', label: 'Has clients', done: s.clients > 0 },
    ...(s.teamSize === 'team' ? [{ key: 'team', label: 'Added their team', done: s.staff > 1 }] : []),
    { key: 'booking', label: 'Took a first booking', done: s.appointmentsTotal > 0 },
  ];
}

export function setupScore(s: TenantSignals) {
  const steps = setupSteps(s);
  const done = steps.filter((x) => x.done).length;
  const next = steps.find((x) => !x.done) || null;
  return { steps, done, total: steps.length, pct: Math.round((done / steps.length) * 100), next };
}

export type HealthLabel = 'thriving' | 'healthy' | 'watch' | 'at risk' | 'new';

export function healthScore(s: TenantSignals): { score: number; label: HealthLabel; reasons: string[]; good: string[] } {
  const reasons: string[] = []; const good: string[] = [];
  let score = 70;

  // Brand-new businesses are judged on setup, not activity.
  if (s.ageDays < 7 && s.appointmentsTotal === 0) {
    const setup = setupScore(s);
    return { score: 50 + Math.round(setup.pct / 2), label: 'new', reasons: setup.next ? [`Next setup step: ${setup.next.label.toLowerCase()}`] : [], good: [`Joined ${s.ageDays} day${s.ageDays === 1 ? '' : 's'} ago`] };
  }

  // Activity
  if (s.bookings7d >= 10) { score += 15; good.push(`${s.bookings7d} bookings this week`); }
  else if (s.bookings7d >= 3) { score += 8; good.push(`${s.bookings7d} bookings this week`); }
  else if (s.bookings7d === 0) { score -= 20; reasons.push('No new bookings this week'); }
  if (s.bookingsPrev7d >= 4 && s.bookings7d < s.bookingsPrev7d * 0.5) { score -= 15; reasons.push(`Bookings fell from ${s.bookingsPrev7d} to ${s.bookings7d} this week`); }
  else if (s.bookings7d > s.bookingsPrev7d && s.bookingsPrev7d > 0) { score += 5; good.push('Bookings are growing'); }

  // The owner showing up
  if (s.daysSinceOwnerSignIn !== null) {
    if (s.daysSinceOwnerSignIn > 21) { score -= 25; reasons.push(`Owner hasn’t signed in for ${s.daysSinceOwnerSignIn} days`); }
    else if (s.daysSinceOwnerSignIn > 7) { score -= 10; reasons.push(`Owner last signed in ${s.daysSinceOwnerSignIn} days ago`); }
    else good.push('Owner active this week');
  }

  // Things going wrong
  if (s.messagesFailed7d >= 3 && s.messagesFailed7d / Math.max(1, s.messagesSent7d + s.messagesFailed7d) > 0.2) { score -= 20; reasons.push(`${s.messagesFailed7d} messages failed to send this week`); }
  if (s.openTickets > 0) { score -= 7 * Math.min(3, s.openTickets); reasons.push(`${s.openTickets} open help request${s.openTickets === 1 ? '' : 's'}`); }
  if (!s.stripeConnected) { score -= 10; reasons.push('Payments not connected'); }
  if (!s.active) { score -= 10; reasons.push('Hasn’t finished setting up'); }

  score = Math.max(0, Math.min(100, score));
  const label: HealthLabel = score >= 85 ? 'thriving' : score >= 65 ? 'healthy' : score >= 45 ? 'watch' : 'at risk';
  return { score, label, reasons, good };
}
