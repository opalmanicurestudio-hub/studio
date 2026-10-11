// src/lib/gift-bulk-list.ts — reading a company's list of people (lib/gift-bulk): pasted from a spreadsheet or a CSV file.
// No server code here — the manager's screen uses it to show each row's problems as they paste.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MAX_ROWS = 500;

export type BulkRow = { name: string; email: string | null; phone: string | null; raw?: string | null; cents: number; problem: string | null; cardId?: string | null; code?: string | null };

/** One row → checked. Contact is an email or a mobile number; amount falls back to the order's default. */
export function checkRow(r: any, defaultCents: number): BulkRow {
  const name = String(r?.name || '').trim().slice(0, 80); const contact = String(r?.contact ?? r?.email ?? r?.phone ?? '').trim();
  const email = EMAIL.test(contact) ? contact.toLowerCase().slice(0, 120) : null; const digits = contact.replace(/\D/g, '');
  const phone = !email && digits.length >= 10 && digits.length <= 15 ? contact.replace(/[^\d+]/g, '').slice(0, 16) : null;
  const cents = Math.round(Number(String(r?.amount ?? '').replace(/[^0-9.]/g, '')) * 100) || defaultCents;
  const problem = !name ? 'Add a name' : !email && !phone ? (contact ? 'Check the email or number' : 'Add an email or mobile') : !(cents >= 100 && cents <= 500000) ? 'Amount $1–$5,000' : null;
  return { name, email, phone, raw: !email && !phone && contact ? contact.slice(0, 120) : null, cents, problem };
}

/** Pasted text or a CSV: "name, email or mobile, amount" per line — commas or tabs (a copy from a spreadsheet), header row skipped. */
export function parseList(text: string, defaultCents: number): BulkRow[] {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_ROWS + 1);
  const split = (l: string) => { if (l.includes('\t')) return l.split('\t'); const out: string[] = []; let cur = '', q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const rows = lines.map(split).map((c) => c.map((x) => x.trim()));
  if (rows.length && /name/i.test(rows[0][0] || '') && !/@/.test(rows[0].join(' '))) rows.shift();
  return rows.slice(0, MAX_ROWS).map((c) => { const contact = c.find((x) => /@/.test(x) || x.replace(/\D/g, '').length >= 10) || c[1] || '';
    const amount = c.slice(1).find((x) => x !== contact && /^\$?\s*\d+(\.\d{1,2})?$/.test(x)) || ''; return checkRow({ name: c[0], contact, amount }, defaultCents); });
}

export function totals(rows: BulkRow[]) { const ok = rows.filter((r) => !r.problem); return { count: ok.length, totalCents: ok.reduce((s, r) => s + r.cents, 0), problems: rows.length - ok.length }; }

