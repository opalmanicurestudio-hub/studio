'use client';
// src/components/rent/RenterWriteOffs.tsx — A RENTER'S OWN WRITE-OFFS (Money, Your business, Write-offs; included in
// rent; api/portal/renter-writeoffs, lib/renter-write-offs). What they can write off for their own business, found from
// what ClarityFlow holds for them: rent and space fees paid, business miles from their log, the costs they log (a
// meal half counts, a gift up to $25 a person), tips collected for them at the front desk, what's often missed, and a
// print for their accountant. Their costs and answers are seen only by them.
import * as React from 'react';
import { OpenScreenContext, ScreenYearContext } from '@/components/rent/shared';
import { printPage } from '@/lib/print-style';
import { RENTER_CHECKLIST, RENTER_COST_KINDS, RENTER_USUAL, renterWriteOffsHtml, type RenterCost, type RenterCostKind, type RenterFound, type RenterPhoto } from '@/lib/renter-write-offs';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-40 ${RING}`;
const field = `h-11 w-full rounded-xl border bg-[#fff] px-3 text-[15px] ${RING}`;
const card = 'rounded-[20px] bg-[#fff] px-4';
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const md = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

type Data = { year: number; years: number[]; today: string; space: string; found: RenterFound; rent: { cents: number; payments: number; creditsCents: number }; deskTipsCents: number; missing: string[];
  miles: { tenths: number; cents: number; rate: string; trips: number; stale: boolean; rateYear: number } | null; checklist: Record<string, string>; photos?: RenterPhoto[] };

const NOTE_HINT: Partial<Record<RenterCostKind, string>> = { Meals: 'Who was there, and what it was about', Gifts: 'Who it was for', Education: 'The class or show', Travel: 'Where, and what for' };

function Row({ title, sub, value }: { title: string; sub: string; value?: string }) {
  return <div className="flex items-start gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
    <div className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{title}</span><span className="block text-[13px]" style={{ color: MUTED }}>{sub}</span></div>
    {value != null && <span className="shrink-0 text-[15px] font-semibold">{value}</span>}
  </div>;
}

/** A phone photo made small enough to send (the longest side 1600 pixels, as a JPEG), or null if it isn't a picture. */
function shrink(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) { resolve(null); return; }
    const img = new Image(); const src = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(src);
      try { resolve(c.toDataURL('image/jpeg', 0.85)); } catch { resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(src); resolve(null); };
    img.src = src;
  });
}

type Snapped = { ok: boolean; url?: string; reading?: { vendor: string; date: string | null; total: number | null; kind: string } | null; error?: string };

function AddCost({ today, kind0, busy, onSave, onCancel, onSnap, onDrop }: { today: string; kind0: RenterCostKind; busy: boolean; onSave: (x: any) => void; onCancel: () => void;
  /** Snap a receipt: the photo kept and read for what's on it (api/portal/renter-writeoffs 'receipt'); `replaces`: the
   *  photo taken before it, no longer wanted. */
  onSnap?: (photoData: string, replaces: string) => Promise<Snapped>;
  /** A photo from a cost not saved, removed. */
  onDrop?: (url: string) => void }) {
  const [date, setDate] = React.useState(today); const [amount, setAmount] = React.useState(''); const [kind, setKind] = React.useState<RenterCostKind>(kind0);
  const [note, setNote] = React.useState(''); const [people, setPeople] = React.useState('');
  const [photo, setPhoto] = React.useState(''); const [snap, setSnap] = React.useState<'' | 'reading' | 'filled' | 'none' | 'failed'>(''); const [snapErr, setSnapErr] = React.useState('');
  const kindTouched = React.useRef(false);
  const id = React.useId(); const fileRef = React.useRef<HTMLInputElement | null>(null);
  // (Only the latest photo's reading counts; what an earlier reading filled in, and nothing typed since, is replaced.)
  const seq = React.useRef(0); const filled = React.useRef<{ amount?: string; date?: string; note?: string }>({});
  const took = async (file: File | undefined) => {
    if (!file || !onSnap) return;
    const mine = ++seq.current;
    setSnap('reading'); setSnapErr('');
    const data = await shrink(file); if (mine !== seq.current) return;
    if (!data) { setSnap('failed'); setSnapErr('That isn’t a photo. Try again.'); return; }
    const r = await onSnap(data, photo);
    // (A photo that came back after it stopped mattering, taken again or cancelled, is removed.)
    if (mine !== seq.current) { if (r?.ok && r.url && onDrop) onDrop(r.url); return; }
    if (!r?.ok || !r.url) { setSnap('failed'); setSnapErr(r?.error || 'That photo didn’t upload. Try again.'); return; }
    setPhoto(r.url);
    const x = r.reading; if (!x) { setSnap('none'); return; }
    // (What's printed on it fills what's still empty or what the last reading filled; the kind only when it's still the
    // plain one they opened with; a meal's or a gift's note is theirs to write: who and why.)
    const k = !kindTouched.current && kind0 === 'Supplies' && (RENTER_COST_KINDS as readonly string[]).includes(x.kind) ? (x.kind as RenterCostKind) : null;
    const f = filled.current; const next: typeof f = {};
    if (x.total != null) { const v = x.total.toFixed(2); setAmount((a) => (!a || a === f.amount ? (next.amount = v) : a)); }
    if (x.date) { const v = x.date; setDate((d) => (d === today || d === f.date ? (next.date = v) : d)); }
    if (k) setKind(k);
    const kNow = k || kind;
    if (x.vendor && kNow !== 'Meals' && kNow !== 'Gifts') { const v = x.vendor; setNote((n) => (!n.trim() || n === f.note ? (next.note = v) : n)); }
    filled.current = next;
    setSnap('filled');
  };
  const cancel = () => { seq.current++; if (photo && onDrop) onDrop(photo); onCancel(); };
  return <div className={`${card} flex flex-col gap-3 py-4`}>
    <h2 className="text-[16px] font-semibold">Add a cost</h2>
    {onSnap && <div className="flex flex-col gap-2">
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void took(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || snap === 'reading'} onClick={() => fileRef.current?.click()} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${INK}` }}>{snap === 'reading' ? 'Reading the receipt…' : photo ? 'Take it again' : 'Snap a receipt'}</button>
        {photo && <img src={photo} alt="The receipt" className="h-14 w-14 rounded-xl object-cover" style={{ border: `1px solid ${LINE}` }} />}
      </div>
      {snap && snap !== 'reading' && <p role="status" className="text-[13px]" style={{ color: snap === 'filled' ? MUTED : AMBER }}>{snap === 'filled' ? 'Filled in from the receipt. Check each before you save it; the photo is kept with the cost.' : snap === 'none' ? 'The receipt couldn’t be read. Fill it in below: the photo is kept with the cost.' : snapErr}</p>}
    </div>}
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Day</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={field} style={{ borderColor: LINE }} /></label>
      <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Amount</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,$]/g, '').slice(0, 12))} placeholder="24.50" className={field} style={{ borderColor: LINE }} /></label>
    </div>
    <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>What it was</span>
      <select id={`${id}-kind`} value={kind} onChange={(e) => { kindTouched.current = true; setKind(e.target.value as RenterCostKind); }} className={field} style={{ borderColor: LINE }}>{RENTER_COST_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
    {kind === 'Meals' && <p className="text-[13px]" style={{ color: MUTED }}>A meal with a client, a supplier or someone you work with, or on an overnight work trip: half counts. Tickets, shows, games and meals just for you don’t count.</p>}
    {kind === 'Gifts' && <p className="text-[13px]" style={{ color: MUTED }}>Up to $25 a person a year counts.</p>}
    <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>{NOTE_HINT[kind] || 'A note, if you like'}</span>
      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} maxLength={200} className={field} style={{ borderColor: LINE }} placeholder={kind === 'Meals' ? 'Dana, my product rep: spring order' : ''} /></label>
    {kind === 'Gifts' && <label className="flex flex-col gap-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>How many people</span>
      <input inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} placeholder="1" className={field} style={{ borderColor: LINE }} /></label>}
    <div className="flex gap-2">
      <button type="button" disabled={busy || !amount || snap === 'reading'} onClick={() => onSave({ date, amount, kind, note, ...(kind === 'Gifts' && people ? { people: Number(people) } : {}), ...(photo ? { receiptUrl: photo } : {}) })} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={cancel} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Cancel</button>
    </div>
  </div>;
}

function FinishMeal({ c, busy, onSave }: { c: RenterCost; busy: boolean; onSave: (note: string) => void }) {
  const [note, setNote] = React.useState(c.note);
  return <div className="flex flex-col gap-2 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
    <span className="text-[15px] font-semibold">A meal needs who and why</span>
    <span className="text-[13px]" style={{ color: MUTED }}>{md(c.day)}, {usd(c.cents)}</span>
    <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} aria-label="Who was there, and what it was about" placeholder="Dana, my product rep: spring order" className={field} style={{ borderColor: LINE }} />
    <button type="button" disabled={busy || note.trim().length < 3} onClick={() => onSave(note)} className={`${btn} self-start`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
  </div>;
}

function FinishGift({ c, busy, onSave }: { c: RenterCost; busy: boolean; onSave: (n: number) => void }) {
  const [n, setN] = React.useState('');
  return <div className="flex flex-wrap items-end gap-2 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
    <label className="flex min-w-[180px] flex-1 flex-col gap-1"><span className="text-[15px] font-semibold">How many people was this gift for?</span>
      <span className="text-[13px]" style={{ color: MUTED }}>{c.note ? `${c.note}, ` : ''}{md(c.day)}, {usd(c.cents)}</span>
      <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} placeholder="3" className={field} style={{ borderColor: LINE }} /></label>
    <button type="button" disabled={busy || !n} onClick={() => onSave(Number(n))} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
  </div>;
}

export function RenterWriteOffs({ tenantId, token, business }: { tenantId: string; token: string; business: string }) {
  const openScreen = React.useContext(OpenScreenContext);
  const [d, setD] = React.useState<Data | null>(null); const [err, setErr] = React.useState(''); const [said, setSaid] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null); const [adding, setAdding] = React.useState<RenterCostKind | null>(null);
  const post = React.useCallback(async (body: any) => {
    try { const r = await fetch('/api/portal/renter-writeoffs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, tenantId, token }) }); return await r.json(); }
    catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId, token]);
  const load = React.useCallback(async (year?: number) => {
    const r = await post({ action: 'list', ...(year ? { year } : {}) });
    if (r?.ok) { setD(r); setErr(''); } else setErr(r?.error || 'Write-offs didn’t load. Try again.');
  }, [post]);
  // (Opened from Close the year for last year: that year first.)
  const forYear = React.useContext(ScreenYearContext);
  React.useEffect(() => { void load(forYear ?? undefined); }, [load, forYear]);
  const act = async (key: string, body: any, done: string) => {
    setBusy(key); setErr(''); setSaid('');
    const r = await post(body); setBusy(null);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through. Try again.'); return false; }
    setSaid(done); await load(d?.year); return true;
  };

  if (!d) return <p className="px-1 text-[15px]" style={{ color: err ? AMBER : MUTED }}>{err || 'Looking through your year…'}</p>;
  const f = d.found; const past = d.year !== d.years[0];
  const total = d.rent.cents + (d.miles?.cents || 0) + f.costs.counts;
  const print = () => {
    const w = window.open('', '_blank'); if (!w) { setErr('Your browser blocked the new window. Allow pop-ups for ClarityFlow and try again.'); return; }
    w.document.write(printPage({ title: `${d.year} write-offs`, heading: `${d.year} <b>write-offs</b>`, shopName: business, subtitle: 'Found in ClarityFlow, for your accountant.',
      body: renterWriteOffsHtml({ found: f, rent: d.rent, space: d.space, miles: d.miles, deskTipsCents: d.deskTipsCents, checklist: d.checklist, missing: d.missing, photos: d.photos || [] }),
      footNote: `Rent from your payments to ${d.space}; miles from your mileage log; costs as you logged them. A starting point: your accountant decides what goes on your return.` }));
    w.document.close();
  };
  const msg = (err || said) && <p role={err ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-[14px]" style={err ? { background: AMBER_TINT, color: AMBER } : { background: GREEN_TINT, color: GREEN }}>{err || said}</p>;

  return <div className="flex flex-col gap-3.5" style={{ color: INK }}>
    <section aria-label={`${d.year} so far`} className={`${card} flex flex-col gap-1 py-4`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold" style={{ color: MUTED }}>{past ? d.year : `${d.year} so far`}</p>
        <div className="flex gap-1.5">{d.years.map((y) => <button key={y} type="button" aria-pressed={y === d.year} onClick={() => load(y)} className={`${btn} px-3 text-[13px]`} style={y === d.year ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{y}</button>)}</div>
      </div>
      <p className="text-[34px] font-semibold tracking-[-0.02em]" style={{ color: total ? GREEN : INK }}>{usd(total)}</p>
      <p className="text-[14px]" style={{ color: MUTED }}>Found so far: your rent, business miles and the costs you’ve logged.</p>
      <div className="mt-3 flex flex-col gap-2">
        <button type="button" onClick={() => { setErr(''); setSaid(''); setAdding('Supplies'); }} className={btn} style={{ background: INK, color: '#fff' }}>Add a cost</button>
        <button type="button" onClick={print} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${INK}` }}>Print for your accountant</button>
      </div>
    </section>
    {msg}
    {adding && <AddCost key={adding} today={d.today} kind0={adding} busy={busy === 'add'} onCancel={() => setAdding(null)} onSnap={(photoData, replaces) => post({ action: 'receipt', photoData, ...(replaces ? { replaces } : {}) })} onDrop={(url) => { void post({ action: 'drop', url }); }}
      onSave={(x) => act('add', { action: 'add', ...x }, 'Saved. It’s in Earnings and expenses too.').then((ok) => { if (ok) setAdding(null); })} />}

    <section aria-label="Found for you" className={`${card} pb-1`}>
      <h2 className="pb-1 pt-3 text-[16px] font-semibold">Found for you</h2>
      <Row title={`Rent and space fees to ${d.space}`} value={usd(d.rent.cents)}
        sub={d.rent.cents ? `${d.rent.payments} payment${d.rent.payments === 1 ? '' : 's'} in ${d.year}${d.rent.creditsCents ? `, and ${usd(d.rent.creditsCents)} the business owed you, used toward your rent` : ''}, less any refunds. A security deposit isn’t in it.` : `None recorded in ${d.year} yet.`} />
      {d.miles ? <Row title="Business miles" value={usd(d.miles.cents)} sub={`${(d.miles.tenths / 10).toLocaleString('en-US')} miles in ${d.miles.trips} trip${d.miles.trips === 1 ? '' : 's'}, at the IRS rate of ${d.miles.rate} a mile${d.miles.stale ? ` (${d.miles.rateYear}’s, until ${d.year}’s is in)` : ''}.`} />
        : <div className="flex flex-col gap-2 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
          <span className="text-[15px] font-semibold">Business miles</span>
          <span className="text-[13px]" style={{ color: MUTED }}>Drives for supplies, the bank, classes and clients add up. Log them as you go, and they’re counted here.</span>
          {openScreen && <button type="button" onClick={() => openScreen({ view: 'mileage' })} className={`${btn} self-start`} style={{ background: SOFT, color: INK }}>Open Mileage</button>}
        </div>}
      {f.kinds.map((k) => <Row key={k.kind} title={k.kind} value={usd(k.counts)}
        sub={`${k.lines} cost${k.lines === 1 ? '' : 's'}${k.kind === 'Meals' ? `, ${usd(k.spent)} spent: half of a business meal counts` : k.kind === 'Gifts' && k.counts !== k.spent ? `, ${usd(k.spent)} spent: up to $25 a person counts` : ''}`} />)}
      {f.equipment.map((e) => <Row key={e.id} title={`Equipment over $2,500: ${e.title}`} sub={`${md(e.day)}. Your accountant chooses whether it’s written off this year or over several.`} />)}
      {d.deskTipsCents > 0 && <Row title="Tips collected for you at the front desk" value={usd(d.deskTipsCents)} sub="Not a cost, but your accountant needs it for the deduction for tips, below. Add up tips paid to you directly too." />}
      {!f.kinds.length && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>No costs logged for {d.year} yet. Supplies, classes, insurance and your license are the usual ones.</p>}
    </section>

    {(f.toFinish > 0 || f.receipts > 0) && <section aria-label="Finish these" className={`${card} pb-1`}>
      <h2 className="pt-3 text-[16px] font-semibold">Finish these</h2>
      <p className="pb-2 text-[13px]" style={{ color: MUTED }}>The IRS asks for these details, so each write-off holds up.</p>
      {f.meals.needNote.map((c) => <FinishMeal key={c.id} c={c} busy={busy === `m_${c.id}`} onSave={(note) => act(`m_${c.id}`, { action: 'finish', id: c.id, note }, 'Saved with the meal.')} />)}
      {f.gifts.needPeople.map((c) => <FinishGift key={c.id} c={c} busy={busy === `g_${c.id}`} onSave={(n) => act(`g_${c.id}`, { action: 'finish', id: c.id, people: n }, 'Saved with the gift.')} />)}
      {f.receipts > 0 && <p className="py-3 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}>Keep the receipt{f.receipts === 1 ? '' : 's'} for {f.receipts} meal, gift or travel cost{f.receipts === 1 ? '' : 's'} of $75 or more. A photo is fine.</p>}
    </section>}

    {(d.photos || []).length > 0 && <section aria-label="Receipts kept" className={`${card} pb-1`}>
      <h2 className="pt-3 text-[16px] font-semibold">Receipts kept</h2>
      <p className="pb-2 text-[13px]" style={{ color: MUTED }}>Photos you took with Snap a receipt, kept with each cost. They print with the rest for your accountant.</p>
      {(d.photos || []).map((p) => <div key={p.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{p.note ? `${p.kind}: ${p.note}` : p.kind}</span><span className="block text-[13px]" style={{ color: MUTED }}>{md(p.day)}, {usd(p.cents)}</span></div>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className={`${btn} shrink-0`} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }} aria-label={`See the receipt for ${p.kind}, ${md(p.day)}`}>See the receipt</a>
      </div>)}
    </section>}

    {d.missing.length > 0 && <section aria-label="Nothing logged yet" className={`${card} pb-1`}>
      <h2 className="pb-1 pt-3 text-[16px] font-semibold">Nothing logged for {d.year} yet</h2>
      {RENTER_USUAL.filter((u) => d.missing.includes(u.id)).map((u) => <div key={u.id} className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{u.title}</span><span className="block text-[13px]" style={{ color: MUTED }}>{u.text}</span></div>
        <button type="button" onClick={() => { setErr(''); setSaid(''); setAdding(u.kind); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={btn} style={{ background: SOFT, color: INK }}>Add it</button>
      </div>)}
    </section>}

    <section aria-label="Often missed" className="flex flex-col gap-2.5">
      <div className="px-1"><h2 className="text-[16px] font-semibold">Often missed: worth asking your accountant</h2>
        <p className="text-[13px]" style={{ color: MUTED }}>These aren’t in ClarityFlow, so they can’t be found for you. Mark each one, and the ones to ask about print with the rest.</p></div>
      {RENTER_CHECKLIST.map((c) => { const v = d.checklist[c.id] || null; return <div key={c.id} className={`${card} flex flex-col gap-2 py-4`}>
        <span className="text-[15px] font-semibold">{c.title}</span><span className="text-[14px]" style={{ color: MUTED }}>{c.text}</span>
        <div className="flex flex-wrap gap-2">{(['ask', 'no'] as const).map((ans) => <button key={ans} type="button" aria-pressed={v === ans} disabled={!!busy} onClick={() => act(`c_${c.id}`, { action: 'check', year: d.year, item: c.id, answer: v === ans ? null : ans }, 'Saved.')}
          className={btn} style={v === ans ? { background: INK, color: '#fff' } : { background: '#fff', color: ans === 'ask' ? INK : MUTED, border: `1px solid ${ans === 'ask' ? INK : LINE}` }}>{ans === 'ask' ? 'Ask my accountant' : 'Doesn’t apply'}</button>)}</div>
      </div>; })}
    </section>

    <p className="px-1 text-[13px]" style={{ color: MUTED }}>A starting point for your accountant, who decides what goes on your return. Your costs and answers here are seen only by you, never by {d.space}.</p>
  </div>;
}
