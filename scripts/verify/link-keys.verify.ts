// Checks lib/portal-key (signed portal links) and publicPrep (what a prep link may see of saved answers).
// Run: npx tsx scripts/verify/link-keys.verify.ts
import { createHmac } from 'crypto';
import { portalKey, checkPortalKey, portalKeysReady, PORTAL_KEY_LENGTH } from '../../src/lib/portal-key';
import { publicPrep } from '../../src/lib/prep-check-server';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };

const env = { LINK_SECRET: 'test-secret', NODE_ENV: 'production', VERCEL_ENV: 'production' };
const k = portalKey('t1', 'c1', env);
const want = createHmac('sha256', 'test-secret').update('t1:c1').digest('base64url').slice(0, 32);
ok(k === want, 'key is HMAC-SHA256 of tenant:client, base64url, first 32 chars');
ok(!!k && k.length === PORTAL_KEY_LENGTH && /^[A-Za-z0-9_-]+$/.test(k), 'key is 32 url-safe chars');
ok(portalKey('t1', 'c1', env) === k, 'same inputs, same key');
ok(portalKey('t1', 'c2', env) !== k && portalKey('t2', 'c1', env) !== k, 'different client or business, different key');
ok(portalKey('t1', 'c1', { ...env, LINK_SECRET: 'other' }) !== k, 'different secret, different key');
ok(checkPortalKey('t1', 'c1', k, env), 'the right key passes');
ok(!checkPortalKey('t1', 'c2', k, env), 'another client’s key fails');
ok(!checkPortalKey('t2', 'c1', k, env), 'another business’s key fails');
ok(!checkPortalKey('t1', 'c1', (k as string).slice(0, 31) + ((k as string)[31] === 'A' ? 'B' : 'A'), env), 'a one-character change fails');
ok(!checkPortalKey('t1', 'c1', '', env) && !checkPortalKey('t1', 'c1', undefined, env) && !checkPortalKey('t1', 'c1', 123 as any, env), 'empty or non-string fails');
ok(!checkPortalKey('t1', 'c1', (k as string) + 'x', env), 'wrong length fails');
ok(portalKey('', 'c1', env) === null && portalKey('t1', '', env) === null, 'missing ids give no key');

const prodNoSecret = { NODE_ENV: 'production', VERCEL_ENV: 'production' };
ok(!portalKeysReady(prodNoSecret) && portalKey('t1', 'c1', prodNoSecret) === null, 'production without a secret: no keys');
ok(!checkPortalKey('t1', 'c1', k, prodNoSecret), 'production without a secret: nothing passes');
const preview = { NODE_ENV: 'production', VERCEL_ENV: 'preview' };
ok(portalKeysReady(preview) && !!portalKey('t1', 'c1', preview), 'preview without a secret: a dev key works');
ok(portalKeysReady({ NODE_ENV: 'development' }), 'development without a secret: a dev key works');

const saved = { answers: { skin: 'yes', lift: 'n2', photo: 'https://x/y.jpg', blank: '' }, status: 'answered', answeredAt: '2026-10-01T10:00:00Z', agreedAt: null,
  quote: { changed: true, newPrice: 65, oldPrice: 55, lines: ['Repair × 2'], safety: { text: 'Please don’t come in with this.' } } };
const pub: any = publicPrep(saved);
ok(!('answers' in pub), 'saved answers are not sent back');
ok(!JSON.stringify(pub).includes('"yes"') && !JSON.stringify(pub).includes('y.jpg'), 'no answer values or photo links anywhere');
ok(pub.answeredIds.length === 3 && pub.answeredIds.includes('skin') && pub.answeredIds.includes('photo') && !pub.answeredIds.includes('blank'), 'which questions were answered');
ok(pub.status === 'answered' && pub.answeredAt === saved.answeredAt, 'status and when');
ok(pub.quote.newPrice === 65 && pub.quote.safety === null, 'the price change they saw, without the safety note');
ok(publicPrep(null) === null && publicPrep(undefined) === null, 'nothing saved, nothing sent');

console.log(bad ? `\n${bad} failed` : '\nAll passed'); process.exit(bad ? 1 : 0);
