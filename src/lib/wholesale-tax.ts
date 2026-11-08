// src/lib/wholesale-tax.ts — WHEN A WHOLESALE ORDER IS SOLD TAX FREE (pure; checkout, the shop and Wholesale all ask
// this, so all three agree).
//
// A buyer's sales tax is set on their account (tenants/{t}/wholesaleAccounts): they pay it ('taxable'), or they buy tax
// free ('exempt') with a resale certificate for each state, kept with its number, an end date if it has one, a copy,
// and who accepted it and when. An order is tax free only when all of these hold:
//   · it's placed with one of the buyer's emails (their contact email, or one the shop added for their staff), and
//     that email is proven theirs: signed in on the shop (lib/retail-account, the same proof store credit needs; the
//     link in the code email signs them in). A code passed around gets wholesale prices but never their exemption, and
//     typing their email isn't enough;
//   · it's taxed in a state they have a current certificate for (pickup is taxed where the shop is; a shipped or
//     delivered order where it goes, and an address whose state can't be read matches none). Only when the shop's own
//     state isn't known does any current certificate count for a pickup;
//   · that certificate hasn't ended: it covers its end date, and tax comes back the day after;
//   · it isn't downloads only (those are sold where the buyer is, which a certificate here can't show).
// Buyers set up before this were tax free under one shop-wide switch (retailSettings.wholesaleTaxExempt). They stay tax
// free without a certificate (taxFromShopSwitch, or no setting yet while the switch is on), still only with their own
// email, until the shop adds their certificate, which then decides. That switch otherwise covers only the house code,
// which has no account and no certificate.
import { US_STATES } from './pay-extras';

export type Cert = {
  id: string; state: string; number: string; endsOn: string | null;
  fileUrl?: string; fileName?: string; acceptedBy?: string; acceptedById?: string; acceptedAt?: string;
};
/** Where an order is taxed, when it's a shipped or delivered order whose state can't be read: matches no certificate. */
export const UNREADABLE = '??';
export type TaxSetting = 'exempt' | 'taxable';
export type TaxFreeWhy = 'house' | 'cert' | 'legacy' | 'taxable' | 'verify' | 'email' | 'ended' | 'state' | 'no_cert' | 'digital' | 'none';
export type TaxFree = { free: boolean; why: TaxFreeWhy; cert?: Cert; endedOn?: string; states?: string[] };

export const STATE_NAMES: Record<string, string> = Object.fromEntries(US_STATES);
export const STATE_LIST: [string, string][] = US_STATES;
const BY_NAME = new Map(US_STATES.map(([c, n]) => [n.toLowerCase(), c]));
const lc = (v: any) => String(v ?? '').trim().toLowerCase();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A US state as its two letters, from "TX", "tx" or "Texas"; null when it isn't one. */
export function stateCode(v: any): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (STATE_NAMES[up]) return up;
  return BY_NAME.get(s.toLowerCase().replace(/\s+/g, ' ')) || null;
}
export const stateName = (c: string) => STATE_NAMES[c] || c;

/** A real calendar day as YYYY-MM-DD, or null. */
export function dayOrNull(v: any): string | null {
  const s = String(v ?? '').trim();
  if (!DAY.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** The certificates on an account, cleaned: each needs a state; the rest is kept as written. */
export function readCerts(raw: any): Cert[] {
  if (!Array.isArray(raw)) return [];
  const out: Cert[] = [];
  for (const c of raw.slice(0, 40)) {
    const state = stateCode(c?.state); if (!state) continue;
    out.push({
      id: String(c?.id || `${state}-${out.length}`).slice(0, 40), state, number: String(c?.number || '').trim().slice(0, 40),
      endsOn: dayOrNull(c?.endsOn),
      ...(c?.fileUrl ? { fileUrl: String(c.fileUrl).slice(0, 1200) } : {}), ...(c?.fileName ? { fileName: String(c.fileName).slice(0, 120) } : {}),
      ...(c?.acceptedBy ? { acceptedBy: String(c.acceptedBy).slice(0, 80) } : {}), ...(c?.acceptedById ? { acceptedById: String(c.acceptedById).slice(0, 80) } : {}), ...(c?.acceptedAt ? { acceptedAt: String(c.acceptedAt).slice(0, 40) } : {}),
    });
  }
  return out;
}

/** Still in force on `today` (YYYY-MM-DD): no end date, or it ends today or later. */
export const isCurrent = (c: Cert, today: string) => !c.endsOn || c.endsOn >= today;

/** The account's sales tax as it stands: its own setting, else the old shop-wide switch (legacy). */
export function taxSettingOf(acct: any, rs: any): { setting: TaxSetting; legacy: boolean } {
  if (acct?.tax === 'exempt') return { setting: 'exempt', legacy: acct?.taxFromShopSwitch === true };
  if (acct?.tax === 'taxable') return { setting: 'taxable', legacy: false };
  return rs?.wholesaleTaxExempt === true ? { setting: 'exempt', legacy: true } : { setting: 'taxable', legacy: false };
}

/** The emails an order may be placed with to be tax free: the contact email, then any the shop added. */
export function taxEmailsOf(acct: any): string[] {
  const xs = [acct?.email, ...(Array.isArray(acct?.taxEmails) ? acct.taxEmails : [])].map(lc).filter(Boolean);
  return [...new Set(xs)].slice(0, 12);
}

/** The latest end date among the ones that have passed (for the words "ended Oct 1"). */
const lastEnded = (cs: Cert[], today: string) => cs.filter((c) => c.endsOn && c.endsOn < today).map((c) => c.endsOn as string).sort().pop();

/**
 * Whether this wholesale order is tax free, and why or why not. `account` is null for the house code. `email` is what
 * the order is placed with, and `proven` says it was proven theirs (a signed-in account session for that same email).
 * `taxState` is where the order is taxed (taxStateOf): two letters, UNREADABLE, or null when the shop's own state
 * isn't known for a pickup.
 */
export function taxFreeFor(a: { account: any | null; rs: any; email: string; proven: boolean; taxState: string | null; today: string; digitalOnly?: boolean }): TaxFree {
  if (!a.account) return a.rs?.wholesaleTaxExempt === true ? { free: true, why: 'house' } : { free: false, why: 'none' };
  const s = taxSettingOf(a.account, a.rs);
  if (s.setting === 'taxable') return { free: false, why: 'taxable' };
  if (a.digitalOnly) return { free: false, why: 'digital' };
  // Proof first: without it nobody learns whether an email is on the buyer's list, or anything about their certificates.
  if (!a.proven) return { free: false, why: 'verify' };
  if (!taxEmailsOf(a.account).includes(lc(a.email))) return { free: false, why: 'email' };
  const certs = readCerts(a.account.certs);
  if (!certs.length) return s.legacy ? { free: true, why: 'legacy' } : { free: false, why: 'no_cert' };
  const cur = certs.filter((c) => isCurrent(c, a.today));
  const st = a.taxState === UNREADABLE ? UNREADABLE : a.taxState ? stateCode(a.taxState) : null;
  const match = st ? cur.find((c) => c.state === st) : cur[0];
  if (match) return { free: true, why: 'cert', cert: match };
  // Nothing current at all: they're told when it ended. A current one for another state, but this state's ended: the
  // same. Otherwise this state was never on file: they're told which states are.
  if (!cur.length) return { free: false, why: 'ended', endedOn: lastEnded(certs, a.today) };
  const endedHere = st ? lastEnded(certs.filter((c) => c.state === st), a.today) : undefined;
  if (endedHere) return { free: false, why: 'ended', endedOn: endedHere };
  return { free: false, why: 'state', states: [...new Set(cur.map((c) => c.state))] };
}

/** Where an order is taxed: a shipped or delivered order where it goes (UNREADABLE when its state can't be read),
 *  anything else where the shop is (null when that isn't known). */
export function taxStateOf(method: string, shipState: any, shopState: any): string | null {
  return method === 'ship' || method === 'delivery' ? stateCode(shipState) || UNREADABLE : stateCode(shopState);
}

/** An order sold tax free under a certificate (which is for one state) whose new address is in another state, or one
 *  that can't be read. The house code and buyers from before aren't tied to a state. */
export function taxFreeMoved(order: any, to: any): boolean {
  if (order?.taxFree !== true || order?.taxFreeWhy !== 'cert') return false;
  const was = stateCode(order?.taxFreeCert?.state) || stateCode(order?.shippingAddress?.state);
  const now = stateCode(to?.state);
  return !now || (!!was && now !== was);
}

/** The shop's own state, where a pickup is sold: its business address, else its ship-from address. */
export function shopStateOf(tenant: any): string | null {
  const rs = tenant?.retailSettings || {};
  const addr = tenant?.address && typeof tenant.address === 'object' ? tenant.address : null;
  return stateCode(addr?.state || addr?.region) || stateCode(tenant?.state) || stateCode(rs?.shipFrom?.state) || stateCode(rs?.shipFromState);   // the address is private; its state is kept public (lib/tenant-private)
}

/** What the shop's checkout needs to say the same thing before paying: no certificate numbers and no emails. When
 *  the page sends a signed-in session (lib/retail-account), `signedIn` says whether that proven email is one of the
 *  buyer's; `today` is the shop's own day, so the page and checkout agree on an end date. */
export type ShopTaxInfo = { house: true; free: boolean } | {
  house: false; business: string; setting: TaxSetting; legacy: boolean;
  certs: { state: string; endsOn: string | null }[]; shopState: string | null; today: string;
  signedIn: { email: string; listed: boolean } | null;
};
export function shopTaxInfo(account: any | null, rs: any, shopState: string | null, today: string, signedInEmail: string | null): ShopTaxInfo {
  if (!account) return { house: true, free: rs?.wholesaleTaxExempt === true };
  const s = taxSettingOf(account, rs);
  const exempt = s.setting === 'exempt';
  const e = signedInEmail ? lc(signedInEmail) : '';
  return {
    house: false, business: String(account.businessName || ''), setting: s.setting, legacy: s.legacy,
    certs: exempt ? readCerts(account.certs).map((c) => ({ state: c.state, endsOn: c.endsOn })) : [], shopState, today,
    signedIn: exempt && e ? { email: e, listed: taxEmailsOf(account).includes(e) } : null,
  };
}
/** The same answer as taxFreeFor, worked out on the shop from ShopTaxInfo and the email typed. */
export function taxFreeOnShop(info: ShopTaxInfo | null | undefined, typedEmail: string, method: string, shipState: any, digitalOnly = false): TaxFree {
  if (!info) return { free: false, why: 'none' };
  if (info.house) return info.free ? { free: true, why: 'house' } : { free: false, why: 'none' };
  const typed = lc(typedEmail);
  const proven = !!info.signedIn && !!typed && info.signedIn.email === typed;
  const account = {
    tax: info.setting, taxFromShopSwitch: info.legacy, email: '', taxEmails: proven && info.signedIn?.listed ? [typed] : [],
    certs: info.certs.map((c, i) => ({ id: String(i), state: c.state, number: '', endsOn: c.endsOn })),
  };
  return taxFreeFor({ account, rs: {}, email: typed, proven, taxState: taxStateOf(method, shipState, info.shopState), today: info.today, digitalOnly });
}

/** A short date for a YYYY-MM-DD day: "Nov 12", with the year when it isn't this one. */
export function dayLabel(day: string | null | undefined, now = new Date()): string {
  const d = dayOrNull(day); if (!d) return '';
  const dt = new Date(`${d}T12:00:00Z`);
  const sameYear = dt.getUTCFullYear() === now.getUTCFullYear();
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const listStates = (xs: string[]) => { const n = xs.map(stateName); return n.length <= 2 ? n.join(' and ') : `${n[0]} and ${n.length - 1} more`; };

/** How a buyer's sales tax reads on Wholesale: a short label, and whether it needs the team (amber). */
export function buyerTaxLabel(acct: any, rs: any, today: string): { label: string; warn: boolean } {
  const s = taxSettingOf(acct, rs);
  if (s.setting === 'taxable') return { label: 'Pays tax', warn: false };
  const certs = readCerts(acct?.certs);
  if (!taxEmailsOf(acct).length) return { label: 'Tax free, add their email', warn: true };
  if (!certs.length) return s.legacy ? { label: 'Tax free, add their certificate', warn: true } : { label: 'Pays tax until a certificate is added', warn: true };
  const cur = certs.filter((c) => isCurrent(c, today));
  if (!cur.length) return { label: `Certificate ended ${dayLabel(lastEnded(certs, today))}`, warn: true };
  // A state whose certificate ends within 30 days, with no other one for that state lasting longer.
  const soon = addDays(today, 30);
  const ending = cur.filter((c) => c.endsOn && c.endsOn <= soon && !cur.some((o) => o !== c && o.state === c.state && (!o.endsOn || o.endsOn > soon)))
    .sort((x, y) => String(x.endsOn).localeCompare(String(y.endsOn)))[0];
  if (ending) return { label: `Certificate ends ${dayLabel(ending.endsOn)}`, warn: true };
  return { label: `Tax free in ${listStates([...new Set(cur.map((c) => c.state))])}`, warn: false };
}

/** What checkout says about sales tax on a wholesale order that isn't tax free, or null when there's nothing to say. */
export function taxNote(tf: TaxFree, business: string, shopName: string): string | null {
  const who = business || 'your business';
  if (tf.why === 'verify') return `To buy tax free, sign in with ${who}’s email on file. Until then, sales tax is added.`;
  if (tf.why === 'email') return `Sales tax is added. Tax-free buying is for orders placed with ${who}’s email on file.`;
  if (tf.why === 'digital') return 'Sales tax is added: downloads aren’t sold tax free.';
  if (tf.why === 'ended') return `Your resale certificate on file ended ${dayLabel(tf.endedOn)}, so sales tax is added. Send ${shopName || 'the shop'} a new one to buy tax free again.`;
  if (tf.why === 'state') return `Sales tax is added. ${who}’s resale certificate on file is for ${listStates(tf.states || [])}.`;
  if (tf.why === 'no_cert') return `Sales tax is added until ${shopName || 'the shop'} has your resale certificate.`;
  return null;
}
