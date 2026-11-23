// src/lib/printing.ts — PRINTERS (design canvas Printers): what goes on paper, and how each kind of printer is spoken to.
// Pure. A printed thing is a PrintDoc (a few kinds of block), laid out here for:
//   - Star printers on CloudPRNT: plain text at the printer's width (renderText), cut and buzzer by header;
//   - Epson printers on Server Direct Print: ePOS-Print XML (renderEpos), with big headings, the allergy line printed
//     white on black, and a QR code for paying at the table;
//   - a tablet's own print dialog (renderHtml), for a business without a networked printer.
//   In the app's look (design board "Stickers, labels, receipts and tickets in the app's look", A: quiet and bold): a
//   printer that prints pictures is sent each slip drawn in the app's typeface (lib/print-picture): the business's
//   initial in a black tile, the number big and heavy, thin rules, the allergy in a black band, black and white only.
//   Epson printers always; a Star printer on CloudPRNT when it asks for one (most do). Otherwise these letters.
// What's printed:
//   - kitchen tickets, by themselves, at the station that makes them (one slip a table's course or an order);
//   - "Taken off" when something already printed is taken off a table's tab;
//   - "Allergy update" when an allergy changes on a ticket already printed;
//   - the guest check, when a server asks for it;
//   - a receipt (design board "Receipts at the counter"): a sale's, for the guest, on a printer that prints receipts;
//   - a bag label for each bag of a food order (lib/food-bags), on a printer set to print them;
//   - a test page.
// A printer with a cash drawer plugged into it opens the drawer for a cash sale (Epson: a pulse in the slip; Star: a
// header), with or without a receipt.
// Nothing here is printed in capitals: the allergy line stands out by being printed white on black (Epson) or set off
// with marks (Star text).
import { allergyFlags } from '@/lib/kitchen';
import { tableLabel } from '@/lib/table-service';
import { STICKER_ON, STICKER_ON_WORDS, type StickerOn } from '@/lib/sticker-on';

export type PrinterKind = 'star' | 'epson';
export type PrinterSettings = { name: string; kind: PrinterKind; cols: number; stations: string[]; tickets: boolean; checks: boolean; buzz: boolean; receipts: boolean; drawer: boolean;
  /** Prints the bag labels of food orders (lib/food-bags): an Epson's carry each bag's code to scan; a Star's, words only. */
  labels: boolean;
  /** Prints a sticker for each item made at its stations, as the order comes in (lib/item-stickers): the bar's cups. */
  stickers: boolean;
  /** Its stickers on every order (null), or only on the orders where a mistake costs most (lib/item-stickers
   *  stickersFor; design board "A sticker on each item", C): a delivery app's, the business's own drivers', one of two
   *  or more bags, one with an allergy. */
  stickersOn: StickerOn[] | null };
export type { StickerOn };
export const COLS: Record<PrinterKind, number> = { star: 48, epson: 42 };
export const MAX_PRINTERS = 12;

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function cleanPrinter(raw: any): PrinterSettings {
  const kind: PrinterKind = raw?.kind === 'epson' ? 'epson' : 'star';
  const c = Math.round(Number(raw?.cols));
  return {
    name: clip(raw?.name, 40) || (kind === 'epson' ? 'Epson printer' : 'Star printer'), kind,
    cols: Number.isFinite(c) && c >= 24 && c <= 64 ? c : COLS[kind],
    stations: Array.from(new Set((Array.isArray(raw?.stations) ? raw.stations : []).map((s: unknown) => clip(s, 24)).filter(Boolean))).slice(0, 12) as string[],
    tickets: raw?.tickets !== false, checks: raw?.checks === true, buzz: raw?.buzz !== false,
    receipts: raw?.receipts === true, drawer: raw?.drawer === true, labels: raw?.labels === true, stickers: raw?.stickers === true,
    stickersOn: stickersOnOf(raw),
  };
}
/** The orders kept to, as set: each one known, once, in order; none picked is every order. */
function stickersOnOf(raw: any): StickerOn[] | null {
  if (raw?.stickers !== true || !Array.isArray(raw?.stickersOn)) return null;
  const on = STICKER_ON.filter((x) => raw.stickersOn.includes(x));
  return on.length ? on : null;
}

export type Block =
  /** The business, at the top of what a guest takes home: its initial in a black tile, and its name. */
  | { k: 'brand'; name: string }
  /** `mark`: the business's initial in a black tile before the number (a sticker). */
  | { k: 'head'; left: string; right?: string; mark?: string }
  | { k: 'text'; text: string; bold?: boolean; center?: boolean }
  | { k: 'item'; qty: number; name: string; sub?: string[] }
  | { k: 'money'; left: string; right: string; bold?: boolean }
  | { k: 'alert'; text: string }
  | { k: 'rule' }
  | { k: 'qr'; data: string };
export type PrintDoc = { blocks: Block[]; buzz?: boolean; drawer?: boolean;
  /** Drawn as a picture: the code beside the top of the slip (a label or sticker), not under it. */
  qrBeside?: boolean };
/** A business's initial, for its tile. */
export const initialOf = (name: unknown) => (String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().match(/[A-Za-z0-9]/)?.[0] || '').toUpperCase();

/** Plain letters for a printer's own font: curly quotes straight, accents off, and "?" for a letter it can't print
 *  (never just left out, so a line can't look emptier than what was typed). */
export function ascii(s: unknown): string {
  return String(s ?? '').replace(/[\u2018\u2019\u201a\u2032]/g, "'").replace(/[\u201c\u201d\u201e\u2033]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/\u00d7/g, 'x').replace(/[\u20ac\u00a3\u00a5]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e\n]+/g, '?');
}
/** An allergy line in letters the printer can't print says to look at the screen, where it's written in full. */
const qs = (s: string) => (s.match(/\?/g) || []).length;
const alertText = (s: string) => { const a = ascii(s); return qs(a) > qs(String(s)) ? `${a} (see the screen)` : a; };

/** Lines no wider than the paper: words kept whole where they fit, and a word longer than a line broken across lines
 *  (never cut short, so nothing on a ticket or a link is lost). */
const wrap = (s: string, cols: number, indent = ''): string[] => {
  const width = (n: number) => cols - (n ? indent.length : 0);
  const out: string[] = []; let line = '';
  const flush = () => { out.push(line); line = ''; };
  for (const word of s.split(' ')) {
    let w = word;
    if (line && (line + ' ' + w).length <= width(out.length)) { line += ' ' + w; continue; }
    if (line) flush();
    while (w.length > width(out.length)) { line = w.slice(0, width(out.length)); w = w.slice(width(out.length)); flush(); }
    line = w;
  }
  if (line || !out.length) out.push(line);
  return out.map((l, i) => (i ? indent + l : l));
};
const pair = (l: string, r: string, cols: number): string[] => {
  if (l.length + 1 + r.length <= cols) return [l + ' '.repeat(cols - l.length - r.length) + r];
  return [...wrap(l, cols), ' '.repeat(Math.max(0, cols - r.length)) + r];
};
const centered = (s: string, cols: number) => wrap(s, cols).map((l) => ' '.repeat(Math.max(0, Math.floor((cols - l.length) / 2))) + l);

/** For a Star printer's own font, at its width (48 a line on 80mm paper, 32 on 58mm). */
export function renderText(doc: PrintDoc, cols: number): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    if (b.k === 'rule') out.push('-'.repeat(cols));
    else if (b.k === 'brand') out.push(...centered(ascii(b.name), cols));
    else if (b.k === 'head') out.push(...(b.right ? pair(ascii(b.left), ascii(b.right), cols) : wrap(ascii(b.left), cols)));
    else if (b.k === 'text') out.push(...(b.center ? centered(ascii(b.text), cols) : wrap(ascii(b.text), cols)));
    else if (b.k === 'item') { out.push(...wrap(`${b.qty}  ${ascii(b.name)}`, cols, '   ')); for (const x of b.sub || []) out.push(...wrap(ascii(x), cols - 3).map((l) => `   ${l}`)); }
    else if (b.k === 'money') out.push(...pair(ascii(b.left), ascii(b.right), cols));
    else if (b.k === 'alert') out.push(...wrap(`>> ${alertText(b.text)} <<`, cols, '   '));
    else if (b.k === 'qr') out.push(...wrap(ascii(b.data), cols));
  }
  return `${out.join('\n')}\n\n\n`;
}

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const t = (s: string, a: Record<string, string | boolean> = {}) => `<text${Object.entries(a).map(([k, v]) => ` ${k}="${v}"`).join('')}>${x(s)}&#10;</text>`;
const plain = '<text dw="false" dh="false" em="false" reverse="false" align="left"/>';
/** ePOS-Print XML for an Epson printer (Server Direct Print). */
export function renderEpos(doc: PrintDoc, cols: number): string {
  // (The cash drawer, plugged into the printer: opened first; just that, with nothing to print.)
  const pulse = doc.drawer ? '<pulse drawer="drawer_1" time="pulse_100"/>' : '';
  if (!doc.blocks.length) return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${pulse}</epos-print>`;
  const out: string[] = [pulse, '<text lang="en" smooth="true"/>'];
  for (const b of doc.blocks) {
    if (b.k === 'rule') out.push(t('-'.repeat(cols)));
    else if (b.k === 'brand') out.push('<text align="center"/>', t(ascii(b.name), { em: true }), plain);
    else if (b.k === 'head') { out.push(t(ascii(b.left), { dw: true, dh: true, em: true }), plain); if (b.right) out.push(t(ascii(b.right))); }
    else if (b.k === 'text') { out.push(b.center ? '<text align="center"/>' : '', t(ascii(b.text), b.bold ? { em: true } : {}), plain); }
    else if (b.k === 'item') { out.push(t(`${b.qty}  ${ascii(b.name)}`, { dh: true, em: true }), plain); for (const s of b.sub || []) out.push(t(`   ${ascii(s)}`)); }
    else if (b.k === 'money') { out.push(...pair(ascii(b.left), ascii(b.right), cols).map((l) => t(l, b.bold ? { em: true } : {})), plain); }
    else if (b.k === 'alert') { out.push(t(alertText(b.text), { reverse: true, em: true }), plain); }
    else if (b.k === 'qr') { out.push('<text align="center"/>', `<symbol type="qrcode_model_2" level="level_m" width="5">${x(b.data)}</symbol>`, '<feed/>', plain); }
  }
  out.push('<feed line="3"/>', '<cut type="feed"/>');
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${out.filter(Boolean).join('')}</epos-print>`;
}

/** ePOS-Print XML for a slip drawn as a picture (lib/print-picture): the cash drawer first (as for its letters), its
 *  rows of black and white dots, one bit a dot, then the cut. */
export function eposPicture(pic: { width: number; height: number; bits: string }, doc: PrintDoc): string {
  const pulse = doc.drawer ? '<pulse drawer="drawer_1" time="pulse_100"/>' : '';
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${pulse}<text align="center"/><image width="${pic.width}" height="${pic.height}" color="color_1" mode="mono">${pic.bits}</image><feed line="3"/><cut type="feed"/></epos-print>`;
}

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A page for a tablet's own print dialog (a receipt printer set up on the tablet). */
export function renderHtml(doc: PrintDoc, o: { font: string; fontHref: string; mm?: number }): string {
  const mm = o.mm || 80;
  const body = doc.blocks.map((b) => {
    // (The same quiet, bold look as a printer's picture: lib/print-picture.)
    const tile = (c: string, px: number) => `<span style="display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;border-radius:${Math.round(px / 4)}px;background:#000;color:#fff;font-weight:800;font-size:${Math.round(px * 0.55)}px;flex-shrink:0">${h(c)}</span>`;
    if (b.k === 'rule') return '<hr style="border:none;border-top:1.5px solid #000;margin:8px 0;">';
    if (b.k === 'brand') return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">${initialOf(b.name) ? tile(initialOf(b.name), 22) : ''}<b style="font-size:14px">${h(b.name)}</b></div>`;
    if (b.k === 'head') return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">${b.mark ? tile(b.mark, 26) : ''}<b style="font-size:30px;font-weight:800;letter-spacing:-0.02em;line-height:1.05;flex:1">${h(b.left)}</b>${b.right ? `<span style="font-weight:700;font-size:13px">${h(b.right)}</span>` : ''}</div>`;
    if (b.k === 'text') return `<div style="${b.center ? 'text-align:center;' : ''}${b.bold ? 'font-weight:700;font-size:14px;' : 'font-weight:500;'}">${h(b.text)}</div>`;
    if (b.k === 'item') return `<div style="display:flex;gap:10px;font-size:15px;font-weight:700;margin-top:3px"><span style="font-weight:800;min-width:14px">${b.qty}</span><span>${h(b.name)}${(b.sub || []).map((s) => `<span style="display:block;font-weight:500;font-size:12px">${h(s)}</span>`).join('')}</span></div>`;
    if (b.k === 'money') return `<div style="display:flex;justify-content:space-between;${b.bold ? 'font-weight:800;font-size:17px;margin-top:4px;' : 'font-weight:500;'}"><span>${h(b.left)}</span><span>${h(b.right)}</span></div>`;
    if (b.k === 'alert') return `<div style="background:#000;color:#fff;font-weight:700;padding:5px 9px;margin:4px 0;border-radius:8px">${h(b.text)}</div>`;
    return `<div style="text-align:center;word-break:break-all;font-size:10px">${h(b.data)}</div>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title><link href="${o.fontHref}" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:${o.font};font-size:12px;line-height:1.45;font-variant-numeric:tabular-nums;width:${mm - 8}mm;padding:4px 6px;background:#fff;color:#000;}@media print{@page{margin:0;size:${mm}mm auto;}body{width:${mm}mm;}}</style></head><body>${body}<div style="height:16px"></div></body></html>`;
}

/** "7:42 pm" in the business's time. */
export const clockIn = (iso: string | null | undefined, tz: string | null) => { const d = new Date(String(iso || '')); if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).replace(' AM', ' am').replace(' PM', ' pm'); };
const dayIn = (iso: string, tz: string | null) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(tz ? { timeZone: tz } : {}) });
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Number(n) || 0).toFixed(2)}`;

/** Where a ticket goes and whose it is, as the slip's heading. */
function headOf(k: any): string {
  if (k.orderNumber) return `Order ${k.orderNumber}`;
  if (k.tableNumber) return tableLabel(k.tableNumber);
  return String(k.station || k.name || 'Order');
}
const CHANNEL: Record<string, string> = { 'drive-thru': 'Drive-thru', counter: 'Counter', kiosk: 'Kiosk', ahead: 'Ordered ahead' };

/** One slip for a table's course (or an order) at a station: what to make, each seat and choice, the allergies set off
 *  so they can't be missed, and whose it is. `tickets` are kitchen tickets as lib/kitchen reads them. */
export function ticketDoc(tickets: any[], o: { tz: string | null; at: string; station: string | null; buzz: boolean }): PrintDoc {
  const k = tickets[0] || {};
  const blocks: Block[] = [{ k: 'head', left: headOf(k), right: clockIn(o.at, o.tz) }];
  const sub = [k.courseName ? String(k.courseName) : null, k.channel ? CHANNEL[k.channel] || null : null, k.dueAt ? `Ready by ${clockIn(k.dueAt, o.tz)}` : null, o.station].filter(Boolean).join('. ');
  if (sub) blocks.push({ k: 'text', text: sub });
  blocks.push({ k: 'rule' });
  for (const tk of tickets) {
    // Each choice on its own line, so "No onions" is never lost in a list.
    const picked: string[] = Array.isArray(tk.choiceList) && tk.choiceList.length ? tk.choiceList : tk.choices ? [tk.choices] : [];
    const subs = [...picked, tk.seatNumber ? `Seat ${tk.seatNumber}` : null, tk.remake ? 'Remake' : null].filter(Boolean) as string[];
    const note = tk.note && !allergyFlags(tk).mentions.includes(tk.note) ? String(tk.note) : null;
    blocks.push({ k: 'item', qty: Math.max(1, Number(tk.quantity) || 1), name: String(tk.item || 'Item'), sub: note ? [...subs, note] : subs });
  }
  const alerts = allergyLines(tickets);
  if (alerts.length) { blocks.push({ k: 'rule' }); for (const a of alerts) blocks.push({ k: 'alert', text: a }); }
  blocks.push({ k: 'rule' }, { k: 'money', left: String(k.name || ''), right: `#${String(k.id || '').slice(-6)}` });
  return { blocks, buzz: o.buzz };
}

/** A paper ticket from a server's phone, for what couldn't reach the kitchen's screens (no connection): each
 *  station's items on its own part, as a ticket would print there. */
export function paperDoc(groups: { station: string | null; tickets: any[] }[], o: { tz: string | null; at: string; by: string }): PrintDoc {
  const blocks: Block[] = [{ k: 'text', text: 'Paper ticket: not on the screens yet', center: true, bold: true },
    { k: 'text', text: 'It shows on the screens too once the connection’s back. Make it once.', center: true }, { k: 'rule' }];
  groups.filter((g) => g.tickets.length).forEach((g, i) => {
    const d = ticketDoc(g.tickets, { tz: o.tz, at: o.at, station: g.station ? `For the ${g.station}` : null, buzz: false });
    // The slip's own footer names a ticket number the kitchen can't see yet: the server's name instead, once at the end.
    if (i) blocks.push({ k: 'rule' }, { k: 'rule' });
    blocks.push(...d.blocks.slice(0, -2));
  });
  blocks.push({ k: 'rule' }, { k: 'text', text: o.by });
  return { blocks, buzz: false };
}

/** The allergy lines for a slip: each seat's allergies picked from the list (and how serious), and anything typed by
 *  hand that mentions one. The same line is printed once. */
export function allergyLines(tickets: any[]): string[] {
  const out = new Set<string>();
  for (const tk of tickets) {
    const f = allergyFlags(tk);
    if (f.listed.length) out.add(`Allergy${tk.seatNumber ? `, seat ${tk.seatNumber}` : ''}: ${f.listed.map((a) => `${a.name.toLowerCase()}${a.severe ? ', severe' : ''}`).join('; ')}`);
    for (const m of f.mentions) out.add(`Allergy note: ${m}`);
  }
  return Array.from(out);
}

/** "Allergy update": an allergy changed on tickets the station already has on paper. */
export function allergyUpdateDoc(tickets: any[], o: { tz: string | null; at: string }): PrintDoc {
  const k = tickets[0] || {};
  const alerts = allergyLines(tickets);
  return { blocks: [{ k: 'head', left: 'Allergy update', right: clockIn(o.at, o.tz) }, { k: 'text', text: headOf(k) }, { k: 'rule' },
    ...tickets.map((tk): Block => ({ k: 'item', qty: Math.max(1, Number(tk.quantity) || 1), name: String(tk.item || 'Item') })), { k: 'rule' },
    ...(alerts.length ? alerts.map((a): Block => ({ k: 'alert', text: a })) : [{ k: 'text', text: 'No allergy on these now.' } as Block])], buzz: true };
}

/** "Taken off": something already printed was taken off the tab. */
export function voidDoc(items: { qty: number; name: string }[], o: { where: string; by: string; tz: string | null; at: string }): PrintDoc {
  return { blocks: [{ k: 'head', left: 'Taken off', right: clockIn(o.at, o.tz) }, { k: 'text', text: `${o.where}${o.by ? `. By ${o.by}` : ''}` }, { k: 'rule' },
    ...items.map((i): Block => ({ k: 'item', qty: i.qty, name: i.name }))], buzz: true };
}

export type CheckLine = { name: string; price: number; comped: boolean };
/** The guest check: what they had (the same things together), the totals, and how to pay at the table when they can. */
export function checkDoc(c: { business: string; table: string; name: string; size: number; lines: CheckLine[]; subtotal: number; discount: number; tax: number; total: number; paid: number;
  payUrl: string | null; at: string; tz: string | null }): PrintDoc {
  const groups = new Map<string, { qty: number; name: string; each: number; comped: boolean }>();
  for (const l of c.lines) { const k = `${l.name}|${l.price}|${l.comped}`; const g = groups.get(k); if (g) g.qty += 1; else groups.set(k, { qty: 1, name: l.name, each: l.price, comped: l.comped }); }
  const blocks: Block[] = [{ k: 'brand', name: c.business }, { k: 'text', text: `${c.table}. ${c.name}, ${c.size}` },
    { k: 'text', text: `${dayIn(c.at, c.tz)}, ${clockIn(c.at, c.tz)}` }, { k: 'rule' }];
  for (const g of groups.values()) blocks.push({ k: 'money', left: `${g.qty}  ${g.name}`, right: g.comped ? 'On the house' : money(g.each * g.qty) });
  blocks.push({ k: 'rule' }, { k: 'money', left: 'Subtotal', right: money(c.subtotal) });
  if (c.discount > 0) blocks.push({ k: 'money', left: 'Discount', right: money(-c.discount) });
  if (c.tax > 0) blocks.push({ k: 'money', left: 'Tax', right: money(c.tax) });
  blocks.push({ k: 'money', left: 'Total', right: money(c.total), bold: true });
  if (c.paid > 0) blocks.push({ k: 'money', left: 'Paid', right: money(-c.paid) }, { k: 'money', left: 'Left to pay', right: money(Math.max(0, c.total - c.paid)), bold: true });
  if (c.payUrl) blocks.push({ k: 'rule' }, { k: 'text', text: 'Pay at your table with your phone', center: true }, { k: 'qr', data: c.payUrl });
  blocks.push({ k: 'text', text: 'Thank you', center: true });
  return { blocks, buzz: false };
}

/** A test page: the printer's name and that it's set up right. */
export function testDoc(o: { business: string; printer: string; what: string; at: string; tz: string | null }): PrintDoc {
  return { blocks: [{ k: 'head', left: 'Test print', right: clockIn(o.at, o.tz) }, { k: 'text', text: `${o.printer}, ${o.business}` }, { k: 'rule' },
    { k: 'text', text: `This printer is set up. It prints ${o.what}.` }, { k: 'alert', text: 'Allergy lines look like this' }], buzz: true };
}

/** What a printer prints, in words: "Kitchen and Grill tickets, and checks". */
export function printsWords(p: PrinterSettings): string {
  const and = (w: string[]) => (w.length <= 1 ? (w[0] || '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);
  const tix = p.tickets ? (p.stations.length ? `${and(p.stations)} tickets` : 'every station’s tickets') : '';
  const onW = (x: StickerOn) => STICKER_ON_WORDS.find((w) => w.id === x)?.words || x;
  const stk = p.stickers ? `${p.stations.length ? `${and(p.stations)} item stickers` : 'item stickers'}${p.stickersOn?.length ? ` (on ${and(p.stickersOn.map(onW))})` : ''}` : '';
  return [tix, stk, p.checks ? 'checks' : '', p.receipts ? 'receipts' : '', p.labels ? 'bag labels' : ''].filter(Boolean).join(', and ').replace(/, and (?=[^,]*, and )/g, ', ') || 'nothing yet';
}

/** A sale's receipt, from a receipt (the front desk's shape, or a counter order's: lib/counter-receipt): the business,
 *  the order, each line with what was chosen, the totals, how it was paid (with the change), and its page online.
 *  `drawer`: open the cash drawer with it. */
export function receiptDoc(r: any, o: { business: string; address?: string | null; tz: string | null; url?: string | null; drawer?: boolean }): PrintDoc {
  const D = r?.detail || {}; const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const blocks: Block[] = [{ k: 'brand', name: o.business }];
  if (o.address) blocks.push({ k: 'text', text: o.address });
  blocks.push({ k: 'rule' });
  const where = r?.source === 'counter' ? [r.channel === 'drive-thru' ? 'Drive-thru' : r.toGo ? 'To go' : r.channel === 'counter' ? 'For here' : String(r.channelName || '')].filter(Boolean)[0] : '';
  if (r?.orderNumber) blocks.push({ k: 'head', left: String(r.orderNumber), right: where || undefined });
  if (r?.voided) blocks.push({ k: 'alert', text: r.voidRefunded ? 'Refunded' : 'Voided' });
  if (r?.clientName) blocks.push({ k: 'text', text: String(r.clientName) });
  blocks.push({ k: 'text', text: `${dayIn(String(r?.date || ''), o.tz)}, ${clockIn(String(r?.date || ''), o.tz)}` }, { k: 'rule' });
  for (const l of (Array.isArray(D.lines) ? D.lines : [])) {
    if (l?.kind === 'note') { blocks.push({ k: 'text', text: String(l.label || '') }); continue; }
    const name = String(l?.label || 'Item'); const paren = name.match(/^(.*?) \((.+)\)$/);
    blocks.push({ k: 'money', left: `${Math.max(1, n(l?.qty) || 1)}  ${paren ? paren[1] : name}`, right: l?.redeemed ? 'Included' : money(n(l?.amount)) });
    if (paren) blocks.push({ k: 'text', text: `   ${paren[2]}` });
  }
  for (const f of (Array.isArray(D.fees) ? D.fees : [])) blocks.push({ k: 'money', left: String(f?.label || 'Fee'), right: money(n(f?.amount)) });
  blocks.push({ k: 'rule' }, { k: 'money', left: 'Subtotal', right: money(n(r?.subtotal)) });
  const offs = Array.isArray(r?.discounts) && r.discounts.length ? r.discounts : n(r?.discount) > 0 ? [{ label: 'Discount', amount: n(r.discount) }] : [];
  for (const d of offs) blocks.push({ k: 'money', left: String(d?.label || 'Discount'), right: money(-n(d?.amount)) });
  if (n(r?.tax) > 0) blocks.push({ k: 'money', left: String(r?.taxLabel || 'Tax'), right: money(n(r.tax)) });
  if (n(r?.tip) > 0) blocks.push({ k: 'money', left: r?.keptChange ? 'Tip, kept the change' : 'Tip', right: money(n(r.tip)) });
  blocks.push({ k: 'money', left: 'Total', right: money(n(r?.total)), bold: true });
  // (Paid in parts, a gift card, store credit, or a split bill's shares: each part, then the cash handed over for the last.)
  const parts = Array.isArray(D.payments) ? D.payments : [];
  if (parts.length > 1 || parts.some((p: any) => p?.method === 'gift_card' || p?.method === 'store_credit')) {
    for (const p of parts) blocks.push({ k: 'money', left: p.label ? String(p.label) : p.method === 'cash' ? 'Cash' : p.method === 'card' ? 'Card' : 'Paid', right: money(n(p.amount)) });
    if (String(r?.paymentMethod) === 'cash' && r?.amountTendered != null && n(r.amountTendered) > 0) blocks.push({ k: 'money', left: 'Cash handed over', right: money(n(r.amountTendered)) }, { k: 'money', left: 'Change', right: money(n(r.change)) });
  } else if (String(r?.paymentMethod) === 'cash') {
    if (r?.amountTendered != null && n(r.amountTendered) > 0) blocks.push({ k: 'money', left: 'Cash', right: money(n(r.amountTendered)) }, { k: 'money', left: 'Change', right: money(n(r.change)) });
    else blocks.push({ k: 'money', left: 'Paid', right: 'Cash' });
  } else blocks.push({ k: 'money', left: 'Paid', right: String(r?.paymentMethod) === 'app' ? 'On the app' : 'Card' });
  for (const x of (Array.isArray(r?.refunds) ? r.refunds : [])) blocks.push({ k: 'money', left: x?.reason ? `Refunded, ${String(x.reason).toLowerCase()}` : 'Refunded', right: money(-n(x?.cents) / 100) });
  blocks.push({ k: 'rule' }, { k: 'text', text: 'Thank you', center: true });
  if (o.url) blocks.push({ k: 'qr', data: o.url }, { k: 'text', text: 'Your receipt online', center: true });
  return { blocks, buzz: false, ...(o.drawer ? { drawer: true } : {}) };
}

/** After a sale at the counter or the drive-thru: ask about a receipt (the default), print one, or don't print. */
export type ReceiptAfter = 'ask' | 'print' | 'none';
export const receiptAfterOf = (tenant: any): ReceiptAfter => (tenant?.receiptSettings?.after === 'print' || tenant?.receiptSettings?.after === 'none' ? tenant.receiptSettings.after : 'ask');

/** Just the cash drawer, opened (a cash sale with no receipt printed). */
export const drawerDoc = (): PrintDoc => ({ blocks: [], buzz: false, drawer: true });
