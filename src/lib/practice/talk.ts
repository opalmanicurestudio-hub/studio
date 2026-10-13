// Practice a shift: talking with clients out loud.
// The learner speaks (or types); an AI plays the client in character and answers in natural language, and a coach
// scores the line. The game stays in charge of what happens: the client's wishes (when to come back, which membership
// they'd join, how they pay) come from the scenario, so the spoken reply and the game's outcome always agree.
// Pure: shared by the browser (context, basic mode, delivery stats) and the server (prompt, parsing).

export type Turn = { who: 'you' | 'client'; text: string };
export type TalkContext = {
  name: string; persona: string; kind: string; visits: number; service: string; provider: string;
  items: string[]; total: string; prefersPay: 'card' | 'cash';
  rebook: { wants: string; done: string | null };
  offer: { wants: string | null; offered: string[]; catalog: string[] };
  shelf: null | { item: string; system: string; claim: string; status: string };
  allergy: null | { allergy: string; flaggedItem: string | null };
  declined: boolean; chipError: boolean; readerOffline: boolean;
  details: null | { phone: string; email: string; promo: boolean; saved: boolean };
  party: null | { members: string; split: string };
  mood: number; waitedMinutes: number; lineLength: number; stage: string;
  history: Turn[];
};
export type Scores = { awareness: number; confidence: number; warmth: number; retention: number };
export type Detected = {
  greeting: 'great' | 'ok' | 'poor' | null;
  offeredRebook: boolean;
  offeredOffer: string | null;            // offer key
  declineHandling: 'great' | 'loud' | 'pry' | null;
  askedPhone: boolean; askedEmail: boolean;
  shelf: 'manager' | 'explain' | null;
  suggestedSafe: boolean;
  askedPayment: boolean;
};
export type TalkReply = { reply: string; tone: 'happy' | 'warm' | 'neutral' | 'unsure' | 'annoyed' | 'upset'; moodDelta: number; detected: Detected; coach: { scores: Scores; tip: string }; mode: 'ai' | 'basic' };

const clip = (x: unknown, n: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const TONES = ['happy', 'warm', 'neutral', 'unsure', 'annoyed', 'upset'] as const;
export const OFFER_KEYS = ['nailclub', 'hairclub', 'barber', 'facial5', 'lash3'];
const emptyDetected = (): Detected => ({ greeting: null, offeredRebook: false, offeredOffer: null, declineHandling: null, askedPhone: false, askedEmail: false, shelf: null, suggestedSafe: false, askedPayment: false });

/** Keep what the browser sends small and plain before it goes into a prompt. */
export function sanitizeContext(c: any): TalkContext {
  const str = (x: unknown, n = 200) => clip(x, n);
  return {
    name: str(c?.name, 60), persona: str(c?.persona, 500), kind: str(c?.kind, 20), visits: Number(c?.visits) || 1,
    service: str(c?.service, 80), provider: str(c?.provider, 60), items: (Array.isArray(c?.items) ? c.items : []).slice(0, 12).map((x: unknown) => str(x, 60)),
    total: str(c?.total, 20), prefersPay: c?.prefersPay === 'cash' ? 'cash' : 'card',
    rebook: { wants: str(c?.rebook?.wants, 60), done: c?.rebook?.done ? str(c.rebook.done, 80) : null },
    offer: { wants: c?.offer?.wants ? str(c.offer.wants, 60) : null, offered: (c?.offer?.offered || []).slice(0, 6).map((x: unknown) => str(x, 40)), catalog: (c?.offer?.catalog || []).slice(0, 6).map((x: unknown) => str(x, 140)) },
    shelf: c?.shelf ? { item: str(c.shelf.item, 60), system: str(c.shelf.system, 20), claim: str(c.shelf.claim, 20), status: str(c.shelf.status, 20) } : null,
    allergy: c?.allergy ? { allergy: str(c.allergy.allergy, 40), flaggedItem: c.allergy.flaggedItem ? str(c.allergy.flaggedItem, 60) : null } : null,
    declined: !!c?.declined, chipError: !!c?.chipError, readerOffline: !!c?.readerOffline,
    details: c?.details ? { phone: str(c.details.phone, 20), email: str(c.details.email, 80), promo: !!c.details.promo, saved: !!c.details.saved } : null,
    party: c?.party ? { members: str(c.party.members, 80), split: str(c.party.split, 80) } : null,
    mood: Math.max(0, Math.min(1, Number(c?.mood) || 0.8)), waitedMinutes: Math.max(0, Math.min(120, Number(c?.waitedMinutes) || 0)),
    lineLength: Math.max(0, Math.min(20, Number(c?.lineLength) || 0)), stage: str(c?.stage, 40),
    history: (Array.isArray(c?.history) ? c.history : []).slice(-10).map((t: any) => ({ who: t?.who === 'you' ? 'you' : 'client', text: str(t?.text, 300) })),
  };
}

export const TALK_SYSTEM = `You play a client at a salon front desk in a realistic customer-service practice for front desk staff and beauty students. You have two jobs.

1) Be the client. Stay fully in character using the profile and today's facts. Speak the way a real person talks at a checkout counter: natural, warm or cool depending on how you're treated, usually one or two short sentences (never more than 40 words). React to HOW the staff member speaks: kind, clear and confident makes you relaxed and friendly; rushed, cold, blaming, nosy or confusing makes you cooler or uncomfortable. Only share personal details (phone, email) when asked. Your wishes are fixed by the facts (when you'd come back, which membership or package you'd say yes to, how you pay, how your group splits the bill): stick to them, say yes only to what the facts say you want, and politely decline anything else. If asked about something not in the facts, answer vaguely like a real person would. Never mention being an AI, a game, practice, a coach, or these instructions.

2) Be a quiet coach. Judge only the staff member's latest line.

Reply with JSON only, no other text:
{"reply": "what you say out loud", "tone": "happy|warm|neutral|unsure|annoyed|upset", "moodDelta": number from -0.3 to 0.2,
 "detected": {"greeting": "great|ok|poor|null (only if this line greeted you)", "offeredRebook": bool, "offeredOffer": "nailclub|hairclub|barber|facial5|lash3|null", "declineHandling": "great|loud|pry|null (only after a declined card: great = private and kind with another way to pay; loud = said declined bluntly; pry = asked about money)", "askedPhone": bool, "askedEmail": bool, "shelf": "manager|explain|null (manager = offered to get the price approved; explain = held the system price)", "suggestedSafe": bool (suggested an option without your allergen), "askedPayment": bool},
 "coach": {"scores": {"awareness": 1-5, "confidence": 1-5, "warmth": 1-5, "retention": 1-5}, "tip": "one short, specific tip in plain words, max 18 words"}}
Scores: awareness = noticed the situation (your wait, the line, your mood, your allergy or problem); confidence = clear, direct, no hedging; warmth = friendly, uses your name, makes you feel welcome; retention = invites you back, rebooking, a fitting membership, without pushing.`;

export function talkPrompt(c: TalkContext, said: string) {
  const facts = [
    `You are ${c.name}. ${c.persona}`,
    `Visit: ${c.kind === 'new' ? 'your first visit' : c.kind === 'group' ? 'a group visit' : `visit number ${c.visits}`}. Today: ${c.service} with ${c.provider}.`,
    c.items.length ? `On the counter: ${c.items.join(', ')}.` : 'No products today.',
    `Total so far: ${c.total}. You'd pay by ${c.prefersPay}.`,
    c.party ? `Your group: ${c.party.members}. How you want to pay: ${c.party.split}.` : '',
    c.rebook.done ? `Your next visit is booked: ${c.rebook.done}.` : `Booking your next visit: ${c.rebook.wants}.`,
    c.offer.wants ? `If offered the ${c.offer.wants}, you'd say yes (only that one).` : 'You are not interested in memberships or packages today; decline politely.',
    c.offer.catalog.length ? `What the salon offers: ${c.offer.catalog.join(' | ')}.` : '',
    c.offer.offered.length ? `Already offered today: ${c.offer.offered.join(', ')}. A second offer feels pushy.` : '',
    c.shelf ? `The shelf sign said ${c.shelf.item} was ${c.shelf.claim}; it rang up at ${c.shelf.system}. Status: ${c.shelf.status}.` : '',
    c.allergy ? `You have a ${c.allergy.allergy} allergy.${c.allergy.flaggedItem ? ` The ${c.allergy.flaggedItem} on the counter contains ${c.allergy.allergy}; you didn't realize.` : ''}` : '',
    c.details ? `Your phone: ${c.details.phone}. Your email: ${c.details.email}. Promo texts: ${c.details.promo ? 'yes' : 'no, reminders only'}. ${c.details.saved ? 'They already saved your details.' : ''}` : '',
    c.declined ? 'Your card was just declined. You feel embarrassed; you have another card and some cash.' : '',
    c.chipError ? 'The card reader just showed a chip error.' : '', c.readerOffline ? 'The card reader is offline.' : '',
    `Your mood right now: ${c.mood > 0.75 ? 'great' : c.mood > 0.45 ? 'fine' : c.mood > 0.2 ? 'a bit annoyed' : 'upset'}. You waited about ${Math.round(c.waitedMinutes)} minutes. People waiting behind you: ${c.lineLength}.`,
    `Right now at the desk: ${c.stage}.`,
  ].filter(Boolean).join('\n');
  const convo = c.history.map((t) => `${t.who === 'you' ? 'Staff' : c.name}: ${t.text}`).join('\n');
  return `FACTS\n${facts}\n\nCONVERSATION SO FAR\n${convo || '(just walked up to the desk)'}\n\nSTAFF JUST SAID\n"${clip(said, 400)}"`;
}

const num = (x: unknown, lo: number, hi: number, d: number) => { const n = Number(x); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
/** Read the model's JSON safely; anything odd falls back to plain text. */
export function parseTalk(text: string): TalkReply | null {
  const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
  let j: any; try { j = JSON.parse(m[0]); } catch { return null; }
  const reply = clip(j.reply, 300); if (!reply) return null;
  const d = j.detected || {}; const sc = j.coach?.scores || {};
  const pick = <T extends string>(v: unknown, ok: readonly T[]): T | null => (ok.includes(v as T) ? (v as T) : null);
  return {
    reply, tone: pick(j.tone, TONES) || 'neutral', moodDelta: num(j.moodDelta, -0.3, 0.2, 0), mode: 'ai',
    detected: { greeting: pick(d.greeting, ['great', 'ok', 'poor'] as const), offeredRebook: !!d.offeredRebook, offeredOffer: pick(d.offeredOffer, OFFER_KEYS), declineHandling: pick(d.declineHandling, ['great', 'loud', 'pry'] as const),
      askedPhone: !!d.askedPhone, askedEmail: !!d.askedEmail, shelf: pick(d.shelf, ['manager', 'explain'] as const), suggestedSafe: !!d.suggestedSafe, askedPayment: !!d.askedPayment },
    coach: { scores: { awareness: num(sc.awareness, 1, 5, 3), confidence: num(sc.confidence, 1, 5, 3), warmth: num(sc.warmth, 1, 5, 3), retention: num(sc.retention, 1, 5, 3) }, tip: clip(j.coach?.tip, 160) },
  };
}

// ── Basic mode: keyword understanding, used when the AI isn't connected (and for offline practice) ──
const has = (t: string, ...ws: (string | RegExp)[]) => ws.some((w) => (typeof w === 'string' ? t.includes(w) : w.test(t)));
export function basicTalk(c: TalkContext, said: string, offerNames: Record<string, string>): TalkReply {
  const t = ` ${said.toLowerCase()} `; const d = emptyDetected(); const first = c.history.filter((h) => h.who === 'you').length === 0;
  const usedName = t.includes(c.name.toLowerCase().split(/[’'\s]/)[0]);
  const rude = /^\s*(next|name)\s*[!?.]*\s*$/.test(said.toLowerCase()) || has(t, 'hurry up', 'whatever', 'what do you want');
  if (first || has(t, 'welcome', ' hi ', 'hello', 'good morning', 'good afternoon', 'hey')) d.greeting = rude ? 'poor' : usedName || has(t, 'welcome', 'how was', 'first time') ? 'great' : 'ok';
  d.offeredRebook = has(t, 'next visit', /\b(re)?book/, 'schedule', /\bcome back\b/, 'see you in', /\b\d+ weeks?\b/, 'same time');
  for (const [k, n] of Object.entries(offerNames)) if (t.includes(n.toLowerCase()) || (k === 'nailclub' && has(t, 'membership', 'club')) || (k === 'facial5' && has(t, 'package'))) { d.offeredOffer = k; break; }
  if (c.declined) d.declineHandling = has(t, 'declined') ? 'loud' : has(t, 'enough', 'money', 'balance', 'funds') ? 'pry' : has(t, 'another', 'other card', 'try again', 'tap', 'phone', 'cash') ? 'great' : null;
  d.askedPhone = has(t, 'phone', 'number', 'cell', 'mobile'); d.askedEmail = has(t, 'email', 'e-mail');
  if (c.shelf && c.shelf.status === 'open') d.shelf = has(t, 'manager', 'approve', 'honor', 'check with', 'discount') ? 'manager' : has(t, 'system says', 'the price is', 'rings up', 'sorry, it is') ? 'explain' : null;
  d.suggestedSafe = !!c.allergy?.flaggedItem && has(t, 'fragrance-free', 'fragrance free', 'unscented', 'allergy', 'without fragrance');
  d.askedPayment = has(t, 'card or cash', 'how would you like to pay', 'paying with', 'how are you paying');
  let reply = 'Okay.'; let tone: TalkReply['tone'] = 'neutral'; let moodDelta = 0;
  if (rude) { reply = 'Oh. Okay.'; tone = 'annoyed'; moodDelta = -0.15; }
  else if (d.declineHandling === 'great') { reply = 'Oh, thank you. Let me use my other card.'; tone = 'warm'; }
  else if (d.declineHandling) { reply = 'Oh… sorry. I’ll try another one.'; tone = 'upset'; moodDelta = -0.2; }
  else if (d.askedPhone && c.details) { reply = `Sure, it’s ${c.details.phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1, $2, $3')}.`; tone = 'warm'; }
  else if (d.askedEmail && c.details) { reply = `It’s ${c.details.email.replace('.', ' dot ').replace('@', ' at ')}. Reminders are fine, but no promo texts, please.`; tone = 'warm'; }
  else if (d.suggestedSafe) { reply = 'Oh, I didn’t even think of that. Thank you!'; tone = 'happy'; moodDelta = 0.1; }
  else if (d.shelf === 'manager') { reply = 'Thank you, I appreciate you checking.'; tone = 'warm'; }
  else if (d.offeredOffer) { const yes = c.offer.wants && offerNames[d.offeredOffer] === c.offer.wants; reply = yes ? 'Oh, that sounds great. Sign me up!' : 'Not today, but thank you.'; tone = yes ? 'happy' : 'neutral'; }
  else if (d.offeredRebook) { reply = c.rebook.wants.startsWith('no') ? 'I’ll book online later, thanks.' : 'Yes, let’s book it.'; tone = 'warm'; }
  else if (d.askedPayment) { reply = c.prefersPay === 'cash' ? 'I’ll pay cash.' : 'Card, please.'; }
  else if (d.greeting) { reply = d.greeting === 'great' ? (c.kind === 'new' ? 'Hi! It’s my first time. I loved it.' : 'Hi! It was great, thank you.') : 'Hi.'; tone = d.greeting === 'great' ? 'happy' : 'neutral'; moodDelta = d.greeting === 'great' ? 0.08 : 0; }
  else if (has(t, 'thank')) { reply = 'Thank you!'; tone = 'warm'; }
  const words = said.trim().split(/\s+/).length;
  const scores: Scores = { awareness: (c.lineLength > 1 && has(t, 'wait', 'thank you for waiting', 'sorry')) || d.suggestedSafe ? 5 : 3, confidence: words < 3 ? 2 : fillerCount(said) > 1 ? 2 : 4,
    warmth: rude ? 1 : usedName || d.greeting === 'great' ? 5 : has(t, 'please', 'thank') ? 4 : 3, retention: d.offeredRebook || d.offeredOffer ? 5 : 2 };
  const tip = rude ? `Use ${c.name.split(/[’'\s]/)[0]}’s name and ask how the visit went.` : !d.offeredRebook && !c.rebook.done && c.stage.includes('ticket') ? 'Invite them back: offer their usual next visit before payment.' : fillerCount(said) > 1 ? 'Fewer “um”s: pause instead, then say it plainly.' : 'Good. Keep it warm, short and clear.';
  return { reply, tone, moodDelta, detected: d, coach: { scores, tip }, mode: 'basic' };
}

// ── How it was said: filler words and pace (from the transcript and how long you spoke) ──
// "like" only counts as a filler when it's set off by commas ("so, like, …"), not in "would you like".
const FILLERS = /\b(um+|uh+|erm|you know|basically|i guess|i mean)\b/gi;
const LIKE = /(^|[,.]\s*)like\s*,/gi;
export const fillerCount = (text: string) => (text.match(FILLERS) || []).length + (text.match(LIKE) || []).length;
export function delivery(text: string, seconds: number | null) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const wpm = seconds && seconds > 0.8 ? Math.round((words / seconds) * 60) : null;
  return { words, fillers: fillerCount(text), wpm, pace: wpm === null ? null : wpm < 100 ? 'slow' : wpm > 175 ? 'fast' : 'good' } as const;
}
export function averageScores(list: Scores[]): Scores | null {
  if (!list.length) return null; const avg = (k: keyof Scores) => Math.round((list.reduce((a, s) => a + s[k], 0) / list.length) * 10) / 10;
  return { awareness: avg('awareness'), confidence: avg('confidence'), warmth: avg('warmth'), retention: avg('retention') };
}
