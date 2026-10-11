// src/lib/import-records.ts — BRING YOUR RECORDS FROM ANOTHER APP. Pure helpers shared by the import page and the server:
// read a CSV export, match its columns to ours (by the names other booking apps use), and clean each row into a client,
// service or product. Nothing here writes; /api/import does that after the owner has seen the preview.

export type ImportKind = 'clients' | 'services' | 'products' | 'appointments' | 'giftcards' | 'packages';
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
  appointments: [
    { key: 'start', label: 'Date and time', names: ['start', 'start time', 'start date time', 'appointment date time', 'date time', 'datetime', 'appointment start', 'scheduled', 'start date'] },
    { key: 'date', label: 'Date', names: ['date', 'appointment date', 'day', 'service date', 'booking date', 'visit date'] },
    { key: 'time', label: 'Time', names: ['time', 'appointment time', 'start hour', 'time of day', 'begin'] },
    { key: 'end', label: 'End time', names: ['end', 'end time', 'end date time', 'finish', 'appointment end'] },
    { key: 'duration', label: 'Length', names: ['duration', 'length', 'minutes', 'duration minutes', 'duration (minutes)'] },
    { key: 'client', label: 'Client name', names: ['client', 'client name', 'customer', 'customer name', 'name', 'full name', 'guest'] },
    { key: 'firstName', label: 'Client first name', names: ['first name', 'client first name', 'customer first name', 'first'] },
    { key: 'lastName', label: 'Client last name', names: ['last name', 'client last name', 'customer last name', 'last'] },
    { key: 'email', label: 'Client email', names: ['email', 'client email', 'customer email', 'email address'] },
    { key: 'phone', label: 'Client phone', names: ['phone', 'client phone', 'customer phone', 'mobile', 'cell', 'phone number', 'mobile phone'] },
    { key: 'service', label: 'Service', names: ['service', 'service name', 'services', 'item', 'item name', 'appointment type', 'treatment', 'class'] },
    { key: 'staff', label: 'Team member', names: ['staff', 'staff name', 'provider', 'employee', 'team member', 'stylist', 'technician', 'tech', 'artist', 'with', 'service provider', 'resource'] },
    { key: 'price', label: 'Price', names: ['price', 'amount', 'total', 'service price', 'cost', 'charged'] },
    { key: 'status', label: 'Status', names: ['status', 'appointment status', 'state', 'booking status'] },
    { key: 'notes', label: 'Notes', names: ['notes', 'note', 'appointment notes', 'memo', 'comments', 'booking notes'] },
  ],
  giftcards: [
    { key: 'code', label: 'Code or card number', names: ['code', 'gift card code', 'card number', 'gift card number', 'number', 'gan', 'certificate number', 'gift card id', 'id'], required: true },
    { key: 'balance', label: 'Balance left', names: ['balance', 'current balance', 'remaining', 'remaining balance', 'balance remaining', 'amount remaining', 'available balance', 'value remaining'], required: true },
    { key: 'initial', label: 'Original amount', names: ['amount', 'original amount', 'initial amount', 'initial balance', 'value', 'face value', 'purchase amount', 'loaded amount'] },
    { key: 'holder', label: 'Holder', names: ['customer', 'customer name', 'holder', 'recipient', 'recipient name', 'client', 'client name', 'owner', 'name', 'to'] },
    { key: 'email', label: 'Holder email', names: ['email', 'customer email', 'recipient email'] },
    { key: 'phone', label: 'Holder phone', names: ['phone', 'customer phone', 'recipient phone', 'mobile'] },
    { key: 'purchaser', label: 'Bought by', names: ['purchaser', 'purchased by', 'bought by', 'from', 'sender', 'buyer'] },
    { key: 'created', label: 'Date sold', names: ['date', 'created', 'created at', 'issued', 'purchase date', 'activated', 'activation date', 'date sold', 'sold on'] },
    { key: 'lastUsed', label: 'Last used', names: ['last used', 'last redeemed', 'last activity', 'last used date', 'last redemption'] },
    { key: 'status', label: 'Status', names: ['status', 'state'] },
  ],
  packages: [
    { key: 'client', label: 'Client name', names: ['client', 'client name', 'customer', 'customer name', 'name', 'full name'] },
    { key: 'firstName', label: 'Client first name', names: ['first name', 'first'] },
    { key: 'lastName', label: 'Client last name', names: ['last name', 'last'] },
    { key: 'email', label: 'Client email', names: ['email', 'client email', 'customer email'] },
    { key: 'phone', label: 'Client phone', names: ['phone', 'mobile', 'cell', 'phone number'] },
    { key: 'package', label: 'Package', names: ['package', 'package name', 'series', 'bundle', 'pass', 'pricing option', 'item', 'product'], required: true },
    { key: 'remaining', label: 'Sessions left', names: ['remaining', 'sessions remaining', 'remaining sessions', 'visits remaining', 'uses remaining', 'left', 'balance', 'credits remaining', 'remaining visits'], required: true },
    { key: 'total', label: 'Sessions in total', names: ['total sessions', 'sessions', 'total visits', 'count', 'quantity', 'total uses'] },
    { key: 'service', label: 'For which service', names: ['service', 'service name', 'applies to', 'for'] },
    { key: 'expires', label: 'Expires', names: ['expires', 'expiration', 'expiration date', 'expiry', 'expiry date', 'valid until', 'expires on'] },
    { key: 'bought', label: 'Bought on', names: ['purchased', 'purchase date', 'bought', 'date', 'sold on', 'created'] },
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
/** "2:30 PM", "14:30", "2pm" → "14:30". */
export function cleanTime(v: any): string | null {
  const s = String(v || '').trim().toLowerCase(); const m = s.match(/(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/) || s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!m) return null; let h = Number(m[1]); const mi = Number(m[2] || 0); const ap = m[3] ? m[3][0] : '';
  if (!m[2] && !ap) return null; if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0; if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
export const joinDateTime = (d: string | null, t: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && t ? `${d}T${t}` : null);
/** One cell with both: "10/14/2026 2:30 PM", "2026-10-14 14:30", "2026-10-14T14:30:00" → "2026-10-14T14:30" (the shop's own clock). */
export function cleanDateTime(v: any): string | null {
  const s = String(v || '').trim(); if (!s) return null;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/); if (iso) return `${iso[1]}T${iso[2].padStart(5, '0')}`;
  const parts = s.split(/\s+(?=\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?$)|,\s*|\s+at\s+/i);
  if (parts.length >= 2) { const d = cleanDate(parts.slice(0, -1).join(' ')); const t = cleanTime(parts[parts.length - 1]); if (d && t) return `${d}T${t}`; }
  const m = s.match(/^(.+?)\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)$/i); if (m) { const d = cleanDate(m[1]); const t = cleanTime(m[2]); if (d && t) return `${d}T${t}`; }
  return null;
}
export function cleanStatus(v: any): 'booked' | 'done' | 'cancelled' | 'no_show' | null {
  const s = String(v || '').toLowerCase(); if (!s) return null;
  if (/no.?show|missed|didn.?t show/.test(s)) return 'no_show'; if (/cancel|declin|deleted|rejected/.test(s)) return 'cancelled';
  if (/complet|checked.?out|paid|finished|done|arrived|attended|closed/.test(s)) return 'done'; if (/book|confirm|accept|schedul|pending|upcoming|reserved|new/.test(s)) return 'booked';
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
  if (kind === 'appointments') {
    const first = titleCase(g('firstName')), last = titleCase(g('lastName')); const client = (first || last ? `${first} ${last}` : titleCase(g('client'))).replace(/\s+/g, ' ').trim();
    const email = cleanEmail(g('email')); const phone = cleanPhone(g('phone'));
    const when = cleanDateTime(g('start')) || joinDateTime(cleanDate(g('date')), cleanTime(g('time')) || cleanTime(g('start')));
    if (!when) return { row, data: {}, problems, skip: g('start') || g('date') ? `Date “${g('start') || g('date')} ${g('time')}” wasn’t one we could read` : 'No date' };
    if (!client && !email && !phone) return { row, data: {}, problems, skip: 'No client' };
    let mins = cleanMinutes(g('duration')); const end = cleanDateTime(g('end')) || (cleanTime(g('end')) ? joinDateTime(when.slice(0, 10), cleanTime(g('end'))) : null);
    if (!mins && end) { const m = (Date.parse(`${end}Z`) - Date.parse(`${when}Z`)) / 60000; if (m > 0 && m < 720) mins = Math.round(m); }
    const d: any = { when, client: client || email || phone, minutes: mins || null, service: g('service').slice(0, 120) || null, staff: g('staff').slice(0, 80) || null, status: cleanStatus(g('status')) };
    if (email) d.email = email; if (phone) d.phone = phone; if (first) d.firstName = first; if (last) d.lastName = last;
    const pr = cleanMoney(g('price')); if (pr != null && pr >= 0) d.price = pr; if (g('notes')) d.notes = g('notes').slice(0, 1000);
    if (!d.service) problems.push('No service named — it comes in as “Appointment”');
    return { row, data: { ...d, name: d.client }, problems };
  }
  if (kind === 'giftcards') {
    const code = g('code').replace(/\s+/g, ' ').trim(); if (!code) return { row, data: {}, problems, skip: 'No code' };
    const bal = cleanMoney(g('balance')); if (bal == null) return { row, data: {}, problems, skip: `No balance for ${code}` };
    const init = cleanMoney(g('initial')); const st = g('status').toLowerCase();
    const d: any = { code: code.slice(0, 40), name: code, balance: Math.max(0, bal), initial: Math.max(init ?? 0, bal), holder: titleCase(g('holder')) || null, purchaser: titleCase(g('purchaser')) || null, created: cleanDate(g('created')), lastUsed: cleanDate(g('lastUsed')), voided: /void|cancel|deactivat|disabled/.test(st) };
    const em = cleanEmail(g('email')); const ph = cleanPhone(g('phone')); if (em) d.email = em; if (ph) d.phone = ph;
    if (d.voided) problems.push('Cancelled in the old app — kept as history');
    return { row, data: d, problems };
  }
  if (kind === 'packages') {
    const first = titleCase(g('firstName')), last = titleCase(g('lastName')); const client = (first || last ? `${first} ${last}` : titleCase(g('client'))).replace(/\s+/g, ' ').trim();
    const email = cleanEmail(g('email')); const phone = cleanPhone(g('phone'));
    if (!client && !email && !phone) return { row, data: {}, problems, skip: 'No client' };
    const pkg = g('package').slice(0, 120); if (!pkg) return { row, data: {}, problems, skip: 'No package name' };
    const left = cleanMoney(g('remaining')); if (left == null) return { row, data: {}, problems, skip: `No sessions left for ${client || email}` };
    if (left <= 0) return { row, data: {}, problems, skip: 'All sessions used' };
    const d: any = { client: client || email || phone, name: client || email || phone, package: pkg, remaining: Math.round(left), total: cleanMoney(g('total')) ?? null, service: g('service').slice(0, 120) || null, expires: cleanDate(g('expires')), bought: cleanDate(g('bought')) };
    if (email) d.email = email; if (phone) d.phone = phone;
    if (d.expires && d.expires < new Date().toISOString().slice(0, 10)) return { row, data: {}, problems, skip: `Expired ${d.expires}` };
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
  if (kind === 'appointments') return [`a:${String(d.when)}|${norm(d.client)}|${norm(d.service || '')}`];
  if (kind === 'giftcards') return [`g:${String(d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`];
  if (kind === 'packages') return [`k:${norm(d.client)}|${norm(d.package)}`];
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
    merged++; const extra = kind === 'packages' ? Number(r.data.remaining) || 0 : 0; hit.data = fillIn(hit.data, r.data); if (extra) hit.data.remaining = (Number(hit.data.remaining) || 0) + extra; hit.problems.push(...r.problems); for (const k of sameKeys(kind, hit.data)) byKey.set(k, hit);
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

const KIND_WORD: Record<ImportKind, string> = { clients: 'client list', services: 'service menu', products: 'items or inventory list', appointments: 'appointments or bookings report', giftcards: 'gift cards report', packages: 'packages or series report' };
/** Where to find the file, for this app and this kind of record. */
export function howToGet(kind: ImportKind, appId: string): string {
  const A = APPS.find((a) => a.id === appId);
  if (kind === 'clients' && A) return A.how;
  const name = A && A.id !== 'other' ? A.name : 'your old app';
  const extra = kind === 'appointments' ? ' Choose dates from a year ago to as far ahead as you’re booked.' : kind === 'giftcards' ? ' Include cards that still have money on them.' : kind === 'packages' ? ' It should show sessions left for each client.' : '';
  return `Look for Export on the ${KIND_WORD[kind]} in ${name}.${extra} If you can’t find it, their support team can send it to you.`;
}

/** What a file probably is, from its column names (for “drop any file”). */
export function guessKind(headers: string[]): ImportKind {
  const H = headers.map(norm); const score = (k: ImportKind) => FIELDS[k].reduce((n, f) => n + (H.some((h) => f.names.includes(h)) ? (f.required ? 3 : 1) : 0), 0);
  const kinds: ImportKind[] = ['clients', 'appointments', 'giftcards', 'packages', 'services', 'products'];
  const has = (re: RegExp) => H.some((h) => re.test(h));
  if (has(/gift|certificate/)) return 'giftcards'; if (has(/remaining|sessions/) && has(/package|series|pass/)) return 'packages';
  if (has(/^(start|time|appointment date|start time)$/) || (has(/date/) && has(/staff|provider|stylist|employee/))) return 'appointments';
  return kinds.map((k) => [k, score(k)] as const).sort((a, b) => b[1] - a[1])[0][0];
}
