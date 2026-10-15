// src/lib/outreach-history.ts — "Why we reached out": every time the business contacted a client on its own initiative
// (an opportunity, a reward reminder, a waitlist offer or call, a campaign, a request to move), with the reason in plain
// words, who or what sent it, and what came of it. So nobody sends the same thing twice, and anyone can answer
// "why did you text me?". Built from messageLog, opportunities and voiceCalls; replies and visit reminders aren't here.
import { PLAYBOOKS, OUTCOMES } from '@/lib/opportunities';

export type OutreachItem = { at: string; why: string; how: string; by: string; result: string | null; tone: 'good' | 'neutral' | 'bad' | null; source: 'opportunity' | 'message' | 'call' };
const ms = (v: any) => Date.parse(String(v || '')) || 0;

/** Message kinds that are the business reaching out (not replies, reminders, receipts). Opportunity texts come from the opportunity itself. */
export const OUTREACH_KINDS: Record<string, string> = {
  loyalty: 'A reward reminder', waitlist_offer: 'A time opened that they were waiting for', waitlist_still: 'Asked whether they still wanted a time',
  waitlist_autobooked: 'Booked from the waitlist, as they asked', waitlist_opening: 'A time opened that they were waiting for', tidy_ask: 'Asked whether they could move their visit',
  campaign: 'A campaign', birthday: 'A birthday message', rebook: 'A reminder to rebook', rebooking: 'A reminder to rebook', referral_update: 'An update on a referral',
  provider_offer: 'Offered another provider or time', cart_recovery: 'A reminder about their basket',
};

const OPP_STATUS: Record<string, string> = { auto: 'Texted automatically', open: 'On the team’s list', scheduled: 'Scheduled', done: 'Contacted', holdout: 'Held back on purpose, to measure results (not contacted)', dismissed: 'Dismissed, not contacted', expired: 'Ran out of time, not contacted', not_sent: 'Not sent' };

export function outreachTimeline(x: { messages: any[]; opportunities: any[]; calls: any[] }, limit = 60): OutreachItem[] {
  const out: OutreachItem[] = [];
  for (const o of x.opportunities || []) {
    const pb: any = (PLAYBOOKS as any)[o.kind]; const label = pb?.label || 'An opportunity'; const reason = String(o.why || '').trim();
    const why = reason ? `${label}: ${reason}` : label;
    const tries = (o.attempts || []).filter((a: any) => a && a.at);
    const outcome = o.outcome ? (OUTCOMES as any)[o.outcome] : null;
    const came = o.result?.status === 'paid' ? 'Came back and paid' : o.result?.status === 'booked' ? 'Booked' : null;
    if (!tries.length) { if (['holdout', 'dismissed', 'expired'].includes(String(o.status))) out.push({ at: o.closedAt || o.createdAt, why, how: OPP_STATUS[o.status] || o.status, by: '', result: null, tone: null, source: 'opportunity' }); continue; }
    tries.forEach((a: any, i: number) => {
      const last = i === tries.length - 1;
      out.push({ at: a.at, why, how: `${a.channel === 'call' ? 'Call' : a.channel === 'email' ? 'Email' : a.channel === 'in_person' ? 'In person' : 'Text'}${a.note && a.by !== 'auto' ? ` · ${String(a.note).slice(0, 90)}` : ''}`, by: a.byName || (a.by === 'auto' ? 'Sent automatically' : ''),
        result: last ? came || (outcome ? outcome.label : a.outcome ? ((OUTCOMES as any)[a.outcome]?.label || null) : null) : a.outcome ? ((OUTCOMES as any)[a.outcome]?.label || null) : null,
        tone: last ? (came ? 'good' : outcome?.tone || null) : null, source: 'opportunity' });
    });
  }
  for (const m of x.messages || []) {
    const why = OUTREACH_KINDS[String(m.kind || '')]; if (!why) continue;
    out.push({ at: m.sentAt || m.at, why, how: m.channel === 'email' ? 'Email' : 'Text', by: m.sentBy || 'Sent automatically', result: m.status === 'failed' ? 'Didn’t go through' : null, tone: m.status === 'failed' ? 'bad' : null, source: 'message' });
  }
  for (const c of x.calls || []) {
    if (c.direction !== 'outbound' || !c.outboundReason || c.outboundReason === 'reminder') continue;
    const why = c.outboundReason === 'waitlist_opening' ? 'A time opened that they were waiting for' : c.outboundReason === 'virtual_consultation' ? 'Their consultation' : 'A call from the voice assistant';
    out.push({ at: c.startedAt || c.updatedAt, why, how: 'Call (voice assistant)', by: 'Voice assistant', result: /no_answer|voicemail|busy|dial_failed/.test(String(c.disconnectionReason || '')) ? 'No answer' : c.summary ? String(c.summary).slice(0, 120) : null, tone: null, source: 'call' });
  }
  return out.filter((i) => ms(i.at)).sort((a, b) => ms(b.at) - ms(a.at)).slice(0, limit);
}
