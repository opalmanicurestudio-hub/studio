// src/lib/forms-server.ts — ONE PLACE A SIGNED FORM IS SAVED (lib/forms). The booking, the visit link, the older
// completion page and the walk-in kiosk all save through here, so a form signed anywhere is on file everywhere:
//   · on the visit (appointment.signedForms), when there is one — written by the caller with the rest of its patch;
//   · on the client record (signedForms map: formId → when, which version of the wording, from where), which every
//     screen reads to decide what's still needed;
//   · the latest signed copy (clients/{c}/signedConsents/{formId}), as the client profile shows it;
//   · and a copy kept for good (clients/{c}/formHistory), never overwritten, so what someone signed in March is still
//     there after they sign the new wording in June.
// Server side only.
import { formVersion } from './forms';

export type SignedFormIn = { formId: string; formTitle?: string | null; formData?: Record<string, any>; signedName?: string | null; acknowledged?: boolean; guardian?: { name?: string; relationship?: string; confirmed?: boolean } | null };

const str = (v: any, n: number) => String(v ?? '').trim().slice(0, n);

/** Saves the forms a client signed (see the top of this file). Returns what went onto the client record, by form. */
export async function recordSignedForms(db: any, tenantId: string, o: { clientId?: string | null; appointmentId?: string | null; forms: SignedFormIn[]; source: string; at?: string; batch?: any; extra?: Record<string, any> }) {
  const at = o.at || new Date().toISOString();
  const forms = (o.forms || []).filter((f) => f && /^[A-Za-z0-9_-]{1,80}$/.test(String(f.formId || ''))).slice(0, 20);   // a form id is a plain name, never a path
  const out: Record<string, any> = {};
  if (!o.clientId || !forms.length) return out;
  // The forms as they read now: their version, and whether each is signed at every visit.
  const defs = new Map<string, any>();
  await Promise.all(forms.map(async (f) => { try { const d = await db.doc(`tenants/${tenantId}/consentForms/${f.formId}`).get(); if (d.exists) defs.set(f.formId, { id: d.id, ...(d.data() || {}) }); } catch { /* signed as it stands */ } }));
  const batch = o.batch || db.batch();
  const cBase = `tenants/${tenantId}/clients/${o.clientId}`;
  for (const f of forms) {
    const def = defs.get(f.formId) || null;
    const version = def ? formVersion(def) : null;
    const g: Record<string, any> = f.guardian && str(f.guardian.name, 120) ? { guardianName: str(f.guardian.name, 120), guardianRelationship: str(f.guardian.relationship, 80), guardianSignedAt: at, ...(f.guardian.confirmed === true ? { guardianConfirmed: true } : {}) } : {};
    const title = str(def?.title || f.formTitle, 200) || null;   // the form's own title first
    // Both flags written every time (true or false), so an owner un-ticking "sign every visit" takes effect at the next
    // signing instead of sticking for good.
    out[f.formId] = { signedAt: at, version, formTitle: title, source: o.source, appointmentId: o.appointmentId || null, everyVisit: !!def?.requiresEveryAppointment, guardian: !!g.guardianName };
    // Answers too large for one record (several photos kept inside a form) are kept on the visit, not copied again.
    const data = f.formData && typeof f.formData === 'object' ? f.formData : {};
    const fits = JSON.stringify(data).length <= 400_000;
    const signer = str(f.signedName, 120);   // the name they typed to sign it
    const copy = { formId: f.formId, formTitle: title, formData: fits ? data : {}, ...(fits ? {} : { answersOnVisit: true }), ...(signer ? { signedName: signer } : {}), ...(f.acknowledged === true ? { acknowledged: true } : {}), signedAt: at, version, source: o.source, appointmentId: o.appointmentId || null, ...(o.extra || {}), ...g };
    batch.set(db.doc(`${cBase}/signedConsents/${f.formId}`), copy);
    // What they read when they signed, with their answers: kept for good. One record per form, wording and visit, so
    // sending the same thing twice keeps one copy.
    const hid = `${f.formId}_${version || 'v0'}_${o.appointmentId || o.extra?.walkInId || at.slice(0, 10)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300);
    batch.set(db.doc(`${cBase}/formHistory/${hid}`), { ...copy, wording: def ? { title: def.title || null, content: def.content || null, fields: Array.isArray(def.fields) ? def.fields : [] } : null });
  }
  // A nested map, so the forms already on file stay (set with merge merges maps; a dotted key would not).
  batch.set(db.doc(cBase), { signedForms: out }, { merge: true });
  if (!o.batch) await batch.commit();
  return out;
}
