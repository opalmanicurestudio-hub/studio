'use client';
// src/components/kitchen/SafetySheet.tsx — FOOD SAFETY on the kitchen screen (lib/food-safety; api/kitchen 'safety',
// 'safetyLog', 'coolCheck'). Readings taken as the work is done, each with the name of whoever took it (a PIN on a shared
// tablet): a delivery's temperature as it comes in, a batch cooling (checked at its 2-hour and 6-hour marks, the next
// one shown and asked for when it's due), hot holding and cold holding. A reading outside its limit asks what was done.
// What's logged shows on the Binder for the inspector.
import { useEffect, useState } from 'react';
import { useT } from '@/components/kitchen/ScreenLang';
import { COLD_MAX, HOT_MIN, tempOk, type DeliveryKind, type LogKind } from '@/lib/food-safety';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318';
type Post = (body: any) => Promise<{ status: number; d: any }>;
type Cool = { state: 'cooling' | 'done' | 'missed'; stage: 1 | 2; dueAt: string; dueWords: string; missedWords: string | null; startedAt: string; checks: { at: string; tempF: number; by: string }[] };
type Log = { id: string; kind: LogKind; at: string; by: string; item: string; tempF: number; ok: boolean; note: string | null; supplier: string | null; deliveryKind: DeliveryKind | null; cooling?: Cool };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const btn = 'min-h-[48px] rounded-xl px-4 text-[15px] font-semibold disabled:opacity-40';
const field = 'h-12 rounded-xl px-3 text-[16px] bg-[#fff] outline-none focus:border-[#16171a]';

export function SafetySheet({ post, onClose, onPin }: { post: Post; onClose: () => void; onPin: () => void }) {
  const say = useT();
  const [logs, setLogs] = useState<Log[] | null>(null); const [cooling, setCooling] = useState<Log[]>([]); const [undone, setUndone] = useState<Log[]>([]);
  const [kind, setKind] = useState<LogKind>('delivery'); const [item, setItem] = useState(''); const [supplier, setSupplier] = useState('');
  const [dk, setDk] = useState<DeliveryKind>('cold'); const [temp, setTemp] = useState(''); const [note, setNote] = useState(''); const [ago, setAgo] = useState(0);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState('');
  const load = async () => { const { d } = await post({ action: 'safety' }); if (d?.ok) { setLogs(d.logs || []); setCooling(d.cooling || []); setUndone(d.undone || []); } else setErr(d?.error || say('The readings didn’t load.')); };
  useEffect(() => { void load(); const i = setInterval(() => void load(), 60000); return () => clearInterval(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Number(temp); const reading = temp.trim() !== '' && Number.isFinite(n);
  const out = reading && (kind === 'delivery' ? !tempOk(dk, n) : kind === 'cooling' ? n < HOT_MIN : !tempOk(kind, n));
  const fail = (d: any) => { if (d?.code === 'pin') { setErr(say('Tap Who’s working? and put in your PIN, so the log shows who took the reading.')); onPin(); } else setErr(d?.error || say('That didn’t save.')); };
  const save = async () => {
    setErr(''); setSaved(''); setBusy(true);
    const { d } = await post({ action: 'safetyLog', kind, item, tempF: temp, ...(kind === 'delivery' ? { supplier, deliveryKind: dk } : {}), ...(kind === 'cooling' ? { startedAt: new Date(Date.now() - ago * 60000).toISOString() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false); if (!d?.ok) { fail(d); return; }
    setSaved(say('Saved: {what}, {t}°F.', { what: d.log.item, t: d.log.tempF })); setItem(''); setTemp(''); setNote(''); setAgo(0); void load();
  };
  const reasons: string[] = kind === 'delivery' ? ['Refused, sent back'] : kind === 'hot' ? ['Reheated to 165°F', 'Thrown out'] : kind === 'cold' ? ['Moved to the walk-in', 'Thrown out'] : ['Reheated first'];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-labelledby="safety-title">
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 space-y-4" style={{ color: INK }}>
        <div className="flex items-start gap-3">
          <div className="flex-1"><h2 id="safety-title" className="text-[20px] font-semibold">{say('Food safety')}</h2>
            <p className="text-[14px]" style={{ color: MUTED }}>{say('Readings as they’re taken. Each one carries your name.')}</p></div>
          <button type="button" onClick={onClose} aria-label={say('Close')} className="h-11 w-11 rounded-xl grid place-items-center" style={{ border: `1px solid ${LINE}` }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
        {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
        {saved && <p className="rounded-xl px-3 py-2 text-[14px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }} role="status">{saved}</p>}

        {cooling.length + undone.length > 0 && (
          <section aria-labelledby="cooling-title" className="space-y-2">
            <h3 id="cooling-title" className="text-[16px] font-semibold">{say('Cooling now')}</h3>
            {undone.map((c) => <CoolRow key={c.id} log={c} post={post} onDone={() => void load()} onFail={fail} />)}
            {cooling.map((c) => <CoolRow key={c.id} log={c} post={post} onDone={() => void load()} onFail={fail} />)}
          </section>
        )}

        <section aria-labelledby="log-title" className="space-y-3 rounded-2xl p-3" style={{ background: SOFT }}>
          <h3 id="log-title" className="text-[16px] font-semibold">{say('Log a reading')}</h3>
          <div role="radiogroup" aria-label={say('Which reading')} className="grid grid-cols-2 gap-2">
            {(['delivery', 'cooling', 'hot', 'cold'] as LogKind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setErr(''); setNote(''); }} className={btn} style={kind === k ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>
                {k === 'delivery' ? say('Delivery') : k === 'cooling' ? say('Start cooling') : k === 'hot' ? say('Hot holding') : say('Cold holding')}</button>))}
          </div>
          <p className="text-[13.5px]" style={{ color: MUTED }}>{kind === 'delivery' ? say('Cold 41°F or below, frozen 0°F or below, hot 135°F or above. Refuse it if it isn’t.') : kind === 'cooling' ? say('From 135°F to 70°F within 2 hours, then to 41°F within 4 more. This screen asks at each mark.') : kind === 'hot' ? say('135°F or above.') : say('41°F or below.')}</p>
          <input value={item} onChange={(e) => setItem(e.target.value.slice(0, 80))} placeholder={kind === 'delivery' ? say('What came in') : kind === 'cooling' ? say('What’s cooling') : say('What it is')} aria-label={say('What it is')} className={`${field} w-full`} style={{ border: `1px solid ${LINE}` }} />
          {kind === 'delivery' && <>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value.slice(0, 60))} placeholder={say('From (the supplier)')} aria-label={say('From (the supplier)')} className={`${field} w-full`} style={{ border: `1px solid ${LINE}` }} />
            <div role="radiogroup" aria-label={say('Cold, frozen or hot')} className="grid grid-cols-3 gap-2">
              {(['cold', 'frozen', 'hot'] as DeliveryKind[]).map((k) => <button key={k} type="button" role="radio" aria-checked={dk === k} onClick={() => setDk(k)} className={btn} style={dk === k ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>{k === 'cold' ? say('Cold') : k === 'frozen' ? say('Frozen') : say('Hot')}</button>)}
            </div>
          </>}
          {kind === 'cooling' && (
            <div role="radiogroup" aria-label={say('When it came off the heat')} className="flex flex-wrap gap-2">
              {[0, 15, 30, 60].map((m) => <button key={m} type="button" role="radio" aria-checked={ago === m} onClick={() => setAgo(m)} className={btn} style={ago === m ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>{m === 0 ? say('Off the heat now') : say('{n} min ago', { n: m })}</button>)}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value.replace(/[^\d.-]/g, '').slice(0, 6))} placeholder={say('Reading')} aria-label={say('Temperature in °F')} className={`${field} w-28`} style={{ border: `1px solid ${out ? AMBER : LINE}` }} />
            <span className="text-[15px]" style={{ color: MUTED }}>°F</span>
            {reading && <span className="text-[14px] font-semibold" style={{ color: out ? AMBER : GREEN }}>{out ? say('Outside the limit') : say('Within the limit')}</span>}
          </div>
          {out && <>
            <div className="flex flex-wrap gap-2">{reasons.map((x) => <button key={x} type="button" onClick={() => setNote(say(x))} className={btn} style={{ background: AMBER_TINT, color: AMBER }}>{say(x)}</button>)}</div>
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={say('What was done?')} aria-label={say('What was done?')} className={`${field} w-full`} style={{ border: `1px solid ${AMBER}` }} />
          </>}
          <button type="button" onClick={() => void save()} disabled={busy || !item.trim() || !reading || (out && !note.trim())} className={`${btn} w-full text-[#fff]`} style={{ background: INK }}>{busy ? say('Saving…') : say('Save the reading')}</button>
        </section>

        <section aria-labelledby="today-title" className="space-y-1">
          <h3 id="today-title" className="text-[16px] font-semibold">{say('Today')}</h3>
          {!logs ? <p className="text-[14px]" style={{ color: MUTED }}>{say('Loading…')}</p> : logs.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>{say('Nothing logged yet today.')}</p>
            : logs.slice(0, 30).map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
                <span className="w-16 shrink-0 text-[13px] tabular-nums" style={{ color: MUTED }}>{clock(l.at)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{l.item}</span>
                  <span className="block text-[13px]" style={{ color: l.ok ? MUTED : AMBER }}>{l.kind === 'delivery' ? say('Delivery') : l.kind === 'cooling' ? say('Cooling') : l.kind === 'hot' ? say('Hot holding') : say('Cold holding')}, {l.by}{l.note ? `. ${l.note}` : ''}</span></span>
                <span className="text-[16px] font-semibold tabular-nums" style={{ color: l.ok ? INK : AMBER }}>{l.tempF}°F</span>
              </div>))}
        </section>
      </div>
    </div>
  );
}

function CoolRow({ log, post, onDone, onFail }: { log: Log; post: Post; onDone: () => void; onFail: (d: any) => void }) {
  const say = useT();
  const [v, setV] = useState(''); const [done, setDone] = useState(''); const [ask, setAsk] = useState(''); const [busy, setBusy] = useState(false);
  const c = log.cooling!; const left = Date.parse(c.dueAt) - Date.now(); const soon = left < 15 * 60000;
  const n = Number(v); const reading = v.trim() !== '' && Number.isFinite(n);
  // Past its mark with nobody checking: what was done is all that's asked (a reading too, if there is one).
  const missed = c.state === 'missed';
  const go = async () => {
    setBusy(true); const { d } = await post({ action: 'coolCheck', logId: log.id, ...(v.trim() ? { tempF: v } : {}), ...(done.trim() ? { done: done.trim() } : {}) }); setBusy(false);
    if (d?.ok) { setV(''); setDone(''); setAsk(''); onDone(); return; }
    if (d?.error && /Reheat/.test(d.error)) { setAsk(d.error); return; }
    onFail(d);
  };
  return (
    <div className="rounded-2xl p-3 space-y-2" style={{ border: `1px solid ${soon ? AMBER : LINE}`, background: soon ? AMBER_TINT : '#fff' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[16px] font-medium">{log.item}</p>
          <p className="text-[13.5px]" style={{ color: soon ? AMBER : MUTED }}>{say('Off the heat {t}', { t: clock(c.startedAt) })}{c.checks.length ? `, ${say('last {n}°F', { n: c.checks[c.checks.length - 1].tempF })}` : ''}.{missed ? '' : ` ${say('Next: {mark}', { mark: say('{t}°F by {time}', { t: c.stage === 1 ? 70 : COLD_MAX, time: clock(c.dueAt) }) })}`}</p></div>
      </div>
      {(ask || missed) && <>
        <p className="text-[14px] font-semibold" style={{ color: AMBER }}>{missed ? `${say('Missed its mark. What was done?')} ${say(c.missedWords || '')}` : say(ask)}</p>
        <div className="flex flex-wrap gap-2">{['Reheated to 165°F', 'Thrown out'].map((x) => <button key={x} type="button" aria-pressed={done === say(x)} onClick={() => setDone(say(x))} className={btn} style={done === say(x) ? { background: AMBER, color: '#fff', border: `1px solid ${AMBER}` } : { background: '#fff', color: AMBER, border: `1px solid ${AMBER}` }}>{say(x)}</button>)}</div>
      </>}
      <div className="flex items-center gap-2">
        <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.-]/g, '').slice(0, 6))} placeholder={say('Reading')} aria-label={say('{item} reading in °F', { item: log.item })} className={`${field} w-28`} style={{ border: `1px solid ${LINE}` }} />
        <span className="text-[15px]" style={{ color: MUTED }}>°F</span>
        <button type="button" disabled={busy || (missed ? !done.trim() : !reading || (!!ask && !done.trim()))} onClick={() => void go()} className={`${btn} text-[#fff]`} style={{ background: INK }}>{say('Save')}</button>
      </div>
      {reading && !ask && !missed && <p className="text-[13px]" style={{ color: MUTED }}>{c.stage === 1 ? say('Needs 70°F or below by the 2-hour mark.') : say('Needs {n}°F or below by the 6-hour mark.', { n: COLD_MAX })}</p>}
    </div>
  );
}
