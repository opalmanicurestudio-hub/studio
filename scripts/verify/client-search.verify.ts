// Checks client search keys: names, emails and phone numbers are findable by how people type them.
// Run: npx tsx scripts/verify/client-search.verify.ts
import { clientSearchKeys, searchTermKey, matchesSearch, sameKeys } from '../../src/lib/client-search';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const c = { name: 'Zoë O’Brien-Marshall', email: 'Zoe.OB@Example.com', phone: '+1 (917) 555-0142' };
const keys = clientSearchKeys(c);
for (const t of ['zo', 'zoe', 'obrien', 'brien', 'marsh', 'zoe.ob', 'zoe.ob@ex', '917', '9175550142', '0142', '5550142'])
  ok(keys.includes(searchTermKey(t)!), `"${t}" finds them`);
ok(searchTermKey('(917) 555') === '917555', 'a typed phone number becomes digits');
ok(searchTermKey('Jess Mar') === 'jess', 'two words look up the longer, then both must match');
ok(matchesSearch({ name: 'Jessica Marshall' }, 'jess mar') && !matchesSearch({ name: 'Jessica Lane' }, 'jess mar'), 'every typed word must start one of their names');
ok(!keys.includes('555'), 'the middle of a phone number isn’t a key (only area code onward and the last digits)');
ok(keys.length <= 180, `keys stay small (${keys.length})`);
ok(sameKeys([...keys].reverse(), keys) && !sameKeys(keys.slice(1), keys), 'unchanged keys aren’t rewritten');
ok(clientSearchKeys({ name: '' }).length === 0 && searchTermKey('  ') === null, 'empty records and searches are safe');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
