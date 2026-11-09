// src/lib/print-link.ts — SHORT-LIVED SIGNED LINKS for the printable pages (receipts, statements, renter documents,
// the interruption packet). Those pages open in a new tab, where the app's sign-in can't travel with them, so the
// app first asks /api/print-link for a link (it checks who is asking), and the page checks the signature and the
// time on the link. A link works for ten minutes; after that, opening it again from the app makes a fresh one.
import { createHmac, timingSafeEqual } from 'crypto';
import { linkSecret } from '@/lib/portal-key';

export const PRINT_PATHS = [
  '/api/booths/receipt',
  '/api/booths/statement',
  '/api/booths/account-statement',
  '/api/booths/renter-document',
  '/api/booths/interruption-packet',
  '/api/booths/notice-record',
] as const;
export type PrintPath = typeof PRINT_PATHS[number];
export const PRINT_LINK_MS = 10 * 60 * 1000;

// LINK_SECRET signs these. On any hosted or production copy of the app (live or preview, on any host) it must be set;
// only a local development copy falls back to the development secret. Without it nothing is signed, and the pages say
// printing isn't available.
const secret = (env: Record<string, string | undefined> = process.env): string | null =>
  env.LINK_SECRET || (env.NODE_ENV === 'production' || env.VERCEL || env.VERCEL_ENV ? null : linkSecret(env));
export const printLinksReady = (env: Record<string, string | undefined> = process.env): boolean => secret(env) !== null;

export const isPrintPath = (p: unknown): p is PrintPath => typeof p === 'string' && (PRINT_PATHS as readonly string[]).includes(p);

/** The query string in one fixed order, so the same link always signs the same way. */
function canonical(path: string, params: Record<string, string>, exp: number): string {
  const keys = Object.keys(params).filter((k) => k !== 'exp' && k !== 'sig').sort();
  return `${path}?${keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&')}&exp=${exp}`;
}

/** A signed link to one printable page, or null when signing isn't set up here. */
export function signPrintLink(path: PrintPath, params: Record<string, string>, now = Date.now(), env: Record<string, string | undefined> = process.env): string | null {
  const s = secret(env); if (!s) return null;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params || {})) if (v != null && String(v) !== '' && k !== 'exp' && k !== 'sig') clean[k] = String(v);
  const exp = now + PRINT_LINK_MS;
  const base = canonical(path, clean, exp);
  const sig = createHmac('sha256', s).update(`print:${base}`).digest('base64url');
  return `${base}&sig=${sig}`;
}

/** True only for a link this server signed, for this exact page and these exact parameters, that hasn't run out. */
export function printLinkValid(path: string, search: URLSearchParams, now = Date.now(), env: Record<string, string | undefined> = process.env): boolean {
  const s = secret(env); if (!s) return false;
  const exp = Number(search.get('exp') || 0); const sig = String(search.get('sig') || '');
  if (!Number.isFinite(exp) || exp <= now || exp > now + PRINT_LINK_MS + 60_000 || !sig) return false;
  // Each name once: a repeated one (?id=theirs&id=mine) could sign one value while the page reads another.
  const keys = [...search.keys()];
  if (new Set(keys).size !== keys.length) return false;
  const params: Record<string, string> = {};
  search.forEach((v, k) => { if (k !== 'exp' && k !== 'sig') params[k] = v; });
  const want = createHmac('sha256', s).update(`print:${canonical(path, params, exp)}`).digest('base64url');
  const a = Buffer.from(want), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What a printable page shows when its link is missing, altered or out of time (or signing isn't set up at all). */
export function printLinkExpired(env: Record<string, string | undefined> = process.env): Response {
  const ready = printLinksReady(env);
  if (!ready) console.error('[print-link] LINK_SECRET is not set, so printable pages cannot open. Add it to the hosting settings.');
  const [title, line] = ready
    ? ['This link has expired', 'Printable pages open from the app and work for ten minutes. Go back to the app and open it again.']
    : ['Printing isn’t available right now', 'Printable pages can’t open at the moment. The problem is on our side, not yours. Try again later.'];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>`
    + `<body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#16171a;background:#fff;margin:0;padding:48px 20px">`
    + `<div style="max-width:420px;margin:0 auto"><h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${title}</h1>`
    + `<p style="font-size:15px;line-height:1.5;color:#6d7075;margin:0">${line}</p></div></body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
