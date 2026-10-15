// src/app/api/loyalty/route.ts — THE LOYALTY PROGRAM (lib/loyalty, lib/loyalty-server).
//   settings { save? }              → (managers) the program, and saving a change (a new version when the rules change)
//   stats                          → (managers) members, points still owed and what they'd cost, rewards used in 30 days
//   client { clientId }            → (the team) their balance, rewards ready, the next one, the ledger, the terms
//   join { clientId }               → (the team) they said yes at checkout (programs where only those who say yes are in)
//   adjust { clientId, points, note } → (managers) add or take off points, with a reason
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { loyaltyOf, nextLoyalty, rewardsFor, worthCents, termsOf, expiresAt, tierFor } from '@/lib/loyalty';
import { ledgerFor, adjustPoints } from '@/lib/loyalty-server';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const action = String(b.action || '');
  const mgr = ['settings', 'stats', 'adjust'].includes(action);
  const g: any = await requireRole(req, tenantId, mgr ? 'manager' : 'staff'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const tRef = db.doc(T); const tenant: any = (await tRef.get()).data() || {};
  const by = g.actor?.name || 'Staff';
  if (action === 'settings') {
    const cur = loyaltyOf(tenant);
    if (b.save && typeof b.save === 'object') { const next = nextLoyalty(cur, b.save);
      if (next.on && !next.rewards.some((r) => r.on)) return j({ ok: false, error: 'Add at least one reward before switching it on.' }, 400);
      await tRef.set({ loyalty: next }, { merge: true });
      const { logAuditAdmin } = await import('@/lib/audit');
      await logAuditAdmin(db, tenantId, { action: 'loyalty.settings', targetType: 'tenant', targetId: tenantId, summary: `${by} saved the loyalty program${next.version !== cur.version ? ` (rules version ${next.version})` : ''}`, actor: { type: 'user', id: g.actor?.uid || '', name: by, role: g.actor?.role || '' } } as any).catch(() => {});
      return j({ ok: true, settings: next, terms: termsOf(next) }); }
    return j({ ok: true, settings: cur, terms: termsOf(cur) });
  }
  if (action === 'stats') {
    const S = loyaltyOf(tenant);
    const members = (await db.collection(`${T}/clients`).where('loyalty.balance', '>', 0).get().catch(() => ({ docs: [] }))).docs.map((d: any) => d.data() || {});
    const owed = members.reduce((t: number, c: any) => t + (Number(c.loyalty?.balance) || 0), 0);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const used = (await db.collection(`${T}/loyaltyLedger`).where('at', '>=', since).get().catch(() => ({ docs: [] }))).docs.map((d: any) => d.data() || {}).filter((e: any) => e.type === 'redeem');
    return j({ ok: true, members: members.length, owedPoints: owed, owedCents: worthCents(S, owed), usedCount: used.length, usedCostCents: used.reduce((t: number, e: any) => t + (Number(e.costCents) || 0), 0) });
  }
  const clientId = String(b.clientId || '').slice(0, 80); if (!clientId) return j({ ok: false, error: 'Choose a client.' }, 400);
  if (action === 'client') {
    const S = loyaltyOf(tenant); const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data() || {};
    const ledger = await ledgerFor(db, tenantId, clientId); const balance = Math.max(0, ledger.reduce((t, e) => t + (Number(e.points) || 0), 0));
    const r = rewardsFor(S, balance);
    const e12 = ledger.filter((e: any) => (e.type === 'earn' || e.type === 'bonus') && Date.parse(e.at) >= Date.now() - 365 * 864e5).reduce((a: number, e: any) => a + Math.max(0, Number(e.points) || 0), 0);
    const tr = tierFor(S, e12, c.loyalty?.tier || null);
    return j({ ok: true, on: S.on, tier: tr.tier ? { name: tr.tier.name, perks: tr.tier.perks, multiplier: tr.tier.multiplier, grace: tr.grace } : null, nextTier: tr.next ? { name: tr.next.tier.name, toGo: tr.next.toGo } : null, unit: S.earn.mode === 'punch' ? 'punches' : 'points', balance, worthCents: worthCents(S, balance), ready: r.ready, next: r.next, oneRewardPerVisit: S.oneRewardPerVisit,
      expiresAt: expiresAt(S, c.loyalty?.lastVisitAt || null), terms: termsOf(S), optedOut: c.loyaltyOptOut === true, joined: S.join !== 'opt_in' || !!c.loyaltyJoinedAt,
      ledger: ledger.slice(0, 80).map((e: any) => ({ id: e.id, type: e.type, points: e.points, at: e.at, why: e.why || '', saleId: e.saleId || null, version: e.version || null, by: e.by || null })) });
  }
  if (action === 'join') { await db.doc(`${T}/clients/${clientId}`).set({ loyaltyJoinedAt: new Date().toISOString(), loyaltyOptOut: false }, { merge: true }); return j({ ok: true }); }
  if (action === 'adjust') { const r = await adjustPoints(db, tenantId, { clientId, points: Number(b.points), note: String(b.note || ''), by }); return j(r, r.ok ? 200 : 400); }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
