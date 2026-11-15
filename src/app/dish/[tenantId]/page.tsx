'use client';
// src/app/dish/[tenantId]/page.tsx — THE DISH PIT (design canvas "Dish and barback"; lib/dish, lib/back-calls, api/back).
// A tablet by the machine, big enough for wet hands, or the phone of whoever's on dish.
//   Asked for: what the line, the bar and the floor called for (the kitchen screen's Call), longest waiting first, with
//     "On my way" so nobody doubles up and "Done" when it's there. A chime for each new one. One nobody has taken after
//     a few minutes tells the managers.
//   Heading your way: the plates and glasses that went out in each 15 minutes of the last hour (they come back within
//     the hour), and the tables being cleared right now.
//   The machine check: due or not, today's readings, a reading outside the limits asks what was done, and the last 30
//     days print for an inspector.
//   Broke something, and Closing (the closing checklist's dish items and anyone's).
import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { ClosingSheet } from '@/components/kitchen/ClosingSheet';
import { CallStrip } from '@/components/kitchen/CallSheet';
import { AMBER, AMBER_TINT, GREEN, GREEN_TINT, INK, LINE, MUTED, SOFT, PinSheet, Setup, Sheet, SheetHead, big, btn, clockOf, first, ring, useBackScreen } from '@/components/back/screen-kit';
import { BREAK_KINDS, MAX_BROKEN, brokenWords } from '@/lib/dish';
import type { Call } from '@/lib/back-calls';
import { CallList, type QueueCall } from '@/components/back/CallList';
import { esc, printPage, PRINT } from '@/lib/print-style';

type Check = { id: string; at: string; value: number; unit: string; ok: boolean; note: string | null; by: string };
type Dish = {
  day: string; flow: { blocks: { start: string; plates: number; glasses: number }[]; lastHalf: { plates: number; glasses: number } };
  clearing: { table: string; size: number; minutes: number }[]; rush: string | null;
  machine: { on: boolean; machine: 'hot' | 'chemical'; word: string; unit: string; limit: string; min: number; max: number | null; everyHours: number; due: boolean; nextAt: string | null; last: Check | null; today: Check[] };
  broken: { id: string; kind: string; count: number; note: string | null; by: string; at: string }[];
};
type Data = { me: string; screen: string; business: { name: string }; staff: { id: string; name: string } | null; signedIn: boolean; calls: QueueCall[]; mine: Call[]; dish: Dish; now: string };

function printFrame(html: string) {
  const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f); const w = f.contentWindow; if (!w) { f.remove(); return; }
  w.document.open(); w.document.write(html); w.document.close(); setTimeout(() => f.remove(), 60000);
}

function Flow({ flow }: { flow: Dish['flow'] }) {
  const top = Math.max(1, ...flow.blocks.map((b) => b.plates + b.glasses));
  const said = flow.blocks.map((b) => `${clockOf(b.start)}: ${b.plates} plates, ${b.glasses} glasses`).join('; ');
  return (
    <div className="flex items-end gap-4">
      <div className="flex items-end gap-2.5 h-[96px]" role="img" aria-label={`Every 15 minutes: ${said}`}>
        {flow.blocks.map((b, i) => {
          const last = i === flow.blocks.length - 1; const h = (n: number) => Math.round((n / top) * 80);
          return (
            <div key={b.start} className="flex flex-col items-center gap-1">
              <div className="flex w-6 flex-col justify-end" style={{ height: 80 }}>
                {b.glasses > 0 && <div style={{ height: h(b.glasses), background: last ? '#9a9ca1' : '#e3e4e7', borderRadius: b.plates ? '5px 5px 0 0' : 5 }} />}
                {b.plates > 0 && <div style={{ height: h(b.plates), background: last ? INK : '#c9cacd', borderRadius: b.glasses ? '0 0 2px 2px' : '5px 5px 2px 2px' }} />}
                {b.plates + b.glasses === 0 && <div style={{ height: 3, background: LINE, borderRadius: 2 }} />}
              </div>
              <span className="text-[11.5px] tabular-nums" style={{ color: MUTED }}>{clockOf(b.start).replace(/ (am|pm)$/, '')}</span>
            </div>
          );
        })}
      </div>
      <div className="min-w-0">
        <p className="text-[24px] font-semibold leading-tight tabular-nums">{flow.lastHalf.plates} {flow.lastHalf.plates === 1 ? 'plate' : 'plates'}</p>
        <p className="text-[13.5px]" style={{ color: MUTED }}>and {flow.lastHalf.glasses} {flow.lastHalf.glasses === 1 ? 'glass' : 'glasses'} went out in the last 30 minutes</p>
      </div>
    </div>
  );
}

function MachineCard({ m, onSave, onLog, busy }: { m: Dish['machine']; onSave: (value: string, note: string) => Promise<string | null>; onLog: () => void; busy: boolean }) {
  const [value, setValue] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  if (!m.on) return null;
  const n = Number(value); const typed = value.trim() !== '' && Number.isFinite(n);
  const out = typed && (m.machine === 'hot' ? n < m.min : n < m.min || (m.max !== null && n > m.max));
  const save = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); const r = await onSave(value, note); if (r) setErr(r); else { setValue(''); setNote(''); } };
  const last = m.last;
  return (
    <section className="rounded-2xl border p-4 space-y-2" style={m.due ? { background: AMBER_TINT, borderColor: '#f3c99a' } : { background: '#fff', borderColor: LINE }} aria-labelledby="machine-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="machine-title" className="text-[15.5px] font-semibold">{m.due ? 'Machine check due' : 'Machine check'}</h2>
        {last && !m.due && <span className="rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Good</span>}
      </div>
      {last ? <p className="text-[13.5px]" style={{ color: last.ok ? MUTED : AMBER }}>{clockOf(last.at)}, {m.word.toLowerCase()} {last.value}{m.unit === '°F' ? '°F' : ` ${m.unit}`}, {first(last.by)}{last.ok ? '' : `. ${(last.note || '').replace(/\.$/, '')}`}{m.due ? (last.ok ? '. Time for the next one.' : '. Check it again once it’s put right.') : m.nextAt ? `. Next by ${clockOf(m.nextAt)}.` : '. Done for today.'}</p>
        : <p className="text-[13.5px]" style={{ color: MUTED }}>Check it before the first rack goes through: {m.limit}.</p>}
      {m.due && (
        <form onSubmit={save} className="space-y-2">
          <div className="flex gap-2">
            <label className="flex-1"><span className="sr-only">{m.word}, {m.unit}</span>
              <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, '').slice(0, 6))} placeholder={`${m.word}, ${m.unit}`}
                className="w-full min-h-[52px] rounded-2xl border bg-[#fff] px-4 text-[17px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>
            <button type="submit" disabled={busy || !typed || (out && !note.trim())} className={`${big} px-5`} style={{ background: INK, color: '#fff' }}>Save</button>
          </div>
          {out && <label className="block"><span className="text-[13.5px] font-medium" style={{ color: AMBER }}>That’s outside {m.limit}. What did you do?</span>
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Ran it again, called for service, washing by hand"
              className="mt-1 w-full min-h-[48px] rounded-2xl border bg-[#fff] px-4 text-[15px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>}
          {err && <p role="alert" className="text-[13.5px]" style={{ color: AMBER }}>{err}</p>}
        </form>
      )}
      <button type="button" onClick={onLog} className={`${ring} min-h-[44px] text-[13.5px] font-semibold underline underline-offset-4`}>The log, to print</button>
    </section>
  );
}

function BreakSheet({ onClose, onSave }: { onClose: () => void; onSave: (kind: string, count: number, note: string) => Promise<string | null> }) {
  const [kind, setKind] = useState(''); const [count, setCount] = useState(1); const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setErr(''); const e = await onSave(kind, count, note); setBusy(false); if (e) setErr(e); else onClose(); };
  return (
    <Sheet label="Broke something" onClose={onClose}>
      <SheetHead title="Broke something" line="It happens. Logged so the business can reorder." onClose={onClose} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What broke">
        {BREAK_KINDS.map((k) => <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)} className={`min-h-[56px] rounded-2xl px-3 text-[15px] font-semibold ${ring}`}
          style={kind === k.id ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{k.label}</button>)}
      </div>
      {kind === 'other' && <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 60))} placeholder="What was it?" aria-label="What was it" className="w-full min-h-[48px] rounded-2xl border px-4 text-[15px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} />}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium">How many</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="One fewer" className={`h-12 w-12 rounded-2xl text-[20px] font-semibold ${ring}`} style={{ background: SOFT }}>−</button>
          <span className="w-10 text-center text-[20px] font-semibold tabular-nums" aria-live="polite">{count}</span>
          <button type="button" onClick={() => setCount((c) => Math.min(MAX_BROKEN, c + 1))} aria-label="One more" className={`h-12 w-12 rounded-2xl text-[20px] font-semibold ${ring}`} style={{ background: SOFT }}>+</button>
        </div>
      </div>
      {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
      <button type="button" onClick={save} disabled={busy || !kind || (kind === 'other' && !note.trim())} className={`${big} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Log it'}</button>
    </Sheet>
  );
}

export default function DishScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const s = useBackScreen<Data>(tenantId, 'dish', (d) => d.calls.filter((c) => c.status === 'open').map((c) => c.id));
  const [pinOpen, setPinOpen] = useState(false); const [breakOpen, setBreakOpen] = useState(false); const [closingOpen, setClosingOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [notice, setNotice] = useState('');
  if (!s.started) return null;
  if (!s.mode) return <Setup tenantId={tenantId} title="Set up the dish screen" place="Dish" stopped={s.stopped} onPaired={s.paired} onMe={s.useMe}
    line="A manager sets a tablet by the machine up once. After that it keeps working when they sign out: whoever’s on dish sees what the line and the bar need, and a PIN only puts a name on what they did." />;
  if (s.closed) return <main className="min-h-dvh flex items-center justify-center p-6" style={{ background: SOFT, color: INK }}><p className="max-w-sm text-center text-[16px]">{s.closed}</p></main>;
  const d = s.data;
  if (!d) return <main className="min-h-dvh flex items-center justify-center" style={{ background: SOFT }}><div className="h-8 w-8 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" /></main>;
  const now = s.now;
  const working = s.mode === 'me' ? d.staff?.name : s.staff?.name;

  const step = async (c: QueueCall, st: 'coming' | 'done' | 'release') => {
    setBusy(`${c.id}${st}`); setNotice('');
    const { status, d: r } = await s.act({ action: 'callStep', id: c.id, step: st });
    setBusy(null);
    if (!r.ok) setNotice(status === 0 ? 'No connection. Try again in a moment.' : r.error || 'That didn’t go through.');
    else if (r.already && st === 'coming' && r.call?.takenById !== d.me) setNotice(`${first(r.call?.takenBy) || 'Someone'} is already on the way.`);
  };
  const saveCheck = async (value: string, note: string) => {
    setBusy('machine'); const { status, d: r } = await s.act({ action: 'machine', value, note }); setBusy(null);
    if (r.code === 'pin') setPinOpen(true);
    return r.ok ? null : status === 0 ? 'No connection. Try again in a moment.' : r.error || 'That didn’t save.';
  };
  const saveBreak = async (kind: string, count: number, note: string) => { const { status, d: r } = await s.act({ action: 'broke', kind, count, note }); return r.ok ? null : status === 0 ? 'No connection. Try again in a moment.' : r.error || 'That didn’t save.'; };
  const printLog = async () => {
    const { d: r } = await s.post('/api/back', { action: 'machineLog' });
    if (!r.ok) { setNotice(r.error || 'The log didn’t load.'); return; }
    const rows = (r.log as (Check & { day: string; limit: string })[]).map((c) => `<tr><td>${esc(c.day)}</td><td>${esc(clockOf(c.at))}</td><td>${esc(`${c.value}${c.unit === '°F' ? '°F' : ` ${c.unit}`}`)}</td><td>${esc(c.limit)}</td><td>${c.ok ? 'Good' : '<b>Outside</b>'}</td><td>${esc(c.by)}</td><td>${esc(c.note || '')}</td></tr>`).join('');
    printFrame(printPage({ title: 'Dish machine log', shopName: d.business.name, subtitle: 'The last 30 days', body: rows ? `<table class="log"><thead><tr><th>Day</th><th>Time</th><th>Reading</th><th>Limit</th><th></th><th>By</th><th>What was done</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No readings in the last 30 days.</p>',
      css: `.pp .log { width: 100%; border-collapse: collapse; font-size: 12px; } .pp .log th, .pp .log td { text-align: left; padding: 6px 8px; border-bottom: 1px solid ${PRINT.line}; vertical-align: top; } .pp .log th { color: ${PRINT.muted}; font-weight: 500; }` }));
  };
  const m = d.dish.machine;

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK }}>
      <header className="bg-[#fff] px-4 sm:px-6 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight">Dish</h1>
            <p className="text-[13.5px]" style={{ color: MUTED }}>{working ? `${first(working)} is working.` : d.business.name}{d.dish.rush ? ` The rush: ${d.dish.rush}.` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.mode === 'key' && <button type="button" onClick={() => (s.staff ? s.setStaff(null) : setPinOpen(true))} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>{s.staff ? `Not ${first(s.staff.name)}?` : 'Who’s working?'}</button>}
            <button type="button" onClick={() => setBreakOpen(true)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Broke something</button>
            <button type="button" onClick={() => setClosingOpen(true)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Closing</button>
          </div>
        </div>
        {(!s.soundOk || (s.lastOk && Date.now() - s.lastOk > 30000)) && <p className="mt-2 text-[13px]" style={{ color: AMBER }} role="status">{s.lastOk && Date.now() - s.lastOk > 30000 ? `No connection since ${clockOf(new Date(s.lastOk).toISOString())}. It keeps trying.` : 'Tap anywhere to turn the sound on.'}</p>}
        {notice && <p role="alert" className="mt-2 rounded-xl px-3 py-2 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{notice}</p>}
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <section aria-labelledby="asked-title" className="space-y-2">
          <h2 id="asked-title" className="text-[17px] font-semibold">Asked for</h2>
          <CallList calls={d.calls} me={{ id: d.me, name: working || null }} busy={!!busy} onStep={(c, st) => void step(c, st)} empty="Nothing asked for. What the line and the bar call for shows here, with a chime." />
          {d.mine.length > 0 && <div className="pt-2"><p className="mb-1.5 text-[13.5px] font-semibold" style={{ color: MUTED }}>You asked</p><CallStrip calls={d.mine} post={(b) => s.act(b)} now={now} onChanged={() => void s.load(true)} /></div>}
        </section>

        <div className="space-y-4">
          <section aria-labelledby="way-title" className="rounded-2xl bg-[#fff] p-4 space-y-3 border" style={{ borderColor: LINE }}>
            <div><h2 id="way-title" className="text-[17px] font-semibold">Heading your way</h2><p className="text-[13.5px]" style={{ color: MUTED }}>Plates and glasses that went out, every 15 minutes. They come back within the hour.</p></div>
            <Flow flow={d.dish.flow} />
            {d.dish.clearing.length > 0 && <div className="pt-1"><h3 className="text-[15px] font-semibold">Being cleared now</h3>
              <ul className="mt-1 space-y-1">{d.dish.clearing.map((c, i) => <li key={i} className="flex justify-between gap-3 text-[14.5px]"><span>{c.table}, {c.size} {c.size === 1 ? 'guest' : 'guests'}</span><span style={{ color: MUTED }}>{c.minutes < 1 ? 'just left' : `left ${c.minutes} min ago`}</span></li>)}</ul></div>}
          </section>
          <MachineCard m={m} busy={busy === 'machine'} onSave={saveCheck} onLog={() => void printLog()} />
          {d.dish.broken.length > 0 && <p className="text-[14px]" style={{ color: MUTED }}>Broken today: {brokenWords(d.dish.broken)}.</p>}
        </div>
      </main>

      {pinOpen && <PinSheet onClose={() => setPinOpen(false)} onPin={async (pin) => { const e = await s.signIn(pin); if (!e) setPinOpen(false); return e; }} />}
      {breakOpen && <BreakSheet onClose={() => setBreakOpen(false)} onSave={saveBreak} />}
      {closingOpen && <ClosingSheet who="the dish pit" post={(body) => s.post('/api/back', { ...body, area: 'dish' })} onClose={() => setClosingOpen(false)} />}
    </div>
  );
}
