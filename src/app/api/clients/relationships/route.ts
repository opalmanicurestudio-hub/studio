// src/app/api/clients/relationships/route.ts — LINKS BETWEEN CLIENTS (staff only; every change audited).
//   { action: 'list', clientId }                                  → links in force or ended, seen from that person
//   { action: 'add', fromId, toId, kind, permissions?, startsAt?, endsAt?, note? }
//   { action: 'update', id, permissions?, endsAt?, note? }
//   { action: 'end', id }                                         → ended today (kept for the record, never deleted)
// A guest booked online (G2) shows as "Guest of <organiser>" even before a link is saved.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { KINDS, PERMISSIONS, asSeenBy, isActive, type RelKind, type Relationship } from '@/lib/relationships';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);
const perms = (v: any, kind: RelKind) => Array.isArray(v) ? v.map(String).filter((p) => PERMISSIONS.some((x) => x.key === p)) : [...KINDS[kind].defaults];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const col = db.collection(`${T}/clientRelationships`); const now = new Date().toISOString();
  const nameOf = async (id: string) => { const c: any = (await db.doc(`${T}/clients/${id}`).get()).data(); return c ? (c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Client') : null; };
  const audit = (action: string, summary: string, id: string) => logAuditAdmin(db, tenantId, { action, targetType: 'client_relationship', targetId: id, summary, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});

  if (b.action === 'list') {
    const id = s(b.clientId, 120); if (!id) return NextResponse.json({ ok: false, error: 'Which client?' }, { status: 400 });
    const [a, z] = await Promise.all([col.where('fromId', '==', id).get(), col.where('toId', '==', id).get()]);
    const rels: Relationship[] = [...a.docs, ...z.docs].map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const me: any = (await db.doc(`${T}/clients/${id}`).get()).data() || {};
    if (me.guestOf && !rels.some((r) => r.kind === 'organizer' && r.fromId === me.guestOf && r.toId === id)) rels.push({ id: `guestOf:${id}`, fromId: String(me.guestOf), toId: id, kind: 'organizer', permissions: [...KINDS.organizer.defaults], note: 'Booked together online', createdAt: null as any });
    const rows = await Promise.all(rels.map(async (r) => { const v = asSeenBy(r, id); return { ...r, ...v, otherName: (await nameOf(v.otherId)) || 'Someone removed', active: isActive(r), derived: r.id.startsWith('guestOf:') }; }));
    rows.sort((x, y) => Number(y.active) - Number(x.active) || String(x.otherName).localeCompare(String(y.otherName)));
    return NextResponse.json({ ok: true, rows });
  }
  if (b.action === 'add') {
    const fromId = s(b.fromId, 120), toId = s(b.toId, 120), kind = s(b.kind, 30) as RelKind;
    if (!fromId || !toId || fromId === toId) return NextResponse.json({ ok: false, error: 'Choose two different people.' }, { status: 400 });
    if (!KINDS[kind]) return NextResponse.json({ ok: false, error: 'Choose how they’re connected.' }, { status: 400 });
    const [fn, tn] = await Promise.all([nameOf(fromId), nameOf(toId)]); if (!fn || !tn) return NextResponse.json({ ok: false, error: 'One of those clients wasn’t found.' }, { status: 404 });
    const dup = (await col.where('fromId', '==', fromId).where('toId', '==', toId).get()).docs.some((d: any) => { const r: any = d.data(); return r.kind === kind && !r.endedAt; });
    if (dup) return NextResponse.json({ ok: false, error: `${fn} is already linked to ${tn} that way.` }, { status: 409 });
    const ref = col.doc(); const rel = { fromId, toId, kind, permissions: perms(b.permissions, kind), startsAt: s(b.startsAt, 30) || null, endsAt: s(b.endsAt, 30) || null, note: s(b.note, 300) || null, createdAt: now, createdBy: auth.actor.name || auth.actor.uid, endedAt: null };
    await ref.set(rel); await audit('client.relationship_added', `${fn} — ${KINDS[kind].label.toLowerCase()} ${tn}`, ref.id);
    return NextResponse.json({ ok: true, id: ref.id });
  }
  const id = s(b.id, 120); const ref = id ? col.doc(id) : null; const cur: any = ref ? (await ref.get()).data() : null;
  if (!cur) return NextResponse.json({ ok: false, error: 'That link wasn’t found.' }, { status: 404 });
  if (b.action === 'update') {
    const patch: any = { updatedAt: now, updatedBy: auth.actor.name || auth.actor.uid };
    if (b.permissions !== undefined) patch.permissions = perms(b.permissions, cur.kind); if (b.endsAt !== undefined) patch.endsAt = s(b.endsAt, 30) || null; if (b.note !== undefined) patch.note = s(b.note, 300) || null;
    await ref!.set(patch, { merge: true }); await audit('client.relationship_changed', `Permissions or dates changed (${KINDS[cur.kind as RelKind]?.label || cur.kind})`, id);
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'end') { await ref!.set({ endedAt: now, endedBy: auth.actor.name || auth.actor.uid }, { merge: true }); await audit('client.relationship_ended', `Link ended (${KINDS[cur.kind as RelKind]?.label || cur.kind})`, id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
