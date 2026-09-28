// src/lib/late-reply.ts — what a client is told when they're running late and
// we've decided what happens. Shared by the server (which sends it) and the
// front desk / planner (which preview it before sending).
export const LATE_OPTIONS = ['keep', 'condense', 'switch', 'move'] as const;
export type LateOption = typeof LATE_OPTIONS[number];

/** The message a client gets for each decision — plain, specific, kind. */
export function lateReplyText(o: LateOption, x: { first: string; studio: string; provider?: string | null; eta?: string | null; dropped?: string[]; toProvider?: string | null; fee?: number; note?: string | null }): string {
  const see = x.eta ? ` We’ll see you around ${x.eta}.` : ' Come in as soon as you can.';
  const fee = x.fee && x.fee > 0 ? ` A $${x.fee.toFixed(2)} late fee applies, as set out in our policy.` : '';
  const note = x.note ? ` ${x.note}` : '';
  if (o === 'keep') return `Thanks for letting us know, ${x.first} — ${x.provider || 'we'} can still see you for your full visit.${see}${fee}${note}`;
  if (o === 'condense') return `Thanks for letting us know, ${x.first} — ${x.provider || 'we'} can still see you, but we’ll need to keep it shorter today${x.dropped?.length ? ` (we’ll skip ${x.dropped.join(', ')})` : ''}.${see}${fee}${note}`;
  if (o === 'switch') return `Thanks for letting us know, ${x.first} — to fit you in, ${x.toProvider || 'another of our team'} will look after you today.${see}${fee}${note}`;
  return `We’re sorry, ${x.first} — we can’t fit you in today at that time, so please don’t come in. Choose a new time with the link below and we’ll see you then.${note}`;
}
