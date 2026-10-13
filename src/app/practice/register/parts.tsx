'use client';
// Drawn pieces for the register view: clients, products with real UPC-A barcodes,
// the scanner, the card reader and the client screen. Original shapes, app colors.
import type { CSSProperties, ReactNode } from 'react';
import * as R from '@/lib/practice/register';
import * as $ from '@/lib/practice/currency';

export const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#2563eb';

/** A real, scannable UPC-A barcode. `smudge` blurs the bars (a wet label) but keeps the numbers readable. */
export function Barcode({ code, h = 46, unit = 1.6, smudge = false, digits = true }: { code: string; h?: number; unit?: number; smudge?: boolean; digits?: boolean }) {
  const m = R.upcModules(code); const quiet = 9 * unit; const w = m.length * unit + quiet * 2;
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;
  return (
    <div style={{ background: '#fff', padding: '4px 2px 2px', borderRadius: 3, display: 'inline-block', lineHeight: 0 }}>
      <svg width={w} height={h + (digits ? 4 : 0)} viewBox={`0 0 ${w} ${h + (digits ? 4 : 0)}`} style={{ filter: smudge ? 'blur(1.4px)' : undefined, display: 'block' }} aria-label={`Barcode ${code}`}>
        {m.map((b, i) => (b ? <rect key={i} x={quiet + i * unit} y={0} width={unit} height={guard(i) ? h + 4 : h} fill={INK} /> : null))}
        {smudge && <ellipse cx={w * 0.55} cy={h * 0.45} rx={w * 0.22} ry={h * 0.35} fill="#c9d4e6" opacity={0.55} />}
      </svg>
      {digits && <div style={{ font: `600 ${Math.max(8, unit * 6)}px ui-monospace, Menlo, monospace`, letterSpacing: '.14em', textAlign: 'center', lineHeight: 1.4, color: INK }}>{code[0]} {code.slice(1, 6)} {code.slice(6, 11)} {code[11]}</div>}
    </div>
  );
}

/** A product bottle with its label. */
export function Bottle({ sku, w = 64, h = 120, smudge, onClick, selected, dim, style }: { sku: R.Sku; w?: number; h?: number; smudge?: boolean; onClick?: () => void; selected?: boolean; dim?: boolean; style?: CSSProperties }) {
  return (
    <button onClick={onClick} aria-label={R.skuLabel(sku)} style={{ position: 'relative', width: w, height: h, border: 'none', background: 'none', padding: 0, cursor: onClick ? 'pointer' : 'default', opacity: dim ? 0.35 : 1, transition: 'transform .2s, opacity .2s', transform: selected ? 'translateY(-8px)' : undefined, flexShrink: 0, ...style }}>
      <span style={{ position: 'absolute', left: w * 0.32, top: 0, width: w * 0.36, height: h * 0.15, background: '#2a2b30', borderRadius: '4px 4px 2px 2px' }} />
      <span style={{ position: 'absolute', left: 0, top: h * 0.13, width: w, height: h * 0.87, background: `linear-gradient(90deg, ${sku.color} 0%, #ffffffb0 32%, ${sku.color} 58%, ${sku.color} 100%)`, borderRadius: `${w * 0.22}px ${w * 0.22}px 10px 10px`, boxShadow: selected ? `0 0 0 3px ${BLUE}, 0 14px 22px -12px rgba(0,0,0,.5)` : '0 14px 22px -12px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: h * 0.12, boxSizing: 'border-box' }}>
        <span style={{ fontSize: Math.max(8.5, w * 0.14), fontWeight: 700, color: '#16171acc', textAlign: 'center', lineHeight: 1.1, padding: '0 4px' }}>{sku.name}</span>
        {sku.size && <span style={{ fontSize: Math.max(7.5, w * 0.12), color: '#16171a99', fontWeight: 600 }}>{sku.size}</span>}
        <span style={{ position: 'absolute', bottom: 8, transform: `scale(${w / 150})`, transformOrigin: 'bottom center' }}><Barcode code={sku.code} h={30} unit={1.1} smudge={smudge} /></span>
      </span>
    </button>
  );
}

/** A client, drawn from simple shapes. */
export function Person({ look, size = 220, mood = 0.8 }: { look: R.Look; size?: number; mood?: number }) {
  const s = size, { skin, hair, top, style } = look;
  const hairEl = {
    bun: <><circle cx={s * 0.5} cy={s * 0.13} r={s * 0.09} fill={hair} /><path d={`M${s * 0.3} ${s * 0.34} Q${s * 0.3} ${s * 0.16} ${s * 0.5} ${s * 0.16} Q${s * 0.7} ${s * 0.16} ${s * 0.7} ${s * 0.34} Q${s * 0.62} ${s * 0.24} ${s * 0.5} ${s * 0.24} Q${s * 0.38} ${s * 0.24} ${s * 0.3} ${s * 0.34}z`} fill={hair} /></>,
    curls: <>{Array.from({ length: 8 }, (_, i) => <circle key={i} cx={s * (0.3 + (0.4 * i) / 7)} cy={s * (0.2 + 0.04 * ((i * 3) % 2))} r={s * 0.07} fill={hair} />)}<circle cx={s * 0.29} cy={s * 0.3} r={s * 0.06} fill={hair} /><circle cx={s * 0.71} cy={s * 0.3} r={s * 0.06} fill={hair} /></>,
    short: <path d={`M${s * 0.31} ${s * 0.32} Q${s * 0.3} ${s * 0.15} ${s * 0.5} ${s * 0.15} Q${s * 0.7} ${s * 0.15} ${s * 0.69} ${s * 0.32} Q${s * 0.6} ${s * 0.22} ${s * 0.5} ${s * 0.23} Q${s * 0.4} ${s * 0.22} ${s * 0.31} ${s * 0.32}z`} fill={hair} />,
    fade: <path d={`M${s * 0.32} ${s * 0.3} Q${s * 0.33} ${s * 0.15} ${s * 0.5} ${s * 0.15} Q${s * 0.67} ${s * 0.15} ${s * 0.68} ${s * 0.3} Q${s * 0.6} ${s * 0.2} ${s * 0.5} ${s * 0.2} Q${s * 0.4} ${s * 0.2} ${s * 0.32} ${s * 0.3}z`} fill={hair} opacity={0.9} />,
    long: <path d={`M${s * 0.29} ${s * 0.6} Q${s * 0.24} ${s * 0.15} ${s * 0.5} ${s * 0.15} Q${s * 0.76} ${s * 0.15} ${s * 0.71} ${s * 0.6} L${s * 0.64} ${s * 0.6} Q${s * 0.66} ${s * 0.3} ${s * 0.5} ${s * 0.25} Q${s * 0.34} ${s * 0.3} ${s * 0.36} ${s * 0.6}z`} fill={hair} />,
    braids: <><path d={`M${s * 0.3} ${s * 0.33} Q${s * 0.29} ${s * 0.15} ${s * 0.5} ${s * 0.15} Q${s * 0.71} ${s * 0.15} ${s * 0.7} ${s * 0.33} Q${s * 0.6} ${s * 0.23} ${s * 0.5} ${s * 0.23} Q${s * 0.4} ${s * 0.23} ${s * 0.3} ${s * 0.33}z`} fill={hair} />{[0.29, 0.33, 0.67, 0.71].map((x, i) => <rect key={i} x={s * x - s * 0.018} y={s * 0.3} width={s * 0.036} height={s * 0.36} rx={s * 0.018} fill={hair} />)}</>,
  }[style];
  const happy = mood > 0.6, upset = mood < 0.3;
  const mouth = upset ? `M${s * 0.45} ${s * 0.45} Q${s * 0.5} ${s * 0.42} ${s * 0.55} ${s * 0.45}` : happy ? `M${s * 0.44} ${s * 0.42} Q${s * 0.5} ${s * 0.48} ${s * 0.56} ${s * 0.42}` : `M${s * 0.45} ${s * 0.43} Q${s * 0.5} ${s * 0.455} ${s * 0.55} ${s * 0.43}`;
  return (
    <svg width={s} height={s * 0.9} viewBox={`0 0 ${s} ${s * 0.9}`} aria-hidden>
      <path d={`M${s * 0.12} ${s * 0.9} Q${s * 0.14} ${s * 0.6} ${s * 0.5} ${s * 0.58} Q${s * 0.86} ${s * 0.6} ${s * 0.88} ${s * 0.9}z`} fill={top} />
      <rect x={s * 0.44} y={s * 0.44} width={s * 0.12} height={s * 0.14} rx={s * 0.04} fill={skin} />
      <ellipse cx={s * 0.5} cy={s * 0.33} rx={s * 0.19} ry={s * 0.21} fill={skin} />
      <ellipse cx={s * 0.45} cy={s * 0.27} rx={s * 0.09} ry={s * 0.07} fill="#fff" opacity={0.12} />
      {hairEl}
      <circle cx={s * 0.43} cy={s * 0.34} r={s * 0.014} fill="#2a1d18" /><circle cx={s * 0.57} cy={s * 0.34} r={s * 0.014} fill="#2a1d18" />
      {upset && <path d={`M${s * 0.4} ${s * 0.305} L${s * 0.46} ${s * 0.325} M${s * 0.6} ${s * 0.305} L${s * 0.54} ${s * 0.325}`} stroke={hair} strokeWidth={s * 0.012} strokeLinecap="round" />}
      <path d={mouth} stroke="#5a3a2c" strokeWidth={s * 0.013} fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Say({ children, tone = 'soft', style }: { children: ReactNode; tone?: 'soft' | 'warn' | 'ok' | 'bad'; style?: CSSProperties }) {
  const [bg, fg] = { soft: ['#fff', INK], warn: ['#fdf6ec', '#9a4a07'], ok: ['#eaf6ef', GREEN], bad: ['#fdecec', '#a3241b'] }[tone];
  return <div style={{ background: bg, color: fg, border: `1px solid ${LINE}`, borderRadius: '16px 16px 16px 4px', padding: '9px 13px', fontSize: 14, fontWeight: 600, lineHeight: 1.4, boxShadow: '0 10px 24px -14px rgba(0,0,0,.35)', maxWidth: 320, ...style }}>{children}</div>;
}

/** The scanner gun. The red beam shows while it reads. */
export function ScannerGun({ beam, size = 1 }: { beam: boolean; size?: number }) {
  return (
    <div style={{ position: 'relative', width: 96 * size, height: 130 * size, transform: 'rotate(-24deg)', flexShrink: 0 }} aria-hidden>
      {beam && <div style={{ position: 'absolute', left: -150 * size, top: 30 * size, width: 156 * size, height: 3, background: 'linear-gradient(90deg, transparent, #ff3b30)', boxShadow: '0 0 12px 3px #ff3b3088', transform: 'rotate(24deg)', transformOrigin: 'right center', animation: 'regBeam .35s ease-in-out infinite alternate' }} />}
      <div style={{ width: 96 * size, height: 58 * size, background: 'linear-gradient(160deg,#4a4b51,#1d1e22)', borderRadius: `${16 * size}px ${30 * size}px ${12 * size}px ${12 * size}px`, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 4 * size, top: 12 * size, width: 10 * size, height: 34 * size, borderRadius: 4, background: beam ? '#ff3b30' : '#ff3b3088' }} />
      </div>
      <div style={{ width: 36 * size, height: 76 * size, marginLeft: 46 * size, marginTop: -8 * size, background: 'linear-gradient(90deg,#2a2b30,#3d3e44)', borderRadius: `${6 * size}px ${6 * size}px ${14 * size}px ${14 * size}px` }} />
    </div>
  );
}

/** The card reader. */
export function Reader({ amount, line1, tone, children, scale = 1 }: { amount: string; line1: string; tone?: 'ok' | 'bad'; children?: ReactNode; scale?: number }) {
  const [bg, fg] = tone === 'ok' ? ['#eaf6ef', GREEN] : tone === 'bad' ? ['#fdecec', RED] : ['#f7f7f8', INK];
  return (
    <div style={{ width: 132 * scale, background: 'linear-gradient(160deg,#3a3b40,#16171a)', borderRadius: 20 * scale, padding: 10 * scale, boxShadow: '0 18px 30px -14px rgba(0,0,0,.6)', flexShrink: 0 }}>
      <div style={{ height: 112 * scale, borderRadius: 12 * scale, background: bg, color: fg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, textAlign: 'center', padding: 6 }}>
        <div style={{ fontSize: 18 * scale, fontWeight: 800 }}>{amount}</div><div style={{ fontSize: 10.5 * scale, fontWeight: 600, lineHeight: 1.25 }}>{line1}</div>
      </div>
      {children ? <div style={{ marginTop: 8 * scale, display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginTop: 8 * scale }}>{Array.from({ length: 9 }, (_, i) => <span key={i} style={{ height: 9 * scale, borderRadius: 3, background: '#4a4b51' }} />)}</div>}
    </div>
  );
}

export function Btn({ children, onClick, ghost, small, danger, disabled, style }: { children: ReactNode; onClick?: () => void; ghost?: boolean; small?: boolean; danger?: boolean; disabled?: boolean; style?: CSSProperties }) {
  return <button disabled={disabled} onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: small ? '7px 13px' : '11px 20px', borderRadius: 999, fontSize: small ? 12.5 : 14, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, border: `1px solid ${ghost ? LINE : danger ? RED : INK}`, background: ghost ? '#fff' : danger ? RED : INK, color: ghost ? INK : '#fff', whiteSpace: 'nowrap', ...style }}>{children}</button>;
}
export function Chip({ children, tone }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'ink' | 'blue' }) {
  const [bg, fg] = { green: ['#e8f3ec', GREEN], amber: ['#fdf1e3', AMBER], red: ['#fdecec', RED], ink: [INK, '#fff'], blue: ['#eef2ff', '#1e3a8a'] }[tone || 'green'] || [SOFT, INK];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: tone ? bg : SOFT, color: tone ? fg : INK, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}

// ── Practice cash ───────────────────────────────────────────────────────

/** A practice banknote: real size ratio, color and denomination; original artwork; marked PRACTICE. */
export function NoteArt({ code, value, scale = 1, style }: { code: $.CurrencyCode; value: number; scale?: number; style?: CSSProperties }) {
  const n = $.CURRENCIES[code].notes.find((x) => x.value === value)!; const w = n.w * scale, h = n.h * scale, ink = n.ink;
  const lab = $.denomLabel(code, value);
  return (
    <div aria-label={lab} style={{ width: w, height: h, borderRadius: Math.max(2, 4 * scale), position: 'relative', overflow: 'hidden', flexShrink: 0, boxShadow: '0 4px 10px -5px rgba(0,0,0,.35)',
      background: `repeating-radial-gradient(circle at 70% 50%, ${ink}12 0 1px, transparent 1px ${5 * scale}px), repeating-linear-gradient(115deg, ${ink}0d 0 1px, transparent 1px ${7 * scale}px), linear-gradient(135deg, ${n.bg}, #ffffff 55%, ${n.bg})`, ...style }}>
      <div style={{ position: 'absolute', inset: h * 0.07, border: `1px solid ${ink}55`, borderRadius: 3 }} />
      <div style={{ position: 'absolute', left: w * 0.06, top: h * 0.08, fontWeight: 800, fontSize: h * 0.24, color: ink, lineHeight: 1 }}>{lab}</div>
      <div style={{ position: 'absolute', right: w * 0.06, bottom: h * 0.1, fontWeight: 800, fontSize: h * 0.18, color: ink, lineHeight: 1 }}>{value / 100}</div>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: h * 0.5, height: h * 0.5, transform: 'translate(-30%,-50%)', borderRadius: '50%', background: `radial-gradient(circle at 40% 35%, #ffffffcc, ${n.bg} 60%, ${ink}44)`, boxShadow: `inset 0 0 0 2px ${ink}33` }} />
      <div style={{ position: 'absolute', left: w * 0.68, top: 0, bottom: 0, width: Math.max(2, w * 0.025), background: 'linear-gradient(180deg,#e9edf3,#c9d2de,#f4f6f9,#c9d2de)' }} />
      {h > 30 && <div style={{ position: 'absolute', left: w * 0.06, bottom: h * 0.1, fontWeight: 700, fontSize: Math.max(5, h * 0.09), letterSpacing: '.2em', color: `${ink}aa` }}>PRACTICE</div>}
    </div>
  );
}
const METAL: Record<string, [string, string, string]> = { copper: ['#e7a77a', '#b8693e', '#8a4a2a'], nickel: ['#eef0f3', '#b9bec6', '#868b93'], gold: ['#f3dc8f', '#cfa64a', '#97752a'], brass: ['#f0d79a', '#c8a457', '#937532'] };
const polyPts = (c: number, r: number, n: number) => Array.from({ length: n }, (_, i) => `${(c + r * Math.sin((2 * Math.PI * i) / n)).toFixed(1)},${(c - r * Math.cos((2 * Math.PI * i) / n)).toFixed(1)}`).join(' ');
/** A practice coin: real relative size, metal and shape (7-sided 20p and 50p, 12-sided £1, 11-sided loonie, two-metal coins). */
export function CoinArt({ code, value, scale = 2 }: { code: $.CurrencyCode; value: number; scale?: number }) {
  const k = $.CURRENCIES[code].coins.find((x) => x.value === value)!; const d = k.mm * scale, r = d / 2, c = r + 1.5, S = d + 3;
  const id = `c${code}${value}`;
  const bi = k.metal.startsWith('bi-'); const outer = METAL[bi ? (k.metal[3] === 'g' ? 'gold' : 'nickel') : k.metal]; const inner = bi ? METAL[k.metal[4] === 'g' ? 'gold' : 'nickel'] : outer;
  const grad = (gid: string, m: [string, string, string]) => <radialGradient id={gid} cx="35%" cy="30%"><stop offset="0" stopColor={m[0]} /><stop offset=".7" stopColor={m[1]} /><stop offset="1" stopColor={m[2]} /></radialGradient>;
  const fs = Math.max(6, d * 0.27);
  return (
    <svg width={S} height={S} aria-label={k.label} style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.28))', flexShrink: 0 }}>
      <defs>{grad(`${id}o`, outer)}{grad(`${id}i`, inner)}</defs>
      {k.sides ? <polygon points={polyPts(c, r, k.sides)} fill={`url(#${id}o)`} stroke={outer[2]} strokeWidth={0.8} /> : <circle cx={c} cy={c} r={r} fill={`url(#${id}o)`} stroke={outer[2]} strokeWidth={0.8} />}
      {bi ? <circle cx={c} cy={c} r={r * 0.62} fill={`url(#${id}i)`} stroke={inner[2]} strokeWidth={0.7} /> : <circle cx={c} cy={c} r={r * 0.82} fill="none" stroke={outer[2]} strokeOpacity={0.45} strokeWidth={0.7} />}
      <text x={c} y={c + fs * 0.35} textAnchor="middle" fontWeight={800} fontSize={fs} fill={inner[2]} fontFamily="inherit">{k.label}</text>
    </svg>
  );
}
/** One piece of cash, note or coin. */
export function Cash({ code, value, size = 1 }: { code: $.CurrencyCode; value: number; size?: number }) {
  return $.isNote(code, value) ? <NoteArt code={code} value={value} scale={0.62 * size} /> : <CoinArt code={code} value={value} scale={1.6 * size} />;
}

/** The open cash drawer. In 'give' mode tap a slot to take one piece; in 'count' mode each slot shows its pile and a counter. */
export function CashDrawer({ code, drawer, onTake, counts, setCount, narrow }: { code: $.CurrencyCode; drawer: Record<number, number>; onTake?: (v: number) => void; counts?: Record<number, number>; setCount?: (v: number, n: number) => void; narrow?: boolean }) {
  const cur = $.CURRENCIES[code]; const fl = cur.float;
  const noteSlots = cur.notes.map((n) => n.value).filter((v) => fl[v]).sort((a, b) => b - a);
  const under = cur.notes.map((n) => n.value).filter((v) => !fl[v] && drawer[v]);
  const coins = cur.coins.map((c) => c.value);
  const maxW = Math.max(...cur.notes.filter((n) => noteSlots.includes(n.value)).map((n) => n.w));
  const slotW = narrow ? 76 : 118; const sc = (slotW - 12) / maxW;
  const counter = (v: number) => counts && setCount && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 4 }}>
      <button onClick={() => setCount(v, Math.max(0, (counts[v] || 0) - 1))} style={stepBtn}>−</button>
      <input aria-label={`Count of ${$.denomLabel(code, v)}`} inputMode="numeric" value={counts[v] ?? ''} onChange={(e) => setCount(v, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} style={{ width: 34, textAlign: 'center', border: `1px solid ${LINE}`, borderRadius: 8, padding: '3px 0', fontSize: 13, fontFamily: 'inherit', color: INK, background: '#fff' }} />
      <button onClick={() => setCount(v, (counts[v] || 0) + 1)} style={stepBtn}>+</button>
    </div>);
  const slotBg = '#ecebe7';
  return (
    <div style={{ background: 'linear-gradient(180deg,#3a3b40,#26272b)', borderRadius: 16, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 22px 40px -22px rgba(0,0,0,.7)', maxWidth: '100%', overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {noteSlots.map((v) => { const n = drawer[v] || 0; const show = counts ? Math.min(n, 30) : Math.min(n, 4);
          return <div key={v} style={{ width: slotW, flexShrink: 0, background: slotBg, borderRadius: 9, padding: 6, boxSizing: 'border-box' }}>
            {counts ? <div aria-label={`${$.denomLabel(code, v)} notes`} style={{ display: 'flex', flexWrap: 'wrap', gap: 3, minHeight: 40, alignContent: 'flex-start' }}>
              {Array.from({ length: show }, (_, k) => <NoteArt key={k} code={code} value={v} scale={(slotW - 24) / 3 / maxW} style={{ boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />)}
            </div> : <button disabled={!onTake || !n} onClick={() => onTake?.(v)} aria-label={`Take ${$.denomLabel(code, v)}`} style={{ position: 'relative', width: '100%', height: 74, border: 'none', background: 'none', padding: 0, cursor: onTake && n ? 'pointer' : 'default' }}>
              {Array.from({ length: show }, (_, k) => <div key={k} style={{ position: 'absolute', left: 0, top: k * 4 }}><NoteArt code={code} value={v} scale={sc} /></div>)}
              {!n && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: MUTED }}>empty</div>}
            </button>}
            <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: MUTED }}>{$.denomLabel(code, v)}{!counts && <span style={{ fontWeight: 500 }}> · {n}</span>}</div>
            {counter(v)}
          </div>; })}
        {under.length > 0 && <div style={{ width: narrow ? 70 : 96, flexShrink: 0, background: '#1d1e22', borderRadius: 9, padding: 6, color: '#fff', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <b style={{ fontSize: 11 }}>Under the tray</b>
          {under.map((v) => <div key={v}><div style={{ opacity: 0.9 }}>{$.denomLabel(code, v)} {counts ? '' : `· ${drawer[v]}`}</div>{counts && <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', margin: '3px 0' }}>{Array.from({ length: drawer[v] }, (_, k) => <NoteArt key={k} code={code} value={v} scale={0.18} />)}</div>}{counter(v)}</div>)}
        </div>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {coins.map((v) => { const n = drawer[v] || 0; const show = counts ? Math.min(n, 30) : Math.min(n, 3);
          return <div key={v} style={{ flex: 1, minWidth: narrow ? 44 : 56, background: slotBg, borderRadius: 9, padding: 5, boxSizing: 'border-box' }}>
            <button disabled={!onTake || !n} onClick={() => onTake?.(v)} aria-label={`Take ${$.denomLabel(code, v)}`} style={{ width: '100%', minHeight: 40, border: 'none', background: 'none', padding: 0, cursor: onTake && n ? 'pointer' : 'default', display: 'flex', flexWrap: 'wrap', gap: counts ? 1 : 0, justifyContent: 'center', alignItems: 'center' }}>
              {Array.from({ length: show }, (_, k) => <span key={k} style={{ marginLeft: counts || k === 0 ? 0 : -14 }}><CoinArt code={code} value={v} scale={counts ? 0.8 : narrow ? 1.05 : 1.3} /></span>)}
              {!n && <span style={{ fontSize: 10.5, color: MUTED }}>empty</span>}
            </button>
            <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: MUTED }}>{$.denomLabel(code, v)}{!counts && <span style={{ fontWeight: 500 }}> · {n}</span>}</div>
            {counter(v)}
          </div>; })}
      </div>
    </div>
  );
}
const stepBtn: CSSProperties = { width: 22, height: 22, borderRadius: 11, border: `1px solid ${LINE}`, background: '#fff', color: INK, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
