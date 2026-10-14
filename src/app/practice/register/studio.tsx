'use client';
// The studio look for the register game on a computer: a warm salon behind the desk, glass panels over it, the
// studio's own products on the counter (real photos when a product has one) and the register as a tablet.
import { type CSSProperties, type ReactNode } from 'react';
import * as R from '@/lib/practice/register';
import { Barcode, Bottle, Person, INK, MUTED, GREEN, BLUE } from './parts';

export const PINE = '#2f4a3c';
export const GLASS: CSSProperties = { background: 'rgba(58,52,46,.42)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)', border: '1px solid rgba(255,255,255,.22)', boxShadow: '0 24px 48px -28px rgba(0,0,0,.6)', color: '#fff' };
export const GLASS_ROW: CSSProperties = { background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.28)', color: '#fff' };

const SHELF = ['cuticle', 'topcoat', 'nipper', 'cuticle', 'topcoat', 'bitball', 'cuticle', 'topcoat', 'bitbarrel', 'nipper', 'cuticle', 'topcoat'];

export function Wordmark({ light = true, h = 44, sub = true }: { light?: boolean; h?: number; sub?: boolean }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: h * 0.12 }}>
      <img src={light ? '/practice/opal-logo-light.png' : '/practice/opal-logo-dark.png'} alt="Opal" style={{ height: h, width: 'auto', display: 'block' }} />
      {sub && <span style={{ fontSize: Math.max(8, h * 0.2), letterSpacing: '.32em', fontWeight: 500, color: light ? 'rgba(255,255,255,.9)' : PINE, paddingLeft: '.32em' }}>NAIL ACADEMY</span>}
    </div>
  );
}

function ShelfUnit({ style, flip }: { style: CSSProperties; flip?: boolean }) {
  const rows = [0, 1, 2, 3];
  return (
    <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', ...style }}>
      {rows.map((r) => (
        <div key={r} style={{ position: 'relative', height: `${100 / rows.length}%`, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', padding: '0 6%' }}>
          <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 6, background: 'linear-gradient(180deg,rgba(255,236,200,.9),rgba(255,236,200,0))', filter: 'blur(2px)' }} />
          {SHELF.slice((r * 3 + (flip ? 1 : 0)) % 6, ((r * 3 + (flip ? 1 : 0)) % 6) + 5).map((k, i) => { const sku = R.skuBy(k); return sku.img ? <img key={i} src={sku.img} alt="" style={{ height: k.startsWith('bit') ? '46%' : k === 'cuticle' ? '70%' : '62%', width: 'auto', marginBottom: 6, filter: 'drop-shadow(0 6px 6px rgba(0,0,0,.35))' }} /> : null; })}
          <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 7, background: 'linear-gradient(180deg,#f7efe4,#cdbfae)', boxShadow: '0 6px 10px -4px rgba(0,0,0,.45)' }} />
        </div>
      ))}
    </div>
  );
}

/** The salon behind the desk: warm walls, a lit arch with the name, shelves of the studio's own products. Out of focus, like a photo. */
export function Backdrop() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'radial-gradient(120% 90% at 62% 18%, #eadcc8 0%, #c9b096 36%, #8d735e 70%, #4f3f34 100%)' }}>
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(2.6px)' }}>
        {[12, 30, 50, 70, 88].map((x) => <span key={x} style={{ position: 'absolute', left: `${x}%`, top: -40, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,244,222,.9) 0%, rgba(255,244,222,0) 65%)' }} />)}
        <div style={{ position: 'absolute', left: '14%', top: '7%', width: '26%', height: '56%', borderRadius: 8, background: 'linear-gradient(180deg,#e7d8c4,#c9b39b)', boxShadow: 'inset 0 0 0 8px rgba(255,248,236,.6), 0 0 60px 8px rgba(255,226,180,.35)' }} />
        <ShelfUnit style={{ left: '15%', top: '9%', width: '24%', height: '52%' }} />
        <div style={{ position: 'absolute', right: '0%', top: '8%', width: '27%', height: '50%', borderRadius: 8, background: 'linear-gradient(180deg,#e7d8c4,#c9b39b)', boxShadow: 'inset 0 0 0 8px rgba(255,248,236,.6), 0 0 60px 8px rgba(255,226,180,.35)' }} />
        <ShelfUnit style={{ right: '1%', top: '10%', width: '25%', height: '46%' }} flip />
        <div style={{ position: 'absolute', left: '56%', top: '2%', width: 'min(26vw, 380px)', height: '48%', borderRadius: '999px 999px 0 0', background: 'radial-gradient(90% 70% at 50% 40%, #fff8ec 0%, #f1e6d5 55%, #dccbb4 100%)', boxShadow: '0 0 80px 20px rgba(255,236,206,.45), inset 0 0 0 10px rgba(255,255,255,.35)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Wordmark light={false} h={78} />
        </div>
        <div style={{ position: 'absolute', left: '44%', top: '20%', width: '9%', height: '44%', borderRadius: '40% 40% 8% 8%', background: 'radial-gradient(60% 40% at 50% 30%, #6f9a63 0%, #3e6a43 55%, rgba(46,80,52,0) 100%)', opacity: 0.85 }} />
        <div style={{ position: 'absolute', left: '82%', top: '24%', width: '10%', height: '40%', borderRadius: '45% 45% 10% 10%', background: 'radial-gradient(60% 45% at 50% 30%, #7aa56b 0%, #3f6b45 55%, rgba(46,80,52,0) 100%)', opacity: 0.8 }} />
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(130% 100% at 50% 30%, rgba(0,0,0,0) 55%, rgba(30,22,16,.45) 100%)' }} />
    </div>
  );
}

/** The marble counter the desk sits on. */
export function Counter({ top = '64%' }: { top?: string }) {
  return (
    <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top, bottom: 0, background: 'linear-gradient(180deg,#f6f3ee 0%,#ebe6df 45%,#ddd6cd 100%)', borderTop: '2px solid #fffdf9', boxShadow: '0 -18px 40px -20px rgba(0,0,0,.35)' }}>
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(1.2px)', opacity: 0.7, background: 'radial-gradient(60% 18% at 22% 40%, rgba(170,160,150,.22), rgba(170,160,150,0) 70%), radial-gradient(40% 10% at 70% 70%, rgba(160,150,140,.2), rgba(160,150,140,0) 70%), linear-gradient(171deg, rgba(150,140,130,0) 30%, rgba(150,140,130,.18) 31%, rgba(150,140,130,0) 32.5%), linear-gradient(4deg, rgba(150,140,130,0) 60%, rgba(150,140,130,.14) 61%, rgba(150,140,130,0) 62%), linear-gradient(163deg, rgba(150,140,130,0) 72%, rgba(150,140,130,.12) 72.6%, rgba(150,140,130,0) 73.5%)' }} />
    </div>
  );
}

/** A product on the counter: its real photo when there is one, with a price sticker you can scan. */
export function ProductPhoto({ sku, h = 220, smudge, onClick, selected, dim, sticker = true, style }: { sku: R.Sku; h?: number; smudge?: boolean; onClick?: () => void; selected?: boolean; dim?: boolean; sticker?: boolean; style?: CSSProperties }) {
  if (!sku.img) return <Bottle sku={sku} w={Math.round(h * 0.52)} h={h} smudge={smudge} onClick={onClick} selected={selected} dim={dim} style={style} />;
  const tall = sku.key === 'cuticle' ? h * 1.08 : sku.key.startsWith('bit') ? h * 0.82 : h;
  return (
    <button onClick={onClick} aria-label={R.skuLabel(sku)} style={{ position: 'relative', border: 'none', background: 'none', padding: 0, cursor: onClick ? 'pointer' : 'default', opacity: dim ? 0.35 : 1, transition: 'transform .2s, opacity .2s', transform: selected ? 'translateY(-10px)' : undefined, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', ...style }}>
      <img src={sku.img} alt="" draggable={false} style={{ height: tall, width: 'auto', display: 'block', filter: `drop-shadow(0 18px 14px rgba(0,0,0,.28))${selected ? ' drop-shadow(0 0 10px rgba(127,209,165,.9))' : ''}` }} />
      {sticker && <span style={{ marginTop: -Math.min(26, h * 0.1), transform: `scale(${Math.max(0.5, Math.min(0.85, h / 300))})`, transformOrigin: 'top center', boxShadow: '0 4px 10px -4px rgba(0,0,0,.35)', borderRadius: 3 }}><Barcode code={sku.code} h={26} unit={1.05} smudge={smudge} /></span>}
    </button>
  );
}

export function Thumb({ sku, size = 46 }: { sku?: R.Sku; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 12, background: '#f4f2ee', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', border: '1px solid #ece8e2' }}>
      {sku?.img ? <img src={sku.img} alt="" style={{ height: size * 0.86, width: 'auto', maxWidth: size * 0.9, objectFit: 'contain' }} /> : sku ? <span style={{ width: size * 0.3, height: size * 0.62, borderRadius: 5, background: sku.color }} /> : <span style={{ fontSize: size * 0.42 }}>💅</span>}
    </span>
  );
}

export function FaceDot({ look, photo, size = 58, ring = true, mood }: { look: R.Look; photo?: string; size?: number; ring?: boolean; mood?: number }) {
  const moodRing = mood == null ? null : mood < 0.3 ? '#e5484d' : mood < 0.6 ? '#f0a43a' : '#7fd1a5';
  return (
    <span title={mood == null ? undefined : mood < 0.3 ? 'Unhappy' : mood < 0.6 ? 'Getting impatient' : 'Happy'} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', background: 'linear-gradient(180deg,#efe6da,#d9cbb9)', display: 'inline-flex', alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0, boxShadow: moodRing ? `0 0 0 3px ${moodRing}` : ring ? '0 0 0 2px rgba(255,255,255,.85)' : undefined, transition: 'box-shadow .4s' }}>
      {photo ? <span style={{ width: '100%', height: '100%', backgroundImage: `url(${photo})`, backgroundRepeat: 'no-repeat', backgroundSize: '230% auto', backgroundPosition: '44% 6%' }} />
        : <span style={{ marginBottom: -size * 0.08 }}><Person look={look} size={size * 1.25} /></span>}
    </span>
  );
}

/** A client in a real photo, standing behind the counter. */
export function PhotoPerson({ src, size, mood = 0.8 }: { src: string; size: number; mood?: number }) {
  return <img src={src} alt="" draggable={false} style={{ width: size, height: 'auto', display: 'block', filter: mood < 0.3 ? 'saturate(.85) brightness(.96)' : undefined, transition: 'filter .6s' }} />;
}

const ICONS: Record<string, string> = {
  bag: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3',
  screen: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 15h2',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4V8Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  sound: 'M4 9h4l5-4v14l-5-4H4V9Zm12 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4V9Zm12 1 5 5m0-5-5 5',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7V5Z',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  barcode: 'M4 6v12M7 6v12M10 6v12M13 6v12M17 6v12M20 6v12',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm9 16-4-4',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 4v5l3 2',
  question: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm-2.5 6.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14m0 3h.01',
  card: 'M3 6h18v12H3V6Zm0 4h18',
  cash: 'M3 7h18v10H3V7Zm9 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  tap: 'M8 9a6 6 0 0 1 8 0M5 6a10 10 0 0 1 14 0M12 13a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9a6 6 0 0 1 12 0M16 11a3 3 0 1 0-1-5.8M21 20a6 6 0 0 0-4.5-5.8',
};
export function Icon({ name, size = 20, color = 'currentColor', w = 1.7 }: { name: keyof typeof ICONS | string; size?: number; color?: string; w?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}><path d={ICONS[name] || ''} /></svg>;
}

export function RailButton({ icon, label, active, on, onClick }: { icon: string; label: string; active?: boolean; on?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 14px', borderRadius: 12, border: 'none', cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, textAlign: 'left', background: active ? 'rgba(255,255,255,.88)' : on ? 'rgba(127,209,165,.22)' : 'transparent', color: active ? INK : '#fff', transition: 'background .2s' }}>
      <Icon name={icon} size={20} color={active ? INK : on ? '#7fd1a5' : '#fff'} />{label}{on && <span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: 4, background: '#7fd1a5' }} />}
    </button>
  );
}

export function Pill({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...GLASS, borderRadius: 16, padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 600, ...style }}>{children}</div>;
}

export function LevelPill({ points }: { points: number }) {
  const per = 500; const level = 1 + Math.floor(points / per); const pct = ((points % per) / per) * 100;
  return (
    <Pill style={{ padding: '8px 16px 8px 12px' }}>
      <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>⭐</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 84 }}>
        <span style={{ fontSize: 12.5, letterSpacing: '.06em' }}>LEVEL {level}</span>
        <span style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}><span style={{ display: 'block', width: `${pct}%`, height: '100%', background: '#7fd1a5', transition: 'width .4s' }} /></span>
      </span>
    </Pill>
  );
}

export function PointsPill({ points }: { points: number }) {
  return (
    <Pill style={{ padding: '8px 18px 8px 10px' }}>
      <span aria-hidden style={{ width: 26, height: 26, borderRadius: 13, background: 'radial-gradient(circle at 35% 30%, #ffe69a, #e2a92a 70%, #b9801a)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.35)' }} />
      <span style={{ fontSize: 18, fontWeight: 600 }} aria-label={`${points} points`}>{points.toLocaleString('en-US')}</span>
    </Pill>
  );
}

export const tabletBtn = (primary?: boolean, on?: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, padding: '0 16px', borderRadius: 14, border: `1px solid ${primary ? PINE : on ? INK : '#e3e0db'}`, background: primary ? PINE : on ? INK : '#fff', color: primary || on ? '#fff' : INK, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', boxShadow: primary ? '0 12px 22px -14px rgba(47,74,60,.9)' : '0 1px 2px rgba(0,0,0,.05)' });

export { INK, MUTED, GREEN, BLUE };
