// src/lib/receipt-read.ts — READING A RECEIPT PHOTO (Books' Snap a receipt, api/money/receipt-read; a renter's Add a
// cost, api/portal/renter-writeoffs 'receipt'). The photo is read for what's printed on it: who was paid, the day, the
// total, the tax, and which of the business's own categories it most likely is. What comes back only fills empty boxes
// on the form, for the person to check before it's added: nothing is saved from a reading alone, and anything that
// isn't plainly on the receipt comes back empty rather than guessed. Server only (readReceipt calls lib/ai).
import { askAI, aiConfigured, parseJson } from '@/lib/ai';
import { getAdminStorage } from '@/lib/firebase-admin';

export const RECEIPT_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type ReceiptMedia = (typeof RECEIPT_MEDIA)[number];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export type ReceiptReading = { vendor: string; date: string | null; total: number | null; tax: number | null; kind: string };

/** What the reader is asked: only what's printed, as JSON, the kind from the given list or none. */
export function receiptPrompt(kinds: readonly string[]): string {
  return [
    'You read a photo of a purchase receipt for a small business’s books.',
    'Reply with one JSON object and nothing else: {"vendor": string, "date": "YYYY-MM-DD" or null, "total": number or null, "tax": number or null, "kind": string}.',
    '- vendor: the store or company the money was paid to, as printed (its name only, no address). Empty if it can’t be read.',
    '- date: the purchase date printed on the receipt. Null if there isn’t one or it can’t be read.',
    '- total: the final amount paid, after tax and discounts, in dollars. Null if it can’t be read.',
    '- tax: the sales tax on it, in dollars. Null if none is shown.',
    `- kind: the one of these that best fits what was bought, exactly as written, or an empty string if none fits: ${kinds.map((k) => JSON.stringify(k)).join(', ')}.`,
    'Never guess a figure that isn’t printed. If the photo isn’t a receipt, reply {"vendor": "", "date": null, "total": null, "tax": null, "kind": ""}.',
  ].join('\n');
}

const money = (v: unknown, max: number): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 100) / 100 : null;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** A reading made safe for the form: a real day no later than today and not more than about two years back, amounts
 *  above zero and sensible (the tax never more than the total), the vendor clipped, the kind only one of the given. */
export function cleanReading(raw: any, today: string, kinds: readonly string[]): ReceiptReading {
  const r = raw && typeof raw === 'object' ? raw : {};
  const vendor = String(r.vendor ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const d = String(r.date ?? '');
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
  const date = dayOk && d <= today && daysBetween(d, today) <= 800 ? d : null;
  const total = money(r.total, 100000);
  const tax0 = money(r.tax, 100000); const tax = tax0 != null && (total == null || tax0 < total) ? tax0 : null;
  const kind = kinds.includes(String(r.kind ?? '')) ? String(r.kind) : '';
  return { vendor, date, total, tax, kind };
}

/** Whether a reading found anything worth filling in. */
export const readSomething = (r: ReceiptReading | null | undefined) => !!r && (r.total != null || !!r.vendor || !!r.date);

/** Reads a receipt photo (bytes, its type) with the fast model. Null when it can't be read, reading is off for the
 *  business (health privacy mode), or nothing on it could be made out. */
export async function readReceipt(o: { bytes: Buffer; mediaType: string; kinds: readonly string[]; today: string; tenantId: string; purpose: string }): Promise<ReceiptReading | null> {
  if (!(RECEIPT_MEDIA as readonly string[]).includes(o.mediaType) || !o.bytes.length || o.bytes.length > RECEIPT_MAX_BYTES) return null;
  if (!aiConfigured()) return null;
  const r = await askAI({ tier: 'fast', maxTokens: 300, purpose: o.purpose, tenantId: o.tenantId, system: receiptPrompt(o.kinds), prompt: 'Read this receipt.',
    image: { data: o.bytes.toString('base64'), mediaType: o.mediaType as ReceiptMedia } });
  if (!r.ok) return null;
  const reading = cleanReading(parseJson(r.text), o.today, o.kinds);
  return readSomething(reading) ? reading : null;
}

/** A receipt photo from the business's own storage (an address already checked: lib/write-offs receiptUrlOk), read
 *  with no redirects, a time limit and a size cap: the bytes and their type, or null. */
export async function fetchReceiptPhoto(url: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !(RECEIPT_MEDIA as readonly string[]).includes(type) || Number(res.headers.get('content-length') || 0) > RECEIPT_MAX_BYTES) return null;
    // (Read until the cap, never past it, whatever the length header says.)
    const reader = (res.body as any)?.getReader?.();
    if (!reader) { const b = Buffer.from(await res.arrayBuffer()); return b.length && b.length <= RECEIPT_MAX_BYTES ? { bytes: b, mediaType: type } : null; }
    const parts: Buffer[] = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      n += value.length; if (n > RECEIPT_MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
      parts.push(Buffer.from(value));
    }
    return n ? { bytes: Buffer.concat(parts), mediaType: type } : null;
  } catch { return null; }
}

/** Readings a day, for each pool (the business's team, and its renters together, so renters never use up the team's)
 *  and each person: past either, the photo is kept and the form is filled in by hand. Counted at
 *  tenants/{t}/private/receiptReads. */
export const READS_A_DAY = { business: 300, person: 60 };
export async function takeReceiptRead(db: any, tenantId: string, who: string, today: string, pool: 'team' | 'renters' = 'team'): Promise<boolean> {
  const ref = db.doc(`tenants/${tenantId}/private/receiptReads`); const key = String(who || 'someone').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const day = cur.day === today ? cur : { day: today, pools: {}, by: {} };
    const used = Number(day.pools?.[pool]) || 0; const mine = Number(day.by?.[key]) || 0;
    if (used >= READS_A_DAY.business || mine >= READS_A_DAY.person) return false;
    tx.set(ref, { day: today, pools: { ...(day.pools || {}), [pool]: used + 1 }, by: { ...(day.by || {}), [key]: mine + 1 } });
    return true;
  });
}

/** Removes a receipt photo nothing uses (one taken again, or a cost not saved). The address must already be checked. */
export async function dropReceiptPhoto(url: string): Promise<void> {
  try {
    const m = /^\/v0\/b\/([A-Za-z0-9._-]+)\/o\/([^/]+)$/.exec(new URL(url).pathname); if (!m) return;
    await getAdminStorage().bucket(m[1]).file(decodeURIComponent(m[2])).delete({ ignoreNotFound: true });
  } catch { /* left for the bucket's own cleanup */ }
}
