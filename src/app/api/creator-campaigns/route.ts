// src/app/api/creator-campaigns/route.ts — CREATOR CAMPAIGNS for the business (lib/creator-campaigns-server). Managers only.
//   list · get { id | 'new' } · save { campaign } · review { campaignId, creatorId, pieceId, decision, note? }
//   scorecards { months } · margin { margin } (the business's margin on services, for the planner)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { listCampaigns, getCampaign, saveCampaign, reviewHand, scorecards } from '@/lib/creator-campaigns-server';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120); if (!tenantId) return j({ ok: false, error: 'Missing details.' }, 400);
  const db = getAdminDb(); const w = await requestActor(db, req.headers.get('authorization'), tenantId); if (!w.ok) return j({ ok: false, error: w.error }, w.status);
  const a = w.actor; if (!(a.isManager || a.isOwner)) return j({ ok: false, error: 'Only managers can do this.' }, 403);
  try {
    const action = String(b.action || 'list');
    if (action === 'list') return j(await listCampaigns(db, tenantId));
    if (action === 'get') return j(await getCampaign(db, tenantId, String(b.id || 'new').slice(0, 60)));
    if (action === 'save') return j(await saveCampaign(db, tenantId, b.campaign || {}, { id: a.staffId, name: a.name }));
    if (action === 'review') return j(await reviewHand(db, tenantId, b, { name: a.name }));
    if (action === 'scorecards') return j(await scorecards(db, tenantId, Math.max(1, Math.min(24, Number(b.months) || 6))));
    if (action === 'margin') { const m = Number(b.margin); if (!(m > 0 && m < 1)) return j({ ok: false, error: 'Margin should be between 1% and 99%.' }, 400);
      await db.doc(`tenants/${tenantId}`).set({ referrals: { margin: Math.round(m * 100) / 100 } }, { merge: true }); return j({ ok: true }); }
    return j({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e: any) { console.error('[creator-campaigns]', e); return j({ ok: false, error: 'That didn’t work. Please try again.' }, 500); }
}
