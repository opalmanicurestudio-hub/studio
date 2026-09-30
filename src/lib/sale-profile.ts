// src/lib/sale-profile.ts — WHAT KIND OF SALE IS THIS? (pure). Worked out from what's on the ticket, so the client screen
// (and anything else) behaves right for every kind of sale — a salon visit, retail only, a membership, a fee, a deposit,
// a booth rental, a friend paying for someone — instead of each feature guessing.
//   tip       — asked only on what the business tips on (services by default; never on fees, deposits, memberships,
//               packages or rent), with the base worked out from those lines only
//   rebook    — only when a real visit (or a service) was on the ticket — for THAT person, even if a friend paid
//   moments   — not for a fee / deposit / rent-only payment
//   sign      — membership terms, when a membership is being bought
//   context   — plain lines for the client screen ("You're paying for Mia's visit", "Securing your visit on Tue Oct 20")
export type TipScope = 'services' | 'services_retail' | 'everything';
export interface SaleInput {
  visits: { clientId?: string | null; clientName?: string | null; serviceId?: string | null; serviceName?: string | null; amount: number; staffId?: string | null; addOnIds?: string[]; appointmentId?: string | null }[];
  items: { type?: string; name?: string; amount: number; id?: string; interval?: string; price?: number; depositForLabel?: string | null }[];
  fees: { name?: string; amount: number }[];
  payerId?: string | null; payerName?: string | null;
}
export interface SaleProfile {
  kinds: string[]; serviceAmount: number; retailAmount: number; otherAmount: number;
  tip: { ask: boolean; base: number };
  rebook: { clientId: string; clientName: string | null; serviceId: string; staffId: string | null; addOnIds: string[]; appointmentId: string | null; forSomeoneElse: boolean } | null;
  moments: boolean;
  sign: { what: 'membership'; title: string; text: string; ref: string } | null;
  context: string[];
}
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const first = (n: any) => String(n || '').split(' ')[0];

export function saleProfileOf(i: SaleInput, opt: { tipScope?: TipScope; membershipTerms?: string } = {}): SaleProfile {
  const kinds = new Set<string>();
  const visitAmt = (i.visits || []).reduce((s, v) => s + (Number(v.amount) || 0), 0); if (i.visits?.length) kinds.add('visit');
  let counterSvc = 0, retail = 0, other = 0;
  for (const it of i.items || []) {
    const a = Number(it.amount) || 0; const t = String(it.type || 'product');
    if (t === 'service') { counterSvc += a; kinds.add('service'); } else if (t === 'product') { retail += a; kinds.add('retail'); }
    else { other += a; kinds.add(t); }   // membership · package · deposit · rental · …
  }
  const feeAmt = (i.fees || []).reduce((s, f) => s + (Number(f.amount) || 0), 0); if (i.fees?.length) kinds.add('fee');
  const serviceAmount = r2(visitAmt + counterSvc);
  const scope = opt.tipScope || 'services';
  const base = scope === 'everything' ? serviceAmount + retail + other : scope === 'services_retail' ? serviceAmount + retail : serviceAmount;
  // Rebook: the first real visit — for that person (a friend may be paying).
  const v = (i.visits || []).find((x) => x.clientId && x.serviceId && x.clientId === i.payerId) || (i.visits || []).find((x) => x.clientId && x.serviceId);
  const rebook = v ? { clientId: String(v.clientId), clientName: v.clientName || null, serviceId: String(v.serviceId), staffId: v.staffId || null, addOnIds: v.addOnIds || [], appointmentId: v.appointmentId || null, forSomeoneElse: !!i.payerId && v.clientId !== i.payerId } : null;
  const onlyMoney = !kinds.has('visit') && !kinds.has('service') && !kinds.has('retail') && !kinds.has('membership') && !kinds.has('package');
  const mem = (i.items || []).find((x) => x.type === 'membership');
  const sign = mem ? { what: 'membership' as const, title: `${mem.name || 'Membership'} — terms`, ref: String(mem.id || ''),
    text: [`${mem.name || 'Membership'}: $${(Number(mem.price ?? mem.amount) || 0).toFixed(2)} ${mem.interval === 'yearly' || mem.interval === 'annual' ? 'a year' : 'a month'}. It renews automatically until you cancel.`, String(opt.membershipTerms || '').trim()].filter(Boolean).join('\n\n') } : null;
  const context: string[] = [];
  const others = [...new Set((i.visits || []).filter((x) => x.clientId && i.payerId && x.clientId !== i.payerId).map((x) => first(x.clientName)).filter(Boolean))];
  if (others.length) context.push(`You’re paying for ${others.join(' and ')}’s visit${others.length > 1 ? 's' : ''}`);
  for (const it of (i.items || []).filter((x) => x.type === 'deposit')) context.push(it.depositForLabel ? `Securing your visit — ${it.depositForLabel}` : 'A deposit for your next visit');
  for (const f of i.fees || []) context.push(`Paying: ${f.name || 'an owed balance'}`);
  if (kinds.has('rental')) context.push('Booth rental');
  return { kinds: [...kinds], serviceAmount, retailAmount: r2(retail), otherAmount: r2(other + feeAmt), tip: { ask: base > 0, base: r2(base) }, rebook, moments: !onlyMoney, sign, context };
}
