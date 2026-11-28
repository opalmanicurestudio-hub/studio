'use client';
// src/components/money/YearEndPacket.tsx — CLOSE THE YEAR (the top of the Money page's Reports tab, for whoever keeps
// the books). What's left before the year goes to the accountant, each with the way to it, and one packet with the year
// in it: profit and loss, the tax summary by Schedule C line, write-offs and business miles with the mileage log, the
// estimated tax payments the owner recorded, the team's W-2 and 1099 totals, and the year's sales tax. Read from what's
// already in ClarityFlow (the books, api/writeoffs, api/mileage, api/owner-taxes, the paydays, api/money/sales-tax and
// api/money/close; lib/year-end-packet); nothing is read until the year is checked or the packet asked for.
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { readDatedRange } from '@/hooks/use-transactions';
import { booksSummary, normalizeLine } from '@/lib/books-summary';
import { form1099s, w2sFor } from '@/lib/payroll-yearend';
import { owedRunsFrom, runByOf } from '@/lib/payroll-taxes';
import { printPage } from '@/lib/print-style';
import { calendarZone, dayKey, wallToUtc } from '@/lib/tenant-time';
import { packetBody, plural, yearItems, yearToClose, type YearItem } from '@/lib/year-end-packet';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const ID = /^[A-Za-z0-9_-]{1,160}$/; const BANK_READ = 2000;

type Gathered = { year: number; items: YearItem[]; ls: any[]; lookup: any[]; wo: any; mi: any; ot: any; w2s: any[]; necs: any[] };

export function YearEndPacket({ tenantId, firestore, tenant, owner, shop }: { tenantId: string; firestore: Firestore; tenant: any; owner: boolean; shop: string }) {
  // (The business's own calendar: a year starts at midnight on January 1 where the business is, wherever this device is.)
  const tz = React.useMemo(() => calendarZone(tenant), [tenant]);
  const today = React.useMemo(() => dayKey(new Date(), tz), [tz]);
  const first = yearToClose(today); const ys = [first, first === Number(today.slice(0, 4)) ? first - 1 : first + 1].sort((a, b) => b - a);
  const [year, setYear] = React.useState(first);
  const [g, setG] = React.useState<Gathered | null>(null); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const call = React.useCallback(async (url: string, body: any) => {
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, ...body }) }).then((r) => r.json()).catch(() => null);
  }, [tenantId]);
  const began = React.useMemo(() => { const v = tenant?.createdAt; const d = v?.toDate ? v.toDate() : v ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? dayKey(d, tz).slice(0, 7) : ''; }, [tenant?.createdAt, tz]);

  const gather = async (y: number): Promise<Gathered> => {
    const ls = (await readDatedRange(firestore, tenantId, 'transactions', 'date', wallToUtc(`${y}-01-01`, 0, 0, tz), wallToUtc(`${y + 1}-01-01`, 0, 0, tz), tz)).map((t: any) => normalizeLine(t));
    // (What a take-back takes back when that's from before the year, so it's taken back as it was counted: the same
    // reading as the Reports below.)
    const have = new Map<string, any>(ls.map((t: any) => [String(t.id), t])); let next: any[] = ls;
    for (let round = 0; round < 3; round++) {
      const want = Array.from(new Set(next.flatMap((t: any) => [t?.reversalOf, t?.voidOf]).map((v: any) => String(v || '')).filter((v) => ID.test(v) && !have.has(v)))).slice(0, 300);
      if (!want.length) break;
      const got = (await Promise.all(want.map((id) => getDoc(doc(firestore, 'tenants', tenantId, 'transactions', id)).then((d) => (d.exists() ? normalizeLine({ id: d.id, ...(d.data() as any) }) : null)).catch(() => null)))).filter(Boolean) as any[];
      for (const t of got) have.set(String(t.id), t);
      next = got;
    }
    const lookup = Array.from(have.values());
    const selfRun = runByOf(tenant) === 'clarityflow';
    const [wo, mi, ot, tax, closedR, bank, runsSnap] = await Promise.all([
      call('/api/writeoffs', { action: 'list', year: y }), call('/api/mileage', { action: 'list', year: y }),
      owner ? call('/api/owner-taxes', { action: 'list', figures: false }) : Promise.resolve(null),
      call('/api/money/sales-tax', { action: 'status', year: y }), call('/api/money/close', { action: 'closed' }),
      // (The business's bank lines from the year still waiting: not a personal account's, which wait until they're booked,
      // and not ones still pending. Only the owner can read them; for anyone else it isn't said.)
      getDocs(query(collection(firestore, `tenants/${tenantId}/bankTransactions`), where('status', '==', 'unmatched'), limit(BANK_READ)))
        .then((x: any) => ({ n: x.docs.map((d: any) => d.data() || {}).filter((t: any) => t.context !== 'Personal' && !t.pending && String(t.date || '').slice(0, 4) === String(y)).length, capped: x.docs.length >= BANK_READ })).catch(() => null),
      // (The paydays the money page makes the year's forms from: only the owner and whoever runs payroll can read them.)
      selfRun ? getDocs(query(collection(firestore, `tenants/${tenantId}/payrollRuns`), where('recordedAt', '>=', owedRunsFrom(y)), limit(1500))).catch(() => null) : Promise.resolve(null),
    ]);
    const runs = (runsSnap?.docs || []).map((d: any) => d.data());
    const w2s = runsSnap ? w2sFor(runs, tenant, y) : []; const necs = runsSnap ? form1099s(runs, tenant, y).filter((x: any) => x.due) : [];
    const woY = wo?.ok && wo.year === y ? wo : null; const miY = mi?.ok && mi.year === y ? mi : null; const otY = ot?.ok ? ot : null;
    // (Months close in order, so the latest listed is how far they're closed.)
    const closedThrough = closedR?.ok && Array.isArray(closedR.months) && closedR.months.length ? String(closedR.months[0]?.month || '') : '';
    const items = yearItems({ year: y, s: booksSummary(ls, { lookup, businessOnly: true }), bankWaiting: bank ? bank.n : null, bankCapped: !!bank?.capped, wo: woY, mi: miY, ot: otY, owner,
      payroll: runsSnap ? { w2s: w2s.length, necs: necs.length } : null, tax: tax?.ok ? tax : null, closedThrough, began, today,
      unread: [...(woY ? [] : ['Write-offs']), ...(miY ? [] : ['The mileage log']), ...(owner && !otY ? ['Estimated taxes'] : [])] });
    return { year: y, items, ls, lookup, wo: woY, mi: miY, ot: otY, w2s, necs };
  };

  const check = async () => {
    if (busy) return; setBusy('check'); setErr('');
    try { setG(await gather(year)); } catch { setErr('The year couldn’t be read just now. Try again.'); }
    finally { setBusy(''); }
  };
  const print = async () => {
    if (busy) return; setErr('');
    const w = window.open('', '_blank');
    if (!w) { setErr('Your browser blocked the packet’s window. Allow pop-ups for this site, then try again.'); return; }
    w.document.write('<p style="font-family:sans-serif;color:#6d7075;padding:24px">Getting your packet ready</p>');
    setBusy('print');
    try {
      const x = g && g.year === year ? g : await gather(year); setG(x);
      w.document.open();
      w.document.write(printPage({ title: `${year} year-end packet`, heading: `${year} <b>year-end packet</b>`, shopName: shop, subtitle: 'The year in ClarityFlow, for your accountant.',
        body: packetBody({ year, items: x.items, ls: x.ls, lookup: x.lookup, wo: x.wo, mi: x.mi, ot: x.ot, owner, w2s: x.w2s, necs: x.necs }),
        footNote: 'Every figure is the same reading of the books as the Money page. Your accountant decides what goes on the return.' }));
      w.document.close(); w.focus();
    } catch { w.close(); setErr('The packet couldn’t be made just now. Try again.'); }
    finally { setBusy(''); }
  };

  const shown = g && g.year === year ? g : null; const left = shown ? shown.items.filter((i) => i.state === 'todo').length : 0;
  return (
    <section aria-label={`Close ${year}`} className="mb-4 rounded-3xl bg-[#fff] px-5 pb-4 pt-4" style={{ border: `1px solid ${LINE}`, color: INK }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <h3 className="text-[17px] font-semibold">Close {year}</h3>
          <p className="text-[14px]" style={{ color: MUTED }}>What’s left before the year goes to your accountant, and one packet with the whole year in it.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Year">{ys.map((y2) => <button key={y2} type="button" aria-pressed={y2 === year} disabled={!!busy} onClick={() => { setYear(y2); setErr(''); }} className={btn}
          style={y2 === year ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{y2}</button>)}</div>
      </div>
      {err && <p role="alert" className="mt-3 rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      {shown && <>
        <p role="status" className="mt-3 text-[14px] font-semibold" style={{ color: left ? AMBER : GREEN }}>{left ? `${plural(left, 'thing')} to finish` : 'Nothing left to finish'}</p>
        <ul className="mt-1">{shown.items.map((i) => <li key={i.key} className="flex flex-wrap items-center gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.state === 'ok' ? GREEN : i.state === 'todo' ? AMBER : '#c9cbd0' }} />
          <div className="min-w-[200px] flex-1"><p className="text-[15px] font-semibold">{i.title}<span className="sr-only">{i.state === 'ok' ? ', done' : i.state === 'todo' ? ', to finish' : ''}</span></p><p className="text-[14px]" style={{ color: MUTED }}>{i.sub}</p></div>
          {i.href && i.state !== 'ok' && <Link href={i.href} className={btn} style={i.state === 'todo' ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>Open</Link>}
        </li>)}</ul>
      </>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={check} disabled={!!busy} className={btn} style={shown ? { background: '#fff', color: INK, border: `1px solid ${LINE}` } : { background: INK, color: '#fff' }}>{busy === 'check' ? 'Checking the year' : shown ? 'Check again' : `Check ${year}`}</button>
        <button type="button" onClick={print} disabled={!!busy} className={btn} style={shown ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${INK}` }}>{busy === 'print' ? 'Getting it ready' : 'Print the year-end packet'}</button>
      </div>
      <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Profit and loss, the tax summary, write-offs and the mileage log{owner ? ', the estimated tax payments you recorded' : ''}, the team’s W-2 and 1099 totals, and the year’s sales tax. To print, or save as a PDF.</p>
    </section>
  );
}
