// src/lib/rebook-report.ts — THE REBOOKING REPORT (pure): of the visits finished in a period, how many booked their next
// visit BEFORE LEAVING (during the visit, within an hour after, or straight from it on the iPad / at the desk), how many
// booked LATER (within 30 days), and how many haven't — by provider, and by where the next booking was made.
const CLOSED = ['cancelled', 'canceled', 'no_show', 'declined', 'expired'];
export interface RebookRow { staffId: string; name: string; visits: number; before: number; later: number; none: number }
export function rebookReport(appointments: any[], staff: any[], from: Date, to: Date) {
  const all = (appointments || []).filter((a: any) => a && a.clientId && a.startTime && !a.isRenterBooking);
  const byClient = new Map<string, any[]>(); for (const a of all) { const l = byClient.get(a.clientId) || []; l.push(a); byClient.set(a.clientId, l); }
  const done = all.filter((a: any) => a.status === 'completed' && Date.parse(a.startTime) >= from.getTime() && Date.parse(a.startTime) <= to.getTime());
  const rows = new Map<string, RebookRow>(); const via = { client_screen: 0, visit_link: 0, other: 0 }; let before = 0, later = 0;
  for (const v of done) {
    const vStart = Date.parse(v.startTime); const vEnd = Date.parse(v.endTime || '') || vStart + 3600000;
    const next = (byClient.get(v.clientId) || []).filter((n: any) => n.id !== v.id && Date.parse(n.startTime) > vStart && !CLOSED.includes(n.status) && (Date.parse(n.createdAt || '') || 0) >= vStart - 3600000)
      .sort((a: any, b: any) => (Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0))[0];
    const made = next ? Date.parse(next.createdAt || '') || 0 : 0;
    const isBefore = !!next && (next.rebookedFrom === v.id && next.rebookVia !== 'visit_link' || made <= vEnd + 3600000);
    const isLater = !!next && !isBefore && made <= vEnd + 30 * 864e5;
    const sid = v.staffId || 'unassigned'; const r = rows.get(sid) || { staffId: sid, name: String(staff.find((m: any) => m.id === sid)?.name || 'Unassigned'), visits: 0, before: 0, later: 0, none: 0 };
    r.visits++; if (isBefore) { r.before++; before++; } else if (isLater) { r.later++; later++; } else r.none++;
    rows.set(sid, r);
    if (isBefore || isLater) { const k = next.rebookVia === 'client_screen' ? 'client_screen' : next.rebookVia === 'visit_link' ? 'visit_link' : 'other'; (via as any)[k]++; }
  }
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  return { visits: done.length, before, later, none: done.length - before - later, beforePct: pct(before, done.length), laterPct: pct(later, done.length), via,
    rows: [...rows.values()].sort((a, b) => b.visits - a.visits).map((r) => ({ ...r, beforePct: pct(r.before, r.visits), laterPct: pct(r.later, r.visits) })) };
}
