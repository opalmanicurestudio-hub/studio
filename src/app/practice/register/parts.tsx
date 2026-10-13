'use client';
// Drawn pieces for the register view: clients, products with real UPC-A barcodes,
// the scanner, the card reader and the client screen. Original shapes, app colors.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

/** A handheld scanner: graphite body, soft-white shell, glass window, and a status light that turns green on a good read. */
export function ScannerGun({ beam, size = 1, ok = false }: { beam: boolean; size?: number; ok?: boolean }) {
  const W = 190 * size, H = 170 * size;
  return (
    <svg width={W} height={H} viewBox="0 0 190 170" aria-hidden style={{ flexShrink: 0, overflow: 'visible' }}>
      <defs>
        <linearGradient id="sgBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a4c53" /><stop offset=".55" stopColor="#2a2b30" /><stop offset="1" stopColor="#17181b" /></linearGradient>
        <linearGradient id="sgShell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dfe2e6" /></linearGradient>
        <linearGradient id="sgGrip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#1d1e22" /><stop offset=".5" stopColor="#34363c" /><stop offset="1" stopColor="#1a1b1e" /></linearGradient>
        <linearGradient id="sgGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5a1b1b" /><stop offset=".5" stopColor="#c0392b" stopOpacity=".85" /><stop offset="1" stopColor="#3a0f0f" /></linearGradient>
        <linearGradient id="sgFan" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor="#ff3b30" stopOpacity=".38" /><stop offset="1" stopColor="#ff3b30" stopOpacity="0" /></linearGradient>
        <filter id="sgGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" /></filter>
      </defs>
      {beam && <g style={{ animation: 'regBeam .3s ease-in-out infinite alternate' }}>
        <polygon points="40,46 -150,8 -150,104" fill="url(#sgFan)" />
        <line x1="-150" y1="8" x2="-150" y2="104" stroke="#ff3b30" strokeWidth="5" filter="url(#sgGlow)" />
        <line x1="-150" y1="8" x2="-150" y2="104" stroke="#ff6b60" strokeWidth="1.6" />
      </g>}
      <g transform="rotate(-12 100 80)">
        <path d="M70 70 L118 70 L132 158 Q133 166 125 167 L98 167 Q90 167 89 159 Z" fill="url(#sgGrip)" />
        <path d="M86 92 Q80 104 88 116" stroke="#0f1012" strokeWidth="9" strokeLinecap="round" fill="none" />
        <rect x="30" y="22" width="150" height="58" rx="28" fill="url(#sgBody)" />
        <path d="M58 24 Q100 14 168 30 Q178 36 178 50 L58 50 Z" fill="url(#sgShell)" opacity=".95" />
        <rect x="32" y="30" width="18" height="42" rx="7" fill="url(#sgGlass)" />
        <rect x="35" y="34" width="5" height="30" rx="2.5" fill="#fff" opacity=".25" />
        <circle cx="150" cy="36" r="4.2" fill={ok ? '#34c759' : '#9aa0a6'} />
        {ok && <circle cx="150" cy="36" r="8" fill="#34c759" opacity=".35" filter="url(#sgGlow)" />}
        <path d="M60 74 Q110 82 176 66" stroke="#ffffff" strokeOpacity=".08" strokeWidth="2" fill="none" />
      </g>
    </svg>
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

/** A realistic till drawer: note compartments under chrome bill weights at the back, coin cups at the front,
 *  big notes under the tray. In 'give' mode tap a compartment to lift the weight and take one; in 'count' mode the
 *  weights lift, the notes fan out so they can be counted, and each slot gets a counter. */
export function CashDrawer({ code, drawer, onTake, counts, setCount, narrow, w }: { code: $.CurrencyCode; drawer: Record<number, number>; onTake?: (v: number) => void; counts?: Record<number, number>; setCount?: (v: number, n: number) => void; narrow?: boolean; w?: number }) {
  const cur = $.CURRENCIES[code]; const fl = cur.float; const counting = !!counts;
  const noteSlots = cur.notes.map((n) => n.value).filter((v) => fl[v]).sort((a, b) => a - b);      // small to large, left to right
  const under = cur.notes.map((n) => n.value).filter((v) => !fl[v] && drawer[v]);
  const coins = cur.coins.map((c) => c.value).sort((a, b) => a - b);
  const W = w ?? (narrow ? 360 : 660); const gap = 6, pad = 12;
  const slotW = (W - pad * 2 - gap * (noteSlots.length - 1)) / noteSlots.length;
  const maxW = Math.max(...cur.notes.filter((n) => noteSlots.includes(n.value)).map((n) => n.w));
  const sc = (slotW - 14) / maxW;
  const [lift, setLift] = useState<number | null>(null);
  const take = (v: number) => { if (!onTake || !(drawer[v] > 0)) return; setLift(v); window.setTimeout(() => { setLift(null); onTake(v); }, 220); };
  const counter = (v: number) => counts && setCount && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 6 }}>
      <button onClick={() => setCount(v, Math.max(0, (counts[v] || 0) - 1))} style={stepBtn}>−</button>
      <input aria-label={`Count of ${$.denomLabel(code, v)}`} inputMode="numeric" value={counts[v] ?? ''} onChange={(e) => setCount(v, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} style={{ width: 34, textAlign: 'center', border: `1px solid ${LINE}`, borderRadius: 8, padding: '3px 0', fontSize: 13, fontFamily: 'inherit', color: INK, background: '#fff' }} />
      <button onClick={() => setCount(v, (counts[v] || 0) + 1)} style={stepBtn}>+</button>
    </div>);
  const noteH = Math.max(...cur.notes.map((n) => n.h)) * sc;
  const FAN = 11; const compH = counting ? noteH + 10 + Math.max(0, Math.min(18, Math.max(...noteSlots.map((v) => drawer[v] || 0))) - 1) * FAN : noteH + 26;
  const coinCupH = counting ? 74 : 58;
  return (
    <div style={{ width: W, maxWidth: '100%', flexShrink: 0 }}>
      {/* the drawer body */}
      <div style={{ position: 'relative', borderRadius: '12px 12px 4px 4px', padding: `${pad}px ${pad}px 10px`, background: 'linear-gradient(180deg,#45474d 0%,#2f3035 8%,#26272b 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.18), 0 30px 50px -26px rgba(0,0,0,.75)' }}>
        {/* under the tray: big notes slipped in at the back */}
        <div style={{ height: under.length ? 22 : 10, marginBottom: 6, borderRadius: 4, background: 'linear-gradient(180deg,#0c0c0e,#1a1b1e)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.8)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
          {under.map((v) => <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#c9ccd2', fontSize: 10.5, fontWeight: 700 }}><span style={{ display: 'inline-block', height: 12, overflow: 'hidden', borderRadius: 2 }}><NoteArt code={code} value={v} scale={0.28} /></span>{$.denomLabel(code, v)} × {drawer[v]}</span>)}
          {under.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#8b8f96', letterSpacing: '.06em' }}>UNDER THE TRAY</span>}
        </div>
        {/* note compartments */}
        <div style={{ display: 'flex', gap, background: '#111214', borderRadius: 6, padding: 0, boxShadow: 'inset 0 3px 8px rgba(0,0,0,.85)' }}>
          {noteSlots.map((v, i) => { const n = drawer[v] || 0; const show = counting ? Math.min(n, 18) : Math.min(n, 5); const up = counting || lift === v;
            return <button key={v} disabled={!onTake || !n} onClick={() => take(v)} aria-label={`Take ${$.denomLabel(code, v)}`} style={{ position: 'relative', width: slotW, height: compH, border: 'none', padding: 0, cursor: onTake && n ? 'pointer' : 'default', background: 'linear-gradient(180deg,#1d1e21,#141517)', borderRadius: 5, boxShadow: i ? 'inset 2px 0 0 #2a2b2f' : undefined, overflow: 'hidden' }}>
              {Array.from({ length: show }, (_, k) => <div key={k} style={{ position: 'absolute', left: 7 + ((k * 7) % 3) - 1, top: counting ? 6 + k * FAN : 8 + (show - 1 - k) * 1.5, transform: `rotate(${((k * 37) % 5) - 2}deg)`, transition: 'top .2s' }}><NoteArt code={code} value={v} scale={sc} /></div>)}
              {!n && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#6b6f76' }}>empty</div>}
              {/* chrome bill weight */}
              <div style={{ position: 'absolute', left: '50%', top: 2, width: 12, marginLeft: -6, height: up ? 16 : noteH * 0.82, borderRadius: 6, background: 'linear-gradient(90deg,#7f868f,#f4f6f8 35%,#aeb4bc 60%,#e8ebef 80%,#7f868f)', boxShadow: '0 3px 4px rgba(0,0,0,.55)', transition: 'height .2s ease' }}>
                <div style={{ position: 'absolute', left: -5, right: -5, bottom: -5, height: 10, borderRadius: 5, background: 'linear-gradient(180deg,#f4f6f8,#9ba1a9)', boxShadow: '0 2px 3px rgba(0,0,0,.5)' }} />
              </div>
              <div style={{ position: 'absolute', left: '50%', top: 0, width: 22, marginLeft: -11, height: 6, borderRadius: '0 0 4px 4px', background: 'linear-gradient(180deg,#5a5e65,#2a2c30)' }} />
              <div style={{ position: 'absolute', left: 6, bottom: 4, padding: '1px 6px', borderRadius: 4, background: '#efe9dc', color: INK, fontSize: 10, fontWeight: 800 }}>{$.denomLabel(code, v)}{!counting && <span style={{ fontWeight: 600, color: MUTED }}> · {n}</span>}</div>
            </button>; })}
        </div>
        {/* coin cups */}
        <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
          {coins.map((v) => { const n = drawer[v] || 0; const show = counting ? Math.min(n, 30) : Math.min(n, 6); const k0 = $.CURRENCIES[code].coins.find((c) => c.value === v)!;
            const cs = (narrow ? 0.55 : 0.8) * (counting ? 0.85 : 1);
            return <button key={v} disabled={!onTake || !n} onClick={() => take(v)} aria-label={`Take ${$.denomLabel(code, v)}`} style={{ position: 'relative', flex: 1, minWidth: 0, height: coinCupH, border: 'none', padding: 0, cursor: onTake && n ? 'pointer' : 'default', borderRadius: '10px 10px 22px 22px', background: 'radial-gradient(120% 90% at 50% 15%, #2c2d31 0%, #141517 70%)', boxShadow: 'inset 0 6px 10px rgba(0,0,0,.85), inset 0 -2px 0 rgba(255,255,255,.08)', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: '6px 4px 14px', display: 'flex', flexWrap: 'wrap', alignContent: counting ? 'flex-start' : 'center', justifyContent: 'center' }}>
                {Array.from({ length: show }, (_, k) => <span key={k} style={{ marginLeft: counting || k % 3 === 0 ? 0 : -(k0.mm * cs * 0.9), marginTop: counting ? 0 : k > 2 ? -(k0.mm * cs * 0.9) : 0, transform: `rotate(${(k * 53) % 40 - 20}deg)` }}><CoinArt code={code} value={v} scale={cs} /></span>)}
              </div>
              {!n && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#6b6f76' }}>empty</div>}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 2, textAlign: 'center', fontSize: 9.5, fontWeight: 800, color: '#c9ccd2' }}>{$.denomLabel(code, v)}{!counting && <span style={{ fontWeight: 600, color: '#8b8f96' }}> · {n}</span>}</div>
            </button>; })}
        </div>
      </div>
      {/* drawer front with handle and lock */}
      <div style={{ height: 22, borderRadius: '0 0 12px 12px', background: 'linear-gradient(180deg,#2c2d32,#1b1c1f)', boxShadow: '0 14px 22px -12px rgba(0,0,0,.7)', position: 'relative' }}>
        <div style={{ position: 'absolute', left: '50%', top: 6, width: 90, marginLeft: -45, height: 8, borderRadius: 4, background: '#0e0f11', boxShadow: 'inset 0 2px 3px rgba(0,0,0,.9)' }} />
        <div style={{ position: 'absolute', right: 18, top: 5, width: 12, height: 12, borderRadius: 6, background: 'radial-gradient(circle at 35% 35%,#f4f6f8,#8b9199)' }}><div style={{ position: 'absolute', left: 5, top: 2, width: 2, height: 8, background: '#2a2c30', borderRadius: 1 }} /></div>
      </div>
      {counting && <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {[...noteSlots, ...under, ...coins].map((v) => <div key={v} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '6px 8px', textAlign: 'center' }}><div style={{ fontSize: 11.5, fontWeight: 700 }}>{$.denomLabel(code, v)}</div>{counter(v)}</div>)}
      </div>}
    </div>
  );
}
const stepBtn: CSSProperties = { width: 22, height: 22, borderRadius: 11, border: `1px solid ${LINE}`, background: '#fff', color: INK, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };

// ── Receipts ────────────────────────────────────────────────────────────
const clockAt = (t: number) => { const m = 11 * 60 + Math.floor(t / 2); const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
/** The paper receipt. Also used for real printing (80 mm thermal printers). */
export function ReceiptPaper({ r, width = 230 }: { r: R.Receipt; width?: number | string }) {
  const f = (c: number) => $.fmt(r.currency, c);
  const row = (a: ReactNode, b: ReactNode, bold?: boolean) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: bold ? 800 : 500 }}><span>{a}</span><span>{b}</span></div>;
  const tips = $.sum(r.tenders.map((t) => t.tip));
  return (
    <div style={{ width, background: '#fffefb', color: '#111', font: '500 11px/1.45 ui-monospace, Menlo, Consolas, monospace', padding: '12px 12px 16px', boxSizing: 'border-box' }}>
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, letterSpacing: '.08em' }}>OPAL SALON</div>
      <div style={{ textAlign: 'center', fontSize: 10 }}>** TRAINING · NOT A REAL SALE **</div>
      <div style={{ textAlign: 'center', fontSize: 10, marginBottom: 6 }}>Sat · {clockAt(r.t)} · #{r.no}</div>
      <div style={{ borderTop: '1px dashed #999', margin: '4px 0' }} />
      {r.lines.map((l, i) => <div key={i}>{row(l.label.length > 26 ? `${l.label.slice(0, 25)}…` : l.label, f($.cents(l.price)))}</div>)}
      <div style={{ borderTop: '1px dashed #999', margin: '4px 0' }} />
      {row('TOTAL', f($.cents(r.total)), true)}
      {r.tenders.map((t, i) => <div key={i}>{row(`${t.method === 'card' ? 'Card •••• 4821' : 'Cash'}${r.tenders.length > 1 ? ` · ${t.who}` : ''}`, f(t.amount))}{t.method === 'cash' && t.given !== undefined && <>{row('  Received', f(t.given))}{row('  Change', f(t.change || 0))}</>}</div>)}
      {tips > 0 && row('Tips', f(tips))}
      <div style={{ borderTop: '1px dashed #999', margin: '6px 0 4px' }} />
      <div style={{ textAlign: 'center' }}>Thank you, {r.who}!</div>
      <div style={{ textAlign: 'center', fontSize: 10 }}>Book your next visit at opal.salon</div>
    </div>
  );
}
/** The receipt printer on the counter. While printing, the paper feeds out line by line. */
export function ReceiptPrinter({ r, printing }: { r: R.Receipt | null; printing: boolean }) {
  const [h, setH] = useState(0); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!printing || !r) { setH(0); return; } let x = 0; const full = ref.current?.scrollHeight || 260; const id = window.setInterval(() => { x = Math.min(full, x + 9); setH(x); if (x >= full) window.clearInterval(id); }, 30); return () => window.clearInterval(id); }, [printing, r]);
  return (
    <div style={{ position: 'relative', width: 170, height: 96 }}>
      {r && <div style={{ position: 'absolute', left: 13, bottom: 64, width: 144, height: h, overflow: 'hidden', boxShadow: '0 6px 14px -6px rgba(0,0,0,.35)', transition: 'height .03s linear', display: 'flex', alignItems: 'flex-end' }}>
        <div ref={ref} style={{ transform: 'scale(.62)', transformOrigin: 'bottom left', width: 232 }}><ReceiptPaper r={r} /></div>
      </div>}
      <div style={{ position: 'absolute', inset: 0, top: 22, borderRadius: 16, background: 'linear-gradient(160deg,#ffffff,#dfe1e5)', boxShadow: '0 14px 24px -14px rgba(0,0,0,.55), inset 0 1px 0 #fff' }}>
        <div style={{ position: 'absolute', left: 14, right: 14, top: 8, height: 6, borderRadius: 3, background: '#16171a' }} />
        <div style={{ position: 'absolute', right: 14, bottom: 12, width: 8, height: 8, borderRadius: 4, background: printing ? '#34c759' : '#b9bec6' }} />
        <div style={{ position: 'absolute', left: 14, bottom: 10, fontSize: 9, fontWeight: 700, color: '#9aa0a6', letterSpacing: '.1em' }}>RECEIPTS</div>
      </div>
    </div>
  );
}

// ── Phone / laptop camera scanning ──────────────────────────────────────
/** Scans barcodes with the device camera (back camera on phones). Calls onCode once per new code. */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null); const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null; let lastAt = 0, lastCode = ''; let alive = true;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const ctl = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current!, (res) => {
          if (!res || !alive) return; const code = res.getText(); const now = Date.now();
          if (code === lastCode && now - lastAt < 1800) return; lastCode = code; lastAt = now; setLast(code); onCode(code);
        });
        stop = () => ctl.stop();
      } catch (e: any) { setErr(e?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site, then try again.' : 'No camera found on this device.'); }
    })();
    return () => { alive = false; stop?.(); };
  }, [onCode]);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,23,26,.82)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: '#fff', borderRadius: 22, padding: 14, width: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ flex: 1, fontSize: 15 }}>Scan with your camera</b><Btn small ghost onClick={onClose}>Done</Btn></div>
        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
          <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', left: '12%', right: '12%', top: '34%', bottom: '34%', border: '2px solid rgba(255,255,255,.9)', borderRadius: 12, boxShadow: '0 0 0 999px rgba(0,0,0,.35)' }} />
          <div style={{ position: 'absolute', left: '14%', right: '14%', top: '50%', height: 2, background: '#ff3b30', boxShadow: '0 0 10px 2px #ff3b3088', animation: 'regBeam .4s ease-in-out infinite alternate' }} />
        </div>
        <div style={{ fontSize: 12.5, color: err ? RED : MUTED }}>{err || (last ? `Read ${last}. Keep going.` : 'Hold a barcode from the practice sheet (or a real product) inside the frame.')}</div>
      </div>
    </div>
  );
}
