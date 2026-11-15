'use client';
// src/app/(app)/bar-tabs/page.tsx — BAR TABS (design canvas "The bar and the pass"; lib/bar-tab, api/bar). The bar's
// open tabs, on the bartender's phone or the bar's tablet: each under a name, what's on it, how long it's been open,
// and the card held on it. "Open a tab" takes a name and, when the bar has a card reader, holds the business's hold
// amount on the guest's card with one tap (nothing is charged). Tapping a tab opens it to ring drinks and food on
// (components/host/TableTab, the same as a table's), hold a card, or let a held card go. The tab is closed at the desk,
// where "Charge the held card" takes the check from it with no second tap.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { send } from '@/lib/outbox';
import { useKeepPage } from '@/components/pwa/keep-page';
import { TableTab } from '@/components/host/TableTab';
import { holdWords, isHeld, type CardHold } from '@/lib/bar-tab';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d';
const btn = 'min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const dark = { background: INK, color: '#fff' } as const;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const since = (iso: string, now: number) => { const m = Math.max(0, Math.floor((now - (Date.parse(iso) || now)) / 60000)); return m < 1 ? 'just opened' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`; };
const READER_KEY = 'cf.bar.reader';
const readKept = () => { try { return localStorage.getItem(READER_KEY) || ''; } catch { return ''; } };

type Tab = { visitId: string; partyId: string; name: string; total: number; lines: number; openedAt: string; hold: CardHold | null };
type Reader = { id: string; label: string; online: boolean; test: boolean };
type Data = { tabs: Tab[]; readers: Reader[]; payments: boolean; holdDollars: number; manager: boolean; meName?: string };

async function call(body: any): Promise<any> {
  const r = await send('/api/bar', body, { label: 'Bar tabs', auth: 'user', keep: false, tenantId: String(body.tenantId || '') });
  return r.d && typeof r.d === 'object' ? r.d : { ok: false, error: 'That didn’t go through.' };
}

export default function BarTabsPage() {
  const { firestore } = useFirebase() as any;
  const { selectedTenant, viaPortal } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [opening, setOpening] = useState(false); const [name, setName] = useState(''); const [hold, setHold] = useState(true); const [reader, setReader] = useState('');
  const [open, setOpen] = useState<Tab | null>(null); const [busy, setBusy] = useState<string | null>(null);
  // The hold being asked for on the reader: checked every two seconds until it's held, turned down or called off.
  const [watching, setWatching] = useState<string | null>(null); const [live, setLive] = useState<CardHold | null>(null);
  const [setting, setSetting] = useState(false); const [dollars, setDollars] = useState('');
  useKeepPage();
  useEffect(() => { setReader(readKept()); const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const r = await call({ tenantId, action: 'tabs' });
    if (!r.ok) { setErr(r.error || 'The bar’s tabs couldn’t be read.'); return; }
    setErr(''); setD(r); setNow(Date.now());
    setOpen((o) => (o ? (r.tabs || []).find((t: Tab) => t.visitId === o.visitId) || null : o));
  }, [tenantId]);
  useEffect(() => {
    void load(); const i = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => clearInterval(i);
  }, [load]);
  const readers = (d?.readers || []).filter((r) => r.online || r.test);
  const pickReader = (id: string) => { setReader(id); try { localStorage.setItem(READER_KEY, id); } catch { /* private window */ } };
  const readerId = readers.some((r) => r.id === reader) ? reader : readers[0]?.id || '';

  // Watching a hold on the reader.
  const stopped = useRef(false);
  useEffect(() => {
    if (!watching || !tenantId) return; stopped.current = false; let n = 0;
    const go = async () => {
      if (stopped.current) return;
      const r = await call({ tenantId, action: 'holdCheck', visitId: watching });
      if (r.ok) setLive(r.hold || null);
      const st = r.hold?.state;
      if (st === 'held' || st === 'declined' || st === 'stopped' || st === 'released' || n++ > 75) { setWatching(null); void load(); if (st === 'held') setMsg(`${holdWords(r.hold)}.`); return; }
      setTimeout(go, 2000);
    };
    const t = setTimeout(go, 1500);
    return () => { stopped.current = true; clearTimeout(t); };
  }, [watching, tenantId, load]);

  const startHold = async (visitId: string) => {
    if (!tenantId || !readerId) return; setBusy(`hold:${visitId}`); setMsg('');
    const r = await call({ tenantId, action: 'hold', visitId, readerId });
    setBusy(null);
    if (!r.ok) { setMsg(r.error || 'The card hold couldn’t be started.'); setLive(null); return; }
    setLive(r.hold || null);
    if (r.hold?.state !== 'held') setWatching(visitId); else { setMsg(`${holdWords(r.hold)}.`); void load(); }
  };
  const letGo = async (visitId: string) => {
    if (!tenantId) return; setBusy(`stop:${visitId}`); setMsg('');
    const r = await call({ tenantId, action: 'holdStop', visitId });
    setBusy(null); setWatching(null); setLive(null);
    setMsg(r.ok ? (r.hold?.state === 'released' ? 'The card is let go. Nothing was charged.' : 'Called off. Nothing was charged.') : r.error || 'That didn’t go through.');
    void load();
  };
  const openTab = async () => {
    if (!tenantId || !name.trim()) return; setBusy('open'); setMsg('');
    const r = await call({ tenantId, action: 'open', name: name.trim() });
    setBusy(null);
    if (!r.ok) { setMsg(r.error || 'The tab couldn’t be opened.'); return; }
    const withHold = hold && !!readerId && d?.payments;
    setOpening(false); setName('');
    await load();
    if (withHold) { setMsg(`${name.trim()}’s tab is open. Tap the card on the reader.`); await startHold(r.visitId); }
    else setMsg(`${name.trim()}’s tab is open.`);
  };
  const saveHold = async () => {
    if (!tenantId) return; setBusy('settings');
    const r = await call({ tenantId, action: 'settings', holdDollars: Number(dollars) });
    setBusy(null);
    if (!r.ok) { setMsg(r.error || 'That didn’t save.'); return; }
    setSetting(false); setMsg(`Tabs hold $${r.holdDollars} on a card from now on.`); void load();
  };

  const tabs = d?.tabs || [];
  const total = tabs.reduce((s, t) => s + t.total, 0);
  const watchedTab = watching ? tabs.find((t) => t.visitId === watching) : null;
  const holdOf = (t: Tab) => (watching === t.visitId && live ? live : t.hold);
  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">Bar tabs</h1>
            <p className="text-[14px]" style={{ color: MUTED }}>{d ? `${tabs.length} open, ${money(total)}` : 'Loading…'}</p>
          </div>
          <button type="button" onClick={() => { setOpening(true); setHold(!!d?.payments && readers.length > 0); }} className={btn} style={dark}>Open a tab</button>
        </header>
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {msg && <p role="status" className="rounded-2xl bg-[#fff] px-4 py-3 text-[14.5px]" style={{ border: `1px solid ${LINE}` }}>{msg}</p>}
        {watchedTab && live && ['starting', 'on_reader'].includes(live.state) && <div role="status" className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: INK, color: '#fff' }}>
          <p className="flex-1 text-[15px]"><b className="font-semibold">{watchedTab.name}:</b> tap, insert or swipe on {readers.find((r) => r.id === (live.readerId || readerId))?.label || 'the reader'}. Up to {money(live.cents / 100)} is held, nothing charged.</p>
          <button type="button" disabled={busy === `stop:${watchedTab.visitId}`} onClick={() => letGo(watchedTab.visitId)} className={btn} style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}>Cancel</button>
        </div>}

        {opening && <form onSubmit={(e) => { e.preventDefault(); void openTab(); }} className="space-y-3 rounded-2xl bg-[#fff] p-4" aria-labelledby="open-tab">
          <p id="open-tab" className="text-[17px] font-semibold">Open a tab</p>
          <label className="block"><span className="text-[13px]" style={{ color: MUTED }}>Name, so the bar knows whose it is</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="Maria, red jacket" className="mt-1 w-full min-h-[48px] rounded-xl border px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
          {d?.payments && readers.length > 0 ? <>
            <button type="button" role="switch" aria-checked={hold} onClick={() => setHold((v) => !v)} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left" style={{ background: SOFT }}>
              <span><span className="block text-[14.5px] font-semibold">Hold a card</span><span className="block text-[13px]" style={{ color: MUTED }}>Up to {money(d.holdDollars)}. Nothing is charged until the tab is closed.</span></span>
              <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={hold ? dark : { background: '#fff', color: MUTED }}>{hold ? 'On' : 'Off'}</span></button>
            {hold && readers.length > 1 && <label className="block"><span className="text-[13px]" style={{ color: MUTED }}>The bar’s card reader</span>
              <select value={readerId} onChange={(e) => pickReader(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[15px]" style={{ borderColor: LINE }}>
                {readers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>}
          </> : <p className="text-[13.5px]" style={{ color: MUTED }}>{d?.payments ? 'No card reader is online, so this tab opens without a card held.' : 'Card payments aren’t set up, so tabs open without a card held.'}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={!name.trim() || busy === 'open'} className={`${btn} flex-1`} style={dark}>{busy === 'open' ? 'Opening…' : hold && d?.payments && readers.length ? 'Open, and tap the card' : 'Open the tab'}</button>
            <button type="button" onClick={() => setOpening(false)} className={btn} style={quiet}>Cancel</button>
          </div>
        </form>}

        {d && tabs.length === 0 && !opening && <p className="rounded-2xl bg-[#fff] px-4 py-8 text-center text-[15px]" style={{ color: MUTED, border: `1px dashed ${LINE}` }}>No tabs open at the bar.</p>}
        {tabs.length > 0 && <section aria-label="Open tabs" className="rounded-2xl bg-[#fff] p-2">
          {tabs.map((t, i) => { const h = holdOf(t); const warn = !h || ['declined', 'stopped', 'released'].includes(h.state);
            return <button key={t.visitId} type="button" onClick={() => setOpen(t)} className="flex w-full items-center gap-3 rounded-xl px-3 min-h-[60px] text-left" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
              <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold">{t.name}</span>
                <span className="block truncate text-[13px]" style={{ color: warn ? AMBER : isHeld(h) ? MUTED : INK }}>{holdWords(h)}. {since(t.openedAt, now)}</span></span>
              <span className="text-[15px] font-semibold tabular-nums">{money(t.total)}</span>
            </button>; })}
        </section>}

        {d?.manager && <div className="flex flex-wrap items-center gap-2 px-1 text-[13.5px]" style={{ color: MUTED }}>
          {setting ? <>
            <label className="flex items-center gap-2">A tab holds $<input inputMode="numeric" value={dollars} onChange={(e) => setDollars(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} aria-label="Hold amount in dollars" className="h-11 w-20 rounded-xl border bg-[#fff] px-3 text-[15px]" style={{ borderColor: LINE, color: INK }} /> on a card</label>
            <button type="button" disabled={busy === 'settings' || !dollars} onClick={saveHold} className={btn} style={dark}>Save</button>
            <button type="button" onClick={() => setSetting(false)} className={btn} style={quiet}>Cancel</button>
          </> : <button type="button" onClick={() => { setDollars(String(d.holdDollars)); setSetting(true); }} className="min-h-[44px] underline-offset-2 hover:underline">A tab holds {money(d.holdDollars)} on a card. Change it</button>}
        </div>}
      </div>

      {open && firestore && tenantId && (() => { const h = holdOf(open);
        return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label={`${open.name}’s tab`}>
          <div className="w-full max-w-xl max-h-[94dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-4" style={{ background: SOFT }}>
            <div className="mb-2 space-y-2 rounded-2xl bg-[#fff] p-3">
              <p className="text-[14px]" style={{ color: isHeld(h) ? GREEN : h?.state === 'declined' ? AMBER : MUTED }}>{holdWords(h)}</p>
              <div className="flex flex-wrap gap-2">
                {!isHeld(h) && !(h && ['starting', 'on_reader', 'charging', 'charged'].includes(h.state)) && d?.payments && readers.length > 0 && <button type="button" disabled={busy === `hold:${open.visitId}`} onClick={() => startHold(open.visitId)} className={btn} style={quiet}>{h?.state === 'declined' ? 'Try the card again' : 'Hold a card'}</button>}
                {(isHeld(h) || (h && ['starting', 'on_reader'].includes(h.state))) && <button type="button" disabled={busy === `stop:${open.visitId}`} onClick={() => letGo(open.visitId)} className={btn} style={quiet}>{isHeld(h) ? 'Let the card go' : 'Cancel the card'}</button>}
                {viaPortal ? <span className="flex min-h-[44px] items-center text-[13.5px]" style={{ color: MUTED }}>Close the tab at the desk.</span>
                  : <a href={`/pos?checkout=${encodeURIComponent(open.visitId)}&tab=1`} className={`${btn} inline-flex items-center`} style={dark}>{isHeld(h) ? 'Close at the desk, on the held card' : 'Close at the desk'}</a>}
                <button type="button" onClick={() => { setOpen(null); void load(); }} className={`${btn} ml-auto`} style={quiet}>Done</button>
              </div>
            </div>
            <TableTab key={open.visitId} firestore={firestore} tenantId={tenantId} party={{ id: open.partyId, name: open.name, size: 1, guestIds: [], unitIds: [] }} tableName="Bar" by={d?.meName || 'The bar'} />
          </div>
        </div>; })()}
    </div>
  );
}
