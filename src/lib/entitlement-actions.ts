// src/lib/entitlement-actions.ts — WHAT THE SHOP CAN DO FOR ONE BUYER OF A DOWNLOAD (pure), from the Digital products
// area: give more downloads, extend access (to a date, or for good), close access with a reason, or open it again.
// Each change is one patch to the buyer's access record (lib/entitlements) plus a line on its history with who and
// when. Refunds and chargebacks close access on their own (lib/digital-access); nothing here refunds anything.

export type EntAction =
  | { kind: 'add_downloads'; count: number }
  | { kind: 'extend'; until: string | 'forever' }
  | { kind: 'revoke'; reason: string }
  | { kind: 'reopen' };

/** The date access never ends on: far enough that no window reaches it. */
export const FOREVER = '9999-12-31T23:59:59.000Z';

export function cleanAction(raw: any): EntAction | null {
  const k = String(raw?.kind || '');
  if (k === 'add_downloads') { const n = Math.floor(Number(raw.count)); return n >= 1 && n <= 100 ? { kind: k, count: n } : null; }
  if (k === 'extend') {
    if (raw.until === 'forever') return { kind: k, until: 'forever' };
    const t = Date.parse(String(raw.until || ''));
    return Number.isFinite(t) ? { kind: k, until: new Date(t).toISOString() } : null;
  }
  if (k === 'revoke') { const r = String(raw.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200); return r ? { kind: k, reason: r } : null; }
  if (k === 'reopen') return { kind: k };
  return null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * The patch and history line for an action on a record, or why it can't be done. `now` is an ISO time; `by` is the
 * team member's name.
 */
export function applyAction(ent: any, a: EntAction, by: string, now: string, ctx: { endsAt?: string | null; closedFor?: string | null } = {}): { ok: true; patch: Record<string, any>; what: string } | { ok: false; error: string } {
  if (!ent) return { ok: false, error: 'That buyer’s record wasn’t found.' };
  // A refund or chargeback closes access whatever the record says: giving more, extending or reopening can't undo it.
  if (a.kind !== 'revoke' && ctx.closedFor && ['refunded', 'disputed', 'inactive'].includes(ctx.closedFor)) {
    return { ok: false, error: ctx.closedFor === 'refunded' ? 'This order was refunded, so access stays closed.' : ctx.closedFor === 'disputed' ? 'Access is paused while a chargeback is open. It opens again by itself if the shop wins.' : 'This order isn’t active.' };
  }
  // The first line (when it was bought) is always kept, with the latest 49 changes.
  const hist = (what: string) => { const h = [...(Array.isArray(ent.history) ? ent.history : []), { at: now, what, by }]; return h.length <= 50 ? h : [h[0], ...h.slice(-49)]; };
  if (a.kind === 'add_downloads') {
    if (ent.downloads?.allowed == null) return { ok: false, error: 'This buyer has no download limit.' };
    const what = `+${a.count} download${a.count === 1 ? '' : 's'}`;
    return { ok: true, what, patch: { downloads: { ...ent.downloads, extra: Math.max(0, Math.floor(Number(ent.downloads?.extra) || 0)) + a.count }, history: hist(what) } };
  }
  if (a.kind === 'extend') {
    const until = a.until === 'forever' ? FOREVER : a.until;
    if ('endsAt' in ctx && !ctx.endsAt) return { ok: false, error: 'This buyer’s access already has no end date.' };
    if (a.until !== 'forever' && Date.parse(until) <= Date.parse(now)) return { ok: false, error: 'Choose a date after today.' };
    if (a.until !== 'forever' && ctx.endsAt && Date.parse(until) <= Date.parse(ctx.endsAt)) return { ok: false, error: `Access already lasts until ${day(ctx.endsAt)}. Choose a later date.` };
    const what = a.until === 'forever' ? 'Access extended for good' : `Access extended to ${day(until)}`;
    return { ok: true, what, patch: { access: { ...(ent.access || {}), extendedUntil: until }, history: hist(what) } };
  }
  if (a.kind === 'revoke') {
    if (ent.status === 'revoked') return { ok: false, error: 'Access is already closed.' };
    const what = `Access closed: ${a.reason}`;
    return { ok: true, what, patch: { status: 'revoked', revoked: { at: now, by, reason: a.reason }, history: hist(what) } };
  }
  if (ent.status !== 'revoked') return { ok: false, error: 'Access is already open.' };
  return { ok: true, what: 'Access opened again', patch: { status: 'active', revoked: null, history: hist('Access opened again') } };
}

/** What the buyer is told, by email, about a change the shop made. */
export function buyerMessage(a: EntAction, product: string, shop: string, gift = false): { subject: string; line: string } {
  if (a.kind === 'add_downloads') return { subject: `More downloads for ${product}`, line: `${shop} gave you ${a.count} more download${a.count === 1 ? '' : 's'} of ${product}.` };
  if (a.kind === 'extend') return { subject: `Your access to ${product} is extended`, line: a.until === 'forever' ? `${shop} extended your access to ${product}. It’s yours to keep.` : `${shop} extended your access to ${product} until ${day(a.until)}.` };
  if (a.kind === 'revoke') return { subject: `Access to ${product} has closed`, line: `${shop} has closed your access to ${product}. Their reason: ${/[.!?]$/.test(a.reason) ? a.reason : `${a.reason}.`} If you think this is a mistake, ${gift ? 'reply to this email' : 'send them a message from your order page'}.` };
  return { subject: `${product} is open again`, line: `${shop} opened your access to ${product} again.` };
}
