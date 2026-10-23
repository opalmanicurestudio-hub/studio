'use client';
// The public pay calculator (design canvas "Pay clarity", boards CalcStart, CalcStep, CalcResult, CalcOffer), in the
// same world as the landing page: white, soft moving light, frosted glass, light headings, motion that settles in.
// Everything happens in the browser: no sign-up, nothing sent, nothing stored. A private link packs the answers into
// the address after the # (which browsers never send to a server). English, Spanish and Vietnamese. US rules.
// ?brand=opal shows the Opal Nail Academy version. "Reduce motion" and printing get a still page; on paper the dark cards
// become soft light panels and labels read as written (the app's print look, lib/print-style).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Briefcase, Store, Scale, Clock, Lock, Sparkles, ArrowRight, ArrowLeft, Check, Link2, Printer, Compass, HelpCircle, Minus, Plus, Search, X, ChevronDown } from 'lucide-react';
import { blank, compute, decodeState, encodeState, hoursOf, type CalcState, type Mode, type PayType, type Result } from '@/lib/pay-calc';
import { LANGS, tr, OCC_TITLES, CONTRACTOR_Q, JOB_HINT, type Lang, type Key } from '@/lib/pay-calc-i18n';
import { STATE_MIN_WAGE, minWageFor } from '@/lib/state-wages';
import { OCCUPATIONS, WAGE_SOURCE } from '@/lib/wage-data';
import { CONTRACTOR_QUESTIONS, US_STATES, TAX_YEAR, type Filing } from '@/lib/pay-extras';
import { planLabel, type Plan } from '@/lib/pay-clarity';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', MINT = '#7fd1a5', AMBER = '#b45309';
const money = (n: number | null | undefined, cents = false) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`);
const hr = (n: number | null | undefined) => money(n, true);
type T = (k: Key, v?: Record<string, string | number>) => string;

const CSS = `
.pc{min-height:100vh;background:#fff;color:${INK};font-family:'Plus Jakarta Sans',system-ui,sans-serif;position:relative;overflow-x:clip}
.pc-sky{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.pc-orb{position:absolute;border-radius:50%;filter:blur(70px);opacity:.75;animation:pcOrb 20s ease-in-out infinite alternate}
.pc-orb.b{animation-duration:24s;animation-delay:-7s}.pc-orb.c{animation-duration:28s;animation-delay:-13s}
@keyframes pcOrb{to{transform:translate3d(60px,-40px,0) scale(1.12)}}
.pc-wrap{position:relative;z-index:1;max-width:1160px;margin:0 auto;padding:22px 20px 44px;display:flex;flex-direction:column;gap:26px;box-sizing:border-box}
.pc-h1{font-weight:300;letter-spacing:-0.035em;margin:0;line-height:1.04}
.pc-in{animation:pcIn .9s cubic-bezier(.22,1,.36,1) both;animation-delay:var(--d,0s)}
@keyframes pcIn{from{opacity:0;transform:translateY(18px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
.pc-glass{background:rgba(255,255,255,.68);-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);border:1px solid rgba(255,255,255,.95);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 0 0 1px rgba(22,23,26,.05),0 30px 60px -42px rgba(22,23,26,.45);border-radius:26px}
.pc-lift{transition:transform .45s cubic-bezier(.22,1,.36,1),box-shadow .45s cubic-bezier(.22,1,.36,1),border-color .3s}
.pc-lift:hover{transform:translateY(-5px);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 0 0 1px rgba(22,23,26,.08),0 40px 70px -40px rgba(22,23,26,.5)}
.pc-lift:hover .pc-go{transform:translateX(4px)}
.pc-go{transition:transform .35s cubic-bezier(.22,1,.36,1)}
.pc-dark{position:relative;overflow:hidden;background:radial-gradient(120% 140% at 0% 0%,#34363d 0%,#1d1e22 45%,#121315 100%);color:#fff;border-radius:26px;box-shadow:0 40px 80px -40px rgba(22,23,26,.7)}
.pc-dark::before{content:'';position:absolute;right:-30%;top:-60%;width:80%;height:160%;background:radial-gradient(closest-side,rgba(127,209,165,.28),rgba(127,209,165,0));animation:pcOrb 16s ease-in-out infinite alternate;pointer-events:none}
.pc-sheen::after{content:'';position:absolute;top:-50%;bottom:-50%;left:-60%;width:38%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.11),transparent);transform:skewX(-18deg);animation:pcSheen 7s 1.4s ease-in-out infinite;pointer-events:none}
@keyframes pcSheen{0%{left:-60%}28%,100%{left:130%}}
.pc-float{animation:pcFloat 7s ease-in-out infinite}
@keyframes pcFloat{0%,100%{transform:translateY(0) rotate(-1.2deg)}50%{transform:translateY(-12px) rotate(.4deg)}}
.pc-bar{transform-origin:left center;animation:pcBar 1.3s cubic-bezier(.22,1,.36,1) both;animation-delay:var(--d,.2s)}
@keyframes pcBar{from{transform:scaleX(0)}}
.pc-pop{animation:pcPop .8s cubic-bezier(.22,1.4,.36,1) both;animation-delay:var(--d,.6s)}
@keyframes pcPop{from{opacity:0;transform:scale(.3)}}
.pc-dot{width:8px;height:8px;border-radius:50%;background:${MINT};box-shadow:0 0 0 0 rgba(127,209,165,.6);animation:pcPulse 2.2s ease-out infinite}
@keyframes pcPulse{70%{box-shadow:0 0 0 10px rgba(127,209,165,0)}100%{box-shadow:0 0 0 0 rgba(127,209,165,0)}}
.pc-opt{transition:border-color .25s,background .25s,transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s}
.pc-opt:hover{transform:translateY(-2px)}
.pc-day{transition:background .25s,color .25s,transform .3s cubic-bezier(.22,1.4,.36,1)}.pc-day:hover{transform:translateY(-2px)}.pc-day[aria-pressed=true]{transform:scale(1.06)}
.pc-cap{display:block}.pc-cap::first-letter{text-transform:uppercase}
.pc-opt[aria-pressed=true]{border-color:${INK}!important;background:#fff!important;box-shadow:0 18px 40px -28px rgba(22,23,26,.55)}
.pc-radio{width:22px;height:22px;border-radius:50%;border:1.5px solid #c9cace;display:grid;place-items:center;flex-shrink:0;transition:all .3s cubic-bezier(.22,1.4,.36,1)}
.pc-opt[aria-pressed=true] .pc-radio{background:${INK};border-color:${INK};transform:scale(1.08)}
.pc-field{height:54px;border-radius:16px;border:1px solid #dcdde0;padding:0 16px;font:inherit;font-size:17px;color:${INK};background:rgba(255,255,255,.9);width:100%;box-sizing:border-box;transition:border-color .2s,box-shadow .25s}
.pc-field:focus{outline:none;border-color:${INK};box-shadow:0 0 0 4px rgba(22,23,26,.07)}
.pc-btn{height:50px;padding:0 22px;border-radius:999px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s,background .2s}
.pc-btn:active{transform:scale(.97)}
.pc-btn.dark{border:0;background:${INK};color:#fff;box-shadow:0 14px 30px -16px rgba(22,23,26,.8)}
.pc-btn.dark:hover{transform:translateY(-2px);box-shadow:0 20px 36px -16px rgba(22,23,26,.85)}
.pc-btn.light{border:1px solid rgba(22,23,26,.1);background:rgba(255,255,255,.8);color:${INK}}
.pc-btn.light:hover{background:#fff}
.pc-chip{font-size:13px;border-radius:999px;padding:7px 13px;display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.7);border:1px solid rgba(22,23,26,.07);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.pc-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.pc-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.pc-2{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:start}
.pc-hero{display:grid;grid-template-columns:1.25fr 1fr;gap:40px;align-items:center}
.pc-ask{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;align-items:start}
.pc-live{position:sticky;top:24px}.pc-live-m{display:none}
@media (max-width:900px){.pc-grid4{grid-template-columns:repeat(2,minmax(0,1fr))}.pc-grid3,.pc-2,.pc-hero,.pc-ask{grid-template-columns:1fr}.pc-live{display:none}.pc-live-m{display:flex}.pc-sample{max-width:420px}}
@media (max-width:900px){.pc-span2{grid-column:span 2}}
@media (max-width:440px){.pc-wrap{padding:16px 16px 36px}.pc-grid4{gap:10px}.pc-tile{padding:16px!important}.pc-tile .pc-tv{font-size:24px!important}}
@media (prefers-reduced-motion:reduce){.pc *,.pc *::before,.pc *::after{animation:none!important;transition:none!important}}
@media print{.pc-sky,.pc-noprint{display:none!important}.pc-wrap{padding:0;max-width:none}.pc-glass{background:#fff;box-shadow:none;border:1px solid ${LINE};-webkit-backdrop-filter:none;backdrop-filter:none}.pc *{animation:none!important}.pc-dark{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@media print{
.pc{min-height:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pc *,.pc *::before,.pc *::after{transition:none!important}
.pc-glass{background:#fff!important;box-shadow:none!important;border:1px solid ${LINE}!important;border-radius:16px!important}
.pc-dark{background:${SOFT}!important;color:${INK}!important;box-shadow:none!important;border-radius:16px!important}
.pc-dark::before,.pc-sheen::after{display:none!important}
.pc-dark .pc-dm{color:${MUTED}!important}
.pc-dark .pc-dg{color:${GREEN}!important}
.pc-kick{text-transform:none!important;letter-spacing:0!important}
.pc button[aria-pressed=true]:not(.pc-opt){background:${SOFT}!important;color:${INK}!important}
}
`;

function Sky({ opal }: { opal: boolean }) {
  const o = (style: CSSProperties, cls = '') => <div className={`pc-orb ${cls}`} style={style} />;
  return (
    <div className="pc-sky" aria-hidden>
      {o({ left: -180, top: -200, width: 620, height: 620, background: opal ? 'radial-gradient(circle, rgba(127,209,165,.55), rgba(127,209,165,0) 70%)' : 'radial-gradient(circle, rgba(253,230,178,.85), rgba(254,205,211,.45) 45%, rgba(255,255,255,0) 72%)' })}
      {o({ right: -220, top: '28%', width: 660, height: 660, background: 'radial-gradient(circle, rgba(221,214,254,.7), rgba(186,230,253,.45) 45%, rgba(255,255,255,0) 72%)' }, 'b')}
      {o({ left: '22%', bottom: -260, width: 600, height: 600, background: 'radial-gradient(circle, rgba(167,243,208,.6), rgba(254,243,199,.4) 45%, rgba(255,255,255,0) 72%)' }, 'c')}
    </div>);
}

function CountUp({ v, fmt, dur = 1200 }: { v: number | null | undefined; fmt: (n: number) => string; dur?: number }) {
  const [x, setX] = useState(0); const from = useRef(0);
  useEffect(() => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setX(v); from.current = v; return; }
    const a = from.current, t0 = performance.now(); let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 4); const cur = a + (v - a) * e; setX(cur); from.current = cur; if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [v, dur]);
  if (v === null || v === undefined || !Number.isFinite(v)) return <>—</>;
  return <>{fmt(x)}</>;
}

type Field = { k: string; label: Key; unit?: '$' | '%' | 'h' | 'min' | 'n'; where?: Key; help?: 'sales' | 'tips'; bool?: boolean };
type Step = { id: string; q: Key; sub?: Key; where?: Key; fields?: Field[]; more?: Field[]; custom?: 'how' | 'hours' | 'offerType' };

const get = (s: any, path: string) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), s);
const set = (s: CalcState, path: string, v: any): CalcState => { const c: any = structuredClone(s); const ks = path.split('.'); let o = c; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; return c; };
const COMMISH: PayType[] = ['commission', 'hourly_commission', 'greater_of', 'draw', 'split'];

function payFields(t: PayType, prefix = ''): Field[] {
  const f = (k: string, label: Key, unit: Field['unit'], extra: Partial<Field> = {}): Field => ({ k: prefix + k, label, unit, ...extra });
  const sales = prefix ? [] : [f('sales', 'salesWeek', '$', { where: 'salesWhere', help: 'sales' })];
  switch (t) {
    case 'hourly': case 'tips': return [f('rate', 'rateLabel', '$')];
    case 'commission': return [f('pct', 'pctLabel', '%'), ...sales];
    case 'hourly_commission': return [f('rate', 'rateLabel', '$'), f('pct', 'pctLabel', '%'), ...sales];
    case 'greater_of': return [f('rate', 'rateLabel', '$'), f('pct', 'pctLabel', '%'), ...sales];
    case 'salary': return [f('salary', 'salaryLabel', '$')];
    case 'split': return [f('rate', 'deskRateLabel', '$'), f('deskPerWeek', 'deskHoursLabel', 'h'), f('pct', 'pctLabel', '%'), ...sales];
    case 'draw': return [f('pct', 'pctLabel', '%'), f('drawPerWeek', 'drawLabel', '$'), ...(prefix ? [] : [f('drawBack', 'drawBack', 'n', { bool: true })]), ...sales];
  }
}
/** Three questions to a first answer; everything else is on the answer page ("Make it more accurate"). */
function stepsFor(s: CalcState): Step[] {
  const hours: Step = { id: 'hours', q: 'qHoursWeek', sub: 'qHoursSub', custom: 'hours' };
  const tips: Field = { k: 'tips', label: 'tipsWeek', unit: '$', help: 'tips', where: 'tipsWhere' };
  if (s.mode === 'self') return [hours,
    { id: 'selfSales', q: 'qPayWeek', sub: 'qPayWeekSub', fields: [{ k: 'sales', label: 'selfSalesWeek', unit: '$', help: 'sales', where: 'salesWhere' }, tips] },
    { id: 'selfCosts', q: 'qSelfCosts', fields: [{ k: 'self.spacePerWeek', label: 'spaceLabel', unit: '$' }, { k: 'self.suppliesPct', label: 'suppliesLabel', unit: '%' }, { k: 'self.otherMonthly', label: 'otherLabel', unit: '$' }],
      more: [{ k: 'self.cardPct', label: 'cardLabel', unit: '%' }, { k: 'self.unpaidWeeks', label: 'unpaidLabel', unit: 'n' }] }];
  const commish = COMMISH.includes(s.payType);
  const list: Step[] = [
    { id: 'how', q: 'qPayType', custom: 'how' }, hours,
    { id: 'pay', q: 'qPayWeek', sub: 'qPayWeekSub', fields: [...payFields(s.payType), ...(s.payType === 'salary' ? [] : [tips])],
      more: [...(commish ? [{ k: 'retailPct', label: 'retailPctLabel', unit: '%' } as Field, { k: 'retailSales', label: 'retailWeek', unit: '$' } as Field] : []), { k: 'paid', label: 'paidWeek', unit: '$', where: 'paidWhere' }, { k: 'bonus', label: 'bonusWeek', unit: '$' }, ...(s.payType === 'salary' ? [tips] : []), ...(commish ? [{ k: 'clawback', label: 'clawbackWeek', unit: '$' } as Field] : [])] },
  ];
  if (s.mode === 'offer') list.push({ id: 'offer', q: 'qOffer', sub: 'offerSub', custom: 'offerType' });
  return list;
}


const card: CSSProperties = { padding: 22, display: 'flex', flexDirection: 'column', gap: 10 };
const In = ({ d = 0, children, className = '', style }: { d?: number; children: ReactNode; className?: string; style?: CSSProperties }) => <div className={`pc-in ${className}`} style={{ ['--d' as any]: `${d}s`, ...style }}>{children}</div>;

function Num({ value, onChange, unit, ariaLabel, big }: { value: number | null; onChange: (v: number | null) => void; unit?: Field['unit']; ariaLabel: string; big?: boolean }) {
  const [txt, setTxt] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => { const cur = txt === '' ? null : Number(txt); if (cur !== value) setTxt(value === null || value === undefined ? '' : String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const pre = unit === '$' ? '$' : ''; const post = unit === '%' ? '%' : unit === 'h' ? 'h' : unit === 'min' ? 'min' : '';
  return (
    <div style={{ position: 'relative' }}>
      {pre && <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: MUTED, fontSize: big ? 22 : 17 }}>{pre}</span>}
      <input className="pc-field" aria-label={ariaLabel} inputMode="decimal" value={txt} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); setTxt(v); onChange(v === '' || v === '.' ? null : Number(v)); }}
        style={{ paddingLeft: pre ? (big ? 34 : 30) : 16, paddingRight: post ? 50 : 16, ...(big ? { height: 64, fontSize: 26, fontWeight: 300 } : {}) }} />
      {post && <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: MUTED }}>{post}</span>}
    </div>);
}

function Helper({ kind, dpw, lang, t, onUse }: { kind: 'sales' | 'tips'; dpw: number; lang: Lang; t: T; onUse: (v: number) => void }) {
  const [a, setA] = useState<number | null>(null); const [b, setB] = useState<number | null>(null);
  const total = kind === 'sales' ? (a || 0) * (b || 0) : (a || 0) * dpw;
  const L = { en: kind === 'sales' ? ['Customers a week', 'Average sale'] : ['Tips on a usual day', ''], es: kind === 'sales' ? ['Clientes a la semana', 'Venta promedio'] : ['Propinas en un día normal', ''], vi: kind === 'sales' ? ['Số khách mỗi tuần', 'Trung bình mỗi khách'] : ['Tip một ngày bình thường', ''] }[lang];
  return (
    <In className="" style={{ background: 'rgba(245,245,247,.85)', borderRadius: 18, padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: kind === 'sales' ? '1fr 1fr' : '1fr', gap: 8 }}>
        <label style={{ fontSize: 13, color: MUTED, display: 'grid', gap: 4 }}>{L[0]}<Num value={a} onChange={setA} unit={kind === 'sales' ? 'n' : '$'} ariaLabel={L[0]} /></label>
        {kind === 'sales' && <label style={{ fontSize: 13, color: MUTED, display: 'grid', gap: 4 }}>{L[1]}<Num value={b} onChange={setB} unit="$" ariaLabel={L[1]} /></label>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 300 }}>= <CountUp v={total} fmt={(n) => money(n)} dur={500} /></span>
        <button type="button" disabled={!total} onClick={() => onUse(Math.round(total))} className="pc-btn dark" style={{ height: 40, fontSize: 14, opacity: total ? 1 : 0.35 }}>{t('useThis')}</button>
      </div>
    </In>);
}

const norm = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Line of work (searchable) and state; picking a state fills in its minimum wage. */
function AboutWork({ s, setS, t, occTitle, title = true }: { s: CalcState; setS: (f: (x: CalcState) => CalcState) => void; t: T; occTitle: (soc: string) => string; title?: boolean }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => { const n = norm(q.trim()); if (!n) return []; return OCCUPATIONS.map((o) => ({ soc: o.soc, title: occTitle(o.soc) })).filter((o) => norm(o.title).includes(n) || n.split(/\s+/).every((w) => norm(o.title).includes(w))).slice(0, 6); }, [q, occTitle]);
  const st = s.state; const sw = st ? STATE_MIN_WAGE[st] : null; const stName = US_STATES.find(([k]) => k === st)?.[1] || st;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {title && <div className="pc-kick" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED }}>{t('aboutWork')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          {s.soc ? (
            <div className="pc-field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 15 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{occTitle(s.soc)}</span>
              <button type="button" aria-label="Clear" onClick={() => setS((x) => ({ ...x, soc: '' }))} style={{ border: 0, background: 'none', cursor: 'pointer', color: MUTED, display: 'grid', placeItems: 'center' }}><X size={16} /></button>
            </div>
          ) : (<>
            <Search size={16} style={{ position: 'absolute', left: 16, top: 19, color: MUTED }} />
            <input className="pc-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchJob')} aria-label={t('searchJob')} style={{ paddingLeft: 42, fontSize: 15 }} />
            {q.trim() && (
              <div className="pc-glass pc-in" style={{ position: 'absolute', left: 0, right: 0, top: 58, zIndex: 5, padding: 6, borderRadius: 18, display: 'grid', gap: 2, background: 'rgba(255,255,255,.96)' }}>
                {matches.length ? matches.map((m) => <button key={m.soc} type="button" onClick={() => { setS((x) => ({ ...x, soc: m.soc })); setQ(''); }} style={{ textAlign: 'left', border: 0, background: 'none', padding: '10px 12px', borderRadius: 12, font: 'inherit', fontSize: 14.5, cursor: 'pointer', color: INK }} onMouseEnter={(e) => (e.currentTarget.style.background = SOFT)} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>{m.title}</button>)
                  : <div style={{ padding: '10px 12px', fontSize: 13.5, color: MUTED }}>{t('noMatch')}</div>}
              </div>)}
          </>)}
        </div>
        <select className="pc-field" aria-label={t('stateLabel')} value={st} style={{ fontSize: 15, color: st ? INK : MUTED }} onChange={(e) => { const v = e.target.value; setS((x) => ({ ...x, state: v, minWage: v ? minWageFor(v) : x.minWage })); }}>
          <option value="">{t('stateLabel')}</option>{US_STATES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {st && s.mode !== 'self' && <div style={{ fontSize: 13, color: MUTED }}>{t('minWageIn', { s: stName, v: hr(s.minWage) })} {sw?.note || ''}</div>}
    </div>);
}

const TIME_TYPES: PayType[] = ['hourly', 'salary', 'tips', 'hourly_commission', 'greater_of', 'split'];
const SHARE_TYPES: PayType[] = ['commission', 'draw', 'hourly_commission', 'greater_of', 'split'];
/** How you're paid, as two yes/no questions; the rarer setups only appear when they fit. */
function HowPaid({ s, up, t, picked, setPicked }: { s: CalcState; up: (k: string, v: any) => void; t: T; picked: { time: boolean | null; share: boolean | null }; setPicked: (p: { time: boolean | null; share: boolean | null }) => void }) {
  const label: Record<PayType, string> = { hourly: t('ptHourly'), salary: t('ptSalary'), tips: t('ptTips'), commission: t('ptJustCommission'), draw: t('ptDraw'), hourly_commission: t('ptHourlyCommission'), greater_of: t('ptGreater'), split: t('ptSplit') };
  const { time, share } = picked;
  const opts: PayType[] | null = time === null || share === null ? null : time && share ? ['hourly_commission', 'split', 'greater_of'] : time ? ['hourly', 'salary', 'tips'] : share ? ['commission', 'draw'] : ['hourly', 'commission', 'hourly_commission', 'split', 'greater_of', 'salary', 'draw', 'tips'];
  const answer = (k: 'time' | 'share', v: boolean) => { const p = { ...picked, [k]: v }; setPicked(p);
    if (p.time !== null && p.share !== null) { const o: PayType[] = p.time && p.share ? ['hourly_commission', 'split', 'greater_of'] : p.time ? ['hourly', 'salary', 'tips'] : p.share ? ['commission', 'draw'] : []; if (o.length && !o.includes(s.payType)) up('payType', o[0]); } };
  const yn = (k: 'time' | 'share', q: Key) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 0', borderTop: `1px solid rgba(22,23,26,.07)` }}>
      <span style={{ fontSize: 16, fontWeight: 500, flex: '1 1 260px', lineHeight: 1.4 }}>{t(q)}</span>
      <span style={{ display: 'flex', gap: 4, background: 'rgba(22,23,26,.05)', borderRadius: 999, padding: 4 }}>
        {([true, false] as const).map((v) => <button key={String(v)} type="button" aria-pressed={picked[k] === v} onClick={() => answer(k, v)} style={{ border: 0, borderRadius: 999, height: 40, minWidth: 64, padding: '0 18px', font: 'inherit', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', transition: 'all .25s', background: picked[k] === v ? INK : 'transparent', color: picked[k] === v ? '#fff' : MUTED }}>{v ? t('yes') : t('no')}</button>)}
      </span>
    </div>);
  return (
    <div style={{ display: 'grid', gap: 0 }}>
      {yn('time', 'qHasTime')}{yn('share', 'qHasShare')}
      {opts && (
        <div className="pc-in" style={{ display: 'grid', gap: 10, paddingTop: 14, borderTop: `1px solid rgba(22,23,26,.07)` }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: MUTED }}>{opts.length > 3 ? t('ptSomethingElse') : t('whichOne')}</div>
          <Choice value={s.payType} options={opts.map((k) => [k, label[k]] as [PayType, string])} onPick={(v) => up('payType', v)} />
        </div>)}
    </div>);
}

/** Days as taps, hours as a stepper: most people never open the keyboard. */
function HoursPicker({ s, up, t }: { s: CalcState; up: (k: string, v: any) => void; t: T }) {
  const d = Number(s.daysPerWeek) || 0, h = Number(s.hoursPerDay) || 0; const step = (v: number) => up('hoursPerDay', Math.max(0, Math.min(16, Math.round((h + v) * 2) / 2)));
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="pc-cap" style={{ fontSize: 14, fontWeight: 600 }}>{t('daysAWeek')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} type="button" aria-pressed={d === n} onClick={() => up('daysPerWeek', n)} className="pc-day" style={{ height: 52, borderRadius: 16, border: `1px solid rgba(22,23,26,.1)`, background: d === n ? INK : 'rgba(255,255,255,.7)', color: d === n ? '#fff' : INK, font: 'inherit', fontSize: 18, fontWeight: 600, cursor: 'pointer' }}>{n}</button>)}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="pc-cap" style={{ fontSize: 14, fontWeight: 600 }}>{t('hoursADay')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" aria-label="-" onClick={() => step(-0.5)} className="pc-btn light" style={{ width: 54, height: 54, padding: 0, justifyContent: 'center' }}><Minus size={20} /></button>
          <div style={{ width: 110 }}><Num value={s.hoursPerDay} onChange={(v) => up('hoursPerDay', v === null ? null : Math.min(24, v))} unit="n" ariaLabel={t('hoursADay')} /></div>
          <button type="button" aria-label="+" onClick={() => step(0.5)} className="pc-btn light" style={{ width: 54, height: 54, padding: 0, justifyContent: 'center' }}><Plus size={20} /></button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'clamp(40px, 6vw, 56px)', fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1 }}><CountUp v={d * h} fmt={(n) => (Math.round(n * 2) / 2).toLocaleString('en-US')} dur={500} /></span>
        <span style={{ fontSize: 16, color: MUTED }}>{t('hoursWeekTotal', { h: '' }).replace(/^=\s*/, '').trim()}</span>
      </div>
    </div>);
}

export default function PayCalculator() {
  const [lang, setLang] = useState<Lang>('en'); const [brand, setBrand] = useState<'' | 'opal'>('');
  const [s, setS] = useState<CalcState>(blank('job')); const [screen, setScreen] = useState<'start' | 'step' | 'result'>('start'); const [i, setI] = useState(0);
  const [help, setHelp] = useState<string | null>(null); const [copied, setCopied] = useState(false); const [dir, setDir] = useState(1);
  const [picked, setPicked] = useState<{ time: boolean | null; share: boolean | null }>({ time: null, share: null });
  const t: T = (k, v) => tr(lang, k, v);

  useEffect(() => {
    const q = new URLSearchParams(location.search); const b = q.get('brand') === 'opal' ? 'opal' : ''; setBrand(b);
    const h = new URLSearchParams(location.hash.replace(/^#/, '')); const l = (h.get('l') || q.get('lang') || navigator.language || 'en').slice(0, 2) as Lang;
    if (['en', 'es', 'vi'].includes(l)) setLang(l);
    const code = h.get('s'); const st = code ? decodeState(code) : null;
    if (st) { setS(st); setScreen('result'); } else if (b === 'opal') setS((x) => ({ ...x, soc: '39-5092' }));
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const steps = useMemo(() => stepsFor(s), [s]); const step = steps[Math.min(i, steps.length - 1)];
  const live = useMemo(() => (screen === 'step' ? compute(s) : null), [s, screen]);
  const r: Result | null = useMemo(() => (screen === 'result' ? compute(s) : null), [s, screen]);
  const up = (path: string, v: any) => setS((x) => set(x, path, v));
  const top = () => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); } };
  const begin = (m: Mode) => { setS((x) => ({ ...blank(m), soc: x.soc, state: x.state, minWage: x.minWage })); setPicked({ time: null, share: null }); setI(0); setDir(1); setScreen('step'); top(); };
  const go = (n: number) => { setHelp(null); setDir(n >= i ? 1 : -1); if (n >= steps.length) { setScreen('result'); top(); return; } if (n < 0) { setScreen('start'); return; } setI(n); top(); };
  const isEst = s.est.includes(step?.id); const toggleEst = () => setS((x) => ({ ...x, est: isEst ? x.est.filter((e) => e !== step.id) : [...x.est, step.id] }));
  const dunno = () => { for (const f of [...(step.fields || []), ...(step.more || [])]) if (!f.bool && f.k !== 'self.cardPct') up(f.k, null); go(i + 1); };
  const copyLink = async () => { const url = `${location.origin}${location.pathname}${brand ? '?brand=opal' : ''}#s=${encodeState(s)}&l=${lang}`; try { await navigator.clipboard.writeText(url); } catch { window.prompt('', url); } setCopied(true); setTimeout(() => setCopied(false), 2500); };
  const occTitle = (soc: string) => (lang === 'en' ? OCCUPATIONS.find((o) => o.soc === soc)?.title : OCC_TITLES[lang][soc]) || soc;
  const est = (id: string) => (s.est.includes(id) ? <span style={{ fontSize: 11.5, color: AMBER, fontWeight: 600, marginLeft: 6 }}>{t('estMark')}</span> : null);
  const hasPay = s.mode === 'self' ? Number(s.sales) > 0 : [s.rate, s.salary, s.sales, s.paid, s.tips, s.drawPerWeek].some((v) => Number(v) > 0);
  const liveHr = live && hasPay && live.hours > 0 && live.gross > 0 ? (s.mode === 'self' ? live.afterCosts ?? live.perHour : live.perHour) : null;

  const header = (
    <div className="pc-noprint pc-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button type="button" onClick={() => setScreen('start')} style={{ display: 'flex', alignItems: 'baseline', gap: 10, border: 0, background: 'none', padding: 0, font: 'inherit', color: INK, cursor: 'pointer' }}>
        {brand === 'opal' ? <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '.02em' }}>Opal <span style={{ fontWeight: 300, letterSpacing: '.18em', fontSize: 12 }}>NAIL ACADEMY</span></span>
          : <span style={{ fontSize: 19, fontWeight: 300, letterSpacing: '-0.02em' }}>Clarity<span style={{ fontWeight: 600 }}>Flow</span></span>}
        <span style={{ fontSize: 13, color: MUTED }}>{t('brand')}</span>
      </button>
      <div role="group" aria-label="Language" className="pc-chip" style={{ padding: 4, gap: 2 }}>
        {LANGS.map(([k, name]) => <button key={k} type="button" onClick={() => setLang(k)} aria-pressed={lang === k} style={{ border: 0, borderRadius: 999, padding: '7px 13px', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .3s', background: lang === k ? INK : 'transparent', color: lang === k ? '#fff' : MUTED }}>{name}</button>)}
      </div>
    </div>);
  const footer = (
    <div style={{ borderTop: `1px solid rgba(22,23,26,.08)`, paddingTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13.5, color: MUTED }}>
      <span>{t('bizCta')}</span>
      <a href="/" style={{ color: INK, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>{t('bizSee')}<ArrowRight size={15} /></a>
      <span style={{ width: '100%', fontSize: 12 }}>{t('usStates')} {t('estimateNote')}</span>
    </div>);

  return (
    <div className="pc">
      <style>{CSS}</style>
      <Sky opal={brand === 'opal'} />
      <div className="pc-wrap">
        {header}
        {screen === 'start' && <Start t={t} begin={begin} />}
        {screen === 'step' && step && (
          <div className="pc-ask">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(22,23,26,.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${((i + 1) / steps.length) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${INK}, #3b3d44)`, borderRadius: 999, transition: 'width .8s cubic-bezier(.22,1,.36,1)' }} />
                </div>
                <span style={{ fontSize: 13, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{t('stepOf', { n: i + 1, t: steps.length })}</span>
              </div>
              <div key={step.id} className="pc-glass pc-in" style={{ ...card, padding: 'clamp(20px, 4vw, 34px)', gap: 20, ['--d' as any]: '0s', transformOrigin: dir > 0 ? 'left' : 'right' }}>
                <div>
                  <h1 className="pc-h1" style={{ fontSize: 'clamp(28px, 4.4vw, 40px)' }}>{t(step.q)}</h1>
                  {step.sub && <p style={{ margin: '10px 0 0', fontSize: 15.5, color: MUTED, lineHeight: 1.55, maxWidth: 560 }}>{t(step.sub)}</p>}
                </div>
                <StepBody step={step} s={s} up={up} setS={setS} t={t} lang={lang} help={help} setHelp={setHelp} occTitle={occTitle} picked={picked} setPicked={setPicked} />
                {step.where && <details style={{ background: 'rgba(245,245,247,.8)', borderRadius: 16, padding: '13px 16px', fontSize: 14 }}><summary style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none' }}><Compass size={16} />{t('whereFind')}</summary><div style={{ marginTop: 8, color: MUTED, lineHeight: 1.55 }}>{t(step.where)}</div></details>}
                {(step.fields || step.custom === 'hours') && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" onClick={toggleEst} aria-pressed={isEst} className="pc-btn light" style={{ height: 38, fontSize: 13.5, padding: '0 14px', background: isEst ? '#fff7ed' : undefined, borderColor: isEst ? AMBER : undefined, color: isEst ? AMBER : INK }}>{isEst && <Check size={14} />}{t('estimate')}</button>
                    {step.fields && <button type="button" onClick={dunno} className="pc-btn light" style={{ height: 38, fontSize: 13.5, padding: '0 14px' }}><HelpCircle size={14} />{t('idk')}</button>}
                  </div>)}
              </div>
              {liveHr !== null && <div className="pc-live-m pc-dark pc-sheen pc-in" style={{ padding: '14px 18px', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span className="pc-dm" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c9cace', position: 'relative' }}><span className="pc-dot" />{t('live')}</span>
                <span style={{ fontSize: 24, fontWeight: 300, position: 'relative' }}><CountUp v={liveHr} fmt={hr} dur={600} /></span>
              </div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <button type="button" onClick={() => go(i - 1)} className="pc-btn light"><ArrowLeft size={16} />{t('back')}</button>
                {i >= 2 && i < steps.length - 1 && <button type="button" onClick={() => go(steps.length)} style={{ border: 0, background: 'none', font: 'inherit', fontSize: 14, fontWeight: 600, color: INK, textDecoration: 'underline', textUnderlineOffset: 4, cursor: 'pointer', padding: '0 4px', textAlign: 'center' }}>{t('seeSoFar')}</button>}
                <button type="button" onClick={() => go(i + 1)} className="pc-btn dark">{i === steps.length - 1 ? t('seeAnswer') : t('next')}<ArrowRight size={16} /></button>
              </div>
              <div style={{ fontSize: 12.5, color: MUTED, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}><Lock size={13} />{t('chipPrivate')} · {t('usStates')}</div>
            </div>
            <aside className="pc-live">
              <div className="pc-dark pc-sheen" style={{ ...card, padding: 26, gap: 8 }}>
                <span className="pc-dm" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c9cace', position: 'relative' }}><span className="pc-dot" />{t('live')}</span>
                {liveHr !== null && live ? (<div style={{ position: 'relative', display: 'grid', gap: 8 }}>
                  <div className="pc-dm" style={{ fontSize: 13, color: '#c9cace' }}>{t('perHourAllIn')}</div>
                  <div style={{ fontSize: 52, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1 }}><CountUp v={liveHr} fmt={hr} dur={700} /></div>
                  {s.mode !== 'self' && live.gross !== live.payNoTips && <div className="pc-dg" style={{ fontSize: 13, color: MINT }}>{t('withoutTips', { v: hr(live.perHourNoTips) })}</div>}
                  <div className="pc-dm" style={{ fontSize: 13, color: '#c9cace' }}>{t('paidMonth', { v: money(live.monthBIT) })}</div>
                  {live.market && <LiveRange r={live} head={liveHr} t={t} />}
                </div>) : <div className="pc-dm" style={{ position: 'relative', fontSize: 15, color: '#c9cace', lineHeight: 1.5 }}>{t('liveEmpty')}</div>}
                <div className="pc-dm" style={{ position: 'relative', fontSize: 12.5, color: '#9a9ca3', marginTop: 6 }}>{t('hoursWeekTotal', { h: ((Number(s.daysPerWeek) || 0) * (Number(s.hoursPerDay) || 0)).toLocaleString('en-US') })}</div>
              </div>
            </aside>
          </div>)}
        {screen === 'result' && r && <Answer s={s} r={r} t={t} lang={lang} up={up} setS={setS} est={est} occTitle={occTitle} copyLink={copyLink} copied={copied} change={() => { setI(0); setScreen('step'); top(); }} />}
        {footer}
      </div>
    </div>);
}

function LiveRange({ r, head, t }: { r: Result; head: number; t: T }) {
  const m = r.market!; const max = Math.max(m.high || m.median * 1.6, head) * 1.08; const p = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
      <div style={{ position: 'relative', height: 22 }}>
        <div style={{ position: 'absolute', inset: '9px 0', borderRadius: 999, background: 'rgba(255,255,255,.12)' }} />
        {m.low !== null && m.high !== null && <div style={{ position: 'absolute', top: 9, height: 4, left: p(m.low), width: `calc(${p(m.high)} - ${p(m.low)})`, borderRadius: 999, background: 'rgba(255,255,255,.35)' }} />}
        <div style={{ position: 'absolute', top: 4, left: p(m.median), width: 2, height: 14, background: '#c9cace', borderRadius: 1 }} />
        <div style={{ position: 'absolute', top: 2, left: `calc(${p(head)} - 9px)`, width: 18, height: 18, borderRadius: '50%', background: MINT, boxShadow: '0 0 0 4px rgba(127,209,165,.25)', transition: 'left .7s cubic-bezier(.22,1,.36,1)' }} />
      </div>
      <div className="pc-dm" style={{ fontSize: 12.5, color: '#c9cace' }}>{t('typical')}: {hr(m.median)} · {Math.round((head / m.median) * 100)}% {t('ofTypical')}</div>
    </div>);
}

function Start({ t, begin }: { t: T; begin: (m: Mode) => void }) {
  const modes: [Mode, Key, Key, typeof Briefcase][] = [['job', 'modeJob', 'modeJobSub', Briefcase], ['self', 'modeSelf', 'modeSelfSub', Store], ['offer', 'modeOffer', 'modeOfferSub', Scale]];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
      <div className="pc-hero" style={{ paddingTop: 'clamp(8px, 4vw, 40px)' }}>
        <div>
          <In d={0.05}><h1 className="pc-h1" style={{ fontSize: 'clamp(38px, 6.6vw, 70px)' }}>{t('title')}</h1></In>
          <In d={0.2}><p style={{ fontSize: 'clamp(16px, 1.6vw, 18.5px)', color: MUTED, lineHeight: 1.6, margin: '18px 0 0', maxWidth: 600 }}>{t('lead')}</p></In>
          <In d={0.35} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
            <span className="pc-chip"><Clock size={14} />{t('chipTime')}</span><span className="pc-chip"><Sparkles size={14} />{t('chipNoSignup')}</span><span className="pc-chip"><Lock size={14} />{t('chipPrivate')}</span>
          </In>
        </div>
        <In d={0.45} className="pc-sample"><Sample t={t} /></In>
      </div>
      <In d={0.55}><div className="pc-kick" style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED }}>{t('start')}</div></In>
      <div className="pc-grid3" style={{ marginTop: -18 }}>
        {modes.map(([m, title, sub, Icon], k) => (
          <In key={m} d={0.62 + k * 0.1}>
            <button type="button" onClick={() => begin(m)} className="pc-glass pc-lift" style={{ ...card, width: '100%', height: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: INK, minHeight: 200, gap: 12 }}>
              <span style={{ width: 46, height: 46, borderRadius: 15, display: 'grid', placeItems: 'center', background: k === 0 ? INK : '#fff', color: k === 0 ? '#fff' : INK, border: k === 0 ? 0 : `1px solid ${LINE}` }}><Icon size={21} strokeWidth={1.6} /></span>
              <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{t(title)}</span>
              <span style={{ fontSize: 14.5, color: MUTED, lineHeight: 1.55 }}>{t(sub)}</span>
              <span style={{ marginTop: 'auto', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{t('next')}<ArrowRight size={15} className="pc-go" /></span>
            </button>
          </In>))}
      </div>
      <div className="pc-grid3">
        {([['every', 'everySub'], ['dunno', 'dunnoSub'], ['honest', 'honestSub']] as [Key, Key][]).map(([a, b], k) => (
          <In key={a} d={0.9 + k * 0.08} style={{ padding: '4px 4px', borderTop: `1px solid rgba(22,23,26,.08)`, paddingTop: 16 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600 }}>{t(a)}</div><div style={{ fontSize: 14, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>{t(b)}</div>
          </In>))}
      </div>
    </div>);
}

function Sample({ t }: { t: T }) {
  const rows: [string, number][] = [['$20 / hr', 0.66], ['40%', 0.79], ['$15 / hr or 40%', 0.79], ['Self', 1]];
  return (
    <div className="pc-float">
      <div className="pc-dark pc-sheen" style={{ ...card, padding: 26, gap: 10 }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="pc-dm" style={{ fontSize: 13, color: '#c9cace' }}>{t('perHourAllIn')}</span>
          <span className="pc-dm" style={{ fontSize: 11.5, color: '#c9cace', border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, padding: '3px 9px' }}>{t('sample')}</span>
        </div>
        <div style={{ position: 'relative', fontSize: 'clamp(48px, 6vw, 64px)', fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1 }}><CountUp v={24.6} fmt={hr} dur={1800} /></div>
        <div className="pc-dg" style={{ position: 'relative', fontSize: 13, color: MINT }}>{t('withoutTips', { v: '$19.80' })}</div>
        <div style={{ position: 'relative', height: 22, marginTop: 6 }}>
          <div style={{ position: 'absolute', inset: '9px 0', borderRadius: 999, background: 'rgba(255,255,255,.12)' }} />
          <div className="pc-bar" style={{ position: 'absolute', top: 9, height: 4, left: '24%', width: '50%', borderRadius: 999, background: 'rgba(255,255,255,.35)', ['--d' as any]: '.9s' }} />
          <div style={{ position: 'absolute', top: 4, left: '46%', width: 2, height: 14, background: '#c9cace' }} />
          <div className="pc-pop" style={{ position: 'absolute', top: 2, left: 'calc(62% - 9px)', width: 18, height: 18, borderRadius: '50%', background: MINT, boxShadow: '0 0 0 4px rgba(127,209,165,.25)', ['--d' as any]: '1.5s' }} />
        </div>
        <div style={{ position: 'relative', display: 'grid', gap: 7, marginTop: 6 }}>
          {rows.map(([l, w], k) => (
            <div key={l} className="pc-dm" style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#c9cace' }}>
              <span>{l}</span>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,.08)' }}><div className="pc-bar" style={{ height: '100%', width: `${w * 100}%`, borderRadius: 999, background: k === 3 ? MINT : 'rgba(255,255,255,.45)', ['--d' as any]: `${1.1 + k * 0.12}s` }} /></div>
            </div>))}
        </div>
      </div>
    </div>);
}

function Choice<V extends string>({ value, options, onPick }: { value: V; options: [V, string][]; onPick: (v: V) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
      {options.map(([k, label], n) => (
        <button key={k} type="button" onClick={() => onPick(k)} aria-pressed={value === k} className="pc-opt pc-in"
          style={{ ['--d' as any]: `${0.05 + n * 0.04}s`, textAlign: 'left', padding: '16px 16px', borderRadius: 18, border: `1px solid rgba(22,23,26,.1)`, background: 'rgba(255,255,255,.6)', font: 'inherit', fontSize: 15, fontWeight: 500, color: INK, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="pc-radio">{value === k && <Check size={13} color="#fff" strokeWidth={3} />}</span>{label}
        </button>))}
    </div>);
}

function FieldRow({ f, s, up, t, lang, help, setHelp, big }: { f: Field; s: CalcState; up: (k: string, v: any) => void; t: T; lang: Lang; help: string | null; setHelp: (v: string | null) => void; big?: boolean }) {
  if (f.bool) return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}><input type="checkbox" checked={!!get(s, f.k)} onChange={(e) => up(f.k, e.target.checked)} style={{ width: 20, height: 20, accentColor: INK }} />{t(f.label)}</label>);
  return (
    <div style={{ display: 'grid', gap: 7, alignContent: 'start' }}>
      <label style={{ fontSize: 14, fontWeight: 600 }}>{t(f.label)}</label>
      <Num value={get(s, f.k) ?? null} onChange={(v) => up(f.k, v)} unit={f.unit} ariaLabel={t(f.label)} big={big} />
      {f.where && <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{t(f.where)}</div>}
      {f.help && (help === f.k ? <Helper kind={f.help} dpw={Number(s.daysPerWeek) || 5} lang={lang} t={t} onUse={(v) => { up(f.k, v); setHelp(null); }} />
        : <button type="button" onClick={() => setHelp(f.k)} style={{ justifySelf: 'start', border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 13.5, fontWeight: 600, color: GREEN, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} />{t('helpMe')}</button>)}
    </div>);
}

function StepBody({ step, s, up, setS, t, lang, help, setHelp, occTitle, picked, setPicked }: { step: Step; s: CalcState; up: (k: string, v: any) => void; setS: (f: (x: CalcState) => CalcState) => void; t: T; lang: Lang; help: string | null; setHelp: (v: string | null) => void; occTitle: (soc: string) => string; picked: { time: boolean | null; share: boolean | null }; setPicked: (p: { time: boolean | null; share: boolean | null }) => void }) {
  const types: [PayType, string][] = [['hourly', t('ptHourly')], ['commission', t('ptCommission')], ['hourly_commission', t('ptHourlyCommission')], ['split', t('ptSplit')], ['greater_of', t('ptGreater')], ['salary', t('ptSalary')], ['draw', t('ptDraw')]];
  const fr = (f: Field, big?: boolean) => <FieldRow key={f.k} f={f} s={s} up={up} t={t} lang={lang} help={help} setHelp={setHelp} big={big} />;
  const about = <div style={{ background: 'rgba(245,245,247,.7)', borderRadius: 20, padding: 14 }}><AboutWork s={s} setS={setS} t={t} occTitle={occTitle} /></div>;
  if (step.custom === 'how') return <div style={{ display: 'grid', gap: 18 }}>{about}<HowPaid s={s} up={up} t={t} picked={picked} setPicked={setPicked} /></div>;
  if (step.custom === 'hours') return <div style={{ display: 'grid', gap: 18 }}>{s.mode === 'self' && about}<HoursPicker s={s} up={up} t={t} /></div>;
  if (step.custom === 'offerType') return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Choice value={s.offer.payType} options={types as any} onPick={(v) => up('offer.payType', v)} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>{payFields(s.offer.payType, 'offer.').map((f) => fr(f))}</div>
      <details style={{ borderTop: `1px solid rgba(22,23,26,.07)`, paddingTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none' }}><ChevronDown size={16} />{t('qBenefits')}</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 12 }}>
          {([['offer.ptoDays', 'ptoLabel', 'n'], ['offer.healthMonthly', 'healthLabel', '$'], ['offer.matchPct', 'matchLabel', '%'], ['offer.suppliesMonthly', 'costsMonthly', '$'], ['offer.commuteMin', 'commuteLabel', 'min']] as [string, Key, Field['unit']][]).map(([k, l, u]) => fr({ k, label: l, unit: u }))}
        </div>
      </details>
    </div>);
  const fs = step.fields || []; const hint = step.id === 'pay' && s.soc ? JOB_HINT[s.soc] : null;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {hint && <div className="pc-in" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, background: 'rgba(127,209,165,.14)', borderRadius: 16, padding: '12px 14px' }}><Sparkles size={16} style={{ color: GREEN, flexShrink: 0, marginTop: 2 }} />{t(hint)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: fs.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>{fs.map((f) => fr(f, fs.length === 1))}</div>
      {step.more && step.more.length > 0 && (
        <details style={{ borderTop: `1px solid rgba(22,23,26,.07)`, paddingTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', color: MUTED }}><ChevronDown size={16} />{t('moreDetail')}</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, marginTop: 14 }}>{step.more.map((f) => fr(f))}</div>
        </details>)}
    </div>);
}

function planName(p: Plan, t: T, lang: Lang) {
  if (lang === 'en') return planLabel(p);
  const $ = (n: number) => money(n, n % 1 !== 0);
  switch (p.kind) {
    case 'hourly': return lang === 'es' ? `${$(p.rate || 0)} por hora` : `${$(p.rate || 0)} mỗi giờ`;
    case 'commission': return lang === 'es' ? `${p.pct}% de comisión` : `${p.pct}% hoa hồng`;
    case 'hourly_commission': return lang === 'es' ? `${$(p.rate || 0)} por hora + ${p.pct}%` : `${$(p.rate || 0)} mỗi giờ + ${p.pct}%`;
    case 'greater_of': return lang === 'es' ? `${$(p.rate || 0)} por hora o ${p.pct}%, lo que sea mayor` : `${$(p.rate || 0)} mỗi giờ hoặc ${p.pct}%, cái nào cao hơn`;
    case 'split': return lang === 'es' ? `${$(p.rate || 0)} por hora ${p.split?.hoursPerWeek || 0} h/sem., ${p.pct}% el resto` : `${$(p.rate || 0)}/giờ cho ${p.split?.hoursPerWeek || 0} giờ/tuần, ${p.pct}% phần còn lại`;
    case 'salary': return lang === 'es' ? `${$(p.salary || 0)} al año` : `${$(p.salary || 0)} mỗi năm`;
    case 'draw': return lang === 'es' ? `${p.pct}% con adelanto de ${$(p.draw?.perWeek || 0)}` : `${p.pct}% với ứng trước ${$(p.draw?.perWeek || 0)}`;
    case 'self': return t('modeSelf');
    default: return t('nowPaid');
  }
}

function Answer({ s, r, t, lang, up, setS, est, occTitle, copyLink, copied, change }: { s: CalcState; r: Result; t: T; lang: Lang; up: (k: string, v: any) => void; setS: (f: (x: CalcState) => CalcState) => void; est: (id: string) => any; occTitle: (soc: string) => string; copyLink: () => void; copied: boolean; change: () => void }) {
  const head = s.mode === 'self' ? (r.afterCosts ?? r.perHour) : r.perHour; const a = r.allIn; const m = r.market;
  if (!r.hours) return <div className="pc-glass pc-in" style={card}><div style={{ fontSize: 16 }}>{t('noHours')}</div><button type="button" onClick={change} className="pc-btn dark" style={{ alignSelf: 'start' }}>{t('change')}</button></div>;
  const tiles: [Key, number | null, string][] = [
    ...(s.mode !== 'self' ? [['afterCosts', r.afterCosts, `${money(s.costsMonthly)} ${t('monthly')}`] as [Key, number | null, string]] : []),
    ['commuteCard', a.perHourWithCommute, `+${Math.round(a.commuteHours)} ${t('hoursUnit')} (${s.commuteMin} min)`],
    ['offClockCard', a.perHourWithOffClock, `+${Math.round(a.offClockHours)} ${t('hoursUnit')}`],
    ...(s.mode !== 'self' ? [['benefitsCard', a.perHourWithBenefits, `${money(a.benefits * (30.44 / r.days))} ${t('monthly')}`] as [Key, number | null, string]] : []),
  ].filter(([, v]) => v !== null) as [Key, number | null, string][];
  const max = m ? Math.max(m.high || m.median * 1.6, head || 0) * 1.08 : 1; const pos = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const top = Math.max(1, ...r.rows.map((x) => x.month));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <In d={0} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 13, color: MUTED }}>{t('answer')} · {s.per === 'week' ? t('hoursWeek', { h: ((Number(s.daysPerWeek) || 0) * (Number(s.hoursPerDay) || 0)).toLocaleString('en-US') }) : t('equalsHours', { h: r.hours.toLocaleString('en-US'), w: s.weeks }).replace(/^= /, '')}{est('hours')}</div>
          <h1 className="pc-h1" style={{ fontSize: 'clamp(32px, 5.4vw, 54px)', marginTop: 6 }}>{t('answerTitle', { v: hr(head) })}</h1></div>
        <button type="button" onClick={change} className="pc-btn light pc-noprint"><ArrowLeft size={16} />{t('change')}</button>
      </In>

      <div className="pc-grid4">
        <In d={0.1} className="pc-span2">
          <div className="pc-dark pc-sheen" style={{ ...card, height: '100%', boxSizing: 'border-box' }}>
            <div className="pc-dm" style={{ position: 'relative', fontSize: 13, color: '#c9cace' }}>{t('perHourAllIn')}</div>
            <div style={{ position: 'relative', fontSize: 50, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1 }}><CountUp v={head} fmt={hr} /></div>
            {s.mode !== 'self' && r.gross !== r.payNoTips && <div className="pc-dg" style={{ position: 'relative', fontSize: 13, color: MINT }}>{t('withoutTips', { v: hr(r.perHourNoTips) })}</div>}
            <div className="pc-dm" style={{ position: 'relative', fontSize: 12.5, color: '#c9cace', marginTop: 'auto' }}>{t('paidMonth', { v: money(r.monthBIT) })}</div>
          </div>
        </In>
        {tiles.map(([label, v, sub], k) => (
          <In key={label} d={0.18 + k * 0.08}>
            <div className="pc-glass pc-tile" style={{ ...card, height: '100%', boxSizing: 'border-box' }}>
              <div style={{ fontSize: 13, color: MUTED }}>{t(label)}</div>
              <div className="pc-tv" style={{ fontSize: 32, fontWeight: 300, letterSpacing: '-0.03em' }}><CountUp v={v} fmt={hr} dur={1400} /></div>
              <div style={{ fontSize: 13, color: MUTED, marginTop: 'auto' }}>{sub}</div>
            </div>
          </In>))}
      </div>
      {s.per === 'period' && s.weeks < 8 && <In d={0.4}><div style={{ fontSize: 13.5, color: MUTED, display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={14} />{t('seasonal')}</div></In>}

      {s.mode === 'offer' && r.offer && (
        <div className="pc-2">
          <In d={0.3}>
            <div className="pc-dark pc-sheen" style={{ ...card, padding: 26 }}>
              <div className="pc-dm" style={{ position: 'relative', fontSize: 13, color: '#c9cace' }}>{t('offerAnswer')}</div>
              <div style={{ position: 'relative', fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{Math.abs(r.offer.diff) < 25 ? t('offerSame') : r.offer.diff > 0 ? t('offerMore', { v: money(Math.abs(r.offer.diff)) }) : t('offerLess', { v: money(Math.abs(r.offer.diff)) })}</div>
              <div className="pc-dm" style={{ position: 'relative', fontSize: 13.5, color: '#c9cace' }}>{t('offerAllIn', { a: hr(r.offer.offerHr), b: hr(r.offer.nowHr) })}</div>
              <div className="pc-dg" style={{ position: 'relative', fontSize: 13.5, color: MINT }}>{t('offerPay', { v: money(Math.abs(r.offer.payDiff)), dir: r.offer.payDiff >= 0 ? t('more') : t('less') })}</div>
            </div>
          </In>
          {r.offer.crossOver !== null && <In d={0.4}><div className="pc-glass" style={card}><div style={{ fontSize: 16, lineHeight: 1.5 }}>{t('crossOver', { v: money(r.offer.crossOver) })}</div></div></In>}
        </div>)}

      <In d={0.3} className="pc-noprint"><MoreAccurate s={s} up={up} setS={setS} t={t} lang={lang} occTitle={occTitle} /></In>

      <In d={0.35}>
        <div className="pc-glass" style={{ ...card, gap: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{t('market')}{s.soc ? <span style={{ fontWeight: 400, color: MUTED }}> · {occTitle(s.soc)}</span> : ''}</div>
          {m ? (<>
            <div style={{ position: 'relative', height: 52 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 22, height: 8, borderRadius: 999, background: 'rgba(22,23,26,.06)' }} />
              {m.low !== null && m.high !== null && <div className="pc-bar" style={{ position: 'absolute', left: pos(m.low), width: `calc(${pos(m.high)} - ${pos(m.low)})`, top: 22, height: 8, borderRadius: 999, background: 'linear-gradient(90deg, #d6d7da, #b9bbc0)', ['--d' as any]: '.6s' }} />}
              <div className="pc-pop" style={{ position: 'absolute', left: pos(m.median), top: 14, width: 3, height: 24, borderRadius: 2, background: MUTED, ['--d' as any]: '1s' }} />
              {head !== null && <div className="pc-pop" style={{ position: 'absolute', left: `calc(${pos(head)} - 13px)`, top: 6, width: 26, height: 40, borderRadius: 13, background: INK, boxShadow: '0 10px 24px -10px rgba(22,23,26,.7), 0 0 0 5px rgba(127,209,165,.35)', ['--d' as any]: '1.25s' }} />}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13.5, color: MUTED }}>
              {m.low !== null && <span>{t('lower')}: {hr(m.low)}</span>}<span>{t('typical')}: {hr(m.median)}</span><span style={{ color: INK, fontWeight: 600 }}>{t('you')}: {hr(head)}</span>{m.high !== null && <span>{t('higher')}: {hr(m.high)}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED }}>{t('marketSrc', { y: m.year })} {m.scaled ? t('marketScaled') : ''} <a href={WAGE_SOURCE.url} target="_blank" rel="noreferrer" style={{ color: MUTED }}>bls.gov</a></div>
          </>) : <div style={{ fontSize: 14, color: MUTED }}>{t('pickWork')}</div>}
        </div>
      </In>

      <div className="pc-2">
        <In d={0.45}>
          <div className="pc-glass" style={{ ...card, gap: 4 }}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{t('otherWays')}</div>
            {r.rows.map((row, k) => { const best = r.best?.key === row.key && r.rows.length > 1; return (
              <div key={row.key} style={{ padding: '12px 0', borderBottom: `1px solid rgba(22,23,26,.06)`, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14.5 }}>
                  <span style={{ fontWeight: row.now ? 600 : 400 }}>{row.now ? t('nowPaid') : row.offer ? `${t('offerRow')}: ${planName(row.plan, t, lang)}` : planName(row.plan, t, lang)}
                    {best && <span style={{ marginLeft: 8, fontSize: 11.5, color: GREEN, fontWeight: 600, background: 'rgba(127,209,165,.18)', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{t('mostHere')}</span>}</span>
                  <span style={{ fontWeight: row.now ? 600 : 400, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(row.month)}<span style={{ fontSize: 12, color: MUTED }}> {t('perMonthShort')}</span></span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'rgba(22,23,26,.05)' }}>
                  <div className="pc-bar" style={{ height: '100%', width: `${Math.max(2, (row.month / top) * 100)}%`, borderRadius: 999, background: best ? `linear-gradient(90deg, ${GREEN}, ${MINT})` : row.now ? INK : '#c9cace', ['--d' as any]: `${0.7 + k * 0.1}s` }} />
                </div>
                {row.perHourAllIn !== null && <span style={{ fontSize: 12.5, color: MUTED }}>{t('allInHr', { v: hr(row.perHourAllIn) })}</span>}
              </div>); })}
            {r.breakEven !== null && <div style={{ fontSize: 14, marginTop: 10, lineHeight: 1.5 }}>{t('breakEven', { v: money(r.breakEven) })}</div>}
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{t('sameBasis')}</div>
          </div>
        </In>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {r.asks.length > 0 && <In d={0.55}>
            <div className="pc-glass" style={card}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{t('ask')}</div>
              {r.asks.map((x) => <div key={x.k} style={{ fontSize: 14.5, lineHeight: 1.55, paddingLeft: 14, borderLeft: `2px solid ${x.k === 'askMin' ? AMBER : MINT}` }}>{t(x.k, { v: x.k === 'askCosts' ? money(x.v) : hr(x.v), h: x.h ?? '' })}</div>)}
              <div style={{ fontSize: 12, color: MUTED }}>{t('askNote')}</div>
            </div>
          </In>}
          <In d={0.65} className="pc-noprint">
            <div className="pc-glass" style={{ ...card, background: 'rgba(245,245,247,.75)' }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{t('keep')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" onClick={() => window.print()} className="pc-btn dark"><Printer size={16} />{t('savePdf')}</button>
                <button type="button" onClick={copyLink} className="pc-btn light">{copied ? <Check size={16} /> : <Link2 size={16} />}{copied ? t('copied') : t('copyLink')}</button>
              </div>
              <div style={{ fontSize: 12.5, color: MUTED, display: 'flex', alignItems: 'center', gap: 6 }}><Lock size={13} />{t('linkNote')}</div>
            </div>
          </In>
        </div>
      </div>

      <In d={0.7}>
        <div className="pc-glass" style={card}>
          <label className="pc-noprint" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15.5, fontWeight: 600, cursor: 'pointer' }}><input type="checkbox" checked={s.tax.on} onChange={(e) => up('tax.on', e.target.checked)} style={{ width: 20, height: 20, accentColor: INK }} />{t('taxShow')}</label>
          {s.tax.on && r.tax && (<div className="pc-in" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <select className="pc-field" aria-label="Filing" value={s.tax.filing} onChange={(e) => up('tax.filing', e.target.value as Filing)}><option value="single">{t('filingSingle')}</option><option value="joint">{t('filingJoint')}</option><option value="head">{t('filingHead')}</option></select>
              <Num value={s.tax.statePct} onChange={(v) => up('tax.statePct', v)} unit="%" ariaLabel={t('stateTax')} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{t('takeHome')}</div>
            {([['beforeIT', r.monthBIT], ['fedTax', -r.tax.federal], ['stTax', -r.tax.state]] as [Key, number][]).map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}><span>{t(k)}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v)}</span></div>)}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: `1px solid rgba(22,23,26,.08)`, paddingTop: 10 }}><span style={{ fontSize: 16, fontWeight: 600 }}>{t('takeHomeRow')}</span><span style={{ fontSize: 30, fontWeight: 300, letterSpacing: '-0.03em' }}><CountUp v={r.tax.takeHome} fmt={(n) => money(n)} dur={800} /></span></div>
            <div style={{ fontSize: 12, color: MUTED }}>{t('taxNote', { y: TAX_YEAR })} {t('stateTax')}: {s.tax.statePct ?? 0}%</div>
          </div>)}
        </div>
      </In>

      {s.contractor && (
        <In d={0.8}>
          <div className="pc-glass" style={card}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{t('contractorTitle')}</div>
            <div style={{ fontSize: 13.5, color: MUTED }}>{t('contractorSub')}</div>
            {CONTRACTOR_QUESTIONS.map((q) => (
              <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 14.5, padding: '9px 0', borderBottom: `1px solid rgba(22,23,26,.06)` }}>
                <span>{lang === 'en' ? q.q : CONTRACTOR_Q[lang][q.id]}</span>
                <span style={{ display: 'flex', gap: 4, flexShrink: 0, background: 'rgba(22,23,26,.05)', borderRadius: 999, padding: 3 }}>{([true, false] as const).map((v) => <button key={String(v)} type="button" aria-pressed={s.cq[q.id] === v} onClick={() => setS((x) => ({ ...x, cq: { ...x.cq, [q.id]: v } }))} style={{ border: 0, borderRadius: 999, height: 32, padding: '0 14px', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .25s', background: s.cq[q.id] === v ? INK : 'transparent', color: s.cq[q.id] === v ? '#fff' : MUTED }}>{v ? t('yes') : t('no')}</button>)}</span>
              </div>))}
            {r.contractor.lean && <div className="pc-in" style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{t(r.contractor.lean === 'employee' ? 'leanEmployee' : r.contractor.lean === 'contractor' ? 'leanContractor' : 'leanMixed')}</div>}
            <div style={{ fontSize: 12.5, color: MUTED }}>{t('leanWhy')} {t('askNote')}</div>
          </div>
        </In>)}
    </div>);
}

/** Optional extras on the answer page: each card opens in place and the answer above updates as it's filled in. */
function MoreAccurate({ s, up, setS, t, lang, occTitle }: { s: CalcState; up: (k: string, v: any) => void; setS: (f: (x: CalcState) => CalcState) => void; t: T; lang: Lang; occTitle: (soc: string) => string }) {
  const [open, setOpen] = useState<string | null>(null); const [help, setHelp] = useState<string | null>(null);
  const n = (v: any) => Number(v) > 0; const self = s.mode === 'self';
  const fr = (f: Field) => <FieldRow key={f.k} f={f} s={s} up={up} t={t} lang={lang} help={help} setHelp={setHelp} />;
  const grid = (fs: Field[]) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>{fs.map(fr)}</div>;
  const cards: { id: string; title: Key; sub: Key; has: boolean; body: ReactNode; icon: typeof Briefcase }[] = [
    { id: 'work', title: 'cardWork', sub: 'cardWorkSub', has: !!(s.soc && s.state), icon: Compass,
      body: <div style={{ display: 'grid', gap: 14 }}><AboutWork s={s} setS={setS} t={t} occTitle={occTitle} title={false} />{!self && s.state && grid([{ k: 'minWage', label: 'minWageLabel', unit: '$' }])}</div> },
    ...(!self ? [{ id: 'costs', title: 'cardCosts' as Key, sub: 'cardCostsSub' as Key, has: n(s.costsMonthly), icon: Store, body: grid([{ k: 'costsMonthly', label: 'costsMonthly', unit: '$' }]) },
      { id: 'benefits', title: 'cardBenefits' as Key, sub: 'cardBenefitsSub' as Key, has: n(s.ptoDays) || n(s.healthMonthly) || n(s.matchPct), icon: Sparkles, body: grid([{ k: 'ptoDays', label: 'ptoLabel', unit: 'n' }, { k: 'healthMonthly', label: 'healthLabel', unit: '$' }, { k: 'matchPct', label: 'matchLabel', unit: '%' }]) }] : []),
    { id: 'time', title: 'cardTime', sub: 'cardTimeSub', has: n(s.commuteMin) || n(s.offClockMonthly), icon: Clock, body: grid([{ k: 'commuteMin', label: 'commuteLabel', unit: 'min' }, { k: 'offClockMonthly', label: 'offClockLabel', unit: 'h', where: 'offClockSub' }]) },
    ...(!self ? [{ id: 'detail', title: 'cardDetail' as Key, sub: 'cardDetailSub' as Key, has: n(s.paid) || n(s.bonus), icon: Briefcase, body: grid([{ k: 'paid', label: 'paidWeek', unit: '$', where: 'paidWhere' }, { k: 'bonus', label: 'bonusWeek', unit: '$' }]) },
      { id: 'contractor', title: 'cardContractor' as Key, sub: 'cardContractorSub' as Key, has: s.contractor !== null, icon: Scale,
        body: <Choice value={s.contractor === null ? '' : s.contractor ? 'y' : 'n'} options={[['y', t('yes')], ['n', t('no')]]} onPick={(v) => up('contractor', v === 'y')} /> }] : []),
  ];
  return (
    <div className="pc-glass" style={{ ...card, gap: 4 }}>
      <div style={{ fontSize: 17, fontWeight: 600 }}>{t('moreAccurate')}</div>
      <div style={{ fontSize: 13.5, color: MUTED, marginBottom: 8 }}>{t('moreAccurateSub')}</div>
      {cards.map((c) => { const isOpen = open === c.id; const Icon = c.icon; return (
        <div key={c.id} style={{ borderTop: `1px solid rgba(22,23,26,.07)` }}>
          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 2px', border: 0, background: 'none', font: 'inherit', color: INK, cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0, background: c.has ? 'rgba(127,209,165,.22)' : SOFT, color: c.has ? GREEN : INK, transition: 'all .3s' }}>{c.has ? <Check size={18} strokeWidth={2.4} /> : <Icon size={18} strokeWidth={1.6} />}</span>
            <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 15.5, fontWeight: 600 }}>{t(c.title)}</span><span style={{ display: 'block', fontSize: 13, color: MUTED, marginTop: 2 }}>{c.has ? t('added') : t(c.sub)}</span></span>
            <ChevronDown size={18} style={{ color: MUTED, transition: 'transform .35s cubic-bezier(.22,1,.36,1)', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
          </button>
          {isOpen && <div className="pc-in" style={{ padding: '2px 2px 18px' }}>{c.body}</div>}
        </div>); })}
    </div>);
}
