// src/lib/opportunities.ts — OPPORTUNITIES, phase 1 (design canvas sections 27–30). Rules find a client worth a
// personal word — a regular who's due, a first visit with nothing booked, someone long gone, a cancel or no-show that
// never rebooked, a quote waiting, a gift card sitting unused — and each becomes a TASK WITH A PURPOSE for the right
// person: why, roughly what it's worth (always an estimate), by when, the words to use, and what to do with the answer.
// Pure: the server (lib/opportunities-server) loads the records and saves what this decides.
//
// How it should sound (canvas Op14): warm and professional, from the person who does your nails. Hello first, details
// when they answer; no link in the first text (except a waitlist spot they asked for); urgency only when it's real; an easy way
// out; never the same words twice to one client. Every playbook has several approved versions for that reason.

import { nudgesFor } from '@/lib/checkout-nudges';
import { moduleEnabled, type ModuleId } from '@/lib/modules';

export type OppKind = 'due' | 'first_visit' | 'long_gone' | 'cancelled' | 'no_show' | 'no_rebook' | 'quote' | 'gift_card' | 'fill_gap' | 'renewal_failed' | 'unused_visits' | 'shop_reorder' | 'share_ask' | 'inquiry_waiting' | 'booth_lead' | 'booth_pass' | 'booth_lapsed' | 'academy_lead' | 'academy_stalled' | 'applicant_waiting' | 'manual' | 'follow_up' | 'membership_fit' | 'overtime_risk' | 'supply_overuse';
export type Who = 'provider' | 'desk' | 'owner';
export type OutcomeId = 'booked' | 'waitlist' | 'interested' | 'not_now' | 'price' | 'no_answer' | 'voicemail' | 'bad_experience' | 'stop' | 'declined' | 'quote_accepted' | 'no_longer_applies' | 'done';

export interface Branch { id: OutcomeId; say: string }
export interface Playbook {
  kind: OppKind; label: string; who: Who; marketing: boolean; priority: 'high' | 'medium' | 'low';
  expiresDays: number; cooldownDays: number; winBack: boolean;
  /** First message — several approved versions; a client never gets one they've had before. */
  versions: string[];
  /** What to say once they answer yes (times come second). */
  next: string;
  branches: Branch[];
  never: string;
  /** Sent automatically (no person waiting to answer, so a one-tap booking link goes in). Empty = person only. */
  auto?: string[];
  /** Automatic, asking first (no link): a yes gets two real times back, and a 1 or 2 books it. Used unless the business
   * switches this kind to "include the link". */
  ask?: string[];
  /** What the person says when an automatic text got no reply and it comes to them. */
  afterAuto?: string;
}

const B = (id: OutcomeId, say: string): Branch => ({ id, say });
const COMMON = (extra: Branch[] = []): Branch[] => [
  ...extra,
  B('not_now', '“Of course. I will leave it with you. Please text me whenever you are ready.”'),
  B('price', 'Give today’s price for their usual service — the one on your menu, nothing made up.'),
  B('no_answer', 'Leave it. One gentle follow-up at most; silence is an answer too.'),
  B('bad_experience', '“I am very sorry to hear that, and thank you for telling me. May I make it right?” Then stop selling: this opens a Making it right case.'),
  B('stop', '“Of course. You will not hear from us in this way again.” They come off every list.'),
];

export const PLAYBOOKS: Record<OppKind, Playbook> = {
  due: { kind: 'due', label: 'A regular who’s due', who: 'provider', marketing: true, priority: 'high', expiresDays: 14, cooldownDays: 45, winBack: true,
    versions: [
      'Hi {first}, this is {me}. I hope your nails are doing well. I have a few openings next week if you would like to come in. There is no rush at all.',
      'Hi {first}, this is {me}. It has been a little while since your last visit, and I wanted to check in. Would you like me to find you a time for your {service_short}?',
      'Hi {first}, this is {me}. I hope you are doing well. If you are due for your {service_short}, I would be glad to see you. Just let me know and I will send you a few times.',
    ],
    next: 'Offer two real times close to their usual day: “I have Thursday at 2:00 PM or Saturday at 10:00 AM. Which would suit you better?”',
    branches: COMMON([B('booked', '“Wonderful. Your appointment is confirmed, and you will receive a confirmation text shortly.”'), B('interested', '“Thank you. I will send you a few times shortly.” Follow up within a day.')]),
    auto: [
      'Hi {first}, this is {business}. You are due for your {service_short}. Whenever you are ready, you are welcome to book a time that suits you here: {link}',
      'Hi {first}, we hope you are well. If you would like to book your next {service_short}, you can choose a time here: {link}. There is no rush at all.',
    ],
    ask: [
      'Hi {first}, this is {business}. You are due for your {service_short} soon. Would you like us to find you a time? Just reply yes and we will send you a couple of options.',
      'Hi {first}, we hope you are well. Would you like us to reserve your next {service_short}? Reply yes and we will send you two times that suit your usual schedule.',
    ],
    afterAuto: 'Hi {first}, this is {me}. I am following up on our text from the other day. Would you like me to find you a time?',
    never: '“We miss you!” It is about us, not them.' },
  first_visit: { kind: 'first_visit', label: 'After a first visit', who: 'provider', marketing: false, priority: 'medium', expiresDays: 7, cooldownDays: 365, winBack: true,
    versions: [
      'Hi {first}, this is {me} from {business}. I wanted to check how your {service_short} is holding up. I hope you are enjoying it.',
      'Hi {first}, this is {me} from {business}. How is your {service_short} holding up after the first few days?',
    ],
    next: 'If they are happy with it: “I am so glad to hear that. Most clients come back about every {weeks} weeks, and I would be happy to reserve a time for you whenever you would like.”',
    branches: COMMON([B('booked', '“Wonderful. We look forward to seeing you then.”'), B('interested', '“Thank you. I will send you a few times.”')]),
    never: 'A discount on visit two; it teaches them to wait for one.' },
  long_gone: { kind: 'long_gone', label: 'Long gone', who: 'owner', marketing: true, priority: 'low', expiresDays: 21, cooldownDays: 150, winBack: true,
    versions: [
      'Hi {first}, this is {me} from {business}. It has been a while, and I wanted to say hello. If anything about your last visit was not right, I would sincerely like to know. Either way, we would be delighted to see you again.',
      'Hi {first}, this is {me} at {business}. I wanted to check in, as it has been a while. If there is anything we could have done better, I would truly appreciate hearing it.',
    ],
    next: 'Listen first. If they’d like to come back, offer two real times.',
    branches: COMMON([B('booked', '“We are so pleased you are coming back. We look forward to seeing you.”'), B('interested', '“Thank you. I will send you a few times.”')]),
    // Automatic (what the win-back “we miss you” reminder used to send), asking first by default.
    ask: [
      'Hi {first}, this is {business}. It has been a while, and we hope you are well. Would you like us to find you a time for your {service_short}? Just reply yes and we will send you a couple of options.',
      'Hi {first}, we hope all is well. Whenever you would like to come back in, reply yes and we will send you two times that suit you. If there is anything we could have done better, we would also like to hear it.',
    ],
    auto: [
      'Hi {first}, this is {business}. It has been a while, and we hope you are well. Whenever you would like to come back in, you are welcome to book a time here: {link}',
    ],
    afterAuto: 'Hi {first}, this is {me} from {business}. I wanted to follow up personally. If anything about your last visit was not right, I would sincerely like to know.',
    never: 'Guilt, or “it’s been forever!”' },
  cancelled: { kind: 'cancelled', label: 'Cancelled, never rebooked', who: 'desk', marketing: false, priority: 'high', expiresDays: 7, cooldownDays: 30, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. We are sorry we were not able to see you {when}. Would you like me to find you another time for your {service_short}?',
      'Hi {first}, this is {me} from {business}. Thank you for letting us know about {when}. Whenever you would like a new time, just let me know and I will arrange it.',
    ],
    next: 'Offer two times close to the one they lost.',
    branches: COMMON([B('booked', '“Thank you. Your appointment is confirmed, and you will receive a confirmation text shortly.”')]),
    auto: [
      'Hi {first}, this is {business}. We are sorry we were not able to see you {when}. Whenever you would like another time, you are welcome to book one here: {link}',
      'Hi {first}, thank you for letting us know about {when}. When you are ready for a new time, you can book one here: {link}',
    ],
    afterAuto: 'Hi {first}, this is {me} at {business}. I wanted to check whether you would like me to find you a new time.',
    never: 'Mentioning a fee that wasn’t charged.' },
  no_show: { kind: 'no_show', label: 'Missed appointment', who: 'desk', marketing: false, priority: 'medium', expiresDays: 7, cooldownDays: 30, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. We were not able to see you {when}, and I hope everything is all right. Would you like to find another time?',
      'Hi {first}, this is {me} from {business}. I wanted to check that you are well after {when}. I would be happy to rebook you whenever it suits you.',
    ],
    next: 'Rebook with a card hold if your policy asks for one.',
    branches: COMMON([B('booked', '“Thank you. Your appointment is confirmed, and we look forward to seeing you.”')]),
    never: 'Shame, or a discount.' },
  no_rebook: { kind: 'no_rebook', label: 'Didn’t rebook at checkout', who: 'provider', marketing: false, priority: 'medium', expiresDays: 7, cooldownDays: 30, winBack: true,
    versions: [
      'Hi {first}, this is {me}. It was lovely seeing you. We did not book your next appointment before you left. Would you like me to reserve a time for you in about {weeks} weeks?',
      'Hi {first}, this is {me}. Would you like me to reserve your usual time in {weeks} weeks, so you do not need to think about it?',
    ],
    next: 'Offer their usual day and time, about {weeks} weeks out.',
    branches: COMMON([B('booked', '“Your appointment is reserved. You will receive a reminder beforehand.”')]),
    auto: [
      'Hi {first}, thank you for coming in. When you would like your next {service_short}, about {weeks} weeks from now is usually ideal. You can book a time here: {link}',
      'Hi {first}, it was lovely seeing you. Whenever you would like to book your next appointment, you can do so here: {link}',
    ],
    ask: [
      'Hi {first}, thank you for coming in. Would you like us to reserve your next {service_short} in about {weeks} weeks? Just reply yes and we will send you a couple of times.',
      'Hi {first}, it was lovely seeing you. Would you like us to hold your usual time in about {weeks} weeks? Reply yes and we will send you two options.',
    ],
    afterAuto: 'Hi {first}, this is {me}. Would you like me to reserve your usual time in about {weeks} weeks, so you do not need to think about it?',
    never: 'A hold that doesn’t really release.' },
  quote: { kind: 'quote', label: 'A quote waiting', who: 'owner', marketing: false, priority: 'medium', expiresDays: 10, cooldownDays: 14, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. I wanted to make sure you received the quote. I am happy to answer any questions or make any changes.',
      'Hi {first}, this is {me} from {business}. Do you have any questions about the quote? I would be glad to adjust it to suit your needs.',
    ],
    next: 'Answer questions; if they’re ready, mark it accepted on the quote.',
    branches: COMMON([B('quote_accepted', '“Wonderful. I will get everything arranged.”'), B('declined', '“I completely understand. Thank you for considering us.”')]),
    auto: [
      'Hi {first}, this is {business}. We wanted to make sure you received your quote. Please reply with any questions, and we would be happy to adjust anything to suit your needs.',
    ],
    afterAuto: 'Hi {first}, this is {me} at {business}. I wanted to follow up on the quote personally. Is there anything I can change or answer for you?',
    never: 'Pressure to decide today.' },
  gift_card: { kind: 'gift_card', label: 'Gift card sitting unused', who: 'desk', marketing: false, priority: 'low', expiresDays: 21, cooldownDays: 180, winBack: false,
    versions: [
      'Hi {first}, please note that you still have {balance} on your {business} gift card. Whenever you would like to treat yourself, it is ready for you.',
      'Hi {first}, this is {me} at {business}. You have {balance} available on a gift card. There is no rush; it is yours whenever you would like to use it.',
    ],
    next: 'If they would like to use it, offer two times.',
    branches: COMMON([B('booked', '“Wonderful. The balance will be applied at checkout.”')]),
    auto: [
      'Hi {first}, please note that you still have {balance} on your {business} gift card. Whenever you would like to use it, you can book here: {link}',
      'Hi {first}, this is {business}. You have {balance} available on a gift card, and it is yours whenever you would like to use it. You can book here: {link}',
    ],
    never: '“Use it or lose it” unless it truly expires.' },
  fill_gap: { kind: 'fill_gap', label: 'Fill a gap', who: 'provider', marketing: true, priority: 'high', expiresDays: 2, cooldownDays: 14, winBack: false,
    versions: ['Hi {first}, this is {me}. A time has opened up {when} for your {service_short}. Would you like it?'],
    next: 'If they would like it, book the time that opened (Find two times shows it first).',
    branches: COMMON([B('booked', '“Wonderful. It is yours, and you will receive a confirmation shortly.”')]),
    // Sent only after the waitlist has had its turn; the first yes gets the time, and the others are closed.
    ask: ['Hi {first}, this is {business}. A time has opened up {when} with {provider} for your {service_short}. Would you like it? Just reply yes and it is yours.'],
    auto: ['Hi {first}, this is {business}. A time has opened up {when} with {provider} for your {service_short}. Would you like it? Just reply yes and it is yours.'],
    never: 'Pretending it is the last time available, or a discount to fill it.' },
  renewal_failed: { kind: 'renewal_failed', label: 'Membership payment didn’t go through', who: 'desk', marketing: false, priority: 'high', expiresDays: 14, cooldownDays: 30, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. Your membership payment did not go through this month. When you have a moment, you can update your card with the secure link we sent, or I am happy to help.',
      'Hi {first}, this is {me} from {business}. Just a note that your membership payment did not go through. The secure link we sent lets you update your card whenever it suits you.',
    ],
    next: 'Help them update their card through the secure link. Never take card numbers over the phone or by text.',
    branches: COMMON([B('done', 'Card updated, or they chose to pause or cancel. Mark it done.')]),
    never: 'Asking for card numbers, or sounding like a debt collector.' },
  unused_visits: { kind: 'unused_visits', label: 'Included visits not being used', who: 'provider', marketing: false, priority: 'medium', expiresDays: 14, cooldownDays: 45, winBack: true,
    versions: [
      'Hi {first}, this is {me}. You still have {left} included in your {plan}. Would you like me to find you a time?',
      'Hi {first}, this is {me}. I noticed you have {left} waiting in your {plan}. I would be glad to see you, so just let me know if you would like a time.',
    ],
    next: 'Offer two real times close to their usual day.',
    branches: COMMON([B('booked', '“Wonderful. Your appointment is confirmed.”'), B('interested', '“Thank you. I will send you a few times.”')]),
    ask: ['Hi {first}, this is {business}. You still have {left} included in your {plan}. Would you like us to find you a time? Just reply yes and we will send you a couple of options.'],
    auto: ['Hi {first}, this is {business}. You still have {left} included in your {plan}. Whenever you would like to use it, you can book a time here: {link}'],
    afterAuto: 'Hi {first}, this is {me}. I wanted to make sure you get the most from your {plan}. Would you like me to find you a time?',
    never: 'Making them feel guilty for not coming in.' },
  membership_fit: { kind: 'membership_fit', label: 'A membership would save them money', who: 'desk', marketing: true, priority: 'low', expiresDays: 14, cooldownDays: 120, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. Looking at your last few visits, our {plan} would have saved you about {saved}. Would you like me to tell you how it works? No pressure at all.',
      'Hi {first}, this is {me} from {business}. I noticed you come in often, and our {plan} would have cost you about {saved} less over the last three months. Happy to explain it if you are curious.',
    ],
    next: 'Explain what it includes and what it costs a month, with their own numbers. If they want it, sell it at their next visit or send the sign-up link.',
    branches: COMMON([B('interested', '“Lovely. I will add it at your next visit, or send you the sign-up link now if you prefer.”')]),
    never: 'Pressure, made-up deadlines, or suggesting it when it would not actually save them money.' },
  shop_reorder: { kind: 'shop_reorder', label: 'Time for more', who: 'desk', marketing: true, priority: 'low', expiresDays: 7, cooldownDays: 30, winBack: false,
    versions: ['Hi {first}, this is {me} at {business}. It has been about {weeks} weeks since your last {product}, so you may be running low. Would you like us to set one aside for you?'],
    next: 'Set one aside at the desk, or send them the link to order it.',
    branches: COMMON([B('done', 'Set aside, or they ordered it. Mark it done.')]),
    // From their own buying rhythm (shop orders and products bought at checkout). A yes goes to the desk to set one aside.
    ask: ['Hi {first}, this is {business}. It has been about {weeks} weeks since your last {product}, so you may be running low. Would you like us to set one aside for you? Just reply yes.'],
    auto: ['Hi {first}, this is {business}. It has been about {weeks} weeks since your last {product}, so you may be running low. You can order more here whenever it suits you: {link}'],
    never: 'Pressure, or saying it is about to sell out.' },
  inquiry_waiting: { kind: 'inquiry_waiting', label: 'An event inquiry without a quote', who: 'owner', marketing: false, priority: 'high', expiresDays: 7, cooldownDays: 14, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. Thank you for asking about your {occasion}. I am putting a few options together for you. Is {event_date} still the date you have in mind?',
      'Hi {first}, this is {me} from {business}. Thank you for your inquiry. Before I send your quote, could I ask a couple of quick questions about your {occasion}?',
    ],
    next: 'Confirm the date and guest count, then send the quote (Quotes → from this inquiry).',
    branches: COMMON([B('done', 'Quote sent, or they’ve gone elsewhere. Mark it done.')]),
    never: 'Letting a new inquiry wait more than a day without a word.' },
  booth_lead: { kind: 'booth_lead', label: 'A booth applicant waiting', who: 'owner', marketing: false, priority: 'high', expiresDays: 10, cooldownDays: 21, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. Thank you for your interest in renting with us. Would you like to come by to see the space and talk it through?',
      'Hi {first}, this is {me} from {business}. I wanted to follow up on your booth rental application. Do you have time for a quick chat this week?',
    ],
    next: 'Book a tour or a call, or decide on the application.',
    branches: COMMON([B('done', 'Toured, decided, or no longer interested. Mark it done.')]),
    never: 'Leaving an applicant without an answer.' },
  booth_pass: { kind: 'booth_pass', label: 'Booth days not being used', who: 'owner', marketing: false, priority: 'medium', expiresDays: 14, cooldownDays: 30, winBack: false,
    versions: ['Hi {first}, this is {me} at {business}. You still have {left} on your booth pass. Would you like me to hold a day for you?'],
    next: 'Offer a day or two that are open.',
    branches: COMMON([B('done', 'Booked a day, or not needed. Mark it done.')]),
    never: 'Making them feel they have wasted their money.' },
  booth_lapsed: { kind: 'booth_lapsed', label: 'A renter who stopped booking', who: 'owner', marketing: false, priority: 'medium', expiresDays: 14, cooldownDays: 60, winBack: false,
    versions: ['Hi {first}, this is {me} at {business}. We have missed having you here. Would you like to book a few days again? I am happy to find ones that suit you.'],
    next: 'Ask how things are going, and offer days that are open.',
    branches: COMMON([B('done', 'Booked again, or moved on. Mark it done.')]),
    never: 'Guilt, or pressure.' },
  academy_lead: { kind: 'academy_lead', label: 'A future student who hasn’t applied', who: 'owner', marketing: false, priority: 'high', expiresDays: 10, cooldownDays: 21, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. Thank you for your interest in {program}. Do you have any questions I can answer before you apply?',
      'Hi {first}, this is {me} from {business}. I wanted to follow up about {program}. Would a quick call or a visit help you decide?',
    ],
    next: 'Answer questions; invite them to a tour or to apply.',
    branches: COMMON([B('done', 'Applied, toured, or not going ahead. Mark it done.')]),
    never: 'Pressure, or promises about jobs or income.' },
  academy_stalled: { kind: 'academy_stalled', label: 'A student who has paused a course', who: 'owner', marketing: false, priority: 'medium', expiresDays: 14, cooldownDays: 30, winBack: false,
    versions: ['Hi {first}, this is {me} at {business}. I noticed you have not been back to {course} in a little while. Is there anything I can help with to get you going again?'],
    next: 'Ask what got in the way; offer help with the next lesson.',
    branches: COMMON([B('done', 'Back on track, or chose to stop. Mark it done.')]),
    never: 'Making them feel behind.' },
  applicant_waiting: { kind: 'applicant_waiting', label: 'A job applicant waiting', who: 'owner', marketing: false, priority: 'medium', expiresDays: 10, cooldownDays: 21, winBack: false,
    versions: [
      'Hi {first}, this is {me} at {business}. Thank you for applying. I wanted to let you know we have your application and will be in touch soon.',
      'Hi {first}, this is {me} from {business}. Thank you for your interest in joining us. Would you be available for a short conversation this week?',
    ],
    next: 'Reply to them, invite them to interview, or let them know kindly.',
    branches: COMMON([B('done', 'Replied, invited, or decided. Mark it done.')]),
    never: 'Silence: everyone who applies hears back.' },
  overtime_risk: { kind: 'overtime_risk', label: 'Scheduled into overtime', who: 'owner', marketing: false, priority: 'medium', expiresDays: 6, cooldownDays: 6, winBack: false,
    versions: ['Hi {first}, this is {me}. You are on the schedule for {hours} hours this week, which goes past {limit}. Would you like to swap or give away a shift, or is the extra time okay with you?'],
    next: 'Move or split a shift before the week runs over, or approve the overtime on purpose.',
    branches: COMMON([B('done', 'Schedule changed, or the overtime is approved. Mark it done.')]),
    never: 'Cutting someone’s hours without talking to them.' },
  supply_overuse: { kind: 'supply_overuse', label: 'Using more product than the recipe', who: 'owner', marketing: false, priority: 'low', expiresDays: 14, cooldownDays: 30, winBack: false,
    versions: ['Hi {first}, this is {me}. Quick one: on your last {visits} {product} services we used about {over} more {product_name} than the recipe says. Is the recipe out of date, or is something being wasted? No problem either way, I just want the numbers right.'],
    next: 'Ask, don’t accuse. Either update the service’s standard amount, or agree a way to use less (smaller pours, closing lids).',
    branches: COMMON([B('done', 'Recipe updated, or agreed a change. Mark it done.')]),
    never: 'Treating it as a disciplinary matter, or raising it in front of clients.' },
  share_ask: { kind: 'share_ask', label: 'Ask to share (they loved it)', who: 'provider', marketing: true, priority: 'low', expiresDays: 5, cooldownDays: 90, winBack: false,
    versions: ['Hi {first}, it was lovely to see you. If you know someone who would love it too, here is {gift} off their first visit, from you: {link}'],
    next: 'Nothing to do: the link does the rest.',
    branches: COMMON([B('done', 'Mark it done.')]),
    // Right after a visit they said they loved, only for clients who agreed to marketing texts, and only when the business
    // has referrals on. Their own referral link; the friend's gift and their reward come from Referrals settings.
    auto: ['Hi {first}! We are so glad you loved your visit. If you know someone who would love it too, here is {gift} off their first visit, from you: {link}'],
    never: 'Asking someone who wasn’t happy, or asking more than once in a few months.' },
  follow_up: { kind: 'follow_up', label: 'Follow-up', who: 'provider', marketing: false, priority: 'medium', expiresDays: 10, cooldownDays: 0, winBack: false,
    versions: ['Hi {first}, this is {me} again. I wanted to follow up, with no pressure at all.'],
    next: 'Pick up where you left off.',
    branches: COMMON([B('booked', '“Your appointment is confirmed.”'), B('done', 'Mark it done.')]),
    never: 'More than one follow-up.' },
  manual: { kind: 'manual', label: 'Task', who: 'desk', marketing: false, priority: 'medium', expiresDays: 14, cooldownDays: 0, winBack: false,
    versions: [''], next: '', branches: [B('done', 'Mark it done when it’s finished.'), B('booked', 'Booked.'), B('no_answer', 'Try again later.')], never: '' },
};

export const OUTCOMES: Record<OutcomeId, { label: string; tone: 'good' | 'neutral' | 'bad'; closes: boolean; followUpDays?: number }> = {
  booked: { label: 'Booked', tone: 'good', closes: true },
  waitlist: { label: 'On the waitlist', tone: 'good', closes: true },
  quote_accepted: { label: 'Quote accepted', tone: 'good', closes: true },
  interested: { label: 'Interested', tone: 'good', closes: true, followUpDays: 1 },
  not_now: { label: 'Not now', tone: 'neutral', closes: true, followUpDays: 21 },
  price: { label: 'Asked about price', tone: 'neutral', closes: false },
  no_answer: { label: 'No answer', tone: 'neutral', closes: false },
  voicemail: { label: 'Left a voicemail', tone: 'neutral', closes: false },
  declined: { label: 'Not interested', tone: 'neutral', closes: true },
  bad_experience: { label: 'Bad experience', tone: 'bad', closes: true },
  stop: { label: 'Stop contacting me', tone: 'bad', closes: true },
  no_longer_applies: { label: 'No longer applies', tone: 'neutral', closes: true },
  done: { label: 'Done', tone: 'good', closes: true },
};
export const MAX_TRIES = 3;

export type Mode = 'off' | 'auto' | 'person' | 'auto_then_person';
export const MODE_LABEL: Record<Mode, string> = { off: 'Off', auto: 'Send it automatically', person: 'Give it to a person', auto_then_person: 'Automatic, then a person' };
/** The starting choice for each kind (canvas, section 31 follow-up): automatic where a friendly text is enough, a person
 * where the personal touch is the point, and "automatic, then a person" where a person only helps if there's no reply. */
export const DEFAULT_MODES: Record<string, Mode> = { membership_fit: 'off', overtime_risk: 'person', supply_overuse: 'person', share_ask: 'auto', shop_reorder: 'auto', fill_gap: 'auto', renewal_failed: 'person', unused_visits: 'auto_then_person', due: 'auto_then_person', no_rebook: 'auto_then_person', cancelled: 'auto', gift_card: 'auto', quote: 'auto_then_person', first_visit: 'person', long_gone: 'person', no_show: 'person' };
export const modesFor = (k: OppKind): Mode[] => (k === 'fill_gap' || k === 'share_ask' ? ['off', 'auto'] : PLAYBOOKS[k].auto?.length ? ['off', 'auto', 'auto_then_person', 'person'] : ['off', 'person']);
export interface OppSettings { bonus: { on: boolean; cents: number; capCents: number }; linkFirst: Record<string, boolean>; on: boolean; finders: Record<string, boolean>; modes: Record<string, Mode>; afterDays: number; perPersonPerDay: number; holdoutPct: number; paceMin: number; paceDays: number; windows: Record<Tool, number>; solo: { mode: 'auto' | 'on' | 'off'; hour: number; max: number }; renters: boolean }

// ── Which tool each kind belongs to ─────────────────────────────────────────────────────────
// One engine for every tool. A kind whose tool the business doesn't have is off, whatever its setting says.
export type Tool = 'appointments' | 'quotes' | 'gift_cards' | 'memberships' | 'shop' | 'booths' | 'academy' | 'hiring' | 'calls';
export const TOOL_OF: Record<OppKind, Tool> = { share_ask: 'appointments', inquiry_waiting: 'quotes', booth_lead: 'booths', booth_pass: 'booths', booth_lapsed: 'booths', academy_lead: 'academy', academy_stalled: 'academy', applicant_waiting: 'hiring', shop_reorder: 'shop', fill_gap: 'appointments', renewal_failed: 'memberships', unused_visits: 'memberships', membership_fit: 'memberships', overtime_risk: 'hiring', supply_overuse: 'appointments', due: 'appointments', first_visit: 'appointments', long_gone: 'appointments', cancelled: 'appointments', no_show: 'appointments', no_rebook: 'appointments', quote: 'quotes', gift_card: 'gift_cards', follow_up: 'appointments', manual: 'appointments' };
const TOOL_GATE: Partial<Record<Tool, ModuleId>> = { quotes: 'classes_events', memberships: 'memberships', shop: 'retail', booths: 'booth_rental', academy: 'academy', hiring: 'team', calls: 'voice' };
export const toolOn = (tenant: any, tool: Tool) => { const g = TOOL_GATE[tool]; return !g || moduleEnabled(tenant, g); };

// How long after we reach out a booking they make on their own still counts as influenced (decided Oct 13): 14 days,
// longer for bigger decisions, shorter for the shop. Each business can set 7–30 days per tool.
export const WINDOW_DAYS: Record<Tool, number> = { appointments: 14, gift_cards: 14, quotes: 30, memberships: 30, shop: 7, booths: 30, academy: 30, hiring: 14, calls: 14 };

// ── Room on the schedule ────────────────────────────────────────────────────────────────────
// Win-back only makes sense when there is time to see the client. When a provider's next few weeks are nearly full,
// these kinds wait (they're found again the next day); recovering a lost visit, quotes and first-visit check-ins always go.
export const PACED: OppKind[] = ['due', 'long_gone', 'no_rebook', 'gift_card', 'unused_visits'];
/** Share of each provider's bookable start times still open over the next `days` days (0–1), worked out once a day. */
export interface Pace { day: string; days: number; byStaff: Record<string, { share: number; name?: string }>; business: number | null; held?: Record<string, number> }
export function heldForRoom(kind: OppKind, providerId: string | null, pace: Pace | null | undefined, S: OppSettings): boolean {
  if (!S.paceMin || !pace || !PACED.includes(kind)) return false;
  const share = providerId && pace.byStaff?.[providerId] ? pace.byStaff[providerId].share : pace.business;
  return typeof share === 'number' && share * 100 < S.paceMin;
}
export const FINDER_KINDS: OppKind[] = ['due', 'first_visit', 'no_rebook', 'cancelled', 'no_show', 'long_gone', 'fill_gap', 'share_ask', 'renewal_failed', 'unused_visits', 'membership_fit', 'shop_reorder', 'quote', 'inquiry_waiting', 'gift_card', 'booth_lead', 'booth_pass', 'booth_lapsed', 'academy_lead', 'academy_stalled', 'applicant_waiting', 'overtime_risk', 'supply_overuse'];
// ── A business's own wording (Opportunities → Finders → Your wording) ─────────────────────────────
// Managers can write their own versions of any message. They're used only once the owner has approved them (an owner's
// own edits are approved as they save); until then the approved wording above keeps going out. The rules that make a
// first text feel human still apply: hello and their name first, no link in a person's or an ask-first message.
export interface Wording { versions?: string[]; ask?: string[]; auto?: string[]; approvedAt?: string | null; approvedBy?: string | null; pending?: { versions?: string[]; ask?: string[]; auto?: string[]; by: string; at: string } | null }
const LINK_RE = /https?:\/\/|www\.|\{link\}/i;
/** Tidies and checks one set of wording. Returns the problems in plain words. */
export function checkWording(kind: OppKind, w: { versions?: any; ask?: any; auto?: any }): { clean: { versions: string[]; ask: string[]; auto: string[] }; problems: string[] } {
  const list = (a: any) => (Array.isArray(a) ? a : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
  const clean = { versions: list(w.versions), ask: list(w.ask), auto: list(w.auto) }; const problems: string[] = []; const pb = PLAYBOOKS[kind];
  for (const [set, label] of [[clean.versions, 'A person’s message'], [clean.ask, 'The ask-first text'], [clean.auto, 'The automatic text']] as [string[], string][]) for (const v of set) {
    if (v.length > 320) problems.push(`${label} is too long for one text (keep it under 320 characters).`);
    if (!/\{first\}/.test(v) && pb?.who !== 'owner') problems.push(`${label} should greet them by name: put {first} where their first name goes.`);
    if (set !== clean.auto && LINK_RE.test(v)) problems.push(`${label} can’t carry a link: a link comes once they say yes.`); }
  if (clean.auto.length && pb?.auto?.length && !clean.auto.some((v) => /\{link\}/.test(v))) problems.push('The automatic text needs {link} where the booking link goes.');
  return { clean, problems: Array.from(new Set(problems)) };
}
/** The playbook with the business's approved wording in place of ours (where it has any). */
export function playbookFor(tenant: any, kind: OppKind): Playbook {
  const pb = PLAYBOOKS[kind]; const w: Wording | undefined = tenant?.opportunities?.wording?.[kind]; if (!pb || !w?.approvedAt) return pb;
  return { ...pb, versions: w.versions?.length ? w.versions : pb.versions, ...(pb.ask?.length ? { ask: w.ask?.length ? w.ask : pb.ask } : {}), ...(pb.auto?.length ? { auto: w.auto?.length ? w.auto : pb.auto } : {}) };
}
export function oppSettingsOf(tenant: any): OppSettings {
  const o = tenant?.opportunities || {}; const f = o.finders || {};
  const n = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
  const m = o.modes || {};
  // Win-back reminders (Settings → Messages → Win-back) now run here. A business that had them on keeps them, as the
  // automatic mode of Due and Long gone, until it chooses something else.
  const rc = tenant?.reconnect || {}; const carried: Record<string, Mode> = {};
  if (rc.enabled === true) { carried.due = rc.dueEnabled === false ? 'off' : 'auto_then_person'; carried.long_gone = rc.missEnabled === false ? 'person' : 'auto_then_person'; }
  const modes: Record<string, Mode> = Object.fromEntries(FINDER_KINDS.map((k) => { let v: Mode = modesFor(k).includes(m[k]) ? m[k] : carried[k] || DEFAULT_MODES[k] || 'person'; if ((f[k] === false && !modesFor(k).includes(m[k])) || !toolOn(tenant, TOOL_OF[k]) || (k === 'share_ask' && tenant?.referrals?.on !== true)) v = 'off'; return [k, v]; }));
  const lf = o.linkFirst || {};
  const linkFirst = Object.fromEntries(FINDER_KINDS.map((k) => [k, k === 'fill_gap' ? false : typeof lf[k] === 'boolean' ? lf[k] : k === 'shop_reorder' || !PLAYBOOKS[k].ask?.length]));
  const bo = o.bonus || {};
  const bonus = { on: bo.on === true, cents: n(bo.cents, 0, 10000, 500), capCents: n(bo.capCents, 0, 500000, 0) };   // off by default; cap 0 = no cap
  return { bonus, linkFirst, on: o.on !== false, finders: Object.fromEntries(FINDER_KINDS.map((k) => [k, modes[k] !== 'off'])), modes, afterDays: n(o.afterDays, 1, 14, 3), perPersonPerDay: n(o.perPersonPerDay, 1, 30, 5), holdoutPct: n(o.holdoutPct, 0, 30, 10), paceMin: n(o.paceMin, 0, 50, 10), paceDays: n(o.paceDays, 7, 42, 21),
    windows: Object.fromEntries((Object.keys(WINDOW_DAYS) as Tool[]).map((k) => [k, n(o.windows?.[k], 7, 30, WINDOW_DAYS[k])])) as Record<Tool, number>,
    solo: { mode: ['on', 'off'].includes(o.solo?.mode) ? o.solo.mode : 'auto', hour: n(o.solo?.hour, 7, 21, 18), max: n(o.solo?.max, 1, 10, 3) },
    renters: o.renters === true && toolOn(tenant, 'booths') };   // renters' own follow-ups: the business chooses (off unless switched on)
}

// ── Solo (decided Oct 13; design canvas OE4) ───────────────────────────────────────────────────
// One person, no desk: what would go to a person becomes a short list of ready-to-send messages at a time they choose
// (6 PM by default), at most 3 a day, nobody held back for comparison until there's enough to compare, and one bell
// when the list is ready instead of one per task. "Auto" means: on whenever only one person on the team uses the app.
export const SOLO_COMPARE_AFTER = 150;   // contacted in the last 120 days before a left-alone group is worth having
export function isSolo(staff: any[], S: OppSettings): boolean {
  if (S.solo.mode !== 'auto') return S.solo.mode === 'on';
  return staff.filter((m: any) => !m.archived && m.isActive !== false && m.role !== 'renter' && !m.isRenter && m.appAccess !== 'off').length <= 1;
}
/** The settings as they apply today: solo caps the day and skips the left-alone group while numbers are small. */
// Renters' own (decided Oct 13): when the business allows it, a renter can switch on follow-ups for their own clients —
// always the solo way (a short list of drafts, from them, under their business name). Their win-back texts stay in their
// own Reconnect settings; this is the person side. The studio never sees these tasks.
export const RENTER_KINDS: OppKind[] = ['first_visit', 'no_rebook', 'cancelled', 'no_show', 'due', 'long_gone'];
export interface RenterOpp { on: boolean; hour: number; max: number }
export function renterOppOf(raw: any): RenterOpp { const n = (v: any, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
  return { on: raw?.on === true, hour: n(raw?.hour, 7, 21, 18), max: n(raw?.max, 1, 10, 3) }; }
/** The renter's own settings as the engine uses them: their kinds only, each with a person (them), nobody held back. */
export function renterSettings(S: OppSettings, r: RenterOpp): OppSettings {
  const modes = Object.fromEntries(FINDER_KINDS.map((k) => [k, RENTER_KINDS.includes(k) ? 'person' : 'off'])) as Record<string, Mode>;
  return { ...S, on: r.on, modes, finders: Object.fromEntries(FINDER_KINDS.map((k) => [k, modes[k] !== 'off'])), perPersonPerDay: r.max, holdoutPct: 0, solo: { mode: 'on', hour: r.hour, max: r.max } };
}
export function soloAdjust(S: OppSettings, solo: boolean, contacted: number): OppSettings {
  if (!solo) return S;
  return { ...S, perPersonPerDay: Math.min(S.perPersonPerDay, S.solo.max), holdoutPct: contacted < SOLO_COMPARE_AFTER ? 0 : S.holdoutPct };
}

// ── Reading a client's history ──────────────────────────────────────────────────────────────
const DAY = 864e5;
export const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : Number(v) || 0);
const DONE = ['completed', 'checked_out', 'paid'];
const DEAD = ['cancelled', 'canceled', 'no_show', 'noshow', 'declined', 'expired', 'rejected'];
const isCancel = (s: any) => ['cancelled', 'canceled'].includes(String(s || ''));
const isNoShow = (s: any) => ['no_show', 'noshow'].includes(String(s || ''));
const money = (a: any) => Number(a?.revenue ?? a?.totalPrice ?? a?.price ?? 0) || 0;

export interface History { clientId: string; visits: any[]; last: any | null; upcoming: any | null; gapDays: number | null; avg: number; lastAny: any | null }
export function historyOf(appts: any[], now: number): Map<string, History> {
  const by = new Map<string, any[]>();
  for (const a of appts) { const c = String(a.clientId || ''); if (!c) continue; (by.get(c) || by.set(c, []).get(c)!).push(a); }
  const out = new Map<string, History>();
  for (const [clientId, list] of by) {
    const sorted = [...list].sort((a, b) => ms(a.startTime) - ms(b.startTime));
    const visits = sorted.filter((a) => DONE.includes(String(a.status || '')) && ms(a.startTime) <= now);
    const upcoming = sorted.find((a) => ms(a.startTime) > now && !DEAD.includes(String(a.status || ''))) || null;
    const gaps: number[] = []; for (let i = 1; i < visits.length; i++) gaps.push((ms(visits[i].startTime) - ms(visits[i - 1].startTime)) / DAY);
    const med = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
    const recent = visits.slice(-5); const avg = recent.length ? recent.reduce((s, a) => s + money(a), 0) / recent.length : 0;
    const past = sorted.filter((a) => ms(a.startTime) <= now);
    out.set(clientId, { clientId, visits, last: visits[visits.length - 1] || null, upcoming, gapDays: med !== null && med >= 5 && med <= 120 ? Math.round(med) : null, avg: Math.round(avg * 100) / 100, lastAny: past[past.length - 1] || null });
  }
  return out;
}

export interface Candidate { kind: OppKind; tool: Tool; subject: { type: 'client' | 'contact'; id: string | null }; key: string; clientId: string | null; clientName: string; why: string; valueCents: number; valueNote?: string; providerId: string | null; dueAt: string; expiresAt: string; refs: Record<string, string>; facts: Record<string, string> }

const firstName = (c: any) => String(c?.firstName || String(c?.name || c?.clientName || '').split(' ')[0] || '').trim() || 'there';
const shortService = (n: any) => { const s = String(n || '').trim(); if (!s) return 'nails'; const l = s.toLowerCase();
  if (/gel/.test(l) && /fill/.test(l)) return 'gel fill'; if (/pedi/.test(l)) return 'pedicure'; if (/mani/.test(l)) return 'manicure'; return l.length > 28 ? 'last service' : l; };
const day = (n: number) => `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`;
const weeksOf = (g: number | null) => (g ? Math.max(1, Math.round(g / 7)) : 4);
const whenWord = (t: number, now: number, tz?: string) => { const d = Math.round((now - t) / DAY); if (d <= 1) return 'yesterday'; return new Date(t).toLocaleDateString('en-US', { weekday: 'long', ...(tz ? { timeZone: tz } : {}) }) + (d < 7 ? '' : ''); };

/** The rules. Returns everything that qualifies today; the server drops what's already open, cooling down or opted out.
 * `fresh`: called the moment something happened (a cancellation, a no-show, a checkout), so those kinds qualify the
 * same day; the server decides when the client actually hears from us. */
export function findCandidates(x: { clients: any[]; appointments: any[]; quotes: any[]; giftCards: any[]; services?: any[]; memberships?: any[]; purchases?: Purchase[]; biz?: Biz; settings: OppSettings; now: number; tz?: string; renterStaffIds?: Set<string>; fresh?: boolean; renterOnly?: string }): Candidate[] {
  const { now, settings: S } = x; const minAge = x.fresh ? 0 : 1; const iso = (t: number) => new Date(t).toISOString();
  const renter = x.renterStaffIds || new Set<string>();
  const appts = x.renterOnly ? x.appointments.filter((a) => String(a.staffId || '') === x.renterOnly && !a.isWalkIn) : x.appointments.filter((a) => !a.isRenterBooking && !renter.has(String(a.staffId || '')) && !a.isWalkIn);
  const H = historyOf(appts, now); const clients = new Map(x.clients.map((c) => [String(c.id), c]));
  const out: Candidate[] = [];
  const add = (kind: OppKind, c: any, h: History | null, why: string, valueCents: number, extra: Partial<Candidate> = {}) => {
    const pb = PLAYBOOKS[kind];
    out.push({ kind, tool: TOOL_OF[kind], subject: { type: c?.id ? 'client' : 'contact', id: c?.id ? String(c.id) : null }, key: `${kind}:${extra.refs?.quoteId || extra.refs?.giftCardId || extra.refs?.appointmentId || c?.id}`, clientId: c?.id ? String(c.id) : null, clientName: String(c?.name || [c?.firstName, c?.lastName].filter(Boolean).join(' ') || 'Client').slice(0, 120),
      why, valueCents: Math.max(0, Math.round(valueCents)), providerId: h?.last?.staffId ? String(h.last.staffId) : null, dueAt: iso(now), expiresAt: iso(now + pb.expiresDays * DAY), refs: {},
      facts: { first: firstName(c), service_short: shortService(h?.last?.serviceName), weeks: String(weeksOf(h?.gapDays ?? null)), ...(c?.phone ? { phone: String(c.phone) } : {}) }, ...extra } as Candidate);
  };
  // Memberships and packages (tool: memberships), for every client, booked or not, with or without past visits here.
  // A payment that didn't go through comes first: it's a service to the client, not a sale.
  const taken = new Set<string>();
  for (const c of x.clients) {
    if (!c?.id || c.archived || c.deleted) continue; const cid = String(c.id); const h = H.get(cid) || null; const sub = c.subscription || {};
    const due = ms(sub.pastDueSince); const cardAt = ms(c.cardOnFile?.savedAt);
    if (S.finders.renewal_failed && sub.status === 'past_due' && due && now - due >= 3 * DAY && !(cardAt > due)) {
      add('renewal_failed', c, h, `Membership payment didn’t go through ${day((now - due) / DAY)} ago, and no new card yet`, (Number(sub.price) || 0) * 100, { refs: { membershipId: String(sub.membershipId || c.activeMembershipId || '') }, providerId: null });
      out[out.length - 1].facts.plan = 'membership'; taken.add(cid); continue; }
    if (!S.finders.unused_visits || h?.upcoming) continue;
    const lastVisitAgo = h?.last ? (now - ms(h.last.startTime)) / DAY : Infinity;
    const pk = (Array.isArray(c.activePackages) ? c.activePackages : []).filter((p: any) => Number(p.sessionsRemaining) > 0);
    const joined = ms(sub.startedAt || sub.createdAt || sub.startDate);
    const member = sub.status === 'active' && !!c.activeMembershipId && joined > 0 && now - joined > 30 * DAY;
    const pkOld = pk.length && now - ms(pk[0].purchasedAt) > 30 * DAY;
    if ((member && lastVisitAgo >= 45) || (pkOld && lastVisitAgo >= 60)) {
      const usePk = !member; const nLeft = Number(pk[0]?.sessionsRemaining) || 0;
      const left = usePk ? `${nLeft} visit${nLeft === 1 ? '' : 's'}` : 'visits';
      const ago = Number.isFinite(lastVisitAgo) ? `no visit in ${Math.round(lastVisitAgo)} days` : 'no visit yet';
      add('unused_visits', c, h, usePk ? `${left} left on a package, ${ago}` : `Member, ${ago}`, (h?.avg || 0) * 100);
      const f = out[out.length - 1].facts; f.left = left; f.plan = usePk ? String(pk[0].name || 'package') : 'membership'; taken.add(cid); }
  }
  // Visits paid (at least partly) with a gift card someone else bought for the client.
  const gifted = new Set<string>(); for (const g of x.giftCards || []) { if (!g || g.promo || !g.recipientId || (g.purchaserId && g.purchaserId === g.recipientId)) continue;
    for (const e of g.history || []) if (e?.type === 'spend' && e.appointmentId) gifted.add(String(e.appointmentId)); }
  for (const [cid, h] of H) {
    const c = clients.get(cid); if (!c || c.archived || c.deleted) continue;
    const since = h.last ? (now - ms(h.last.startTime)) / DAY : null; const g = h.gapDays; const n = h.visits.length;
    // They said they loved their last visit (1 to 7 days ago): the moment to ask them to share (lib/referrals).
    if (S.finders.share_ask && h.last?.feedback?.rating === 'loved' && c.smsMarketingOptIn === true && !c.marketingOptOut && !taken.has(cid)) {
      const d = (now - ms(h.last.feedback.at || h.last.startTime)) / DAY;
      if (d >= 1 && d <= 7) { add('share_ask', c, h, `Said they loved their ${h.last.serviceName || 'visit'} ${day(d)} ago`, 0, { key: `share_ask:${cid}` }); continue; }
    }
    if (h.upcoming) continue;
    if (taken.has(cid)) continue;
    const la = h.lastAny; const laT = la ? ms(la.startTime) : 0;
    // A cancel or no-show that's the most recent thing, and never rebooked.
    if (la && isCancel(la.status) && S.finders.cancelled) { const at = ms(la.cancelledAt) || ms(la.updatedAt) || laT; const d = (now - at) / DAY;
      if (d >= minAge && d <= 7) { add('cancelled', c, h, `Cancelled ${la.serviceName || 'their visit'} ${day(d)} ago and hasn’t rebooked`, money(la) * 100, { refs: { appointmentId: String(la.id) }, providerId: la.staffId ? String(la.staffId) : null }); out[out.length - 1].facts.when = whenWord(laT, now, x.tz); continue; } }
    if (la && isNoShow(la.status) && S.finders.no_show) { const d = (now - laT) / DAY;
      if (d >= minAge && d <= 7) { add('no_show', c, h, `Missed ${la.serviceName || 'their visit'} ${day(d)} ago — nothing booked since`, money(la) * 100, { refs: { appointmentId: String(la.id) }, providerId: la.staffId ? String(la.staffId) : null }); out[out.length - 1].facts.when = whenWord(laT, now, x.tz); continue; } }
    if (since === null) continue;
    // A first visit paid with a gift someone gave them: when that service is usually due again, ask if they'd like another
    // (the service's own rebook weeks, else 5 weeks). Counts as "due" (same switch, same wording).
    if (n === 1 && S.finders.due && gifted.has(String(h.last.id))) { const sv = (x.services || []).find((v: any) => v.id === h.last.serviceId); const w = Math.max(2, Math.min(26, Math.round(Number(sv?.rebookWeeks) || 5)));
      if (since >= w * 7 && since <= w * 7 + 21) { add('due', c, h, `First visit was a gift (${h.last.serviceName || 'a service'}), ${day(since)} ago — that service is usually every ${w} weeks`, h.avg * 100); out[out.length - 1].facts.weeks = String(w); continue; } }
    if (n === 1 && since >= 3 && since <= 10 && S.finders.first_visit) { add('first_visit', c, h, `First visit ${day(since)} ago (${h.last.serviceName || 'a service'}) — nothing booked yet`, h.avg * 100); continue; }
    // They said “not now” to booking their next visit in person (client screen or checkout): no rebooking texts that week.
    const saidNo = ms(c.nudgeDeclines?.rebook) > 0 && now - ms(c.nudgeDeclines?.rebook) < 7 * DAY;
    if (!saidNo && n >= 2 && since >= minAge && since <= 3 && S.finders.no_rebook) { add('no_rebook', c, h, `Came in ${day(since)} ago and left without a next visit${g ? ` (usually every ${weeksOf(g)} weeks)` : ''}`, h.avg * 100); continue; }
    if (!saidNo && n >= 2 && g && since >= Math.max(g * 1.5, g + 7) && since < Math.max(g * 3, 90) && S.finders.due) { add('due', c, h, `${day(since)} since their ${h.last.serviceName || 'last visit'} — usually every ${weeksOf(g)} weeks`, h.avg * 100); continue; }
    const longAfter = Math.max(g ? g * 3 : 90, 90);
    if (since >= longAfter && since <= 365 && S.finders.long_gone) { add('long_gone', c, h, `Last visit ${Math.round(since / 30)} months ago${n > 1 ? ` — came ${n} times before` : ''}`, h.avg * 100); continue; }
  }
  // Memberships (tool: memberships): a regular whose last 3 months would have cost less on a monthly plan (the same honest
  // maths as the checkout suggestion, lib/checkout-nudges). Off unless the business turns it on, since it's selling.
  if (S.finders.membership_fit && (x.memberships || []).length) {
    const have = new Set(out.map((o) => o.clientId));
    for (const [cid, h] of H) { const c = clients.get(cid); if (!c || c.archived || c.deleted || have.has(cid) || c.activeMembershipId || c.subscription?.status === 'active') continue;
      if (c.marketingOptOut || (!c.smsMarketingOptIn && !c.emailMarketingOptIn)) continue;
      const visits = h.visits.map((v: any) => ({ serviceId: String(v.serviceId || ''), startTime: String(v.startTime), price: Number(v.price) || 0 })).filter((v) => v.serviceId);
      if (visits.filter((v) => now - ms(v.startTime) <= 90 * DAY).length < 2) continue;
      const best = nudgesFor({ client: c, visits, upcoming: 0, memberships: x.memberships || [], packages: [], services: x.services || [], settings: { membership: true, package: false, rebook: false, quietDays: 60, max: 1 }, now })[0];
      if (!best?.item) continue;
      add('membership_fit', c, h, best.title, Math.round(Number(best.item.price) * 100 * 6), { key: `membership_fit:${cid}`, refs: { membershipId: best.item.id }, providerId: null });
      const f = out[out.length - 1].facts; f.plan = best.item.name; f.saved = `$${Math.round(best.value * 3)}`; have.add(cid); }
  }
  // The shop (tool: shop): something a client buys again and again, and it's about the time they usually run out.
  if (S.finders.shop_reorder && x.purchases?.length) {
    const have = new Set(out.map((o) => o.clientId));
    for (const r of reorderDue(x.purchases, now)) {
      if (have.has(r.clientId)) continue; const c = clients.get(r.clientId); if (!c || c.archived || c.deleted) continue;
      const up = H.get(r.clientId)?.upcoming; if (up && ms(up.startTime) - now < 14 * DAY) continue;   // they'll be in soon: the visit itself shows it
      add('shop_reorder', c, H.get(r.clientId) || null, `Buys ${r.name} about every ${r.weeks} weeks; last one ${r.sinceWeeks} weeks ago`, r.priceCents, { key: `shop_reorder:${r.clientId}:${r.productId}`, refs: { productId: r.productId }, providerId: null });
      const f = out[out.length - 1].facts; f.product = r.name; f.weeks = String(r.sinceWeeks); have.add(r.clientId);
    }
  }
  if (x.biz) out.push(...bizCandidates(x.biz, S, now, x.tz));
  if (S.finders.quote) for (const q of x.quotes) {
    if (!['sent', 'viewed'].includes(String(q.status || '')) || q.convertedToEventId) continue;
    const sent = ms(q.sentAt); if (!sent) continue; const d = (now - sent) / DAY; const exp = q.expiresInDays ? sent + Number(q.expiresInDays) * DAY : Infinity;
    if (d < 3 || exp <= now) continue;
    const total = quoteTotal(q); const c = clients.get(String(q.clientId || '')) || { id: q.clientId || null, name: q.clientName || q.contactName || 'Client', phone: q.clientPhone || q.phone, email: q.clientEmail || q.email };
    add('quote', c, null, `Quote${q.title ? ` “${String(q.title).slice(0, 60)}”` : ''} sent ${day(d)} ago${q.viewedAt ? ', opened' : ', not opened yet'}`, total * 100, { refs: { quoteId: String(q.id) }, expiresAt: iso(Math.min(exp, now + 10 * DAY)), providerId: q.createdByStaffId || null });
  }
  if (S.finders.gift_card) for (const gc of x.giftCards) {
    if (gc.status !== 'active' || !(Number(gc.balanceCents) > 0) || gc.promo || gc.ownerRenterId) continue;
    const last = ms(gc.lastUsedAt) || ms(gc.createdAt); if (!last || now - last < 60 * DAY) continue;
    const rid = gc.recipient?.id || gc.recipientClientId || null; const c = (rid && clients.get(String(rid))) || (gc.recipient?.phone || gc.recipient?.email ? { id: rid, name: gc.recipient?.name || 'Gift card holder', phone: gc.recipient?.phone, email: gc.recipient?.email } : null);
    if (!c) continue;
    add('gift_card', c, null, `${dollars(gc.balanceCents)} unused on a gift card since ${new Date(last).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`, Number(gc.balanceCents), { refs: { giftCardId: String(gc.id) }, valueNote: 'their balance' });
    out[out.length - 1].facts.balance = dollars(gc.balanceCents);
  }
  return out;
}

export const quoteTotal = (q: any) => { const sub = (q.lineItems || []).reduce((a: number, i: any) => a + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0); return Math.round((sub + (Number(q.travelExpenses) || 0) + sub * ((Number(q.projectFee) || 0) / 100)) * 100) / 100; };
export const dollars = (cents: number) => { const d = (Number(cents) || 0) / 100; return `$${d % 1 ? d.toFixed(2) : d.toLocaleString('en-US')}`; };

/** Keep only what should become a task: one open task per client, cooldowns, opt-outs, open cases. */
/** The rest of the business (step 6, round 3): records about people who aren't clients yet, or aren't clients at all. */
export interface Biz { team?: any[]; shifts?: any[]; overtimeHours?: number; usage?: any[]; products?: any[]; inquiries?: any[]; boothApps?: any[]; boothPasses?: any[]; boothBookings?: any[]; admissions?: any[]; enrollments?: any[]; applications?: any[]; invites?: any[] }
const LIVE_RES = ['confirmed', 'checked_in', 'completed', 'pending_payment'];
export const BIZ_KINDS: OppKind[] = ['inquiry_waiting', 'booth_lead', 'booth_pass', 'booth_lapsed', 'academy_lead', 'academy_stalled', 'applicant_waiting', 'overtime_risk', 'supply_overuse'];
export function bizCandidates(b: Biz, S: OppSettings, now: number, tz?: string): Candidate[] {
  const out: Candidate[] = []; const iso = (t: number) => new Date(t).toISOString(); const ago = (v: any) => (ms(v) ? (now - ms(v)) / DAY : null);
  const push = (kind: OppKind, id: string, p: { name?: any; phone?: any; email?: any; clientId?: any }, why: string, facts: Record<string, string> = {}, valueCents = 0, refs: Record<string, string> = {}) => {
    const name = String(p.name || 'Someone').trim().slice(0, 120);
    out.push({ kind, tool: TOOL_OF[kind], subject: { type: p.clientId ? 'client' : 'contact', id: p.clientId ? String(p.clientId) : null }, key: `${kind}:${id}`, clientId: p.clientId ? String(p.clientId) : null, clientName: name,
      why, valueCents: Math.max(0, Math.round(valueCents)), providerId: null, dueAt: iso(now), expiresAt: iso(now + PLAYBOOKS[kind].expiresDays * DAY), refs: { sourceId: id, ...refs },
      facts: { first: name.split(/\s+/)[0] || 'there', ...(p.phone ? { phone: String(p.phone) } : {}), ...(p.email ? { email: String(p.email) } : {}), ...facts } });
  };
  const dateWords = (v: any) => { const t = ms(v); return t ? new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(tz ? { timeZone: tz } : {}) }) : 'the date'; };
  if (S.finders.inquiry_waiting) for (const q of b.inquiries || []) {
    const d = ago(q.submittedAt || q.createdAt); if (!['new', 'reviewing'].includes(String(q.status || '')) || d === null || d < 1 || d > 30) continue;
    if (ms(q.eventDate) && ms(q.eventDate) < now) continue;
    push('inquiry_waiting', String(q.id), { name: q.fullName || q.name, phone: q.phone, email: q.email, clientId: q.clientId }, `Asked about ${q.eventType ? `a ${String(q.eventType).toLowerCase()}` : 'an event'} ${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} ago, and no quote yet${q.eventDate ? ` (event ${dateWords(q.eventDate)})` : ''}`,
      { occasion: String(q.eventType || 'event').toLowerCase(), event_date: dateWords(q.eventDate) }, 0, { inquiryId: String(q.id) });
  }
  const booked = new Map<string, number>(); const count = new Map<string, number>(); const ahead = new Set<string>();
  for (const r of b.boothBookings || []) { if (!LIVE_RES.includes(String(r.status || ''))) continue; const keys = [String(r.phone || '').replace(/\D+/g, '').slice(-10), String(r.email || '').trim().toLowerCase(), String(r.renterId || '')].filter(Boolean);
    const end = ms(r.endDate || r.startDate); for (const k of keys) { booked.set(k, Math.max(booked.get(k) || 0, end)); count.set(k, (count.get(k) || 0) + 1); if (ms(r.startDate) > now) ahead.add(k); } }
  const keysOf = (p: any) => [String(p.phone || '').replace(/\D+/g, '').slice(-10), String(p.email || '').trim().toLowerCase(), String(p.renterId || p.convertedRenterId || '')].filter(Boolean);
  if (S.finders.booth_lead) for (const a of b.boothApps || []) {
    if (a.kind === 'tour' || a.kind === 'waitlist') continue;   // tours have their own reminders and follow-up flag
    const st = String(a.status || ''); const d = ago(a.createdAt); const dd = ago(a.decidedAt);
    const waiting = ['new', 'in_review'].includes(st) && d !== null && d >= 2 && d <= 45; const approvedIdle = st === 'approved' && dd !== null && dd >= 5 && dd <= 60 && !keysOf(a).some((k) => booked.has(k));
    if (!waiting && !approvedIdle) continue;
    push('booth_lead', String(a.id), a, waiting ? `Applied for a ${a.rentalType === 'lease' ? 'booth lease' : 'booth'} ${Math.round(d!)} days ago, no answer yet` : `Approved ${Math.round(dd!)} days ago, hasn’t booked or signed yet`, {}, 0, { applicationId: String(a.id) });
  }
  if (S.finders.booth_pass) for (const p of b.boothPasses || []) {
    const left = (Number(p.daysTotal) || 0) - (Number(p.daysUsed) || 0); const d = ago(p.purchasedAt); if (p.status !== 'active' || left <= 0 || d === null || d < 30) continue;
    const k = String(p.contactKey || ''); const last = booked.get(k) || 0; if (ahead.has(k) || (last && now - last < 30 * DAY)) continue;
    push('booth_pass', String(p.id), { name: p.name || p.renterName, phone: p.phone || (/^\d{10}$/.test(k) ? k : ''), email: p.email || (k.includes('@') ? k : '') }, `${left} booth day${left === 1 ? '' : 's'} left on a pass, none booked in 30 days`, { left: `${left} day${left === 1 ? '' : 's'}` }, 0, { passId: String(p.id) });
  }
  if (S.finders.booth_lapsed) { const seen = new Set<string>();
    for (const r of [...(b.boothBookings || [])].sort((x, y) => ms(y.startDate) - ms(x.startDate))) {
      const keys = keysOf(r); const k = keys[0]; if (!k || keys.some((z) => seen.has(z))) continue; keys.forEach((z) => seen.add(z));
      if ((count.get(k) || 0) < 3 || keys.some((z) => ahead.has(z))) continue; const since = (now - (booked.get(k) || 0)) / DAY; if (since < 45 || since > 365) continue;
      push('booth_lapsed', `r_${k}`, r, `Booked ${count.get(k)} times; last day was ${Math.round(since)} days ago, nothing since`, {}, 0, {});
    } }
  if (S.finders.academy_lead) for (const a of b.admissions || []) {
    if (!['inquiry', 'tour'].includes(String(a.stage || ''))) continue; const d = ago(a.updatedAt || a.createdAt); if (d === null || d < 3 || d > 60) continue;
    push('academy_lead', String(a.id), { name: a.name || [a.firstName, a.lastName].filter(Boolean).join(' '), phone: a.textOk === false ? '' : a.phone, email: a.email }, `${a.stage === 'tour' ? 'Toured' : 'Asked about'} ${a.programName || 'a program'} ${Math.round(d)} days ago and hasn’t applied`, { program: String(a.programName || 'our program') }, 0, { admissionId: String(a.id) });
  }
  if (S.finders.academy_stalled) for (const e of b.enrollments || []) {
    if (e.status !== 'active' || e.completedAt || e.certificateCode) continue; const d = ago(e.lastActiveAt || e.createdAt); if (d === null || d < 14 || d > 90) continue;
    push('academy_stalled', String(e.id), { name: e.studentName || e.name, phone: e.phone, email: e.email }, `No lessons in ${Math.round(d)} days on ${e.courseTitle || e.courseName || 'their course'}`, { course: String(e.courseTitle || e.courseName || 'your course') }, Number(e.paidCents) || 0, { enrollmentId: String(e.id) });
  }
  // The team (owner's tasks; the client never hears about these). Scheduled into overtime this week:
  if (S.finders.overtime_risk) { const lim = Number(b.overtimeHours) || 40; const mins = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
    const by = new Map<string, number>(); for (const sh of b.shifts || []) { if (sh.status === 'cancelled' || (sh.kind && sh.kind !== 'work')) continue; const a = mins(sh.startTime), z = mins(sh.endTime); if (isNaN(a) || isNaN(z)) continue;
      const span = (z > a ? z - a : z + 1440 - a) - (Number(sh.breakMinutes) || 0); by.set(String(sh.staffId), (by.get(String(sh.staffId)) || 0) + Math.max(0, span)); }
    for (const [sid, m] of by) { if (m <= lim * 60) continue; const p = (b.team || []).find((x: any) => String(x.id) === sid); if (!p || p.archived) continue;
      const hrs = Math.round(m / 6) / 10; push('overtime_risk', `${sid}:${String((b.shifts || [])[0]?.weekKey || '')}`, { name: p.name, phone: p.phone }, `On the schedule for ${hrs} hours this week — overtime starts after ${lim}`, { hours: String(hrs), limit: `${lim} hours` }, 0, { staffId: sid }); } }
  // Using more product than the service's standard amounts (last 30 days of recorded use, 5+ visits, 25%+ over).
  if (S.finders.supply_overuse) { const agg = new Map<string, { staffId: string; productId: string; name: string; unit: string; expected: number; used: number; visits: number }>();
    for (const u of b.usage || []) { if (!u?.staffId || now - ms(u.recordedAt) > 30 * DAY) continue; for (const l of u.lines || []) { const used = Number(l.actual ?? l.deducted ?? l.expected) || 0; const exp = Number(l.expected) || 0; if (exp <= 0) continue;
      const k = `${u.staffId}|${l.productId}`; const r = agg.get(k) || { staffId: String(u.staffId), productId: String(l.productId), name: String(l.name || 'product'), unit: String(l.unit || ''), expected: 0, used: 0, visits: 0 }; r.expected += exp; r.used += used; r.visits++; agg.set(k, r); } }
    for (const r of agg.values()) { if (r.visits < 5 || r.used < r.expected * 1.25) continue; const p = (b.team || []).find((x: any) => String(x.id) === r.staffId); if (!p) continue;
      const over = Math.round((r.used - r.expected) * 10) / 10; const pct = Math.round((r.used / r.expected - 1) * 100); const prod = (b.products || []).find((x: any) => x.id === r.productId);
      const cost = Number(prod?.costPerUnit) > 0 ? (prod.costingMethod === 'size' && Number(prod.size) > 0 ? Number(prod.costPerUnit) / Number(prod.size) : prod.costingMethod === 'uses' && Number(prod.estimatedUses) > 0 ? Number(prod.costPerUnit) / Number(prod.estimatedUses) : Number(prod.costPerUnit)) : 0;
      push('supply_overuse', `${r.staffId}:${r.productId}`, { name: p.name, phone: p.phone }, `${p.name || 'A provider'} used ${pct}% more ${r.name} than the recipe over ${r.visits} visits (${over} ${r.unit} extra)`, { visits: String(r.visits), product: '', product_name: r.name, over: `${over} ${r.unit}`.trim() }, Math.round(cost * (r.used - r.expected) * 100), { staffId: r.staffId, productId: r.productId }); } }
  if (S.finders.applicant_waiting) { const met = new Map<string, any>(); for (const i of b.invites || []) if (i.status === 'accepted' && i.applicationId) met.set(String(i.applicationId), i);
    for (const a of b.applications || []) {
      const st = String(a.status || ''); const d = ago(a.createdAt); const inv = met.get(String(a.id)); const slot = ms(inv?.chosenSlot?.startIso || inv?.chosenSlot?.start || inv?.chosenSlot);
      const fresh = st === 'new' && d !== null && d >= 3 && d <= 45; const afterInterview = st === 'interview' && slot && now - slot >= 2 * DAY && now - slot <= 30 * DAY;
      if (!fresh && !afterInterview) continue;
      push('applicant_waiting', String(a.id), { name: a.name || [a.firstName, a.lastName].filter(Boolean).join(' '), phone: a.phone, email: a.email }, fresh ? `Applied${a.position ? ` for ${a.position}` : ''} ${Math.round(d!)} days ago, no reply yet` : `Interviewed ${Math.round((now - slot) / DAY)} days ago, no decision yet`, {}, 0, { applicationId: String(a.id) });
    } }
  return out;
}

export interface Purchase { clientId: string; productId: string; name: string; at: number; priceCents?: number }
/** Products a client has bought at least twice, a week or more apart: the median gap is their rhythm. Due once that
 * much time has passed since the last one (and not long after: by 2.5× they've likely found another). */
export function reorderDue(list: Purchase[], now: number): Array<{ clientId: string; productId: string; name: string; weeks: number; sinceWeeks: number; priceCents: number }> {
  const by = new Map<string, Purchase[]>(); for (const p of list) { if (!p.clientId || !p.productId || !p.at) continue; const k = `${p.clientId}|${p.productId}`; (by.get(k) || by.set(k, []).get(k)!).push(p); }
  const out: Array<{ clientId: string; productId: string; name: string; weeks: number; sinceWeeks: number; priceCents: number }> = [];
  for (const [, l] of by) {
    const days = [...new Set(l.map((p) => Math.floor(p.at / DAY)))].sort((a, b) => a - b); if (days.length < 2) continue;
    const gaps = days.slice(1).map((d, i) => d - days[i]).filter((g) => g >= 7); if (!gaps.length) continue;
    const g = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]; const since = now / DAY - days[days.length - 1];
    if (since < g || since > g * 2.5) continue; const last = l.reduce((a, b) => (b.at > a.at ? b : a));
    out.push({ clientId: last.clientId, productId: last.productId, name: String(last.name || 'favorite product'), weeks: Math.max(1, Math.round(g / 7)), sinceWeeks: Math.max(1, Math.round(since / 7)), priceCents: Number(last.priceCents) || 0 });
  }
  return out.sort((a, b) => b.priceCents - a.priceCents);
}

/** Fill a gap: who to ask about one spare time. Clients with past visits and nothing booked, who aren't opted out, whose
 * usual service fits in the time, and who are at least most of the way to their usual next visit. Those who see this
 * provider, and usually come on this weekday, first. At most three. */
export function gapAskList(o: { opening: any; H: Map<string, History>; clients: Map<string, any>; busy: Set<string>; minsOf: (serviceId: any) => number | null; now: number; tz?: string }): Candidate[] {
  const { opening: op, now } = o; const start = ms(op.start); const mins = Number(op.minutes) || Math.round((ms(op.end) - start) / 60000) || 0; if (!mins) return [];
  const wd = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', ...(o.tz ? { timeZone: o.tz } : {}) }); const opDay = wd(start);
  const scored: Array<{ c: any; h: History; score: number }> = [];
  for (const [cid, h] of o.H) {
    const c = o.clients.get(cid); if (!c || c.archived || c.deleted || c.opportunityOptOut || c.marketingOptOut || o.busy.has(cid)) continue;
    if (h.upcoming || !h.last || !(c.phone || c.phoneNumber)) continue;
    const since = (now - ms(h.last.startTime)) / DAY; const g = h.gapDays || 28; if (since < g * 0.8 || since > Math.max(g * 3, 120)) continue;
    const need = o.minsOf(h.last.serviceId) || Number(h.last.duration) || 0; if (!need || need > mins) continue;
    const sameProv = op.staffId && String(h.last.staffId || '') === String(op.staffId); const sameDay = h.visits.slice(-4).filter((a: any) => wd(ms(a.startTime)) === opDay).length;
    if (op.staffId && !sameProv && !h.visits.some((a: any) => String(a.staffId || '') === String(op.staffId))) continue;   // only people who have seen this provider before
    scored.push({ c, h, score: (sameProv ? 4 : 0) + sameDay * 2 + Math.min(3, since / g) + Math.min(2, h.visits.length / 5) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(({ c, h }) => ({
    kind: 'fill_gap', tool: 'appointments', subject: { type: 'client', id: String(c.id) }, key: `fill_gap:${op.id}:${c.id}`, clientId: String(c.id),
    clientName: String(c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Client').slice(0, 120),
    why: `A time opened ${new Date(start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', ...(o.tz ? { timeZone: o.tz } : {}) })} that nobody on the waitlist fits, and they are about due`,
    valueCents: Math.round(h.avg * 100), providerId: op.staffId ? String(op.staffId) : null, dueAt: new Date(now).toISOString(), expiresAt: new Date(start).toISOString(), refs: { openingId: String(op.id) },
    facts: { first: firstName(c), service_short: shortService(h.last?.serviceName), weeks: String(weeksOf(h.gapDays)), ...(c.phone ? { phone: String(c.phone) } : {}) } } as Candidate));
}

export function filterCandidates(c: Candidate[], o: { existing: any[]; clients: Map<string, any>; openCaseClients: Set<string>; recentAutoNudge: Set<string>; now: number }): Candidate[] {
  const ACT = ['open', 'holdout', 'waiting', 'auto', 'scheduled'];
  const openByClient = new Set(o.existing.filter((e) => ACT.includes(e.status) && e.clientId).map((e) => String(e.clientId)));
  const keys = new Set(o.existing.filter((e) => ACT.includes(e.status)).map((e) => e.key));
  const seen = new Set<string>();
  return c.filter((x) => {
    if (keys.has(x.key)) return false;
    const pb = PLAYBOOKS[x.kind];
    if (o.existing.some((e) => e.key === x.key && o.now - ms(e.createdAt) < Math.max(1, pb.cooldownDays) * DAY)) return false;   // same thing, recently — even with no client record (a gift card holder)
    if (x.clientId) {
      if (openByClient.has(x.clientId) || seen.has(x.clientId)) return false;
      const cl = o.clients.get(x.clientId); if (cl?.opportunityOptOut || (pb.marketing && cl?.marketingOptOut)) return false;
      if (o.openCaseClients.has(x.clientId)) return false;   // fix first — nothing is sold while a case is open
      if (pb.winBack && o.recentAutoNudge.has(x.clientId)) return false;   // the automatic reminder is already working
      const cool = o.existing.some((e) => e.clientId === x.clientId && e.kind === x.kind && o.now - ms(e.createdAt) < pb.cooldownDays * DAY);
      if (cool) return false;
      seen.add(x.clientId);
    }
    return true;
  });
}

/** 1 in N win-back candidates is left alone at random — the comparison that shows what outreach really did. */
export function isHoldout(key: string, monthKey: string, pct: number): boolean {
  if (!pct) return false; let h = 2166136261; const s = `${key}|${monthKey}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100) < pct;
}

const DESK_ROLES = ['front_desk', 'frontdesk', 'desk', 'receptionist', 'coordinator', 'assistant'];
const MGR_ROLES = ['owner', 'admin', 'manager'];
/** Who gets it: the playbook's person, if they're on the team and not over today's limit; else someone in the same
 * role; else a manager; else nobody (it waits on the board for a manager to hand out). */
export function assignee(who: Who, providerId: string | null, team: any[], load: Map<string, number>, cap: number): any | null {
  const ok = (m: any) => m && !m.archived && m.isActive !== false && m.role !== 'renter' && !m.isRenter && m.appAccess !== 'off' && (load.get(m.id) || 0) < cap;
  const byRole = (roles: string[]) => team.filter((m) => roles.includes(String(m.role || '').toLowerCase()) && ok(m)).sort((a, b) => (load.get(a.id) || 0) - (load.get(b.id) || 0))[0] || null;
  if (who === 'provider') { const p = team.find((m) => m.id === providerId); if (ok(p)) return p; return byRole(DESK_ROLES) || byRole(MGR_ROLES); }
  if (who === 'desk') return byRole(DESK_ROLES) || byRole(MGR_ROLES);
  const owner = team.find((m) => String(m.role || '').toLowerCase() === 'owner'); return ok(owner) ? owner : byRole(MGR_ROLES);
}

/** The first message: the version this client hasn't had before, with their details filled in. */
export function pickVersion(kind: OppKind, used: number[], pb: Playbook = PLAYBOOKS[kind]): number {
  const n = Math.max(1, pb.versions.length); for (let i = 0; i < n; i++) if (!used.includes(i)) return i; return (Math.max(...used) + 1) % n;
}
export function fill(text: string, facts: Record<string, string | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k) => String(facts[k] ?? '').trim()).replace(/\s{2,}/g, ' ').replace(/\s([,.!?])/g, '$1').trim();
}

/** What an answer does: closes it or not, the follow-up it makes, and the side effects the server carries out. */
export function outcomeEffects(opp: any, outcome: OutcomeId, now: number): { patch: any; followUpAt: string | null; openCase: boolean; optOut: boolean } {
  const o = OUTCOMES[outcome]; const tries = (opp.tries || 0) + (['no_answer', 'voicemail'].includes(outcome) ? 1 : 0);
  const giveUp = ['no_answer', 'voicemail'].includes(outcome) && tries >= MAX_TRIES;
  const closes = o.closes || giveUp;
  const patch: any = { tries, lastOutcome: outcome, updatedAt: new Date(now).toISOString() };
  if (closes) { patch.status = 'done'; patch.outcome = giveUp ? 'no_answer' : outcome; patch.closedAt = new Date(now).toISOString(); }
  const fu = o.followUpDays && opp.kind !== 'follow_up' ? new Date(now + o.followUpDays * DAY).toISOString() : null;
  return { patch, followUpAt: fu, openCase: outcome === 'bad_experience', optOut: outcome === 'stop' };
}

/** Did the client come back after we reached out? (not "caused by" — the holdout group says how much was the outreach) */
export function cameBack(opp: any, appts: any[], now: number): { status: 'none' | 'booked' | 'paid'; appointmentId?: string; paidCents?: number } {
  const from = ms(opp.firstContactAt) || ms(opp.createdAt); if (!from) return { status: 'none' };
  const mine = appts.filter((a) => String(a.clientId || '') === String(opp.clientId || '') && (ms(a.createdAt) || ms(a.startTime)) >= from - 3600e3 && (ms(a.createdAt) || 0) <= from + 30 * DAY && !DEAD.includes(String(a.status || '')))
    .sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const paid = mine.find((a) => DONE.includes(String(a.status || '')) && ms(a.startTime) <= now);
  if (paid) return { status: 'paid', appointmentId: String(paid.id), paidCents: Math.round(money(paid) * 100) };
  const booked = mine.find((a) => ms(a.startTime) > now); if (booked) return { status: 'booked', appointmentId: String(booked.id) };
  return { status: 'none' };
}


// ── Results: every booking credited once (step 3) ──────────────────────────────────────────────
// A completed call isn't a sale. Money counts only when a real visit is paid, and each visit is credited to at most one
// thing: a direct tag (booked from the task, or through its link) first; otherwise the most recent contact within the
// window, unless a campaign or an automatic reminder reached them later (then that gets it, not us). Refunds take it back.
export const RECOVERY_KINDS: OppKind[] = ['cancelled', 'no_show'];
export type CreditType = 'generated' | 'recovered' | 'influenced';
export interface Credit { type: CreditType; oppId: string; kind: OppKind; tool: Tool; staffId: string | null }
const contactAt = (o: any) => ms(o.lastContactAt) || ms(o.firstContactAt);
export function creditFor(a: any, opps: any[], laterOthers: number[], S: OppSettings): Credit | null {
  const made = ms(a.createdAt) || ms(a.startTime); if (!made || !a.clientId) return null;
  const toolOf = (o: any): Tool => o.tool || TOOL_OF[o.kind as OppKind] || 'appointments';
  if (a.opportunityId) {
    const o = opps.find((x) => x.id === a.opportunityId && (!x.clientId || String(x.clientId) === String(a.clientId)));
    if (o) return { type: RECOVERY_KINDS.includes(o.kind) ? 'recovered' : 'generated', oppId: o.id, kind: o.kind, tool: toolOf(o), staffId: o.assigneeId || null };
  }
  if (a.campaignId) return null;   // booked through a campaign's own link: the campaign counts it
  const reached = opps.filter((o) => String(o.clientId || '') === String(a.clientId) && o.status !== 'holdout' && ms(o.firstContactAt) && ms(o.firstContactAt) <= made
    && made - contactAt(o) <= (S.windows?.[toolOf(o)] || 14) * DAY).sort((x, y) => contactAt(y) - contactAt(x));
  const o = reached[0]; if (!o) return null;
  if (laterOthers.some((t) => t > contactAt(o) && t <= made)) return null;   // a campaign or reminder was the last word
  return { type: 'influenced', oppId: o.id, kind: o.kind, tool: toolOf(o), staffId: o.assigneeId || null };
}
/** Where a credited visit stands: booked (not money yet), paid (what it really paid, less refunds), refunded, cancelled. */
export function resultState(a: any, refundedCents = 0): { state: 'booked' | 'paid' | 'refunded' | 'cancelled'; paidCents: number; bookedCents: number } {
  const st = String(a.status || '');
  if (DEAD.includes(st)) return { state: 'cancelled', paidCents: 0, bookedCents: 0 };
  const value = Math.round(money(a) * 100);
  if (DONE.includes(st)) { const net = Math.max(0, value - Math.max(0, refundedCents)); return net > 0 || value === 0 ? { state: 'paid', paidCents: net, bookedCents: 0 } : { state: 'refunded', paidCents: 0, bookedCents: 0 }; }
  return { state: 'booked', paidCents: 0, bookedCents: value };
}


// ── Answering a reply without a person (ask first) ──────────────────────────────────────────────
// Rules, not guesses: a short, plain yes gets times; a 1 or 2 books that time; anything else goes to a person.
export function isYes(body: string): boolean {
  const t = String(body || '').trim().toLowerCase().replace(/[!.\s]+$/g, '');
  if (!t || t.length > 40 || t.includes('?')) return false;
  return /^(y|ya|yes|yes please|yes pls|yeah|yea|yep|yup|sure|ok|okay|k|please|sounds good|that would be great|definitely|absolutely|of course|i would|i'd like that|id like that)(\s+(please|thanks|thank you|thx))?$/.test(t);
}
export function pickedNumber(body: string, max: number): number | null {
  const m = String(body || '').trim().match(/^(?:option\s*)?#?\s*([1-9])\s*[.!)]?$/i); const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

/** The studio's win-back reminders run through Opportunities while it's on (renters keep their own). */
export const winbackInOpportunities = (tenant: any) => oppSettingsOf(tenant).on;

// ── When results start to show (the notice on Opportunities → Results) ───────────────────────────────────────────────
// Results only count money actually collected, after someone reached out and inside the tool's window (14 days for
// appointments). So there's a natural wait: the first follow-ups go out, clients book, they come in and pay. Comparisons
// with the left-alone group need enough people in both groups, which takes a few months for most businesses.
export interface ResultsTimeline { stage: 'not_started' | 'waiting_first' | 'first_in' | 'comparing' | 'steady'; headline: string; detail: string; steps: { label: string; when: string; done: boolean }[] }
export function resultsTimeline(x: { firstContactAt: string | null; firstPaidAt: string | null; contacted: number; heldOut: number; windowDays?: number; now?: number }): ResultsTimeline {
  const now = x.now ?? Date.now(); const win = x.windowDays || 14; const D = 864e5;
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const need = 10; const compareReady = x.contacted >= need && x.heldOut >= need;
  if (!x.firstContactAt) return { stage: 'not_started', headline: 'Results start once your first follow-ups go out', detail: 'Turn on at least one finder (Finders), and work the tasks or let the automatic texts go. Paid visits usually start showing about two weeks after that.',
    steps: [{ label: 'First follow-ups go out', when: 'not yet', done: false }, { label: 'First paid results', when: 'about 2 weeks after', done: false }, { label: 'A fair comparison', when: 'about 3 months after', done: false }] };
  const first = Date.parse(x.firstContactAt); const firstPaidBy = first + (win + 7) * D; const steadyAt = first + 90 * D;
  const steps = [
    { label: 'First follow-ups went out', when: day(first), done: true },
    { label: 'First paid results', when: x.firstPaidAt ? day(Date.parse(x.firstPaidAt)) : `around ${day(firstPaidBy)}`, done: !!x.firstPaidAt },
    { label: `A fair comparison (${need}+ reached and ${need}+ left alone)`, when: compareReady ? 'ready' : `now ${x.contacted} reached · ${x.heldOut} left alone`, done: compareReady },
    { label: 'A steady month-to-month picture', when: now >= steadyAt ? 'ready' : `from about ${day(steadyAt)}`, done: now >= steadyAt },
  ];
  if (!x.firstPaidAt) return { stage: 'waiting_first', headline: `Expect your first paid results around ${day(firstPaidBy)}`, detail: `A follow-up counts once the client books, comes in and pays — within ${win} days of being reached. Bookings that are waiting show as "Booked, not paid yet".`, steps };
  if (!compareReady) return { stage: 'first_in', headline: 'Results are coming in. The comparison needs a little longer', detail: `"What reaching out added" compares people who were reached with a few who were left alone on purpose. It needs ${need}+ in each group; until then, read the paid total as a start, not a verdict.`, steps };
  if (now < steadyAt) return { stage: 'comparing', headline: `The comparison is ready. Expect a steadier picture from ${day(steadyAt)}`, detail: 'Early months swing a lot with only a few people. After about three months the numbers settle.', steps };
  return { stage: 'steady', headline: '', detail: '', steps };
}
