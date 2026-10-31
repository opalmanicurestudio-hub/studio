// /api/replies — THE REPLIES PLAYBOOK'S CHANGES (lib/replies, Settings → Replies). For the people whose role runs the
// settings (Settings → Roles); the owner always can. The team reads the replies straight from the database (they pick
// them in reply boxes); only this route writes them.
//   { tenantId, action: 'save', id?, situation, name, text }   a built-in reply reworded, one of your own changed, or a new one
//   { tenantId, action: 'hide' | 'show', id }                   a built-in reply taken out of the reply boxes, or put back
//   { tenantId, action: 'reset', id }                           a built-in reply back to its built-in wording
//   { tenantId, action: 'remove', id }                          one of your own deleted
//   { tenantId, action: 'auto', kind, on }                      a message that sends on its own turned on or off
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { AUTOMATIC_KINDS, CUSTOM_REPLY_MAX, checkReply, isBuiltIn, isSituation } from '@/lib/replies';
import { MESSAGE_KIND_BY_ID } from '@/lib/message-policy';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return bad('Missing details.');
  const g = await requireCan(req, tenantId, 'settings.manage'); if (g.deny) return g.deny;
  const db = getAdminDb();
  const col = db.collection(`tenants/${tenantId}/replies`);
  const who = { id: String(g.actor?.uid || g.actor?.id || ''), name: String(g.actor?.name || 'Someone') };
  const at = new Date().toISOString();
  const log = (summary: string, id: string) => logAuditAdmin(db, tenantId, { action: 'replies.changed', targetType: 'reply', targetId: id, summary, actor: { type: 'user', id: who.id, name: who.name } } as any).catch(() => {});
  try {
    if (b.action === 'save') {
      const c = checkReply(b); if (!c.ok) return bad(c.error);
      const id = b.id ? String(b.id) : '';
      if (id && !ID.test(id)) return bad('That reply isn’t there any more.', 404);
      if (id && isBuiltIn(id)) {
        // A built-in reply keeps its place: only its name and words change.
        const { BUILT_IN_REPLIES } = await import('@/lib/replies');
        const base = BUILT_IN_REPLIES.find((r) => r.id === id)!;
        await col.doc(id).set({ id, situation: base.situation, name: c.name, text: c.text, updatedAt: at, updatedBy: who }, { merge: true });
        await log(`Reworded the ready reply “${c.name}”`, id);
        return NextResponse.json({ ok: true, id });
      }
      if (id) {
        const out = await db.runTransaction(async (tx: any) => {
          const ref = col.doc(id); const s = await tx.get(ref);
          if (!s.exists) return false;
          tx.update(ref, { situation: c.situation, name: c.name, text: c.text, updatedAt: at, updatedBy: who });
          return true;
        });
        if (!out) return bad('That reply isn’t there any more.', 404);
        await log(`Changed the ready reply “${c.name}”`, id);
        return NextResponse.json({ ok: true, id });
      }
      // The ones that show in the list (a soft limit: two saves at the same moment can each add one).
      const mine = (await col.get()).docs.filter((d: any) => !isBuiltIn(d.id) && isSituation(d.data()?.situation)).length;
      if (mine >= CUSTOM_REPLY_MAX) return bad(`You have ${CUSTOM_REPLY_MAX} replies of your own. Remove one to add another.`);
      const ref = col.doc();
      await ref.set({ id: ref.id, situation: c.situation, name: c.name, text: c.text, createdAt: at, createdBy: who, updatedAt: at, updatedBy: who });
      await log(`Added the ready reply “${c.name}”`, ref.id);
      return NextResponse.json({ ok: true, id: ref.id });
    }
    if (b.action === 'hide' || b.action === 'show' || b.action === 'reset') {
      const id = String(b.id || '');
      if (!isBuiltIn(id)) return bad('Only a built-in reply can be hidden or reset.');
      if (b.action === 'reset') {
        const cur: any = (await col.doc(id).get()).data() || null;
        // Back to the built-in words, still hidden if it was.
        if (cur?.hidden === true) await col.doc(id).set({ id, hidden: true, updatedAt: at, updatedBy: who });
        else await col.doc(id).delete().catch(() => {});
        await log('Put a ready reply back to its built-in wording', id);
      } else {
        await col.doc(id).set({ id, hidden: b.action === 'hide', updatedAt: at, updatedBy: who }, { merge: true });
        await log(b.action === 'hide' ? 'Hid a built-in ready reply' : 'Brought back a built-in ready reply', id);
      }
      return NextResponse.json({ ok: true, id });
    }
    if (b.action === 'remove') {
      const id = String(b.id || '');
      if (!ID.test(id) || isBuiltIn(id)) return bad('Only a reply of your own can be removed. A built-in one can be hidden.');
      const ref = col.doc(id); const s = await ref.get();
      if (!s.exists) return NextResponse.json({ ok: true, id });
      const name = String(s.data()?.name || '').slice(0, 60);
      await ref.delete();
      await log(`Removed the ready reply “${name}”`, id);
      return NextResponse.json({ ok: true, id });
    }
    if (b.action === 'auto') {
      const kind = String(b.kind || '');
      if (!(AUTOMATIC_KINDS as readonly string[]).includes(kind) || !Object.prototype.hasOwnProperty.call(MESSAGE_KIND_BY_ID, kind)) return bad('Unknown message.');
      // A message a customer has a right to (the claim decision, return progress) can't be turned off.
      if (!MESSAGE_KIND_BY_ID[kind].canDisable) return bad(MESSAGE_KIND_BY_ID[kind].mandatoryNote || 'This one always sends.');
      if (typeof b.on !== 'boolean') return bad('On or off?');
      await db.doc(`tenants/${tenantId}`).update({ [`messagePolicy.${kind}.emailEnabled`]: b.on });
      await log(`${b.on ? 'Turned on' : 'Turned off'} “${MESSAGE_KIND_BY_ID[kind].label}”`, kind);
      return NextResponse.json({ ok: true });
    }
    return bad('Unknown action.');
  } catch (e: any) {
    console.warn('[replies]', String(e?.message || e).slice(0, 160));
    return bad('That didn’t save. Try again.', 500);
  }
}
