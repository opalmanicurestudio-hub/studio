// src/app/api/activity/route.ts — ACTIVITY AND WHO CAN DO WHAT (design boards "Who can do what" and "Activity"; the
// Activity page). For the owner (and admins): every money moment on a day, from the audit log (lib/activity), with the
// day's totals and what's worth a look; and the rules for who can do each (lib/money-rules), changed only here.
//   list  { tenantId, day? } → { day, lines, totals, flagged, people }: a day in the business's own time, newest first
//   rules { tenantId } → { rules, alerts, auto }: who each takes, what's worth a look, the online shop's automatic refunds
//   saveRules { tenantId, rules?, alerts?, autoBelowCents? } → the same, after the change (and a line in Activity). Only
//             the owner: an admin sees them, but "only the owner" is a rule an admin mustn't be able to loosen.
// The audit log itself is never changed here: lines are only ever added (lib/audit).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { activityLine, totalsOf, type ActivityLine } from '@/lib/activity';
import { bigRefundOf } from '@/lib/activity-server';
import { rulesOf, cleanRules, RULES, NEEDS } from '@/lib/money-rules';
import { addDays, endOfDay, startOfDay, tenantTimeZone, todayIn } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
/** The most the online shop can refund on its own, per order. */
const AUTO_MAX = 50000;
/** A day's lines are read a page at a time, up to the most shown. */
const PAGE = 1000, PAGES = 5, MAX_LINES = 1000;
/** The owner themself (as lib/money-rules-server counts them), not an admin. */
const isOwner = (a: any, tenant: any) => !!a && (a.isTenantOwner === true || String(a.role || '').toLowerCase() === 'owner' || (!!tenant?.ownerId && tenant.ownerId === a.uid));

const alertsOf = (tenant: any) => ({ refundOverCents: bigRefundOf(tenant) });
const autoOf = (tenant: any) => (tenant?.retailSettings ? { cents: Math.max(0, Math.round(Number(tenant.retailSettings?.policies?.refundAutoBelowCents) || 0)) } : null);

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['list', 'rules', 'saveRules'].includes(action)) return bad('Unknown action.');
    // (The owner and admins: what everyone did, and the rules for it.)
    const g: any = await requireRole(req, tenantId, 'owner'); if (g.deny) return g.deny;
    if (g.actor?.isRenter) return bad('This is for the business’s owner.', 403);
    const db = getAdminDb();
    const T = `tenants/${tenantId}`;
    const tenant: any = (await db.doc(T).get()).data() || {};

    if (action === 'list') {
      const tz = tenantTimeZone(tenant); const today = todayIn(tz);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '')) && String(b.day) <= today && String(b.day) >= addDays(today, -400) ? String(b.day) : today;
      const from = startOfDay(day, tz).toISOString(), to = endOfDay(day, tz).toISOString();
      // (Read back from the end of the day a page at a time, so other kinds of line never crowd out the money ones.)
      // (Each page from the last one's oldest time, that time included, so lines written in the same moment are never
      // skipped; a line already read isn't counted twice.)
      const seen = new Map<string, ActivityLine>(); const lines: ActivityLine[] = []; let before = to; let more = false; let full = true;
      for (let page = 0; page < PAGES && full && lines.length < MAX_LINES; page++) {
        const snap = await db.collection(`${T}/auditLogs`).where('at', '>=', from).where('at', '<=', before).orderBy('at', 'desc').limit(PAGE).get();
        for (const d of snap.docs) { if (seen.has(d.id)) continue; const l = activityLine(d.id, d.data() || {}); seen.set(d.id, l as any); if (l) lines.push(l); }
        full = snap.docs.length >= PAGE; if (snap.docs.length) before = String((snap.docs[snap.docs.length - 1].data() || {}).at || before);
        more = full;
      }
      lines.sort((x, y) => String(y.at).localeCompare(String(x.at)));
      const shown = lines.slice(0, MAX_LINES);
      const people = Array.from(new Set(shown.flatMap((l) => [l.by, l.okBy]).filter(Boolean) as string[])).sort();
      return NextResponse.json({ ok: true, day, today, timeZone: tz, lines: shown, totals: totalsOf(shown), flagged: shown.filter((l) => l.flag).map((l) => l.id), people, more: more || lines.length > MAX_LINES, canChange: isOwner(g.actor, tenant) });
    }

    if (action === 'rules') return NextResponse.json({ ok: true, rules: rulesOf(tenant), alerts: alertsOf(tenant), auto: autoOf(tenant), canChange: isOwner(g.actor, tenant), choices: { rules: RULES, needs: NEEDS } });

    // saveRules: the owner only.
    if (!isOwner(g.actor, tenant)) return bad('Only the owner changes who can do what.', 403);
    const now = rulesOf(tenant);
    const patch: Record<string, any> = {}; const said: string[] = [];
    if (b.rules && typeof b.rules === 'object') {
      const next = cleanRules(b.rules, now); if ('error' in next) return bad(next.error);
      // (Only what changed, each on its own, so two screens changing different rules never undo each other.)
      for (const r of RULES) if (next[r.id] !== now[r.id]) patch[`moneyRules.${r.id}`] = next[r.id];
      if (next.refundSelfCents !== now.refundSelfCents) patch['moneyRules.refundSelfCents'] = next.refundSelfCents;
      for (const r of RULES) if (next[r.id] !== now[r.id]) said.push(`${r.label}: ${NEEDS.find((n) => n.id === next[r.id])!.label}`);
      if (next.refundSelfCents !== now.refundSelfCents) said.push(`Staff refund on their own up to $${(next.refundSelfCents / 100).toFixed(2)}`);
    }
    if (b.alerts && typeof b.alerts === 'object' && b.alerts.refundOverCents !== undefined) {
      const v = b.alerts.refundOverCents === null ? null : Math.round(Number(b.alerts.refundOverCents));
      if (v !== null && !(Number.isFinite(v) && v >= 100 && v <= 1000000)) return bad('A refund of how much is worth a look? $1 or more, or none.');
      patch['moneyRules.alerts.refundOverCents'] = v;
      said.push(v === null ? 'Big refunds: not marked' : `Refunds of $${(v / 100).toFixed(2)} or more: marked`);
    }
    if (b.autoBelowCents !== undefined) {
      if (!tenant.retailSettings) return bad('Automatic refunds are for an online shop.', 409);
      const n = Math.round(Number(b.autoBelowCents));
      if (!Number.isFinite(n) || n < 0 || n > AUTO_MAX) return bad(`Up to $${AUTO_MAX / 100} at most, or $0 to turn it off.`);
      patch['retailSettings.policies.refundAutoBelowCents'] = n;
      said.push(n ? `Automatic refunds up to $${(n / 100).toFixed(2)}` : 'Automatic refunds: off');
    }
    if (!said.length) return bad('Nothing to change.');
    // (In one write: all of it, or none.)
    await db.doc(T).update({ ...patch, moneyRulesAt: new Date().toISOString() });
    // (Changing the rules is a line in the audit log too.)
    await logAuditAdmin(db, tenantId, { action: 'rule.money', targetType: 'rule', targetId: 'moneyRules', summary: `Who can do what changed. ${said.join('. ')}.`,
      kind: 'rules', reason: said.join('. '), by: { id: null, name: String(g.actor?.name || 'The owner') },
      actor: { type: 'user', id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'The owner') } } as any);
    const after: any = (await db.doc(T).get()).data() || {};
    return NextResponse.json({ ok: true, rules: rulesOf(after), alerts: alertsOf(after), auto: autoOf(after) });
  } catch (e: any) {
    console.error('[activity]', e?.message);
    return bad('That didn’t go through. Try again.', 500);
  }
}
