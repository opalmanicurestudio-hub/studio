// ─── src/lib/retail-wholesale.ts ──────────────────────────────────────────────
// Server-side wholesale account resolution, shared by the catalog, product,
// and checkout routes so all three ALWAYS agree on who is wholesale and what
// they pay. Per-account records live at tenants/{tid}/wholesaleAccounts:
//   { id, businessName, contactName, email, accessCode (uppercase, unique),
//     extraDiscountPercent (0-50, on top of wholesale prices),
//     status: 'active' | 'suspended', notes?, createdAt, lastUsedAt? }
// The legacy shared retailSettings.wholesaleAccessCode keeps working as a
// house code (no account attached), so nothing breaks for existing buyers.

export interface WholesaleResolution {
  unlocked: boolean;
  error?: string;              // set when a code was supplied but rejected
  account?: {
    id: string;
    businessName: string;
    email: string;
    extraDiscountPercent: number;
  } | null;                    // null = legacy house code
}

export function normalizeCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

/** Unambiguous account code, e.g. WS-7KF3-XP9M (no 0/O/1/I/L). */
export function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `WS-${pick(4)}-${pick(4)}`;
}

export function clampDiscount(pct: any): number {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(50, Math.max(0, Math.round(n)));
}

/** Apply an account's extra discount to an already-wholesale price. */
export function discountedCents(cents: number, extraDiscountPercent: number): number {
  const pct = clampDiscount(extraDiscountPercent);
  return pct > 0 ? Math.round(cents * (1 - pct / 100)) : cents;
}

/**
 * Resolve a supplied code against per-account records first, then the legacy
 * shared code. Distinguishes wrong code from suspended account so buyers get
 * honest errors. No code supplied => cleanly not unlocked (no error).
 */
export async function resolveWholesaleAccess(
  db: any,
  tenantId: string,
  retailSettings: any,
  suppliedCode: string
): Promise<WholesaleResolution> {
  const code = normalizeCode(suppliedCode);
  if (!code) return { unlocked: false };

  const snap = await db.collection(`tenants/${tenantId}/wholesaleAccounts`)
    .where('accessCode', '==', code).limit(1).get();

  if (!snap.empty) {
    const acct = snap.docs[0].data();
    if (acct.status !== 'active') {
      return { unlocked: false, error: 'This wholesale account is currently suspended — contact the shop.' };
    }
    return {
      unlocked: true,
      account: {
        id: snap.docs[0].id,
        businessName: String(acct.businessName || ''),
        email: String(acct.email || '').toLowerCase(),
        extraDiscountPercent: clampDiscount(acct.extraDiscountPercent),
      },
    };
  }

  const legacy = normalizeCode(retailSettings?.wholesaleAccessCode);
  if (legacy && code === legacy) {
    return { unlocked: true, account: null };
  }

  return { unlocked: false, error: 'Invalid wholesale access code' };
}
