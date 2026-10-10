// src/lib/case-nudges.ts — MAKING IT RIGHT reminders, run with the every-few-minutes cron: a case past its reply time
// with no reply (told once: the owner, or managers when nobody owns it), and a finished fix due its check-back (told
// once: the owner). Safety cases with no 48-hour check-in by then are flagged to managers.
const T = (t: string) => `tenants/${t}`;
const MANAGERS = ['owner', 'admin', 'manager'];

export async function caseNudges(db: any, tenantId: string, tenant: any, nowMs = Date.now()) {
  const open = (await db.collection(`${T(tenantId)}/cases`).where('locked', '==', false).get()).docs;
  if (!open.length) return 0;
  const staff = (await db.collection(`${T(tenantId)}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true);
  const mgrs = [...staff.filter((s: any) => MANAGERS.includes(String(s.role))).map((s: any) => s.id), tenant?.userId].filter(Boolean) as string[];
  let n = 0; const at = new Date(nowMs).toISOString();
  const tell = async (ids: string[], type: string, message: string, caseId: string) => { const b = db.batch(); for (const u of [...new Set(ids)]) { const r = db.collection(`${T(tenantId)}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type, message, link: `/cases?id=${caseId}`, caseId, createdAt: at, read: false }); } await b.commit(); n++; };
  for (const d of open) {
    const c: any = d.data(); const who = c.ownerId ? [c.ownerId] : mgrs;
    if (!c.firstReplyAt && c.replyDueAt && Date.parse(c.replyDueAt) < nowMs && !c.lateTold) {
      await tell(who, 'case_late', `${c.clientName} is still waiting for a reply (${c.reasonLabel}).`, d.id); await d.ref.set({ lateTold: at }, { merge: true });
    }
    if (c.status === 'done' && c.followUpAt && Date.parse(c.followUpAt) < nowMs && !c.checkBackTold) {
      await tell(who, 'case_check_back', `Time to check back with ${c.clientName}: did we make it right?`, d.id); await d.ref.set({ checkBackTold: at }, { merge: true });
    }
    if (c.safety && !c.incident?.checkIn48At && c.createdAt && Date.parse(c.createdAt) + 48 * 3600000 < nowMs && !c.checkInTold) {
      await tell(mgrs, 'case_safety', `48-hour check-in due for ${c.clientName} (${c.reasonLabel}).`, d.id); await d.ref.set({ checkInTold: at }, { merge: true });
    }
  }
  return n;
}
