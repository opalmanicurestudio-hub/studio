// src/lib/forms-visit.ts — A VISIT'S FORMS AND DOCUMENTS, AS THE CLIENT SEES THEM (board FormsAfter). The visit link
// opens on this while anything is left: each form the visit asks for, done or not (signed for this visit, still
// current on file, the wording changed, or "anything changed?" for health answers on file), the documents the
// business asked for, and when it's all due. The visit link saves one form at a time here (saveVisitForm), so the
// list ticks off as they go, and once nothing is left the visit's request is closed and, if they were reminded, they
// get a thank-you. A read that fails is never taken as "nothing there": the caller is told to try again. Server side only.
import { formsAskedFor, formAsks, formRulesOf, formMinutes, isHealthForm, formsDueAt, formsRuleOf, sentFormDone, fitOnVisit, toMs, fieldsOf, signedOnVisit, requestAsksMore, onFileEntry, CLIENT_WAIVED, type FormAsk } from './forms';
import { tenantTimeZone } from './tenant-time';
import { answersPath } from './private-records';

export type VisitAsk = FormAsk & { minutes: number; health: boolean; since?: string | null };
export type VisitFile = { id: string; label: string; done: boolean; onFile: boolean; optional?: boolean };
export type VisitForms = {
  asks: VisitAsk[];
  files: VisitFile[];
  /** Still needed before the visit (forms to sign and required documents); "anything changed?" doesn't hold anything up. */
  left: number;
  dueAt: string | null;
  /** What the visit's own service does if its forms aren't done by then (lib/forms formsRuleOf): said to the client. */
  release: 'off' | 'auto' | 'ask';
  defs: any[];
};
export const ENDED_VISIT = ['declined', 'expired', 'released', 'cancelled', 'canceled', 'no_show', 'completed'];

const T = (tenantId: string) => `tenants/${tenantId}`;
/** A document, or null when there isn't one. A failed read throws (it's never mistaken for "deleted"). */
const read = async (db: any, path: string) => { const d = await db.doc(path).get(); return d.exists ? { id: d.id, ...(d.data() || {}) } : null; };

/** The visit's forms and documents, done or not. rec: the visit's request record (bookingCompletions), when there is one. */
export async function visitForms(db: any, tenantId: string, appt: any, o: { tenant?: any; rec?: any; client?: any } = {}): Promise<VisitForms> {
  const tenant = o.tenant || (await read(db, T(tenantId))) || {};
  const svcIds = [appt?.serviceId, ...(Array.isArray(appt?.addOnIds) ? appt.addOnIds : [])].filter(Boolean).map(String).slice(0, 11);
  const svcs = (await Promise.all(svcIds.map((id) => read(db, `${T(tenantId)}/services/${id}`)))).filter(Boolean) as any[];
  const client = o.client || (appt?.clientId ? (await read(db, `${T(tenantId)}/clients/${appt.clientId}`)) || {} : {});
  // The service's forms and any the team added to this visit, and any the request asked for.
  const ids = [...new Set<string>([...formsAskedFor(appt, svcs), ...(Array.isArray(o.rec?.requiredConsentFormIds) ? o.rec.requiredConsentFormIds.map(String) : [])])].slice(0, 30);
  const defs = (await Promise.all(ids.map((id) => read(db, `${T(tenantId)}/consentForms/${id}`)))).filter(Boolean) as any[];
  const rules = formRulesOf(tenant);
  // Only forms that still exist (a deleted one can't be opened, so it's never asked for).
  // Dates said on the business's own clock.
  const zone = tenantTimeZone(tenant); const here = signedOnVisit(appt);
  const dayOf = (ms: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: zone }).format(new Date(ms));
  const asks: VisitAsk[] = formAsks({ apt: appt, ids: ids.filter((id) => defs.some((d) => d.id === id)), client, forms: defs, rules }).map((a) => {
    const def = defs.find((d) => d.id === a.formId);
    const entry = onFileEntry(client, a.formId); const at = toMs(entry?.signedAt);
    // A form the team waived reads as not needed this time: the team's reason stays with the team.
    const why = a.waived ? CLIENT_WAIVED : !at || here.has(a.formId) ? a.why : a.ask === 'done' ? `Signed ${dayOf(at)} · still current` : a.ask === 'confirm' ? `On file since ${dayOf(at)}` : a.why;
    return { ...a, why, minutes: formMinutes(def), health: isHealthForm(def), since: at ? new Date(at).toISOString() : null };
  });
  // Documents: the ones the request asked for (they're added on the visit link). Done once sent for this visit, or on
  // the client's profile for one that's kept there. One the business marked optional never holds anything up.
  const sent: any[] = Array.isArray(appt?.requirementFiles) ? appt.requirementFiles : [];
  const prof: any[] = Array.isArray(client?.profileDocuments) ? client.profileDocuments : [];
  const reqs: any[] = [...(Array.isArray(o.rec?.fileRequirements) ? o.rec.fileRequirements : [])].filter((r) => r?.id).slice(0, 20);
  const files: VisitFile[] = reqs.map((r) => {
    const cfg = r.file || r;
    const min = Math.max(1, Number(cfg.minCount) || 1);
    const here = sent.some((x) => x?.requirementId === r.id && (x.files || []).length >= min);
    const onFile = !!cfg.persistToProfile && prof.some((d) => d?.requirementId === r.id && (d.files || []).length);
    return { id: String(r.id), label: String(cfg.prompt || r.label || 'A document').slice(0, 120), done: here || onFile, onFile: onFile && !here, ...(r.required === false ? { optional: true } : {}) };
  });
  const left = asks.filter((a) => a.ask === 'sign' || a.ask === 'sign_again').length + files.filter((f) => !f.done && !f.optional).length;
  // Due as the visit's own service has it (a day before, unless it asks for two).
  const main = svcs.find((x: any) => x.id === String(appt?.serviceId || ''));
  const rule = formsRuleOf(main);
  // Said to the client only when the release would really happen (lib/forms-release): never for a booth renter's visit.
  const { releaseOutlook } = await import('./forms-release');
  let release = releaseOutlook({ service: main, appt, formsLeft: asks.filter((a) => a.ask === 'sign' || a.ask === 'sign_again').map((a) => a.formId), pending: o.rec?.status === 'pending', rec: o.rec });
  if (release !== 'off') { const { renterVisit } = await import('./prep-ctx'); if ((await renterVisit(db, tenantId, appt)).renter) release = 'off'; }
  return { asks, files, left, dueAt: formsDueAt(appt?.startTime, appt?.createdAt, rule.dueHours), release, defs };
}

/** Answers keep only the form's own question ids as keys (never empty, never "__…__", which the database keeps for itself). */
export function answersFor(def: any, d: any): Record<string, any> {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const ids = new Set<string>(fieldsOf(def).map((f: any) => String(f?.id || '')).filter(Boolean));
  return Object.fromEntries(Object.entries(d).filter(([k]) => ids.has(k) && /^[A-Za-z0-9_-]{1,80}$/.test(k) && !/^__.*__$/.test(k)).slice(0, 200));
}

type Result = { ok: boolean; error?: string; status?: number; left?: number; done?: boolean; repeat?: boolean };
const TRY_AGAIN: Result = { ok: false, error: 'That didn’t save just now. Please try again in a moment.', status: 503 };

/** One form, sent from the visit link: checked by the same rule as the booking sheet (lib/forms sentFormDone), then kept
 *  on the visit and on file. Returns what's left afterwards, and whether that closed the visit's request. Sending the
 *  same form again for this visit changes nothing. */
export async function saveVisitForm(db: any, tenantId: string, appt: any, apptId: string, token: string, body: any): Promise<Result> {
  const formId = String(body?.formId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(formId)) return { ok: false, error: 'That form isn’t part of this visit.', status: 400 };
  if (ENDED_VISIT.includes(String(appt?.status || ''))) return { ok: false, error: 'This visit isn’t going ahead, so there’s nothing more to send here.', status: 410 };
  let tenant: any, rec: any, state: VisitForms;
  try {
    tenant = (await read(db, T(tenantId))) || {};
    rec = token ? await read(db, `${T(tenantId)}/bookingCompletions/${token}`) : null;
    state = await visitForms(db, tenantId, appt, { tenant, rec });
  } catch (e) { console.error('[forms-visit] read', e); return TRY_AGAIN; }
  const ask = state.asks.find((a) => a.formId === formId);
  const def = state.defs.find((d) => d.id === formId);
  if (!ask || !def) return { ok: false, error: 'That form isn’t part of this visit.', status: 400 };
  // Already signed for this visit: nothing new is written, but anything a slow moment left undone last time is finished
  // now (on file, and closing the request).
  if (signedOnVisit(appt).has(formId)) return { ...(await finishAfter(db, tenantId, appt, apptId, token, formId, tenant, rec)), repeat: true };
  const entry = {
    formId, formTitle: String(def.title || '').slice(0, 200), formData: answersFor(def, body?.formData), signedAt: new Date().toISOString(),
    ...(typeof body?.signedName === 'string' && body.signedName.trim() ? { signedName: body.signedName.trim().slice(0, 120) } : {}),
    ...(body?.acknowledged === true ? { acknowledged: true } : {}),
    ...(body?.guardian && typeof body.guardian === 'object' && body.guardian.confirmed === true && typeof body.guardian.name === 'string' && body.guardian.name.trim() && typeof body.guardian.relationship === 'string' && body.guardian.relationship.trim()
      ? { guardian: { name: body.guardian.name.trim().slice(0, 120), relationship: body.guardian.relationship.trim().slice(0, 80), confirmed: true } } : {}),
    via: 'visit_link',
  };
  if (Buffer.byteLength(JSON.stringify(entry), 'utf8') > 400_000) return { ok: false, error: 'That form is too large to send. Shorten a long answer, or clear the signature and sign it again.', status: 413 };
  if (!sentFormDone(def, entry, formRulesOf(tenant))) return { ok: false, error: 'Please finish the form first.', status: 400 };
  const nowIso = entry.signedAt;
  const aRef = db.doc(`${T(tenantId)}/appointments/${apptId}`);
  // On the visit, read and written together so two forms saved at once both stay: added to what the visit already
  // has; older answers move beside the visit when the record grows large (lib/forms fitOnVisit).
  let list: any[] = [];
  try {
    const wrote = await db.runTransaction(async (tx: any) => {
      const cur: any = ((await tx.get(aRef)).data()) || {};
      if (signedOnVisit(cur).has(formId)) { list = Array.isArray(cur.signedForms) ? cur.signedForms : []; return false; }
      const fit = fitOnVisit([...(Array.isArray(cur.signedForms) ? cur.signedForms : []), entry], 1);
      tx.set(aRef, { signedForms: fit.list }, { merge: true });
      for (const m of fit.moved.slice(0, 100)) tx.set(db.doc(answersPath(tenantId, apptId, String(m.formId))), m);
      list = fit.list; return true;
    });
    if (wrote && appt.clientId) {
      const { recordSignedForms } = await import('./forms-server');
      const batch = db.batch();
      await recordSignedForms(db, tenantId, { clientId: appt.clientId, appointmentId: apptId, source: 'visit_link', at: nowIso, batch, forms: [entry] });
      await batch.commit();
    }
  } catch (e) { console.error('[forms-visit] save', e); return TRY_AGAIN; }
  // What's left now, and closing the request when that was the last thing. A slow moment here doesn't undo the save.
  try {
    const after = await visitForms(db, tenantId, { ...appt, signedForms: list }, { tenant, rec });
    const done = rec ? await closeIfDone(db, tenantId, token, { ...appt, id: apptId, signedForms: list }, rec, after, tenant) : false;
    return { ok: true, left: after.left, done };
  } catch (e) { console.error('[forms-visit] after', e); return { ok: true }; }
}

/** A form already on the visit, sent again (a retry after a slow moment): it goes on file if it isn't there yet for this
 *  visit, and the request closes if that was the last thing. Nothing on the visit changes. */
async function finishAfter(db: any, tenantId: string, appt: any, apptId: string, token: string, formId: string, tenant: any, rec: any): Promise<Result> {
  try {
    const entry = (Array.isArray(appt.signedForms) ? appt.signedForms : []).find((f: any) => f && typeof f === 'object' && f.formId === formId);
    // Not when its answers have moved beside the visit, when a newer signing is already on file, or when the form's
    // wording has changed since it was signed (it would be marked as signing the new words).
    const def = entry && !entry.answersMoved ? await read(db, `${T(tenantId)}/consentForms/${formId}`) : null;
    if (entry && def && appt.clientId && !(toMs(def.versionedAt) > toMs(entry.signedAt))) {
      const c: any = ((await db.doc(`${T(tenantId)}/clients/${appt.clientId}`).get()).data()) || {};
      const onFile = onFileEntry(c, formId);
      if (onFile?.appointmentId !== apptId && !(toMs(onFile?.signedAt) > toMs(entry.signedAt))) {
        const { recordSignedForms } = await import('./forms-server');
        const batch = db.batch();
        await recordSignedForms(db, tenantId, { clientId: appt.clientId, appointmentId: apptId, source: 'visit_link', at: entry.signedAt || new Date().toISOString(), batch, forms: [entry] });
        await batch.commit();
      }
    }
    const after = await visitForms(db, tenantId, appt, { tenant, rec });
    const done = rec ? await closeIfDone(db, tenantId, token, { ...appt, id: apptId }, rec, after, tenant) : false;
    return { ok: true, left: after.left, done };
  } catch (e) { console.error('[forms-visit] finish', e); return TRY_AGAIN; }
}

/** "Nothing's changed": a health form on file stays as it is, confirmed for this visit. */
export async function confirmHealthSame(db: any, tenantId: string, appt: any, apptId: string, token: string, formId: string): Promise<Result> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(formId)) return { ok: false, error: 'That form isn’t part of this visit.', status: 400 };
  if (ENDED_VISIT.includes(String(appt?.status || ''))) return { ok: false, error: 'This visit isn’t going ahead, so there’s nothing more to send here.', status: 410 };
  let state: VisitForms;
  try { const rec = token ? await read(db, `${T(tenantId)}/bookingCompletions/${token}`) : null; state = await visitForms(db, tenantId, appt, { rec }); }
  catch (e) { console.error('[forms-visit] read', e); return TRY_AGAIN; }
  const ask = state.asks.find((a) => a.formId === formId);
  if (!ask || ask.ask !== 'confirm') return { ok: false, error: 'That form doesn’t need checking for this visit.', status: 400 };
  const nowIso = new Date().toISOString();
  const aRef = db.doc(`${T(tenantId)}/appointments/${apptId}`);
  try {
    await db.runTransaction(async (tx: any) => {
      const cur: any = ((await tx.get(aRef)).data()) || {};
      const had: string[] = Array.isArray(cur.healthConfirmed) ? cur.healthConfirmed.map(String) : [];
      tx.set(aRef, { healthConfirmed: [...new Set([...had, formId])].slice(0, 30), healthConfirmedAt: nowIso }, { merge: true });
    });
    // A nested map, so the rest of the client's forms on file stay as they are.
    if (appt.clientId) await db.doc(`${T(tenantId)}/clients/${appt.clientId}`).set({ signedForms: { [formId]: { confirmedAt: nowIso } } }, { merge: true });
  } catch (e) { console.error('[forms-visit] confirm', e); return TRY_AGAIN; }
  return { ok: true };
}

/** The visit's request is closed once nothing is left on it and it asks for nothing more (lib/forms requestAsksMore: a
 *  card or deposit, a policy, an emergency contact and so on still need the visit link's "Send"). Closed once, even with
 *  two saves at the same moment; if they were reminded about it, a thank-you goes out. */
export async function closeIfDone(db: any, tenantId: string, token: string, appt: any, rec: any, state: VisitForms, tenant: any, o: { closedBy?: 'waiver' } = {}): Promise<boolean> {
  // Every listed document too, optional ones included: they're added with the request screen's Send.
  if (!rec || (rec.status && rec.status !== 'pending') || state.left > 0 || state.files.some((f) => !f.done) || requestAsksMore(rec)) return false;
  const nowIso = new Date().toISOString();
  const cRef = db.doc(`${T(tenantId)}/bookingCompletions/${token}`);
  const closed = await db.runTransaction(async (tx: any) => {
    const cur: any = ((await tx.get(cRef)).data()) || {};
    if (cur.status && cur.status !== 'pending') return null;
    // Closed by the team waiving the last form: the client didn't finish anything, so there's no thank-you, and asking
    // for that form again reopens it (closedBy).
    tx.set(cRef, { status: 'complete', completedAt: nowIso, ...(o.closedBy ? { closedBy: o.closedBy } : { formsSignedAt: nowIso }) }, { merge: true });
    tx.set(db.doc(`${T(tenantId)}/appointments/${appt.id}`), { completionStatus: 'completed', requirementsCompletedAt: nowIso }, { merge: true });
    return cur;
  });
  if (!closed) return false;
  if (!o.closedBy && (closed.formsReminderSentAt || appt.formsReminderSentAt)) {
    try { const { sendFormsThanks } = await import('./forms-remind'); await sendFormsThanks(db, tenantId, appt, tenant, closed); } catch (e) { console.error('[forms] thanks', e); }
  }
  return true;
}
