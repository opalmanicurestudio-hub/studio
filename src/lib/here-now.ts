// src/lib/here-now.ts — WHO'S HERE AND WHAT'S OUTSTANDING (K7).
// One list for the front desk of everyone in the building who hasn't started yet: booked guests who've checked in,
// walk-ins waiting, and people at the front door (renter visits, pickups, tours, "I need help"). Each row says what still
// needs doing before they can begin (forms, deposit, a balance, a provider) and whose move it is. No amounts and no
// contact details — only that something is owed, so it's safe on a desk screen anyone can glance at.

export type Outstanding = { key: 'help' | 'forms' | 'deposit' | 'balance' | 'provider' | 'pickup' | 'renter' | 'extra' | 'first'; label: string; tone: 'alert' | 'warn' | 'info' };
export type HereRow = { key: string; kind: 'guest' | 'door'; name: string; what: string; since: Date | null; waitMin: number; owner: string; outstanding: Outstanding[]; appointmentId?: string | null; doorId?: string | null; intent?: string | null; urgent: boolean };

const ms = (v: any) => { const t = Date.parse(String(v?.toDate ? v.toDate().toISOString() : v || '')); return Number.isFinite(t) ? t : 0; };

/** Required forms on this visit not yet signed here or on file (unexpired). */
export function formsDue(a: any, services: any[], client: any, signedOnFile: string[] = []): number {
  const need = new Set<string>();
  for (const id of [a?.serviceId, ...(Array.isArray(a?.addOnIds) ? a.addOnIds : [])].filter(Boolean)) (services.find((s) => s.id === id)?.requiredFormIds || []).forEach((x: string) => need.add(String(x)));
  (a?.requiredFormIds || []).forEach((x: string) => need.add(String(x)));
  const signed = new Set<string>([...(a?.signedForms || []).map((f: any) => String(f?.formId || '')), ...signedOnFile.map(String), ...(client?.signedFormIds || []).map(String)]);
  return [...need].filter((x) => !signed.has(x)).length;
}

export function buildHereNow(input: { guests: { appt?: any; walkIn?: any; name: string; service: string; staffName: string | null; stage: string }[]; door: any[]; clients: any[]; services: any[]; now: Date; extraMinutesFor?: (c: any, sid: string) => number }): HereRow[] {
  const { now } = input; const rows: HereRow[] = [];
  for (const g of input.guests) {
    if (g.stage !== 'waiting') continue;
    const a = g.appt || {}; const w = g.walkIn || {};
    const c = input.clients.find((x) => x.id === (a.clientId || w.clientId)) || null;
    const since = ms(a.arrivedAt || w.checkInTime || w.createdAt || a.checkedInAt) || ms(a.startTime);
    const out: Outstanding[] = [];
    const f = formsDue(a, input.services, c); if (f > 0) out.push({ key: 'forms', label: f === 1 ? 'Form to sign' : `${f} forms to sign`, tone: 'warn' });
    const st = String(a.status || '').toLowerCase();
    if (st === 'deposit_pending' || st === 'pending_payment') out.push({ key: 'deposit', label: 'Deposit not paid', tone: 'warn' });
    if (Number(c?.outstandingBalance) > 0 || Number(a.balanceDueCents) > 0) out.push({ key: 'balance', label: 'Has a balance', tone: 'warn' });
    if (!g.staffName) out.push({ key: 'provider', label: 'Needs a provider', tone: 'alert' });
    const ex = Number(a.clientExtraMinutes) || (c && input.extraMinutesFor ? input.extraMinutesFor(c, a.serviceId) : 0); if (ex > 0) out.push({ key: 'extra', label: `Usually +${ex} min`, tone: 'info' });
    if (c && (c.totalVisits === 0 || c.visitCount === 0 || c.isNew === true)) out.push({ key: 'first', label: 'First visit', tone: 'info' });
    const deskFirst = out.some((o) => ['forms', 'deposit', 'balance', 'provider'].includes(o.key));
    rows.push({ key: `g:${a.id || w.id}`, kind: 'guest', name: g.name, what: g.service || 'Visit', since: since ? new Date(since) : null, waitMin: since ? Math.max(0, Math.round((now.getTime() - since) / 60000)) : 0,
      owner: deskFirst ? 'Front desk' : g.staffName || 'Front desk', outstanding: out, appointmentId: a.id || null, urgent: false });
  }
  for (const d of input.door) {
    if (String(d.status || 'waiting') !== 'waiting') continue;
    const since = ms(d.createdAt); const out: Outstanding[] = [];
    if (d.intent === 'help') out.push({ key: 'help', label: 'Asked for help', tone: 'alert' });
    if (d.intent === 'pickup') out.push({ key: 'pickup', label: d.orderNumber ? `Order #${d.orderNumber}` : 'Order pickup', tone: 'info' });
    if (d.intent === 'renter') out.push({ key: 'renter', label: d.renterTexted ? `${d.renterName || 'Renter'} was texted` : `Tell ${d.renterName || 'the renter'}`, tone: d.renterTexted ? 'info' : 'warn' });
    rows.push({ key: `d:${d.id}`, kind: 'door', name: d.name || 'Someone', what: d.label || 'At the front door', since: since ? new Date(since) : null, waitMin: since ? Math.max(0, Math.round((now.getTime() - since) / 60000)) : 0,
      owner: d.intent === 'renter' && d.renterTexted ? (d.renterName || 'Renter') : 'Front desk', outstanding: out, doorId: d.id, intent: d.intent || null, urgent: d.intent === 'help' });
  }
  // "I need help" first, then whoever has waited longest.
  return rows.sort((x, y) => Number(y.urgent) - Number(x.urgent) || y.waitMin - x.waitMin);
}
