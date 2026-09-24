// src/lib/campaign-templates.ts
//
// CAMPAIGN TEMPLATES — one library, used by the business's campaign editor
// and by renters in their portal.
//
// Written for ANY kind of business (appointments, classes, memberships,
// shops): no industry words, no invented offers. Text goes through the same
// tokens the sender fills in:
//   {first}     → the client's first name
//   {business}  → the business (or renter) name
//   {offer}     → the offer attached to the campaign, e.g. "15% off with code
//                 WELCOME15" — the line is removed cleanly when there's none
//   {link}      → the booking link (texts; emails also get a Book button)
// Each template suggests an audience and says whether an offer fits, so the
// editor can prompt for one instead of the text promising a discount that
// doesn't exist.

export type TemplateGoal = 'welcome' | 'win_back' | 'birthday' | 'news' | 'fill_gaps' | 'thank_you' | 'review' | 'follow_up';

export interface CampaignTemplate {
  id: string;
  goal: TemplateGoal;
  title: string;            // shown on the card
  blurb: string;            // one line: when to use it
  audience: string;         // suggested audience key (see campaigns.ts)
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  offerFits: boolean;       // prompt for an offer at the Offer step
  automation?: 'birthday' | 'first_visit_followup';
  renterOk: boolean;        // offered to renters too
}

export const TOKENS: { token: string; label: string }[] = [
  { token: '{first}', label: 'First name' },
  { token: '{business}', label: 'Business name' },
  { token: '{offer}', label: 'The offer' },
  { token: '{link}', label: 'Booking link' },
];

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: 'welcome', goal: 'welcome', title: 'Welcome a new client', blurb: 'Thank first-timers and invite them back.',
    audience: 'new', channel: 'email', offerFits: true, renterOk: true,
    subject: 'So glad you came in, {first}',
    body: 'Hi {first},\n\nThank you for choosing {business} — it was lovely to have you.\n\n{offer}\n\nWhenever you’re ready for your next visit, it only takes a minute to book.\n\nSee you soon,\n{business}',
  },
  {
    id: 'win_back', goal: 'win_back', title: 'Win back quiet clients', blurb: 'For people who haven’t been in for a while.',
    audience: 'inactive_90', channel: 'sms', offerFits: true, renterOk: true,
    subject: 'We’d love to see you again',
    body: 'Hi {first}, it’s been a while and we’d love to see you again at {business}. {offer} Book here: {link}',
  },
  {
    id: 'one_and_done', goal: 'win_back', title: 'Bring back first-timers', blurb: 'Came once, never returned — a gentle second invitation.',
    audience: 'one_and_done', channel: 'email', offerFits: true, renterOk: true,
    subject: 'Come back and see us, {first}',
    body: 'Hi {first},\n\nWe really enjoyed your first visit to {business} and would love to welcome you back.\n\n{offer}\n\nPick a time that suits you below.\n\n{business}',
  },
  {
    id: 'birthday', goal: 'birthday', title: 'Birthday wishes', blurb: 'Sent during each client’s birthday month — set it once.',
    audience: 'birthday', channel: 'email', offerFits: true, renterOk: true, automation: 'birthday',
    subject: 'Happy birthday, {first}!',
    body: 'Hi {first},\n\nHappy birthday from all of us at {business}! We hope your year ahead is a great one.\n\n{offer}\n\nWith love,\n{business}',
  },
  {
    id: 'follow_up', goal: 'follow_up', title: 'After a first visit', blurb: 'A check-in a few days after someone’s first visit — set it once.',
    audience: 'first_visit_followup', channel: 'email', offerFits: false, renterOk: true, automation: 'first_visit_followup',
    subject: 'How was your visit, {first}?',
    body: 'Hi {first},\n\nThanks again for visiting {business}. We hope you loved it.\n\nIf there’s anything we can do better, just reply — we read every message.\n\n{business}',
  },
  {
    id: 'fill_gaps', goal: 'fill_gaps', title: 'Fill open spots', blurb: 'Last-minute openings this week.',
    audience: 'all', channel: 'sms', offerFits: false, renterOk: true,
    subject: 'Openings this week',
    body: 'Hi {first}, {business} has a few openings this week. Grab one here: {link}',
  },
  {
    id: 'news', goal: 'news', title: 'Share news', blurb: 'Something new — a service, product, hours or event.',
    audience: 'all', channel: 'email', offerFits: true, renterOk: true,
    subject: 'Something new at {business}',
    body: 'Hi {first},\n\nWe have some news to share: [tell them what’s new].\n\n{offer}\n\nWe’d love for you to be one of the first to try it.\n\n{business}',
  },
  {
    id: 'thank_you', goal: 'thank_you', title: 'Thank your regulars', blurb: 'For your most loyal clients.',
    audience: 'loyal', channel: 'email', offerFits: true, renterOk: true,
    subject: 'Thank you, {first}',
    body: 'Hi {first},\n\nYou’ve been one of our most loyal clients this year, and we’re grateful. Thank you for choosing {business}.\n\n{offer}\n\nWith thanks,\n{business}',
  },
  {
    id: 'review', goal: 'review', title: 'Ask for a review', blurb: 'Recent clients, a short and friendly ask.',
    audience: 'new', channel: 'sms', offerFits: false, renterOk: true,
    subject: 'Would you leave us a review?',
    body: 'Hi {first}, thanks for visiting {business}! If you enjoyed it, a quick review would mean a lot to us. [paste your review link]',
  },
  {
    id: 'missed', goal: 'win_back', title: 'Missed or cancelled', blurb: 'Clients who cancelled or missed recently and haven’t rebooked.',
    audience: 'cancelled_recent', channel: 'sms', offerFits: false, renterOk: true,
    subject: 'Let’s find you a new time',
    body: 'Hi {first}, sorry we missed you at {business}. Whenever you’re ready, pick a new time here: {link}',
  },
];

/** Fill the tokens. A blank {offer} takes its line (or sentence) with it. */
export function fillTokens(text: string, v: { first: string; business: string; offer?: string | null; link?: string | null }): string {
  let out = String(text || '');
  if (!v.offer) out = out.replace(/^[ \t]*\{offer\}[ \t]*\n?/gm, '').replace(/\s*\{offer\}\s*/g, ' ');
  out = out
    .replace(/\{\{\s*(clientName|firstName|name)\s*\}\}/g, v.first)
    .replace(/\{first\}/g, v.first)
    .replace(/\{business\}/g, v.business)
    // An offer mid-paragraph ends its own sentence: "…code BACK15. Book here…"
    .replace(/\{offer\}(?=\s+[A-Z])/g, v.offer ? `${v.offer.replace(/[.!]$/, '')}.` : '')
    .replace(/\{offer\}/g, v.offer || '')
    .replace(/\{link\}/g, v.link || '');
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}
