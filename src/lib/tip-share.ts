// src/lib/tip-share.ts — HOW TIPS ARE SHARED (per business): direct, tip-outs, or a pool. Worked out per period from
// the tips recorded at checkout (who each tip was for, cash or card) and hours from the time clock; the owner reviews
// and approves each period, and payroll pays the approved shares.
//   direct  — everyone keeps the tips allocated to them (today's behaviour)
//   tipout  — providers keep their tips but pass set percentages to support roles on shift that day (by hours)
//   pool    — the period's tips go into one pot, split by hours, by hours × role weight, or equally
// Rules that always hold: owners, managers and supervisors can't receive pooled or tipped-out money (US federal law)
// unless the owner has marked them "works as a provider only"; renters are never included; students follow the school's
// rule (tips to the school aren't in the pool); a card-fee deduction is off unless the business turns it on.
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export type TipMode = 'direct' | 'tipout' | 'pool';
export type TipPolicy = { mode: TipMode; period: 'day' | 'week'; tipouts: { to: string; pct: number }[]; split: 'hours' | 'weighted' | 'equal'; weights: Record<string, number>; cardFeePct: number };
const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'supervisor']);

export function tipPolicy(tenant: any): TipPolicy { const p = tenant?.tipSharing || {};
  return { mode: (['direct', 'tipout', 'pool'] as const).includes(p.mode) ? p.mode : 'direct', period: p.period === 'week' ? 'week' : 'day',
    tipouts: Array.isArray(p.tipouts) ? p.tipouts.map((t: any) => ({ to: String(t.to || ''), pct: Math.max(0, Math.min(100, n(t.pct))) })).filter((t: any) => t.to && t.pct > 0) : [],
    split: (['hours', 'weighted', 'equal'] as const).includes(p.split) ? p.split : 'hours', weights: p.weights && typeof p.weights === 'object' ? p.weights : { provider: 1, assistant: 0.5, front_desk: 0.3 }, cardFeePct: Math.max(0, Math.min(10, n(p.cardFeePct))) }; }

/** Who can take part, and as what. */
export function tipRole(m: any): { eligible: boolean; role: string; why?: string } {
  if (!m) return { eligible: false, role: 'none', why: 'not found' };
  if (m.role === 'renter' || m.isRenter) return { eligible: false, role: 'renter', why: 'renters keep their own tips' };
  if (m.isStudent && ['school', 'none'].includes(String(m.tipPolicy || 'school'))) return { eligible: false, role: 'student', why: 'tips go to the school' };
  const r = String(m.role || '').toLowerCase();
  if (MANAGEMENT.has(r) && m.tipPoolEligible !== true) return { eligible: false, role: r, why: 'managers and owners can’t receive shared tips' };
  const role = String(m.tipRole || (m.isAssistant ? 'assistant' : /front.?desk|reception/i.test(String(m.jobTitle || m.title || '')) ? 'front_desk' : 'provider')).toLowerCase();
  return { eligible: true, role };
}

export type ShareRow = { staffId: string; name: string; role: string; earnedCents: number; cashEarnedCents: number; hours: number; weight: number; shareCents: number; outCents: number; inCents: number; note?: string };
export async function computeTipShares(db: any, tenantId: string, tenant: any, start: string, end: string) {
  const T = `tenants/${tenantId}`; const pol = tipPolicy(tenant);
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const tips = (await db.collection(`${T}/transactions`).where('category', '==', 'Tips').get()).docs.map((d: any) => d.data() || {}).filter((t: any) => t.type === 'income' && String(t.date || '') >= start && String(t.date || '') <= end && t.staffId && t.staffId !== '__school');
  const logs = (await db.collection(`${T}/activityLogs`).get()).docs.map((d: any) => d.data() || {}).filter((l: any) => { const ts = l.timestamp?.toDate ? l.timestamp.toDate().toISOString() : String(l.timestamp || ''); return ts >= start && ts <= end && n(l.durationMinutes) > 0; });
  const hoursOf = (id: string, day?: string) => logs.filter((l: any) => l.staffId === id && (!day || String(l.timestamp?.toDate ? l.timestamp.toDate().toISOString() : l.timestamp).slice(0, 10) === day)).reduce((s: number, l: any) => s + n(l.durationMinutes), 0) / 60;
  const rows = new Map<string, ShareRow>(); const warnings: string[] = []; let feeCents = 0;
  const row = (m: any) => { const r = tipRole(m); let x = rows.get(m.id); if (!x) { x = { staffId: m.id, name: m.name || 'Team member', role: r.role, earnedCents: 0, cashEarnedCents: 0, hours: Math.round(hoursOf(m.id) * 100) / 100, weight: pol.weights[r.role] ?? 1, shareCents: 0, outCents: 0, inCents: 0, note: r.eligible ? undefined : r.why }; rows.set(m.id, x); } return x; };
  for (const t of tips) { const m = staff.find((s: any) => s.id === t.staffId); if (!m || tipRole(m).role === 'renter') continue; const x = row(m);   // renters' tips are their own money — never on this sheet const c = Math.round(n(t.tipAmount || t.amount) * 100);
    const fee = pol.cardFeePct > 0 && !/cash/i.test(String(t.paymentMethod || '')) ? Math.round(c * pol.cardFeePct / 100) : 0; feeCents += fee;
    x.earnedCents += c - fee; if (/cash/i.test(String(t.paymentMethod || ''))) x.cashEarnedCents += c; }
  for (const m of staff) if (tipRole(m).eligible && hoursOf(m.id) > 0) row(m);   // worked the period but took no tips directly (assistants, front desk)
  const all = [...rows.values()]; const eligible = all.filter((x) => !x.note);
  if (pol.mode === 'direct') { for (const x of all) x.shareCents = x.note ? 0 : x.earnedCents; }
  else if (pol.mode === 'tipout') {
    for (const x of all) x.shareCents = x.note ? 0 : x.earnedCents;
    // each provider passes pct of what they earned to each support role, split among that role's people on shift the same days (by hours)
    for (const t of tips) { const giver = rows.get(t.staffId); if (!giver || giver.note) continue; const day = String(t.date || '').slice(0, 10); const c = Math.round(n(t.tipAmount || t.amount) * 100);
      for (const to of pol.tipouts) { const recipients = eligible.filter((x) => x.staffId !== giver.staffId && (to.to.startsWith('staff:') ? x.staffId === to.to.slice(6) : x.role === to.to.replace(/^role:/, ''))).map((x) => ({ x, h: hoursOf(x.staffId, day) })).filter((r) => r.h > 0);
        if (!recipients.length) continue; const out = Math.round(c * to.pct / 100); const hsum = recipients.reduce((s, r) => s + r.h, 0); giver.shareCents -= out; giver.outCents += out;
        recipients.forEach((r) => { const part = Math.round(out * r.h / hsum); r.x.shareCents += part; r.x.inCents += part; }); } }
  } else {
    const pot = eligible.reduce((s, x) => s + x.earnedCents, 0); const ineligibleEarned = all.filter((x) => x.note).reduce((s, x) => s + x.earnedCents, 0);
    if (ineligibleEarned > 0) warnings.push('Tips allocated to people who can’t be in the pool (managers, renters, students) stay with them and aren’t pooled.');
    for (const x of all) if (x.note) x.shareCents = x.earnedCents;
    const parts = eligible.map((x) => ({ x, w: pol.split === 'equal' ? 1 : pol.split === 'weighted' ? x.hours * x.weight : x.hours })).filter((p) => p.w > 0);
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    if (!parts.length || wsum <= 0) { warnings.push('No hours were logged for the period, so the pool can’t be split by hours — tips stay with whoever earned them until hours are logged.'); for (const x of eligible) x.shareCents = x.earnedCents; }
    else { let given = 0; parts.forEach((p, i) => { const share = i === parts.length - 1 ? pot - given : Math.round(pot * p.w / wsum); p.x.shareCents = share; given += share; p.x.outCents = Math.max(0, p.x.earnedCents - share); p.x.inCents = Math.max(0, share - p.x.earnedCents); });
      const noHours = eligible.filter((x) => x.earnedCents > 0 && !parts.some((p) => p.x.staffId === x.staffId)); if (noHours.length) warnings.push(`${noHours.map((x) => x.name).join(', ')} took tips but logged no hours — their share is 0 until hours are logged.`); }
  }
  const totalCents = all.reduce((s, x) => s + x.earnedCents, 0);
  return { mode: pol.mode, start, end, totalCents, feeCents, rows: all.sort((a, b) => b.shareCents - a.shareCents), warnings, cashCents: all.reduce((s, x) => s + x.cashEarnedCents, 0) };
}
