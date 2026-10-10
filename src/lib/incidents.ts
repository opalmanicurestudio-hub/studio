// src/lib/incidents.ts — SOMETHING HAPPENED DURING A VISIT, reported by the provider from the staff app, tied to the
// booking it happened in:
//   • injury / reaction / client unwell / equipment or product → a Making it right case marked as an incident, with the
//     provider's own words (or voice note, translated) as their signed statement, the station and the kit; managers told
//     straight away for anything to do with someone's health;
//   • "I need a few minutes" adds the time to the visit, so the running-late alerts tell the next clients and providers;
//   • the kit in use is pulled out of service until a manager puts it back;
//   • client behaviour → a CONDUCT REPORT (tenants/{t}/conductReports), never seen by the client; a manager decides what
//     happens next (a note on their profile, a deposit for future bookings, a manager on site, or not booking them with
//     this provider again).
import { FieldValue } from 'firebase-admin/firestore';
import type { RequestActor } from '@/lib/request-actor';
import { openCase } from '@/lib/cases';
import { settingsOf } from '@/lib/making-it-right';
import { moveKit, type Kit } from '@/lib/kits';

const T = (t: string) => `tenants/${t}`;
const now = () => new Date().toISOString();
const MANAGERS = ['owner', 'admin', 'manager'];
export const INCIDENT_TYPES = {
  injury: { label: 'Injury — a cut, burn or wound', safety: true, match: /cut|burn|wound|injur|pain/i },
  reaction: { label: 'Reaction to a product', safety: true, match: /reaction|allerg/i },
  unwell: { label: 'Client felt unwell', safety: true, match: /unwell|faint|ill/i },
  equipment: { label: 'Equipment or product problem', safety: false, match: /equipment|product/i },
  behaviour: { label: 'Client behaviour', safety: false, match: /$^/ },
} as const;
export type IncidentType = keyof typeof INCIDENT_TYPES;

async function translateEn(tenantId: string, texts: string[], lang: string) {
  if (lang === 'en') return texts.map(() => null);
  try { const { translateTexts } = await import('@/lib/translate'); const out = await translateTexts(tenantId, texts, 'en'); return out.map((x, i) => (texts[i] && x !== texts[i] ? x : null)); } catch { return texts.map(() => null); }
}

export async function reportIncident(db: any, tenantId: string, actor: RequestActor, b: any) {
  const type = (Object.keys(INCIDENT_TYPES).includes(b.type) ? b.type : '') as IncidentType; if (!type) return { ok: false as const, error: 'Pick what happened.' };
  const aid = String(b.appointmentId || ''); const aRef = db.doc(`${T(tenantId)}/appointments/${aid}`); const aSnap = await aRef.get();
  if (!aSnap.exists) return { ok: false as const, error: 'That visit wasn’t found.' }; const a: any = aSnap.data() || {};
  const mine = a.staffId === actor.staffId || (Array.isArray(a.assignedStaffIds) && a.assignedStaffIds.includes(actor.staffId));
  if (!mine && !actor.isManager && actor.role !== 'front_desk') return { ok: false as const, error: 'You can report things on your own visits.' };
  const words = String(b.words || '').trim().slice(0, 2000); const lang = String(b.lang || 'en').slice(0, 2).toLowerCase();
  const voice = b.voice && /^https:\/\//.test(String(b.voice.url || '')) ? { url: String(b.voice.url), transcript: b.voice.transcript ? String(b.voice.transcript).slice(0, 4000) : null, language: lang, seconds: Number(b.voice.seconds) || null, translation: null as string | null } : null;
  if (!words && !voice) return { ok: false as const, error: 'Say what happened — type it or record it.' };
  const [wordsEn, tEn] = await translateEn(tenantId, [words, voice?.transcript || ''], lang); if (voice && tEn) voice.translation = tEn;
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {};
  const staff = (await db.collection(`${T(tenantId)}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true);
  const mgrs = [...staff.filter((s: any) => MANAGERS.includes(String(s.role))).map((s: any) => s.id), tenant.userId].filter(Boolean) as string[];
  const out: any = { ok: true as const };

  // More time: the visit runs longer, so the running-late alerts reach the next clients and providers.
  const extra = Math.max(0, Math.min(60, Math.round(Number(b.extraMinutes) || 0)));
  if (extra) await aRef.set({ clientExtraMinutes: (Number(a.clientExtraMinutes) || 0) + extra, timeline: FieldValue.arrayUnion({ at: now(), by: actor.name, text: `Paused for ${extra} min (${INCIDENT_TYPES[type].label.toLowerCase()})`, public: false }) }, { merge: true });

  if (type === 'behaviour') {
    const r = db.collection(`${T(tenantId)}/conductReports`).doc();
    await r.set({ id: r.id, clientId: a.clientId || null, clientName: a.clientName || 'Client', appointmentId: aid, serviceName: a.serviceName || null, staffId: actor.staffId, staffName: actor.name,
      words, wordsEn, lang: lang !== 'en' ? lang : null, voice, stopped: !!b.stopped, status: 'open', decision: null, createdAt: now() });
    const bt = db.batch(); for (const u of [...new Set(mgrs)]) { const n = db.collection(`${T(tenantId)}/notifications`).doc(); bt.set(n, { id: n.id, userId: u, type: 'conduct_report', message: `${actor.name.split(' ')[0]} reported ${a.clientName || 'a client'}’s behaviour${b.stopped ? ' and stopped the service' : ''}. A manager should look now.`, link: `/cases?conduct=${r.id}`, createdAt: now(), read: false }); } await bt.commit();
    return { ...out, conductId: r.id };
  }

  // The kit in use comes out of service.
  let kitLine: string | null = null;
  if (b.pullKit !== false && INCIDENT_TYPES[type].safety || b.pullKit === true) {
    const kits = (await db.collection(`${T(tenantId)}/kits`).where('visitId', '==', aid).get()).docs.filter((d: any) => (d.data() || {}).status === 'in_use');
    for (const d of kits) { const k = { id: d.id, ...(d.data() || {}) } as Kit; const r = moveKit(k, 'out', { name: actor.name, manager: actor.isManager }, { note: `Incident during ${a.clientName || 'a visit'}: ${INCIDENT_TYPES[type].label}` });
      if (!('error' in r)) { await d.ref.set(r.patch, { merge: true }); kitLine = `${k.name} ${k.code}`; } }
    out.kit = kitLine;
  }

  const S = settingsOf(tenant); const T0 = INCIDENT_TYPES[type];
  const reason = S.reasons.find((r) => r.on !== false && !!r.safety === T0.safety && T0.match.test(r.label)) || null;
  const statement = { by: actor.name, staffId: actor.staffId, text: words, textEn: wordsEn, lang: lang !== 'en' ? lang : null, voice, at: now(), signed: true };
  const r = await openCase(db, tenantId, actor, { via: 'staff', appointmentId: aid, clientId: a.clientId || '', clientName: a.clientName || '', reasonId: reason?.id || '', reasonOverride: reason ? null : { id: type, label: T0.label, safety: T0.safety },
    words, wordsEn, wordsLang: lang !== 'en' ? lang : null, kind: 'incident', incidentType: type, statements: [statement], providerAction: extra ? `Paused ${extra} min` : null });
  if (!r.ok) return r;
  const patch: any = { 'incident.where': a.stationName || a.station || null, 'incident.kit': kitLine, 'incident.duringStatus': a.status || null, 'incident.reportedAt': now() };
  if (T0.safety) await db.doc(`${T(tenantId)}/cases/${r.id}`).update(patch).catch(() => {});
  else await db.doc(`${T(tenantId)}/cases/${r.id}`).set({ incident: { where: patch['incident.where'], kit: kitLine, duringStatus: a.status || null, reportedAt: now(), present: [], statements: [] }, needsManager: true }, { merge: true });
  if (!T0.safety) { const bt = db.batch(); for (const u of [...new Set(mgrs)]) { const n = db.collection(`${T(tenantId)}/notifications`).doc(); bt.set(n, { id: n.id, userId: u, type: 'case_new', message: `${actor.name.split(' ')[0]} reported ${T0.label.toLowerCase()} during ${a.clientName || 'a visit'}.`, link: `/cases?id=${r.id}`, caseId: r.id, createdAt: now(), read: false }); } await bt.commit(); }
  return { ...out, caseId: r.id, number: r.number };
}

/** A manager decides on a conduct report. */
export async function decideConduct(db: any, tenantId: string, actor: RequestActor, b: any) {
  if (!actor.isManager) return { ok: false as const, error: 'A manager decides this.' };
  const ref = db.doc(`${T(tenantId)}/conductReports/${String(b.id || '')}`); const s = await ref.get(); if (!s.exists) return { ok: false as const, error: 'Not found.' };
  const c: any = s.data(); const acts: string[] = (Array.isArray(b.actions) ? b.actions : []).map(String).filter((x: string) => ['note', 'deposit', 'manager_present', 'not_with_provider', 'none'].includes(x));
  const note = String(b.note || '').trim().slice(0, 1000);
  if (c.clientId && acts.some((x) => x !== 'none')) {
    const cRef = db.doc(`${T(tenantId)}/clients/${c.clientId}`); const patch: any = { updatedAt: now() };
    if (acts.includes('deposit')) patch.requireDeposit = true;
    if (acts.includes('manager_present')) patch.managerPresent = true;
    if (acts.includes('not_with_provider') && c.staffId) patch.excludedStaffIds = FieldValue.arrayUnion(c.staffId);
    if (acts.includes('note') || acts.includes('manager_present')) { const cur: any = (await cRef.get()).data() || {}; const line = acts.includes('manager_present') ? `A manager should be on site for this client’s visits.${note ? ` ${note}` : ''}` : note;
      if (line) patch.alertNote = [line, cur.alertNote].filter(Boolean).join(' · ').slice(0, 500); }
    await cRef.set(patch, { merge: true });
  }
  await ref.set({ status: 'decided', decision: { actions: acts, note: note || null, by: actor.name, at: now() } }, { merge: true });
  if (c.staffId) { const n = db.collection(`${T(tenantId)}/notifications`).doc(); await n.set({ id: n.id, userId: c.staffId, type: 'conduct_report', message: `A manager looked at your report about ${c.clientName}${acts.includes('not_with_provider') ? ' — they won’t be booked with you again' : ''}.`, createdAt: now(), read: false }); }
  return { ok: true as const };
}
