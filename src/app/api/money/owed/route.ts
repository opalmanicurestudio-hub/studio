// src/app/api/money/owed/route.ts — what the business still owes clients: unused store credit and gift card balances
// (lib/owed-to-clients). Managers only.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { owedToClients } from '@/lib/owed-to-clients';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120); if (!tenantId) return j({ ok: false, error: 'Missing details.' }, 400);
  const db = getAdminDb(); const w = await requestActor(db, req.headers.get('authorization'), tenantId); if (!w.ok) return j({ ok: false, error: w.error }, w.status);
  if (!(w.actor.isManager || w.actor.isOwner)) return j({ ok: false, error: 'Only managers can see this.' }, 403);
  try { return j(await owedToClients(db, tenantId)); } catch (e) { console.error('[money/owed]', e); return j({ ok: false, error: 'That didn’t load. Please try again.' }, 500); }
}
