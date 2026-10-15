'use client';
// The public pay calculator (design canvas "Pay clarity", boards CalcStart, CalcStep, CalcResult, CalcOffer).
// Everything happens in the browser: no sign-up, nothing sent, nothing stored. A private link packs the answers into
// the address after the # (which browsers never send to a server). English, Spanish and Vietnamese. US rules.
// ?brand=opal shows the Opal Nail Academy version.
import { useEffect, useMemo, useState } from 'react';
import { blank, compute, decodeState, encodeState, hoursOf, type CalcState, type Mode, type PayType, type Result } from '@/lib/pay-calc';
import { LANGS, tr, OCC_TITLES, CONTRACTOR_Q, type Lang, type Key } from '@/lib/pay-calc-i18n';
import { OCCUPATIONS, WAGE_SOURCE } from '@/lib/wage-data';
import { CONTRACTOR_QUESTIONS, US_STATES, TAX_YEAR, type Filing } from '@/lib/pay-extras';
import { planLabel, type Plan } from '@/lib/pay-clarity';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', MINT = '#7fd1a5', AMBER = '#b45309';
const money = (n: number | null | undefined, cents = false) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`);
const hr = (n: number | null | undefined) => money(n, true);

type Field = { k: string; label: Key; unit?: '$' | '%' | 'h' | 'min' | 'n'; where?: Key; help?: 'sales' | 'tips'; bool?: boolean };
type Step = { id: string; q: Key; sub?: Key; where?: Key; fields?: Field[]; custom?: 'payType' | 'hours' | 'work' | 'contractor' | 'offerType' };

const get = (s: any, path: string) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), s);
const set = (s: CalcState, path: string, v: any): CalcState => { const c: any = structuredClone(s); const ks = path.split('.'); let o = c; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; return c; };

function payFields(t: PayType, prefix = ''): Field[] {
  const f = (k: string, label: Key, unit: Field['unit'], extra: Partial<Field> = {}): Field => ({ k: prefix + k, label, unit, ...extra });
  const sales = prefix ? [] : [f('sales', 'salesLabel', '$', { where: 'salesWhere', help: 'sales' })];
  switch (t) {
    case 'hourly': case 'tips': return [f('rate', 'rateLabel', '$')];
    case 'commission': return [f('pct', 'pctLabel', '%'), f('retailPct', 'retailPctLabel', '%'), ...sales];
    case 'hourly_commission': return [f('rate', 'rateLabel', '$'), f('pct', 'pctLabel', '%'), ...sales];
    case 'greater_of': return [f('rate', 'rateLabel', '$'), f('pct', 'pctLabel', '%'), ...sales];
    case 'salary': return [f('salary', 'salaryLabel', '$')];
    case 'draw': return [f('pct', 'pctLabel', '%'), f('drawPerWeek', 'drawLabel', '$'), ...(prefix ? [] : [f('drawBack', 'drawBack', 'n', { bool: true })]), ...sales];
  }
}
function stepsFor(s: CalcState): Step[] {
  const hours: Step = { id: 'hours', q: 'qHours', sub: 'qHoursSub', where: 'qHoursWhere', custom: 'hours' };
  const work: Step = { id: 'work', q: 'qWork', sub: 'workSub', custom: 'work' };
  const time: Step = { id: 'time', q: 'qTime', fields: [{ k: 'commuteMin', label: 'commuteLabel', unit: 'min' }, { k: 'offClockMonthly', label: 'offClockLabel', unit: 'h', where: 'offClockSub' }] };
  if (s.mode === 'self') return [hours,
    { id: 'selfSales', q: 'qSelfSales', fields: [{ k: 'sales', label: 'selfSalesLabel', unit: '$', help: 'sales', where: 'salesWhere' }, { k: 'tips', label: 'qTips', unit: '$', help: 'tips', where: 'tipsWhere' }] },
    { id: 'selfCosts', q: 'qSelfCosts', fields: [{ k: 'self.spacePerWeek', label: 'spaceLabel', unit: '$' }, { k: 'self.suppliesPct', label: 'suppliesLabel', unit: '%' }, { k: 'self.cardPct', label: 'cardLabel', unit: '%' }, { k: 'self.otherMonthly', label: 'otherLabel', unit: '$' }, { k: 'self.unpaidWeeks', label: 'unpaidLabel', unit: 'n' }] },
    work, time];
  const commish = ['commission', 'hourly_commission', 'greater_of', 'draw'].includes(s.payType);
  const list: Step[] = [
    { id: 'payType', q: 'qPayType', sub: 'qPayTypeSub', custom: 'payType' }, hours,
    { id: 'pay', q: 'qPay', fields: [...payFields(s.payType), { k: 'paid', label: 'paidLabel', unit: '$', where: 'paidWhere' }, { k: 'bonus', label: 'bonusLabel', unit: '$' }] },
    { id: 'tips', q: 'qTips', sub: 'qTipsSub', where: 'tipsWhere', fields: [{ k: 'tips', label: 'qTips', unit: '$', help: 'tips' }] },
  ];
  if (s.mode === 'offer') list.push({ id: 'offer', q: 'qOffer', sub: 'offerSub', custom: 'offerType' });
  list.push(work,
    { id: 'costs', q: 'qCosts', sub: 'qCostsSub', fields: [{ k: 'costsMonthly', label: 'costsMonthly', unit: '$' }, ...(commish ? [{ k: 'clawback', label: 'clawbackLabel', unit: '$' } as Field] : [])] },
    { id: 'benefits', q: 'qBenefits', where: 'benefitsWhere', fields: [{ k: 'ptoDays', label: 'ptoLabel', unit: 'n' }, { k: 'healthMonthly', label: 'healthLabel', unit: '$' }, { k: 'matchPct', label: 'matchLabel', unit: '%' }] },
    time, { id: 'contractor', q: 'qContractor', custom: 'contractor' });
  return list;
}

const box = { border: `1px solid ${LINE}`, borderRadius: 22, padding: 20, display: 'flex', flexDirection: 'column' as const, gap: 10, background: '#fff' };
const pill = (dark = false) => ({ height: 46, padding: '0 20px', borderRadius: 999, border: dark ? 0 : `1px solid ${LINE}`, background: dark ? INK : '#fff', color: dark ? '#fff' : INK, font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' });
const input = { height: 48, borderRadius: 14, border: `1px solid #d6d7da`, padding: '0 14px', font: 'inherit', fontSize: 16, color: INK, background: '#fff', width: '100%', boxSizing: 'border-box' as const };

function Num({ value, onChange, unit, ariaLabel }: { value: number | null; onChange: (v: number | null) => void; unit?: Field['unit']; ariaLabel: string }) {
  const [txt, setTxt] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => { const cur = txt === '' ? null : Number(txt); if (cur !== value) setTxt(value === null || value === undefined ? '' : String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const pre = unit === '$' ? '$' : ''; const post = unit === '%' ? '%' : unit === 'h' ? 'h' : unit === 'min' ? 'min' : '';
  return (
    <div style={{ position: 'relative' }}>
      {pre && <span style={{ position: 'absolute', left: 14, top: 14, color: MUTED }}>{pre}</span>}
      <input aria-label={ariaLabel} inputMode="decimal" value={txt} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); setTxt(v); onChange(v === '' || v === '.' ? null : Number(v)); }} style={{ ...input, paddingLeft: pre ? 28 : 14, paddingRight: post ? 44 : 14 }} />
      {post && <span style={{ position: 'absolute', right: 14, top: 14, color: MUTED }}>{post}</span>}
    </div>);
}

function Helper({ kind, weeks, dpw, lang, onUse }: { kind: 'sales' | 'tips'; weeks: number; dpw: number; lang: Lang; onUse: (v: number) => void }) {
  const [a, setA] = useState<number | null>(null); const [b, setB] = useState<number | null>(null); const t = (k: Key, v?: any) => tr(lang, k, v);
  const total = kind === 'sales' ? (a || 0) * (b || 0) * weeks : (a || 0) * dpw * weeks;
  const L = { en: kind === 'sales' ? ['Customers a week', 'Average sale'] : ['Tips on a usual day', ''], es: kind === 'sales' ? ['Clientes a la semana', 'Venta promedio'] : ['Propinas en un día normal', ''], vi: kind === 'sales' ? ['Số khách mỗi tuần', 'Trung bình mỗi khách'] : ['Tip một ngày bình thường', ''] }[lang];
  return (
    <div style={{ background: SOFT, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: kind === 'sales' ? '1fr 1fr' : '1fr', gap: 8 }}>
        <label style={{ fontSize: 13, color: MUTED, display: 'grid', gap: 4 }}>{L[0]}<Num value={a} onChange={setA} unit={kind === 'sales' ? 'n' : '$'} ariaLabel={L[0]} /></label>
        {kind === 'sales' && <label style={{ fontSize: 13, color: MUTED, display: 'grid', gap: 4 }}>{L[1]}<Num value={b} onChange={setB} unit="$" ariaLabel={L[1]} /></label>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <span>= {money(total)}</span>
        <button type="button" disabled={!total} onClick={() => onUse(Math.round(total))} style={{ ...pill(true), height: 38, fontSize: 14, opacity: total ? 1 : 0.4 }}>{t('useThis')}</button>
      </div>
    </div>);
}

export default function PayCalculator() {
  const [lang, setLang] = useState<Lang>('en'); const [brand, setBrand] = useState<'' | 'opal'>('');
  const [s, setS] = useState<CalcState>(blank('job')); const [screen, setScreen] = useState<'start' | 'step' | 'result'>('start'); const [i, setI] = useState(0);
  const [help, setHelp] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  const t = (k: Key, v?: Record<string, string | number>) => tr(lang, k, v);

  useEffect(() => {
    const q = new URLSearchParams(location.search); const b = q.get('brand') === 'opal' ? 'opal' : ''; setBrand(b);
    const h = new URLSearchParams(location.hash.replace(/^#/, '')); const l = (h.get('l') || q.get('lang') || navigator.language || 'en').slice(0, 2) as Lang;
    if (['en', 'es', 'vi'].includes(l)) setLang(l);
    const code = h.get('s'); const st = code ? decodeState(code) : null;
    if (st) { setS(st); setScreen('result'); } else if (b === 'opal') setS((x) => ({ ...x, soc: '39-5092' }));
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const steps = useMemo(() => stepsFor(s), [s]); const step = steps[Math.min(i, steps.length - 1)];
  const r: Result | null = useMemo(() => (screen === 'result' ? compute(s) : null), [s, screen]);
  const up = (path: string, v: any) => setS((x) => set(x, path, v));
  const begin = (m: Mode) => { setS((x) => ({ ...blank(m), soc: x.soc, state: x.state, minWage: x.minWage })); setI(0); setScreen('step'); window.scrollTo(0, 0); };
  const go = (n: number) => { setHelp(null); if (n >= steps.length) { setScreen('result'); window.scrollTo(0, 0); return; } if (n < 0) { setScreen('start'); return; } setI(n); window.scrollTo(0, 0); };
  const isEst = s.est.includes(step?.id); const toggleEst = () => setS((x) => ({ ...x, est: isEst ? x.est.filter((e) => e !== step.id) : [...x.est, step.id] }));
  const dunno = () => { for (const f of step.fields || []) if (!f.bool && f.k !== 'self.cardPct') up(f.k, null); go(i + 1); };
  const copyLink = async () => { const url = `${location.origin}${location.pathname}${brand ? '?brand=opal' : ''}#s=${encodeState(s)}&l=${lang}`; try { await navigator.clipboard.writeText(url); } catch { window.prompt('', url); } setCopied(true); setTimeout(() => setCopied(false), 2500); };
  const occTitle = (soc: string) => (lang === 'en' ? OCCUPATIONS.find((o) => o.soc === soc)?.title : OCC_TITLES[lang][soc]) || soc;
  const est = (id: string) => (s.est.includes(id) ? <span style={{ fontSize: 11.5, color: AMBER, fontWeight: 600, marginLeft: 6 }}>{t('estMark')}</span> : null);

  const header = (
    <div className="pc-noprint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{brand === 'opal' ? 'Opal Nail Academy' : 'ClarityFlow'}</span>
        <span style={{ fontSize: 13, color: MUTED }}>{t('brand')}</span>
      </div>
      <div role="group" aria-label="Language" style={{ display: 'flex', gap: 4, background: SOFT, borderRadius: 999, padding: 4 }}>
        {LANGS.map(([k, name]) => <button key={k} type="button" onClick={() => setLang(k)} aria-pressed={lang === k} style={{ border: 0, borderRadius: 999, padding: '6px 12px', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: lang === k ? '#fff' : 'transparent', color: lang === k ? INK : MUTED, boxShadow: lang === k ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{name}</button>)}
      </div>
    </div>);
  const footer = (
    <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13.5, color: MUTED }}>
      <span>{t('bizCta')}</span>
      <a href="/" style={{ color: INK, fontWeight: 600 }}>{t('bizSee')}</a>
      <span style={{ width: '100%', fontSize: 12 }}>{t('usStates')} {t('estimateNote')}</span>
    </div>);

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`.pc-wrap{max-width:1120px;margin:0 auto;padding:28px 20px 40px;display:flex;flex-direction:column;gap:22px;box-sizing:border-box}
.pc-h1{font-weight:300;letter-spacing:-0.025em;margin:0;line-height:1.1}
.pc-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.pc-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.pc-2{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:start}
@media (max-width:860px){.pc-grid4{grid-template-columns:repeat(2,minmax(0,1fr))}.pc-grid3,.pc-2{grid-template-columns:1fr}}
@media (max-width:420px){.pc-grid4{grid-template-columns:1fr}}
@media print{.pc-noprint{display:none!important}.pc-wrap{padding:0;max-width:none}body{background:#fff}}`}</style>
      <div className="pc-wrap">
        {header}
        {screen === 'start' && <Start t={t} begin={begin} />}
        {screen === 'step' && step && (
          <div style={{ maxWidth: 620, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 999, background: SOFT, overflow: 'hidden' }}><div style={{ width: `${((i + 1) / steps.length) * 100}%`, height: '100%', background: INK, borderRadius: 999 }} /></div>
              <span style={{ fontSize: 13, color: MUTED }}>{t('stepOf', { n: i + 1, t: steps.length })}</span>
            </div>
            <div>
              <h1 className="pc-h1" style={{ fontSize: 30 }}>{t(step.q)}</h1>
              {step.sub && <p style={{ margin: '8px 0 0', fontSize: 15, color: MUTED, lineHeight: 1.5 }}>{t(step.sub)}</p>}
            </div>
            <StepBody step={step} s={s} up={up} t={t} lang={lang} help={help} setHelp={setHelp} occTitle={occTitle} />
            {step.where && <details style={{ background: SOFT, borderRadius: 16, padding: '12px 16px', fontSize: 14 }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('whereFind')}</summary><div style={{ marginTop: 6, color: MUTED, lineHeight: 1.5 }}>{t(step.where)}</div></details>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(step.fields || step.custom === 'hours') && <button type="button" onClick={toggleEst} aria-pressed={isEst} style={{ ...pill(), height: 38, fontSize: 13.5, background: isEst ? '#fff7ed' : '#fff', borderColor: isEst ? AMBER : LINE, color: isEst ? AMBER : INK }}>{t('estimate')}</button>}
              {step.fields && <button type="button" onClick={dunno} style={{ ...pill(), height: 38, fontSize: 13.5 }}>{t('idk')}</button>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
              <button type="button" onClick={() => go(i - 1)} style={pill()}>{t('back')}</button>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {i >= 2 && i < steps.length - 1 && <button type="button" onClick={() => go(steps.length)} style={pill()}>{t('seeSoFar')}</button>}
                <button type="button" onClick={() => go(i + 1)} style={pill(true)}>{i === steps.length - 1 ? t('seeAnswer') : t('next')}</button>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, textAlign: 'center' }}>{t('chipPrivate')} · {t('usStates')}</div>
          </div>)}
        {screen === 'result' && r && <Answer s={s} r={r} t={t} lang={lang} up={up} setS={setS} est={est} occTitle={occTitle} copyLink={copyLink} copied={copied} change={() => { setI(0); setScreen('step'); }} />}
        {footer}
      </div>
    </div>);
}

function Start({ t, begin }: { t: (k: Key, v?: any) => string; begin: (m: Mode) => void }) {
  const card = (m: Mode, title: Key, sub: Key) => (
    <button type="button" onClick={() => begin(m)} style={{ ...box, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: INK, minHeight: 150 }}>
      <span style={{ fontSize: 19, fontWeight: 600 }}>{t(title)}</span><span style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>{t(sub)}</span>
      <span style={{ marginTop: 'auto', fontSize: 14, fontWeight: 600 }}>{t('next')} →</span>
    </button>);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ maxWidth: 760 }}>
        <h1 className="pc-h1" style={{ fontSize: 'clamp(32px, 6vw, 52px)' }}>{t('title')}</h1>
        <p style={{ fontSize: 17, color: MUTED, lineHeight: 1.55, margin: '14px 0 0' }}>{t('lead')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {(['chipTime', 'chipNoSignup', 'chipPrivate'] as Key[]).map((k) => <span key={k} style={{ fontSize: 13, background: SOFT, borderRadius: 999, padding: '6px 12px' }}>{t(k)}</span>)}
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{t('start')}</div>
      <div className="pc-grid3">{card('job', 'modeJob', 'modeJobSub')}{card('self', 'modeSelf', 'modeSelfSub')}{card('offer', 'modeOffer', 'modeOfferSub')}</div>
      <div className="pc-grid3">
        {([['every', 'everySub'], ['dunno', 'dunnoSub'], ['honest', 'honestSub']] as [Key, Key][]).map(([a, b]) => <div key={a} style={{ padding: '4px 2px' }}><div style={{ fontSize: 15, fontWeight: 600 }}>{t(a)}</div><div style={{ fontSize: 14, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{t(b)}</div></div>)}
      </div>
    </div>);
}

function Choice<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {options.map(([k, label]) => <button key={k} type="button" onClick={() => onPick(k)} aria-pressed={value === k} style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 16, border: value === k ? `2px solid ${INK}` : `1px solid ${LINE}`, background: '#fff', font: 'inherit', fontSize: 15, fontWeight: value === k ? 600 : 500, color: INK, cursor: 'pointer' }}>{label}</button>)}
    </div>);
}

function FieldRow({ f, s, up, t, lang, help, setHelp }: { f: Field; s: CalcState; up: (k: string, v: any) => void; t: (k: Key, v?: any) => string; lang: Lang; help: string | null; setHelp: (v: string | null) => void }) {
  if (f.bool) return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}><input type="checkbox" checked={!!get(s, f.k)} onChange={(e) => up(f.k, e.target.checked)} style={{ width: 20, height: 20 }} />{t(f.label)}</label>);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{ fontSize: 14, fontWeight: 600 }}>{t(f.label)}</label>
      <Num value={get(s, f.k) ?? null} onChange={(v) => up(f.k, v)} unit={f.unit} ariaLabel={t(f.label)} />
      {f.where && <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.45 }}>{t(f.where)}</div>}
      {f.help && (help === f.k ? <Helper kind={f.help} weeks={s.weeks} dpw={Number(s.daysPerWeek) || 5} lang={lang} onUse={(v) => { up(f.k, v); setHelp(null); }} />
        : <button type="button" onClick={() => setHelp(f.k)} style={{ justifySelf: 'start', border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 13.5, fontWeight: 600, color: GREEN, cursor: 'pointer' }}>{t('helpMe')}</button>)}
    </div>);
}

function StepBody({ step, s, up, t, lang, help, setHelp, occTitle }: { step: Step; s: CalcState; up: (k: string, v: any) => void; t: (k: Key, v?: any) => string; lang: Lang; help: string | null; setHelp: (v: string | null) => void; occTitle: (soc: string) => string }) {
  const types: [PayType, string][] = [['hourly', t('ptHourly')], ['commission', t('ptCommission')], ['hourly_commission', t('ptHourlyCommission')], ['greater_of', t('ptGreater')], ['salary', t('ptSalary')], ['draw', t('ptDraw')], ['tips', t('ptTips')]];
  if (step.custom === 'payType') return <Choice value={s.payType} options={types} onPick={(v) => up('payType', v)} />;
  if (step.custom === 'offerType') return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Choice value={s.offer.payType} options={types.filter(([k]) => k !== 'tips') as any} onPick={(v) => up('offer.payType', v)} />
      {payFields(s.offer.payType, 'offer.').map((f) => <FieldRow key={f.k} f={f} s={s} up={up} t={t} lang={lang} help={help} setHelp={setHelp} />)}
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6 }}>{t('qBenefits')}</div>
      {([['offer.ptoDays', 'ptoLabel', 'n'], ['offer.healthMonthly', 'healthLabel', '$'], ['offer.matchPct', 'matchLabel', '%'], ['offer.suppliesMonthly', 'costsMonthly', '$'], ['offer.commuteMin', 'commuteLabel', 'min']] as [string, Key, Field['unit']][]).map(([k, l, u]) => <FieldRow key={k} f={{ k, label: l, unit: u }} s={s} up={up} t={t} lang={lang} help={help} setHelp={setHelp} />)}
    </div>);
  if (step.custom === 'hours') return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 13, color: MUTED, display: 'grid', gap: 4 }}>{t('daysAWeek')}<Num value={s.daysPerWeek} onChange={(v) => up('daysPerWeek', v === null ? null : Math.min(7, v))} unit="n" ariaLabel={t('daysAWeek')} /></label>
        <label style={{ fontSize: 13, color: MUTED, display: 'grid', gap: 4 }}>{t('hoursADay')}<Num value={s.hoursPerDay} onChange={(v) => up('hoursPerDay', v === null ? null : Math.min(24, v))} unit="n" ariaLabel={t('hoursADay')} /></label>
        <label style={{ fontSize: 13, color: MUTED, display: 'grid', gap: 4 }}>{t('weeksLabel')}
          <select value={s.weeks} onChange={(e) => up('weeks', Number(e.target.value))} style={input}>{[1, 2, 4, 8, 12, 26, 52].map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{t('equalsHours', { h: hoursOf(s).toLocaleString('en-US'), w: s.weeks })}</div>
    </div>);
  if (step.custom === 'work') return (
    <div style={{ display: 'grid', gap: 14 }}>
      <select aria-label={t('qWork')} value={s.soc} onChange={(e) => up('soc', e.target.value)} style={input}>
        <option value="">—</option>{[...OCCUPATIONS].map((o) => [o.soc, occTitle(o.soc)] as const).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <label style={{ fontSize: 14, fontWeight: 600, display: 'grid', gap: 6 }}>{t('stateLabel')}
        <select value={s.state} onChange={(e) => up('state', e.target.value)} style={input}><option value="">—</option>{US_STATES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {s.mode !== 'self' && <FieldRow f={{ k: 'minWage', label: 'minWageLabel', unit: '$', where: 'minWageWhere' }} s={s} up={up} t={t} lang={lang} help={help} setHelp={setHelp} />}
    </div>);
  if (step.custom === 'contractor') return <Choice value={s.contractor === null ? '' : s.contractor ? 'y' : 'n'} options={[['y', t('yes')], ['n', t('no')]]} onPick={(v) => up('contractor', v === 'y')} />;
  return <div style={{ display: 'grid', gap: 16 }}>{(step.fields || []).map((f) => <FieldRow key={f.k} f={f} s={s} up={up} t={t} lang={lang} help={help} setHelp={setHelp} />)}</div>;
}

function planName(p: Plan, t: (k: Key, v?: any) => string, lang: Lang) {
  if (lang === 'en') return planLabel(p);
  const $ = (n: number) => money(n, n % 1 !== 0);
  switch (p.kind) {
    case 'hourly': return lang === 'es' ? `${$(p.rate || 0)} por hora` : `${$(p.rate || 0)} mỗi giờ`;
    case 'commission': return lang === 'es' ? `${p.pct}% de comisión` : `${p.pct}% hoa hồng`;
    case 'hourly_commission': return lang === 'es' ? `${$(p.rate || 0)} por hora + ${p.pct}%` : `${$(p.rate || 0)} mỗi giờ + ${p.pct}%`;
    case 'greater_of': return lang === 'es' ? `${$(p.rate || 0)} por hora o ${p.pct}%, lo que sea mayor` : `${$(p.rate || 0)} mỗi giờ hoặc ${p.pct}%, cái nào cao hơn`;
    case 'salary': return lang === 'es' ? `${$(p.salary || 0)} al año` : `${$(p.salary || 0)} mỗi năm`;
    case 'draw': return lang === 'es' ? `${p.pct}% con adelanto de ${$(p.draw?.perWeek || 0)}` : `${p.pct}% với ứng trước ${$(p.draw?.perWeek || 0)}`;
    case 'self': return t('modeSelf');
    default: return t('nowPaid');
  }
}

function Answer({ s, r, t, lang, up, setS, est, occTitle, copyLink, copied, change }: { s: CalcState; r: Result; t: (k: Key, v?: any) => string; lang: Lang; up: (k: string, v: any) => void; setS: (f: (x: CalcState) => CalcState) => void; est: (id: string) => any; occTitle: (soc: string) => string; copyLink: () => void; copied: boolean; change: () => void }) {
  const head = s.mode === 'self' ? (r.afterCosts ?? r.perHour) : r.perHour; const a = r.allIn; const m = r.market;
  const card = (label: Key, v: number | null, sub: string) => v === null ? null : (
    <div style={box}><div style={{ fontSize: 13, color: MUTED }}>{t(label)}</div><div style={{ fontSize: 30, fontWeight: 300, letterSpacing: '-0.02em' }}>{hr(v)}</div><div style={{ fontSize: 13, color: MUTED }}>{sub}</div></div>);
  const scaleMax = m ? Math.max(m.high || m.median * 1.6, head || 0) * 1.08 : 1; const pos = (v: number) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  if (!r.hours) return <div style={box}><div style={{ fontSize: 16 }}>{t('noHours')}</div><button type="button" onClick={change} style={{ ...pill(true), alignSelf: 'start' }}>{t('change')}</button></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 13, color: MUTED }}>{t('answer')} · {t('equalsHours', { h: r.hours.toLocaleString('en-US'), w: s.weeks }).replace(/^= /, '')}{est('hours')}</div>
          <h1 className="pc-h1" style={{ fontSize: 'clamp(28px, 5vw, 40px)', marginTop: 4 }}>{t('answerTitle', { v: hr(head) })}</h1></div>
        <button type="button" className="pc-noprint" onClick={change} style={pill()}>{t('change')}</button>
      </div>

      <div className="pc-grid4">
        <div style={{ ...box, background: INK, color: '#fff', border: 0 }}>
          <div style={{ fontSize: 13, color: '#c9cace' }}>{t('perHourAllIn')}</div>
          <div style={{ fontSize: 44, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1 }}>{hr(head)}</div>
          {s.mode !== 'self' && r.gross !== r.payNoTips && <div style={{ fontSize: 13, color: MINT }}>{t('withoutTips', { v: hr(r.perHourNoTips) })}</div>}
          <div style={{ fontSize: 12.5, color: '#c9cace' }}>{t('paidMonth', { v: money(r.monthBIT) })}</div>
        </div>
        {s.mode !== 'self' && card('afterCosts', r.afterCosts, `${money(s.costsMonthly)} ${t('monthly')}`)}
        {card('commuteCard', a.perHourWithCommute, `+${Math.round(a.commuteHours)} ${t('hoursUnit')} (${s.commuteMin} min)`)}
        {card('offClockCard', a.perHourWithOffClock, `+${Math.round(a.offClockHours)} ${t('hoursUnit')}`)}
        {s.mode !== 'self' && card('benefitsCard', a.perHourWithBenefits, `${money(a.benefits * (30.44 / r.days))} ${t('monthly')}`)}
      </div>
      {s.weeks < 8 && <div style={{ fontSize: 13.5, color: MUTED }}>{t('seasonal')}</div>}

      {s.mode === 'offer' && r.offer && (
        <div className="pc-2">
          <div style={{ ...box, background: INK, color: '#fff', border: 0 }}>
            <div style={{ fontSize: 13, color: '#c9cace' }}>{t('offerAnswer')}</div>
            <div style={{ fontSize: 22 }}>{Math.abs(r.offer.diff) < 25 ? t('offerSame') : r.offer.diff > 0 ? t('offerMore', { v: money(Math.abs(r.offer.diff)) }) : t('offerLess', { v: money(Math.abs(r.offer.diff)) })}</div>
            <div style={{ fontSize: 13.5, color: '#c9cace' }}>{t('offerAllIn', { a: hr(r.offer.offerHr), b: hr(r.offer.nowHr) })}</div>
            <div style={{ fontSize: 13.5, color: '#c9cace' }}>{t('offerPay', { v: money(Math.abs(r.offer.payDiff)), dir: r.offer.payDiff >= 0 ? t('more') : t('less') })}</div>
          </div>
          {r.offer.crossOver !== null && <div style={box}><div style={{ fontSize: 15 }}>{t('crossOver', { v: money(r.offer.crossOver) })}</div></div>}
        </div>)}

      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}><div style={{ fontSize: 16, fontWeight: 600 }}>{t('market')}{s.soc ? ` · ${occTitle(s.soc)}` : ''}</div></div>
        {m ? (<>
          <div style={{ position: 'relative', height: 44 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 18, height: 8, borderRadius: 999, background: SOFT }} />
            {m.low !== null && m.high !== null && <div style={{ position: 'absolute', left: pos(m.low), width: `calc(${pos(m.high)} - ${pos(m.low)})`, top: 18, height: 8, borderRadius: 999, background: '#d6d7da' }} />}
            <div style={{ position: 'absolute', left: pos(m.median), top: 10, width: 4, height: 24, borderRadius: 2, background: MUTED }} />
            {head !== null && <div style={{ position: 'absolute', left: `calc(${pos(head)} - 8px)`, top: 6, width: 16, height: 32, borderRadius: 8, background: INK }} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13.5, color: MUTED }}>
            {m.low !== null && <span>{t('lower')}: {hr(m.low)}</span>}<span>{t('typical')}: {hr(m.median)}</span><span style={{ color: INK, fontWeight: 600 }}>{t('you')}: {hr(head)}</span>{m.high !== null && <span>{t('higher')}: {hr(m.high)}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{t('marketSrc', { y: m.year })} {m.scaled ? t('marketScaled') : ''} <a href={WAGE_SOURCE.url} target="_blank" rel="noreferrer" style={{ color: MUTED }}>bls.gov</a></div>
        </>) : <div style={{ fontSize: 14, color: MUTED }}>{t('pickWork')}</div>}
      </div>

      <div className="pc-2">
        <div style={box}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t('otherWays')}</div>
          {r.rows.map((row) => (
            <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '8px 0', borderBottom: `1px solid ${LINE}` }}>
              <span style={{ fontWeight: row.now ? 600 : 400 }}>{row.now ? t('nowPaid') : row.offer ? `${t('offerRow')}: ${planName(row.plan, t, lang)}` : planName(row.plan, t, lang)}
                {r.best?.key === row.key && r.rows.length > 1 && <span style={{ marginLeft: 8, fontSize: 12, color: GREEN, fontWeight: 600 }}>{t('mostHere')}</span>}
                {row.perHourAllIn !== null && <span style={{ display: 'block', fontSize: 12.5, color: MUTED }}>{t('allInHr', { v: hr(row.perHourAllIn) })}</span>}</span>
              <span style={{ fontWeight: row.now ? 600 : 400, whiteSpace: 'nowrap' }}>{money(row.month)}<span style={{ fontSize: 12, color: MUTED }}> /{t('monthly').split(' ').pop()}</span></span>
            </div>))}
          {r.breakEven !== null && <div style={{ fontSize: 13.5 }}>{t('breakEven', { v: money(r.breakEven) })}</div>}
          <div style={{ fontSize: 12, color: MUTED }}>{t('sameBasis')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {r.asks.length > 0 && <div style={box}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t('ask')}</div>
            {r.asks.map((x) => <div key={x.k} style={{ fontSize: 14, lineHeight: 1.5 }}>{t(x.k, { v: x.k === 'askCosts' ? money(x.v) : hr(x.v), h: x.h ?? '' })}</div>)}
            <div style={{ fontSize: 12, color: MUTED }}>{t('askNote')}</div>
          </div>}
          <div className="pc-noprint" style={{ ...box, background: SOFT, border: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t('keep')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" onClick={() => window.print()} style={pill(true)}>{t('savePdf')}</button>
              <button type="button" onClick={copyLink} style={pill()}>{copied ? t('copied') : t('copyLink')}</button>
            </div>
            <div style={{ fontSize: 12.5, color: MUTED }}>{t('linkNote')}</div>
          </div>
        </div>
      </div>

      <div style={box}>
        <label className="pc-noprint" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600 }}><input type="checkbox" checked={s.tax.on} onChange={(e) => up('tax.on', e.target.checked)} style={{ width: 20, height: 20 }} />{t('taxShow')}</label>
        {s.tax.on && r.tax && (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <select aria-label="Filing" value={s.tax.filing} onChange={(e) => up('tax.filing', e.target.value as Filing)} style={input}><option value="single">{t('filingSingle')}</option><option value="joint">{t('filingJoint')}</option><option value="head">{t('filingHead')}</option></select>
            <Num value={s.tax.statePct} onChange={(v) => up('tax.statePct', v)} unit="%" ariaLabel={t('stateTax')} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t('takeHome')}</div>
          {([['beforeIT', r.monthBIT], ['fedTax', -r.tax.federal], ['stTax', -r.tax.state]] as [Key, number][]).map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{t(k)}</span><span>{money(v)}</span></div>)}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 600, borderTop: `1px solid ${LINE}`, paddingTop: 8 }}><span>{t('takeHomeRow')}</span><span>{money(r.tax.takeHome)}</span></div>
          <div style={{ fontSize: 12, color: MUTED }}>{t('taxNote', { y: TAX_YEAR })} {t('stateTax')}: {s.tax.statePct ?? 0}%</div>
        </>)}
      </div>

      {s.contractor && (
        <div style={box}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t('contractorTitle')}</div>
          <div style={{ fontSize: 13.5, color: MUTED }}>{t('contractorSub')}</div>
          {CONTRACTOR_QUESTIONS.map((q) => (
            <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 14, padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
              <span>{lang === 'en' ? q.q : CONTRACTOR_Q[lang][q.id]}</span>
              <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{([true, false] as const).map((v) => <button key={String(v)} type="button" aria-pressed={s.cq[q.id] === v} onClick={() => setS((x) => ({ ...x, cq: { ...x.cq, [q.id]: v } }))} style={{ ...pill(s.cq[q.id] === v), height: 34, padding: '0 14px', fontSize: 13 }}>{v ? t('yes') : t('no')}</button>)}</span>
            </div>))}
          {r.contractor.lean && <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t(r.contractor.lean === 'employee' ? 'leanEmployee' : r.contractor.lean === 'contractor' ? 'leanContractor' : 'leanMixed')}</div>}
          <div style={{ fontSize: 12.5, color: MUTED }}>{t('leanWhy')} {t('askNote')}</div>
        </div>)}
    </div>);
}
