// src/app/api/outreach-pause/route.ts — "Hold automatic offers today" (lib/outreach-pause).
//   status → (the team) whether it's on and until when · pause { why? } / resume → (managers)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { pauseOf, pausedNow, pauseUntil } from '@/lib/outreach-pause';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const action = String(b.action || 'status');
  const g: any = await requireRole(req, tenantId, action === 'status' ? 'staff' : 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}`); const tenant: any = (await ref.get()).data() || {}; const by = g.actor?.name || 'Staff';
  if (action === 'pause') { const p = { until: pauseUntil(tenant), by, at: new Date().toISOString(), why: String(b.why || '').slice(0, 120) || null }; await ref.set({ outreachPause: p }, { merge: true });
    const { logAuditAdmin } = await import('@/lib/audit'); await logAuditAdmin(db, tenantId, { action: 'outreach.pause', targetType: 'tenant', targetId: tenantId, summary: `${by} held automatic offers for the rest of today`, actor: { type: 'user', id: g.actor?.uid || '', name: by, role: g.actor?.role || '' } } as any).catch(() => {});
    return NextResponse.json({ ok: true, paused: true, ...p }); }
  if (action === 'resume') { await ref.set({ outreachPause: null }, { merge: true });
    const { logAuditAdmin } = await import('@/lib/audit'); await logAuditAdmin(db, tenantId, { action: 'outreach.resume', targetType: 'tenant', targetId: tenantId, summary: `${by} turned automatic offers back on`, actor: { type: 'user', id: g.actor?.uid || '', name: by, role: g.actor?.role || '' } } as any).catch(() => {});
    return NextResponse.json({ ok: true, paused: false }); }
  const p = pauseOf(tenant); return NextResponse.json({ ok: true, paused: pausedNow(tenant), until: p?.until || null, by: p?.by || null, why: p?.why || null, canChange: !!(g.actor?.isManager || g.actor?.isOwner || ['owner', 'admin', 'manager'].includes(String(g.actor?.role || ''))) });
}
