// src/lib/wallet-domains.ts — APPLE PAY AND GOOGLE PAY ON THE GUEST'S PHONE. The card company only offers a phone's wallet
// on a pay page whose web address is registered with the business's own payments account (every page that shows its
// secure card form: scan to pay at the drive-thru, gift cards, booking deposits, the visit and desk pay screens). This
// registers the app's address(es) on each business's account and remembers how it went on the business record
// (walletDomains), so it isn't asked again: active ones are looked at again after 30 days; ones not active yet after 6
// hours, then less and less often (up to a week) while they still aren't. A hiccup never undoes one that works. Never a
// local, bare-IP, plain-http or one-off preview address.
//   Called by: the payment account becoming ready (lib/connect-webhook), the payments sweep (cron/retail-payments), scan
// to pay (lib/counter-phone) and Check again in the payments settings (api/stripe/wallets), each for whatever is due.
// A guest is never held up more than a few seconds: the rest carries on after the answer.
import { accountOf, readerStripe } from '@/lib/reader-sale';
import { isFrozenHost, linkOrigin } from '@/lib/app-origin';

const DAY = 86400000, HOUR = 3600000;
const AGAIN_ACTIVE = 30 * DAY, AGAIN_WAITING = 6 * HOUR, AGAIN_MAX = 7 * DAY;
const BUSY_MS = 60000;
const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export type WalletState = { domain: string; id: string | null; enabled: boolean; apple: string; google: string; link: string; at: string; fails?: number; error?: string | null };

// Host names never hold an underscore, so this can't make two addresses one.
const keyOf = (host: string) => host.replace(/\./g, '_');
const hostOf = (urlOrHost: unknown) => String(urlOrHost || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:?#].*$/, '');
const okHost = (h: string) => !!h && HOST.test(h) && h !== 'localhost' && !h.endsWith('.local') && !h.endsWith('.localhost') && !isFrozenHost(h);
const on = (s: any) => !!s?.enabled && (s.apple === 'active' || s.google === 'active');

/** The web addresses guests pay on for this business: its own saved address, where links point, and the app's (and, on a
 *  team member's own request, the address they're using). https only; never localhost, a bare IP or a preview deploy. */
export function walletHosts(tenant: any, requestOrigin?: string | null): string[] {
  const out: string[] = [];
  for (const c of [tenant?.publicOrigin, linkOrigin(tenant, requestOrigin), process.env.NEXT_PUBLIC_APP_URL, requestOrigin]) {
    const raw = String(c || '').trim();
    if (/^[a-z]+:\/\//i.test(raw) && !/^https:\/\//i.test(raw)) continue;
    const h = hostOf(raw);
    if (okHost(h) && !out.includes(h)) out.push(h);
  }
  return out.slice(0, 4);
}

/** Whether a phone's wallet shows on the page at this address (the one the guest is actually sent to). */
export function walletsOn(tenant: any, url: string | null | undefined): boolean {
  const h = hostOf(url); return !!h && on((tenant?.walletDomains || {})[keyOf(h)]);
}

/** The addresses not registered, or due to be looked at again. */
export function walletsDue(tenant: any, hosts: string[], now = Date.now()): string[] {
  const w = tenant?.walletDomains || {};
  return hosts.filter((h) => {
    const s = w[keyOf(h)]; if (!s?.at) return true;
    const age = now - (Date.parse(String(s.at)) || 0);
    // On, with nothing wrong last time: a month. On, but the last look hit a hiccup: 6 hours.
    const done = !!s.enabled && s.apple === 'active' && s.google === 'active';
    if (done) return age >= (s.error ? AGAIN_WAITING : AGAIN_ACTIVE);
    const fails = Math.max(1, Math.floor(Number(s.fails) || 1));
    return age >= Math.min(AGAIN_MAX, AGAIN_WAITING * 2 ** (fails - 1));
  });
}

/** How each address stands, as last looked at (for the payments settings; the card company's words only for a manager). */
export function walletStatus(tenant: any, requestOrigin?: string | null, withErrors = false) {
  const w = tenant?.walletDomains || {};
  return walletHosts(tenant, requestOrigin).map((h) => {
    const s: any = w[keyOf(h)] || null;
    return { domain: h, checked: !!s?.at, at: s?.at || null, apple: s?.enabled ? String(s.apple || 'inactive') : 'inactive', google: s?.enabled ? String(s.google || 'inactive') : 'inactive', error: withErrors ? s?.error || null : null };
  });
}

const stateOf = (d: any, host: string, at: string, prev: any): WalletState => {
  const st: WalletState = {
    domain: host, id: d?.id ? String(d.id) : null, enabled: !!d?.enabled,
    apple: String(d?.apple_pay?.status || 'inactive'), google: String(d?.google_pay?.status || 'inactive'), link: String(d?.link?.status || 'inactive'), at,
    error: String(d?.apple_pay?.status_details?.error_message || d?.google_pay?.status_details?.error_message || '').slice(0, 200) || null,
  };
  // Still not on for both: asked less often each time (6 hours, 12, a day… up to a week).
  st.fails = st.enabled && st.apple === 'active' && st.google === 'active' ? 0 : Math.min(10, Math.floor(Number(prev?.fails) || 0) + 1);
  return st;
};

async function oneHost(stripe: any, acct: string, host: string, at: string, prev: any): Promise<WalletState> {
  const opts = { stripeAccount: acct };
  const find = async () => { const f: any = await stripe.paymentMethodDomains.list({ domain_name: host, limit: 1 }, opts); return (f?.data || []).find((x: any) => String(x?.domain_name || '').toLowerCase() === host) || null; };
  try {
    let d: any = await find();
    // Made at the same moment by another caller (it says it exists already): that one is used.
    if (!d) { try { d = await stripe.paymentMethodDomains.create({ domain_name: host, enabled: true }, opts); } catch (e) { d = await find(); if (!d) throw e; } }
    if (!d.enabled) d = await stripe.paymentMethodDomains.update(d.id, { enabled: true }, opts);
    // A wallet not on yet: the card company checks the address again.
    if (d?.id && (d.apple_pay?.status !== 'active' || d.google_pay?.status !== 'active')) d = await stripe.paymentMethodDomains.validate(d.id, {}, opts).catch(() => d);
    return stateOf(d, host, at, prev);
  } catch (e: any) {
    // The account can't do it yet, or the card company didn't answer: one that worked keeps working (only noted), and
    // it's asked again later.
    const fails = Math.min(10, Math.floor(Number(prev?.fails) || 0) + 1);
    const error = String(e?.message || 'Not registered').slice(0, 200);
    return prev?.at ? { ...prev, at, fails: on(prev) ? Math.floor(Number(prev.fails) || 0) : fails, error } : { domain: host, id: null, enabled: false, apple: 'inactive', google: 'inactive', link: 'inactive', at, fails, error };
  }
}

/** Register this business's pay addresses on its own payments account (only those due, unless a manager asks). */
export async function ensureWalletDomains(db: any, tenantId: string, tenant: any, requestOrigin?: string | null, o: { stripe?: any; now?: number; hosts?: string[]; force?: boolean } = {}): Promise<{ checked: number; active: number; states: WalletState[] }> {
  const out = { checked: 0, active: 0, states: [] as WalletState[] };
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe || !/^[A-Za-z0-9_-]{1,160}$/.test(tenantId)) return out;
  const now = o.now ?? Date.now();
  const hosts = (o.hosts || walletHosts(tenant, requestOrigin)).filter(okHost);
  const due = o.force ? hosts : walletsDue(tenant, hosts, now);
  if (!due.length) return out;
  const at = new Date(now).toISOString();
  const prev = tenant?.walletDomains || {};
  const states = await Promise.all(due.map((h) => oneHost(stripe, acct, h, at, prev[keyOf(h)])));
  const put: Record<string, WalletState> = {};
  for (const s of states) put[keyOf(s.domain)] = s;
  await db.doc(`tenants/${tenantId}`).set({ walletDomains: put }, { merge: true }).catch((e: any) => console.error('[wallet-domains] not saved', tenantId, e?.message));
  if (tenant) tenant.walletDomains = { ...prev, ...put };
  out.checked = states.length; out.states = states; out.active = states.filter(on).length;
  return out;
}

/** The same, for a caller that can't wait long (a guest's page, the lane, the payment notice): waits `ms` at most, and
 *  the rest finishes after the answer. One at a time per business (others skip while one is under way). */
export async function ensureWalletDomainsSoon(db: any, tenantId: string, tenant: any, requestOrigin?: string | null, ms = 3000, o: { stripe?: any } = {}): Promise<void> {
  if (!accountOf(tenant) || !walletsDue(tenant, walletHosts(tenant, requestOrigin)).length) return;
  // Claimed in one step, so two pages opened in the same second don't both do it.
  const ref = db.doc(`tenants/${tenantId}`);
  const mine = await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data() || {};
    if (Date.now() - (Date.parse(String(x.walletDomainsBusyAt || '')) || 0) < BUSY_MS) return false;
    tx.set(ref, { walletDomainsBusyAt: new Date().toISOString() }, { merge: true }); return true;
  }).catch(() => false);
  if (!mine) return;
  const work = ensureWalletDomains(db, tenantId, tenant, requestOrigin, o)
    .catch((e) => { console.error('[wallet-domains] failed', tenantId, e?.message); })
    .finally(() => ref.set({ walletDomainsBusyAt: null }, { merge: true }).catch(() => null));
  try { const { after } = await import('next/server'); if (typeof after === 'function') after(() => work); } catch { /* outside a request */ }
  let timer: any;
  await Promise.race([work, new Promise((r) => { timer = setTimeout(r, ms); })]);
  clearTimeout(timer);
}
