// Checks the shared voice account's calls at once on HQ → System (design canvas: Voice calls on HQ System):
// lib/voice-capacity, the count of calls turned away (api/counter/voice start, lib/voice/retell-client), api/hq 'voice'
// and the System page.
// - Asked of the voice service itself: calls now and the limit, near from 80%, full at it; never waits long, and says so
//   when it can't be read or isn't set up.
// - Calls turned away because the account was full are counted by day (two weeks kept), and the week's shown.
// - Drive-thru calls live now are counted from the lane's own calls (half an hour at most).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/voice-capacity.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  return load.call(this, request, ...rest);
};
const src = (p: string) => fs.readFileSync(p, 'utf8');
const answer = (status: number, body: any) => ({ ok: status < 300, status, json: async () => body }) as any;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

(async () => {
  const V = await import('../../src/lib/voice-capacity');
  const full = { current_concurrency: 17, concurrency_limit: 20, base_concurrency: 20, purchased_concurrency: 0, concurrency_burst_enabled: false, concurrency_burst_limit: 0 };

  console.log('asking the voice service');
  check('its answer as numbers; anything else is unreadable', JSON.stringify(V.readConcurrency(full)) === JSON.stringify({ now: 17, limit: 20, base: 20, bought: 0, burst: false, burstLimit: 0 }) && V.readConcurrency({}) === null && V.readConcurrency(null) === null);
  check('near from 80% (16 of 20), full at the limit, fine below', V.voiceLevel(15, 20) === 'ok' && V.voiceLevel(16, 20) === 'near' && V.voiceLevel(20, 20) === 'full' && V.voiceLevel(25, 20) === 'full' && V.voiceLevel(0, 0) === 'ok');
  delete process.env.RETELL_API_KEY;
  let asked: any = null; const fetchOk = (async (url: string, init: any) => { asked = { url, init }; return answer(200, full); }) as any;
  check('not set up: not asked', (await V.concurrencyNow(fetchOk)) === null && asked === null);
  process.env.RETELL_API_KEY = 'key_test';
  const c = await V.concurrencyNow(fetchOk);
  check('set up: asked once, with the key, for calls now and the limit', c?.now === 17 && c.limit === 20 && asked.url === 'https://api.retellai.com/get-concurrency' && asked.init.method === 'GET' && asked.init.headers.Authorization === 'Bearer key_test' && !!asked.init.signal);
  check('…an error or no answer: unreadable, never thrown', (await V.concurrencyNow((async () => answer(500, {})) as any)) === null && (await V.concurrencyNow((async () => { throw new Error('down'); }) as any)) === null);

  console.log('turned away');
  check('full is a refusal for too many calls at once, nothing else (a 429 about requests isn’t)', V.refusedAsFull(429, '') && V.refusedAsFull(429, 'Concurrency limit reached') && V.refusedAsFull(400, 'Concurrency limit reached')
    && !V.refusedAsFull(429, 'Rate limit exceeded, slow down') && !V.refusedAsFull(500, 'Internal error') && !V.refusedAsFull(400, 'Bad agent'));
  const now = Date.now();
  await db.doc('platformHealth/voice_capacity').set({ byDay: { [day(now - 20 * 86400000)]: 9, [day(now - 10 * 86400000)]: 3, [day(now - 2 * 86400000)]: 2 } });
  await V.noteTurnedAway('drive-thru', db, now); await V.noteTurnedAway('phone', db, now);
  const h: any = (await db.doc('platformHealth/voice_capacity').get()).data();
  check('counted by day, one add each (never a read-and-write that a rush could trip over)', h.byDay[day(now)] === 2 && h.byDay[day(now - 2 * 86400000)] === 2 && h.byDay[day(now - 10 * 86400000)] === 3 && h.lastKind === 'phone'
    && /set\(\{ byDay: \{ \[dayOf\(now\)\]: FieldValue\.increment\(1\) \}/.test(src('src/lib/voice-capacity.ts')) && !/runTransaction/.test(src('src/lib/voice-capacity.ts')), h);
  const { placeRetellCall } = await import('../../src/lib/voice/retell-client');
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => answer(429, { message: 'Concurrency limit reached' });
  const pr = await placeRetellCall({ fromNumber: '+15550000000', toNumber: '+15551111111', dynamicVariables: {} });
  (globalThis as any).fetch = realFetch;
  check('a call we place, turned away because the account is full: counted', !pr.ok && (await db.doc('platformHealth/voice_capacity').get()).data().byDay[day(Date.now())] === 3);
  const voice = src('src/app/api/counter/voice/route.ts');
  check('a drive-thru assistant turned away the same way: counted, and the lane told to take it by hand', /if \(refusedAsFull\(r\.status, r\.data\?\.message \|\| r\.data\?\.error_message\)\) \{ await noteTurnedAway\('drive-thru', db\); return bad\('The voice assistant is on as many calls as it can take right now\. Take this order by hand\.', 503\); \}/.test(voice));

  console.log('what HQ shows');
  await db.doc('driveThruCalls/c1').set({ status: 'live', startedAt: new Date(now - 60000).toISOString() });
  await db.doc('driveThruCalls/c2').set({ status: 'live', startedAt: new Date(now - 5 * 60000).toISOString() });
  await db.doc('driveThruCalls/c3').set({ status: 'live', startedAt: new Date(now - 3 * 3600000).toISOString() });
  await db.doc('driveThruCalls/c4').set({ status: 'ended', startedAt: new Date(now - 60000).toISOString() });
  await db.doc('driveThruCalls/c5').set({ status: 'taking_over', startedAt: new Date(now - 2 * 60000).toISOString() });
  let v: any = await V.voiceCapacityView(db, { now, fetchImpl: fetchOk });
  check('calls now against the limit, near; at drive-thrus now, someone taking over included (one that never said it ended isn’t counted after half an hour); turned away this week',
    v.setUp && v.read && v.now === 17 && v.limit === 20 && v.level === 'near' && v.atDriveThrus === 3 && v.turnedAway === 5 && !!v.lastTurnedAway, v);
  check('…days older than two weeks let go when it’s read', !(day(now - 20 * 86400000) in (await db.doc('platformHealth/voice_capacity').get()).data().byDay) && (await db.doc('platformHealth/voice_capacity').get()).data().byDay[day(now - 10 * 86400000)] === 3);
  v = await V.voiceCapacityView(db, { now, fetchImpl: (async () => answer(503, {})) as any });
  check('…the voice service not answering: said so, the rest still shown', v.setUp && !v.read && v.now === undefined && v.atDriveThrus === 3, v);
  delete process.env.RETELL_API_KEY;
  v = await V.voiceCapacityView(db, { now, fetchImpl: fetchOk });
  check('…not set up: said so', !v.setUp && !v.read, v);

  console.log('HQ');
  const hq = src('src/app/api/hq/route.ts'); const page = src('src/app/(app)/admin/system/page.tsx');
  check('only for HQ people who can see System, asked on its own', /readiness: 'system', voice: 'system',/.test(hq) && /if \(b\.action === 'voice'\) \{/.test(hq) && /hq\(\{ action: 'voice' \}\)/.test(page));
  check('the System page: calls now of the limit as a meter, near and at the limit said with what to do, at drive-thrus and turned away, not connected said plainly',
    /role="meter" aria-label="Voice calls at once" aria-valuemin=\{0\} aria-valuemax=\{Math\.max\(1, v\.limit\)\} aria-valuenow=\{v\.now\} aria-valuetext=\{`\$\{v\.now\} of \$\{v\.limit\} calls at once`\}/.test(page) && /aria-live="polite">\{v\.now\}/.test(page)
    && /At the included limit: new calls are running on burst, at a surcharge\./.test(page) && /Close to the limit\./.test(page) && /At the limit: new calls wait or are turned away right now\./.test(page) && /'At drive-thrus now'/.test(page) && /'Turned away, 7 days'/.test(page)
    && /The voice service isn’t connected, so there are no voice calls to count\./.test(page) && /min-h-\[44px\][^\n]*Check again/.test(page));
  const mine = page.slice(page.indexOf('function VoiceCalls'), page.indexOf('export default function')) + src('src/lib/voice-capacity.ts');
  check('in the app’s own words', !/font-black|\buppercase\b|call us|contact us|✓|⚠/.test(mine) && !/ · /.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
