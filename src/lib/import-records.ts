// src/lib/import-records.ts — BRING YOUR RECORDS FROM ANOTHER APP. Pure helpers shared by the import page and the server:
// read a CSV export, match its columns to ours (by the names other booking apps use), and clean each row into a client,
// service or product. Nothing here writes; /api/import does that after the owner has seen the preview.

export type ImportKind = 'clients' | 'services' | 'products';
export type FieldDef = { key: string; label: string; names: string[]; required?: boolean };

/** Read CSV text (commas, semicolons or tabs; quoted fields; line breaks inside quotes; a BOM). */
export function parseCsv(text: string): string[][] {
  const t = String(text || '').replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const count = (ch: string) => (first.match(new RegExp(ch === '\t' ? '\t' : `\\${ch}`, 'g')) || []).length;
  const sep = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') { q = true; continue; }
    if (c === sep) { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; continue; }
    cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  clients: [
    { key: 'name', label: 'Full name', names: ['name', 'full name', 'client name', 'customer name', 'client', 'customer', 'display name'] },
    { key: 'firstName', label: 'First name', names: ['first name', 'first', 'given name', 'firstname', 'fname'] },
    { key: 'lastName', label: 'Last name', names: ['last name', 'last', 'surname', 'family name', 'lastname', 'lname'] },
    { key: 'email', label: 'Email', names: ['email', 'email address', 'e mail', 'primary email', 'customer email'] },
    { key: 'phone', label: 'Mobile phone', names: ['mobile', 'mobile phone', 'mobile number', 'cell', 'cell phone', 'phone', 'phone number', 'primary phone', 'telephone', 'sms number'] },
    { key: 'phone2', label: 'Other phone', names: ['home phone', 'work phone', 'other phone', 'secondary phone', 'phone 2', 'landline'] },
    { key: 'birthday', label: 'Birthday', names: ['birthday', 'birth date', 'date of birth', 'dob', 'birthdate'] },
    { key: 'street', label: 'Street address', names: ['address', 'street', 'street address', 'address 1', 'address line 1', 'address1'] },
    { key: 'city', label: 'City', names: ['city', 'town', 'locality'] },
    { key: 'state', label: 'State', names: ['state', 'province', 'region', 'state province', 'administrative district level 1', 'state code'] },
    { key: 'zip', label: 'ZIP code', names: ['zip', 'zip code', 'postal code', 'postcode', 'zipcode'] },
    { key: 'notes', label: 'Notes', names: ['notes', 'note', 'memo', 'client notes', 'customer notes', 'comments', 'internal notes'] },
    { key: 'allergies', label: 'Allergies', names: ['allergies', 'allergy', 'allergy notes', 'sensitivities'] },
    { key: 'tags', label: 'Tags or groups', names: ['tags', 'tag', 'groups', 'group', 'labels', 'segments', 'customer groups'] },
    { key: 'emailOk', label: 'OK to email offers', names: ['email subscription status', 'email marketing', 'accepts email marketing', 'accepts marketing', 'marketing emails', 'email opt in', 'subscribed', 'newsletter'] },
    { key: 'smsOk', label: 'OK to text offers', names: ['sms marketing', 'accepts sms marketing', 'text marketing', 'sms opt in', 'marketing sms', 'sms subscription status'] },
    { key: 'firstVisit', label: 'Client since', names: ['customer since', 'client since', 'creation date', 'created', 'created at', 'date added', 'added', 'first visit', 'first visit date', 'join date'] },
    { key: 'lastVisit', label: 'Last visit', names: ['last visit', 'last visit date', 'last appointment', 'last seen', 'most recent visit'] },
    { key: 'visits', label: 'Number of visits', names: ['total visits', 'visits', 'number of visits', 'visit count', 'appointments', 'total appointments'] },
    { key: 'spent', label: 'Total spent', names: ['total spent', 'total spend', 'lifetime value', 'total sales', 'lifetime spend', 'revenue', 'ltv'] },
    { key: 'referral', label: 'How they found you', names: ['referral', 'referral source', 'referred by', 'source', 'how did you hear', 'lead source'] },
  ],
  services: [
    { key: 'name', label: 'Service name', names: ['name', 'service', 'service name', 'item', 'item name', 'title'], required: true },
    { key: 'category', label: 'Category', names: ['category', 'service category', 'group', 'type', 'menu section'] },
    { key: 'duration', label: 'Length', names: ['duration', 'length', 'time', 'minutes', 'duration minutes', 'duration (minutes)', 'service duration'] },
    { key: 'price', label: 'Price', names: ['price', 'cost to client', 'amount', 'rate', 'service price', 'regular price'] },
    { key: 'description', label: 'Description', names: ['description', 'details', 'about', 'online description'] },
  ],
  products: [
    { key: 'name', label: 'Product name', names: ['name', 'product', 'product name', 'item', 'item name', 'title'], required: true },
    { key: 'sku', label: 'SKU or barcode', names: ['sku', 'barcode', 'upc', 'gtin', 'item code', 'product code'] },
    { key: 'category', label: 'Category', names: ['category', 'product category', 'type', 'department'] },
    { key: 'price', label: 'Selling price', names: ['price', 'retail price', 'selling price', 'sale price', 'unit price'] },
    { key: 'cost', label: 'Your cost', names: ['cost', 'unit cost', 'supply cost', 'wholesale', 'wholesale price', 'cost price'] },
    { key: 'stock', label: 'In stock', names: ['stock', 'quantity', 'qty', 'in stock', 'on hand', 'quantity on hand', 'current quantity', 'inventory'] },
    { key: 'supplier', label: 'Supplier', names: ['supplier', 'vendor', 'brand', 'manufacturer', 'distributor'] },
    { key: 'description', label: 'Description', names: ['description', 'details'] },
  ],
};

/** Guess which column feeds each field. Exact name first, then a contained name; each column used once. */
export function autoMatch(kind: ImportKind, headers: string[]): Record<string, number> {
  const H = headers.map(norm); const out: Record<string, number> = {}; const used = new Set<number>();
  for (const pass of [0, 1] as const) for (const f of FIELDS[kind]) {
    if (out[f.key] !== undefined) continue;
    const i = H.findIndex((h, j) => !used.has(j) && h && (pass === 0 ? f.names.includes(h) : f.names.some((n) => n.length > 3 && (h.includes(n) || n.includes(h) && h.length > 3))));
    if (i >= 0) { out[f.key] = i; used.add(i); }
  }
  // "Name" alongside First/Last: keep both — first+last wins when both are present.
  return out;
}

export const digits10 = (v: any) => String(v || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
export function cleanPhone(v: any): string | null {
  const raw = String(v || '').trim(); if (!raw) return null; const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`; if (d.length === 11 && d[0] === '1') return `+${d}`; if (raw.startsWith('+') && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}
export function cleanEmail(v: any): string | null { const e = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null; }
const yes = (v: any) => /^(y|yes|true|1|subscribed|opted in|opt in|accepted|on)$/i.test(String(v || '').trim());
const no = (v: any) => /^(n|no|false|0|unsubscribed|opted out|opt out|declined|off|not subscribed)$/i.test(String(v || '').trim());

/** A date as YYYY-MM-DD (or --MM-DD for a birthday without a year). US order for slashes. */
export function cleanDate(v: any, birthday = false): string | null {
  const s = String(v || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (m) { let y = Number(m[3]); if (y < 100) y += y > 30 ? 1900 : 2000; const mo = Number(m[1]), d = Number(m[2]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  if (birthday) { m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/); if (m && Number(m[1]) <= 12) return `--${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const t = Date.parse(s); if (!isNaN(t) && /[a-z]/i.test(s)) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  return null;
}
export function cleanMoney(v: any): number | null { const s = String(v ?? '').replace(/[^0-9.,-]/g, ''); if (!s) return null; const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }
/** "1h 30m", "1:30", "90", "90 min", "1.5 hours" → minutes. */
export function cleanMinutes(v: any): number | null {
  const s = String(v || '').trim().toLowerCase(); if (!s) return null;
  let m = s.match(/^(\d+):(\d{2})$/); if (m) return Number(m[1]) * 60 + Number(m[2]);
  const h = s.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/); const mi = s.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/);
  if (h || mi) return Math.round((h ? Number(h[1]) * 60 : 0) + (mi ? Number(mi[1]) : 0));
  m = s.match(/^(\d+(?:\.\d+)?)$/); if (m) return Math.round(Number(m[1]));
  return null;
}
const titleCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : s);

export type CleanRow = { row: number; data: Record<string, any>; problems: string[]; skip?: string };

/** One row of the file, cleaned into what we store. */
export function cleanRow(kind: ImportKind, cells: string[], map: Record<string, number>, row: number): CleanRow {
  const g = (k: string) => (map[k] !== undefined && map[k] >= 0 ? String(cells[map[k]] ?? '').trim() : '');
  const problems: string[] = [];
  if (kind === 'clients') {
    const first = titleCase(g('firstName')), last = titleCase(g('lastName')); const name = (first || last ? `${first} ${last}` : titleCase(g('name'))).replace(/\s+/g, ' ').trim();
    const email = cleanEmail(g('email')); const phone = cleanPhone(g('phone')) || cleanPhone(g('phone2'));
    if (g('email') && !email) problems.push(`Email “${g('email')}” doesn’t look right — left out`);
    if (g('phone') && !cleanPhone(g('phone'))) problems.push(`Phone “${g('phone')}” isn’t a full number — left out`);
    if (!name && !email && !phone) return { row, data: {}, problems, skip: 'No name, email or phone' };
    const d: any = { name: name || email || phone };
    if (first) d.firstName = first; if (last) d.lastName = last;
    if (email) d.email = email; if (phone) d.phone = phone;
    const bd = cleanDate(g('birthday'), true); if (bd) d.birthday = bd; else if (g('birthday')) problems.push(`Birthday “${g('birthday')}” wasn’t a date we could read`);
    const addr = { street: g('street'), city: g('city'), state: g('state'), zip: g('zip') }; if (Object.values(addr).some(Boolean)) d.address = addr;
    if (g('notes')) d.notes = { general: g('notes').slice(0, 4000) };
    if (g('allergies')) d.allergyNotes = g('allergies').slice(0, 1000);
    const tags = g('tags').split(/[;,|]/).map((x) => x.trim()).filter(Boolean).slice(0, 20); if (tags.length) d.tags = tags;
    if (map.emailOk !== undefined) { if (yes(g('emailOk'))) d.emailOk = true; else if (no(g('emailOk'))) d.emailOk = false; }
    if (map.smsOk !== undefined) { if (yes(g('smsOk'))) d.smsOk = true; else if (no(g('smsOk'))) d.smsOk = false; }
    const fv = cleanDate(g('firstVisit')); if (fv) d.clientSince = fv;
    const lv = cleanDate(g('lastVisit')); if (lv) d.lastVisit = lv;
    const vc = cleanMoney(g('visits')); if (vc != null && vc >= 0) d.visits = Math.round(vc);
    const sp = cleanMoney(g('spent')); if (sp != null && sp >= 0) d.spent = sp;
    if (g('referral')) d.referral = g('referral').slice(0, 120);
    return { row, data: d, problems };
  }
  if (kind === 'services') {
    const name = g('name'); if (!name) return { row, data: {}, problems, skip: 'No service name' };
    const d: any = { name: name.slice(0, 120) }; if (g('category')) d.category = g('category').slice(0, 60);
    const mins = cleanMinutes(g('duration')); if (mins) d.duration = mins; else { d.duration = 60; problems.push(g('duration') ? `Length “${g('duration')}” unclear — set to 60 min` : 'No length — set to 60 min'); }
    const p = cleanMoney(g('price')); if (p != null) d.price = p; else { d.price = 0; problems.push('No price — set to $0'); }
    if (g('description')) d.description = g('description').slice(0, 2000);
    return { row, data: d, problems };
  }
  const name = g('name'); if (!name) return { row, data: {}, problems, skip: 'No product name' };
  const d: any = { name: name.slice(0, 160) }; if (g('sku')) d.sku = g('sku').slice(0, 60); if (g('category')) d.category = g('category').slice(0, 60);
  const p = cleanMoney(g('price')); if (p != null) d.price = p; const c = cleanMoney(g('cost')); if (c != null) d.cost = c;
  const st = cleanMoney(g('stock')); if (st != null) d.stock = Math.max(0, Math.round(st));
  if (g('supplier')) d.supplier = g('supplier').slice(0, 120); if (g('description')) d.description = g('description').slice(0, 2000);
  return { row, data: d, problems };
}

/** The key two rows (or a row and a record) are the same by: email, then phone, for clients; SKU then name otherwise. */
export function sameKeys(kind: ImportKind, d: any): string[] {
  if (kind === 'clients') return [d.email ? `e:${String(d.email).toLowerCase()}` : '', d.phone ? `p:${digits10(d.phone)}` : ''].filter(Boolean);
  if (kind === 'products') return [d.sku ? `s:${String(d.sku).toLowerCase()}` : '', `n:${norm(d.name)}`].filter(Boolean);
  return [`n:${norm(d.name)}`];
}

/** Rows in the same file that are the same person (or item) become one: the first value for each field wins, notes and tags add up. */
export function mergeWithin(kind: ImportKind, rows: CleanRow[]): { rows: CleanRow[]; merged: number } {
  const out: CleanRow[] = []; const byKey = new Map<string, CleanRow>(); let merged = 0;
  for (const r of rows) {
    if (r.skip) { out.push(r); continue; }
    const hit = sameKeys(kind, r.data).map((k) => byKey.get(k)).find(Boolean);
    if (!hit) { out.push(r); for (const k of sameKeys(kind, r.data)) byKey.set(k, r); continue; }
    merged++; hit.data = fillIn(hit.data, r.data); hit.problems.push(...r.problems); for (const k of sameKeys(kind, hit.data)) byKey.set(k, hit);
  }
  return { rows: out, merged };
}

/** Fill only what's empty; add notes and tags together. Never overwrites what's already there. */
export function fillIn(base: any, add: any): any {
  const o: any = { ...base };
  for (const [k, v] of Object.entries(add || {})) {
    if (v == null || v === '') continue;
    if (k === 'tags' && Array.isArray(v)) { o.tags = [...new Set([...(o.tags || []), ...v])]; continue; }
    if (k === 'notes' && typeof v === 'object') { const a = String(o.notes?.general || '').trim(); const b = String((v as any).general || '').trim(); o.notes = { ...(o.notes || {}), general: a && b && !a.includes(b) ? `${a}\n${b}` : a || b }; continue; }
    if ((k === 'emailOk' || k === 'smsOk') && v === false) { o[k] = false; continue; }   // a no anywhere stays a no
    if (k === 'address' && typeof v === 'object') { const cur = o.address || {}; if (!Object.values(cur).some(Boolean)) o.address = v; continue; }
    if (o[k] == null || o[k] === '' || (Array.isArray(o[k]) && !o[k].length)) o[k] = v;
  }
  return o;
}

export const APPS: { id: string; name: string; how: string }[] = [
  { id: 'square', name: 'Square', how: 'In your Square Dashboard, open Customers, then the customer directory, and choose Export customers.' },
  { id: 'vagaro', name: 'Vagaro', how: 'Vagaro’s client list can be exported from Reports (look for the customer list report and its export button).' },
  { id: 'fresha', name: 'Fresha', how: 'In Fresha, open Clients, then the clients list, and use Options → Export.' },
  { id: 'mindbody', name: 'Mindbody', how: 'In Mindbody, client lists are exported from Reports (a client list report, exported to Excel or CSV).' },
  { id: 'glossgenius', name: 'GlossGenius', how: 'Look for Export on your Clients list. If you can’t find it, GlossGenius support can send you your client file.' },
  { id: 'booksy', name: 'Booksy', how: 'Look for Export on your client list. If there isn’t one, Booksy support can send you your client file.' },
  { id: 'schedulicity', name: 'Schedulicity', how: 'Look for Export on your client list, or ask their support for your client file.' },
  { id: 'other', name: 'Something else', how: 'Most apps have Export on the client list or under Reports. A spreadsheet works too — save it as CSV.' },
];
