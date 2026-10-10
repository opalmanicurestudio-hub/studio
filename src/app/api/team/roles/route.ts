// src/app/api/team/roles/route.ts — THE BUSINESS'S ROLES (lib/permissions): rename a built-in role, change what any role
// allows, add the business's own roles, remove one. Owners and admins only. Logins with a changed role are brought up to
// date straight away (lib/team-access syncRole), so the database rules follow too.
//   { tenantId, action: 'save', roleId?, name, caps, base? }   new role when roleId is missing
//   { tenantId, action: 'reset', roleId }                       a built-in role back to its starting point
//   { tenantId, action: 'delete', roleId, moveTo? }             the business's own role; its people move to `moveTo` (default: its base)
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { ALL_CAPS, BUILT_IN, rolesFor, roleIdFrom } from '@/lib/permissions';
import { syncRole } from '@/lib/team-access';
import { logAuditAdmin } from '@/lib/audit';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  const g = await requireRole(req, tenantId, 'owner'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data() || {};
  const roles = rolesFor(tenant); const now = new Date().toISOString();
  const caps = Array.isArray(b.caps) ? [...new Set(b.caps.map(String).filter((c: string) => (ALL_CAPS as string[]).includes(c)))] : null;
  const name = String(b.name || '').trim().slice(0, 40);
  let roleId = String(b.roleId || '').slice(0, 40); let summary = '';

  if (b.action === 'save') {
    if (roleId === 'owner') return NextResponse.json({ ok: false, error: 'The owner can always do everything.' }, { status: 400 });
    if (!roleId) {
      if (!name) return NextResponse.json({ ok: false, error: 'Give the role a name.' }, { status: 400 });
      roleId = roleIdFrom(name, Object.keys(roles));
    } else if (!roles[roleId]) return NextResponse.json({ ok: false, error: 'That role isn’t here any more.' }, { status: 404 });
    const base = BUILT_IN[String(b.base || '')] && b.base !== 'owner' ? String(b.base) : undefined;
    const rec: any = { ...(name ? { name } : {}), ...(caps ? { caps } : {}), ...(base ? { base } : {}), updatedAt: now, updatedBy: g.actor.uid };
    await db.doc(T).set({ roles: { [roleId]: rec } }, { merge: true });
    summary = `${g.actor.name} ${b.roleId ? 'changed' : 'added'} the role ${name || roles[roleId]?.name || roleId}`;
  } else if (b.action === 'reset') {
    if (!BUILT_IN[roleId] || roleId === 'owner') return NextResponse.json({ ok: false, error: 'Only a built-in role can be reset.' }, { status: 400 });
    await db.doc(T).update({ [`roles.${roleId}`]: FieldValue.delete() });
    summary = `${g.actor.name} reset the role ${roles[roleId]?.name || roleId}`;
  } else if (b.action === 'delete') {
    if (BUILT_IN[roleId]) return NextResponse.json({ ok: false, error: 'Built-in roles can’t be removed — rename or reset them instead.' }, { status: 400 });
    if (!roles[roleId]) return NextResponse.json({ ok: false, error: 'That role isn’t here any more.' }, { status: 404 });
    const moveTo = String(b.moveTo || roles[roleId].base || 'staff');
    if (!roles[moveTo] || moveTo === roleId || ['owner', 'admin'].includes(moveTo)) return NextResponse.json({ ok: false, error: 'Choose a role for its people to move to.' }, { status: 400 });
    const holders = await db.collection(`${T}/staff`).where('role', '==', roleId).get();
    for (const d of holders.docs) await d.ref.set({ role: moveTo, roleMovedAt: now }, { merge: true });
    await db.doc(T).update({ [`roles.${roleId}`]: FieldValue.delete() });
    await syncRole(db, tenantId, moveTo).catch(() => 0);
    summary = `${g.actor.name} removed the role ${roles[roleId].name}${holders.docs.length ? ` and moved ${holders.docs.length} ${holders.docs.length === 1 ? 'person' : 'people'} to ${roles[moveTo].name}` : ''}`;
  } else return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });

  const synced = b.action === 'delete' ? 0 : await syncRole(db, tenantId, roleId).catch(() => 0);
  await logAuditAdmin(db, tenantId, { action: `team.role_${b.action}`, targetType: 'role', targetId: roleId, summary, actor: { type: 'user', id: g.actor.uid, name: g.actor.name } } as any).catch(() => {});
  return NextResponse.json({ ok: true, roleId, synced });
}
