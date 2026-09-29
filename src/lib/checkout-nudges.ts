// src/lib/checkout-nudges.ts — "WORTH MENTIONING" AT CHECKOUT (pure).
// Honest, rare suggestions — each backed by the client's own recent visits, shown with the maths:
//   membership — only if, on their last 3 months of visits, it WOULD have cost them less (≥ $5)
//   package    — they keep booking the same service (3+ times in 6 months) and a package is cheaper per visit
//   rebook     — no future booking, and their usual gap between visits says when
// At most `max` suggestions (1 by default), the most valuable first. Anything the client said "not now" to
// stays quiet for `quietDays` (60 by default). Each kind can be switched off (Settings → Payments).
export type NudgeKind = 'membership' | 'package' | 'rebook';
export interface Nudge { key: string; kind: NudgeKind; title: string; line: string; value: number; item?: { type: 'membership' | 'package'; id: string; name: string; price: number }; rebook?: { serviceId: string; date: string } }
export interface NudgeSettings { membership: boolean; package: boolean; rebook: boolean; quietDays: number; max: number }

export function nudgeSettingsOf(t: any): NudgeSettings {
  const n = t?.checkoutNudges || {};
  return { membership: n.membership !== false, package: n.package !== false, rebook: n.rebook !== false,
    quietDays: [30, 60, 90].includes(Number(n.quietDays)) ? Number(n.quietDays) : 60, max: Number(n.max) === 2 ? 2 : 1 };
}

const money = (n: number) => `$${Math.round(n)}`;
const DAY = 864e5;

export function nudgesFor(o: {
  client: any; visits: { serviceId: string; startTime: string; price: number }[]; upcoming: number;
  memberships: any[]; packages: any[]; services: any[]; settings: NudgeSettings; now?: number;
}): Nudge[] {
  const now = o.now ?? Date.now(); const s = o.settings; const out: Nudge[] = [];
  const first = String(o.client?.name || 'They').split(' ')[0];
  const quiet = (key: string) => { const d = Date.parse(o.client?.nudgeDeclines?.[key] || ''); return Number.isFinite(d) && now - d < s.quietDays * DAY; };
  const priceOf = (id: string) => Number(o.services.find((x: any) => x.id === id)?.price) || 0;
  const recent = (days: number) => o.visits.filter((v) => now - Date.parse(v.startTime) <= days * DAY && Date.parse(v.startTime) <= now);

  // ── Membership: would it have cost them less over the last 3 months? ──
  if (s.membership && !o.client?.activeMembershipId) {
    const last90 = recent(90);
    for (const m of o.memberships || []) {
      if (m.isPrivate || !(Number(m.price) > 0) || m.interval !== 'monthly') continue;
      const perks: any[] = Array.isArray(m.includedServices) ? m.includedServices : [];
      if (!perks.length) continue;
      const key = `membership_${m.id}`; if (quiet(key)) continue;
      const covered = last90.filter((v) => perks.some((p) => p.id === v.serviceId));
      if (covered.length < 2) continue;
      const actual = covered.reduce((sum, v) => sum + (v.price || priceOf(v.serviceId)), 0);
      // With the membership: 3 months of fees, plus anything beyond what each month includes.
      let extra = 0;
      for (let mo = 0; mo < 3; mo++) {
        const inMonth = covered.filter((v) => { const age = now - Date.parse(v.startTime); return age >= mo * 30 * DAY && age < (mo + 1) * 30 * DAY; });
        for (const p of perks) { const used = inMonth.filter((v) => v.serviceId === p.id); const over = Math.max(0, used.length - (Number(p.quantity) || 1)); extra += over * priceOf(p.id); }
      }
      const withIt = 3 * Number(m.price) + extra; const saved = actual - withIt;
      // Ranked by saving PER MONTH (fair against packages, which cover a different length of time).
      if (saved >= 5) out.push({ key, kind: 'membership', value: saved / 3, title: `${m.name} would have saved ${first} ${money(saved)}`,
        line: `In the last 3 months ${first} spent ${money(actual)} on ${[...new Set(covered.map((v) => o.services.find((x: any) => x.id === v.serviceId)?.name).filter(Boolean))].join(', ')}. ${m.name} (${money(m.price)}/month) would have come to ${money(withIt)}.`,
        item: { type: 'membership', id: m.id, name: m.name, price: Number(m.price) } });
    }
  }
  // ── Package: they keep booking the same service ──
  if (s.package) {
    const last180 = recent(180);
    for (const p of o.packages || []) {
      if (p.isPrivate || !(Number(p.price) > 0) || !(Number(p.sessions) > 1)) continue;
      const key = `package_${p.id}`; if (quiet(key)) continue;
      if ((o.client?.activePackages || []).some((x: any) => x.packageId === p.id && Number(x.sessionsRemaining) > 0)) continue;
      const times = last180.filter((v) => v.serviceId === p.serviceId).length; if (times < 3) continue;
      const each = Number(p.price) / Number(p.sessions); const now1 = priceOf(p.serviceId); const per = now1 - each;
      if (per < 1) continue;
      const svcName = o.services.find((x: any) => x.id === p.serviceId)?.name || 'this service';
      // Ranked by saving per month at their real pace.
      out.push({ key, kind: 'package', value: per * (times / 6), title: `${p.name}: ${money(per)} less per visit`,
        line: `${first} has booked ${svcName} ${times} times in 6 months. ${p.name} is ${p.sessions} visits for ${money(p.price)} — ${money(each)} each instead of ${money(now1)}.`,
        item: { type: 'package', id: p.id, name: p.name, price: Number(p.price) } });
    }
  }
  // ── Next visit: nothing booked, and their usual gap says when ──
  if (s.rebook && o.upcoming === 0) {
    const past = o.visits.filter((v) => Date.parse(v.startTime) <= now).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    const key = 'rebook';
    if (past.length >= 2 && !quiet(key)) {
      const gaps = past.slice(1).map((v, i) => (Date.parse(v.startTime) - Date.parse(past[i].startTime)) / DAY).filter((g) => g >= 5 && g <= 120);
      if (gaps.length) {
        const g = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]; const weeks = Math.max(1, Math.round(g / 7));
        const last = past[past.length - 1]; const next = new Date(now + weeks * 7 * DAY);
        const date = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
        out.push({ key, kind: 'rebook', value: 0.5, title: `${first} usually comes back every ${weeks} week${weeks === 1 ? '' : 's'}`,
          line: `Nothing booked yet — ${next.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} would keep ${first} on track.`, rebook: { serviceId: last.serviceId, date } });
      }
    }
  }
  return out.sort((a, b) => b.value - a.value).slice(0, s.max);
}
