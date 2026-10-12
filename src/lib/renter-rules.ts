// src/lib/renter-rules.ts — PART 6: BUILDING RULES. The studio writes documents for renters (Documents → "Who it's for:
// Renters", or renters by name — usually in the Building rules collection). Renters read and sign them in their own
// portal (/rent → Studio). A signature is the same sign-off the team's are (documents/{id}/acks/{staffId}: version,
// when, quiz score, the drawn signature) — so the studio's document page shows who has signed which version, and a new
// version asks them to sign again. Renters never see the team's documents, and the studio never sees the renter's own.
import { docIsFor } from '@/lib/my-work';
import { renterStaff } from '@/lib/renter-session';

const T = (t: string) => `tenants/${t}`;
export type RuleState = 'sign' | 'resign' | 'signed';

/** The building rules for this renter, with where they stand on each. */
export async function rulesFor(db: any, tenantId: string, renterId: string) {
  const me = await renterStaff(db, tenantId, renterId); if (!me) return { ok: true as const, rules: [], staffId: null };
  const who = { id: me.id, role: 'renter', isRenter: true } as any;
  const docs = (await db.collection(`${T(tenantId)}/documents`).where('status', '==', 'published').get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((d: any) => docIsFor(d, who));
  const rules = await Promise.all(docs.map(async (d: any) => {
    const ack: any = (await db.doc(`${T(tenantId)}/documents/${d.id}/acks/${me.id}`).get()).data() || null;
    const version = Number(d.version || 1); const state: RuleState = !ack ? 'sign' : Number(ack.version || 0) >= version ? 'signed' : 'resign';
    return { id: String(d.id), title: String(d.title || 'Building rules'), version, sections: Array.isArray(d.sections) ? d.sections : [], quiz: Array.isArray(d.quiz) ? d.quiz : [],
      requireSignature: d.requireSignature === true, signBy: d.signBy || null, changeNote: version > 1 ? d.changeNote || null : null, state: state as RuleState,
      signedAt: ack?.acknowledgedAt || null, signedVersion: ack ? Number(ack.version || 0) : null };
  }));
  const order: Record<RuleState, number> = { resign: 0, sign: 1, signed: 2 };
  rules.sort((a: any, b: any) => order[a.state as RuleState] - order[b.state as RuleState] || String(a.signBy || '9').localeCompare(String(b.signBy || '9')) || a.title.localeCompare(b.title));
  return { ok: true as const, rules, staffId: me.id };
}

/** Sign (or confirm) the current version. The signature is drawn in the portal and kept as a picture. */
export async function signRule(db: any, tenantId: string, renterId: string, docId: string, x: { signature?: string | null; quiz?: { right: number; total: number } | null }) {
  const me = await renterStaff(db, tenantId, renterId); if (!me) return { ok: false, error: 'Your provider profile isn’t set up yet — ask the studio.' };
  const snap = await db.doc(`${T(tenantId)}/documents/${docId}`).get(); const d: any = snap.exists ? { id: docId, ...(snap.data() || {}) } : null;
  if (!d || !docIsFor(d, { id: me.id, role: 'renter', isRenter: true } as any)) return { ok: false, error: 'That document isn’t for you.' };
  const version = Number(d.version || 1);
  let signatureUrl: string | null = null;
  if (d.requireSignature === true) {
    if (!x.signature || !/^data:image\/png;base64,/.test(String(x.signature))) return { ok: false, error: 'Draw your signature first.' };
    const { uploadClaimPhotoFromDataUrl } = await import('@/lib/claim-photo-upload');
    const r = await uploadClaimPhotoFromDataUrl(tenantId, `${docId}_${me.id}_v${version}`, x.signature, 'signatures');
    if (!r.url) return { ok: false, error: r.error || 'Your signature didn’t save — try again.' }; signatureUrl = r.url;
  }
  const quiz = x.quiz && Number.isFinite(Number(x.quiz.right)) && Number.isFinite(Number(x.quiz.total)) ? { right: Math.max(0, Math.round(Number(x.quiz.right))), total: Math.max(0, Math.round(Number(x.quiz.total))) } : null;
  await db.doc(`${T(tenantId)}/documents/${docId}/acks/${me.id}`).set({ id: me.id, staffId: me.id, staffName: me.name || 'Renter', renterId, version, acknowledgedAt: new Date().toISOString(), via: 'renter_portal',
    ...(signatureUrl ? { signatureUrl } : {}), ...(quiz ? { quiz } : {}) }, { merge: true });
  return { ok: true, version };
}
