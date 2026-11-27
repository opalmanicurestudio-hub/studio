'use client';
// src/components/rent/RenterYearEnd.tsx — CLOSING A RENTER'S YEAR (Money, Your business, Close the year; included in
// rent; lib/year-end-packet). What's left before their year goes to their accountant, each with the screen to fix it in,
// and one packet with the year in it: what they earned through ClarityFlow month by month, their write-offs, the mileage
// log and the estimated payments they recorded. Read from their own write-offs (api/portal/renter-writeoffs), mileage
// log (api/portal/renter-mileage) and tax set-aside (api/portal/renter-taxes); all of it theirs alone.
import * as React from 'react';
import { OpenScreenContext } from '@/components/rent/shared';
import { printPage } from '@/lib/print-style';
import { plural, renterPacketBody, renterYearItems, yearToClose, type YearItem } from '@/lib/year-end-packet';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-40 ${RING}`;
const card = 'rounded-[20px] bg-[#fff] px-4';
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

type Year = { year: number; items: YearItem[]; wo: any; mi: any; tx: any; today: string; years: number[] };

export function RenterYearEnd({ tenantId, token, business = '' }: { tenantId: string; token: string; business?: string }) {
  const openScreen = React.useContext(OpenScreenContext);
  // (The year to close and the two to pick from, by the business's day once it's read; the phone's until then.)
  const [year, setYear] = React.useState<number | null>(null);
  const [ys, setYs] = React.useState<number[]>(() => { const t = Number(localDay().slice(0, 4)); return [t, t - 1]; });
  const [d, setD] = React.useState<Year | null>(null); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const post = React.useCallback(async (url: string, body: any) => {
    try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, tenantId, token }) }); return await r.json(); }
    catch { return { ok: false }; }
  }, [tenantId, token]);

  const gather = React.useCallback(async (asked: number | null): Promise<Year> => {
    // (Left out, the server picks the year to close by the business's day.)
    const tx = await post('/api/portal/renter-taxes', { action: 'year', ...(asked ? { year: asked } : {}) });
    const y = tx?.ok ? Number(tx.year) : asked || yearToClose(localDay());
    const [wo, mi] = await Promise.all([post('/api/portal/renter-writeoffs', { action: 'list', year: y }), post('/api/portal/renter-mileage', { action: 'list', year: y })]);
    const woY = wo?.ok && wo.year === y ? wo : null; const miY = mi?.ok && mi.year === y ? mi : null; const txY = tx?.ok && tx.year === y ? tx : null;
    const today = String(txY?.today || woY?.today || miY?.today || localDay());
    const items = renterYearItems({ year: y, wo: woY, mi: miY, tx: txY, today,
      unread: [...(woY ? [] : ['Write-offs']), ...(miY ? [] : ['The mileage log']), ...(txY ? [] : ['What you earned and paid'])] });
    const years = Array.isArray(txY?.years) ? txY.years.map(Number) : Array.isArray(woY?.years) ? woY.years.map(Number) : [Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1];
    return { year: y, items, wo: woY, mi: miY, tx: txY, today, years };
  }, [post]);

  const load = React.useCallback(async (y: number | null) => {
    setBusy('check'); setErr('');
    try { const x = await gather(y); setD(x); setYear(x.year); setYs(x.years); } catch { setErr('Your year couldn’t be read just now. Try again.'); }
    finally { setBusy(''); }
  }, [gather]);
  React.useEffect(() => { void load(null); }, [load]);

  const pick = (y: number) => { if (busy || y === year) return; setYear(y); setD(null); void load(y); };
  const print = async () => {
    if (busy || year == null) return; setErr('');
    const w = window.open('', '_blank');
    if (!w) { setErr('Your browser blocked the packet’s window. Allow pop-ups for ClarityFlow, then try again.'); return; }
    w.document.write('<p style="font-family:sans-serif;color:#6d7075;padding:24px">Getting your packet ready</p>');
    setBusy('print');
    try {
      // (Anything that couldn't be read is read again first.)
      const x = d && d.year === year && !d.items.some((i) => i.key.startsWith('unread-')) ? d : await gather(year); setD(x);
      w.document.open();
      w.document.write(printPage({ title: `${year} year-end packet`, heading: `${year} <b>year-end packet</b>`, shopName: business, subtitle: 'Your year in ClarityFlow, for your accountant.',
        body: renterPacketBody({ year, items: x.items, earnedByMonth: x.tx?.earnedByMonth || null, wo: x.wo, mi: x.mi, tx: x.tx, today: x.today }),
        footNote: `What you earned and your rent are as ClarityFlow has them; miles from your mileage log; costs as you logged them. A starting point: your accountant decides what goes on your return.` }));
      w.document.close(); w.focus();
    } catch { w.close(); setErr('The packet couldn’t be made just now. Try again.'); }
    finally { setBusy(''); }
  };

  const shown = d && d.year === year ? d : null; const left = shown ? shown.items.filter((i) => i.state === 'todo').length : 0;
  return <div className="flex flex-col gap-3.5" style={{ color: INK }}>
    <section aria-label={year ? `Close ${year}` : 'Close the year'} className={`${card} flex flex-col gap-1 py-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[200px] flex-1">
          <h2 className="text-[17px] font-semibold">{year ? `Close ${year}` : 'Close the year'}</h2>
          <p className="text-[14px]" style={{ color: MUTED }}>What’s left before your year goes to your accountant, and one packet with the whole year in it.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Year">{year != null && ys.map((y2) => <button key={y2} type="button" aria-pressed={y2 === year} disabled={!!busy} onClick={() => pick(y2)} className={btn}
          style={y2 === year ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{y2}</button>)}</div>
      </div>
      {err && <p role="alert" className="mt-2 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      {!shown && !err && <p role="status" className="mt-2 text-[14px]" style={{ color: MUTED }}>Looking through your year…</p>}
      {shown && <>
        <p role="status" className="mt-2 text-[14px] font-semibold" style={{ color: left ? AMBER : GREEN }}>{left ? `${plural(left, 'thing')} to finish` : 'Nothing left to finish'}</p>
        <ul className="mt-1">{shown.items.map((i) => <li key={i.key} className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.state === 'ok' ? GREEN : i.state === 'todo' ? AMBER : '#c9cbd0' }} />
          <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{i.title}<span className="sr-only">{i.state === 'ok' ? ', done' : i.state === 'todo' ? ', to finish' : ''}</span></p><p className="text-[13px]" style={{ color: MUTED }}>{i.sub}</p></div>
          {i.view && i.state !== 'ok' && openScreen && <button type="button" onClick={() => openScreen({ view: i.view, year: shown.year })} aria-label={`Open: ${i.title}`} className={`${btn} shrink-0`}
            style={i.state === 'todo' ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Open</button>}
        </li>)}</ul>
      </>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={print} disabled={!!busy} className={btn} style={{ background: INK, color: '#fff' }}>{busy === 'print' ? 'Getting it ready' : 'Print the year-end packet'}</button>
        {shown && <button type="button" onClick={() => void load(year)} disabled={!!busy} className={btn} style={{ background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{busy === 'check' ? 'Checking' : 'Check again'}</button>}
      </div>
      <p className="mt-1 text-[13px]" style={{ color: MUTED }}>What you earned through ClarityFlow, your write-offs, the mileage log and the estimated tax payments you recorded. To print, or save as a PDF.</p>
    </section>
  </div>;
}
