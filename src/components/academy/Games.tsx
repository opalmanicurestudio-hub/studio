'use client';
// src/components/academy/Games.tsx
//
// GAMES — drawn by ClarityFlow itself, so they always work. Tap-based (more
// reliable than dragging on phones), with points, streaks and motion.
//   Sort it       an item appears → tap the bin it belongs in
//   Speed round   true or false against a countdown; 🔥 streaks; the "why" after each
//   Memory match  flip two cards; pairs stay up; fewer moves = better score
//   Sequence      tap the steps in the right order
// Each ends with a score, Play again, and reports the score (the gradebook
// keeps the best).
// GameEditor (owners): pick a template; ✨ make it from the lesson or type one
// item per line; or switch to a free-form game built by Claude.

import { useEffect, useMemo, useRef, useState } from 'react';

const GAME_CSS = `@keyframes g-bounce{0%{transform:scale(1)}40%{transform:scale(1.08)}100%{transform:scale(1)}}.g-bounce{animation:g-bounce .35s ease-out}
@keyframes g-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}.g-shake{animation:g-shake .3s ease-in-out 2}
@keyframes g-in{0%{opacity:0;transform:translateY(14px) scale(.97)}100%{opacity:1;transform:none}}.g-in{animation:g-in .35s cubic-bezier(.34,1.56,.64,1)}
.g-flip{transition:transform .35s;transform-style:preserve-3d}.g-flip.up{transform:rotateY(180deg)}.g-face{backface-visibility:hidden;-webkit-backface-visibility:hidden}.g-back{transform:rotateY(180deg)}
@media (prefers-reduced-motion: reduce){.g-bounce,.g-shake,.g-in{animation:none}.g-flip{transition:none}}`;
const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
export const GAME_TEMPLATES: [string, string, string, string][] = [['sort', '🗂', 'Sort it', 'Tap the right bin'], ['speed', '⚡', 'Speed round', 'True or false, fast'], ['memory', '🃏', 'Memory match', 'Flip and find pairs'], ['sequence', '🔢', 'Sequence', 'Tap the steps in order']];

function Finish({ pct, color, onAgain, label }: { pct: number; color: string; onAgain: () => void; label: string }) {
  return (
    <div className="g-in space-y-3 py-4 text-center">
      <p className="text-5xl">{pct >= 90 ? '🏆' : pct >= 70 ? '🎉' : '💪'}</p>
      <p className="text-3xl font-semibold">{pct}%</p><p className="text-stone-600">{label}</p>
      <p className="text-[13px] text-stone-500">{pct >= 70 ? 'Nice work — saved to your progress.' : 'Saved — have another go to beat it.'}</p>
      <button type="button" onClick={onAgain} className="h-12 rounded-full px-6 text-sm font-medium text-white" style={{ background: color }}>Play again</button>
    </div>
  );
}

function SortGame({ d, color, report }: any) {
  const [order, setOrder] = useState<number[]>(() => shuffle<number>(d.items.map((_: any, i: number) => i)));
  const [k, setK] = useState(0); const [right, setRight] = useState(0); const [fx, setFx] = useState<{ bin: number; ok: boolean } | null>(null); const [streak, setStreak] = useState(0);
  const done = k >= order.length; const it = d.items[order[k]];
  const pick = (bin: number) => { if (fx || done) return; const ok = bin === it.bin; setFx({ bin, ok }); if (ok) { setRight((n) => n + 1); setStreak((n) => n + 1); } else setStreak(0);
    setTimeout(() => { setFx(null); setK((n) => { const nx = n + 1; if (nx >= order.length) report?.(Math.round(((right + (ok ? 1 : 0)) / order.length) * 100)); return nx; }); }, ok ? 450 : 1100); };
  if (done) return <Finish pct={Math.round((right / order.length) * 100)} color={color} label={`${right} of ${order.length} sorted right`} onAgain={() => { setOrder(shuffle(order)); setK(0); setRight(0); setStreak(0); }} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-between text-[13px] text-stone-500"><span>{k + 1} / {order.length}</span>{streak > 1 && <span className="font-semibold text-orange-600">🔥 {streak} in a row</span>}</div>
      <div key={k} className="g-in rounded-3xl bg-white p-6 text-center text-xl font-semibold shadow-sm">{it.text}</div>
      <div className={`grid gap-2 ${d.bins.length > 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>{d.bins.map((b: string, i: number) => { const hit = fx?.bin === i; const show = fx && !fx.ok && i === it.bin; return (
        <button key={i} type="button" onClick={() => pick(i)} className={`min-h-20 rounded-2xl px-3 text-[15px] font-semibold transition ${hit && fx!.ok ? 'g-bounce bg-emerald-500 text-white' : hit ? 'g-shake bg-red-500 text-white' : show ? 'bg-emerald-100 text-emerald-900 ring-2 ring-emerald-500' : 'bg-white/85'}`}>{b}</button>
      ); })}</div>
    </div>
  );
}

function SpeedGame({ d, color, report }: any) {
  const [order, setOrder] = useState<number[]>(() => shuffle<number>(d.items.map((_: any, i: number) => i)));
  const [k, setK] = useState(0); const [right, setRight] = useState(0); const [streak, setStreak] = useState(0); const [ans, setAns] = useState<null | { ok: boolean; timeUp?: boolean }>(null); const [left, setLeft] = useState(d.seconds);
  const done = k >= order.length; const it = d.items[order[k]];
  const answer = (v: boolean | null) => { if (ans || done) return; const ok = v !== null && v === it.true; setAns({ ok, timeUp: v === null }); if (ok) { setRight((n) => n + 1); setStreak((n) => n + 1); } else setStreak(0); };
  useEffect(() => { if (done || ans) return; setLeft(d.seconds); const t0 = Date.now(); const iv = setInterval(() => { const l = d.seconds - (Date.now() - t0) / 1000; setLeft(Math.max(0, l)); if (l <= 0) { clearInterval(iv); answer(null); } }, 100); return () => clearInterval(iv); }, [k, ans === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { setAns(null); setK((n) => { const nx = n + 1; if (nx >= order.length) report?.(Math.round((right / order.length) * 100)); return nx; }); };
  if (done) return <Finish pct={Math.round((right / order.length) * 100)} color={color} label={`${right} of ${order.length} right`} onAgain={() => { setOrder(shuffle(order)); setK(0); setRight(0); setStreak(0); setAns(null); }} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-between text-[13px] text-stone-500"><span>{k + 1} / {order.length}</span>{streak > 1 && <span className="font-semibold text-orange-600">🔥 {streak} in a row</span>}</div>
      <div className="h-2 overflow-hidden rounded-full bg-white/80"><div className="h-2 rounded-full transition-[width] duration-100" style={{ width: `${(left / d.seconds) * 100}%`, background: left < 3 ? '#ef4444' : color }} /></div>
      <div key={k} className={`g-in rounded-3xl p-6 text-center text-lg font-semibold shadow-sm ${ans ? (ans.ok ? 'g-bounce bg-emerald-50' : 'g-shake bg-red-50') : 'bg-white'}`}>{it.text}</div>
      {!ans ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => answer(true)} className="h-16 rounded-2xl bg-emerald-500 text-lg font-semibold text-white active:scale-95">True</button><button type="button" onClick={() => answer(false)} className="h-16 rounded-2xl bg-rose-500 text-lg font-semibold text-white active:scale-95">False</button></div>
        : <div className="space-y-2 text-center"><p className={`font-semibold ${ans.ok ? 'text-emerald-700' : 'text-red-700'}`}>{ans.ok ? '✓ Right!' : ans.timeUp ? '⏰ Time’s up' : '✗ Not quite'} — it’s {it.true ? 'true' : 'false'}.</p>{it.why && <p className="text-[14px] text-stone-600">{it.why}</p>}<button type="button" onClick={next} className="h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>Next</button></div>}
    </div>
  );
}

function MemoryGame({ d, color, report }: any) {
  const deal = (): any[] => shuffle<any>(d.pairs.flatMap((p: any, i: number) => [{ id: `${i}a`, pair: i, text: p.a }, { id: `${i}b`, pair: i, text: p.b }]));
  const [cards, setCards] = useState<any[]>(deal); const [up, setUp] = useState<string[]>([]); const [got, setGot] = useState<number[]>([]); const [moves, setMoves] = useState(0); const [bump, setBump] = useState<number | null>(null);
  const done = got.length === d.pairs.length;
  const pct = Math.max(40, Math.min(100, 100 - (moves - d.pairs.length) * 6));
  const reported = useRef(false);
  useEffect(() => { if (done && !reported.current) { reported.current = true; report?.(pct); } }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = (c: any) => {
    if (up.length === 2 || up.includes(c.id) || got.includes(c.pair)) return;
    const nu = [...up, c.id]; setUp(nu);
    if (nu.length === 2) { setMoves((m) => m + 1); const [a, b] = nu.map((id) => cards.find((x: any) => x.id === id)); setTimeout(() => { if (a.pair === b.pair) { setGot((g) => [...g, a.pair]); setBump(a.pair); } setUp([]); }, a.pair === b.pair ? 350 : 900); }
  };
  if (done) return <Finish pct={pct} color={color} label={`All ${d.pairs.length} pairs in ${moves} moves`} onAgain={() => { setCards(deal()); setUp([]); setGot([]); setMoves(0); reported.current = false; }} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-[13px] text-stone-500"><span>{got.length} / {d.pairs.length} pairs</span><span>{moves} moves</span></div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{cards.map((c) => { const open = up.includes(c.id) || got.includes(c.pair); return (
        <button key={c.id} type="button" onClick={() => flip(c)} aria-label={open ? c.text : 'Hidden card'} className="relative aspect-[3/4] [perspective:600px]">
          <span className={`g-flip absolute inset-0 ${open ? 'up' : ''}`}>
            <span className="g-face absolute inset-0 flex items-center justify-center rounded-2xl text-2xl text-white shadow-sm" style={{ background: color }}>?</span>
            <span className={`g-face g-back absolute inset-0 flex items-center justify-center rounded-2xl p-2 text-center text-[13px] font-semibold leading-tight shadow-sm ${got.includes(c.pair) ? `bg-emerald-50 text-emerald-900 ${bump === c.pair ? 'g-bounce' : ''}` : 'bg-white'}`}>{c.text}</span>
          </span>
        </button>
      ); })}</div>
    </div>
  );
}

function SequenceGame({ d, color, report }: any) {
  const [pool, setPool] = useState<number[]>(() => shuffle<number>(d.steps.map((_: any, i: number) => i)));
  const [placed, setPlaced] = useState<number[]>([]); const [miss, setMiss] = useState(0); const [bad, setBad] = useState<number | null>(null);
  const done = placed.length === d.steps.length; const pct = Math.max(0, 100 - miss * 10);
  const tap = (i: number) => { if (i === placed.length) { const np = [...placed, i]; setPlaced(np); if (np.length === d.steps.length) report?.(Math.max(0, 100 - miss * 10)); } else { setMiss((m) => m + 1); setBad(i); setTimeout(() => setBad(null), 600); } };
  if (done) return <Finish pct={pct} color={color} label={miss ? `In order, with ${miss} slip${miss === 1 ? '' : 's'}` : 'Perfect order!'} onAgain={() => { setPool(shuffle(pool)); setPlaced([]); setMiss(0); }} />;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-stone-500">Tap the steps in the right order.</p>
      <ol className="space-y-1.5">{d.steps.map((_: any, i: number) => <li key={i} className={`flex min-h-11 items-center gap-2 rounded-2xl px-3 text-[14px] ${i < placed.length ? 'g-in bg-emerald-50 text-emerald-900' : 'border-2 border-dashed border-stone-200 text-stone-300'}`}><b>{i + 1}.</b> {i < placed.length ? d.steps[i] : '…'}</li>)}</ol>
      <div className="grid gap-2">{pool.filter((i: number) => !placed.includes(i)).map((i: number) => <button key={i} type="button" onClick={() => tap(i)} className={`min-h-12 rounded-2xl bg-white px-4 text-left text-[15px] shadow-sm active:scale-[0.98] ${bad === i ? 'g-shake bg-red-50' : ''}`}>{d.steps[i]}</button>)}</div>
    </div>
  );
}

/** A game block for students. */
export function GameBlock({ b, color, report }: { b: any; color: string; report?: (pct: number) => void }) {
  const G = b.template === 'speed' ? SpeedGame : b.template === 'memory' ? MemoryGame : b.template === 'sequence' ? SequenceGame : SortGame;
  const t = GAME_TEMPLATES.find(([k]) => k === b.template);
  return (
    <div className="glass space-y-3 rounded-[1.5rem] border border-white/70 p-4 sm:p-5">
      <style>{GAME_CSS}</style>
      <div className="flex items-center gap-2"><span className="text-2xl">{t?.[1]}</span><div><p className="text-lg font-semibold leading-tight">{b.title || t?.[2]}</p><p className="text-[12px] text-stone-500">{t?.[3]}</p></div></div>
      <G d={b.data} color={color} report={report} />
    </div>
  );
}

// ── Owner: the game editor ────────────────────────────────────────────────
const toText = (t: string, d: any) => !d ? '' : t === 'sort' ? (d.items || []).map((x: any) => `${x.text} > ${d.bins?.[x.bin] || ''}`).join('\n') : t === 'speed' ? (d.items || []).map((x: any) => `${x.text} | ${x.true ? 'true' : 'false'}${x.why ? ` | ${x.why}` : ''}`).join('\n') : t === 'memory' ? (d.pairs || []).map((x: any) => `${x.a} = ${x.b}`).join('\n') : (d.steps || []).join('\n');
function fromText(t: string, text: string, binsText: string) {
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
  if (t === 'sort') { const bins = binsText.split(',').map((x) => x.trim()).filter(Boolean); return { bins, items: lines.map((l) => { const [a, b] = l.split('>').map((x) => x.trim()); const bi = bins.findIndex((x) => x.toLowerCase() === String(b || '').toLowerCase()); return { text: a, bin: bi < 0 ? 0 : bi }; }) }; }
  if (t === 'speed') return { seconds: 8, items: lines.map((l) => { const [a, b, c] = l.split('|').map((x) => x.trim()); return { text: a, true: /^t/i.test(b || ''), why: c || '' }; }) };
  if (t === 'memory') return { pairs: lines.map((l) => { const [a, b] = l.split('=').map((x) => x.trim()); return { a, b: b || '' }; }) };
  return { steps: lines };
}
const HOW: Record<string, string> = { sort: 'One item per line: Item > Bin   (e.g. Metal pusher > Disinfect)', speed: 'One per line: Statement | true or false | why (optional)', memory: 'One pair per line: Term = meaning', sequence: 'One step per line, in the right order' };
const MIN: Record<string, number> = { sort: 3, speed: 3, memory: 3, sequence: 3 };

export function GameEditor({ b, onChange, onAi, onFreeForm }: { b: any; onChange: (patch: any) => void; onAi: () => Promise<string | null>; onFreeForm: () => void }) {
  const [text, setText] = useState<string>(() => String(toText(b.template, b.data)));
  const [bins, setBins] = useState<string>(() => (b.data?.bins || ['Clean', 'Disinfect', 'Throw away']).join(', '));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { setText(toText(b.template, b.data)); if (b.data?.bins) setBins(b.data.bins.join(', ')); }, [b.template, b.aiStamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = useMemo(() => text.split('\n').filter((x) => x.trim()).length, [text]);
  const set = (t: string, bs: string) => { setText(t); setBins(bs); onChange({ data: fromText(b.template, t, bs) }); };
  const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{GAME_TEMPLATES.map(([k, i, n, h]) => <button key={k} type="button" onClick={() => onChange({ template: k, data: null, aiStamp: Date.now() })} className={`rounded-xl p-2 text-left ${b.template === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}><span className="text-lg">{i}</span><span className="block text-[12px] font-black">{n}</span><span className="block text-[10px] opacity-70">{h}</span></button>)}</div>
      <input className={field} value={b.title || ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Game title students see (optional)" />
      <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(''); const e = await onAi(); setBusy(false); if (e) setErr(e); }} className="h-9 rounded-full bg-violet-100 px-3 text-[12px] font-bold text-violet-900 disabled:opacity-50">{busy ? 'Making it…' : '✨ Make it from this lesson'}</button>
        <button type="button" onClick={onFreeForm} className="h-9 rounded-full border-2 px-3 text-[12px] font-bold">Or a free-form game built by Claude…</button></div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {b.template === 'sort' && <label className="block text-[12px] font-bold">Bins (comma-separated)<input className={field} value={bins} onChange={(e) => set(text, e.target.value)} /></label>}
      <label className="block text-[12px] font-bold">{HOW[b.template]}<textarea rows={6} className="mt-1 w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm" value={text} onChange={(e) => set(e.target.value, bins)} /></label>
      {count < MIN[b.template] && <p className="text-[12px] text-amber-800">Add at least {MIN[b.template]} lines (or use ✨) — the game isn’t saved until it has enough.</p>}
    </div>
  );
}
