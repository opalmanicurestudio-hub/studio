// POST { tenantId, scope } → { k, x }: a 15-minute key for one staff-only print page.
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { makePrintKey } from '@/lib/print-key';

const SCOPES: Record<string, (caps: string[], isManager: boolean) => boolean> = {
  'loss-recovery': (c, m) => m || c.includes('money.view'),
  evidence: () => true,
};

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || ''); const scope = String(b.scope || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[a-z-]+(:[A-Za-z0-9_-]{1,80})?$/.test(scope)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const allow = SCOPES[scope.split(':')[0]];
  if (!allow || !allow(auth.actor.caps || [], auth.actor.isManager)) return NextResponse.json({ error: 'That page isn’t part of your access.' }, { status: 403 });
  return NextResponse.json(makePrintKey(tenantId, scope));
}
