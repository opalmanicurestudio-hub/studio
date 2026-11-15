'use client';
// src/app/(app)/tables/page.tsx — MY TABLES: a server's phone during service. What each of their tables needs next
// (lib/nudges, worked out by the server: api/tab 'nudges'), most pressing first: food waiting at the pass, a course
// running late, the next course to fire, checking back, a table that hasn't ordered, an allergy to keep in mind. Each
// nudge has its own step (fire the course, mark it done, or "Not yet" for five minutes). Below, their tables; tapping
// one opens its tab, where the server can mark that the table asked for the check (the host stand then knows it's
// nearly free). Each table shows where it is in its meal (lib/table-stage). "My tables" are the ones in the person's
// section on the host stand's floor; with no section set, every table shows. The phone buzzes for a new nudge that
// can't wait, where the phone allows it. Tables waiting to be cleared link to Clear and reset (design canvas ClearReset).
// Through a Wi-Fi drop (lib/outbox, lib/last-seen): the tables it last had, with their time; firing a course and the
// nudges' steps are kept on the phone and sent when the connection's back.
// A table can be handed to someone else (a break, a big party next door; design canvas "Tonight's sections"): theirs
// alone tonight, and their phone buzzes with the table and where its meal is (api/host/floor 'hand').
// What the kitchen tells the floor shows at the top (tonight's 86 list and its message; components/host/FloorWord), and
// the kitchen's calls for this person (a run of plates for a runner, "Come to the pass" for a table's server) with "I'm
// on it" and "Done" (api/back 'callStep'; design canvas "The bar and the pass").
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { send } from '@/lib/outbox';
import { keepLast, lastOf } from '@/lib/last-seen';
import { ConnectionBar } from '@/components/shared/ConnectionBar';
import { useKeepPage } from '@/components/pwa/keep-page';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { TableTab } from '@/components/host/TableTab';
import { FloorWord } from '@/components/host/FloorWord';
import type { FloorWord as Word } from '@/lib/floor-word';
import type { Nudge } from '@/lib/nudges';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const POLL_MS = 15000;
const btn = 'min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40';
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const dark = { background: INK, color: '#fff' } as const;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const ago = (since: number, now: number) => { const m = Math.max(0, Math.floor((now - since) / 60000)); return m < 1 ? 'now' : `${m} min`; };

type Row = { visitId: string; table: string; staffIds: string[]; total: number; party: any; stage?: { words: string; step: number; freeIn: number | null }; checkAt?: string | null };
type CallRow = { id: string; to: string; line: string; from: string; at: string; status: 'open' | 'coming'; run: boolean };
type Data = { tables: Row[]; nudges: Nudge[]; mineOnly: boolean; hasSection: boolean; meName: string; session: string | null; toClear?: number; calls?: CallRow[]; word?: Word };

/** A step through api/tab: kept on the phone when there's no connection and `keep` names it. */
async function call(body: any, keep?: string): Promise<any> {
  // Kept for 20 minutes at most: a course fired later than that, or a nudge, is no longer right to send.
  const r = await send('/api/tab', body, { label: keep || 'A tap', auth: 'user', keep: !!keep, tenantId: String(body.tenantId || ''), afterWrites: body.action === 'fire', maxAgeMs: 20 * 60000 });
  return r.d && typeof r.d === 'object' ? r.d : { ok: false, error: 'That didn’t go through.' };
}
/** A step on tonight's floor (api/host/floor): never kept for later, since sections change by the minute. */
async function floorCall(body: any): Promise<any> {
  const r = await send('/api/host/floor', body, { label: 'My tables', auth: 'user', keep: false, tenantId: String(body.tenantId || '') });
  return r.d && typeof r.d === 'object' ? r.d : { ok: false, error: 'That didn’t go through.' };
}
type Mate = { id: string; name: string; on: boolean };
const readMine = () => { try { return localStorage.getItem('cf.tables.mine') !== 'all'; } catch { return true; } };

export default function MyTablesPage() {
  const { firestore } = useFirebase() as any;
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [mine, setMine] = useState(true);
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  // Handing the open table to someone: who's on the floor's team (tonight's first), and who's picked.
  const [mates, setMates] = useState<Mate[] | null>(null); const [handTo, setHandTo] = useState<string | null>(null); const [handErr, setHandErr] = useState(''); const [matesIn, setMatesIn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);
  // No connection: what the phone last had, and when (null while the server answers).
  const [asOf, setAsOf] = useState<number | null>(null); const good = useRef(0);
  useKeepPage();
  useEffect(() => { setMine(readMine()); }, []);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const r = await call({ tenantId, action: 'nudges', mine });
    if (r.offline) {
      if (!good.current) { const last = lastOf<Data>(`tables.${tenantId}.${mine ? 'mine' : 'all'}`); if (last) { good.current = last.at; setD(last.data); } }
      setAsOf(good.current || Date.now()); return;
    }
    if (!r.ok) { setErr(r.error || 'Your tables couldn’t be read.'); return; }
    good.current = Date.now(); setErr(''); setD(r); setNow(Date.now()); setAsOf(null); keepLast(`tables.${tenantId}.${mine ? 'mine' : 'all'}`, r);
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
    const r = op === 'fire' && n.course ? await call({ tenantId, action: 'fire', visitId: n.visitId, course: n.course.n }, `${n.table}: fire ${n.course.name.toLowerCase()}`)
      : await call({ tenantId, action: 'nudge', partyId: n.partyId, key: n.key, op }, `${n.table}: ${op === 'later' ? 'not yet' : 'done'}`);
    setBusy(null);
    // Kept on the phone: off the list here, sent when the connection's back.
    if (r.kept) { setD((x) => (x ? { ...x, nudges: x.nudges.filter((y) => !(y.visitId === n.visitId && y.key === n.key)) } : x));
      setMsg(op === 'fire' ? `${n.course?.name} fires for ${n.table} when the connection’s back. Open the table to print a paper ticket if it’s a while.` : 'Saved. It’s sent when the connection’s back.'); return; }
    if (!r.ok) setMsg(r.error || 'That didn’t go through.');
    else if (op === 'fire') setMsg(`${n.course?.name} fired for ${n.table}. The kitchen has it now.`);
    void load();
  };

  // The table asked for the check, so the host stand sees it's nearly free (or that was a mistake).
  const checkAsked = async (row: Row) => {
    if (!tenantId || !row.party?.id) return; setBusy(`check:${row.party.id}`);
    const r = await call({ tenantId, action: 'check', partyId: row.party.id, op: row.checkAt ? 'undo' : 'asked' });
    setBusy(null);
    if (!r.ok) { setMsg(r.error || 'That didn’t go through.'); return; }
    setMsg(r.checkAt ? `The host stand knows ${row.table} asked for the check.` : `${row.table} isn’t asking for the check.`);
    setOpen((o) => (o && o.visitId === row.visitId ? { ...o, checkAt: r.checkAt || null } : o)); void load();
  };
  const startHand = async () => {
    if (!tenantId) return; setHandTo(null); setHandErr(''); setMates([]); setMatesIn(false);
    const r = await floorCall({ tenantId, action: 'sections' });
    if (!r.ok) { setMates(null); setMsg(r.error || 'Tonight’s team couldn’t be read.'); return; }
    setMates((r.people || []).filter((p: Mate) => p.id !== r.me)); setMatesIn(true);
  };
  const hand = async (row: Row) => {
    if (!tenantId || !handTo || !row.party?.id) return; setBusy(`hand:${row.party.id}`); setHandErr('');
    const r = await floorCall({ tenantId, action: 'hand', partyId: row.party.id, to: handTo });
    setBusy(null);
    if (!r.ok) { setHandErr(r.error || 'That didn’t go through.'); return; }
    const who = (mates || []).find((m) => m.id === handTo)?.name.split(' ')[0] || 'They';
    setMates(null); setOpen(null); setMsg(`${row.table} is ${who}’s now. ${r.told ? 'Their phone buzzed.' : 'Let them know.'}`); void load();
  };
  // A call from the kitchen: "I'm on it" (so nobody doubles up), then "Done" (api/back, as themselves).
  const callStep = async (c: CallRow, step: 'coming' | 'done' | 'release') => {
    if (!tenantId) return; setBusy(`call:${c.id}`); setMsg('');
    const r = await send('/api/back', { tenantId, action: 'callStep', id: c.id, step }, { label: 'My tables', auth: 'user', keep: false, tenantId });
    setBusy(null);
    const out: any = r.d && typeof r.d === 'object' ? r.d : { ok: false };
    if (!out.ok) { setMsg(out.error || 'That didn’t go through.'); return; }
    if (out.already && step === 'coming') setMsg(`${String(out.call?.takenBy || 'Someone').split(' ')[0]} already has it.`);
    void load();
  };
  const tables = d?.tables || [];
  const guests = tables.reduce((s, t) => s + (Number(t.party?.size) || 0), 0);
  const actions = (n: Nudge) => {
    const b = busy === `${n.visitId}|${n.key}`; const row = tables.find((t) => t.visitId === n.visitId);
    const openIt = row ? <button type="button" onClick={() => setOpen(row)} className={btn} style={quiet}>Open table</button> : null;
    // Asked from their phones (the guest pass): "On it" tells them someone has it.
    if (n.kind === 'asked') return <><button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={dark}>On it</button>{openIt}</>;
    if (n.kind === 'fire') return <><button type="button" disabled={b} onClick={() => step(n, 'fire')} className={btn} style={dark}>Fire {n.course?.name.toLowerCase()}</button><button type="button" disabled={b} onClick={() => step(n, 'later')} className={btn} style={quiet}>Not yet</button></>;
    if (n.kind === 'at_pass') return <><button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={dark}>I’ll take it</button>{openIt}</>;
    if (n.kind === 'late') return <><button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={dark}>Told them</button>{openIt}</>;
    if (n.kind === 'check_back') return <button type="button" disabled={b} onClick={() => step(n, 'done')} className={btn} style={quiet}>Checked</button>;
    if (n.kind === 'paid') return <>{row ? <button type="button" onClick={() => setOpen(row)} className={btn} style={dark}>Close the check</button> : null}<button type="button" disabled={b} onClick={() => step(n, 'later')} className={btn} style={quiet}>Not yet</button></>;
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
                <button key={label} type="button" role="radio" aria-checked={mine === v} onClick={() => pick(v)} className="min-h-[44px] rounded-lg px-3 text-[13.5px] font-semibold" style={mine === v ? dark : { color: MUTED }}>{label}</button>))}
            </div>
          )}
        </header>
        {(d?.toClear || 0) > 0 && <Link href="/clear" className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl bg-[#fff] px-4 text-[15px] font-semibold" style={{ border: `1px solid ${LINE}` }}>
          <span>{d!.toClear} {d!.toClear === 1 ? 'table' : 'tables'} to clear</span><span className="text-[13.5px]" style={{ color: MUTED }}>Clear and reset</span></Link>}
        {d && !d.hasSection && tables.length > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>No section is set for you tonight, so every table shows. The host sets tonight’s sections at the host stand.</p>}
        {tenantId && <ConnectionBar tenantId={tenantId} down={asOf !== null} asOf={asOf} />}
        <FloorWord word={d?.word} />
        {(d?.calls || []).length > 0 && <section aria-label="Calls for you" className="space-y-2">
          {(d?.calls || []).map((c) => (
            <article key={c.id} className="flex items-center gap-3 rounded-2xl bg-[#fff] p-4" style={c.status === 'open' ? { boxShadow: `inset 0 0 0 2px ${INK}` } : undefined}>
              <div className="min-w-0 flex-1"><p className="text-[16px] font-semibold leading-snug">{c.run ? `Food to run: ${c.line}` : c.line}</p>
                <p className="text-[13px]" style={{ color: MUTED }}>{c.from}, {ago(Date.parse(c.at), now)}{c.status === 'coming' ? '. You’re on it' : ''}</p></div>
              {c.status === 'open'
                ? <button type="button" disabled={busy === `call:${c.id}`} onClick={() => callStep(c, 'coming')} className={btn} style={dark}>{c.run ? 'I’m on it' : 'On my way'}</button>
                : <button type="button" disabled={busy === `call:${c.id}`} onClick={() => callStep(c, 'done')} className={btn} style={quiet}>Done</button>}
            </article>
          ))}
        </section>}
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
                <span className="flex-1 min-w-0"><span className="block text-[16px] font-semibold truncate">{t.table}</span><span className="block text-[13px] truncate" style={{ color: MUTED }}>{t.party?.name}, {t.party?.size} {Number(t.party?.size) === 1 ? 'guest' : 'guests'}{t.stage ? `. ${t.stage.words}` : ''}</span></span>
                <span className="text-[15px] font-semibold tabular-nums">{money(t.total)}</span>
              </button>
            ))}
          </section>
        )}
      </div>

      {open && firestore && tenantId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-label={`${open.table} tab`}>
          <div className="w-full max-w-xl max-h-[94dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-4" style={{ background: SOFT }}>
            <div className="flex flex-wrap justify-end gap-2 pb-2">
              <button type="button" disabled={busy === `check:${open.party?.id}`} onClick={() => checkAsked(open)} className={btn} style={quiet}>{open.checkAt ? 'Not asking for the check' : 'They asked for the check'}</button>
              {d?.session && <button type="button" onClick={() => (mates ? setMates(null) : startHand())} className={btn} style={quiet} aria-expanded={!!mates}>Hand to someone</button>}
              <button type="button" onClick={() => { setOpen(null); setMates(null); void load(); }} className={btn} style={quiet}>Done</button>
            </div>
            {mates && <div className="mb-3 space-y-3 rounded-2xl bg-[#fff] p-4" role="group" aria-labelledby="hand-title">
              <div><p id="hand-title" className="text-[17px] font-semibold">Hand {open.table} to someone</p>
                <p className="text-[14px]" style={{ color: MUTED }}>The table, its check and anything the guests asked for go with it.</p></div>
              {handErr && <p role="alert" className="rounded-xl px-3 py-2 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{handErr}</p>}
              {!matesIn ? <p className="text-[14px]" style={{ color: MUTED }}>Reading tonight’s team…</p> : mates.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>Nobody else is on the floor’s team yet.</p>
                : <div role="radiogroup" aria-label="Who takes it" className="flex flex-wrap gap-2">
                  {mates.map((m) => <button key={m.id} type="button" role="radio" aria-checked={handTo === m.id} onClick={() => setHandTo(m.id)} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold"
                    style={handTo === m.id ? dark : { background: SOFT, color: INK }}>{m.name.split(' ')[0]}{m.on ? '' : <span className="font-normal" style={{ color: handTo === m.id ? '#fff' : MUTED }}>, not on tonight</span>}</button>)}
                </div>}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!handTo || busy === `hand:${open.party?.id}`} onClick={() => hand(open)} className={`${btn} flex-1`} style={dark}>{handTo ? `Hand it to ${(mates.find((m) => m.id === handTo)?.name || '').split(' ')[0]}` : 'Pick who takes it'}</button>
                <button type="button" onClick={() => setMates(null)} className={btn} style={quiet}>Cancel</button>
              </div>
            </div>}
            <TableTab key={open.visitId} firestore={firestore} tenantId={tenantId} party={open.party} tableName={open.table} by={d?.meName || 'A server'} />
          </div>
        </div>
      )}
    </div>
  );
}
