// src/lib/mir-report-server.ts — On the 1st of each month (business time), tell the owner and managers that last
// month's Making it right report is ready, with the headline numbers. Once per month (tenant.mirReportSentFor).
import { monthReport, monthOf, monthLabel, prevMonth, fmtMoney } from '@/lib/mir-report';

export async function monthlyReportNotice(db: any, tenantId: string, tenant: any) {
  const tz = tenant?.timezone || 'America/New_York'; const today = monthOf(new Date().toISOString(), tz);
  const dayNum = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(new Date()));
  const last = prevMonth(today); if (dayNum > 3 || tenant?.mirReportSentFor === last) return false;
  const cases = (await db.collection(`tenants/${tenantId}/cases`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const r = monthReport(cases, last, tz);
  await db.doc(`tenants/${tenantId}`).set({ mirReportSentFor: last }, { merge: true });
  if (!r.total && !r.incidents) return false;
  const staff = (await db.collection(`tenants/${tenantId}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const to = [...new Set([tenant.userId, ...staff.filter((s: any) => ['owner', 'admin', 'manager'].includes(String(s.role)) && s.archived !== true).map((s: any) => s.id)].filter(Boolean))] as string[];
  const msg = `${monthLabel(last)}: ${r.total} case${r.total === 1 ? '' : 's'}, ${r.madeRight} made right${r.cost.total ? `, ${fmtMoney(r.cost.total)} to put right` : ''}${r.unmarked ? ` — ${r.unmarked} still need a cause` : ''}.`;
  const b = db.batch(); const now = new Date().toISOString();
  for (const u of to) { const ref = db.collection(`tenants/${tenantId}/notifications`).doc(); b.set(ref, { id: ref.id, userId: u, type: 'case_report', title: 'Making it right report', message: msg, link: `/cases/report?month=${last}`, createdAt: now, read: false }); }
  await b.commit(); return true;
}
