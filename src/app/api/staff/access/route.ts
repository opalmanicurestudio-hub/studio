// src/app/api/staff/access/route.ts — team members' access to the app (lib/team-access). Managers only.
//   { tenantId, staffId, action: 'invite', email }  link a login and email a set-password link
//   { tenantId, staffId, action: 'sync' }           copy their role across after an edit (and turn access off if archived)
//   { tenantId, staffId, action: 'revoke' }         turn app access off
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { inviteToApp, syncAccess, revokeAccess } from '@/lib/team-access';
import { resolveFromAddress } from '@/lib/notify';
import { logAuditAdmin } from '@/lib/audit';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const staffId = String(b.staffId || '').slice(0, 120);
  if (!tenantId || !staffId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  if (!who.actor.isManager) return NextResponse.json({ ok: false, error: 'Only a manager can change who can sign in.' }, { status: 403 });
  // Only the owner can give someone the owner role's access.
  const target: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data() || {};
  if (['owner', 'admin'].includes(String(target.role)) && !who.actor.isOwner && who.actor.role !== 'owner') return NextResponse.json({ ok: false, error: 'Only the owner can give owner or admin access.' }, { status: 403 });
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  let r;
  if (b.action === 'invite') {
    const send = async (to: string, subject: string, text: string) => { if (!process.env.RESEND_API_KEY) return false;
      const x = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: resolveFromAddress(), to, subject, text }) }).catch(() => null); return !!x?.ok; };
    r = await inviteToApp(db, getAdminAuth(), tenantId, staffId, String(b.email || target.email || ''), { send, studioName: tenant.name || tenant.businessName, by: who.actor.staffId });
  } else if (b.action === 'sync') r = await syncAccess(db, tenantId, staffId);
  else if (b.action === 'revoke') r = await revokeAccess(db, tenantId, staffId);
  else return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  if (r.ok && b.action !== 'sync') await logAuditAdmin(db, tenantId, { action: `staff.app_${b.action}`, targetType: 'staff', targetId: staffId, summary: `${who.actor.name} ${b.action === 'invite' ? 'invited' : 'turned off app access for'} ${target.name || 'a team member'}${b.action === 'invite' ? ' to the app' : ''}`, actor: { type: 'user', id: who.actor.staffId, name: who.actor.name } } as any).catch(() => {});
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
