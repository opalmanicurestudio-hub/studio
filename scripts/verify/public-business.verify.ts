// Checks the public view of each business (design board "A public view of each business"): lib/public-business,
// api/public/business, lib/public-business-client, and the public pages switched to it (the booking page, the visit
// completion page, both client portal pages, the walk-in screen, the visit link, job applications, quote requests, tour
// and interview invites, and the booking page's FAQ and gallery).
// - Only the public details are handed out: private settings (pay and clock-in rules, margins, Stripe and billing, API
//   keys and access codes, fraud limits, the plan) never are, nor anything added to the record later.
// - Settings that mix both are handed out in part; a locked business shows as closed, never why.
// - No public page reads the business's record itself any more; and every business detail the public pages' code
//   touches is on the public list or the known-private list (so a new one is a decision, not an accident).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/public-business.verify.ts
import Module from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { makeDb, check, failures } from './fake-db';

const db: any = makeDb();
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body, headers: init?.headers || {} }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  return load.call(this, request, ...rest);
};
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const PB = await import('../../src/lib/public-business');
  const TA = await import('../../src/lib/tenant-access');
  const record: any = {
    name: 'Opal Test', logoUrl: 'https://x/logo.png', phone: '555-0100', email: 'hi@example.com', address: { street: '1 Main', city: 'Town' },
    timezone: 'America/New_York', bookingPageSettings: { showFaq: true, faqs: [{ q: 'Parking?', a: 'Yes' }], automationRules: { requireInsurance: true } },
    clientNotify: { rescheduleCutoffHours: 4, ownerPhone: '555-0199', ownerBrief: true }, loyalty: { on: true, quiet: { on: true, windows: [] }, tiers: [{ name: 'Gold' }], commission: 'reduce', rewards: [{ costCents: 400 }], auto: { budget: 50 } },
    referrals: { on: true, rewardCents: 1000, margin: 0.4 }, makingItRight: { redoWindowDays: 10, channels: { visitLink: true }, aftercare: { text: 'Keep dry' }, payRules: { redoProvider: 'half' }, deskLimitCents: 5000, cashRefund: { twoPerson: true },
      reviews: { on: true, googlePlaceId: 'gp1', maxStars: 3 }, fairUse: { requirePhotos: false, refundToOriginalCard: true, maxFixes: 2, wearDays: 14 } },
    privacy: { healthMode: true, discreet: true, retentionYears: 7, modelAgreementSigned: true }, guestExperienceEnabled: true, studioAddress: '1 Main St',
    bookingPolicies: { changeCutoffHours: 2, staffOpsLevel: 'full', textAssist: true }, bookingMode: { mode: 'request', holdMinutes: 10, autoApproveAfterVisits: 3 }, depositPolicy: { mode: 'percent', percent: 20 },
    cancellationWindowHours: 24, cancellationFee: 15, modules: { retail: true }, giftCardSettings: { online: true, offers: [{ buyCents: 5000, bonusCents: 500 }], advancedLimits: true, buyerThanks: false },
    retailSettings: { timeZone: 'America/New_York', shopTagline: 'Hello', shippoApiKey: 'shippo_live_secret', wholesaleAccessCode: 'WHOLE1', claimAutoResolveMaxCents: 5000, taxRatePercent: 7 },
    kioskSettings: { logoUrl: 'https://x/k.png', pin: '1234' }, automations: { overtimeSuggest: true, reminderTemplate: 'x' }, orderAhead: { on: true, curbside: false, prepMinutes: 9 },
    // Private: pay and clock-in rules, margins, Stripe and billing, the plan, texting account, fraud and recovery limits.
    overtimeMultiplier: 1.5, minimumShiftMinutes: 120, tmhr: 80, restocking: { markupPct: 40 }, stripeAccountId: 'acct_secret', stripeCustomerId: 'cus_secret',
    subscriptionStatus: 'active', planId: 'pro', twilioAuthToken: 'tok_secret', twilioAccountSid: 'AC_secret', maxAutonomousRecoveryAmount: 200, roles: { a: { caps: [] } },
    staffPrivacy: { x: 1 }, userId: 'uid_owner', ownerEmail: 'owner@example.com', addons: { voice: true }, voiceAgent: { on: true }, wifiPassword: 'pw',
    someNewSettingAddedLater: { secret: true },
  };
  const out: any = PB.publicBusiness('t1', record);
  const json = JSON.stringify(out);
  check('the public details are handed out', out.id === 't1' && out.name === 'Opal Test' && out.phone === '555-0100' && out.bookingPageSettings.faqs.length === 1 && out.depositPolicy.percent === 20
    && out.cancellationWindowHours === 24 && out.modules.retail === true && out.timezone === 'America/New_York', out);
  check('…private settings never are, nor anything added to the record later', !/secret|shippo|WHOLE1|uid_owner|owner@example|1234|"pw"/.test(json)
    && ['overtimeMultiplier', 'minimumShiftMinutes', 'tmhr', 'restocking', 'stripeAccountId', 'subscriptionStatus', 'planId', 'maxAutonomousRecoveryAmount', 'roles', 'staffPrivacy', 'userId', 'ownerEmail', 'addons', 'voiceAgent', 'wifiPassword', 'someNewSettingAddedLater', 'twilioAuthToken'].every((k) => !(k in out)), Object.keys(out));
  check('…settings that mix both are handed out in part', out.retailSettings.shopTagline === 'Hello' && !('shippoApiKey' in out.retailSettings) && !('claimAutoResolveMaxCents' in out.retailSettings) && !('taxRatePercent' in out.retailSettings)
    && out.giftCardSettings.online === true && out.giftCardSettings.offers.length === 1 && !('advancedLimits' in out.giftCardSettings) && out.kioskSettings.logoUrl && !('pin' in out.kioskSettings)
    && out.automations.overtimeSuggest === true && !('reminderTemplate' in out.automations) && out.orderAhead.on === true && !('prepMinutes' in out.orderAhead)
    && out.clientNotify.rescheduleCutoffHours === 4 && !('ownerPhone' in out.clientNotify) && !json.includes('555-0199')
    && out.referrals.rewardCents === 1000 && !('margin' in out.referrals) && out.makingItRight.redoWindowDays === 10 && out.makingItRight.aftercare.text === 'Keep dry' && out.makingItRight.channels.visitLink === true
    && !('payRules' in out.makingItRight) && !('deskLimitCents' in out.makingItRight) && !('cashRefund' in out.makingItRight)
    && out.loyalty.on === true && out.loyalty.quiet.on === true && !('tiers' in out.loyalty) && !('rewards' in out.loyalty) && !('auto' in out.loyalty) && !('commission' in out.loyalty)
    && JSON.stringify(out.makingItRight.reviews) === '{"on":true,"googlePlaceId":"gp1"}' && JSON.stringify(out.makingItRight.fairUse) === '{"requirePhotos":false,"refundToOriginalCard":true}'
    && JSON.stringify(out.privacy) === '{"healthMode":true,"discreet":true}' && out.guestExperienceEnabled === true && out.studioAddress === '1 Main St'
    && out.bookingPolicies.changeCutoffHours === 2 && !('staffOpsLevel' in out.bookingPolicies) && !('textAssist' in out.bookingPolicies)
    && out.bookingMode.holdMinutes === 10 && !('autoApproveAfterVisits' in out.bookingMode), out);
  check('…a setting kept as a plain value by an older version is shown as it is', PB.publicBusiness('t1', { bookingMode: 'request' }).bookingMode === 'request');
  check('…the booking page’s settings whole, but the space-rental rules and renter discount kept with the team', out.bookingPageSettings.showFaq === true && !('automationRules' in out.bookingPageSettings) && !('renterDayDiscountPercent' in out.bookingPageSettings), out.bookingPageSettings);
  // Stand-ins for what the server's database hands back: a stored date, a map point, and a link to another record, which
  // carries the server's own connection (keys included).
  class Timestamp { constructor(private d: Date) {} toDate() { return this.d; } }
  class GeoPoint { constructor(public latitude: number, public longitude: number) {} }
  class Settings { privateKey = '-----BEGIN PRIVATE KEY-----secret'; clientEmail = 'svc@project.iam.example'; }
  class DocumentReference { _firestore = { _settings: new Settings() }; id = 'x'; path = 'tenants/other'; }
  const dated: any = PB.publicBusiness('t1', { name: 'D', makingItRight: { policySince: new Timestamp(new Date('2026-11-01T12:00:00Z')) },
    bookingPageSettings: { at: new Date('2026-10-01T00:00:00Z'), list: [{ when: new Timestamp(new Date('2026-09-01T00:00:00Z')) }], where: new GeoPoint(40.7, -74), link: new DocumentReference(), links: [new DocumentReference(), 'ok'] },
    address: new DocumentReference(), bookingPolicies: new DocumentReference() });
  const datedJson = JSON.stringify(dated);
  check('…stored dates come through as times and map points as latitude and longitude', dated.makingItRight.policySince === '2026-11-01T12:00:00.000Z' && dated.bookingPageSettings.at === '2026-10-01T00:00:00.000Z'
    && dated.bookingPageSettings.list[0].when === '2026-09-01T00:00:00.000Z' && dated.bookingPageSettings.where.latitude === 40.7 && dated.bookingPageSettings.where.longitude === -74, dated);
  check('…and anything that isn’t plain data is dropped, so a link to another record can never carry the server’s keys out', !/PRIVATE KEY|iam\.example|_firestore|tenants\/other/.test(datedJson)
    && !('link' in dated.bookingPageSettings) && JSON.stringify(dated.bookingPageSettings.links) === '[null,"ok"]' && !('address' in dated) && !('bookingPolicies' in dated), datedJson);
  check('…an open business says nothing about its account', !('accessLocked' in out) && !('suspended' in out) && TA.accessLockOf(out).locked === false);
  const lockedPast: any = PB.publicBusiness('t1', { ...record, subscriptionStatus: 'past_due', gracePeriodEndsAt: new Date(Date.now() - 86400000).toISOString() });
  const paused: any = PB.publicBusiness('t1', { ...record, suspended: true });
  check('…a locked business shows as closed, never why', lockedPast.accessLocked === true && TA.accessLockOf(lockedPast).locked === true && !('subscriptionStatus' in lockedPast) && !('gracePeriodEndsAt' in lockedPast)
    && TA.accessLockOf(paused).locked === true, { lockedPast, paused });
  check('…and nothing at all for no record', JSON.stringify(PB.publicBusiness('t1', null)) === '{"id":"t1"}');

  // The route.
  await db.doc('tenants/t1').set(record);
  const { GET } = await import('../../src/app/api/public/business/route');
  const req = (q: string) => ({ nextUrl: new URL(`https://app.example.com/api/public/business${q}`) }) as any;
  const ok: any = await GET(req('?business=t1'));
  check('the server hands out the public view of the live record, kept briefly at the edge', ok.status === 200 && ok.body.ok && ok.body.business.name === 'Opal Test' && !JSON.stringify(ok.body).includes('secret')
    && /s-maxage=15/.test(ok.headers['Cache-Control']), ok);
  const none: any = await GET(req('?business=nobody')); const bad: any = await GET(req('?business=../x'));
  check('…no such business, or a bad link, says so', none.status === 404 && /couldn’t find this business/.test(none.body.error) && bad.status === 400, [none.body, bad.body]);
  await db.doc('tenants/t1').set({ ...record, name: 'Renamed' });
  const again: any = await GET(req('?business=t1'));
  check('…kept for 15 seconds, then the live record again; not-found isn’t kept here or at the edge', /if \(!v\) kept\.delete\(tenantId\)/.test(src('src/app/api/public/business/route.ts')) && again.body.business.name === 'Opal Test' && /const KEEP_MS = 15000, FRESH_MS = 2000;/.test(src('src/app/api/public/business/route.ts'))
    && none.headers['Cache-Control'] === 'no-store' && /s-maxage=15, stale-while-revalidate=15/.test(ok.headers['Cache-Control']), again.body.business.name);
  // (A fresh read shares anything read in the last 2 seconds, so the preview is asked for after that.)
  await new Promise((r) => setTimeout(r, 2100));
  const freshOne: any = await GET(req('?business=t1&fresh=1'));
  await db.doc('tenants/t1').set({ ...record, name: 'Renamed again' });
  const freshTwo: any = await GET(req('?business=t1&fresh=2'));
  check('…but the owner’s own preview asks for it fresh (shared for 2 seconds, so asking over and over reads it at most that often), and isn’t kept at the edge', freshOne.body.business.name === 'Renamed' && freshOne.headers['Cache-Control'] === 'no-store' && freshTwo.body.business.name === 'Renamed'
    && /loadPublicBusiness\(tenantId, \{ fresh \}\)/.test(src('src/app/(booking)/book/[tenantId]/page.tsx')) && /get\('preview'\) === '1'/.test(src('src/app/(booking)/book/[tenantId]/page.tsx')), freshOne);

  // The pages: no public page reads the business's record itself any more.
  const ROOT = process.cwd();
  const ENTRIES = ['src/app/(booking)/book/[tenantId]/page.tsx', 'src/app/(booking)/complete/[tenantId]/[token]/page.tsx', 'src/app/(booking)/portal/[tenantId]/page.tsx',
    'src/app/(booking)/portal/[tenantId]/[clientId]/page.tsx', 'src/app/walk-in/[tenantId]/page.tsx', 'src/app/check-in/[token]/page.tsx', 'src/app/apply/[tenantId]/page.tsx',
    'src/app/inquiry/[tenantId]/page.tsx', 'src/app/tour-invite/[tenantId]/[token]/page.tsx', 'src/app/interview/[tenantId]/[token]/page.tsx'];
  // Every page and layout anyone can open: all of src/app except the team's own area, the server's routes, and the
  // team's screens that need a team sign-in (the staff portal, housekeeping and the time clock).
  const TEAM_SCREENS = /\/src\/app\/(\(app\)|api|staff-portal|housekeeping|timeclock)\//;
  const walkDir = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walkDir(path.join(d, e.name)) : [path.join(d, e.name)]);
  const ROUTES = walkDir(path.join(ROOT, 'src/app')).filter((f) => /\/(page|layout)\.tsx?$/.test(f) && !TEAM_SCREENS.test(f));
  const IMP = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;
  const resolve = (from: string, spec: string): string | null => {
    let base: string; if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2)); else if (spec.startsWith('.')) base = path.normalize(path.join(path.dirname(from), spec)); else return null;
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
    return null;
  };
  // (Server-only code never runs in a browser: a file that imports the server's database or says it's server-only.)
  const serverOnly = (rs: string) => /^\s*import\s+['"]server-only['"]/m.test(rs) || /from\s+['"](?:firebase-admin[^'"]*|@\/lib\/firebase-admin)['"]/.test(rs);
  const reach = (entries: string[]) => {
    const seen = new Set<string>(); const stack = entries.map((e) => (path.isAbsolute(e) ? e : path.join(ROOT, e)));
    while (stack.length) {
      const f = stack.pop()!; if (seen.has(f)) continue; seen.add(f);
      const s = src(f); let m: RegExpExecArray | null; IMP.lastIndex = 0;
      while ((m = IMP.exec(s))) { const r = resolve(f, m[1] || m[2] || m[3]); if (!r || seen.has(r)) continue; if (serverOnly(src(r))) continue; stack.push(r); }
    }
    return seen;
  };
  const seen = reach(ENTRIES);
  // (The team's own area, and the team's business context, which only loads inside it.)
  const notTeam = (f: string) => !/\/src\/(app\/\(app\)|context)\//.test(f);
  const allPublic = [...reach(ROUTES)].filter(notTeam).filter((f) => !TEAM_SCREENS.test(f));
  // Any database handle, however it's named or reached (doc(x, 'tenants', id), doc(x, `tenants/${id}`),
  // doc(collection(x, 'tenants'), id), doc(getFirestore(getApp()), …)), across lines.
  // (A handle: a name, dotted, called with up to one level of nested calls, or cast, bare or in brackets.)
  const CALL = String.raw`\((?:[^()]|\([^()]*\))*\)`;
  const BARE = String.raw`[A-Za-z_$][\w$.]*(?:${CALL})?!?(?:\s+as\s+\w+)*`;
  const H = String.raw`(?:${BARE}|\(\s*${BARE}\s*\))`;
  const ID_ARG = String.raw`[^,()]+(?:${CALL})?`;
  const READ = new RegExp(String.raw`\bdoc\(\s*(?:${H}\s*,\s*(?:['"\`]tenants['"\`]\s*,\s*${ID_ARG}\s*,?\s*\)|\[\s*['"]tenants['"]\s*,[^\]]*\]\s*\.join\(|\`tenants\/\$\{[^}]+\}\`\s*\)|['"]tenants\/['"]\s*\+\s*${ID_ARG}\s*\))|collection\(\s*${H}\s*,\s*['"]tenants['"]\s*\)\s*,)`, 'g');
  // (A path kept in a name first: const P = `tenants/${id}`, then doc(x, P).)
  const PATH_NAME = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^()]*\)\s*=>\s*)?`tenants\/\$\{[^}]+\}`\s*[;,\n]/g;
  const reads: string[] = [];
  for (const f of allPublic) {
    const s = src(f); let m: RegExpExecArray | null;
    const hits: number[] = []; READ.lastIndex = 0; while ((m = READ.exec(s))) hits.push(m.index);
    PATH_NAME.lastIndex = 0; while ((m = PATH_NAME.exec(s))) { const use = new RegExp(String.raw`\bdoc\(\s*${H}\s*,\s*${m[1]}\s*(?:${CALL})?\s*\)`, 'g'); let u: RegExpExecArray | null; while ((u = use.exec(s))) hits.push(u.index); }
    for (const i of hits) {
      const at = s.slice(0, i).split('\n').length; const line = s.split('\n')[at - 1] || '';
      // (A write isn't a read: the doc is the first thing handed to updateDoc or setDoc. A read marked "team only" runs
      // only for a signed-in member of the team.)
      if (/(?:updateDoc|setDoc|deleteDoc|updateDocumentNonBlocking|setDocumentNonBlocking|deleteDocumentNonBlocking|\.update|\.set|\.delete)\(\s*$/.test(s.slice(Math.max(0, i - 40), i)) || /\/\/.*team only/.test(line)) continue;
      reads.push(`${path.relative(ROOT, f)}:${at}`);
    }
  }
  const shapes = ["doc(getFirestore(getApp()), 'tenants', id)", "doc((db as any), 'tenants', id)", "doc(db, 'tenants/' + id)", "doc(p.firestore, `tenants/${id}`)", "doc(collection(db, 'tenants'), id)",
    "doc(firestore!, 'tenants', id)", "doc(db as unknown as Firestore, 'tenants', id)", "doc(db, `tenants`, id)", "doc(db, ['tenants', id].join('/'))",
    "doc(\n  firestore,\n  'tenants',\n  tenantId,\n)"];
  check('…the read check catches each way of writing a read', shapes.every((x) => { READ.lastIndex = 0; return READ.test(x); })
    && ['const P = `tenants/${id}`;\nconst r = await getDoc(doc(db, P));', 'const T = (t: string) => `tenants/${t}`;\nconst r = await getDoc(doc(db, T(id)));'].every((t) => { PATH_NAME.lastIndex = 0; const m = PATH_NAME.exec(t); return !!m && new RegExp(String.raw`\bdoc\(\s*${H}\s*,\s*${m[1]}\s*(?:${CALL})?\s*\)`).test(t); })
    && !(() => { READ.lastIndex = 0; return READ.test("doc(db, 'tenants', id, 'services', sid)"); })(), shapes.filter((x) => { READ.lastIndex = 0; return !READ.test(x); }));
  check('no page anyone can open reads the business’s record itself (only the team can, once the record is locked)', reads.length === 0 && allPublic.length > seen.size && seen.size > 100, { reads, routes: ROUTES.length, files: allPublic.length });
  check('…the switched pages load it from the server', ENTRIES.every((e) => /loadPublicBusiness|usePublicBusiness/.test(src(e)))
    && /usePublicBusiness\(tenantId\)/.test(src('src/components/booking/BookingFAQ.tsx')) && /usePublicBusiness\(tenantId\)/.test(src('src/components/booking/BookingGallery.tsx')));

  // Every business detail the public pages' code touches is on the public list or the known-private list, read under
  // any of the usual names, through a type cast ((tenant as any)?.x) or a name given to one of its settings.
  const NAMES = '(?:tenant|tenantData|tenantDoc|tenantPublic|biz|business|t|tn|ten|studio|shop|org)';
  const ACC = new RegExp(String.raw`\b${NAMES}\s*(?:as\s+\w+\s*\)\s*)?(?:\?\.|\.|!\.)\s*([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  // (Not business details: methods, other objects named the same way, and a loyalty tier's or a gift offer's own fields.)
  const NOT_FIELDS = new Set(['id', 'charAt', 'slice', 'split', 'replace', 'startsWith', 'toLowerCase', 'toUpperCase', 'toISOString', 'toLocaleDateString', 'toLocaleTimeString', 'getTime', 'length', 'exists', 'data', 'const', 'import',
    'closest', 'tagName', 'stop', 'date', 'label', 'price', 'tierId', 'drawImage', 'imageSmoothingEnabled', 'marks', 'note', 'view', 'w', 'h', 'colors', 'example', 'app', 'A', 'Every', 'Health', 'Only', 'Rewards', 'Two', 'Unknown',
    'perks', 'points', 'upgrade', 'earlyDays', 'waitlistFirst', 'bonusCents', 'buyCents', 'wait', 'spaces', 'nextPin']);
  const known = new Set<string>([...PB.PUBLIC_FIELDS, ...Object.keys(PB.PUBLIC_PICKS), ...Object.keys(PB.PUBLIC_OMIT), ...PB.KNOWN_PRIVATE, ...NOT_FIELDS]);
  const unknown = new Map<string, string>();
  // (Comments left out: they name things, they don't read them.)
  const code = (f: string) => src(f).split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1').replace(/^\s*\*.*$/, '')).join('\n');
  for (const f of seen) { const s = code(f); let m: RegExpExecArray | null; ACC.lastIndex = 0; while ((m = ACC.exec(s))) if (!known.has(m[1]) && !unknown.has(m[1])) unknown.set(m[1], path.relative(ROOT, f)); }
  check('every business detail the public pages’ code touches is on the public list or the known-private list', unknown.size === 0, Object.fromEntries(unknown));
  // Inside a setting handed out in part: every key read (directly, or under a name given to the setting) is one handed out.
  // (Helpers that tidy a whole setting read all of its keys, but what the public pages use of them needs only the keys
  // handed out; the rest fall back to their defaults there. A key read anywhere else must be handed out.)
  const HELPER_ONLY: Record<string, string[]> = {
    loyalty: ['earn', 'counts', 'leaveOut', 'rewards', 'updatedAt', 'expiryMonths', 'commission', 'join', 'oneRewardPerVisit', 'tiers', 'graceMonths', 'milestones', 'auto', 'rhythm', 'surprises',
      'headStart', 'boosts', 'referralPoints', 'itemId', 'serviceId', 'member', 'cents', 'productId'],
    privacy: ['autoSignOutMin', 'modelAgreementSigned', 'retentionYears'],
    makingItRight: ['cashRefund', 'deskLimitCents', 'deskRedos', 'providersCanOfferRedo', 'followUpDays', 'safetyCheckInHours', 'redoLookDays', 'redoChanges', 'retentionYears', 'payRules'],
    giftCardSettings: ['paysFor', 'cashBackUnderCents', 'refundDays', 'min', 'max', 'amounts', 'custom', 'seasonalOnly', 'rules', 'buyerThanks', 'renters', 'advancedLimits', 'serviceCards'],
  };
  const HELPER_FILES = ['src/lib/loyalty.ts', 'src/lib/making-it-right.ts', 'src/lib/health-privacy.ts', 'src/lib/gift-designs.ts'];
  const nestedMiss: string[] = [];
  for (const [k, keys] of Object.entries(PB.PUBLIC_PICKS)) {
    const top = new Set((keys as readonly string[]).map((x) => x.split('.')[0]));
    const subs: Record<string, Set<string>> = {}; for (const x of keys as readonly string[]) { const [a, b] = x.split('.'); if (b) (subs[a] ||= new Set()).add(b); }
    for (const f of seen) {
      const s = code(f);
      const direct = new RegExp(String.raw`\b${NAMES}\s*(?:as\s+\w+\s*\)\s*)?(?:\?\.|\.|!\.)\s*${k}\s*(?:\?\.|\.|!\.)\s*([A-Za-z_]\w*)(?:\s*(?:\?\.|\.|!\.)\s*([A-Za-z_]\w*))?`, 'g');
      const alias = new RegExp(String.raw`(?:const|let)\s+([A-Za-z_]\w*)(?:\s*:[^=]+)?\s*=\s*\(?\s*${NAMES}\s*(?:as\s+\w+\s*\)\s*)?(?:\?\.|\.|!\.)\s*${k}\b`, 'g');
      const inLib = HELPER_FILES.includes(path.relative(ROOT, f));
      const look = (key: string, sub: string | undefined, where: string) => {
        if (/^(json|then|catch|map|filter|length)$/.test(key) || (inLib && (HELPER_ONLY[k] || []).includes(key))) return;
        if (!top.has(key) && !(key in subs)) nestedMiss.push(`${k}.${key} (${where})`);
        else if (subs[key] && !top.has(key) && sub && !subs[key].has(sub) && !/^(length|map|filter|some|find|includes)$/.test(sub)) nestedMiss.push(`${k}.${key}.${sub} (${where})`);
      };
      let m: RegExpExecArray | null;
      while ((m = direct.exec(s))) look(m[1], m[2], path.relative(ROOT, f));
      while ((m = alias.exec(s))) {
        const a = m[1]; const use = new RegExp(String.raw`\b${a}\s*(?:\?\.|\.|!\.)\s*([A-Za-z_]\w*)(?:\s*(?:\?\.|\.|!\.)\s*([A-Za-z_]\w*))?`, 'g'); let u: RegExpExecArray | null;
        while ((u = use.exec(s))) look(u[1], u[2], `${path.relative(ROOT, f)} as ${a}`);
      }
    }
  }
  check('…and inside a setting handed out in part, only the keys handed out are read', nestedMiss.length === 0, [...new Set(nestedMiss)]);
  // What public pages read from those helpers' results stays within what's handed out.
  const RESULT_OK: Record<string, string[]> = {
    loyaltyOf: ['on', 'quiet', 'version'], privacyOf: ['discreet', 'healthMode'],
    settingsOf: ['preset', 'reasons', 'fixes', 'redoWindowDays', 'serviceWindows', 'replyHours', 'aftercare', 'channels', 'afterPhotos', 'reviews', 'fairUse'],
  };
  // (Of these, only some keys are handed out: settingsOf().fairUse.maxFixes would only ever be the default.)
  const RESULT_SUB: Record<string, Record<string, string[]>> = { settingsOf: { fairUse: ['requirePhotos', 'refundToOriginalCard'], reviews: ['on', 'googlePlaceId'] } };
  const subOk = (fn: string, a: string, b?: string) => !b || !RESULT_SUB[fn]?.[a] || RESULT_SUB[fn][a].includes(b);
  const resultMiss: string[] = [];
  for (const f of seen) {
    if (HELPER_FILES.includes(path.relative(ROOT, f))) continue;
    const s = code(f);
    for (const [fn, ok] of Object.entries(RESULT_OK)) {
      const ACC2 = String.raw`\s*(?:\?\.|\.)\s*([A-Za-z_]\w*)(?:\s*(?:\?\.|\.)\s*([A-Za-z_]\w*))?`;
      const direct = new RegExp(String.raw`\b${fn}\([^()]*\)${ACC2}`, 'g');
      const alias = new RegExp(String.raw`(?:const|let)\s+([A-Za-z_]\w*)(?:\s*:[^=]+)?\s*=\s*${fn}\(`, 'g');
      const destr = new RegExp(String.raw`(?:const|let)\s*\{([^}]*)\}\s*=\s*${fn}\(`, 'g');
      const miss = (a: string, b: string | undefined, where: string) => { if (!ok.includes(a) || !subOk(fn, a, b)) resultMiss.push(`${fn}().${a}${b ? `.${b}` : ''} (${where})`); };
      let m: RegExpExecArray | null;
      while ((m = direct.exec(s))) miss(m[1], m[2], path.relative(ROOT, f));
      while ((m = alias.exec(s))) { const use = new RegExp(String.raw`\b${m[1]}${ACC2}`, 'g'); let u: RegExpExecArray | null; while ((u = use.exec(s))) miss(u[1], u[2], `${path.relative(ROOT, f)} as ${m[1]}`); }
      while ((m = destr.exec(s))) for (const part of m[1].split(',')) { const k2 = part.split(':')[0].trim(); if (k2 && !k2.startsWith('...')) miss(k2, undefined, `${path.relative(ROOT, f)} destructured`); }
    }
  }
  check('…and what public pages read from the helpers that tidy those settings stays within what’s handed out', resultMiss.length === 0, [...new Set(resultMiss)]);
  check('…and nothing is on two lists', PB.KNOWN_PRIVATE.every((k: string) => !(PB.PUBLIC_FIELDS as readonly string[]).includes(k) && !(k in PB.PUBLIC_PICKS) && !(k in PB.PUBLIC_OMIT))
    && Object.keys(PB.PUBLIC_PICKS).every((k) => !(PB.PUBLIC_FIELDS as readonly string[]).includes(k) && !(k in PB.PUBLIC_OMIT)) && Object.keys(PB.PUBLIC_OMIT).every((k) => !(PB.PUBLIC_FIELDS as readonly string[]).includes(k)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
