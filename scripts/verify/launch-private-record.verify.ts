// Checks launch L6: personal details stay off the public business record.
// The business record (tenants/{id}) can be read by anyone with a booking link, so the owner's own mobile, the ship-from
// address, the curbside alert number, the guest Wi-Fi and the invite code live in tenants/{id}/private/settings, which
// only the server reads (lib/tenant-private). Old copies move over; nothing that used them stops working.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/launch-private-record.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, FV, check, failures } from './fake-db';

const db = makeDb();
let uid = 'owner1';
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({ verifyIdToken: async () => ({ uid }) }) };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  return load.call(this, request, ...rest);
};
const read = (p: string) => readFileSync(p, 'utf8');
const post = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) } }) as any;
const T = 'tenants/opal';
const OLD = {
  name: 'Opal', userId: 'owner1', phone: '4045550100', inviteCode: 'OPAL-2026', wifiNetwork: 'Opal Guest', wifiPassword: 'polish123',
  accessLockedReason: 'card declined twice', addons: { assistant: { active: true, since: '2026-10-01', grantedBy: 'jess@hq.example' } },
  clientNotify: { enabled: true, ownerBrief: true, ownerPhone: '4045550199' },
  retailSettings: { shopTagline: 'Hand-mixed polish', curbsideAlertPhone: '4045550111', shipFrom: { name: 'Jess', street1: '12 Home St', city: 'Atlanta', state: 'GA', zip: '30303' } },
};

(async () => {
  const P = await import('../../src/lib/tenant-private');
  const F = await import('../../src/lib/tenant-private-fields');

  console.log('Moving old copies off the business record');
  await db.doc(T).set(JSON.parse(JSON.stringify(OLD)));
  let p = await P.tenantPrivate(db, 'opal', (await db.doc(T).get()).data());
  check('before the move, the old copies are still used, so nothing stops working', p.ownerPhone === '4045550199' && p.shipFrom.street1 === '12 Home St' && p.wifiPassword === 'polish123' && p.inviteCode === 'OPAL-2026');
  await db.doc(`${T}/private/settings`).set({ wifiNetwork: 'Opal Guest 5G' });
  check('the move reports it moved something', (await P.movePrivateFields(db, 'opal')) === true);
  const t: any = (await db.doc(T).get()).data();
  check('the business record no longer holds the mobile, address, alert number, Wi-Fi or invite code', !t.wifiNetwork && !t.wifiPassword && !t.inviteCode && !t.clientNotify?.ownerPhone && !t.retailSettings?.curbsideAlertPhone && !t.retailSettings?.shipFrom, t);
  check('…nor HQ’s pause note or the HQ person who turned an add-on on', !('accessLockedReason' in t) && !('grantedBy' in (t.addons?.assistant || {})));
  check('everything else on it is untouched', t.name === 'Opal' && t.clientNotify?.ownerBrief === true && t.retailSettings?.shopTagline === 'Hand-mixed polish' && t.addons?.assistant?.active === true && t.phone === '4045550100');
  const pv: any = (await db.doc(`${T}/private/settings`).get()).data();
  check('the private place now has them, and a value already there wins over the old copy', pv.ownerPhone === '4045550199' && pv.curbsideAlertPhone === '4045550111' && pv.shipFrom?.city === 'Atlanta' && pv.wifiPassword === 'polish123' && pv.inviteCode === 'OPAL-2026' && pv.wifiNetwork === 'Opal Guest 5G', pv);
  check('running it again does nothing', (await P.movePrivateFields(db, 'opal')) === false);
  const w = P.withPrivate(t, await P.tenantPrivate(db, 'opal', t));
  check('server code that reads the old paths gets them back in place', w.clientNotify.ownerPhone === '4045550199' && w.retailSettings.shipFrom.zip === '30303' && w.retailSettings.curbsideAlertPhone === '4045550111' && w.retailSettings.shopTagline === 'Hand-mixed polish');

  console.log('The team reads and changes them through the server');
  const R = await import('../../src/app/api/tenant-private/route');
  let out: any = await (await R.POST(post({ tenantId: 'opal', action: 'get' }))).json();
  check('the owner sees them', out.ok && out.values.ownerPhone === '4045550199' && out.values.wifiNetwork === 'Opal Guest 5G' && !('inviteCode' in out.values), out);
  out = await (await R.POST(post({ tenantId: 'opal', action: 'set', values: { wifiPassword: 'buff456', shipFrom: { name: 'Opal', street1: '9 Shop Rd', city: 'Decatur', state: 'GA', zip: '30030', junk: 'x' }, inviteCode: 'HACK' } }))).json();
  const after: any = (await db.doc(T).get()).data(); const pv2: any = (await db.doc(`${T}/private/settings`).get()).data();
  check('saving changes the private place only, never the business record', out.ok && pv2.wifiPassword === 'buff456' && pv2.shipFrom.city === 'Decatur' && !('junk' in pv2.shipFrom) && !after.wifiPassword && !after.retailSettings?.shipFrom);
  check('the invite code can’t be changed from here', pv2.inviteCode === 'OPAL-2026');
  await db.doc(`${T}/staff/sam`).set({ name: 'Sam', role: 'stylist' }); uid = 'sam';
  out = await (await R.POST(post({ tenantId: 'opal', action: 'get' }))).json();
  check('someone on the team who isn’t a manager can’t read them', out.ok === false && /Managers only/.test(out.error));
  uid = 'stranger';
  out = await (await R.POST(post({ tenantId: 'opal', action: 'get' }))).json();
  check('someone not on the team can’t either', out.ok === false);
  uid = 'owner1';

  console.log('The guest Wi-Fi on the client’s visit link');
  await db.doc('appointmentCheckIns/tok_abcdefghijklmnop').set({ tenantId: 'opal', id: 'a1' });
  await db.doc(`${T}/appointments/a1`).set({ status: 'confirmed', checkInToken: 'tok_abcdefghijklmnop' });
  const C = await import('../../src/app/api/checkin/actions/route');
  const wifiNow = async () => (await (await C.POST(post({ action: 'wifi', token: 'tok_abcdefghijklmnop' }))).json());
  out = await wifiNow();
  check('before they arrive: no Wi-Fi yet', out.ok && out.wifi === null, out);
  await db.doc(`${T}/appointments/a1`).set({ checkInStatus: 'arrived' }, { merge: true });
  out = await wifiNow();
  check('checked in: the person whose visit it is gets the Wi-Fi', out.ok && out.wifi?.network === 'Opal Guest 5G' && out.wifi?.password === 'buff456', out);
  await db.doc(`${T}/appointments/a1`).set({ linkRevokedAt: '2026-11-08T10:00:00Z' }, { merge: true });
  out = await wifiNow();
  check('a link turned off by “Not you?” doesn’t get it', out.ok && out.wifi === null, out);
  await db.doc(`${T}/appointments/a1`).set({ linkRevokedAt: null, status: 'completed', checkInStatus: 'done' }, { merge: true });
  out = await wifiNow();
  check('nor does a visit that’s over', out.ok && out.wifi === null, out);
  out = await (await C.POST(post({ action: 'wifi', token: 'tok_zzzzzzzzzzzzzzzz' }))).json();
  check('a made-up link gets nothing', out.ok === false);
  const page = read('src/app/check-in/[token]/page.tsx');
  check('the visit page asks its own link for the Wi-Fi, not the business record', /action: 'wifi', token/.test(page) && !/wifiPassword/.test(page));

  console.log('What the public record still says, and failures');
  const t3: any = (await db.doc(T).get()).data();
  check('the public record says the ship-from address is complete, and its state, but not the address', t3.retailSettings?.shipFromSet === true && t3.retailSettings?.shipFromState === 'GA' && !t3.retailSettings?.shipFrom);
  const S = await import('../../src/lib/shop-setup');
  check('so shop setup can still tick “Choose pickup, shipping or both”', !/Add the address/.test(S.setupSteps(t3, 3).find((x: any) => x.id === 'delivery')?.note || '') && /Add the address/.test(S.setupSteps({ retailSettings: { shippingEnabled: true } }, 3).find((x: any) => x.id === 'delivery')?.note || ''));
  const WT = await import('../../src/lib/wholesale-tax');
  check('and a pickup is still taxed in the shop’s own state', WT.shopStateOf({ retailSettings: t3.retailSettings }) === 'GA');
  await db.doc('tenants/fresh').set({ name: 'Fern', retailSettings: { shipFrom: { street1: '1 A St', city: 'Austin', state: 'TX', zip: '78701' } } });
  await P.movePrivateFields(db, 'fresh');
  const fr: any = (await db.doc('tenants/fresh').get()).data();
  check('moving an old address sets the same markers', fr.retailSettings?.shipFromSet === true && fr.retailSettings?.shipFromState === 'TX' && !fr.retailSettings?.shipFrom);
  await db.doc('tenants/both').set({ name: 'Both', retailSettings: { shipFrom: { street1: 'old' } } });
  await db.doc('tenants/both/private/settings').set({ shipFrom: { street1: '5 New Rd', city: 'Mesa', state: 'AZ', zip: '85201' } });
  await P.movePrivateFields(db, 'both');
  const bo: any = (await db.doc('tenants/both').get()).data();
  check('when a newer private address exists, the markers follow it, not the stale old copy', bo.retailSettings?.shipFromSet === true && bo.retailSettings?.shipFromState === 'AZ' && (await db.doc('tenants/both/private/settings').get()).data()?.shipFrom?.street1 === '5 New Rd');
  // A private read that fails must not look empty, and must not let an old copy overwrite anything.
  await db.doc('tenants/flaky').set({ name: 'Flaky', wifiPassword: 'old-one' });
  const realDoc = db.doc.bind(db);
  (db as any).doc = (path: string) => (path === 'tenants/flaky/private/settings' ? { get: async () => { throw new Error('unavailable'); }, set: async () => { throw new Error('unavailable'); } } : realDoc(path));
  let threw = false; try { await P.tenantPrivate(db, 'flaky'); } catch { threw = true; }
  let moveThrew = false; try { await P.movePrivateFields(db, 'flaky'); } catch { moveThrew = true; }
  (db as any).doc = realDoc;
  check('a failed read is an error, not an empty answer', threw);
  check('…and a move that can’t read leaves the old copy where it is', moveThrew && (await db.doc('tenants/flaky').get()).data()?.wifiPassword === 'old-one');

  console.log('Every reader and writer uses the private place');
  for (const f of ['src/app/api/retail/shipping-quote/route.ts', 'src/app/(app)/retail/shipping-quote/route.ts', 'src/app/api/retail/pickup/route.ts', 'src/app/api/retail/close-day/route.ts', 'src/app/api/retail/shipping-label/route.ts', 'src/app/api/retail/return-label/route.ts', 'src/app/api/retail/shipping-labels-bulk/route.ts', 'src/app/api/retail/curbside-notify/route.ts', 'src/app/api/retail/lounge-notify/route.ts'])
    check(`${f.replace(/^src\/app\//, '')} reads the private ship-from or alert number`, /withPrivate\(.+await tenantPrivate\(db, tenantId,/.test(read(f)) || (/const rs = await retailWithPrivate\(db, tenantId, tenant\);/.test(read(f)) && /if \(!rs\) return NextResponse\.json\(\{ error: 'Please try again in a moment\.' \}, \{ status: 503 \}\);/.test(read(f))));
  const cn = read('src/app/api/retail/curbside-notify/route.ts');
  check('the curbside alert number is read once, before the transaction', cn.indexOf('let alertTo') > -1 && cn.indexOf('let alertTo') < cn.indexOf('db.runTransaction') && /phone = alertTo;/.test(cn));
  check('a customer’s address-change cost uses the private ship-from address', /tenantPrivate\(db, tenantId, tenant\)\)\.shipFrom/.test(read('src/lib/address-cost.ts')));
  check('the Wi-Fi fields keep what was typed while the other one saves', /seeded\.current/.test(read('src/components/settings/GuestWifiRows.tsx')));
  check('the morning brief job reads the owner’s mobile from the private place', /tenantPrivate\(db, tid, tDoc\.data\(\)\); cfg\.ownerPhone = pv\.ownerPhone/.test(read('src/app/api/cron/reminders/route.ts')));
  check('Automations shows and saves the owner’s mobile through the server', /tenantWithPrivate\(db, tenantId\)/.test(read('src/app/api/automations/route.ts')) && /'clientNotify\.ownerPhone': ownerPhone/.test(read('src/components/settings/AutomationsOverview.tsx')));
  const st = read('src/app/(app)/settings/page.tsx');
  check('Settings writes only the changed parts of the notify and shop settings, by path', /for \(const m of \['clientNotify', 'retailSettings'\]\)/.test(st) && /changed\[`\$\{m\}\.\$\{k\}`\]/.test(st));
  check('Settings saves the Wi-Fi on its own, and its autosave can’t write private details back', /<GuestWifiRows tenantId=\{tenantId\} \/>/.test(st) && /stripPrivate\(tenantData as any\)/.test(st) && /stripPrivate\(\(selectedTenant \|\| \{\}\) as any\)/.test(st) && !/wifiPassword/.test(st));
  const rs = read('src/app/(app)/retail-orders/settings/page.tsx');
  check('shop settings save the ship-from address and alert number privately', /k === 'curbsideAlertPhone' \|\| k === 'shipFrom'/.test(rs) && /priv\.save\(privatePatch\)/.test(rs));
  const s1 = F.stripPrivate(OLD as any) as any;
  check('stripping a copy of the record leaves only the public parts', !s1.wifiPassword && !s1.inviteCode && !s1.accessLockedReason && !s1.clientNotify.ownerPhone && s1.clientNotify.ownerBrief === true && !s1.retailSettings.shipFrom && s1.retailSettings.shopTagline === 'Hand-mixed polish');
  check('the nightly job moves old copies for every business', /if \(await movePrivateFields\(db, tDoc\.id\)\) privateMoved\+\+/.test(read('src/app/api/cron/nightly/route.ts')));
  const su = read('src/app/api/signup/route.ts'), inv = read('src/app/api/invites/route.ts'), hq = read('src/app/api/hq/route.ts');
  check('sign-up and invites keep the invite code privately', !/inviteCode: code \}/.test(su.replace(/private\/settings`\), \{ inviteCode: code/, '')) && /private\/settings`\), \{ inviteCode: code/.test(su) && /setTenantPrivate\(db, tenantId, \{ inviteCode: code \}\)/.test(inv) && !/tenants\/\$\{tenantId\}`\)\.set\(\{ inviteCode/.test(inv));
  check('HQ keeps its pause reason and who turned an add-on on in its own log', /accessLockedReason: FieldValue\.delete\(\)/.test(hq) && !/grantedBy/.test(hq) && /inviteCode: \(await tenantPrivate\(db, id, t\)\.catch\(\(\) => null\)\)\?\.inviteCode/.test(hq));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
