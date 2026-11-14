// src/app/api/close/route.ts — CLOSING THE NIGHT (lib/night-close for the rules, lib/night-close-server for the reads).
//   state    { tenantId, day?, lite?, tips? } → anyone on the team: tonight's checklist and marks, open drawers, whether it
//                                            can close; managers also get the report as it stands (or as it was kept),
//                                            unless lite; tips: true works out the night's tip shares into it.
//   check    { tenantId, day?, itemId, done?, value?, note? } → anyone on the team: tick it, log a reading (outside its
//                                            limit needs a few words), or take a tick back (done: false).
//   close    { tenantId, day?, approveTips? } → managers: the checklist done (unless the business allows otherwise) and
//                                            no drawer open; keeps the report, approves the night's tip shares when the
//                                            business shares tips by the day, and emails the report.
//   send     { tenantId, day }             → managers: email a closed night's report again.
//   settings { tenantId, items?, requireChecklist?, reportTo?, approveTips? } → managers: the closing setup.
//   history  { tenantId }                  → managers: the last 60 closed nights.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { canClose, cleanReportTo, closeSettingsOf, MAX_ITEMS } from '@/lib/night-close';
import { approvedTipRunOver, buildNightReport, DAY_RE, emailNightReport, nightBounds, nightTills, recordCheck, reportRecipients, reportToOf, tonight } from '@/lib/night-close-server';

export const dynamic = 'force-dynamic';
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), action = String(b.action || '');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(tenantId)) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Sign in to do that.', auth.status || 401);
  const manager = !!(auth.actor.isManager || auth.actor.isTenantOwner);
  const me = String(auth.actor.name || 'A team member');
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const today = tonight(tenant);
  const day = b.day === undefined || b.day === null || b.day === '' ? today : String(b.day);
  if (!DAY_RE.test(day)) return bad('Pick a night.');
  if (day > today) return bad('That night hasn’t started yet.');
  if (day !== today && !manager && action !== 'state') return bad('Only a manager can change an earlier night.', 403);
  const ref = db.doc(`${T}/nightCloses/${day}`);

  try {
    if (action === 'state') {
      const s = closeSettingsOf(tenant);
      const cur: any = (await ref.get()).data() || {};
      const checks = cur.checks || {};
      const tills = await nightTills(db, T, nightBounds(tenant, day));
      const open = tills.filter((t) => t.status === 'open').length;
      const closed = cur.status === 'closed';
      const report = manager && b.lite !== true ? (closed && cur.report ? cur.report : (await buildNightReport(db, tenantId, tenant, day, checks, { tips: b.tips === true })).report) : null;
      return ok({ day, today, closed, closedAt: cur.closedAt || null, closedBy: cur.closedBy || null, emailedTo: cur.emailedTo || [], tipsApproved: !!cur.tipsApproved, tipsNote: cur.tipsNote || null,
        settings: { ...s, reportTo: manager ? await reportToOf(db, T) : [] }, settingsSaved: Array.isArray(tenant?.closingSettings?.items), checks, openTills: open, left: s.items.filter((i) => !checks[i.id]?.done).length,
        can: closed ? { ok: false, why: 'Closed.' } : canClose(s, checks, open), manager, report });
    }

    if (action === 'check') {
      const r = await recordCheck(db, T, tenant, day, String(b.itemId || ''), { done: b.done, value: b.value, note: b.note }, me);
      return r.ok ? ok({ mark: r.mark }) : bad(r.error, r.status || 400);
    }

    if (!manager) return bad('Only a manager can do that.', 403);

    if (action === 'close') {
      const s = closeSettingsOf(tenant);
      const cur: any = (await ref.get()).data() || {};
      if (cur.status === 'closed') return bad('This night is already closed.', 409);
      const checks = cur.checks || {};
      const { report, tills } = await buildNightReport(db, tenantId, tenant, day, checks, { tips: true });
      const can = canClose(s, checks, tills.filter((t) => t.status === 'open').length);
      if (!can.ok) return bad(can.why || 'Not ready to close.', 409);
      const now = new Date().toISOString();
      // Closed first (only once, however many managers press it), then the tips and the email.
      await db.runTransaction(async (tx: any) => {
        const c: any = (await tx.get(ref)).data() || {};
        if (c.status === 'closed') throw Object.assign(new Error('closed'), { closedAlready: true });
        tx.set(ref, { day, status: 'closed', closedAt: now, closedBy: me, closedById: String(auth.actor.uid), report, updatedAt: now }, { merge: true });
      });
      // The night's tip shares, approved here when the business shares tips by the day: the night itself, cutover to
      // cutover, and never when any of it is already inside an approved run (payroll pays every approved run).
      let tipsApproved = false; let tipsNote: string | null = null;
      const wantTips = b.approveTips === undefined ? s.approveTips : b.approveTips === true;
      if (wantTips) {
        const { computeTipShares, tipPolicy } = await import('@/lib/tip-share');
        const pol = tipPolicy(tenant);
        if (pol.mode !== 'direct' && pol.period === 'day') {
          const nb = nightBounds(tenant, day); const start = nb.start, end = new Date(Date.parse(nb.end) - 1).toISOString();
          const over = await approvedTipRunOver(db, T, start, end);
          if (over) tipsNote = `Tonight’s tips are already in a run approved for ${over.start.slice(0, 10)} to ${over.end.slice(0, 10)}, so they weren’t approved again.`;
          else {
            const result = await computeTipShares(db, tenantId, tenant, start, end);
            const runRef = db.doc(`${T}/tipShareRuns/night_${day}`);
            tipsApproved = await db.runTransaction(async (tx: any) => {
              const run: any = (await tx.get(runRef)).data();
              if (run?.status === 'approved') return true;
              tx.set(runRef, { ...result, start, end, status: 'approved', approvedBy: me, approvedAt: new Date().toISOString(), approvedAtClose: true, night: day });
              return true;
            }).catch(() => false);
          }
        } else tipsNote = pol.mode === 'direct' ? null : 'Tips are shared by the week, so they’re approved on the Money page.';
      }
      const to = await reportRecipients(db, T, tenant, await reportToOf(db, T));
      const sent = await emailNightReport(db, tenantId, tenant, report, to).catch(() => [] as string[]);
      await ref.set({ tipsApproved, tipsNote, ...(sent.length ? { emailedTo: sent, emailedAt: new Date().toISOString() } : {}) }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'night.close', targetType: 'nightClose', targetId: day, amount: report.sales.total,
        summary: `${me} closed ${day}: sales $${report.sales.total.toFixed(2)}, comps $${report.comps.total.toFixed(2)}, voids $${report.voids.total.toFixed(2)}, waste $${report.waste.toFixed(2)}${report.drawers.length ? `, drawers ${report.drawers.map((d) => (d.overShort === null ? 'not counted' : d.overShort === 0 ? 'even' : `${d.overShort < 0 ? 'short' : 'over'} $${Math.abs(d.overShort).toFixed(2)}`)).join(', ')}` : ''}.`,
        actor: { type: 'user', id: String(auth.actor.uid), name: me } } as any).catch(() => {});
      return ok({ report, emailedTo: sent, tipsApproved, tipsNote, wanted: to.length });
    }

    if (action === 'send') {
      const cur: any = (await ref.get()).data() || {};
      if (cur.status !== 'closed' || !cur.report) return bad('Close the night first.', 409);
      const to = await reportRecipients(db, T, tenant, await reportToOf(db, T));
      if (!to.length) return bad('Add someone to send the report to in closing settings.');
      const sent = await emailNightReport(db, tenantId, tenant, cur.report, to);
      if (!sent.length) return bad('The email didn’t go out. Check the business’s email setup.', 502);
      await ref.set({ emailedTo: sent, emailedAt: new Date().toISOString() }, { merge: true });
      return ok({ emailedTo: sent });
    }

    if (action === 'settings') {
      const cur = closeSettingsOf(tenant);
      const next: any = { items: cur.items, requireChecklist: cur.requireChecklist, approveTips: cur.approveTips };
      if (b.items !== undefined) {
        if (!Array.isArray(b.items) || b.items.length > MAX_ITEMS) return bad(`Up to ${MAX_ITEMS} items.`);
        if (b.items.some((x: any) => !String(x?.label || '').trim())) return bad('Each item needs a name.');
        const blank = (v: any) => v === null || v === undefined || v === '';
        if (b.items.some((x: any) => x?.kind === 'temp' && blank(x.maxF) && blank(x.minF))) return bad('Give each temperature a limit.');
        next.items = closeSettingsOf({ closingSettings: { items: b.items } }).items;
      }
      // Saved only as chosen: the business's own checklist is required unless they say otherwise (lib/night-close).
      if (b.requireChecklist !== undefined) next.requireChecklist = b.requireChecklist === true; else if (!Array.isArray(tenant?.closingSettings?.items)) next.requireChecklist = true;
      if (b.approveTips !== undefined) next.approveTips = b.approveTips === true;
      // Who gets the report is kept where only the server reads it: the business's record is public.
      let reportTo = await reportToOf(db, T);
      if (b.reportTo !== undefined) { if (!Array.isArray(b.reportTo) || b.reportTo.length > 10) return bad('Up to 10 people.'); reportTo = cleanReportTo(b.reportTo); await db.doc(`${T}/private/closing`).set({ reportTo, updatedAt: new Date().toISOString() }, { merge: true }); }
      await db.doc(T).set({ closingSettings: { ...next, reportTo: null } }, { merge: true });
      return ok({ settings: { ...closeSettingsOf({ closingSettings: next }), reportTo } });
    }

    if (action === 'history') {
      // The newest nights first (ordered by the night, then the closed ones kept).
      const s = await db.collection(`${T}/nightCloses`).orderBy('day', 'desc').limit(90).get();
      const rows = s.docs.map((d: any) => d.data() || {}).filter((c: any) => c.status === 'closed').slice(0, 60)
        .map((c: any) => ({ day: c.day, closedBy: c.closedBy || null, sales: c.report?.sales?.total ?? null, comps: c.report?.comps?.total ?? null, voids: c.report?.voids?.total ?? null, flags: (c.report?.flags || []).length }));
      return ok({ rows });
    }

    return bad('Unknown action.');
  } catch (e: any) {
    if (e?.closedAlready) return bad('This night was closed by someone else just now.', 409);
    console.error('[close]', e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
