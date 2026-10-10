// src/lib/pay-questions.ts — "SOMETHING'S OFF" ON A PAY STUB. A team member points at one line, says what looks wrong
// and sends it; managers see it in Pay questions with the line's own records. Statuses: open → checking → sorted |
// explained. Ways to settle it:
//   adjust   — a correction of $X on their CURRENT pay (payAdjustments, dated now), shown on the stub and the payroll
//              draft. Paid stubs never change, so a fix to a paid period always lands here.
//   fixed    — the record itself was put right (a tip moved to the right visit, a punch corrected) and the live stub
//              now shows it — only while that period hasn't been paid.
//   explain  — it was right; the manager says why.
// Everyone sees the conversation; the person is notified at each step. Server-only writes.
import type { RequestActor } from '@/lib/request-actor';

export const REASONS: Record<string, string> = { visit_missing: 'A visit is missing', tip_missing: 'A tip is missing', wrong_price: 'Wrong price or rate', hours_wrong: 'Hours are wrong', other: 'Something else' };
const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();

async function tell(db: any, tenantId: string, userIds: string[], type: string, message: string, link: string, questionId: string) {
  const b = db.batch();
  for (const u of [...new Set(userIds.filter(Boolean))]) { const r = db.collection(`${T(tenantId)}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type, message, link, questionId, createdAt: now(), read: false }); }
  await b.commit();
}
async function managersOf(db: any, tenantId: string): Promise<string[]> {
  return (await db.collection(`${T(tenantId)}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get()).docs.filter((d: any) => (d.data() as any)?.archived !== true).map((d: any) => d.id);
}

export async function askPayQuestion(db: any, tenantId: string, actor: RequestActor, b: any) {
  const reason = REASONS[String(b.reason)] ? String(b.reason) : 'other'; const note = String(b.note || '').trim().slice(0, 600);
  const line = b.line || {}; const from = String(b.periodFrom || ''); const to = String(b.periodTo || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { ok: false as const, error: 'Which pay period is this about?' };
  if (reason === 'other' && !note) return { ok: false as const, error: 'Say what looks wrong.' };
  const ref = db.collection(`${T(tenantId)}/payQuestions`).doc();
  const doc = { id: ref.id, staffId: actor.staffId, staffName: actor.name, period: { from, to }, status: 'open', reason, reasonLabel: REASONS[reason],
    line: { ref: String(line.ref || '').slice(0, 120), title: String(line.title || '').slice(0, 160), amount: Number(line.amount) || 0, date: String(line.date || '').slice(0, 10), source: line.source || null },
    visitHint: String(b.visitHint || '').slice(0, 160), note, messages: note ? [{ by: actor.staffId, name: actor.name, text: note, at: now() }] : [], createdAt: now(), updatedAt: now() };
  // The app checks the records first (lib/pay-detective) — the manager opens it with the likely answer ready.
  let found: any[] = []; try { const { investigate } = await import('@/lib/pay-detective'); found = await investigate(db, tenantId, doc); } catch { /* checked by hand instead */ }
  await ref.set(JSON.parse(JSON.stringify({ ...doc, findings: found, checkedAt: now() })));
  await tell(db, tenantId, (await managersOf(db, tenantId)).filter((id) => id !== actor.staffId), 'pay_question', `${actor.name.split(' ')[0]} has a pay question: ${REASONS[reason].toLowerCase()}${doc.line.title ? ` — ${doc.line.title}` : ''}.`, '/payroll/questions', ref.id);
  return { ok: true as const, id: ref.id };
}

export async function actOnPayQuestion(db: any, tenantId: string, actor: RequestActor, b: any) {
  const ref = db.doc(`${T(tenantId)}/payQuestions/${String(b.id || '')}`); const s = await ref.get();
  if (!s.exists) return { ok: false as const, error: 'That question wasn’t found.' };
  const q: any = s.data(); const mine = q.staffId === actor.staffId; const action = String(b.action || '');
  const text = String(b.note || b.text || '').trim().slice(0, 600);
  if (!mine && !actor.isManager) return { ok: false as const, error: 'Only managers can answer pay questions.' };
  if (['sorted', 'explained'].includes(q.status) && action !== 'reply') return { ok: false as const, error: 'This question is already settled.' };
  const msg = text ? [{ by: actor.staffId, name: actor.name, text, at: now() }] : [];
  const { FieldValue } = await import('firebase-admin/firestore');
  const push = (patch: any) => ref.set({ ...patch, updatedAt: now(), ...(msg.length ? { messages: FieldValue.arrayUnion(...msg) } : {}) }, { merge: true });
  const toPerson = (m: string) => tell(db, tenantId, [q.staffId], 'pay_question_update', m, 'earnings', ref.id);
  const first = String(actor.name || 'Your manager').split(' ')[0];

  if (action === 'reply') {
    if (!text) return { ok: false as const, error: 'Write a reply.' };
    await push(actor.isManager && !mine && q.status === 'open' ? { status: 'checking', seenAt: now(), seenBy: actor.name } : {});
    if (mine) await tell(db, tenantId, (await managersOf(db, tenantId)).filter((id) => id !== actor.staffId), 'pay_question', `${String(q.staffName).split(' ')[0]} replied about their pay question.`, '/payroll/questions', ref.id);
    else await toPerson(`${first} replied about your pay question.`);
    return { ok: true as const };
  }
  if (!actor.isManager) return { ok: false as const, error: 'Only managers can do that.' };
  if (action === 'seen') { if (q.status === 'open') { await push({ status: 'checking', seenAt: now(), seenBy: actor.name }); await toPerson(`${first} is looking at your pay question.`); } return { ok: true as const }; }
  if (action === 'adjust') {
    const cents = Math.round(Number(b.amount) * 100); if (!Number.isFinite(cents) || cents === 0 || Math.abs(cents) > 500000) return { ok: false as const, error: 'Enter the amount to add (or take off).' };
    const a = db.collection(`${T(tenantId)}/payAdjustments`).doc();
    await a.set({ id: a.id, staffId: q.staffId, amountCents: cents, date: now(), reason: `Correction: ${q.line?.title || q.reasonLabel}`, questionId: ref.id, by: actor.staffId, byName: actor.name, createdAt: now() });
    await push({ status: 'sorted', resolution: { kind: 'adjust', amountCents: cents, adjustmentId: a.id, note: text || null, by: actor.name, at: now() } });
    await toPerson(`Sorted — ${cents > 0 ? `$${(cents / 100).toFixed(2)} added to` : `$${(-cents / 100).toFixed(2)} taken off`} your current pay. ${text}`.trim());
    return { ok: true as const };
  }
  if (action === 'fixed') { await push({ status: 'sorted', resolution: { kind: 'fixed', note: text || null, by: actor.name, at: now() } }); await toPerson(`Sorted — ${first} corrected the record; your stub shows it now. ${text}`.trim()); return { ok: true as const }; }
  if (action === 'explain') { if (!text) return { ok: false as const, error: 'Say why it’s right.' }; await push({ status: 'explained', resolution: { kind: 'explain', note: text, by: actor.name, at: now() } }); await toPerson(`${first} answered your pay question: ${text}`); return { ok: true as const }; }
  return { ok: false as const, error: 'Unknown action.' };
}
