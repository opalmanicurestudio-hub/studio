// src/lib/sop-reminders.ts — SIGN-BY DATES ON SOPs (hourly, from the reminders run; acts from 9am business time).
//   The day before a document's sign-by date (when "Remind them the day before" is on), everyone it's for who hasn't
//   signed this version gets a reminder. Once the date has passed, managers are told who still hasn't, once.
// Each happens once per sign-by date and version (remindedFor / overdueToldFor on the document), so changing the date
// or publishing a new version starts over.
import { teamAlertOn } from '@/lib/team-alerts';
import { docIsFor } from '@/lib/my-work';
import { reviewDue } from '@/lib/doc-collections';
import { dayKey, hourIn, tenantTimeZone, addDays } from '@/lib/tenant-time';

const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

export async function sopReminderSweep(db: any, tenantId: string, tenant: any) {
  const tz = tenantTimeZone(tenant); const now = new Date();
  if (hourIn(now, tz) < 9) return { reminded: 0, told: 0, reviews: 0 };
  const today = dayKey(now, tz); const tomorrow = addDays(today, 1);
  const all = (await db.collection(`tenants/${tenantId}/documents`).where('status', '==', 'published').get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
  // Reviews: the owner (or, with no owner, the managers) is told two weeks before a document's review date, once per date.
  const soon = addDays(today, 14); let reviews = 0;
  for (const d of all) {
    const due = reviewDue(d); if (!due || due > soon || d.reviewToldFor === due) continue;
    const ownerOk = d.ownerId ? (await db.doc(`tenants/${tenantId}/staff/${d.ownerId}`).get().then((x: any) => x.exists && x.data()?.archived !== true).catch(() => false)) : false;
    const to: string[] = ownerOk ? [d.ownerId] : (await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get()).docs.filter((x: any) => x.data()?.archived !== true).map((x: any) => x.id);
    const b = db.batch(); const stamp = new Date().toISOString();
    for (const u of to) { const r = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type: 'document', message: `Action needed: “${d.title || 'A document'}” is due for review ${due <= today ? 'now' : `by ${nice(due)}`}. Please confirm it is still accurate, or update it.`, link: '/documents', documentId: d.id, createdAt: stamp, read: false }); reviews++; }
    b.set(db.doc(`tenants/${tenantId}/documents/${d.id}`), { reviewToldFor: due }, { merge: true }); await b.commit();
  }
  const docs = all.filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(d.signBy || '')));
  if (!docs.length) return { reminded: 0, told: 0, reviews };
  const staff = (await db.collection(`tenants/${tenantId}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((s: any) => s.archived !== true && s.role !== 'renter' && !s.isRenter);
  const tenantDoc: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const managers = staff.filter((s: any) => ['owner', 'admin', 'manager'].includes(String(s.role))).map((s: any) => s.id);
  let reminded = 0, told = 0; const stamp = new Date().toISOString();
  for (const d of docs) {
    const key = `${d.signBy}:${d.version || 1}`;
    const due = d.remindBefore !== false && d.signBy === tomorrow && d.remindedFor !== key;
    const late = d.signBy < today && d.overdueToldFor !== key;
    if (!due && !late) continue;
    const forThem = staff.filter((s: any) => docIsFor(d, { id: s.id, role: s.role }));
    const acks = await Promise.all(forThem.map((s: any) => db.doc(`tenants/${tenantId}/documents/${d.id}/acks/${s.id}`).get().then((x: any) => (x.exists ? x.data() : null)).catch(() => null)));
    const missing = forThem.filter((_: any, i: number) => !(acks[i] && Number(acks[i].version) === Number(d.version || 1)));
    const b = db.batch(); const title = String(d.title || 'a document');
    if (due) {
      for (const s of missing) { const r = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(r, { id: r.id, userId: s.id, type: 'document', message: `Action needed: Please read and sign “${title}” by tomorrow.`, link: 'documents', documentId: d.id, createdAt: stamp, read: false }); reminded++; }
      b.set(db.doc(`tenants/${tenantId}/documents/${d.id}`), { remindedFor: key }, { merge: true });
    }
    if (late) {
      if (missing.length && teamAlertOn(tenantDoc, 'documents')) for (const m of managers) { const r = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(r, { id: r.id, userId: m, type: 'document', message: `${missing.length} ${missing.length === 1 ? 'person has not' : 'people have not'} yet signed “${title}” (due ${nice(d.signBy)}): ${missing.slice(0, 4).map((s: any) => String(s.name || '').split(' ')[0]).join(', ')}${missing.length > 4 ? '…' : ''}.`, link: '/documents', documentId: d.id, createdAt: stamp, read: false }); told++; }
      b.set(db.doc(`tenants/${tenantId}/documents/${d.id}`), { overdueToldFor: key }, { merge: true });
    }
    await b.commit();
  }
  return { reminded, told, reviews };
}
