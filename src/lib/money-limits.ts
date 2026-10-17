// src/lib/money-limits.ts — HOW MUCH EACH ROLE CAN REFUND. The owner sets a limit per role (a cashier up to $50, a
// manager unlimited). The owner is never limited, a role without a limit is unlimited, and a refund over the limit
// needs someone whose role allows it. Checked on the server where the money moves. Pure.

export function refundLimitFor(rs: any, actor: { role?: string; isTenantOwner?: boolean }): number | null {
  if (actor.isTenantOwner || actor.role === 'owner') return null;
  const v = rs?.policies?.refundLimits?.[String(actor.role || '')];
  return v == null || v === '' ? null : Math.max(0, Math.round(Number(v) || 0));
}

export function refundAllowed(rs: any, actor: { role?: string; isTenantOwner?: boolean }, cents: number): { ok: true } | { ok: false; limit: number; message: string } {
  const limit = refundLimitFor(rs, actor);
  if (limit == null || cents <= limit) return { ok: true };
  return { ok: false, limit, message: `Refunds over $${(limit / 100).toFixed(2)} need someone with a higher limit. Ask a manager to send this one.` };
}
