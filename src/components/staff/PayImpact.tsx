'use client';
// src/components/staff/PayImpact.tsx — WHAT EACH VISIT LEAVES YOU, under each way of paying providers.
//   • mode "compare" (service form, Price step): this service's full-price, member-price, membership and package visits
//     side by side for commission, per service and hourly pay — with what-if amounts the owner can change — and the
//     most a visit can pay and still keep the business's target margin.
//   • mode "person" (staff dialog): the person's own pay setup on their main services.
// Numbers come from lib/pay-impact (pay + employer taxes, products, running costs per hour of station time).
import * as React from 'react';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { visitKinds, visitOutcome, maxPayFor, choicesFor, type VisitKind, type PayChoice } from '@/lib/pay-impact';

const KIND_NOUN: Record<string, string> = { full: 'full-price visit', member: 'member-price visit', covered: 'membership visit', package: 'package session' };
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(0)}`;
const tone = (keep: number, pct: number | null, target: number) => (keep < 0 ? { bg: '#FBEAE8', fg: '#B42318' } : pct !== null && pct < target ? { bg: '#FDF1DC', fg: '#7A4A00' } : { bg: '#E3F3E7', fg: '#1F6B3A' });

function Card({ title, sub, rows, target }: { title: string; sub?: string; rows: { kind: VisitKind; pay: number | null; keep: number; pct: number | null }[]; target: number }) {
  return (
    <div className="space-y-2 rounded-2xl bg-white p-3" style={{ border: '1px solid var(--line, #e7e2dc)' }}>
      <div><p className="text-[14px] font-[700]">{title}</p>{sub && <p className="text-[12px]" style={{ color: 'var(--muted, #78716c)' }}>{sub}</p>}</div>
      {rows.map(({ kind, pay, keep, pct }) => { const t = tone(keep, pct, target);
        return (
          <div key={kind.key} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="min-w-0"><span className="font-[600]">{kind.label}</span> <span style={{ color: 'var(--muted, #78716c)' }}>· brings in {money(kind.brings)}{pay != null ? ` · pays ${money(pay)}` : ''}</span></span>
            <span className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-[700] tabular-nums" style={{ background: t.bg, color: t.fg }}>you keep {money(keep)}{pct !== null ? ` · ${Math.round(pct) < 0 ? '−' : ''}${Math.abs(Math.round(pct))}%` : ''}</span>
          </div>); })}
    </div>);
}

export function PayImpact({ service, mode = 'compare', staffMember, serviceIds }: { service?: any; mode?: 'compare' | 'person'; staffMember?: any; serviceIds?: string[] }) {
  const inv: any = useInventory(); const { selectedTenant } = useTenant() as any;
  const inventory = inv?.inventory || []; const memberships = inv?.memberships || []; const packages = inv?.packages || []; const team = inv?.staff || []; const allServices = inv?.services || [];
  const costPerHour = Number(selectedTenant?.tmhr) || 50; const taxPct = Number(selectedTenant?.employerTaxBurdenPct) || 10;
  const [target, setTarget] = React.useState<number>(Number(selectedTenant?.opsCosts?.minMarginPct) || 20);
  const [what, setWhat] = React.useState<{ commissionPct?: number; perHour?: number; hourly?: number }>({});
  const base = { inventory, costPerHour, taxPct };
  const muted = { color: 'var(--muted, #78716c)' }; const ipt = 'h-9 w-16 rounded-lg border px-2 text-right text-[13px] tabular-nums';

  if (mode === 'person') {
    if (!staffMember || !['commission', 'hourly_plus_commission', 'per_service', 'hourly'].includes(String(staffMember.payStructure))) return null;
    const ids = (serviceIds && serviceIds.length ? serviceIds : staffMember.services || []) as string[];
    const svcs = allServices.filter((s: any) => ids.includes(s.id) && s.type !== 'addon' && Number(s.price) > 0).sort((a: any, b: any) => Number(b.price) - Number(a.price)).slice(0, 4);
    if (!svcs.length) return null;
    return (
      <section className="space-y-2" aria-label="What their visits leave you">
        <p className="text-[14px] font-[700]">What their visits leave you</p>
        <p className="text-[12px]" style={muted}>With this pay, after their pay plus {taxPct}% employer taxes, products, and running costs of ${costPerHour} an hour. Green keeps at least {target}%.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {svcs.map((s: any) => <Card key={s.id} title={s.name} sub={`${Number(s.duration) || 60} min`} target={target}
            rows={visitKinds(s, memberships, packages).map((k) => { const o = visitOutcome({ ...base, service: s, staff: staffMember, kind: k, minutes: Number(staffMember?.serviceMinutes?.[s.id]) || undefined }); return { kind: k, pay: o.pay, keep: o.keep, pct: o.marginPct }; })} />)}
        </div>
      </section>);
  }

  if (!service || !(Number(service.price) > 0)) return null;
  const kinds = visitKinds(service, memberships, packages);
  const choices: PayChoice[] = choicesFor(team, service, what);
  const first = kinds[0]; const sample = visitOutcome({ ...base, service, staff: { payStructure: 'salary' }, kind: first });
  const covered = kinds.find((k) => k.covered);
  const cap = (k: VisitKind) => maxPayFor({ ...base, service, kind: k, targetPct: target });

  return (
    <section className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--soft, #F6F3EE)' }} aria-label="What each visit leaves you">
      <div>
        <p className="text-[15px] font-[700]">What each visit leaves you</p>
        <p className="text-[12px]" style={muted}>After the provider’s pay plus {taxPct}% employer taxes, products ({money(sample.materials)}) and running costs for the time the station is busy ({money(sample.overhead)} at ${costPerHour} an hour). Green keeps at least your target.</p>
      </div>
      {(() => { const worst = choices.map((c) => { const os = kinds.map((k) => ({ k, o: visitOutcome({ ...base, service, staff: c.staff, kind: k }) })); const w = os.reduce((a, b) => (b.o.keep < a.o.keep ? b : a)); return { c, w }; });
        const losing = worst.filter((x) => x.w.o.keep < 0); const thin = worst.filter((x) => x.w.o.keep >= 0 && (x.w.o.marginPct ?? 0) < target);
        const best = worst.reduce((a, b) => (b.w.o.keep > a.w.o.keep ? b : a));
        const text = losing.length ? `${losing.map((x) => x.c.label).join(' and ')} lose${losing.length === 1 ? 's' : ''} money on a ${KIND_NOUN[losing[0].w.k.key]} (${money(losing[0].w.o.keep)}). ${best.c.label} keeps at least ${money(best.w.o.keep)} on every kind of visit.`
          : thin.length ? `Every option makes money, but ${thin.map((x) => x.c.label).join(' and ')} keep${thin.length === 1 ? 's' : ''} less than ${target}% on a ${KIND_NOUN[thin[0].w.k.key]}.`
          : `Every option keeps at least ${target}% on every kind of visit.`;
        return <p className="rounded-xl px-3 py-2 text-[14px] font-[600]" style={losing.length ? { background: '#FBEAE8', color: '#B42318' } : thin.length ? { background: '#FDF1DC', color: '#7A4A00' } : { background: '#E3F3E7', color: '#1F6B3A' }}>{text}</p>; })()}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <label className="inline-flex items-center gap-1.5">Commission <input aria-label="What-if commission percent" inputMode="decimal" className={ipt} placeholder={String(choices[0].staff.commissionRate)} value={what.commissionPct ?? ''} onChange={(e) => setWhat((w) => ({ ...w, commissionPct: Number(e.target.value) || undefined }))} />%</label>
        <label className="inline-flex items-center gap-1.5">Per service $<input aria-label="What-if pay per hour of service" inputMode="decimal" className={ipt} placeholder={String(choices[1].staff.serviceHourRate)} value={what.perHour ?? ''} onChange={(e) => setWhat((w) => ({ ...w, perHour: Number(e.target.value) || undefined }))} />an hour</label>
        <label className="inline-flex items-center gap-1.5">Hourly $<input aria-label="What-if hourly wage" inputMode="decimal" className={ipt} placeholder={String(choices[2].staff.hourlyRate)} value={what.hourly ?? ''} onChange={(e) => setWhat((w) => ({ ...w, hourly: Number(e.target.value) || undefined }))} /></label>
        <label className="inline-flex items-center gap-1.5">Target <input aria-label="Target margin percent" inputMode="decimal" className={ipt} value={target} onChange={(e) => setTarget(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} />%</label>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {choices.map((c) => <Card key={c.key} title={c.label} sub={c.note} target={target}
          rows={kinds.map((k) => { const o = visitOutcome({ ...base, service, staff: c.staff, kind: k }); return { kind: k, pay: o.pay, keep: o.keep, pct: o.marginPct }; })} />)}
      </div>
      <div className="space-y-1 text-[13px]">
        <p><b className="font-[700]">To keep {target}%</b>, a provider can be paid up to {kinds.map((k, i) => <span key={k.key}>{i ? (i === kinds.length - 1 ? ' and ' : ', ') : ''}<b className="font-[700] tabular-nums">{money(cap(k))}</b> for a {KIND_NOUN[k.key]}</span>)}.</p>
        {covered && <p style={muted}>Membership and package visits are worked out from what the client paid up front ({covered.note}), as if every visit is used. Commission on covered visits is paid on the normal price, so it costs the same as a full-price visit while bringing in less — per service pay doesn’t change.</p>}
        {!covered && <p style={muted}>No membership or package includes this service yet. Add one and its visits appear here.</p>}
      </div>
    </section>);
}
