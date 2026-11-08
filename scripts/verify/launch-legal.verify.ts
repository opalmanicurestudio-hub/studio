// Checks launch L5: the legal pieces a first business and its clients need.
// - The booking page, the booking form and the shop link to privacy and the text-message terms.
// - A business agrees to the platform terms at sign-up: the box must be ticked, the server refuses without it, and the
//   agreement is kept privately (who, when, which version), never on the public business record.
// - The legal pages take the company name, support email, address and governing state from settings.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-legal.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures } from './fake-db';

const read = (p: string) => readFileSync(p, 'utf8');
// The sign-up route runs against an in-memory database, with account creation stood in for.
const db = makeDb(); const made: string[] = []; const removed: string[] = [];
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({
    createUser: async (u: any) => { made.push(u.email); return { uid: `u${made.length}` }; }, deleteUser: async (uid: string) => { removed.push(uid); }, createCustomToken: async (uid: string) => `tok-${uid}` }) };
  return load.call(this, request, ...rest);
};
process.env.NEXT_PUBLIC_SIGNUP_OPEN = 'true';
const signup = (body: any, n: number) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'x-forwarded-for' ? `10.0.0.${n}` : k.toLowerCase() === 'user-agent' ? 'Safari' : null) } }) as any;
const who = { name: 'Jess Marshall', email: 'jess@opal.example', phone: '4045550101', password: 'secret123', businessName: 'Opal Nail Studio', type: 'salon', tools: [] };

(async () => {
console.log('Agreeing to the terms at sign-up');
const pageSrc = read('src/app/(auth)/signup/page.tsx');
check('the last step has an agree box linking the terms and the privacy policy, and Build stays off until it’s ticked',
  /type="checkbox" checked=\{agree\}/.test(pageSrc) && /href="\/legal\/terms"/.test(pageSrc) && /href="\/legal\/privacy"/.test(pageSrc) && /&& \(step < 2 \|\| agree\);/.test(pageSrc) && /agreeTerms: agree, termsVersion: TERMS_VERSION/.test(pageSrc));
const { POST } = await import('../../src/app/api/signup/route');
const { TERMS_VERSION } = await import('../../src/lib/legal');
let out: any = await (await POST(signup(who, 1))).json();
check('without the box ticked, no account is made', out.ok === false && /agree/.test(out.error) && made.length === 0, out);
out = await (await POST(signup({ ...who, agreeTerms: 'yes' }, 2))).json();
check('only a real yes counts', out.ok === false && made.length === 0);
out = await (await POST(signup({ ...who, agreeTerms: true, termsVersion: TERMS_VERSION }, 3))).json();
const tid = (await db.collection('tenants').get()).docs[0]?.id;
const agreed: any = tid ? (await db.doc(`tenants/${tid}/private/terms`).get()).data() : null;
check('ticked: the account and business are made, and the agreement is kept: who, when, which version', out.ok === true && made.length === 1 && agreed?.email === 'jess@opal.example' && agreed?.version === TERMS_VERSION && !!agreed?.acceptedAt && agreed?.ip === '10.0.0.3', { out, agreed });
const biz: any = tid ? (await db.doc(`tenants/${tid}`).get()).data() : {};
check('where the sign-up came from stays off the public business record', !('signupIp' in biz) && !JSON.stringify(biz).includes('10.0.0.3'), Object.keys(biz));
const rules = read('firestore.rules');
check('the private records under a business are closed to every browser', /match \/tenants\/\{tenantId\}\/private\/\{docId\} \{\s*allow read, write: if false;\s*\}/.test(rules));
// If saving the records fails, the account made a moment before is removed, so trying again starts clean.
const realBatch = db.batch; (db as any).batch = () => { const b = realBatch(); return { ...b, commit: async () => { throw new Error('write failed'); } }; };
const before = (await db.collection('tenants').get()).docs.length;
let res: any;
try { res = await POST(signup({ ...who, email: 'sam@opal.example', agreeTerms: true, termsVersion: TERMS_VERSION }, 4)); out = await res.json(); } finally { (db as any).batch = realBatch; }
check('when the records can’t be saved: the new account is removed and nothing is half made', res.status === 500 && out.ok === false && removed.length === 1 && (await db.collection('tenants').get()).docs.length === before, { status: res.status, out, removed });
out = await (await POST(signup({ ...who, email: 'old@opal.example' }, 5))).json();
check('an old copy of the page that never sent the box is told to reload', out.ok === false && out.code === 'terms' && /Reload this page/.test(out.error));

console.log('Links where clients book and buy');
const page = read('src/components/booking/StudioBookingPage.tsx');
const foot = page.slice(page.indexOf('<footer'), page.indexOf('</footer>'));
check('the booking page footer links to privacy and the text-message terms', foot.includes('href="/legal/privacy"') && foot.includes('href="/legal/sms"'));
const flow = read('src/components/booking/StudioFlow.tsx');
check('the booking form shows both links right under the text-message switches', /smsMarketingWording[\s\S]{0,200}<\/div>\s*<p[^>]*>\s*<a href="\/legal\/sms"[\s\S]{0,200}href="\/legal\/privacy"/.test(flow));
const shop = read('src/components/shop/ShopChrome.tsx');
check('the shop’s policies point shoppers to privacy and the text-message terms, not the business agreement', /\['Privacy policy', '\/legal\/privacy'\], \['Text message terms', '\/legal\/sms'\]/.test(shop) && !/'\/legal\/terms'/.test(shop));
const terms = read('src/app/legal/terms/page.tsx');
check('the terms page sends a client to the text-message terms, in words for any business', /href="\/legal\/sms"/.test(terms) && !/salon client|studio owner/.test(terms));

console.log('Company details from settings');
const L = read('src/lib/legal.ts');
check('name, support email, address, phone and state come from settings', ['NEXT_PUBLIC_LEGAL_NAME', 'NEXT_PUBLIC_SUPPORT_EMAIL', 'NEXT_PUBLIC_LEGAL_ADDRESS', 'NEXT_PUBLIC_LEGAL_PHONE', 'NEXT_PUBLIC_LEGAL_STATE'].every((k) => L.includes(`process.env.${k}`)));
for (const f of ['src/app/legal/terms/page.tsx', 'src/app/legal/privacy/page.tsx']) {
  const s = read(f);
  check(`${f.split('/').slice(-2, -1)[0]} page uses them`, /const LEGAL_ENTITY = LEGAL\.entity;/.test(s) && /const CONTACT_EMAIL = LEGAL\.email;/.test(s) && !/const CONTACT_EMAIL = '/.test(s));
}
check('the governing-law clause uses the state from settings', /const GOVERNING_STATE = LEGAL\.state;/.test(terms));
const { renderToStaticMarkup } = await import('react-dom/server');
const React = await import('react'); (globalThis as any).React = React;
const T = (await import('../../src/app/legal/terms/page')).default as any;
const P = (await import('../../src/app/legal/privacy/page')).default as any;
const th = renderToStaticMarkup(React.createElement(T)), ph = renderToStaticMarkup(React.createElement(P));
check('with nothing set yet: neutral governing-law wording, the support email shown, and no blank address or phone lines', /the state in which we are established/.test(th) && th.includes('mailto:') && !/undefined|null<br/.test(th + ph) && !/<br\/><br\/>/.test(th + ph));
check('no all-caps headings on the legal pages', !/uppercase/.test(terms) && !/uppercase/.test(read('src/app/legal/privacy/page.tsx')));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
})();
