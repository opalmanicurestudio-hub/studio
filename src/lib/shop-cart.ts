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

export function readCart(tenantId: string): CartMap {
  try {
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

export function addToCart(tenantId: string, productId: string, qty: number): CartMap {
  const cart = readCart(tenantId);
  cart[productId] = Math.max(0, (cart[productId] || 0) + qty);
  if (cart[productId] === 0) delete cart[productId];
  writeCart(tenantId, cart);
  return cart;
}

export function clearCart(tenantId: string): void {
  try { localStorage.removeItem(cartKey(tenantId)); } catch { /* noop */ }
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
