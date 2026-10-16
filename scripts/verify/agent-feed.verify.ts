// scripts/verify/agent-feed.verify.ts — what assistants may do, and the plain-text guide.
import { agentPolicy, assistantAddon, holdable, publicService, agentErr } from '../../src/lib/agent-access';
import { guideText } from '../../src/lib/agent-feed';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
ok(agentPolicy({}).menu && agentPolicy({}).openTimes && !agentPolicy({}).holds, 'menu and open times on by default; holds off');
ok(!agentPolicy({ agents: { holds: true } }).holds, 'holds need the add-on');
ok(agentPolicy({ addons: { assistant: { active: true } }, agents: { holds: true } }).holds && assistantAddon({ addons: { assistant: true } }), 'add-on plus switch = holds');
ok(!agentPolicy({ addons: { assistant: true }, agents: { menu: false, holds: true } }).holds && !agentPolicy({ agents: { menu: false } }).openTimes, 'menu off turns everything off');
ok(publicService({ name: 'Gel' }) && !publicService({ name: 'x', isPrivate: true }) && !publicService({ name: 'x', type: 'addon' }), 'public menu only');
ok(holdable({ name: 'Gel' }) && !holdable({ name: 'x', consultationRequired: true }) && !holdable({ name: 'x', bookingMode: 'request' }) && !holdable({ name: 'x', membersOnly: true }), 'consultation, request-only and members-only are never held');
ok(JSON.stringify(agentErr('time_taken', 'Taken', { next: [1] })) === '{"ok":false,"code":"time_taken","message":"Taken","next":[1]}', 'answers carry a code and words');
const feed = { business: { name: 'Opal', tagline: null, timeZone: 'America/New_York', address: { street: '1 Main', city: 'Town', region: 'NY', postalCode: '10001' }, bookingUrl: 'https://x/book/opal' },
  services: [{ id: 'g', name: 'Gel manicure', category: 'Hands', price: 55, priceIsFrom: false, durationMinutes: 45, depositDollars: 10 }], addOns: [{ id: 'a', name: 'Art', price: 5, durationMinutes: 10 }],
  team: [{ id: 'm', name: 'Maya', title: 'Nail tech' }], policies: ['Cancel from your visit link.'],
  howToBook: { openTimes: 'https://x/api/agents/opal/open-times?service={serviceId}', book: { kind: 'link', url: 'https://x/book/opal', note: 'Send the client this booking link.' }, rules: ['Only the client confirms.'] } };
const g = guideText(feed);
ok(g.startsWith('# Opal') && g.includes('- Gel manicure (id g): $55, 45 min, $10 deposit') && g.includes('- Maya (id m), Nail tech') && g.includes('## Rules for assistants') && !/call us/i.test(g), 'the guide', g);
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
