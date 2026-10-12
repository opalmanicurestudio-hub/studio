// src/lib/late-reply.ts — what a client is told when they're running late and
// we've decided what happens. Shared by the server (which sends it) and the
// front desk / planner (which preview it before sending).
export const LATE_OPTIONS = ['keep', 'condense', 'switch', 'move'] as const;
export type LateOption = typeof LATE_OPTIONS[number];

/** The message a client gets for each decision — plain, specific, kind. */
export function lateReplyText(o: LateOption, x: { first: string; studio: string; provider?: string | null; eta?: string | null; dropped?: string[]; toProvider?: string | null; fee?: number; note?: string | null }): string {
  const see = x.eta ? ` We look forward to seeing you at about ${x.eta}.` : ' We look forward to seeing you when you arrive.';
  const fee = x.fee && x.fee > 0 ? ` As outlined in our late arrival policy, a late fee of $${x.fee.toFixed(2)} applies.` : '';
  const note = x.note ? ` ${x.note}` : '';
  if (o === 'keep') return `Hi ${x.first}, thank you for letting us know. ${x.provider || 'We'} will still be able to complete your full appointment.${see}${fee}${note}`;
  if (o === 'condense') return `Hi ${x.first}, thank you for letting us know. ${x.provider || 'We'} will still be able to see you, but your appointment will need to be shorter today${x.dropped?.length ? `, so we will not be able to include ${x.dropped.join(', ')}` : ''}.${see}${fee}${note}`;
  if (o === 'switch') return `Hi ${x.first}, thank you for letting us know. So that we can still see you today, ${x.toProvider || 'another member of our team'} will take care of your appointment.${see}${fee}${note}`;
  return `Hi ${x.first}, thank you for letting us know. Unfortunately, we are no longer able to keep your appointment at this time, and we apologize for the inconvenience. Please choose a new time using the link below, and we look forward to seeing you then.${note}`;
}
