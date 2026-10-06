// src/app/api/clients/notes/route.ts — NOTES ABOUT A CLIENT, EACH WITH WHO CAN SEE IT (staff only; enforced here).
//   { action: 'list', clientId }                         → only the notes this person may see: the team's, managers'
//                                                          (owners / admins / managers), and their own private ones
//   { action: 'add', clientId, text, visibility }        → visibility: 'team' | 'managers' | 'private'
//   { action: 'pin' | 'unpin', id }                      → keep a note at the top (managers, or its author)
//   { action: 'delete', id }                             → its author, or an owner / admin
// Stored in tenants/{t}/clientNotes. The client's older fixed notes (goals, routine, history, general) are shown
// alongside as the team's, so nothing already written disappears.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);
const MANAGERS = ['owner', 'admin', 'manager'];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const me = { uid: String(auth.actor.uid), name: String(auth.actor.name || 'Team member'), role: String(auth.actor.role || '').toLowerCase(), owner: !!auth.actor.isTenantOwner };
  const isManager = me.owner || MANAGERS.includes(me.role);
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const col = db.collection(`${T}/clientNotes`); const now = new Date().toISOString();
  const mayRead = (n: any) => n.visibility === 'team' || (n.visibility === 'managers' && isManager) || (n.visibility === 'private' && n.authorUid === me.uid);

  if (b.action === 'list') {
    const clientId = s(b.clientId, 120); if (!clientId) return NextResponse.json({ ok: false, error: 'Which client?' }, { status: 400 });
    const rows = (await col.where('clientId', '==', clientId).limit(300).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter(mayRead)
      .map((n: any) => ({ id: n.id, text: n.text, visibility: n.visibility, authorName: n.authorName, mine: n.authorUid === me.uid, at: n.at, pinned: !!n.pinned }));
    const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data() || {}; const old = c.notes || {};
    const legacy = (['general', 'goals', 'routine', 'history'] as const).filter((k) => typeof old[k] === 'string' && old[k].trim()).map((k) => ({ id: `legacy:${k}`, text: String(old[k]).trim(), visibility: 'team', authorName: { general: 'General note', goals: 'Their goals', routine: 'Their routine', history: 'History' }[k], mine: false, at: null, pinned: false, legacy: true }));
    rows.sort((x: any, y: any) => Number(y.pinned) - Number(x.pinned) || String(y.at || '').localeCompare(String(x.at || '')));
    return NextResponse.json({ ok: true, rows: [...rows, ...legacy], isManager });
  }
  if (b.action === 'add') {
    const clientId = s(b.clientId, 120), text = s(b.text, 2000); const visibility = ['team', 'managers', 'private'].includes(b.visibility) ? b.visibility : 'team';
    if (!clientId || !text) return NextResponse.json({ ok: false, error: 'Write the note first.' }, { status: 400 });
    if (!(await db.doc(`${T}/clients/${clientId}`).get()).exists) return NextResponse.json({ ok: false, error: 'That client wasn’t found.' }, { status: 404 });
    if (visibility === 'managers' && !isManager) return NextResponse.json({ ok: false, error: 'Only managers can write managers-only notes.' }, { status: 403 });
    const ref = col.doc(); await ref.set({ clientId, text, visibility, authorUid: me.uid, authorName: me.name, at: now, pinned: false });
    return NextResponse.json({ ok: true, id: ref.id });
  }
  const id = s(b.id, 120); const ref = id && !id.startsWith('legacy:') ? col.doc(id) : null; const cur: any = ref ? (await ref.get()).data() : null;
  if (!cur || !mayRead(cur)) return NextResponse.json({ ok: false, error: 'That note wasn’t found.' }, { status: 404 });
  if (b.action === 'pin' || b.action === 'unpin') { if (!(isManager || cur.authorUid === me.uid)) return NextResponse.json({ ok: false, error: 'Only managers or its author can pin it.' }, { status: 403 }); await ref!.set({ pinned: b.action === 'pin' }, { merge: true }); return NextResponse.json({ ok: true }); }
  if (b.action === 'delete') { if (!(cur.authorUid === me.uid || me.owner || ['owner', 'admin'].includes(me.role))) return NextResponse.json({ ok: false, error: 'Only its author or an owner can delete it.' }, { status: 403 }); await ref!.delete(); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
