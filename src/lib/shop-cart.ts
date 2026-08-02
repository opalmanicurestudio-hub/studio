'use client';

// ─── src/lib/shop-cart.ts ─────────────────────────────────────────────────────
// Persistent storefront cart, keyed per tenant in localStorage — so the cart
// survives navigating to product pages, refreshes, and coming back tomorrow.
// The wholesale unlock code persists alongside it, so a B2B buyer stays in
// wholesale mode across pages. All storage access is guarded: private-mode
// browsers that block storage silently fall back to in-memory behavior.

export type CartMap = Record<string, number>;

const cartKey = (tenantId: string) => `cfshop-cart-${tenantId}`;
const wsKey = (tenantId: string) => `cfshop-ws-${tenantId}`;
const expKey = (tenantId: string) => `cfshop-cart-exp-${tenantId}`;

export function readCart(tenantId: string): CartMap {
  try {
    const exp = cartExpiresAt(tenantId);
    if (exp !== null && Date.now() > exp) {
      clearCart(tenantId);
      return {};
    }
    const raw = localStorage.getItem(cartKey(tenantId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const clean: CartMap = {};
    for (const [id, qty] of Object.entries(parsed)) {
      const n = Math.floor(Number(qty) || 0);
      if (id && n > 0) clean[id] = n;
    }
    return clean;
  } catch {
    return {};
  }
}

export function writeCart(tenantId: string, cart: CartMap): void {
  try {
    const clean = Object.fromEntries(Object.entries(cart).filter(([, q]) => q > 0));
    localStorage.setItem(cartKey(tenantId), JSON.stringify(clean));
  } catch {
    // storage unavailable — cart stays in memory only
  }
}

/**
 * Cart hold: activity-refreshed TTL. Stock is NOT held until payment, so the
 * countdown is honest urgency + hygiene (stale carts create checkout 409s),
 * never a fake reservation. holdMinutes <= 0 disables and clears any timer.
 */
export function touchCartExpiry(tenantId: string, holdMinutes: number): void {
  try {
    if (holdMinutes > 0) localStorage.setItem(expKey(tenantId), String(Date.now() + holdMinutes * 60_000));
    else localStorage.removeItem(expKey(tenantId));
  } catch { /* noop */ }
}

export function cartExpiresAt(tenantId: string): number | null {
  try {
    const raw = localStorage.getItem(expKey(tenantId));
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Composite cart key: productId alone, or productId@@g0:c1|g1:c2 with options. */
export function cartKeyFor(productId: string, selections?: Record<string, string>): string {
  const entries = Object.entries(selections || {}).filter(([, v]) => v);
  if (entries.length === 0) return productId;
  entries.sort(([a], [b]) => a.localeCompare(b));
  return `${productId}@@${entries.map(([g, c]) => `${g}:${c}`).join('|')}`;
}

export function parseCartKey(key: string): { productId: string; selections: Record<string, string> } {
  const [productId, rest] = key.split('@@');
  const selections: Record<string, string> = {};
  if (rest) {
    for (const part of rest.split('|')) {
      const [g, c] = part.split(':');
      if (g && c) selections[g] = c;
    }
  }
  return { productId, selections };
}

export function addToCart(tenantId: string, productId: string, qty: number, selections?: Record<string, string>): CartMap {
  const cart = readCart(tenantId);
  const key = cartKeyFor(productId, selections);
  cart[key] = Math.max(0, (cart[key] || 0) + qty);
  if (cart[key] === 0) delete cart[key];
  writeCart(tenantId, cart);
  return cart;
}

export function clearCart(tenantId: string): void {
  try {
    localStorage.removeItem(cartKey(tenantId));
    localStorage.removeItem(expKey(tenantId));
  } catch { /* noop */ }
}

export function readWholesaleCode(tenantId: string): string {
  try { return localStorage.getItem(wsKey(tenantId)) || ''; } catch { return ''; }
}

export function writeWholesaleCode(tenantId: string, code: string): void {
  try {
    if (code) localStorage.setItem(wsKey(tenantId), code);
    else localStorage.removeItem(wsKey(tenantId));
  } catch { /* noop */ }
}
