// src/lib/cases.ts — A "MAKING IT RIGHT" CASE (tenants/{t}/cases/{id}): one complaint from a client, from the moment
// it's heard to the check-back. Server-only writes (/api/cases). Stages: heard → owned → fix_chosen → done →
// checked_back (then closed and locked). Every action adds a dated line to the case's timeline, so the case record
// (lib/case-pdf) can show who did what and when. Safety reasons go straight to managers and nothing is offered
// automatically. Fair-use checks (lib/making-it-right) run when the case opens and again when a fix is chosen.
import { FieldValue } from 'firebase-admin/firestore';
import type { RequestActor } from '@/lib/request-actor';
import { settingsOf, fairUseChecks, canDecide, FIX_LABEL, type FixKind } from '@/lib/making-it-right';

const now = () => new Date().toISOString();
const T = (t: string) => `tenants/${t}`;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const line = (by: string, text: string) => ({ at: now(), by, text });
const MANAGERS = ['owner', 'admin', 'manager'];

async function tell(db: any, tenantId: string, ids: string[], type: string, message: string, caseId: string) {
  const b = db.batch(); for (const u of [...new Set(ids.filter(Boolean))]) { const r = db.collection(`${T(tenantId)}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type, message, link: `/cases?id=${caseId}`, caseId, createdAt: now(), read: false }); } await b.commit();
}
async function staffList(db: any, tenantId: string) { return (await db.collection(`${T(tenantId)}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true); }

/** The visit a case is about, summed up for the case (what was paid, the tip, products used). */
async function visitOf(db: any, tenantId: string, appointmentId: string, staff: any[]) {
  if (!appointmentId) return null;
  const s = await db.doc(`${T(tenantId)}/appointments/${appointmentId}`).get(); if (!s.exists) return null; const a: any = s.data() || {};
  const tx = (await db.collection(`${T(tenantId)}/transactions`).where('appointmentId', '==', appointmentId).get()).docs.map((d: any) => d.data() || {}).filter((t: any) => t.voided !== true);
  const paid = tx.filter((t: any) => (t.type || 'income') === 'income' && t.category === 'Service Revenue').reduce((x: number, t: any) => x + (Number(t.amount) || 0), 0);
  const tip = tx.filter((t: any) => (t.type || 'income') === 'income' && (t.category === 'Tips' || t.tipAmount)).reduce((x: number, t: any) => x + (Number(t.tipAmount || t.amount) || 0), 0);
  const card = tx.find((t: any) => t.cardLast4 || t.last4); const provider = staff.find((m: any) => m.id === a.staffId);
  const products = (a.checkoutState?.formula || []).map((f: any) => [f.name, f.batch || f.lot].filter(Boolean).join(' batch ')).filter(Boolean).slice(0, 6);
  return { appointmentId, startTime: a.startTime || null, serviceId: a.serviceId || null, serviceName: a.serviceName || null, providerId: a.staffId || null, providerName: provider?.name || a.staffName || null,
    paid: Math.round(paid * 100) / 100, tip: Math.round(tip * 100) / 100, cardLast4: card ? String(card.cardLast4 || card.last4) : null, products, station: a.stationName || null, clientId: a.clientId || null, clientName: a.clientName || null, discounted: Number(a.checkoutState?.discountTotal || a.discountTotal || 0) > 0 };
}

function voiceOf(v: any) {
  if (!v || !/^https:\/\//.test(String(v.url || ''))) return null;
  return { url: String(v.url), transcript: v.transcript ? String(v.transcript).slice(0, 4000) : null, language: v.language ? String(v.language).slice(0, 12) : null, translation: v.translation ? String(v.translation).slice(0, 4000) : null, seconds: Math.min(300, Number(v.seconds) || 0) || null };
}

async function nextNumber(db: any, tenantId: string) {
  const ref = db.doc(`${T(tenantId)}/counters/cases`); const y = new Date().getFullYear();
  const n = await db.runTransaction(async (tx: any) => { const c: any = (await tx.get(ref)).data() || {}; const v = c.year === y ? (Number(c.n) || 0) + 1 : 1; tx.set(ref, { year: y, n: v }); return v; });
  return `MIR-${y}-${String(n).padStart(4, '0')}`;
}

export async function openCase(db: any, tenantId: string, actor: RequestActor, b: any) {
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const S = settingsOf(tenant);
  const staff = await staffList(db, tenantId); const me = staff.find((s: any) => s.id === actor.staffId);
  const visit = await visitOf(db, tenantId, String(b.appointmentId || ''), staff);
  const reason = S.reasons.find((x) => x.id === b.reasonId) || null;
  if (!reason && !String(b.words || '').trim()) return { ok: false as const, error: 'Pick what went wrong, or write what they said.' };
  const clientId = String(b.clientId || visit?.clientId || ''); const clientName = String(b.clientName || visit?.clientName || '').slice(0, 120) || 'Client';
  const prior = clientId ? (await db.collection(`${T(tenantId)}/cases`).where('clientId', '==', clientId).get()).docs.map((d: any) => d.data() || {}) : [];
  const priorFixes = prior.filter((c: any) => c.fix && c.fix.kind !== 'note').map((c: any) => ({ at: c.fix.at || c.createdAt }));
  const photos: string[] = (Array.isArray(b.photos) ? b.photos : []).map(String).filter((u: string) => /^https:\/\//.test(u)).slice(0, 8);
  const checks = fairUseChecks({ settings: S, visit, reason, photos: photos.length, priorFixes, wants: b.wants, afterDiscount: prior.filter((c: any) => c.visit?.discounted).length + (visit?.discounted ? 1 : 0) });
  const via = ['call', 'staff', 'desk', 'survey', 'link'].includes(b.via) ? b.via : 'desk';
  const ownerId = (via === 'call' || via === 'desk') && !reason?.safety ? actor.staffId : null;
  const id = db.collection(`${T(tenantId)}/cases`).doc().id; const number = await nextNumber(db, tenantId);
  const doc: any = {
    id, number, clientId: clientId || null, clientName, visit, reasonId: reason?.id || 'other', reasonLabel: reason?.label || 'Something else', safety: !!reason?.safety,
    via, words: String(b.words || '').trim().slice(0, 2000), wordsEn: b.wordsEn ? String(b.wordsEn).slice(0, 2000) : null, wordsLang: b.wordsLang ? String(b.wordsLang).slice(0, 12) : null, photos, voice: voiceOf(b.voice), statusPath: b.statusPath ? String(b.statusPath).slice(0, 300) : null, wants: ['fix', 'talk', 'refund'].includes(b.wants) ? b.wants : null,
    reportedBy: { id: actor.staffId, name: actor.name }, providerAction: via === 'staff' ? String(b.providerAction || '').slice(0, 40) || null : null,
    ownerId, ownerName: ownerId ? actor.name : null, status: ownerId ? 'owned' : 'heard', checks, needsManager: !!reason?.safety || checks.some((c) => !c.ok),
    replyDueAt: new Date(Date.now() + S.replyHours * 3600000).toISOString(), fix: null, pending: null,
    timeline: [line(actor.name, `Case opened (${({ call: 'phone call', staff: 'reported by the provider', desk: 'at the desk', survey: '“How was your visit?”', link: 'their visit link' } as any)[via]}): ${reason?.label || 'something else'}${b.words ? ` — “${String(b.words).slice(0, 200)}”` : ''}`),
      ...(ownerId ? [line(actor.name, `${actor.name} took ownership`)] : [])],
    incident: reason?.safety ? { started: now(), whatHappened: String(b.words || ''), present: [], statements: [], checkIn48At: null } : null,
    createdAt: now(), updatedAt: now(), locked: false,
  };
  await db.doc(`${T(tenantId)}/cases/${id}`).set(JSON.parse(JSON.stringify(doc)));
  const mgrs = [...staff.filter((s: any) => MANAGERS.includes(String(s.role))).map((s: any) => s.id), tenant.userId].filter(Boolean); const desk = staff.filter((s: any) => s.role === 'front_desk').map((s: any) => s.id);
  if (doc.safety) await tell(db, tenantId, mgrs, 'case_safety', `Safety: ${clientName} — ${doc.reasonLabel}. A manager is needed now.`, id);
  else await tell(db, tenantId, [...mgrs, ...desk].filter((x) => x !== actor.staffId), 'case_new', `${clientName} isn’t happy: ${doc.reasonLabel}${visit?.providerName ? ` (${visit.providerName.split(' ')[0]})` : ''}.`, id);
  if (visit?.providerId && visit.providerId !== actor.staffId && !doc.safety) await tell(db, tenantId, [visit.providerId], 'case_yours', `${clientName} wasn’t happy with their visit: ${doc.reasonLabel}. The desk will be in touch.`, id);
  return { ok: true as const, id, number };
}

/** Text the client (with their case page link). Best-effort: false when there's no phone or texting isn't set up. */
async function textClient(db: any, tenantId: string, tenant: any, c: any, body: string): Promise<boolean> {
  try {
    const { sendTenantSms, smsConfigured } = await import('@/lib/sms'); if (!smsConfigured()) return false;
    let phone = ''; let email = '';
    if (c.clientId) { const cl: any = (await db.doc(`${T(tenantId)}/clients/${c.clientId}`).get()).data() || {}; phone = cl.phone || cl.phoneNumber || ''; email = cl.email || ''; }
    if (!phone && c.visit?.appointmentId) { const a: any = (await db.doc(`${T(tenantId)}/appointments/${c.visit.appointmentId}`).get()).data() || {}; phone = a.clientPhone || ''; email = email || a.clientEmail || ''; }
    if (!phone && !email) return false;
    const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, '');
    const link = c.statusPath && base ? ` ${base}${c.statusPath}` : '';
    const r = await sendTenantSms(db, tenantId, phone || '', `${body}${link}`, { email, subject: `About your visit` }, { kind: 'case_reply', recipientType: 'client', recipientId: c.clientId || null, recipientName: c.clientName || null, appointmentId: c.visit?.appointmentId || null });
    return !!r.ok;
  } catch { return false; }
}

/** The client answers "Did we make it right?" from their case page. Yes closes it; no reopens it for the owner. */
export async function clientConfirm(db: any, tenantId: string, caseId: string, good: boolean, words: string) {
  const ref = db.doc(`${T(tenantId)}/cases/${caseId}`); const snap = await ref.get(); if (!snap.exists) return { ok: false as const, error: 'Not found.' };
  const c: any = snap.data(); if (c.locked) return { ok: true as const };
  if (c.status !== 'done') return { ok: false as const, error: 'We’re still working on this one.' };
  const text = String(words || '').trim().slice(0, 1000); const by = c.clientName || 'Client';
  if (good && !c.safety) { await ref.set({ status: 'closed', checkedBackAt: now(), closedAt: now(), locked: true, closedBy: by, clientConfirmed: true, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Client confirmed it’s made right${text ? ` — “${text}”` : ''}. Case closed.`)) }, { merge: true }); return { ok: true as const }; }
  if (good) { await ref.set({ clientConfirmed: true, updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Client says they’re happy${text ? ` — “${text}”` : ''}. A manager closes safety cases.`)) }, { merge: true }); return { ok: true as const }; }
  await ref.set({ status: 'owned', reopenedAt: now(), updatedAt: now(), timeline: FieldValue.arrayUnion(line(by, `Client says it’s still not right${text ? ` — “${text}”` : ''}. Reopened.`)) }, { merge: true });
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {};
  const staff = await staffList(db, tenantId); const to = c.ownerId ? [c.ownerId] : [...staff.filter((s: any) => MANAGERS.includes(String(s.role))).map((s: any) => s.id), tenant.userId];
  await tell(db, tenantId, to, 'case_reopened', `${c.clientName} says it’s still not right. The case is open again.`, caseId);
  return { ok: true as const };
}

export async function actOnCase(db: any, tenantId: string, actor: RequestActor, b: any) {
  const ref = db.doc(`${T(tenantId)}/cases/${String(b.id || '')}`); const snap = await ref.get();
  if (!snap.exists) return { ok: false as const, error: 'That case wasn’t found.' };
  const c: any = snap.data(); const action = String(b.action || ''); const text = String(b.note || b.text || '').trim().slice(0, 2000);
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const S = settingsOf(tenant);
  if (c.locked && action !== 'addendum') return { ok: false as const, error: 'This case is closed. Add a dated note instead.' };
  const isProvider = c.visit?.providerId === actor.staffId;
  const desk = actor.isManager || ['front_desk', 'owner', 'admin', 'manager'].includes(actor.role);
  const push = (patch: any, msg: string) => ref.set({ ...patch, updatedAt: now(), timeline: FieldValue.arrayUnion(line(actor.name, msg)) }, { merge: true });
  const staff = await staffList(db, tenantId); const mgrs = [...staff.filter((s: any) => MANAGERS.includes(String(s.role))).map((s: any) => s.id), tenant.userId].filter(Boolean);

  switch (action) {
    case 'own': if (!desk) return { ok: false as const, error: 'The desk or a manager takes ownership.' }; if (c.safety && !actor.isManager) return { ok: false as const, error: 'A manager owns safety cases.' };
      await push({ ownerId: actor.staffId, ownerName: actor.name, status: c.status === 'heard' ? 'owned' : c.status }, `${actor.name} took ownership`); return { ok: true as const };
    case 'note': if (!text) return { ok: false as const, error: 'Write the note.' }; await push({}, `Note: ${text}`); return { ok: true as const };
    case 'message': if (!text) return { ok: false as const, error: 'Write the message.' };
      { const sent = await textClient(db, tenantId, tenant, c, `${actor.name.split(' ')[0]}: ${text}`);
        await push({ messages: FieldValue.arrayUnion({ at: now(), by: actor.name, text, to: 'client', sent }), firstReplyAt: c.firstReplyAt || now() }, `${sent ? 'Texted' : 'Replied to'} the client: “${text.slice(0, 160)}”`); return { ok: true as const, sent }; }
    case 'choose_fix': case 'approve': {
      const p = action === 'approve' ? c.pending : b; if (!p) return { ok: false as const, error: 'Nothing waiting for approval.' };
      const kind = String(p.kind) as FixKind; if (!FIX_LABEL[kind]) return { ok: false as const, error: 'Choose a fix.' };
      const amountCents = Math.max(0, Math.round(Number(p.amountCents) || 0));
      if (action === 'approve' && !actor.isManager) return { ok: false as const, error: 'Only a manager can approve this.' };
      if (action === 'choose_fix' && !desk && !isProvider) return { ok: false as const, error: 'You can’t choose the fix for this case.' };
      if (c.safety && !actor.isManager) return { ok: false as const, error: 'A manager decides the fix for safety cases.' };
      const ok = action === 'approve' ? { ok: true } : canDecide(S, { isManager: actor.isManager, role: actor.role, isProvider: isProvider && !desk }, { kind, amountCents }, c.checks || []);
      if (!ok.ok) {
        await push({ pending: { kind, amountCents, redo: p.redo || null, askedBy: actor.name, at: now(), why: (ok as any).why }, needsManager: true }, `Asked a manager to approve: ${FIX_LABEL[kind]}${amountCents ? ` ${money(amountCents)}` : ''} (${(ok as any).why})`);
        await tell(db, tenantId, mgrs.filter((x: string) => x !== actor.staffId), 'case_approval', `${c.clientName}: ${actor.name.split(' ')[0]} wants to give ${FIX_LABEL[kind].toLowerCase()}${amountCents ? ` (${money(amountCents)})` : ''} — needs your OK.`, c.id);
        return { ok: true as const, pending: true, why: (ok as any).why };
      }
      let redoId: string | null = null;
      if (kind === 'redo' && p.redo?.startTime && c.visit?.serviceId) {
        const start = new Date(String(p.redo.startTime)); const mins = Math.max(15, Math.min(240, Number(p.redo.minutes) || 30));
        if (!Number.isFinite(start.getTime())) return { ok: false as const, error: 'Pick a time for the redo.' };
        const prov = staff.find((s: any) => s.id === (p.redo.staffId || c.visit.providerId));
        const r = db.collection(`${T(tenantId)}/appointments`).doc(); redoId = r.id;
        await r.set({ id: r.id, clientId: c.clientId, clientName: c.clientName, serviceId: c.visit.serviceId, serviceName: `Redo: ${c.visit.serviceName || 'service'}`, staffId: prov?.id || c.visit.providerId, staffName: prov?.name || c.visit.providerName,
          startTime: start.toISOString(), endTime: new Date(start.getTime() + mins * 60000).toISOString(), duration: mins, price: 0, status: 'confirmed', isRedo: true, redoOf: c.visit.appointmentId, caseId: c.id, source: 'making_it_right', createdAt: now(), notes: `Free redo — ${c.reasonLabel}${c.words ? `: “${c.words.slice(0, 140)}”` : ''}` });
      }
      const fix = { kind, label: FIX_LABEL[kind], amountCents, redoAppointmentId: redoId, by: action === 'approve' ? c.pending?.askedBy : actor.name, approvedBy: action === 'approve' || actor.isManager ? actor.name : null, at: now(),
        todo: kind === 'refund' ? `Refund ${money(amountCents)} to the card${c.visit?.cardLast4 ? ` ending ${c.visit.cardLast4}` : ''} in Money` : kind === 'credit' ? `Add ${money(amountCents)} credit to ${c.clientName}’s account` : null };
      await push({ fix, pending: null, status: kind === 'note' ? 'done' : 'fix_chosen', ownerId: c.ownerId || actor.staffId, ownerName: c.ownerName || actor.name },
        `${action === 'approve' ? `${actor.name} approved: ` : 'Fix chosen: '}${FIX_LABEL[kind]}${amountCents ? ` ${money(amountCents)}` : ''}${redoId ? ` — booked ${new Date(String(p.redo.startTime)).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || 'America/New_York' })}` : ''}`);
      if (redoId && c.visit?.providerId) await tell(db, tenantId, [p.redo?.staffId || c.visit.providerId], 'case_redo', `Free redo booked for ${c.clientName} — ${c.reasonLabel}.`, c.id);
      return { ok: true as const, redoId };
    }
    case 'done': if (!desk && !isProvider) return { ok: false as const, error: 'You can’t mark this done.' };
      await push({ status: 'done', doneAt: now(), followUpAt: new Date(Date.now() + S.followUpDays * 86400000).toISOString() }, `Marked done${text ? `: ${text}` : ''}${c.fix?.todo ? ` (${c.fix.todo} — done)` : ''}`); return { ok: true as const };
    case 'checked_back': { if (!desk) return { ok: false as const, error: 'The desk or a manager records this.' }; const good = b.answer !== 'no';
      if (!good) { await push({ status: 'owned', reopenedAt: now() }, `Checked back: still not right${text ? ` — “${text}”` : ''}. Reopened.`); if (c.ownerId) await tell(db, tenantId, [c.ownerId], 'case_reopened', `${c.clientName} says it’s still not right. The case is open again.`, c.id); return { ok: true as const }; }
      if (c.safety && !c.incident?.checkIn48At) return { ok: false as const, error: 'Record the 48-hour check-in first.' };
      await push({ status: 'closed', checkedBackAt: now(), closedAt: now(), locked: true, closedBy: actor.name }, `Checked back: all good. Case closed by ${actor.name}.`); return { ok: true as const }; }
    case 'close': if (!actor.isManager && !desk) return { ok: false as const, error: 'The desk or a manager closes cases.' };
      if (c.safety && !actor.isManager) return { ok: false as const, error: 'A manager closes safety cases.' };
      await push({ status: 'closed', closedAt: now(), locked: true, closedBy: actor.name }, `Closed by ${actor.name}${text ? `: ${text}` : ''}`); return { ok: true as const };
    case 'incident': if (!actor.isManager) return { ok: false as const, error: 'A manager fills in the incident report.' };
      { const i = b.incident || {}; const patch: any = {}; for (const k of ['whatHappened', 'where', 'firstAid', 'kit', 'cycle', 'advice']) if (i[k] != null) patch[`incident.${k}`] = String(i[k]).slice(0, 2000);
        if (Array.isArray(i.present)) patch['incident.present'] = i.present.map(String).slice(0, 10);
        if (i.checkIn48) patch['incident.checkIn48At'] = now(), patch['incident.checkIn48Note'] = String(i.checkIn48Note || '').slice(0, 1000);
        if (i.signOff) patch['incident.signedOffBy'] = actor.name, patch['incident.signedOffAt'] = now();
        await ref.update({ ...patch, updatedAt: now(), timeline: FieldValue.arrayUnion(line(actor.name, i.checkIn48 ? `48-hour check-in: ${i.checkIn48Note || 'done'}` : i.signOff ? 'Signed off the incident report' : 'Updated the incident report')) }); return { ok: true as const }; }
    case 'statement': if (!text) return { ok: false as const, error: 'Write your account.' };
      await ref.update({ 'incident.statements': FieldValue.arrayUnion({ by: actor.name, staffId: actor.staffId, text, at: now(), signed: true }), updatedAt: now(), timeline: FieldValue.arrayUnion(line(actor.name, `${actor.name} gave a signed statement`)) }); return { ok: true as const };
    case 'addendum': if (!text) return { ok: false as const, error: 'Write the note.' };
      await ref.update({ addenda: FieldValue.arrayUnion({ by: actor.name, text, at: now() }), updatedAt: now() }); return { ok: true as const };
  }
  return { ok: false as const, error: 'Unknown action.' };
}
