'use client';
// src/components/money/WriteOffsScreen.tsx — WRITE-OFFS on the Money page (design board "Write-offs: found for you,
// finished by you"). Write-offs that are easy to miss, found from what ClarityFlow already holds and kept with their
// proof: business miles (api/mileage, lib/trip-log), then what the year's lines show (api/writeoffs, lib/write-offs):
// meals counted by kind, classes, for the owner purchases on a personal account from places the business books costs
// from (for the business, or personal), equipment for the accountant; what's left to finish (who and why for a meal, a
// receipt for $75 or more, how many people a gift was for); the tip credit (Form 8846, from the paydays: lib/tip-credit)
// and stock written off; usual costs with nothing booked; and what's often missed and isn't in the books, asked once a
// year. All of it prints for the accountant.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { milesText } from '@/lib/trip-log';
import { CHECKLIST, MEAL_ASKS, MEAL_KINDS, USUAL_COSTS, writeOffsBodyHtml, type Extras, type Found, type Line, type MealKind } from '@/lib/write-offs';
import { printPage } from '@/lib/print-style';
import { ImageUpload } from '@/components/shared/ImageUpload';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold ${RING}`;
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Miles = { year: number; summary: { trips: number; businessTenths: number; amountCents: number; rate: { label: string; year: number; stale: boolean } }; suggestions: unknown[]; drive: { ended: string | null } | null };

export function MilesWriteOff({ data, canLog, err }: { data: Miles | null; canLog: boolean; err?: string }) {
  if (!canLog) return (
    <section aria-label="Business miles" className="rounded-3xl bg-[#fff] p-5">
      <h2 className="text-[18px] font-bold">Business miles</h2>
      <p className="mt-1 text-[14px]" style={{ color: MUTED }}>The owner keeps the mileage log, and people whose role includes keeping the books can see it.</p>
    </section>);
  const s = data?.summary; const waiting = data?.suggestions?.length || 0;
  return (
    <section aria-label="Business miles" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ color: INK }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold">Business miles</h2>
          {!data ? <p className="mt-1 text-[14px]" style={{ color: err ? AMBER : MUTED }}>{err || 'Loading…'}</p>
            : s && s.trips > 0 ? <p className="mt-1 text-[15px]">{milesText(s.businessTenths)} miles in {s.trips} trip{s.trips === 1 ? '' : 's'} this year, at the IRS rate of {s.rate.label} a mile{s.rate.stale ? ` (${s.rate.year}’s, until ${data.year}’s is in)` : ''}.</p>
            : <p className="mt-1 max-w-[620px] text-[15px]" style={{ color: MUTED }}>Drives for supplies, the bank, classes, events and clients add up, and are often never claimed because they’re hard to work out and prove. Log them as you go: the miles come from the map, and each trip is kept with its date, place and reason.</p>}
        </div>
        {data && <span className="text-[24px] font-bold tracking-[-0.01em]" style={{ color: s && s.trips ? GREEN : MUTED }}>{usd(s?.amountCents || 0)}</span>}
      </div>
      {data?.drive && !data.drive.ended && <p className="rounded-2xl px-4 py-3 text-[14px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>A drive is under way. End it in Mileage when you get there.</p>}
      {waiting > 0 && <p className="text-[14px]" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}><span className="font-semibold">{waiting} drive{waiting === 1 ? '' : 's'} to check</span><span style={{ color: MUTED }}>, from your card purchases and events. One tap logs each, with its proof.</span></p>}
      <div className="flex flex-wrap gap-2">
        <a href="/mileage" className={btn} style={{ background: INK, color: '#fff' }}>{waiting > 0 ? 'Check them in Mileage' : 'Open mileage'}</a>
      </div>
    </section>
  );
}

type W = { year: number; years: number[]; found: Found; checklist: Record<string, string>; owner: boolean; partial?: boolean } & Extras;
const md = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const field = `h-11 w-full rounded-xl border bg-[#fff] px-3 text-[15px] ${RING}`;

async function call(url: string, body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
}

function Row({ title, sub, value, children }: { title: string; sub: string; value?: string; children?: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 py-3.5" style={{ borderTop: `1px solid ${LINE}` }}>
    <div className="min-w-[220px] flex-1"><span className="block text-[15px] font-semibold">{title}</span><span className="block text-[14px]" style={{ color: MUTED }}>{sub}</span></div>
    {value != null && <span className="ml-auto min-w-[96px] text-right text-[16px] font-bold">{value}</span>}
    {children}
  </div>;
}

function MealForm({ line, onSave, busy }: { line: Line; onSave: (x: any) => void; busy: boolean }) {
  const [kind, setKind] = React.useState<MealKind>(line.meal?.kind || 'business'); const [who, setWho] = React.useState(line.meal?.who || ''); const [why, setWhy] = React.useState(line.meal?.why || '');
  const share = MEAL_KINDS.find((k) => k.id === kind)?.share ?? 0.5; const id = React.useId(); const ask = MEAL_ASKS[kind];
  const ph = kind === 'team' ? ['Everyone on the team', 'Holiday party'] : kind === 'travel' ? ['', 'Trade show in Atlanta'] : ['Maria G., our product rep', 'Spring product order'];
  return <div className="mt-2 flex flex-col gap-3 rounded-2xl p-3" style={{ background: SOFT }}>
    <fieldset className="flex flex-col"><legend className="pb-1 text-[14px] font-semibold">What kind of meal?</legend>
      {MEAL_KINDS.map((k) => <label key={k.id} className="flex min-h-[48px] cursor-pointer items-center gap-3 py-1.5 text-[14px]">
        <input type="radio" name={`${id}-kind`} checked={kind === k.id} onChange={() => setKind(k.id)} className="h-5 w-5 accent-[#16171a]" />
        <span className="flex-1"><span className="block font-semibold">{k.label}</span>{k.sub && <span className="block text-[13px]" style={{ color: MUTED }}>{k.sub}</span>}</span>
        <span className="text-[13px] font-bold" style={{ color: k.share ? GREEN : MUTED }}>{k.counts}</span></label>)}
    </fieldset>
    {(ask.who || ask.why) && <div className="flex flex-col gap-2">
      {ask.who && <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Who was there</span><input value={who} onChange={(e) => setWho(e.target.value)} maxLength={120} className={field} style={{ borderColor: LINE }} placeholder={ph[0]} /></label>}
      {ask.why && <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>{kind === 'travel' ? 'What the trip was for' : 'What it was about'}</span><input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={120} className={field} style={{ borderColor: LINE }} placeholder={ph[1]} /></label>}
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy || (ask.who && !who.trim()) || (ask.why && !why.trim())} onClick={() => onSave({ kind, who: ask.who ? who : '', why: ask.why ? why : '' })} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
      <span className="text-[14px]"><span className="font-bold" style={{ color: share ? GREEN : MUTED }}>{usd(Math.round(line.cents * share))}</span> of {usd(line.cents)} counts</span>
    </div>
  </div>;
}

export function WriteOffsScreen({ tenantId, canLog, business = '', actor }: { tenantId: string; canLog: boolean; business?: string; actor?: any }) {
  const [miles, setMiles] = React.useState<Miles | null>(null); const [mErr, setMErr] = React.useState('');
  const [w, setW] = React.useState<W | null>(null); const [err, setErr] = React.useState(''); const [said, setSaid] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null); const [open, setOpen] = React.useState<string | null>(null); const [people, setPeople] = React.useState<Record<string, string>>({});
  const load = React.useCallback(async (year?: number) => {
    const r = await call('/api/writeoffs', { tenantId, action: 'list', ...(year ? { year } : {}) });
    if (r?.ok) { setW(r); setErr(''); } else setErr(r?.error || 'Write-offs didn’t load. Try again.');
  }, [tenantId]);
  React.useEffect(() => {
    if (!tenantId || !canLog) return; let on = true;
    void load();
    void call('/api/mileage', { tenantId, action: 'list' }).then((r) => { if (!on) return; if (r?.ok) setMiles(r); else setMErr(r?.error || 'Mileage didn’t load. Try again.'); });
    return () => { on = false; };
  }, [tenantId, canLog, load]);
  const act = async (key: string, url: string, body: any, done: string) => {
    setBusy(key); setErr(''); setSaid('');
    const r = await call(url, { tenantId, ...body }); setBusy(null);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through. Try again.'); return false; }
    setSaid(done); setOpen(null); await load(w?.year); return true;
  };
  const print = () => {
    if (!w) return; const win = window.open('', '_blank'); if (!win) { setErr('Your browser blocked the new window. Allow pop-ups for ClarityFlow and try again.'); return; }
    const m = miles && miles.year === w.year ? { tenths: miles.summary.businessTenths, cents: miles.summary.amountCents, rate: miles.summary.rate.label, trips: miles.summary.trips } : null;
    win.document.write(printPage({ title: `${w.year} write-offs`, heading: `${w.year} <b>write-offs</b>`, shopName: business, subtitle: 'Found in ClarityFlow, for your accountant.', body: writeOffsBodyHtml(w.found, m, w.checklist, { tipCredit: w.tipCredit, stockLoss: w.stockLoss, missing: w.missing }), footNote: 'Meals, gifts and equipment are from the books; miles from the mileage log; the tip credit from the paydays recorded; stock from Inventory. Your accountant decides what goes on the return.' }));
    win.document.close();
  };

  const f = w?.found;
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pb-12 pt-5 md:px-6" style={{ color: INK }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-[680px]">
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">Write-offs</h1>
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>Costs the business can write off that are easy to miss, found from what’s already in ClarityFlow, and the few details that make each one hold up.</p>
        </div>
        {w && <div className="flex flex-wrap items-center gap-2">
          {w.years.map((y) => <button key={y} type="button" aria-pressed={y === w.year} onClick={() => load(y)} className={btn} style={y === w.year ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{y}</button>)}
          <button type="button" onClick={print} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${INK}` }}>Print for your accountant</button>
        </div>}
      </div>
      {(err || said) && <p role={err ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-[14px]" style={err ? { background: AMBER_TINT, color: AMBER } : { background: GREEN_TINT, color: GREEN }}>{err || said}</p>}

      <MilesWriteOff data={miles} canLog={canLog} err={mErr} />

      {!canLog ? null : !f ? <p className="text-[14px]" style={{ color: MUTED }}>{err ? '' : 'Looking through your books…'}</p> : <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Found in your books" className="min-w-0 flex-[999_1_560px] rounded-3xl bg-[#fff] px-5 pb-2 pt-4">
          <h2 className="text-[18px] font-bold">Found in your books</h2>
          {w!.partial && <p className="pb-2 text-[13px]" style={{ color: AMBER }}>There are more of these lines than can be read at once, so some may be missing here. Reports in the Money page read every line.</p>}
          {f.meals.lines.length > 0 && <Row title="Meals" sub={`${usd(f.meals.spent)} spent on ${f.meals.lines.length} meal${f.meals.lines.length === 1 ? '' : 's'}. A business meal or one on a work trip half counts, a party for your employees all counts, entertainment doesn’t.`} value={usd(f.meals.counts)} />}
          {f.education.count > 0 && <Row title="Classes and education" sub={`${f.education.count} line${f.education.count === 1 ? '' : 's'} that keep your skills current`} value={usd(f.education.cents)} />}
          {f.gifts.lines.length > 0 && <Row title="Business gifts" sub={`${usd(f.gifts.spent)} spent. Up to $25 a person a year counts, worked out here gift by gift: if someone got more than one this year, your accountant caps them at $25 in all. Gifts to your employees are usually pay.`} value={usd(f.gifts.counts)} />}
          {w!.owner && f.personal.length > 0 && <Row title="Was this for the business?" sub="Bought on your personal account, at places the business books costs from. If it was for the business, book it as the business’s so it counts.">
            <div className="flex w-full flex-col">{f.personal.map((p) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
              <span className="min-w-0 text-[14px]">{p.title}, {md(p.day)}, <span className="font-semibold">{usd(p.cents)}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={!!busy} onClick={() => act(`p_${p.id}`, '/api/plaid', { actor, action: 'resolve', bankTxnId: p.id, mode: 'create', contextOverride: 'Business' }, `${p.title} is booked as the business’s.`)} className={btn} style={{ background: GREEN_TINT, color: GREEN }}>{busy === `p_${p.id}` ? 'Booking…' : 'Yes, book it'}</button>
                <button type="button" disabled={!!busy} onClick={() => act(`n_${p.id}`, '/api/writeoffs', { action: 'personal', id: p.id }, 'Kept as personal. It won’t be asked about again.')} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{busy === `n_${p.id}` ? 'Saving…' : 'Personal'}</button></span>
            </div>)}</div>
          </Row>}
          {f.equipment.map((e) => <Row key={e.id} title={`Equipment over $2,500: ${e.title}`} sub={`${md(e.day)}. Your accountant chooses whether it’s written off this year or over several.`} value={usd(e.cents)}>
            <button type="button" aria-pressed={!!e.forAccountant} disabled={!!busy} onClick={() => act(`e_${e.id}`, '/api/writeoffs', { action: 'note', id: e.id, on: !e.forAccountant }, e.forAccountant ? 'Unmarked.' : 'Marked for your accountant.')} className={btn} style={e.forAccountant ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{e.forAccountant ? 'Marked for accountant' : 'Mark for accountant'}</button>
          </Row>)}
          {w!.tipCredit && w!.tipCredit.creditCents > 0 && <Row title="Tip credit (Form 8846), an estimate" value={usd(w!.tipCredit.creditCents)}
            sub={`The employer’s 7.65% for Social Security and Medicare (1.45% past the Social Security wage base) on the tips your employees reported (${usd(w!.tipCredit.tipsCents)}), above what tops their pay up to $${w!.tipCredit.minWage.toFixed(2)} an hour, comes back as a credit off the tax itself.${w!.tipCredit.medspa ? ' Tips on medical treatments don’t count, only on esthetics and spa services.' : ''}${w!.tipCredit.noHours ? ` ${w!.tipCredit.noHours} payday${w!.tipCredit.noHours === 1 ? ' was' : 's were'} recorded before hours were kept, so every tip there counts: this is the most it could be.` : ''}${w!.tipCredit.priorLeftOut ? ' Tips paid before ClarityFlow this year aren’t in it.' : ''} Your accountant claims it, and takes the same amount off the payroll tax deduction.`} />}
          {w!.stockLoss && (w!.stockLoss.bookedCents > 0 || w!.stockLoss.unbooked > 0) && <Row title="Stock written off" value={w!.stockLoss.bookedCents > 0 ? usd(w!.stockLoss.bookedCents) : undefined}
            sub={`${w!.stockLoss.bookedCents > 0 ? 'Written off in Inventory and booked then as Spoilage, with cost of goods sold, so it counts already.' : ''}${w!.stockLoss.unbooked > 0 ? `${w!.stockLoss.bookedCents > 0 ? ' ' : ''}${w!.stockLoss.unbooked} more ${w!.stockLoss.unbooked === 1 ? 'was' : 'were'} thrown out or used up early and taken off stock without a line of ${w!.stockLoss.unbooked === 1 ? 'its' : 'their'} own: a year-end inventory count picks ${w!.stockLoss.unbooked === 1 ? 'it' : 'them'} up.` : ''}`} />}
          {!f.meals.lines.length && !f.education.count && !f.gifts.lines.length && !f.personal.length && !f.equipment.length && !(w!.tipCredit?.creditCents) && !w!.stockLoss && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Nothing yet for {w!.year}. Meals, gifts, classes and equipment show here as they’re booked.</p>}
        </section>

        <section aria-label="Finish these" className="min-w-0 flex-[1_1_340px] rounded-3xl bg-[#fff] px-5 pb-2 pt-4">
          <h2 className="text-[18px] font-bold">Finish these</h2>
          <p className="text-[13px]" style={{ color: MUTED }}>The IRS asks for these details, so each write-off holds up.</p>
          {f.toFinish === 0 && <p className="py-3 text-[14px]" style={{ color: GREEN, borderTop: `1px solid ${LINE}` }}>Nothing to finish.</p>}
          {f.meals.needDetail.map((m) => <div key={m.id} className="py-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <button type="button" aria-expanded={open === `m_${m.id}`} onClick={() => setOpen(open === `m_${m.id}` ? null : `m_${m.id}`)} className={`flex min-h-[44px] w-full items-center justify-between gap-3 text-left ${RING}`}>
              <span><span className="block text-[15px] font-semibold">{m.meal?.kind === 'travel' ? 'A meal needs what the trip was for' : 'A meal needs who and why'}</span><span className="block text-[14px]" style={{ color: MUTED }}>{m.title}, {md(m.day)}</span></span><span className="text-[15px] font-semibold">{usd(m.cents)}</span></button>
            {open === `m_${m.id}` && <MealForm line={m} busy={busy === `m_${m.id}`} onSave={(x) => act(`m_${m.id}`, '/api/writeoffs', { action: 'meal', id: m.id, ...x }, 'Saved with the meal.')} />}
          </div>)}
          {f.receipts.map((r) => <div key={r.id} className="py-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <button type="button" aria-expanded={open === `r_${r.id}`} onClick={() => setOpen(open === `r_${r.id}` ? null : `r_${r.id}`)} className={`flex min-h-[44px] w-full items-center justify-between gap-3 text-left ${RING}`}>
              <span><span className="block text-[15px] font-semibold">A receipt for $75 or more</span><span className="block text-[14px]" style={{ color: MUTED }}>{r.title}, {md(r.day)}. A photo is fine.</span></span><span className="text-[15px] font-semibold">{usd(r.cents)}</span></button>
            {open === `r_${r.id}` && <div className="mt-2 rounded-2xl p-3" style={{ background: SOFT }}><ImageUpload enableMarkup={false} maxWidthOrHeight={1600} onImageUploaded={(url: string) => { void act(`r_${r.id}`, '/api/writeoffs', { action: 'receipt', id: r.id, url }, 'Receipt kept with the line.'); }} /></div>}
          </div>)}
          {f.gifts.needPeople.map((g) => <div key={g.id} className="flex flex-wrap items-end gap-2 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <label className="flex min-w-[200px] flex-1 flex-col gap-1"><span className="text-[15px] font-semibold">How many people was this gift for?</span><span className="text-[14px]" style={{ color: MUTED }}>{g.title}, {md(g.day)}, {usd(g.cents)}</span>
              <input inputMode="numeric" value={people[g.id] || ''} onChange={(e) => setPeople((x) => ({ ...x, [g.id]: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }))} className={field} style={{ borderColor: LINE }} placeholder="3" /></label>
            <button type="button" disabled={!!busy || !people[g.id]} onClick={() => act(`g_${g.id}`, '/api/writeoffs', { action: 'gift', id: g.id, people: Number(people[g.id]) }, 'Saved with the gift.')} className={btn} style={{ background: INK, color: '#fff' }}>Save</button>
          </div>)}
          {f.gifts.over.map((g) => <Row key={g.id} title="A gift over $25 a person" sub={`${g.title}, ${md(g.day)}: for ${g.giftPeople} ${g.giftPeople === 1 ? 'person' : 'people'}, so ${usd(Number(g.giftPeople) * 2500)} counts.`} value={usd(g.cents)} />)}
        </section>
      </div>}

      {canLog && w && <section aria-label="Often missed" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5">
        <div className="max-w-[680px]"><h2 className="text-[18px] font-bold">Often missed: worth asking your accountant</h2>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>These aren’t in your books, so ClarityFlow can’t find them for you. {w.owner ? 'Mark each one, and the ones to ask about print with the rest.' : 'The owner marks these.'}</p></div>
        {(w.missing || []).length > 0 && <div className="flex flex-col rounded-2xl px-4 pb-1 pt-3" style={{ background: SOFT }}>
          <span className="text-[15px] font-semibold">Nothing in your books yet for {w.year}</span>
          {USUAL_COSTS.filter((u) => (w.missing || []).includes(u.id)).map((u) => <div key={u.id} className="py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="block text-[14px] font-semibold">{u.title}</span><span className="block text-[13px]" style={{ color: MUTED }}>{u.text}</span>
          </div>)}
          <a href="/money?tab=ledger" className={`${btn} mb-3 mt-1 self-start`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Add one in Books</a>
        </div>}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {CHECKLIST.map((c) => { const v = w.checklist[c.id] || null; return <div key={c.id} className="flex flex-col gap-2.5 rounded-2xl p-4" style={{ border: `1px solid ${LINE}` }}>
            <span className="text-[15px] font-semibold">{c.title}</span><span className="text-[14px]" style={{ color: MUTED }}>{c.text}</span>
            {w.owner ? <div className="flex flex-wrap gap-2">
              {(['ask', 'no'] as const).map((ans) => <button key={ans} type="button" aria-pressed={v === ans} disabled={!!busy} onClick={() => act(`c_${c.id}`, '/api/writeoffs', { action: 'check', year: w.year, item: c.id, answer: v === ans ? null : ans }, 'Saved.')}
                className={btn} style={v === ans ? { background: INK, color: '#fff' } : { background: '#fff', color: ans === 'ask' ? INK : MUTED, border: `1px solid ${ans === 'ask' ? INK : LINE}` }}>{ans === 'ask' ? 'Ask my accountant' : 'Doesn’t apply'}</button>)}
            </div> : <span className="text-[13px] font-semibold" style={{ color: MUTED }}>The owner answers this one.</span>}
          </div>; })}
        </div>
      </section>}

      {canLog && <p className="text-[13px]" style={{ color: MUTED }}>The Tax summary in Reports counts meals and gifts the same way, by Schedule C line. Your accountant decides what goes on your return.</p>}
    </div>
  );
}
