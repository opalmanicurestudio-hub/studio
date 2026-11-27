'use client';
// src/components/money/TaxSetAside.tsx — A TAX SET-ASIDE, for someone self-employed (lib/renter-taxes): a renter in their
// portal (components/rent/RenterTaxes, api/portal/renter-taxes) or the owner on the Money page's Taxes tab
// (api/owner-taxes). No one takes tax out of what they earn, so this says how much to keep back from each dollar, what's
// due on each of the year's four dates (to the IRS and their state), and keeps the payments they've made, with reminders
// the week before each. A renter's from what they earn through ClarityFlow less their write-offs; the owner's from the
// books' profit (Schedule C) less business miles. An estimate to set money aside by: their accountant works out what
// they owe.
import * as React from 'react';
import { taxPlan, FILINGS, type Filing, type Payment } from '@/lib/renter-taxes';
import { STATE_OPTIONS } from '@/lib/state-tax-profiles';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-40 ${RING}`;
const field = `h-11 w-full rounded-xl border bg-[#fff] px-3 text-[15px] ${RING}`;
const card = 'rounded-[20px] bg-[#fff] px-4';
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
const usd2 = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const md = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const mdy = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dollars = (c: number | null | undefined) => (c == null ? '' : String(Math.round(c / 100)));

export type Who = 'renter' | 'owner';
const WORDS = {
  renter: { earned: 'Earned', off: 'Write-offs', keep: 'You keep', none: 'Nothing to set aside yet: what you’ve earned this year doesn’t top your write-offs so far.', keepWord: 'from what you keep after costs', inbox: 'In my portal', inboxSaid: 'You’ll see a reminder on Today.', noEmail: 'Your email isn’t on file with the business you rent from, so reminders show in your portal.', seeOff: 'See your write-offs',
    outside: 'Business income outside ClarityFlow so far this year', outsideSub: 'Cash, payment apps, tips paid to you, other places you work for yourself. Your online shop sales are counted already.',
    from: 'From what you earn through ClarityFlow and tips the front desk collected for you, less your write-offs' },
  owner: { earned: 'Profit in your books', off: 'Business miles', keep: 'Taxed on', none: 'Nothing to set aside yet: the books show no profit this year so far.', keepWord: 'from the business’s profit', inbox: 'In ClarityFlow', inboxSaid: 'You’ll see a reminder on the Money page.', noEmail: 'Your own email isn’t on file, so reminders show on the Money page.', seeOff: 'See write-offs',
    outside: 'Business income not in your books so far this year', outsideSub: 'Cash or payments you haven’t recorded. Better still, add them to Books.',
    from: 'From the books’ profit (Schedule C, as the Tax summary in Reports works it out) less business miles from your mileage log' },
} as const;

type Data = { milesLeftOut?: boolean; countedAt?: string | null; year: number; today: string; lastYearOpen?: boolean; lastYearPayments?: Payment[]; remind?: 'off' | 'inbox' | 'email'; hasEmail?: boolean; table: { year: number; stale: boolean }; earnedByMonth: Record<string, number>; writeOffsByMonth: Record<string, number>;
  settings: { structure?: 'schedule_c' | 'other' | null; filing: Filing; state: string; statePct: number; stateName: string; stateType: string | null; otherCents: number; outsideCents: number; lastYearTaxCents: number | null; lastYearHigh?: boolean }; payments: Payment[] };

function PayForm({ today, stateName, noState, year, lastYearOpen, busy, onSave, onCancel }: { today: string; stateName: string; noState: boolean; year: number; lastYearOpen: boolean; busy: boolean; onSave: (x: any) => void; onCancel: () => void }) {
  const [forYear, setForYear] = React.useState(year);
  const [date, setDate] = React.useState(today); const [amount, setAmount] = React.useState(''); const [to, setTo] = React.useState<'irs' | 'state'>('irs');
  return <div className="flex flex-col gap-3 rounded-2xl p-3" style={{ background: SOFT }}>
    {!noState && <div className="flex gap-2">{(['irs', 'state'] as const).map((x) => <button key={x} type="button" aria-pressed={to === x} onClick={() => setTo(x)} className={`${btn} flex-1`} style={to === x ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{x === 'irs' ? 'The IRS' : stateName || 'My state'}</button>)}</div>}
    {lastYearOpen && <div className="flex gap-2">{[year, year - 1].map((y) => <button key={y} type="button" aria-pressed={forYear === y} onClick={() => setForYear(y)} className={`${btn} flex-1`} style={forYear === y ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>For {y}</button>)}</div>}
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Day paid</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={field} style={{ borderColor: LINE }} /></label>
      <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Amount</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,$]/g, '').slice(0, 12))} placeholder="850" className={field} style={{ borderColor: LINE }} /></label>
    </div>
    <div className="flex gap-2">
      <button type="button" disabled={busy || !amount} onClick={() => onSave({ date, amount, to, forYear })} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Save payment'}</button>
      <button type="button" onClick={onCancel} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Cancel</button>
    </div>
  </div>;
}

function About({ d, who, busy, onSave }: { d: Data; who: Who; busy: boolean; onSave: (x: any) => void }) {
  const s = d.settings; const W = WORDS[who];
  const [structure, setStructure] = React.useState<string>(s.structure || '');
  const [filing, setFiling] = React.useState<Filing>(s.filing); const [state, setState] = React.useState(s.state);
  const [other, setOther] = React.useState(dollars(s.otherCents || null)); const [outside, setOutside] = React.useState(dollars(s.outsideCents || null)); const [last, setLast] = React.useState(dollars(s.lastYearTaxCents));
  const [high, setHigh] = React.useState(!!s.lastYearHigh);
  const money = (v: string, set: (x: string) => void) => set(v.replace(/[^\d.,$]/g, '').slice(0, 12));
  return <section aria-label="About you" className={`${card} flex flex-col gap-3 py-4`}>
    <h2 className="text-[16px] font-semibold">About you</h2>
    <p className="-mt-2 text-[13px]" style={{ color: MUTED }}>So the estimate fits you. Kept only for this, and seen only by you.</p>
    {who === 'owner' && <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>How the business files</span>
      <select value={structure} onChange={(e) => setStructure(e.target.value)} className={field} style={{ borderColor: LINE }}><option value="">Pick one</option><option value="schedule_c">On my own return (Schedule C): just me, or a one-owner LLC</option><option value="other">Its own return: an S corporation, a partnership or a corporation</option></select></label>}
    <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
      <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>How you file</span>
        <select value={filing} onChange={(e) => setFiling(e.target.value as Filing)} className={field} style={{ borderColor: LINE }}>{FILINGS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Your state</span>
        <select value={state} onChange={(e) => setState(e.target.value)} className={field} style={{ borderColor: LINE }}><option value="">Pick one</option>{STATE_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}</select></label>
    </div>
    <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>{W.outside}</span>
      <input inputMode="decimal" value={outside} onChange={(e) => money(e.target.value, setOutside)} placeholder="0" className={field} style={{ borderColor: LINE }} />
      <span className="text-[12px]" style={{ color: MUTED }}>{W.outsideSub}</span></label>
    <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Other income in your household this year</span>
      <input inputMode="decimal" value={other} onChange={(e) => money(e.target.value, setOther)} placeholder="0" className={field} style={{ borderColor: LINE }} />
      <span className="text-[12px]" style={{ color: MUTED }}>A job with a paycheck, or a partner’s pay if you file together. Your business is taxed on top of it.</span></label>
    <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Last year’s total tax, if you know it</span>
      <input inputMode="decimal" value={last} onChange={(e) => money(e.target.value, setLast)} placeholder="From your last return" className={field} style={{ borderColor: LINE }} /></label>
    {last && <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px]"><input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} className="h-5 w-5 accent-[#16171a]" />Last year’s income was over $150,000</label>}
    <button type="button" disabled={busy} onClick={() => onSave({ ...(who === 'owner' && structure ? { structure } : {}), filing, ...(state ? { state } : {}), other: other || null, outside: outside || null, lastYearTax: last || null, lastYearHigh: !!last && high })} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
  </section>;
}

export function TaxSetAside({ who, post, onWriteOffs }: { who: Who; post: (body: any) => Promise<any>; onWriteOffs?: (() => void) | null }) {
  const W = WORDS[who];
  const [d, setD] = React.useState<Data | null>(null); const [err, setErr] = React.useState(''); const [said, setSaid] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null); const [paying, setPaying] = React.useState(false);
  // (After a save, only what was said and paid comes back: the year's figures stay as they were read.)
  const load = React.useCallback(async (o: { keep?: boolean; fresh?: boolean } = {}) => {
    const r = await post({ action: 'list', ...(o.keep ? { figures: false } : {}), ...(o.fresh ? { fresh: true } : {}) });
    if (r?.ok) { setD((was) => (o.keep && was && !r.earnedByMonth ? { ...r, earnedByMonth: was.earnedByMonth, writeOffsByMonth: was.writeOffsByMonth, milesLeftOut: was.milesLeftOut, countedAt: was.countedAt } : r)); setErr(''); }
    else setErr(r?.error || 'That didn’t load. Try again.');
  }, [post]);
  React.useEffect(() => { void load(); }, [load]);
  const act = async (key: string, body: any, done: string) => {
    setBusy(key); setErr(''); setSaid('');
    const r = await post(body); setBusy(null);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through. Try again.'); return false; }
    setSaid(done); await load({ keep: true }); return true;
  };
  const plan = React.useMemo(() => d ? taxPlan({ year: d.year, today: d.today, earnedByMonth: d.earnedByMonth, writeOffsByMonth: d.writeOffsByMonth, outsideCents: d.settings.outsideCents,
    otherCents: d.settings.otherCents, filing: d.settings.filing, statePct: d.settings.statePct, lastYearTaxCents: d.settings.lastYearTaxCents, lastYearHigh: !!d.settings.lastYearHigh, payments: d.payments }) : null, [d]);

  if (!d || !plan) return <p className="px-1 text-[15px]" style={{ color: err ? AMBER : MUTED }}>{err || 'Working out your year…'}</p>;
  const s = d.settings; const n = plan.next; const stateName = s.stateName || 'your state'; const noStateTax = s.stateType === 'none';
  const cents = Math.round(plan.pace.perDollar * 100);
  const msg = (err || said) && <p role={err ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-[14px]" style={err ? { background: AMBER_TINT, color: AMBER } : { background: GREEN_TINT, color: GREEN }}>{err || said}</p>;
  const about = <About key={JSON.stringify(s)} d={d} who={who} busy={busy === 'settings'} onSave={(x) => act('settings', { action: 'settings', ...x }, 'Saved.')} />;
  // (The owner's only for a business that files on Schedule C: one with its own return pays its tax its own way.)
  if (who === 'owner' && s.structure !== 'schedule_c') return <div className="flex flex-col gap-3.5" style={{ color: INK }}>
    <section aria-label="Taxes to set aside" className={`${card} flex flex-col gap-1 py-4`}>
      <h2 className="text-[16px] font-semibold">Taxes to set aside</h2>
      <p className="text-[14px]" style={{ color: MUTED }}>{s.structure === 'other' ? 'A partnership or an S corporation passes its profit to its owners’ own returns, and the owners often pay estimated tax on their share (an S corporation’s pay to you goes through payroll); a corporation pays its own tax. Your accountant works out those payments.' : 'How much to keep back from the business’s profit for taxes, and what’s due on each of the year’s four dates. First, say how the business files, below.'}</p>
    </section>
    {msg}
    {about}
  </div>;

  return <div className="flex flex-col gap-3.5" style={{ color: INK }}>
    <section aria-label="Set aside" className={`${card} flex flex-col gap-1 py-4`}>
      <p className="text-[13px] font-semibold" style={{ color: MUTED }}>{d.year} so far</p>
      {plan.soFar.netCents > 0 ? <>
        <p className="text-[34px] font-semibold tracking-[-0.02em]">{cents}¢ <span className="text-[17px]" style={{ color: MUTED }}>of each dollar</span></p>
        <p className="text-[14px]">Set this much aside {W.keepWord}. At this pace, the year’s tax is about <span className="font-semibold">{usd(plan.pace.total)}</span>.</p>
        <p className="text-[13px]" style={{ color: MUTED }}>Self-employment tax {usd(plan.pace.se)}, federal income tax {usd(plan.pace.federal)}{noStateTax ? `, and no state income tax in ${stateName}` : s.state ? `, ${stateName} ${usd(plan.pace.state)}` : '. Pick your state below for the state’s part'}.</p>
      </> : <p className="text-[15px]" style={{ color: MUTED }}>{W.none}</p>}
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl p-3 text-[13px]" style={{ background: SOFT }}>
        <div><span className="block" style={{ color: MUTED }}>{W.earned}</span><span className="font-semibold">{usd(plan.soFar.inCents)}</span></div>
        <div><span className="block" style={{ color: MUTED }}>{W.off}</span><span className="font-semibold">{usd(plan.soFar.writeOffsCents)}</span></div>
        <div><span className="block" style={{ color: MUTED }}>{W.keep}</span><span className="font-semibold">{usd(Math.max(0, plan.soFar.netCents))}</span></div>
      </div>
      {who === 'owner' && d.milesLeftOut && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>Business miles aren’t taken off: your books have car costs this year, and the mileage rate stands in for those. Your accountant picks one or the other.</p>}
      <div className="mt-1 flex flex-wrap gap-x-4">
        {onWriteOffs && <button type="button" onClick={onWriteOffs} className={`${btn} px-0`} style={{ color: INK }}>{W.seeOff}</button>}
        {who === 'owner' && <button type="button" disabled={busy === 'fresh'} onClick={async () => { setBusy('fresh'); setErr(''); setSaid(''); await load({ fresh: true }); setBusy(null); setSaid('Counted the whole year again.'); }} className={`${btn} px-0`} style={{ color: MUTED }}>{busy === 'fresh' ? 'Counting…' : 'Count the year again'}</button>}
      </div>
    </section>
    {msg}

    {n && <section aria-label="Next payment" className={`${card} flex flex-col gap-2 py-4`}>
      <p className="text-[13px] font-semibold" style={{ color: n.when === 'now' ? AMBER : MUTED }}>Next payment, due {mdy(n.due)}</p>
      <div className="flex items-baseline justify-between gap-3"><span className="text-[15px]">To the IRS</span><span className="text-[22px] font-semibold">{usd(n.irsCents)}</span></div>
      {!noStateTax && s.state && <div className="flex items-baseline justify-between gap-3"><span className="text-[15px]">To {stateName}</span><span className="text-[18px] font-semibold">{usd(n.stateCents)}</span></div>}
      <p className="text-[13px]" style={{ color: MUTED }}>The tax on what you’ve earned through {md(n.through)}, less what you’ve paid.{n.safeCents != null ? ` Or pay ${usd(n.safeCents)} to the IRS (a quarter of ${s.lastYearHigh ? '110% of ' : ''}last year’s tax for each date so far): that also avoids a penalty, even if this year’s bill is higher.` : ''}</p>
      {!noStateTax && s.state && <p className="text-[13px]" style={{ color: MUTED }}>Most states use the same dates. Check {stateName}’s.</p>}
      <div className="flex flex-wrap gap-2">
        <a href="https://www.irs.gov/payments" target="_blank" rel="noopener noreferrer" className={btn} style={{ background: INK, color: '#fff' }}>Pay the IRS online</a>
        <button type="button" onClick={() => { setErr(''); setSaid(''); setPaying(true); }} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${INK}` }}>I paid</button>
      </div>
      {paying && <PayForm today={d.today} stateName={s.stateName} noState={noStateTax || !s.state} year={d.year} lastYearOpen={!!d.lastYearOpen} busy={busy === 'pay'} onCancel={() => setPaying(false)} onSave={(x) => act('pay', { action: 'pay', ...x }, x.forYear === d.year ? 'Payment saved.' : `Payment saved toward ${x.forYear}.`).then((ok) => { if (ok) setPaying(false); })} />}
    </section>}

    <section aria-label="The year’s four dates" className={`${card} pb-1`}>
      <h2 className="pb-1 pt-3 text-[16px] font-semibold">The year’s four dates</h2>
      {plan.quarters.map((q) => <div key={q.q} className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{mdy(q.due)}</span>
          <span className="block text-[13px]" style={{ color: MUTED }}>{q.when === 'later' ? `For what you earn through ${md(q.through)}` : `Paid ${usd(q.irsPaid + q.statePaid)} by then`}</span></div>
        <span className="shrink-0 text-right text-[14px] font-semibold" style={{ color: q.when === 'past' ? (q.irsCents + q.stateCents > 0 ? AMBER : GREEN) : INK }}>
          {q.when === 'later' ? 'Later' : q.irsCents + (noStateTax ? 0 : q.stateCents) > 0 ? `${usd(q.irsCents + (noStateTax ? 0 : q.stateCents))} ${q.when === 'past' ? 'not marked paid' : 'to pay'}` : q.irsDueSoFar + (noStateTax ? 0 : q.stateDueSoFar) > 0 ? 'Paid' : 'Nothing due'}</span>
      </div>)}
    </section>

    {[{ y: d.year, list: d.payments }, { y: d.year - 1, list: d.lastYearPayments || [] }].filter((g) => g.list.length > 0).map((g) => <section key={g.y} aria-label={`Payments toward ${g.y}`} className={`${card} pb-1`}>
      <h2 className="pb-1 pt-3 text-[16px] font-semibold">{g.y === d.year ? 'Payments you’ve made' : `Payments toward ${g.y}`}</h2>
      {[...g.list].sort((a, b) => b.date.localeCompare(a.date)).map((p) => <div key={p.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
        <span className="min-w-0 flex-1 text-[15px]">{p.to === 'irs' ? 'The IRS' : stateName}, {md(p.date)}</span>
        <span className="text-[15px] font-semibold">{usd2(p.cents)}</span>
        <button type="button" disabled={!!busy} onClick={() => act(`u_${p.id}`, { action: 'unpay', id: p.id, forYear: g.y }, 'Taken off.')} className={btn} style={{ background: SOFT, color: INK }}>Take off</button>
      </div>)}
    </section>)}

    <section aria-label="Reminders" className={`${card} flex flex-col gap-2 py-4`}>
      <h2 className="text-[16px] font-semibold">Reminders</h2>
      <p className="-mt-1 text-[13px]" style={{ color: MUTED }}>The week before each date.</p>
      <div className="flex gap-2">{([['off', 'Off'], ['inbox', W.inbox], ['email', 'Email too']] as const).map(([v, label]) => <button key={v} type="button" aria-pressed={(d.remind || 'inbox') === v} disabled={!!busy || (v === 'email' && !d.hasEmail)}
        onClick={() => act('remind', { action: 'remind', channel: v }, v === 'off' ? 'Reminders off.' : v === 'inbox' ? W.inboxSaid : 'You’ll get an email too.')} className={`${btn} flex-auto whitespace-nowrap px-3`}
        style={(d.remind || 'inbox') === v ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{label}</button>)}</div>
      {!d.hasEmail && <p className="text-[12px]" style={{ color: MUTED }}>{W.noEmail}</p>}
    </section>

    {about}

    <p className="px-1 text-[13px]" style={{ color: MUTED }}>An estimate to set money aside by, not your tax bill: your accountant works out what you owe. {W.from}, with {d.table.year}’s tax figures{d.table.stale ? ` until ${d.year}’s are in` : ''}. It counts the 20% deduction for business income, but not the extra 0.9% Medicare tax past $200,000, wages from a job toward the Social Security limit, or deductions like the one for tips. It asks for all of each date’s share, to be safe: the least that avoids a penalty is 90%.</p>
  </div>;
}
