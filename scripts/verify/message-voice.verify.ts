// scripts/verify/message-voice.verify.ts — every message sounds professional first and carries the details a client needs
// (docs/message-voice.md): greeted by first name, full sentences, no shorthand or emoji, at most one exclamation mark, and
// the visit named (service, provider, day and time) in the texts that move, confirm or ask about an appointment.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/message-voice.verify.ts
import { check, failures } from './fake-db';

(async () => {
  const { MESSAGE_KINDS } = await import('../../src/lib/message-policy');
  const TE = await import('../../src/lib/tidy-engine');
  const DL = await import('../../src/lib/delay');
  const DS = await import('../../src/lib/disruptions');
  const FR = await import('../../src/lib/forms-remind');

  const SHORTHAND = [/\bheads up\b/i, /\bfyi\b/i, /\bappts?\b/i, /\basap\b/i, /\bno-show\b/i, /\bhang tight\b/i, /\bsnag\b/i, /\bgrab a time\b/i, /\byou're good\b/i, /\ball set!/i, /\b\d+\s?(h|hr|hrs|min|mins)\b/i];
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const problems = (t: string) => {
    const out: string[] = SHORTHAND.filter((r) => r.test(t)).map(String);
    if (EMOJI.test(t)) out.push('emoji');
    if ((t.match(/!/g) || []).length > 1) out.push('more than one exclamation mark');
    return out;
  };

  console.log('The shipped wording of every message');
  // Staff alerts are written to the team ("Action needed: …"); these few carry only a code or a link, or are written per
  // event by their sender with the names and dates in them (the default here is only the fallback).
  const STAFF = (k: any) => k.group === 'Your team' || /^Alert me/.test(k.label) || /^staff_|^owner_/.test(k.id);
  const NO_GREETING = new Set(['renter_signin_code', 'account_link', 'renter_day_swap']);
  const loose: string[] = []; const ungreeted: string[] = [];
  for (const k of MESSAGE_KINDS as any[]) {
    for (const t of [k.defaultSubject, k.defaultBody]) { const p = problems(String(t || '')); if (p.length) loose.push(`${k.id}: ${p.join(', ')}`); }
    if (!STAFF(k) && !NO_GREETING.has(k.id) && !/^Hi \{\{[a-z_]+\}\}[,.]/.test(String(k.defaultBody || ''))) ungreeted.push(k.id);
  }
  check(`no shorthand, emoji or extra exclamation marks in any of the ${MESSAGE_KINDS.length} messages`, loose.length === 0, loose);
  check('every message to a client or renter opens with “Hi” and their first name', ungreeted.length === 0, ungreeted);

  const link = 'https://opal.example/m/t1/abc';
  const sms = (name: string, t: string, must: (string | RegExp)[]) => {
    const missing = must.filter((m) => !(typeof m === 'string' ? t.includes(m) : m.test(t))).map(String);
    check(name, /^Hi [A-Z][a-z]+, /.test(t) && problems(t).length === 0 && missing.length === 0 && t.replace(link, '').length <= 330, { missing, problems: problems(t), length: t.replace(link, '').length, t });
  };

  console.log('Tidy my day');
  sms('the ask (today): the provider, both times, the service and price unchanged, what happens if she does nothing, the answer-by time and the link',
    TE.askText({ first: 'Cara', provider: 'Maya', to: '1:00 PM', from: '4:30 PM', service: 'gel fill', link, sameDay: true, by: '11:31 AM' }),
    ['Maya has an earlier opening today', 'at 1:00 PM instead of 4:30 PM', 'gel fill and its price will stay the same', "there's nothing you need to do", 'by 11:31 AM', link]);
  sms('the ask (another day): the service with the provider, from and to with the day, and the link',
    TE.askText({ first: 'Ana', provider: 'Maya', to: 'Wednesday, Oct 21 at 2:00 PM', from: 'Monday, Oct 19 at 10:00 AM', service: 'gel fill', link, sameDay: false, by: 'tomorrow at 8:00 AM' }),
    ['gel fill with Maya from Monday, Oct 19 at 10:00 AM to Wednesday, Oct 21 at 2:00 PM', link]);
  sms('the confirmation: thanks, the service with the provider and the new time', TE.doneText({ first: 'Cara', to: 'today at 1:00 PM', service: 'gel fill', provider: 'Maya' }), ['thank you so much for being flexible', 'gel fill with Maya is now confirmed for today at 1:00 PM']);
  sms('no change after all: the service with the provider, the time it stays at, and an apology', TE.noChangeText({ first: 'Bea', from: 'today at 2:00 PM', service: 'gel fill', provider: 'Maya' }), ['gel fill with Maya will stay at its original time, today at 2:00 PM', "We're sorry"]);

  console.log('Running late');
  const H = 3600e3; const at = Date.parse('2026-10-14T15:00:00-04:00');
  sms('an apology, the provider, the booked time and the new time', DL.delayClientText({ first: 'Ana', provider: 'Jo', startMs: at, expectedMs: at + H / 4, timeZone: 'America/New_York' }), ['Jo is running about 15 minutes behind', 'sorry', '3:00 PM', '3:15 PM']);

  console.log('Forms before a visit');
  sms('the reminder: the visit, what’s left and how long, the due time, what happens if it isn’t done, and the link',
    FR.formsReminderText({ first: 'Dana', service: 'gel fill', provider: 'Maya', visitAt: 'Sat at 3:30 PM', list: 'Consent and release (about 1 minute)', n: 1, due: 'Fri at 3:30 PM', then: FR.formsThen(true, 'auto'), link }),
    ['gel fill with Maya on Sat at 3:30 PM', 'Consent and release (about 1 minute)', 'by Fri at 3:30 PM', 'release your appointment time', link]);
  sms('the thank-you: the service with the provider and the time', FR.formsDoneText({ first: 'Dana', service: 'gel fill', provider: 'Maya', when: 'Saturday at 3:30 PM' }), ['gel fill with Maya on Saturday at 3:30 PM']);

  console.log('A provider can’t make it');
  const dm = DS.disruptionMessage({ kind: 'callout', providerFirst: 'Maya', first: 'Ana', when: 'on Thursday', service: 'gel fill', hasDeposit: true, studio: 'Opal' });
  check('an apology, the provider, the service, the choices and “no fee”', /^Hi Ana, /.test(dm) && problems(dm).length === 0 && /sorry/.test(dm) && /Maya/.test(dm) && /gel fill/.test(dm) && /no fee/.test(dm), dm);

  console.log('Every text goes out in plain characters');
  const { plainText } = await import('../../src/lib/sms');
  const { segmentsFor } = await import('../../src/lib/campaign-engine');
  const ask = 'Opal: ' + TE.askText({ first: 'Cara', provider: 'Maya', to: '1:00\u00a0PM', from: '4:30\u202fPM', service: 'gel fill', link, sameDay: true, by: '11:31\u00a0AM' });
  check('curly quotes and the hidden spaces in times are swapped for plain ones before a text is sent', plainText('It\u2019s 1:00\u202fPM \u201cok\u201d') === 'It\'s 1:00 PM "ok"' && /plainText\(body\)/.test(require('fs').readFileSync('src/lib/sms.ts', 'utf8')));
  check('…so the Tidy my day ask is billed as 3 parts, not 6', segmentsFor(plainText(ask)) <= 3 && segmentsFor(ask) > segmentsFor(plainText(ask)), { plain: segmentsFor(plainText(ask)), raw: segmentsFor(ask) });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
