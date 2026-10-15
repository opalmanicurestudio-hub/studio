// src/lib/wallet.ts — REWARDS CARDS IN APPLE WALLET AND GOOGLE WALLET (server only). The client's card shows their
// balance, what they're saving for, their tier and a link to their rewards page, and it updates by itself after every
// change to their points (lib/loyalty-server syncClient → walletRefresh).
// Apple: a signed .pkpass, plus the web service Apple calls to register a device and fetch the newest card
// (/api/wallet/apple/v1/...), and a push (APNs) when the balance changes. Needs a Pass Type ID certificate:
//   APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT (PEM), APPLE_PASS_KEY (PEM), APPLE_PASS_KEY_PASSPHRASE?, APPLE_WWDR_CERT (PEM)
// Google: a "save to Google Wallet" link (a signed JWT that creates the card) and updates through the Wallet API. Needs
// an issuer account and a service account: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_EMAIL, GOOGLE_WALLET_SA_KEY (PEM)
// Without those settings the buttons simply don't show. Device registrations: walletDevices/{deviceId}__{serial} (server only).
import { createHmac } from 'crypto';

const pem = (v?: string) => String(v || '').replace(/\\n/g, '\n').trim();
export function walletConfig() {
  const e = process.env;
  return { apple: !!(e.APPLE_PASS_TYPE_ID && e.APPLE_TEAM_ID && e.APPLE_PASS_CERT && e.APPLE_PASS_KEY && e.APPLE_WWDR_CERT), google: !!(e.GOOGLE_WALLET_ISSUER_ID && e.GOOGLE_WALLET_SA_EMAIL && e.GOOGLE_WALLET_SA_KEY) };
}
export const serialOf = (t: string, c: string) => `${t}.${c}`;
export const parseSerial = (s: string) => { const i = String(s || '').indexOf('.'); return i > 0 ? { t: s.slice(0, i), c: s.slice(i + 1) } : null; };
/** The token Apple sends back with every request for this card (never stored; recomputed). */
export const appleToken = (serial: string) => createHmac('sha256', process.env.WALLET_SECRET || process.env.CRON_SECRET || 'wallet').update(`apple|${serial}`).digest('hex').slice(0, 32);

export type CardFacts = { business: string; first: string; balance: number; unit: string; worth: string | null; saving: string | null; tier: string | null; ready: string | null; rewardsUrl: string; updatedAt: string };
export async function cardFacts(db: any, t: string, clientId: string): Promise<CardFacts | null> {
  const { loyaltyOf, goalOf, worthCents, unitOf, rewardsFor } = await import('@/lib/loyalty'); const { balanceFor } = await import('@/lib/loyalty-server');
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {}; const S = loyaltyOf(tenant); if (!S.on) return null;
  const c: any = (await db.doc(`tenants/${t}/clients/${clientId}`).get()).data(); if (!c) return null;
  const balance = Math.max(0, await balanceFor(db, t, clientId)); const unit = unitOf(S); const g = goalOf(S, c.loyalty?.goalRewardId || null, balance); const r = rewardsFor(S, balance);
  const w = worthCents(S, balance); const { rewardsPath } = await import('@/lib/loyalty-link'); const { linkOrigin } = await import('@/lib/app-origin');
  const tier = c.loyalty?.tier?.id && (!c.loyalty.tier.until || Date.parse(c.loyalty.tier.until) > Date.now()) ? String(c.loyalty.tier.name || '') || null : null;
  return { business: String(tenant.name || tenant.businessName || 'Rewards'), first: String(c.firstName || c.name || '').trim().split(/\s+/)[0] || 'Member', balance, unit, worth: w > 0 ? `$${(w / 100).toFixed(w % 100 ? 2 : 0)}` : null,
    saving: g ? (g.toGo ? `${g.reward.name} · ${g.toGo} to go` : `${g.reward.name} · ready`) : null, tier, ready: r.ready.length ? r.ready[r.ready.length - 1].name : null,
    rewardsUrl: `${linkOrigin(tenant, '') || ''}${rewardsPath(t, clientId)}`, updatedAt: String(c.loyalty?.updatedAt || new Date().toISOString()) };
}

// ── Apple ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function applePass(f: CardFacts, serial: string, origin: string): Promise<Buffer> {
  const { PKPass } = await import('passkit-generator'); const { WALLET_ICONS } = await import('@/lib/wallet-images');
  const img = (n: string) => Buffer.from(WALLET_ICONS[n], 'base64');
  const json = { formatVersion: 1, passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID, teamIdentifier: process.env.APPLE_TEAM_ID, serialNumber: serial, organizationName: f.business, description: `${f.business} rewards`, logoText: f.business,
    foregroundColor: 'rgb(255,255,255)', backgroundColor: 'rgb(22,23,26)', labelColor: 'rgb(127,209,165)', webServiceURL: `${origin}/api/wallet/apple`, authenticationToken: appleToken(serial), sharingProhibited: true,
    storeCard: { headerFields: f.tier ? [{ key: 'tier', label: 'TIER', value: f.tier }] : [], primaryFields: [{ key: 'balance', label: f.unit.toUpperCase(), value: f.balance, changeMessage: `You now have %@ ${f.unit}.` }],
      secondaryFields: [{ key: 'saving', label: f.ready ? 'READY' : 'SAVING FOR', value: f.ready || f.saving || 'Earning with every visit', changeMessage: f.ready ? '%@ is ready. Just mention it at your visit.' : undefined }].map((x) => JSON.parse(JSON.stringify(x))),
      auxiliaryFields: [{ key: 'name', label: 'MEMBER', value: f.first }, ...(f.worth ? [{ key: 'worth', label: 'WORTH ABOUT', value: f.worth }] : [])],
      backFields: [{ key: 'link', label: 'Your rewards', value: f.rewardsUrl, attributedValue: `<a href="${f.rewardsUrl}">See your rewards</a>` }, { key: 'how', label: 'Using a reward', value: 'Just mention it at your visit. Rewards are used at the studio, not online.' }] } };
  const pass = new PKPass({ 'pass.json': Buffer.from(JSON.stringify(json)), 'icon.png': img('icon.png'), 'icon@2x.png': img('icon@2x.png'), 'icon@3x.png': img('icon@3x.png') },
    { wwdr: pem(process.env.APPLE_WWDR_CERT), signerCert: pem(process.env.APPLE_PASS_CERT), signerKey: pem(process.env.APPLE_PASS_KEY), signerKeyPassphrase: process.env.APPLE_PASS_KEY_PASSPHRASE || undefined } as any);
  return pass.getAsBuffer();
}
/** Tell Apple each registered device that the card changed; the device then fetches the new card. */
export async function applePush(db: any, serial: string): Promise<number> {
  const regs = (await db.collection('walletDevices').where('serial', '==', serial).get()).docs.map((d: any) => d.data()); if (!regs.length) return 0;
  const http2 = await import('http2'); let sent = 0;
  const client = http2.connect('https://api.push.apple.com', { cert: pem(process.env.APPLE_PASS_CERT), key: pem(process.env.APPLE_PASS_KEY), passphrase: process.env.APPLE_PASS_KEY_PASSPHRASE || undefined } as any);
  try {
    for (const r of regs) { if (!r.pushToken) continue;
      await new Promise<void>((res) => { const req = client.request({ ':method': 'POST', ':path': `/3/device/${r.pushToken}`, 'apns-topic': String(process.env.APPLE_PASS_TYPE_ID), 'content-type': 'application/json' });
        req.on('response', (h: any) => { if (Number(h[':status']) === 200) sent++; if (Number(h[':status']) === 410) db.doc(`walletDevices/${r.deviceId}__${serial}`).delete().catch(() => {}); });
        req.on('error', () => res()); req.on('close', () => res()); req.setTimeout(5000, () => { req.close(); res(); }); req.end('{}'); }); }
  } finally { client.close(); }
  return sent;
}

// ── Google ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const gid = (s: string) => String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
const gIds = (t: string, c: string) => { const iss = String(process.env.GOOGLE_WALLET_ISSUER_ID); return { classId: `${iss}.cf_${gid(t)}`, objectId: `${iss}.cf_${gid(t)}_${gid(c)}` }; };
function googleObject(f: CardFacts, t: string, c: string) {
  const { classId, objectId } = gIds(t, c);
  return { id: objectId, classId, state: 'ACTIVE', accountId: c.slice(0, 20), accountName: f.first, loyaltyPoints: { label: f.unit === 'punches' ? 'Punches' : 'Points', balance: { int: f.balance } },
    textModulesData: [{ id: 'saving', header: f.ready ? 'Ready' : 'Saving for', body: f.ready ? `${f.ready}. Just mention it at your visit.` : f.saving || 'Earning with every visit' }, ...(f.tier ? [{ id: 'tier', header: 'Tier', body: f.tier }] : [])],
    linksModuleData: { uris: [{ id: 'rewards', uri: f.rewardsUrl, description: 'Your rewards' }] } };
}
async function googleKey() { const { importPKCS8 } = await import('jose'); return importPKCS8(pem(process.env.GOOGLE_WALLET_SA_KEY), 'RS256'); }
/** The "Add to Google Wallet" link: a signed JWT that creates the program (once) and this client's card. */
export async function googleSaveUrl(f: CardFacts, t: string, c: string, origin: string): Promise<string> {
  const { SignJWT } = await import('jose'); const { classId } = gIds(t, c);
  const cls = { id: classId, issuerName: f.business, programName: `${f.business} Rewards`, programLogo: { sourceUri: { uri: `${origin}/wallet/hero.png` }, contentDescription: { defaultValue: { language: 'en-US', value: f.business } } }, hexBackgroundColor: '#16171a', reviewStatus: 'UNDER_REVIEW' };
  const jwt = await new SignJWT({ iss: process.env.GOOGLE_WALLET_SA_EMAIL, aud: 'google', typ: 'savetowallet', origins: [origin], payload: { loyaltyClasses: [cls], loyaltyObjects: [googleObject(f, t, c)] } } as any)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuedAt().sign(await googleKey());
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
let gTok: { v: string; until: number } | null = null;
async function googleToken(): Promise<string> {
  if (gTok && gTok.until > Date.now() + 60000) return gTok.v; const { SignJWT } = await import('jose'); const now = Math.floor(Date.now() / 1000);
  const a = await new SignJWT({ scope: 'https://www.googleapis.com/auth/wallet_object.issuer' } as any).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(String(process.env.GOOGLE_WALLET_SA_EMAIL)).setAudience('https://oauth2.googleapis.com/token').setIssuedAt(now).setExpirationTime(now + 3600).sign(await googleKey());
  const r: any = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: a }) }).then((x) => x.json());
  gTok = { v: String(r.access_token || ''), until: Date.now() + (Number(r.expires_in) || 3000) * 1000 }; return gTok.v;
}
/** Update a saved Google card (a card that was never saved returns 404, which is fine). */
export async function googleUpdate(f: CardFacts, t: string, c: string): Promise<boolean> {
  const { objectId } = gIds(t, c); const tok = await googleToken(); if (!tok) return false; const o: any = googleObject(f, t, c);
  const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`, { method: 'PATCH', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ loyaltyPoints: o.loyaltyPoints, textModulesData: o.textModulesData, linksModuleData: o.linksModuleData, accountName: o.accountName }) }).catch(() => null);
  return !!r && r.ok;
}

/** After a client's points change: update their wallet cards, if they have any. Best effort, never blocks a sale. */
export async function walletRefresh(db: any, t: string, clientId: string) {
  const cfg = walletConfig(); if (!cfg.apple && !cfg.google) return;
  const c: any = (await db.doc(`tenants/${t}/clients/${clientId}`).get()).data() || {}; const w = c.wallet || {}; if (!w.apple && !w.google) return;
  const timeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), 6000))]);
  try { if (cfg.apple && w.apple) await timeout(applePush(db, serialOf(t, clientId))); } catch (e) { console.error('[wallet] apple push', e); }
  try { if (cfg.google && w.google) { const f = await cardFacts(db, t, clientId); if (f) await timeout(googleUpdate(f, t, clientId)); } } catch (e) { console.error('[wallet] google update', e); }
}
