// scripts/verify/wallet.verify.ts — rewards cards in Apple Wallet and Google Wallet (lib/wallet). Uses throwaway test
// certificates when WALLET_TEST_KEYS points at a folder with ca.pem, signer.pem, signer.key and google.key; otherwise
// checks only what needs no keys.
import { makeDb, check, failures } from './fake-db';
import fs from 'fs'; import path from 'path';

(async () => {
  console.log('Wallet cards');
  const K = process.env.WALLET_TEST_KEYS || '';
  const W0 = await import('../../src/lib/wallet');
  check('no settings → no buttons', !W0.walletConfig().apple && !W0.walletConfig().google);
  check('serial round-trips', JSON.stringify(W0.parseSerial(W0.serialOf('t1', 'c.1'))) === JSON.stringify({ t: 't1', c: 'c.1' }));
  check('the card’s token is stable and private', W0.appleToken('t1.c1') === W0.appleToken('t1.c1') && W0.appleToken('t1.c1') !== W0.appleToken('t1.c2') && W0.appleToken('t1.c1').length === 32);
  const db = makeDb();
  await db.doc('tenants/t1').set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example', loyalty: { on: true, earn: { mode: 'per_dollar', perDollar: 1 }, rewards: [{ id: 'r10', name: '$10 off', points: 300, kind: 'amount_off', cents: 1000 }, { id: 'ped', name: 'Free pedicure', points: 800, kind: 'free_service', serviceId: 'p' }] } });
  await db.doc('tenants/t1/clients/c1').set({ name: 'Rosa Martinez', loyalty: { goalRewardId: 'ped', updatedAt: '2026-10-15T12:00:00Z' } });
  await db.doc('tenants/t1/loyaltyLedger/e1').set({ clientId: 'c1', type: 'earn', points: 740, at: '2026-10-01T00:00:00Z' });
  const f: any = await W0.cardFacts(db, 't1', 'c1');
  check('the card says: balance, saving for, worth, first name, a link', f.balance === 740 && f.saving === 'Free pedicure · 60 to go' && f.ready === '$10 off' && f.worth === '$24.66' && f.first === 'Rosa' && /\/rewards\/t1\/c1\?k=/.test(f.rewardsUrl), f);
  if (!K || !fs.existsSync(path.join(K, 'signer.pem'))) { console.log('  (no test keys: skipping signing)'); console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0); }
  Object.assign(process.env, { APPLE_PASS_TYPE_ID: 'pass.test.rewards', APPLE_TEAM_ID: 'TEAM123456', APPLE_PASS_CERT: fs.readFileSync(path.join(K, 'signer.pem'), 'utf8'), APPLE_PASS_KEY: fs.readFileSync(path.join(K, 'signer.key'), 'utf8'), APPLE_WWDR_CERT: fs.readFileSync(path.join(K, 'ca.pem'), 'utf8'),
    GOOGLE_WALLET_ISSUER_ID: '3388000000012345678', GOOGLE_WALLET_SA_EMAIL: 'wallet@test.iam.gserviceaccount.com', GOOGLE_WALLET_SA_KEY: fs.readFileSync(path.join(K, 'google.key'), 'utf8') });
  check('with settings → both buttons', W0.walletConfig().apple && W0.walletConfig().google);
  const buf = await W0.applePass(f, 't1.c1', 'https://opal.example');
  const os = await import('os'); const cp = await import('child_process'); const tmp = path.join(os.tmpdir(), `pass-${Date.now()}.pkpass`); fs.writeFileSync(tmp, buf);
  const names = cp.execFileSync('unzip', ['-Z1', tmp]).toString().trim().split('\n').sort();
  check('Apple: a signed card with its manifest', ['icon.png', 'manifest.json', 'pass.json', 'signature'].every((n) => names.includes(n)), names);
  const pj = JSON.parse(cp.execFileSync('unzip', ['-p', tmp, 'pass.json']).toString()); fs.unlinkSync(tmp);
  check('Apple: balance, saving for, and the update address', pj.storeCard.primaryFields[0].value === 740 && pj.storeCard.secondaryFields[0].value === '$10 off' && pj.webServiceURL === 'https://opal.example/api/wallet/apple' && pj.authenticationToken === W0.appleToken('t1.c1') && pj.serialNumber === 't1.c1', pj);
  const url = await W0.googleSaveUrl(f, 't1', 'c1', 'https://opal.example'); const jwt = url.split('/save/')[1];
  const body = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  check('Google: a signed save link that creates the program and the card', url.startsWith('https://pay.google.com/gp/v/save/') && body.typ === 'savetowallet' && body.payload.loyaltyClasses[0].id === '3388000000012345678.cf_t1' && body.payload.loyaltyObjects[0].loyaltyPoints.balance.int === 740 && body.payload.loyaltyObjects[0].id === '3388000000012345678.cf_t1_c1', body);
  const { importSPKI, jwtVerify } = await import('jose'); const crypto = await import('crypto');
  const pub = crypto.createPublicKey(process.env.GOOGLE_WALLET_SA_KEY!).export({ type: 'spki', format: 'pem' }).toString();
  check('Google: the signature checks out', !!(await jwtVerify(jwt, await importSPKI(pub, 'RS256')).catch(() => null)));
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
