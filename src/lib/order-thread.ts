// src/lib/order-thread.ts — ONE ORDER'S CONVERSATION AND RECORD, IN ONE ORDER OF TIME. The customer's messages and the
// shop's replies (tenants/{t}/retailSupport, a case per issue), the shop's own messages and every update the customer
// was sent (the order page's cards, retailOrders/{id}/inbox), and what the team and the system did (the order's
// events). The order workspace shows the conversation beside the order and the record under it; nothing here reads
// the network. Pure.

const ms = (v: unknown): number => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
const txt = (v: unknown, n = 1500) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);

export type ThreadMsg = {
  id: string;
  at: string;
  /** customer: they wrote it · shop: a person at the shop wrote it · update: an automatic update they were sent */
  who: 'customer' | 'shop' | 'update';
  text: string;
  by?: string;
  /** For an update: its one-line title ("Your order #1204 is on its way"). */
  title?: string;
  /** The case it belongs to (a reply goes there). */
  ticketId?: string;
  photos?: string[];
  /** A follow-up that only chased (no new information). */
  chaser?: boolean;
  /** How it reached the shop when it wasn't the order page. */
  via?: 'email' | 'text';
  /** A thank-you that doesn't wait on the shop (lib/order-texts). */
  quiet?: boolean;
};

/** Kinds that are the shop talking, not an automatic update. */
const SHOP_SPEAKS = new Set(['shop_message', 'address_reply']);

/** The conversation: their messages, the shop's replies and messages, and the updates they were sent, oldest first. */
export function conversationOf(inbox: any[], tickets: any[]): ThreadMsg[] {
  const out: ThreadMsg[] = [];
  for (const t of tickets || []) {
    if (!t) continue;
    const id = String(t.id || '');
    // Photos sent by text are in the shop's Twilio messages: said here, for the team (lib/order-texts).
    const smsPics = (x: any) => { const n = Math.max(0, Number(x?.smsPhotos) || 0); return n ? ` (${n === 1 ? 'A photo' : `${n} photos`} sent by text: open ${n === 1 ? 'it' : 'them'} in the shop’s Twilio messages.)` : ''; };
    if (txt(t.message) || smsPics(t)) out.push({ id: `${id}-0`, at: String(t.createdAt || ''), who: 'customer', text: `${txt(t.message)}${smsPics(t)}`.trim(), ticketId: id, photos: Array.isArray(t.photoUrls) ? t.photoUrls.slice(0, 4) : undefined, ...(t.via === 'sms' ? { via: 'text' as const } : {}) });
    (Array.isArray(t.followUps) ? t.followUps : []).forEach((f: any, i: number) => {
      if (txt(f?.message) || smsPics(f) || (Array.isArray(f?.photoUrls) && f.photoUrls.length)) out.push({ id: `${id}-f${i}`, at: String(f.at || ''), who: 'customer', text: `${txt(f.message)}${smsPics(f)}`.trim(), ticketId: id, photos: Array.isArray(f.photoUrls) ? f.photoUrls.slice(0, 4) : undefined, chaser: f.kind === 'chaser', ...(f.quiet === true ? { quiet: true } : {}), ...(f.kind === 'email' ? { via: 'email' as const } : f.kind === 'sms' ? { via: 'text' as const } : {}) });
    });
    (Array.isArray(t.replies) ? t.replies : []).forEach((r: any, i: number) => {
      if (txt(r?.text)) out.push({ id: `${id}-r${i}`, at: String(r.at || ''), who: 'shop', text: txt(r.text), by: r.by ? String(r.by) : undefined, ticketId: id });
    });
  }
  for (const c of inbox || []) {
    if (!c) continue;
    const kind = String(c.kind || '');
    if (kind === 'support_reply' || kind === 'support_received') continue;   // already in the case above
    const shop = SHOP_SPEAKS.has(kind);
    out.push({ id: `in-${c.id}`, at: String(c.at || ''), who: shop ? 'shop' : 'update', text: txt(c.body, shop ? 1500 : 600), title: txt(c.title, 200) || undefined, by: c.by ? String(c.by) : undefined });
  }
  return out.filter((m) => m.text || m.title || (m.photos && m.photos.length)).sort((a, b) => ms(a.at) - ms(b.at));
}

/** The case a reply would go to: the newest one still open. */
export function openCase(tickets: any[]): any | null {
  const open = (tickets || []).filter((t) => t && String(t.status || 'open') !== 'resolved');
  return open.sort((a, b) => ms(b.lastCustomerAt || b.updatedAt || b.createdAt) - ms(a.lastCustomerAt || a.updatedAt || a.createdAt))[0] || null;
}

/** Waiting on the shop: the customer spoke last in an open case. */
export function waitingOnShop(thread: ThreadMsg[], tickets: any[]): boolean {
  if (!openCase(tickets)) return false;
  const people = thread.filter((m) => m.who !== 'update' && !m.quiet);
  return people.length > 0 && people[people.length - 1].who === 'customer';
}

export type RecordRow = {
  id: string;
  at: string;
  /** told: something the customer was sent · customer: they wrote · team: a person at the shop · system: automatic */
  side: 'told' | 'customer' | 'team' | 'system';
  who: string;
  text: string;
  tone: 'ok' | 'warn' | 'plain';
};

export type RecordFilter = 'all' | 'told' | 'team' | 'customer' | 'system';

const SYSTEM_ACTORS = new Set(['system', 'shippo', 'carrier', 'stripe', 'webhook', 'cron', 'payments', '']);

/**
 * The order's whole record, oldest first: what happened (events, worded by `line`), what the customer was told, and
 * what they wrote. `line` is lib/orders-view eventLine, passed in so this stays free of the screen's wording.
 */
export function recordOf(events: any[], inbox: any[], tickets: any[], line: (e: any) => { text: string; tone: 'ok' | 'warn' | 'plain' }): RecordRow[] {
  const out: RecordRow[] = [];
  for (const e of events || []) {
    if (!e) continue;
    const l = line(e);
    // The reply itself is in the conversation; its note on the record would say it twice.
    if (/^Support reply/.test(String(e?.meta?.text || ''))) continue;
    const actor = String(e.actorId || '').toLowerCase();
    const name = String(e.actorName || '');
    const sys = SYSTEM_ACTORS.has(actor) || /^(carrier|payments|system|the system)$/i.test(name) || actor === 'customer';
    out.push({ id: `ev-${e.id}`, at: String(e.at || ''), side: actor === 'customer' ? 'customer' : sys ? 'system' : 'team', who: actor === 'customer' ? 'Customer' : name || (sys ? 'Automatic' : 'Team'), text: l.text.replace(/ · [^·]+$/, (m) => (name && m.includes(name) ? '' : m)), tone: l.tone });
  }
  for (const m of conversationOf(inbox, tickets)) {
    out.push({ id: `cv-${m.id}`, at: m.at, side: m.who === 'customer' ? 'customer' : 'told', who: m.who === 'customer' ? 'Customer' : m.who === 'shop' ? (m.by || 'The shop') : 'Update sent', text: m.who === 'update' ? m.title || m.text : m.text, tone: 'plain' });
  }
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}

export function filterRecord(rows: RecordRow[], f: RecordFilter): RecordRow[] {
  if (f === 'all') return rows;
  return rows.filter((r) => r.side === f);
}
