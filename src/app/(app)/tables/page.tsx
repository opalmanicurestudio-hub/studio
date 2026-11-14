'use client';
// src/app/(app)/tables/page.tsx — MY TABLES: a server's phone during service. What each of their tables needs next
// (lib/nudges, worked out by the server: api/tab 'nudges'), most pressing first: food waiting at the pass, a course
// running late, the next course to fire, checking back, a table that hasn't ordered, an allergy to keep in mind. Each
// nudge has its own step (fire the course, mark it done, or "Not yet" for five minutes). Below, their tables; tapping
// one opens its tab. "My tables" are the ones in the person's section on the host stand's floor; with no section set,
// every table shows. The phone buzzes for a new nudge that can't wait, where the phone allows it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { TableTab } from '@/components/host/TableTab';
import type { Nudge } from '@/lib/nudges';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const POLL_MS = 15000;
const btn = 'min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40';
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const dark = { background: INK, color: '#fff' } as const;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const ago = (since: number, now: number) => { const m = Math.max(0, Math.floor((now - since) / 60000)); return m < 1 ? 'now' : `${m} min`; };

type Row = { visitId: string; table: string; staffIds: string[]; total: number; party: any };
type Data = { tables: Row[]; nudges: Nudge[]; mineOnly: boolean; hasSection: boolean; meName: string; session: string | null };

async function call(body: any): Promise<any> {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/tab', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection. Try again in a moment.' }));
}
const readMine = () => { try { return localStorage.getItem('cf.tables.mine') !== 'all'; } catch { return true; } };

export default function MyTablesPage() {
  const { firestore } = useFirebase() as any;
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [mine, setMine] = useState(true);
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => { setMine(readMine()); }, []);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const r = await call({ tenantId, action: 'nudges', mine });
    if (!r.ok) { setErr(r.error || 'Your tables couldn’t be read.'); return; }
    setErr(''); setD(r); setNow(Date.now());
    // A buzz for a new nudge that can't wait (food at the pass, a course running late), where the phone allows it.
    const keys = (r.nudges || []).map((n: Nudge) => `${n.visitId}|${n.key}`);
    if (seen.current && (r.nudges || []).some((n: Nudge) => n.urgent && !seen.current!.has(`${n.visitId}|${n.key}`))) { try { navigator.vibrate?.(200); } catch { /* no buzz here */ } }
    seen.current = new Set(keys);
  }, [tenantId, mine]);
  useEffect(() => {
    void load(); const i = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') void load(); }; document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  const pick = (m: boolean) => { setMine(m); try { localStorage.setItem('cf.tables.mine', m ? 'mine' : 'all'); } catch { /* private window */ } };
  const step = async (n: Nudge, op: 'fire' | 'done' | 'later') => {
    if (!tenantId) return; setBusy(`${n.visitId}|${n.key}`); setMsg('');
    // Firing the course is enough: once it's fired the nudge has nothing left to say.
    const r = op === 'fire' && n.course ? await call({ tenantId, action: 'fire', visitId: n.visitId, course: n.course.n }) : await call({ tenantId, action: 'nudge', partyId: n.partyId, key: n.key, op });
    setBusy(null);
    if (!r.ok) setMsg(r.error || 'That didn’t go through.');
    else if (op === 'fire') setMsg(`${n.course?.name} fired for ${n.table}. The kitchen has it now.`);
    void load();
  };

  const tables = d?.tables || [];
  const guests = tables.reduce((s, t) => s + (Number(t.party?.size) || 0), 0);
  const actions = (n: Nudge) => {
    const b = busy === `${n.visitId}|${n.key}`; const row = tables.find((t) => t.visitId === n.visitId);
    const openIt = row ? <button type="button" onClick={() => setOpen(row)} className={btn} style={quiet}>Open table</button> : null;
    if (n.kind === 'fire') return <><button type="button" disabled={b} onClick={() => step(n, 'fire')} className={btn} style={dark}>Fire {n.course?.name.toLowerCase()}</button><button type="button" disabled={b} onClick={() => step(n, 'later')} className={btn} style={quiet}>Not yet</button></>;
    if (n.kind === 'at_pass') return <><button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={dark}>I’ll take it</button>{openIt}</>;
    if (n.kind === 'late') return <><button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={dark}>Told them</button>{openIt}</>;
    if (n.kind === 'check_back') return <button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={quiet}>Checked</button>;
    if (n.kind === 'no_order') return <>{row ? <button type="button" onClick={() => setOpen(row)} className={btn} style={dark}>Take their order</button> : null}<button type="button" disabled={b} onClick={() => step(n, 'later')} className={btn} style={quiet}>Not yet</button></>;
    return <button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={quiet}>Got it</button>;
  };

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">My tables</h1>
            <p className="text-[14px]" style={{ color: MUTED }}>{d ? `${d.meName ? `${d.meName.split(' ')[0]}, ` : ''}${tables.length} ${tables.length === 1 ? 'table' : 'tables'}, ${guests} ${guests === 1 ? 'guest' : 'guests'}` : 'Loading…'}</p>
          </div>
          {d?.hasSection && (
            <div role="radiogroup" aria-label="Which tables" className="flex rounded-xl p-1 gap-1 bg-[#fff]" style={{ border: `1px solid ${LINE}` }}>
              {([[true, 'Mine'], [false, 'Every table']] as [boolean, string][]).map(([v, label]) => (
                <button key={label} type="button" role="radio" aria-checked={mine === v} onClick={() => pick(v)} className="min-h-[40px] rounded-lg px-3 text-[13.5px] font-semibold" style={mine === v ? dark : { color: MUTED }}>{label}</button>))}
            </div>
          )}
        </header>
        {d && !d.hasSection && tables.length > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>No section is set for you on the floor tonight, so every table shows. The host sets sections on the floor plan.</p>}
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {msg && <p role="status" className="rounded-2xl bg-[#fff] px-4 py-3 text-[14.5px]" style={{ border: `1px solid ${LINE}` }}>{msg}</p>}

        <section aria-label="Nudges" className="space-y-2.5">
          {d && d.nudges.length === 0 && <p className="rounded-2xl bg-[#fff] px-4 py-6 text-center text-[15px]" style={{ color: MUTED, border: `1px dashed ${LINE}` }}>{tables.length ? 'Nothing needs you right now.' : d.session ? 'No tables seated yet.' : 'The host stand hasn’t opened tonight’s floor yet.'}</p>}
          {(d?.nudges || []).map((n) => (
            <article key={`${n.visitId}|${n.key}`} className="rounded-2xl bg-[#fff] p-4 space-y-2.5" style={n.urgent ? { boxShadow: `inset 0 0 0 2px ${AMBER}` } : undefined}>
              <div className="flex items-baseline justify-between gap-3"><b className="text-[17px] font-semibold">{n.table}</b><span className="text-[13px] font-semibold" style={{ color: n.urgent ? AMBER : MUTED }}>{ago(n.since, now)}</span></div>
              <p className="text-[15px] leading-snug" style={{ color: n.kind === 'allergy' ? AMBER : INK }}>{n.text}</p>
              <div className="flex flex-wrap gap-2">{actions(n)}</div>
            </article>
          ))}
        </section>

        {tables.length > 0 && (
          <section aria-label="Tables" className="rounded-2xl bg-[#fff] p-2">
            {tables.map((t, i) => (
              <button key={t.visitId} type="button" onClick={() => setOpen(t)} className="flex w-full items-center gap-3 rounded-xl px-3 min-h-[56px] text-left" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
                <span className="flex-1 min-w-0"><span className="block text-[16px] font-semibold truncate">{t.table}</span><span className="block text-[13px] truncate" style={{ color: MUTED }}>{t.party?.name}, {t.party?.size} {Number(t.party?.size) === 1 ? 'guest' : 'guests'}</span></span>
                <span className="text-[15px] font-semibold tabular-nums">{money(t.total)}</span>
              </button>
            ))}
          </section>
        )}
      </div>

      {open && firestore && tenantId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label={`${open.table} tab`}>
          <div className="w-full max-w-xl max-h-[94dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-4" style={{ background: SOFT }}>
            <div className="flex justify-end pb-2"><button type="button" onClick={() => { setOpen(null); void load(); }} className={btn} style={quiet}>Done</button></div>
            <TableTab key={open.visitId} firestore={firestore} tenantId={tenantId} party={open.party} tableName={open.table} by={d?.meName || 'A server'} />
          </div>
        </div>
      )}
    </div>
  );
}
