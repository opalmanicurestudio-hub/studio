// Practice a shift: talking with clients. Run: npx tsx scripts/verify/practice-talk.verify.ts
import * as T from '../../src/lib/practice/talk';
let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` (${JSON.stringify(info)})`}`); if (!ok) fails++; };
const base = T.sanitizeContext({ name: 'Rosa', persona: 'Warm regular.', kind: 'regular', visits: 4, service: 'Gel manicure', provider: 'Ana', items: ['Cuticle oil'], total: '$62.50', prefersPay: 'card',
  rebook: { wants: 'yes, in 3 weeks (your usual)', done: null }, offer: { wants: 'Nail Club', offered: [], catalog: ['Nail Club: $39/month'] }, mood: 0.9, waitedMinutes: 2, lineLength: 2, stage: 'ticket open, not paid', history: [] });
const names = { nailclub: 'Nail Club', hairclub: 'Silk Press Club', barber: 'Barber Club', facial5: 'Facial package', lash3: 'Lash lift package' };

console.log('Keeping the prompt safe');
{ const c = T.sanitizeContext({ name: 'x'.repeat(500), history: Array.from({ length: 40 }, (_, i) => ({ who: i % 2 ? 'you' : 'client', text: 'y'.repeat(900) })), mood: 9, lineLength: -3 });
  check('long fields are clipped', c.name.length <= 60 && c.history.length === 10 && c.history[0].text.length <= 300);
  check('numbers are kept in range', c.mood === 1 && c.lineLength === 0); }
{ const p = T.talkPrompt(base, 'Welcome back, Rosa! How was your manicure?');
  check('the prompt carries the client’s fixed wishes', /3 weeks/.test(p) && /Nail Club/.test(p) && /Welcome back, Rosa/.test(p)); }

console.log('Reading the reply');
{ const r = T.parseTalk('Sure! {"reply":"It was perfect, thank you!","tone":"happy","moodDelta":0.1,"detected":{"greeting":"great","offeredRebook":false,"offeredOffer":"nailclub","declineHandling":null},"coach":{"scores":{"awareness":4,"confidence":5,"warmth":5,"retention":4},"tip":"Nice use of her name."}}');
  check('valid JSON is read, even with text around it', !!r && r.reply.startsWith('It was perfect') && r.detected.greeting === 'great' && r.detected.offeredOffer === 'nailclub' && r.coach.scores.warmth === 5, r); }
{ const r = T.parseTalk('{"reply":"Hi","tone":"furious","moodDelta":5,"detected":{"offeredOffer":"free stuff","greeting":"amazing"},"coach":{"scores":{"warmth":99}}}');
  check('odd values are corrected', !!r && r.tone === 'neutral' && r.moodDelta === 0.2 && r.detected.offeredOffer === null && r.detected.greeting === null && r.coach.scores.warmth === 5, r); }
check('no JSON = no reply (falls back)', T.parseTalk('Hello there') === null);

console.log('Basic mode (no AI connected)');
{ const r = T.basicTalk(base, 'Welcome back, Rosa! How was your manicure?', names); check('a warm greeting with her name scores warmth', r.detected.greeting === 'great' && r.coach.scores.warmth === 5 && r.moodDelta > 0, r); }
{ const r = T.basicTalk({ ...base, history: [{ who: 'you', text: 'hi' }] }, 'Would you like to book your next visit in 3 weeks?', names); check('rebooking is understood', r.detected.offeredRebook && /book/i.test(r.reply), r); }
{ const r = T.basicTalk({ ...base, history: [{ who: 'you', text: 'hi' }] }, 'Have you heard about our Nail Club?', names); check('a membership mention is understood, and she says yes', r.detected.offeredOffer === 'nailclub' && /sign me up/i.test(r.reply), r); }
{ const c = { ...base, declined: true, history: [{ who: 'you' as const, text: 'hi' }] };
  check('after a decline: kind = great', T.basicTalk(c, 'Hmm, that one didn’t go through. Want to try another card?', names).detected.declineHandling === 'great');
  check('after a decline: blunt = loud', T.basicTalk(c, 'Your card was declined.', names).detected.declineHandling === 'loud');
  check('after a decline: money talk = pry', T.basicTalk(c, 'Do you have enough money on it?', names).detected.declineHandling === 'pry'); }
{ const c = T.sanitizeContext({ ...base, name: 'Ava', kind: 'new', details: { phone: '9195550142', email: 'ava.reyes@mailbox.com', promo: false, saved: false }, history: [{ who: 'you', text: 'hi' }] });
  const r = T.basicTalk(c, 'Can I get your phone number?', names); check('a first-timer reads out her number', r.detected.askedPhone && /919, 555, 0142/.test(r.reply), r); }
{ const r = T.basicTalk({ ...base, history: [{ who: 'you', text: 'hi' }] }, 'Next!', names); check('“Next!” lands badly', r.tone === 'annoyed' && r.coach.scores.warmth === 1); }

console.log('Basic mode on the phone');
{ const f = { name: 'Kim', full: 'Kim Alvarez', want: 'cancel' as const, when: 'tomorrow at 9', service: 'lash lift', prefers: 'Sat 1:00 PM', phone: '9195550126', found: false, offered: false, outcome: null };
  const a = T.basicCall(f, 'Thank you for calling Opal Salon, this is Jess. How can I help?', []); check('a warm answer gets the reason for the call', a.detected.greeting === 'great' && /cancel my lash lift/.test(a.reply), a);
  const b = T.basicCall(f, 'I can move that for you. Would Saturday at 1 work instead?', [{ who: 'you', text: 'hi' }]); check('offering another day is understood, and she takes it', b.detected.offeredRebook && /Sat 1:00 PM/.test(b.reply), b);
  const c = T.basicCall(f, 'Okay, I’ll cancel it.', [{ who: 'you', text: 'hi' }]); check('cancelling straight away gets a coaching tip', /offer another day/i.test(c.coach.tip), c);
  const d = T.basicCall(f, 'Can I get your last name?', [{ who: 'you', text: 'hi' }]); check('she gives her full name', d.reply.includes('Kim Alvarez')); }

console.log('How it was said');
{ const d = T.delivery('Um, so, like, would you, uh, like to book?', 4); check('fillers are counted (“like” only between commas)', d.fillers === 3, d); check('pace is measured', d.wpm === 135 && d.pace === 'good', d); }
check('no timing = no pace', T.delivery('Hello there', null).wpm === null);
check('“would you like” is not a filler', T.fillerCount('Would you like to book your next visit?') === 0);
check('scores average', JSON.stringify(T.averageScores([{ awareness: 4, confidence: 3, warmth: 5, retention: 2 }, { awareness: 2, confidence: 5, warmth: 4, retention: 4 }])) === JSON.stringify({ awareness: 3, confidence: 4, warmth: 4.5, retention: 3 }));

console.log(fails ? `\n${fails} failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
