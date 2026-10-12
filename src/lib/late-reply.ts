// src/lib/late-reply.ts — what a client is told when they're running late and
// we've decided what happens. Shared by the server (which sends it) and the
// front desk / planner (which preview it before sending).
export const LATE_OPTIONS = ['keep', 'condense', 'switch', 'move'] as const;
export type LateOption = typeof LATE_OPTIONS[number];

/** The message a client gets for each decision — plain, specific, kind. */
export function lateReplyText(o: LateOption, x: { first: string; studio: string; provider?: string | null; eta?: string | null; dropped?: string[]; toProvider?: string | null; fee?: number; note?: string | null }): string {
  const see = x.eta ? ` We're looking forward to seeing you at about ${x.eta}.` : " We're looking forward to seeing you when you arrive.";
  const fee = x.fee && x.fee > 0 ? ` Please note that our late arrival fee of $${x.fee.toFixed(2)} applies.` : '';
  const note = x.note ? ` ${x.note}` : '';
  if (o === 'keep') return `Hi ${x.first}, thank you for letting us know. ${x.provider || 'We'} can still complete your full appointment.${see}${fee}${note}`;
  if (o === 'condense') return `Hi ${x.first}, thank you for letting us know. ${x.provider || 'We'} can still see you, but your appointment will need to be a little shorter today${x.dropped?.length ? `, so we won't be able to include ${x.dropped.join(', ')}` : ''}.${see}${fee}${note}`;
  if (o === 'switch') return `Hi ${x.first}, thank you for letting us know. So that we can still see you today, ${x.toProvider || 'another member of our team'} will take care of your appointment.${see}${fee}${note}`;
  return `Hi ${x.first}, thank you for letting us know. Unfortunately, we're no longer able to keep your appointment at this time, and we're sorry about that. Please choose a new time using the link below. We look forward to seeing you then.${note}`;
}
