// src/lib/print-key.ts — SHORT-LIVED KEYS FOR STAFF-ONLY PRINT PAGES. A print page opens in a new tab, so it
// can't carry the staff sign-in. The app asks /api/print-key for a key (signed-in staff only), and the page
// checks it. Keys last 15 minutes and are bound to one business and one page.
import { createHmac, timingSafeEqual } from 'crypto';

const secret = () => String(process.env.PRINT_KEY_SECRET || process.env.CRON_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'print-key');
const sign = (tenantId: string, scope: string, exp: number) => createHmac('sha256', secret()).update(`print:${tenantId}:${scope}:${exp}`).digest('base64url').slice(0, 32);

export function makePrintKey(tenantId: string, scope: string, now = Date.now()) {
  const x = now + 15 * 60000; return { k: sign(tenantId, scope, x), x };
}

export function checkPrintKey(tenantId: string, scope: string, k: unknown, x: unknown, now = Date.now()): boolean {
  const exp = Number(x); if (!Number.isFinite(exp) || exp < now || exp > now + 16 * 60000) return false;
  const want = Buffer.from(sign(tenantId, scope, exp)); const got = Buffer.from(String(k || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}
