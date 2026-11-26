// Checks adding a business's first card reader (sweep before launch, part 1): lib/terminal-location, used by
// api/stripe/terminal/register-reader and api/stripe/terminal/connection-token.
// - A café that never opens the front desk can add its reader in Settings: the readers' location (the business's real
//   address) is made then, once, and kept.
// - Without a connected account or a full address it says what to do, and makes nothing.
// - The front desk's reader connecting makes it the same way, and reuses one already made.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/reader-setup.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const S = { locations: [] as any[], readers: [] as any[], tokens: 0 };
class FakeStripe {
  terminal = {
    locations: { create: async (p: any, o: any) => { const l = { id: `tml_${S.locations.length + 1}`, ...p, acct: o?.stripeAccount }; S.locations.push(l); return l; } },
    readers: { create: async (p: any, o: any) => { if (p.registration_code !== 'simulated-wpe') throw new Error('No reader matches that registration code.'); const r = { id: `tmr_${S.readers.length + 1}abcd`, label: p.label, location: p.location, device_type: 'simulated_wisepos_e', acct: o?.stripeAccount }; S.readers.push(r); return r; } },
    connectionTokens: { create: async (p: any) => { S.tokens++; return { secret: `pst_${p.location}` }; } },
  };
}
class NR { status: number; body: any; constructor(body: any, init: any = {}) { this.body = body; this.status = init.status || 200; } static json(body: any, init?: any) { return new NR(body, init); } }
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: NR };
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ deny: null, actor: { uid: 'm1', role: 'manager' } }) };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  return load.call(this, request, ...rest);
};
const req = (b: any) => ({ json: async () => b, headers: { get: () => null } }) as any;
const get = async (p: string) => (await db.doc(p).get()).data() || null;

(async () => {
  const L = await import('../../src/lib/terminal-location');
  const REG = await import('../../src/app/api/stripe/terminal/register-reader/route');
  const TOK = await import('../../src/app/api/stripe/terminal/connection-token/route');
  const address = { street: '12 Main St', city: 'Austin', state: 'TX', zip: '78701' };

  console.log('a café adding its first reader');
  await db.doc('tenants/cafe').set({ name: 'Corner Café', stripeAccountId: 'acct_cafe', studioAddressParts: address });
  let r: any = await REG.POST(req({ tenantId: 'cafe', code: 'simulated wpe', label: 'By the door' }));
  const t1: any = await get('tenants/cafe');
  check('the reader is added without opening the front desk: the location is made from the real address, then kept', r.status === 200 && r.body.ok && r.body.deviceType === 'simulated_wisepos_e'
    && S.locations.length === 1 && S.locations[0].address.line1 === '12 Main St' && S.locations[0].address.postal_code === '78701' && S.locations[0].acct === 'acct_cafe'
    && t1.stripeTerminalLocationId === 'tml_1' && S.readers[0].location === 'tml_1' && S.readers[0].acct === 'acct_cafe', { body: r.body, loc: S.locations, t1 });
  r = await REG.POST(req({ tenantId: 'cafe', code: 'simulated-wpe', label: 'Second' }));
  check('a second reader uses the same location', r.body.ok && S.locations.length === 1 && S.readers[1].location === 'tml_1', S.readers);
  r = await TOK.POST(req({ tenantId: 'cafe' }));
  check('…and so does the front desk’s reader connecting', r.status === 200 && S.locations.length === 1 && S.tokens === 1, r.body);

  console.log('not ready yet');
  await db.doc('tenants/noacct').set({ name: 'No account', studioAddressParts: address });
  await db.doc('tenants/noaddr').set({ name: 'No address', stripeAccountId: 'acct_x', studioAddressParts: { street: '1 Elm', city: 'Austin' } });
  const [a, b2, c] = await Promise.all([REG.POST(req({ tenantId: 'noacct', code: 'simulated-wpe' })), REG.POST(req({ tenantId: 'noaddr', code: 'simulated-wpe' })), TOK.POST(req({ tenantId: 'noaddr' }))]) as any[];
  check('without a connected account or a full address it says what to do, and makes nothing', a.status === 400 && /Connect your Stripe account/.test(a.body.error) && b2.status === 400 && /business address/.test(b2.body.error)
    && c.status === 400 && /business address/.test(c.body.error) && S.locations.length === 1 && !(await get('tenants/noaddr')).stripeTerminalLocationId, [a.body, b2.body, c.body]);
  r = await REG.POST(req({ tenantId: 'cafe', code: 'wrong-code' }));
  check('a code that matches no reader says to make a new one', r.status === 400 && /didn’t match a reader/.test(r.body.error), r.body);

  console.log('the front desk first');
  await db.doc('tenants/desk').set({ name: 'Desk First', stripeAccountId: 'acct_desk', studioAddressParts: address });
  r = await TOK.POST(req({ tenantId: 'desk' }));
  const r2: any = await REG.POST(req({ tenantId: 'desk', code: 'simulated-wpe' }));
  check('made by the front desk, then used when a reader is added', r.status === 200 && r2.body.ok && S.locations.length === 2 && (await get('tenants/desk')).stripeTerminalLocationId === 'tml_2' && S.readers[2].location === 'tml_2');
  await db.doc('tenants/gone').set({ name: 'Disconnected', stripeTerminalLocationId: 'tml_old', studioAddressParts: address });
  r = await REG.POST(req({ tenantId: 'gone', code: 'simulated-wpe' }));
  check('a business that disconnected its account is told to connect it, even with a reader location saved (nothing reaches the card company)', r.status === 400 && /Connect your Stripe account/.test(r.body.error) && S.readers.length === 3, r.body);
  check('the shared step lives in one place', typeof L.ensureTerminalLocation === 'function'
    && !/Open the front desk once/.test(require('fs').readFileSync('src/app/api/stripe/terminal/register-reader/route.ts', 'utf8')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
