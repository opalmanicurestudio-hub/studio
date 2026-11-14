'use client';
// src/app/(app)/settings/setup/food/page.tsx — SET UP FOR FOOD AND DRINK (design canvas "Food setup"; lib/food-setup,
// api/food-setup). Three questions (what it runs, how guests order, who's working), then the plan to look over before
// anything changes: where things are made, courses with table service, a starter menu with what each item costs to make
// and a price that would keep that cost at a usual share (typical ingredient prices, marked as such), and the tools
// that fit (changed only in Your ClarityFlow). "Set it up" applies it, then the business's own next steps follow.
import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, X } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { C, LargeTitle } from '@/components/orders/ui';
import { useSetupGuide } from '@/components/settings/SetupGuide';
import { stepHref } from '@/lib/setup-guide';
import { FOOD_KINDS, ORDER_WAYS, TEAM_SIZES, cleanAnswers, kindLabel, pct, usualWays, type FoodAnswers, type FoodKind, type FoodPlan, type OrderWay, type TeamSize } from '@/lib/food-setup';
import { NAME_MAX, MAX_STATIONS } from '@/lib/table-service';
import { ALLERGENS } from '@/lib/allergens';

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const amount = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const chip = (on: boolean): React.CSSProperties => (on ? { background: C.ink, color: C.paper } : { background: C.paper, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.line}` });

export default function FoodSetupPage() {
  const { selectedTenant, role } = useTenant() as any;
  const tenantId: string = selectedTenant?.id || '';
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const g = useSetupGuide(true);
  const [kind, setKind] = React.useState<FoodKind | null>(null);
  const [ways, setWays] = React.useState<OrderWay[]>([]); const [waysTouched, setWaysTouched] = React.useState(false);
  const [team, setTeam] = React.useState<TeamSize | null>(null);
  const [plan, setPlan] = React.useState<FoodPlan | null>(null); const [have, setHave] = React.useState<{ items: string[]; ingredients: string[]; removed: string[] }>({ items: [], ingredients: [], removed: [] });
  const [planErr, setPlanErr] = React.useState('');
  const [stations, setStations] = React.useState<string[]>([]); const [keepMine, setKeepMine] = React.useState(true); const [newStation, setNewStation] = React.useState('');
  const [menu, setMenu] = React.useState(true); const [skip, setSkip] = React.useState<Set<string>>(new Set()); const [open, setOpen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [done, setDone] = React.useState<{ items: number; ingredients: number; keptItems: number } | null>(null);
  const [round, setRound] = React.useState(0);   // read the plan again after it's applied (what was added is then "already on your menu")

  // What it said before (or at sign-up), to start from.
  const seeded = React.useRef('');
  React.useEffect(() => {
    if (!tenantId || seeded.current === tenantId) return; seeded.current = tenantId;
    const fs = selectedTenant?.foodSetup; const a = fs?.kind ? cleanAnswers(fs) : null;
    if (a) { setKind(a.kind); setWays(a.ways); setWaysTouched(true); setTeam(a.team); }
    else setTeam(selectedTenant?.shape?.solo === true || selectedTenant?.teamSize === 'solo' ? 'solo' : selectedTenant?.teamSize === 'team' ? 'small' : null);
  }, [tenantId, selectedTenant]);
  const pickKind = (k: FoodKind) => { setKind(k); if (!waysTouched) setWays(usualWays(k)); setDone(null); };
  const toggleWay = (w: OrderWay) => { setWaysTouched(true); setWays((cur) => (cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w])); setDone(null); };
  const answers: FoodAnswers | null = kind ? { kind, ways: ways.length ? ways : usualWays(kind), team: team || 'small' } : null;
  const key = answers ? `${answers.kind}|${answers.ways.slice().sort().join(',')}|${answers.team}` : '';

  // The plan, read again when the answers change.
  React.useEffect(() => {
    if (!answers || !tenantId || !manager) return; let live = true; setPlanErr('');
    void payPost('/api/food-setup', { tenantId, action: 'plan', answers }).then((r: any) => {
      if (!live) return;
      if (!r?.ok) { setPlanErr(r?.error || 'The plan didn’t load. Try again.'); return; }
      // Ones taken off before start unticked: they come back only if ticked again.
      const h = { items: [], ingredients: [], removed: [], ...(r.have || {}) };
      setPlan(r.plan); setHave(h); setStations(r.plan.stations); setSkip(new Set(h.removed));
    });
    return () => { live = false; };
  }, [key, tenantId, manager, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const addStation = () => { const n = newStation.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); if (!n || stations.some((s) => s.toLowerCase() === n.toLowerCase()) || stations.length >= MAX_STATIONS) return; setStations([...stations, n]); setNewStation(''); };
  const usingOwn = !!plan?.ownStations && keepMine;
  const apply = async () => {
    if (!answers || !plan || busy) return;
    if (!usingOwn && !stations.length) { setErr('Keep at least one place where things are made.'); return; }
    setBusy(true); setErr('');
    const r: any = await payPost('/api/food-setup', { tenantId, action: 'apply', answers, stations: usingOwn ? null : stations, menu, skip: Array.from(skip), restore: have.removed.filter((k) => !skip.has(k)) });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t work. Try again.'); return; }
    setDone({ items: r.added.items, ingredients: r.added.ingredients, keptItems: r.kept.items }); void g.reload(); setRound((n) => n + 1);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* */ }
  };
  const fresh = plan ? plan.items.filter((x) => !have.items.includes(x.key)) : [];
  const adding = fresh.filter((x) => !skip.has(x.key));
  const needed = plan?.tools.filter((t) => t.fit !== 'not needed') || [];
  const spare = plan?.tools.filter((t) => t.fit === 'not needed' && t.on) || [];
  const steps = (g.steps || []).filter((s) => !s.done);

  return (
    <div className="cf-settings min-h-full">
      <AppHeader title="Settings" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 md:px-10 md:pt-10" style={{ color: C.ink }}>
        <Link href="/settings/setup" className="mb-3 inline-flex h-11 items-center gap-1 text-[17px]" style={{ color: C.ink }}><ChevronLeft className="h-5 w-5" aria-hidden />Set up your business</Link>
        {!tenantId || role == null ? <p className="text-[15px]" style={{ color: C.muted }}>Loading…</p> : !manager ? <p className="text-[15px]" style={{ color: C.muted }}>Setting up the business is for owners and managers.</p> : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.15fr]">
            <div className="min-w-0 space-y-5">
              <LargeTitle title="Set up for food and drink" sub="Three questions, then a plan to look over before anything changes." />
              {done && (
                <div role="status" className="space-y-3 rounded-2xl p-5" style={{ background: C.okSoft }}>
                  <p className="text-[16px] font-semibold" style={{ color: C.ok }}>Set up as {kindLabel(kind).toLowerCase()}.{done.items ? ` ${done.items} menu ${done.items === 1 ? 'item' : 'items'} and ${done.ingredients} ${done.ingredients === 1 ? 'ingredient' : 'ingredients'} added.` : ''}</p>
                  {done.items > 0 && <p className="text-[14px]" style={{ color: C.ink }}>They’re off your menu until you give each one a price.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Link href="/menu" className="inline-flex h-11 items-center rounded-full px-5 text-[14.5px] font-semibold" style={{ background: C.ink, color: C.paper }}>Set your prices</Link>
                    <Link href="/settings/setup" className="inline-flex h-11 items-center rounded-full px-5 text-[14.5px] font-semibold" style={{ background: C.paper, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.line}` }}>Your next steps</Link>
                  </div>
                </div>
              )}
              <section aria-labelledby="kind" className="space-y-2">
                <h2 id="kind" className="text-[17px] font-semibold">What do you run?</h2>
                {FOOD_KINDS.map((k) => (
                  <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => pickKind(k.value)} className="block min-h-[56px] w-full rounded-2xl px-4 py-2.5 text-left"
                    style={kind === k.value ? { background: C.paper, boxShadow: `inset 0 0 0 2px ${C.ink}` } : { background: C.paper, boxShadow: `inset 0 0 0 1px ${C.line}` }}>
                    <span className="block text-[15.5px] font-semibold">{k.label}</span><span className="block text-[13.5px]" style={{ color: C.muted }}>{k.sub}</span>
                  </button>))}
              </section>
              {kind && <section aria-labelledby="ways" className="space-y-2">
                <h2 id="ways" className="text-[17px] font-semibold">How do guests order?</h2>
                <div className="flex flex-wrap gap-2">{ORDER_WAYS.map((w) => <button key={w.value} type="button" aria-pressed={ways.includes(w.value)} onClick={() => toggleWay(w.value)} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold" style={chip(ways.includes(w.value))}>{w.label}</button>)}</div>
                {!ways.length && <p className="text-[13px]" style={{ color: C.muted }}>None picked: the usual for {kindLabel(kind).toLowerCase()}.</p>}
              </section>}
              {kind && <section aria-labelledby="team" className="space-y-2">
                <h2 id="team" className="text-[17px] font-semibold">Who’s working?</h2>
                <div className="flex flex-wrap gap-2">{TEAM_SIZES.map((t) => <button key={t.value} type="button" aria-pressed={team === t.value} onClick={() => { setTeam(t.value); setDone(null); }} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold" style={chip(team === t.value)}>{t.label}</button>)}</div>
              </section>}
            </div>

            <div className="min-w-0">
              {!kind ? <div className="rounded-2xl p-5 text-[15px]" style={{ background: C.soft, color: C.muted }}>Pick what you run, and your plan shows here.</div>
                : planErr ? <div role="alert" className="rounded-2xl p-5 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{planErr}</div>
                : !plan ? <div className="rounded-2xl p-5 text-[15px]" style={{ background: C.soft, color: C.muted }}>Working out your plan…</div> : (
                <div className="space-y-5 rounded-2xl p-5" style={{ background: C.soft }}>
                  <div><h2 className="text-[20px] font-semibold">Your setup plan</h2><p className="text-[14px]" style={{ color: C.muted }}>Nothing changes until you tap Set it up.</p></div>

                  <section aria-labelledby="where" className="space-y-2">
                    <h3 id="where" className="text-[16px] font-semibold">Where things are made</h3>
                    {plan.ownStations && <div className="flex flex-wrap gap-2">
                      <button type="button" aria-pressed={keepMine} onClick={() => setKeepMine(true)} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold" style={chip(keepMine)}>Keep mine: {plan.ownStations.join(', ')}</button>
                      <button type="button" aria-pressed={!keepMine} onClick={() => setKeepMine(false)} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold" style={chip(!keepMine)}>Use these instead</button>
                    </div>}
                    {!usingOwn && <>
                      <div className="flex flex-wrap gap-2">{stations.map((s) => (
                        <span key={s} className="inline-flex min-h-[44px] items-center gap-1 rounded-full pl-4 pr-1 text-[14px] font-semibold" style={{ background: C.ink, color: C.paper }}>{s}
                          <button type="button" onClick={() => setStations(stations.filter((x) => x !== s))} aria-label={`Take away ${s}`} className="grid h-10 w-10 place-items-center rounded-full"><X className="h-4 w-4" aria-hidden /></button></span>))}</div>
                      <div className="flex gap-2"><input value={newStation} onChange={(e) => setNewStation(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStation(); } }} maxLength={NAME_MAX} placeholder="Another place, like Grill" aria-label="Add a place where things are made"
                        className="h-11 min-w-0 flex-1 rounded-xl px-3 text-[15px]" style={{ background: C.paper, boxShadow: `inset 0 0 0 1px ${C.line}` }} />
                        <button type="button" onClick={addStation} disabled={!newStation.trim()} className="h-11 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ background: C.paper, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.line}` }}>Add</button></div>
                    </>}
                    <p className="text-[13.5px]" style={{ color: C.muted }}>Each one gets its own kitchen screen and printer.</p>
                    {plan.courses && <p className="text-[13.5px]" style={{ color: C.muted }}>Courses for table service: {plan.courses.map((c) => `${c.name}${c.hold ? ' (held until fired)' : ''}`).join(', ')}. {Array.isArray(selectedTenant?.kitchenSettings?.courses) ? 'You set your own, so yours are kept.' : 'You can change them on the Menu page.'}</p>}
                  </section>

                  <section aria-labelledby="starter" className="space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1"><h3 id="starter" className="text-[16px] font-semibold">A starter menu, with recipes</h3>
                        <p className="text-[13.5px]" style={{ color: C.muted }}>{plan.items.length} items and the {plan.ingredients.length} ingredients they use. What each costs to make in ingredients and packaging (not time or waste), and a suggested price that would keep that cost at a usual share of it. You set your own prices.</p></div>
                      <button type="button" role="switch" aria-checked={menu} onClick={() => setMenu(!menu)} className="min-h-[44px] shrink-0 rounded-full px-4 text-[14px] font-semibold" style={chip(menu)}>{menu ? 'Adding it' : 'Not adding it'}</button>
                    </div>
                    {menu && <div className="overflow-hidden rounded-2xl" style={{ background: C.paper }}>
                      {plan.items.map((x, n) => {
                        const already = have.items.includes(x.key); const on = !already && !skip.has(x.key); const isOpen = open === x.key;
                        return (
                          <div key={x.key} style={n ? { borderTop: `1px solid ${C.line}` } : undefined}>
                            <div className="flex min-h-[52px] items-center gap-2 pl-2 pr-3">
                              <button type="button" role="checkbox" aria-checked={on} disabled={already} aria-label={already ? `${x.name} is already on your menu` : `Add ${x.name}`} onClick={() => setSkip((cur) => { const s = new Set(cur); if (s.has(x.key)) s.delete(x.key); else s.add(x.key); return s; })}
                                className="grid h-11 w-11 shrink-0 place-items-center disabled:opacity-40">
                                <span aria-hidden className="grid h-5 w-5 place-items-center rounded-md" style={on ? { background: C.ink } : { boxShadow: `inset 0 0 0 1.5px ${C.muted}` }}>{on && <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                              </button>
                              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : x.key)} className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 text-left">
                                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{x.name}</span>
                                  <span className="block text-[12.5px]" style={{ color: C.muted }}>{already ? 'Already on your menu: kept as it is' : have.removed.includes(x.key) ? 'You took this off before: tick it to add it back' : `${x.section}, made at ${x.station}`}</span></span>
                                <span className="shrink-0 text-right tabular-nums"><span className="block text-[14.5px] font-semibold">costs {money(x.cost)}</span><span className="block text-[12.5px]" style={{ color: C.muted }}>{money(x.suggested)} suggested</span></span>
                                <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: C.muted, transform: isOpen ? 'rotate(180deg)' : undefined }} aria-hidden />
                              </button>
                            </div>
                            {isOpen && <div className="space-y-1 px-4 pb-3 pl-14 text-[13.5px]">
                              {x.lines.map((l) => <div key={l.name} className="flex gap-3"><span className="min-w-0 flex-1">{l.name}</span><span className="shrink-0 tabular-nums" style={{ color: C.muted }}>{amount(l.amount)} {l.unit}</span><span className="w-14 shrink-0 text-right tabular-nums">{money(l.cost)}</span></div>)}
                              <p style={{ color: C.muted }}>{money(x.suggested)} keeps its cost at {pct(x.target)}.{x.allergens.length ? ` Likely contains ${x.allergens.map((k) => (ALLERGENS.find((a) => a.key === k)?.label || k).toLowerCase()).join(', ')}: you check this against your own products.` : ''}</p>
                            </div>}
                          </div>);
                      })}
                    </div>}
                    <p className="text-[13.5px]" style={{ color: C.muted }}>Ingredient costs are rough typical US prices, marked as typical until you change them to what you pay. Nothing goes on your menu until you set its price.</p>
                  </section>

                  <section aria-labelledby="tools" className="space-y-2">
                    <h3 id="tools" className="text-[16px] font-semibold">Tools that fit your business</h3>
                    <ul className="space-y-1.5 text-[14px]">{needed.map((t) => <li key={t.id}><b className="font-semibold">{t.name}</b>{t.fit === 'helps' ? ', helpful' : ''}: {t.why}. <span style={{ color: t.on ? C.ok : C.warn }}>{t.on ? 'On' : 'Off now'}</span></li>)}</ul>
                    {spare.length > 0 && <p className="text-[13.5px]" style={{ color: C.muted }}>On now, and you may not need: {spare.map((t) => t.name).join(', ')}.</p>}
                    <Link href="/subscriptions" className="inline-flex min-h-[44px] items-center text-[14px] font-semibold underline underline-offset-4">Change your tools</Link>
                  </section>

                  {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: C.warn }}>{err}</p>}
                  <button type="button" onClick={apply} disabled={busy} className="h-12 w-full rounded-full text-[15.5px] font-semibold disabled:opacity-50" style={{ background: C.ink, color: C.paper }}>
                    {busy ? 'Setting it up…' : menu && adding.length ? `Set it up, with ${adding.length} menu ${adding.length === 1 ? 'item' : 'items'}` : 'Set it up'}</button>
                </div>
              )}
              {done && steps.length > 0 && <div className="mt-5 overflow-hidden rounded-2xl" style={{ background: C.soft }}>
                <p className="px-4 pt-4 text-[16px] font-semibold">Next steps</p>
                {steps.slice(0, 7).map((s, i) => <Link key={s.id} href={stepHref(s)} className="flex min-h-[56px] items-center gap-3 px-4" style={i ? { borderTop: `1px solid ${C.line}` } : undefined}>
                  <span className="min-w-0 flex-1 text-[15.5px]">{s.title}</span>{s.note && <span className="shrink-0 text-[13px]" style={{ color: C.muted }}>{s.note}</span>}</Link>)}
              </div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
