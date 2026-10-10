// src/lib/pay-detective.ts — WHEN SOMEONE ASKS "WHY IS MY PAY LIKE THIS?", THE APP CHECKS FIRST. The moment a pay
// question is sent, the records behind it are looked over and the findings are saved on the question — so the manager
// opens it with the likely answer already in front of them (and a suggested amount when it's a real miss), and the
// team member sees what was checked. Three kinds of finding:
//   explains   — the line is right, and why (rate stamped at the time of sale, discount, product charge, refund rule)
//   likely     — probably the cause (tip recorded under someone else, visit never checked out, missing clock-out)
//   info       — useful context
// Read-only: it never changes anything. Pure checks (`findings`) + a loader (`investigate`) for the server.
import { periodRange } from '@/lib/pay-periods';
import { sessionsFrom, clockPolicy } from '@/lib/timeclock';
import { stageOf } from '@/lib/visit';

export type Finding = { tone: 'explains' | 'likely' | 'info'; text: string; suggestAmount?: number };
const money = (v: number) => `$${(Math.round((v || 0) * 100) / 100).toFixed(2)}`;
const amt = (t: any) => (typeof t?.amount === 'number' ? t.amount : (Number(t?.amountCents) || 0) / 100);
const first = (n: any) => { const p = String(n || '').trim().split(/\s+/); return p[0] ? `${p[0]}${p[1] ? ` ${p[1][0]}.` : ''}` : 'someone'; };
const day = (iso: any, tz: string) => new Date(String(iso)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });

export function findings(input: { q: any; me: any; tz: string; staffNames: Record<string, string>; txns: any[]; appts: any[]; sessions: any[]; punches: any[]; tenant: any }): Finding[] {
  const { q, me, tz, staffNames, txns, appts } = input; const out: Finding[] = [];
  const aid = q.line?.source?.appointmentId; const tid = q.line?.source?.txnId;
  const lineTxn = tid ? txns.find((t) => t.id === tid) : null;
  const onVisit = aid ? txns.filter((t) => t.appointmentId === aid) : [];
  const visit = aid ? appts.find((a) => a.id === aid) : null;

  // ── A specific sale line ──
  if (lineTxn && (lineTxn.type || 'income') === 'income' && lineTxn.category === 'Service Revenue') {
    const rate = Number(lineTxn.commissionPct); const now = Number(me.commissionRate);
    if (Number.isFinite(rate) && Number.isFinite(now) && rate !== now) out.push({ tone: 'explains', text: `This sale was made at ${rate}% — the rate you had that day. Your rate is now ${now}%; sales keep the rate they were made at.` });
    if (lineTxn.commissionBase != null && Number(lineTxn.commissionBase) !== amt(lineTxn)) out.push({ tone: 'explains', text: Number(lineTxn.commissionBase) > amt(lineTxn) ? `It was a membership, package or gift visit, so it’s paid on the normal price of ${money(Number(lineTxn.commissionBase))}.` : `The client had a discount — under the business’s pay rules commission is on what they actually paid (${money(Number(lineTxn.commissionBase))}).` });
    if (Number(lineTxn.productCharge) > 0) out.push({ tone: 'explains', text: `A ${money(Number(lineTxn.productCharge))} product charge comes off before commission (the business’s product rule).` });
    if (lineTxn.refundedAt) out.push({ tone: 'explains', text: `This sale was refunded later — the pay on it came off in the period of the refund.` });
    if (lineTxn.splitWith?.staffId) out.push({ tone: 'explains', text: `This service was shared with ${first(staffNames[lineTxn.splitWith.staffId === me.id ? lineTxn.staffId : lineTxn.splitWith.staffId])} — each of you is paid your share.` });
  }
  // ── Tips ──
  if (q.reason === 'tip_missing' || q.line?.ref?.startsWith('t')) {
    const others = onVisit.filter((t) => (t.category === 'Tips' || t.tipAmount) && t.staffId && t.staffId !== me.id);
    for (const t of others) out.push({ tone: 'likely', text: `A ${money(t.tipAmount || amt(t))} tip on this visit is recorded under ${first(staffNames[t.staffId])}.`, suggestAmount: Number(t.tipAmount || amt(t)) });
    if (visit && !others.length) {
      const dayKey = new Date(String(visit.startTime)).toLocaleDateString('en-CA', { timeZone: tz });
      const sameDay = txns.filter((t) => (t.category === 'Tips' || t.tipAmount) && t.staffId !== me.id && t.clientId && t.clientId === visit.clientId && new Date(String(t.date)).toLocaleDateString('en-CA', { timeZone: tz }) === dayKey);
      for (const t of sameDay) out.push({ tone: 'likely', text: `${first(visit.clientName)} left a ${money(t.tipAmount || amt(t))} tip that day, recorded under ${first(staffNames[t.staffId])}${t.paymentMethod ? ` (${t.paymentMethod})` : ''}.`, suggestAmount: Number(t.tipAmount || amt(t)) });
    }
    const back = txns.filter((t) => t.tipReversal?.staffId === me.id && (!aid || t.appointmentId === aid));
    for (const t of back) out.push({ tone: 'explains', text: `A ${money(t.tipReversal.amount)} tip was refunded to the client on ${day(t.date, tz)} and came off your pay.` });
  }
  // ── A visit that isn't on the stub ──
  if (q.reason === 'visit_missing' || (aid && !onVisit.some((t) => t.category === 'Service Revenue'))) {
    const mine = (a: any) => a.staffId === me.id || (a.assignedStaffIds || []).includes(me.id) || Object.values(a.checkoutState?.serviceStaffOverrides || {}).includes(me.id);
    const list = (aid && visit ? [visit] : appts.filter(mine)).filter((a) => !txns.some((t) => t.appointmentId === a.id && t.category === 'Service Revenue' && (t.staffId === me.id || t.splitWith?.staffId === me.id)));
    for (const a of list.slice(0, 6)) {
      const st = stageOf(a); const sale = txns.find((t) => t.appointmentId === a.id && t.category === 'Service Revenue');
      if (sale && sale.staffId !== me.id) out.push({ tone: 'likely', text: `${first(a.clientName)}’s ${day(a.startTime, tz)} visit was checked out under ${first(staffNames[sale.staffId])}.` });
      else if (a.closedReason === 'left_open') out.push({ tone: 'likely', text: `${first(a.clientName)}’s ${day(a.startTime, tz)} visit was never checked out — it’s in “Left open” waiting to be settled.` });
      else if (['in_service', 'ready_to_pay', 'arrived', 'waiting'].includes(st)) out.push({ tone: 'likely', text: `${first(a.clientName)}’s ${day(a.startTime, tz)} visit hasn’t been checked out yet (${st.replace(/_/g, ' ')}).` });
      else if (st === 'complete' && !sale) out.push({ tone: 'likely', text: `${first(a.clientName)}’s ${day(a.startTime, tz)} visit is marked complete but has no sale recorded.` });
    }
  }
  // ── Hours ──
  if (q.reason === 'hours_wrong' || q.line?.ref?.startsWith('s:')) {
    for (const s of input.sessions) {
      if (s.missingOut) out.push({ tone: 'likely', text: `No clock-out after ${new Date(s.inAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })} on ${day(s.inAt, tz)} — those hours aren’t counted until the clock-out is fixed.` });
      else if (s.status === 'pending' && input.tenant?.payRules?.approvedHoursOnly) out.push({ tone: 'likely', text: `The ${day(s.inAt, tz)} shift is waiting for a manager’s approval, so it isn’t paid yet.` });
      else if (s.status === 'rejected') out.push({ tone: 'explains', text: `The ${day(s.inAt, tz)} shift was not approved${s.note ? `: “${s.note}”` : ''}.` });
      if (s.unpaidBreakMinutes >= 30) out.push({ tone: 'info', text: `${day(s.inAt, tz)}: ${s.unpaidBreakMinutes} min of unpaid break came off.` });
    }
    for (const p of input.punches.filter((x) => x.editedAt || x.addedByManager)) out.push({ tone: 'info', text: `A manager ${p.addedByManager ? 'added' : 'changed'} a ${String(p.type).replace('_', ' ')} on ${day(p.timestamp, tz)}${p.editNote ? `: “${p.editNote}”` : ''}.` });
  }
  if (!out.length) out.push({ tone: 'info', text: 'Nothing unusual found in the records automatically — your manager will check it by hand.' });
  // one of each sentence
  return out.filter((f, i) => out.findIndex((g) => g.text === f.text) === i).slice(0, 8);
}

export async function investigate(db: any, tenantId: string, q: any): Promise<Finding[]> {
  const T = `tenants/${tenantId}`;
  const [tSnap, mSnap, stSnap] = await Promise.all([db.doc(T).get(), db.doc(`${T}/staff/${q.staffId}`).get(), db.collection(`${T}/staff`).get()]);
  const tenant: any = tSnap.data() || {}; const me = { id: q.staffId, ...(mSnap.data() || {}) }; const tz = tenant.timezone || 'America/New_York';
  const { fromIso, toIso } = periodRange(tenant, q.period);
  const [tx, ap, pu] = await Promise.all([
    db.collection(`${T}/transactions`).where('date', '>=', fromIso).where('date', '<=', new Date(Date.now()).toISOString()).get(),
    db.collection(`${T}/appointments`).where('startTime', '>=', fromIso).where('startTime', '<=', toIso).get(),
    db.collection(`${T}/activityLogs`).where('staffId', '==', q.staffId).get(),
  ]);
  const punches = pu.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((p: any) => String(p.timestamp) >= new Date(Date.parse(fromIso) - 86400000).toISOString() && String(p.timestamp) <= toIso);
  const sessions = sessionsFrom(punches, clockPolicy(tenant)).filter((s) => s.localDate >= q.period.from && s.localDate <= q.period.to);
  const staffNames = Object.fromEntries(stSnap.docs.map((d: any) => [d.id, (d.data() || {}).name || 'someone']));
  return findings({ q, me, tz, staffNames, txns: tx.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), appts: ap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), sessions, punches, tenant });
}
