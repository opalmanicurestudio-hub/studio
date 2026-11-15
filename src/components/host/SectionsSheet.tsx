'use client';
// src/components/host/SectionsSheet.tsx — TONIGHT'S SECTIONS, ON THE HOST STAND (design canvas "Tonight's sections";
// lib/sections, api/host/floor 'sections', 'section_tap', 'call_out'). Pick someone, then tap their tables: each table
// is one person's tonight (tapping one of theirs gives it back to nobody). "Someone called out" moves everything they
// had in one step, to one person or shared out. Tonight only: the floor plan's usual sections stay as they are, unless a
// manager keeps tonight's as the usual ones ('usual'). Whoever is given a table that's seated now hears about it.
import * as React from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
type Unit = { id: string; name: string; staffIds: string[]; seated: boolean; x: number | null; y: number | null };
type Person = { id: string; name: string; on: boolean };
type Data = { units: Unit[]; people: Person[]; canEdit: boolean; canUsual: boolean };
const first = (n: string) => String(n || '').split(' ')[0] || 'Someone';

export function SectionsSheet({ api, onClose, onChanged }: { api: (path: string, body: any) => Promise<any>; onClose: () => void; onChanged?: () => void }) {
  const [d, setD] = React.useState<Data | null>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [pick, setPick] = React.useState<string | null>(null);
  // Keeping a table with nobody on it as the usual empties its usual server: asked first.
  const [sure, setSure] = React.useState(false);
  const [out, setOut] = React.useState<string | null>(null); const [to, setTo] = React.useState<string>('share'); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(async () => { const r = await api('/api/host/floor', { action: 'sections' }); if (r.ok) { setD({ units: r.units || [], people: r.people || [], canEdit: r.canEdit !== false, canUsual: !!r.canUsual }); setErr(''); } else setErr(r.error || 'Tonight’s sections couldn’t be read.'); }, [api]);
  React.useEffect(() => { void load(); }, [load]);
  // Focus goes to the sheet and comes back to what was tapped; the page behind doesn't scroll; Tab stays inside.
  const sheet = React.useRef<HTMLDivElement>(null); const title = React.useRef<HTMLHeadingElement>(null);
  const closeRef = React.useRef(onClose); closeRef.current = onClose;
  React.useEffect(() => {
    const back = document.activeElement as HTMLElement | null; title.current?.focus();
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !sheet.current) return;
      const f = Array.from(sheet.current.querySelectorAll<HTMLElement>('button')).filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === title.current)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = was; try { back?.focus?.(); } catch { /* */ } };
  }, []);
  const name = (id: string) => first(d?.people.find((p) => p.id === id)?.name || '');
  const count = (id: string) => (d?.units || []).filter((u) => u.staffIds.includes(id));
  const nobody = (d?.units || []).filter((u) => !u.staffIds.length);

  const tap = async (u: Unit) => {
    if (!pick || busy) return; setBusy(true); setMsg(''); setErr(''); setSure(false);
    const r = await api('/api/host/floor', { action: 'section_tap', unitId: u.id, staffId: pick });
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t save.'); return; }
    setD((x) => (x ? { ...x, units: x.units.map((y) => (y.id === u.id ? { ...y, staffIds: r.staffIds || [] } : y)) } : x)); onChanged?.();
  };
  const move = async () => {
    if (!out || busy) return; setBusy(true); setMsg(''); setErr(''); setSure(false);
    const r = await api('/api/host/floor', { action: 'call_out', staffId: out, to });
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t go through.'); return; }
    setOut(null); setMsg(r.words ? `Moved: ${r.words}.` : 'Nothing to move.'); await load(); onChanged?.();
  };
  const keep = async () => {
    if (busy) return;
    if (!sure && nobody.length) { setSure(true); return; }
    setSure(false); setBusy(true); setMsg(''); setErr('');
    const r = await api('/api/host/floor', { action: 'usual' });
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t save.'); return; }
    setMsg(`Kept as the usual sections. Each night opens with them from now on.${r.nobody ? ` ${r.nobody === 1 ? 'One table has' : `${r.nobody} tables have`} nobody, as tonight.` : ''}`);
  };

  // The tables as the floor plan places them, or in a grid when it doesn't say, or there isn't room (a phone).
  const box = React.useRef<HTMLDivElement>(null); const [bw, setBw] = React.useState(0);
  React.useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setBw(el.clientWidth)); ro.observe(el); setBw(el.clientWidth); return () => ro.disconnect(); }, []);
  const xs = (d?.units || []).map((u) => Number(u.x) || 0), ys = (d?.units || []).map((u) => Number(u.y) || 0);
  const cols = new Set(xs).size, rows = new Set(ys).size;
  const placed = (d?.units || []).every((u) => typeof u.x === 'number' && typeof u.y === 'number') && bw >= cols * 100 + 56;
  const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0), w = Math.max(1, Math.max(...xs, 1) - minX), h = Math.max(1, Math.max(...ys, 1) - minY);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-labelledby="sections-title">
      <div ref={sheet} className="flex max-h-[94dvh] w-full max-w-3xl flex-col rounded-t-3xl bg-[#fff] sm:rounded-3xl" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div><h2 id="sections-title" ref={title} tabIndex={-1} className="text-[20px] font-semibold leading-tight outline-none">Tonight’s sections</h2>
            <p className="text-[14px]" style={{ color: MUTED }}>{d && !d.canEdit ? 'Who has which tables tonight. The host stand or a manager changes them.' : 'Pick someone, then tap their tables. Only for tonight: the floor plan’s usual sections stay as they are.'}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]" style={{ background: SOFT }}>×</button>
        </div>
        <div ref={box} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
          {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
          {!d ? <p className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Reading tonight’s floor…</p> : !d.units.length ? <p className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Tonight’s floor isn’t open yet.</p> : <>
            <div role="radiogroup" aria-label="Whose tables" className="flex flex-wrap gap-1.5">
              {d.people.map((p) => { const on = pick === p.id; const n = count(p.id).length;
                return <button key={p.id} type="button" role="radio" aria-checked={on} disabled={!d.canEdit} onClick={() => setPick(on ? null : p.id)} className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-[14px] font-semibold"
                  style={on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{first(p.name)}<span className="font-normal" style={{ opacity: on ? 0.8 : 1, color: on ? '#fff' : MUTED }}>{n} {n === 1 ? 'table' : 'tables'}{p.on ? '' : ', not on tonight'}</span></button>; })}
              {nobody.length > 0 && <span className="flex min-h-[44px] items-center rounded-xl px-3 text-[14px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Nobody {nobody.length}</span>}
            </div>
            <div className={placed ? 'relative rounded-2xl' : 'grid grid-cols-3 gap-2 rounded-2xl p-3 sm:grid-cols-5'} style={{ background: SOFT, ...(placed ? { height: Math.min(520, Math.max(220, rows * 92)) } : {}) }}>
              {d.units.map((u) => { const mine = !!pick && u.staffIds.includes(pick); const who = u.staffIds.map(name).join(', ');
                const style: React.CSSProperties = placed ? { position: 'absolute', left: `calc(${((Number(u.x) - minX) / w).toFixed(4)} * (100% - 108px) + 8px)`, top: `calc(${((Number(u.y) - minY) / h).toFixed(4)} * (100% - 76px) + 8px)`, width: 92 } : {};
                return <button key={u.id} type="button" disabled={!pick} aria-busy={busy || undefined} onClick={() => tap(u)} aria-label={`${u.name}: ${who || 'nobody'}${pick ? `. Tap to ${mine ? 'give it back to nobody' : `give it to ${name(pick)}`}` : ''}`}
                  className="flex min-h-[60px] flex-col items-center justify-center rounded-xl bg-[#fff] px-2 text-[14px] font-semibold disabled:cursor-default"
                  style={{ ...style, border: mine ? `2px solid ${INK}` : u.staffIds.length ? `1px solid ${LINE}` : `1px dashed #c9cbd0` }}>
                  <span>{u.name}</span>
                  <span className="mt-0.5 rounded-full px-2 text-[12px] font-semibold" style={mine ? { background: INK, color: '#fff' } : u.staffIds.length ? { background: SOFT, color: INK } : { color: AMBER }}>{who || 'Nobody'}</span>
                  {u.seated && <span className="text-[11px] font-normal" style={{ color: MUTED }}>Seated</span>}
                </button>; })}
            </div>
            {pick && <p className="text-[13.5px]" style={{ color: MUTED }}>{name(pick)}: {count(pick).map((u) => u.name).join(', ') || 'no tables yet'}.{nobody.length ? ` ${nobody.length === 1 ? 'One table has' : `${nobody.length} tables have`} nobody yet.` : ''}</p>}
            {msg && <p role="status" className="text-[14px] font-semibold">{msg}</p>}
            {d.canEdit && <div className="space-y-2 rounded-2xl p-3" style={{ border: `1px solid ${LINE}` }}>
              <p className="text-[15px] font-semibold">Someone called out</p>
              <div role="radiogroup" aria-label="Who called out" className="flex flex-wrap gap-1.5">
                {d.people.filter((p) => count(p.id).length).map((p) => <button key={p.id} type="button" role="radio" aria-checked={out === p.id} onClick={() => { setOut(out === p.id ? null : p.id); setTo('share'); }}
                  className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold" style={out === p.id ? { background: INK, color: '#fff' } : { background: SOFT }}>{first(p.name)}</button>)}
              </div>
              {out && <>
                <div role="radiogroup" aria-label="Where their tables go" className="grid gap-1.5">
                  {[{ v: 'share', l: 'Share them out', s: 'A table at a time, to whoever’s on tonight with the fewest' }, ...d.people.filter((p) => p.id !== out).map((p) => ({ v: p.id, l: `All to ${first(p.name)}`, s: `${count(p.id).length + count(out).length} tables${p.on ? '' : ', not on tonight'}` }))].map((o) => (
                    <button key={o.v} type="button" role="radio" aria-checked={to === o.v} onClick={() => setTo(o.v)} className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl px-3 text-left text-[14px]"
                      style={{ border: to === o.v ? `2px solid ${INK}` : `1px solid ${LINE}` }}><span className="font-semibold">{o.l}</span><span style={{ color: MUTED }}>{o.s}</span></button>))}
                </div>
                <button type="button" disabled={busy} onClick={move} className="min-h-[48px] w-full rounded-xl text-[15px] font-semibold disabled:opacity-50" style={{ background: INK, color: '#fff' }}>Move {name(out)}’s section</button>
              </>}
            </div>}
            {d.canUsual && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3" style={{ border: `1px solid ${LINE}` }}>
              <p className="min-w-0 flex-1 text-[14px]"><span className="block font-semibold">Keep these as the usual sections</span><span style={{ color: MUTED }}>Each night opens with them. Tonight’s changes still only change tonight.</span></p>
              <button type="button" disabled={busy} onClick={keep} className="min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-50" style={sure ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{sure ? `Keep, with ${nobody.length === 1 ? 'one table' : `${nobody.length} tables`} for nobody` : 'Keep as usual'}</button>
            </div>}
          </>}
        </div>
        <div className="p-5 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
          <button type="button" onClick={onClose} className="min-h-[48px] w-full rounded-xl text-[15px] font-semibold" style={{ background: INK, color: '#fff' }}>Done</button>
        </div>
      </div>
    </div>
  );
}
