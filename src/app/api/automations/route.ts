// src/app/api/automations/route.ts — the automation list with live health,
// for the business's owners and managers.
import { getAdminDb } from '@/lib/firebase-admin';
import { MESSAGE_KINDS } from '@/lib/message-policy';
import { switchRows } from '@/lib/automation-switches';
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { automationHealth } from '@/lib/automations';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only owners and managers can see automations.' }, { status: 403 });
  const db = getAdminDb(); const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const health = await automationHealth(tenantId);
  const stats: Record<string, any> = {}; (await db.collection(`tenants/${tenantId}/automationStats`).get().catch(() => ({ docs: [] as any[] }))).docs.forEach((d: any) => { stats[d.id] = d.data(); });
  // Only tools on this business's plan: no renter messages without booth rental, no shop messages without the shop…
  const kindModule: Record<string, string> = {}; for (const k of MESSAGE_KINDS as any[]) kindModule[k.id] = k.group === 'Renters' ? 'booth_rental' : k.group === 'Retail' ? 'retail' : '';
  const extraModule: Record<string, string> = { 'msg:tour_reminder': 'booth_rental', 'msg:tour_changed': 'booth_rental', 'act:rent_autopay': 'booth_rental', 'msg:reservation': 'booth_rental', 'msg:admissions': 'academy', 'act:admissions_daily': 'academy', 'act:campaigns': 'marketing' };
  const onPlan = (m?: string) => !m || t?.modules?.[m] !== false;
  const items = health.items.filter((a: any) => onPlan(extraModule[a.id] || (a.kinds.length === 1 ? kindModule[a.kinds[0]] : '')) && (a.who !== 'Visitors & renters' || onPlan('booth_rental')) && (a.who !== 'Students & applicants' || onPlan('academy')));
  return NextResponse.json({ ok: true, ...health, items, switches: switchRows(t, stats) }, { headers: { 'Cache-Control': 'no-store' } });
}
