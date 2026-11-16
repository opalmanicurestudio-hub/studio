'use client';
// src/app/(app)/binder/page.tsx — THE INSPECTION BINDER (design canvas "Food numbers": the binder; lib/food-safety,
// lib/food-safety-server, api/binder). For managers: every food safety log, certificate and permit in one place, a month
// at a time. The temperature logs (the closing list's fridges and freezers, deliveries, cooling, hot and cold holding, the
// dish machine) with what was out and what was done; certificates and permits with how long each has left (a reminder
// goes out 60 and 14 days before); equipment service from Maintenance's plans; the allergen chart from the menu; and
// guest incidents and staff sent home sick. Printed as it stands, or handed to the inspector on the tablet.
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { monthDays, monthWords, recentMonths } from '@/lib/records';
import { cleanTemp, daysLeft, limitWords, PERMIT_KINDS, SERVICE_PRESETS, tempOk, type DeliveryKind, type PermitKind } from '@/lib/food-safety';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#fff] px-3.5 text-[13.5px] font-semibold disabled:opacity-50 ${RING}`;
const DARK = `inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl px-4 text-[14px] font-semibold text-[#fff] disabled:opacity-50 ${RING}`;
const LINK = `inline-flex min-h-[44px] items-center text-[13px] font-semibold underline underline-offset-4 disabled:opacity-50 ${RING}`;
const FIELD = `min-h-[44px] w-full rounded-xl border bg-[#fff] px-3 text-[14.5px] ${RING}`;
const md = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) });
const long = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const every = (n: number) => (n === 30 ? 'Every month' : n === 365 ? 'Every year' : n % 30 === 0 ? `Every ${n / 30} months` : `Every ${n} days`);

type Cooling = { state: 'cooling' | 'done' | 'missed'; dueAt?: string; dueWords: string; startedAt: string; checks: { at: string; tempF: number; by: string }[]; done: string | null; doneBy?: string | null; doneAt?: string | null };
type Log = { id: string; kind: 'delivery' | 'cooling' | 'hot' | 'cold'; day: string; at: string; by: string; item: string; tempF: number; ok: boolean; limit: string; note: string | null; supplier: string | null; deliveryKind: DeliveryKind | null; cooling?: Cooling };
type Permit = { id: string; kind: PermitKind; label: string; staffId: string | null; person: string | null; expires: string | null; note: string | null; state: 'ok' | 'soon' | 'out' | 'none' };
type Service = { id: string; binderKind: string | null; title: string; everyDays: number; lastDone: string | null; note: string | null; next: string | null; active: boolean; late: boolean };
type Incident = { id: string; kind: 'guest' | 'sent_home'; day: string; at: string; by: string; what: string; person: string | null; ate: string | null; done: string | null; name: string | null; clearedAt: string | null; clearedBy: string | null };
type V = {
  month: string; today: string; timeZone: string; business: string;
  safety: { logs: Log[]; closing: { nights: number; readings: number; out: { day: string; label: string; tempF: number; note: string | null }[] }; machine: { readings: number; out: number } };
  permits: Permit[]; service: Service[]; incidents: Incident[]; staff: { id: string; name: string }[];
  handlers: { onFile: number; team: number; missing: string[] };
  allergens: { columns: { key: string; label: string }[]; rows: { id: string; name: string; section: string; keys: string[] }[]; unset: string[] };
};
type LogForm = { kind: 'delivery' | 'hot' | 'cold'; item: string; tempF: string; deliveryKind: DeliveryKind; supplier: string; note: string };
type PermitForm = { id?: string; kind: PermitKind; label: string; staffId: string; expires: string; note: string };
type IncForm = { kind: 'guest' | 'sent_home'; what: string; person: string; ate: string; done: string; staffId: string };

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/binder', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'plain'; children: React.ReactNode }) {
  return <span className="inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold" style={tone === 'ok' ? { background: GREEN_TINT, color: GREEN } : tone === 'warn' ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }}>{children}</span>;
}

export default function BinderPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [month, setMonth] = useState('');
  const [v, setV] = useState<V | null>(null); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [said, setSaid] = useState(''); const [formErr, setFormErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [logForm, setLogForm] = useState<LogForm | null>(null);
  const [permitForm, setPermitForm] = useState<PermitForm | null>(null);
  const [svc, setSvc] = useState<{ preset: string; lastDone: string } | null>(null);
  const [inc, setInc] = useState<IncForm | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // Off unless a manager turns it on: the printout says “a guest” and “a team member” (names stay on screen).
  const [printNames, setPrintNames] = useState(false);
  // A missed batch's "what was done", picked, then written down on a second tap.
  const [coolPick, setCoolPick] = useState<{ id: string; done: string } | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return; setLoading(true);
    const d = await post({ tenantId, action: 'view', ...(month ? { month } : {}) }); setLoading(false);
    if (d.ok) { setV(d); setErr(''); if (!month) setMonth(d.month); } else setErr(d.error || 'That didn’t load. Try again.');
  }, [tenantId, month]);
  useEffect(() => { void load(); }, [load]);

  // Saves one thing, then reloads the page's numbers; what went wrong stays beside the form it came from.
  const act = async (key: string, body: any, done: string): Promise<boolean> => {
    if (!tenantId) return false; setBusy(key); setFormErr(''); setSaid('');
    const d = await post({ tenantId, ...body }); setBusy(null);
    if (!d.ok) { setFormErr(d.error || 'That didn’t save. Try again.'); return false; }
    setSaid(done); await load(); return true;
  };
  // Every reading in the month as a spreadsheet, for the inspector or the health department.
  const downloadCsv = async () => {
    if (!tenantId || !v) return; setBusy('csv'); setErr('');
    const d = await post({ tenantId, action: 'csv', month: v.month }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t download. Try again.'); return; }
    try {
      const url = URL.createObjectURL(new Blob([d.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = d.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setErr('That didn’t download. Try again.'); }
  };
  const closeForms = () => { setLogForm(null); setPermitForm(null); setSvc(null); setInc(null); setFormErr(''); setRemoving(null); };

  const tz = v?.timeZone;
  const clock = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }); } catch { return iso.slice(11, 16); } };
  const words = v ? monthWords(v.month) : '';
  const logs = v?.safety.logs || [];
  const of = (k: Log['kind']) => logs.filter((l) => l.kind === k);
  const outOf = (k: Log['kind']) => of(k).filter((l) => !l.ok);
  const days = v ? monthDays(v.month, v.today) : [];
  const coolMissed = of('cooling').filter((l) => l.cooling?.state === 'missed');
  const coolOpen = of('cooling').filter((l) => l.cooling?.state === 'cooling');
  const coolUndone = coolMissed.filter((l) => !l.cooling?.done);
  const presets = v ? SERVICE_PRESETS.filter((p) => !v.service.some((s) => s.binderKind === p.id)) : [];
  const personKind = (k: PermitKind) => !!PERMIT_KINDS.find((x) => x.id === k)?.person;

  // Render helpers (plain functions, so nothing is remounted on a re-render and focus stays where it was).
  const row = (key: string, x: { name: React.ReactNode; pill?: React.ReactNode; sub: React.ReactNode; action?: React.ReactNode; more?: React.ReactNode }) => (
    <li key={key} className="border-t py-2.5 print:break-inside-avoid" style={{ borderColor: LINE }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold">{x.name}{x.pill}</p>
          <div className="mt-0.5 text-[13px] leading-snug" style={{ color: MUTED }}>{x.sub}</div>
        </div>
        {x.action && <div className="flex shrink-0 gap-2 print:hidden">{x.action}</div>}
      </div>
      {x.more}
    </li>);
  const outList = (xs: string[]) => xs.length ? <ul className="mt-1 space-y-0.5" style={{ color: AMBER }}>{xs.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}{xs.length > 4 && <li>And {xs.length - 4} more, in every reading below.</li>}</ul> : null;
  // A name on screen, and on paper only when the manager says so.
  const named = (onScreen: string, onPaper: string) => <><span className={printNames ? '' : 'print:hidden'}>{onScreen}</span>{!printNames && onPaper ? <span className="hidden print:inline">{onPaper}</span> : null}</>;
  const errLine = () => formErr ? <p role="alert" className="text-[13.5px]" style={{ color: AMBER }}>{formErr}</p> : null;
  const label = (text: string, el: React.ReactNode, hint?: string) => <label className="block"><span className="mb-1 block text-[13px] font-semibold">{text}</span>{el}{hint && <span className="mt-1 block text-[12.5px]" style={{ color: MUTED }}>{hint}</span>}</label>;
  const choices = <T extends string>(name: string, value: T, opts: [T, string][], set: (v: T) => void) => (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {opts.map(([id, text]) => <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => set(id)} className={`inline-flex min-h-[44px] items-center rounded-xl border px-3.5 text-[13.5px] font-semibold ${RING}`} style={value === id ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', color: INK, borderColor: LINE }}>{text}</button>)}
    </div>);
  const formBox = (title: string, body: React.ReactNode, save: React.ReactNode) => (
    <div className="mt-2 space-y-3 rounded-2xl p-4 print:hidden" style={{ background: SOFT }}>
      <p className="text-[14.5px] font-semibold">{title}</p>
      {body}
      {errLine()}
      <div className="flex flex-wrap gap-2">{save}<button type="button" onClick={closeForms} className={BTN} style={{ border: `1px solid ${LINE}` }}>Cancel</button></div>
    </div>);
  // What was done about a missed batch; said to be written later when it was put down well after the mark.
  const doneWords = (c: Cooling) => {
    if (!c.done) return '';
    const later = !!c.doneAt && !!c.dueAt && Date.parse(c.doneAt) - Date.parse(c.dueAt) > 30 * 60000;
    return later ? `${c.done} (written later, by ${c.doneBy || 'a manager'} on ${md(c.doneAt!)} at ${clock(c.doneAt!)})` : c.done;
  };
  const coolWords = (l: Log) => {
    const c = l.cooling; if (!c) return '';
    const marks = c.checks.map((k) => `${k.tempF}°F at ${clock(k.at)}`).join(', ');
    return c.state === 'done' ? `Off the heat at ${clock(c.startedAt)}; ${marks}. Cooled in time.`
      : c.state === 'missed' ? `Off the heat at ${clock(c.startedAt)}${marks ? `; ${marks}` : ''}. Missed its mark${c.done ? `: ${doneWords(c)}` : ', with nothing written about what was done'}.`
      : `Off the heat at ${clock(c.startedAt)}${marks ? `; ${marks}` : ''}. Still cooling, next ${c.dueWords}.`;
  };
  const kindWords = (l: Log) => l.kind === 'delivery' ? `Delivery, ${l.deliveryKind || 'cold'}` : l.kind === 'cooling' ? 'Cooling' : l.kind === 'hot' ? 'Hot holding' : 'Cold holding';

  // The manager's own reading (the kitchen screen takes most of them).
  const lf = logForm; const lfTemp = lf ? cleanTemp(lf.tempF) : null;
  const lfLimit = lf ? (lf.kind === 'delivery' ? lf.deliveryKind : lf.kind) : 'cold';
  const lfOut = lf && lfTemp !== null && !tempOk(lfLimit, lfTemp);
  const saveLog = async () => {
    if (!lf) return;
    const ok = await act('log', { action: 'log', kind: lf.kind, item: lf.item, tempF: lf.tempF, note: lf.note, ...(lf.kind === 'delivery' ? { deliveryKind: lf.deliveryKind, supplier: lf.supplier } : {}) }, `${lf.item} logged at ${lf.tempF}°F.`);
    if (ok) setLogForm(null);
  };
  const pf = permitForm;
  const savePermit = async () => {
    if (!pf) return;
    const kindLabel = PERMIT_KINDS.find((k) => k.id === pf.kind)?.label || 'It';
    const ok = await act('permit', { action: 'permit', ...(pf.id ? { id: pf.id } : {}), kind: pf.kind, label: pf.label, staffId: personKind(pf.kind) ? pf.staffId : '', expires: pf.expires, note: pf.note }, `${pf.label || kindLabel} is on the binder.`);
    if (ok) setPermitForm(null);
  };
  const saveService = async () => {
    if (!svc) return; const p = SERVICE_PRESETS.find((x) => x.id === svc.preset);
    const ok = await act('service', { action: 'service', preset: svc.preset, lastDone: svc.lastDone }, `${p?.title || 'The service'} is on the list. Maintenance opens a ticket when it’s due.`);
    if (ok) setSvc(null);
  };
  const saveIncident = async () => {
    if (!inc) return;
    const who = inc.kind === 'sent_home' ? v?.staff.find((s) => s.id === inc.staffId)?.name : null;
    const ok = await act('incident', { action: 'incident', ...inc }, inc.kind === 'sent_home' ? `${who || 'They'} ${who ? 'is' : 'are'} off food until cleared.` : 'The incident is written down.');
    if (ok) setInc(null);
  };

  return (
    <div id="binder" className="min-h-dvh print:min-h-0 print:bg-[#fff]" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`@media print {
        [data-sidebar], .group.peer, header { display: none !important; }
        #binder { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #binder section { box-shadow: none; border: 1px solid ${LINE}; }
        @page { size: letter; margin: 0.5in; }
      }`}</style>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Inspection binder</h1>
            <p className="max-w-2xl text-[15px] print:hidden" style={{ color: MUTED }}>Every food safety log, certificate and permit in one place. Print it before a visit, or hand the inspector the tablet. The kitchen screen logs temperatures as the work is done.</p>
            {v && <p className="hidden text-[15px] print:block">{v.business ? `${v.business}, ` : ''}{words}. Printed {long(v.today)}.</p>}
          </div>
          {v && (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className={BTN} style={{ border: `1px solid ${LINE}` }}>Print the binder</button>
              <button type="button" onClick={() => void downloadCsv()} disabled={busy === 'csv'} className={BTN} style={{ border: `1px solid ${LINE}` }}>{busy === 'csv' ? 'Getting it…' : 'Readings (CSV)'}</button>
              <label className="block"><span className="sr-only">Which month</span>
                <select value={v.month} onChange={(e) => { setMonth(e.target.value); setOpen(null); setSaid(''); closeForms(); }} className={`min-h-[44px] rounded-full border-0 px-4 text-[14.5px] font-semibold ${RING}`} style={{ background: INK, color: '#fff' }}>
                  {recentMonths(v.today).map((m) => <option key={m} value={m}>{monthWords(m)}</option>)}
                </select></label>
            </div>
          )}
        </div>
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {said && <p role="status" className="rounded-2xl px-4 py-3 text-[14.5px] print:hidden" style={{ background: GREEN_TINT, color: GREEN }}>{said}</p>}
        {!v ? <div className="h-48 rounded-3xl bg-[#fff]" aria-busy="true" /> : (<>
          <div className="grid items-start gap-4 lg:grid-cols-2 print:block print:space-y-4" aria-busy={loading}>

            <section aria-labelledby="temps-title" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="temps-title" className="text-[17px] font-semibold">Temperature logs, {words}</h2>
                  <p className="text-[13px]" style={{ color: MUTED }}>Each one with who took it, and what was done when it was out.</p>
                </div>
                {!logForm && <button type="button" onClick={() => { closeForms(); setLogForm({ kind: 'delivery', item: '', tempF: '', deliveryKind: 'cold', supplier: '', note: '' }); }} className={`${BTN} print:hidden`} style={{ border: `1px solid ${LINE}` }}>Log a reading</button>}
              </div>
              {lf && formBox('Log a reading', <>
                {choices('Which log', lf.kind, [['delivery', 'Delivery'], ['hot', 'Hot holding'], ['cold', 'Cold holding']], (k) => setLogForm({ ...lf, kind: k }))}
                {lf.kind === 'delivery' && choices('What kind', lf.deliveryKind, [['cold', 'Cold'], ['frozen', 'Frozen'], ['hot', 'Hot']], (k) => setLogForm({ ...lf, deliveryKind: k }))}
                <div className="grid gap-3 sm:grid-cols-2">
                  {label(lf.kind === 'delivery' ? 'What came in' : 'What it is', <input value={lf.item} onChange={(e) => setLogForm({ ...lf, item: e.target.value })} maxLength={80} placeholder={lf.kind === 'delivery' ? 'Chicken thighs' : lf.kind === 'hot' ? 'Soup of the day' : 'Line reach-in'} className={FIELD} style={{ borderColor: LINE }} />)}
                  {lf.kind === 'delivery' && label('From', <input value={lf.supplier} onChange={(e) => setLogForm({ ...lf, supplier: e.target.value })} maxLength={60} placeholder="Supplier" className={FIELD} style={{ borderColor: LINE }} />)}
                  {label('Temperature, °F', <input value={lf.tempF} onChange={(e) => setLogForm({ ...lf, tempF: e.target.value })} inputMode="decimal" placeholder="38" className={FIELD} style={{ borderColor: LINE }} />, `Within ${limitWords(lfLimit)}.`)}
                </div>
                {lfOut && <p className="text-[13.5px]" style={{ color: AMBER }}>{lf.kind === 'delivery' ? `That’s outside ${limitWords(lfLimit)}. Refuse it, and say so below.` : lf.kind === 'hot' ? 'That’s under 135°F. Reheat it to 165°F or throw it out, and say which.' : 'That’s over 41°F. Say what was done.'}</p>}
                {label(lfOut ? 'What was done' : 'Note, if any', <input value={lf.note} onChange={(e) => setLogForm({ ...lf, note: e.target.value })} maxLength={200} placeholder={lfOut ? (lf.kind === 'delivery' ? 'Sent back with the driver' : 'Reheated to 165°F') : ''} className={FIELD} style={{ borderColor: LINE }} />)}
                <p className="text-[12.5px]" style={{ color: MUTED }}>Cooling is logged on the kitchen screen, which asks for each check when it’s due.</p>
              </>, <button type="button" onClick={() => void saveLog()} disabled={busy === 'log' || !lf.item.trim() || lfTemp === null || (!!lfOut && !lf.note.trim())} className={DARK} style={{ background: INK }}>{busy === 'log' ? 'Saving…' : 'Save the reading'}</button>)}
              <ul className="mt-2">
                {row('t1', { name: 'Fridges and freezers at close', pill: <Pill tone={v.safety.closing.out.length ? 'warn' : 'plain'}>{v.safety.closing.nights} of {days.length} {days.length === 1 ? 'night' : 'nights'}</Pill>, sub: v.safety.closing.readings
                    ? <>{v.safety.closing.readings} readings from the closing list{v.safety.closing.out.length ? `, ${v.safety.closing.out.length} out` : ', all within their limits'}.{outList(v.safety.closing.out.map((o) => `${o.label}, ${md(o.day)}: ${o.tempF}°F${o.note ? `. ${o.note}` : ''}.`))}</>
                    : 'No closing temperatures yet this month. They’re taken on the closing list each night.', action: <Link href="/close" className={BTN} style={{ border: `1px solid ${LINE}` }}>Open</Link> })}
                {row('t2', { name: 'Deliveries', pill: of('delivery').length ? <Pill tone={outOf('delivery').length ? 'warn' : 'ok'}>{outOf('delivery').length ? `${outOf('delivery').length} outside the limit` : `${of('delivery').length} checked`}</Pill> : <Pill tone="plain">None logged</Pill>, sub: <>Cold at 41°F or below on arrival, frozen at 0°F or below, hot at 135°F or above.{outList(outOf('delivery').map((l) => `${l.item}${l.supplier ? ` from ${l.supplier}` : ''} at ${l.tempF}°F on ${md(l.day)}${l.note ? `: ${l.note}` : ''}.`))}</> })}
                {row('t3', { name: 'Cooling', pill: of('cooling').length ? <Pill tone={coolMissed.length ? 'warn' : 'ok'}>{coolMissed.length ? `${coolMissed.length} of ${of('cooling').length} missed` : `${of('cooling').length} cooled in time`}</Pill> : <Pill tone="plain">None logged</Pill>, sub: <>135°F to 70°F within 2 hours, then 41°F within 4 more.{coolOpen.length ? ` ${coolOpen.length} still cooling.` : ''}{outList(coolMissed.map((l) => `${l.item} on ${md(l.day)} missed its mark${l.cooling?.done ? `: ${doneWords(l.cooling)}` : ', with nothing written about what was done'}.`))}</>,
                  more: coolUndone.length ? <><ul className="mb-1 mt-1.5 space-y-2 print:hidden">{coolUndone.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="w-full font-semibold sm:w-auto">{l.item}, {md(l.day)}: what was done?</span>
                      {coolPick?.id === l.id ? <>
                        <span>Write down: {coolPick.done.toLowerCase()}? It can’t be changed after.</span>
                        <button type="button" onClick={() => void act(`cool-${l.id}`, { action: 'coolDone', logId: l.id, done: coolPick.done }, `${l.item}: ${coolPick.done.toLowerCase()}, written down.`).then((done) => { if (done) setCoolPick(null); })} disabled={busy === `cool-${l.id}`} className={DARK} style={{ background: INK }}>{busy === `cool-${l.id}` ? 'Saving…' : 'Write it down'}</button>
                        <button type="button" onClick={() => setCoolPick(null)} className={BTN} style={{ border: `1px solid ${LINE}` }}>Cancel</button>
                      </> : ['Reheated', 'Thrown out'].map((x) => <button key={x} type="button" onClick={() => setCoolPick({ id: l.id, done: x })} className={BTN} style={{ border: `1px solid ${LINE}` }} aria-label={`${l.item}, ${md(l.day)}: ${x}`}>{x}</button>)}
                    </li>))}</ul>{!logForm && !permitForm && !svc && !inc && errLine()}</> : null })}
                {row('t4', { name: 'Hot holding', pill: of('hot').length ? <Pill tone={outOf('hot').length ? 'warn' : 'ok'}>{outOf('hot').length ? `${outOf('hot').length} under 135°F` : `${of('hot').length} checked`}</Pill> : <Pill tone="plain">None logged</Pill>, sub: <>135°F or above.{outList(outOf('hot').map((l) => `${l.item} at ${l.tempF}°F on ${md(l.day)}: ${l.note || 'nothing said'}.`))}</> })}
                {row('t5', { name: 'Cold holding', pill: of('cold').length ? <Pill tone={outOf('cold').length ? 'warn' : 'ok'}>{outOf('cold').length ? `${outOf('cold').length} over 41°F` : `${of('cold').length} checked`}</Pill> : <Pill tone="plain">None logged</Pill>, sub: <>41°F or below, on the line during service.{outList(outOf('cold').map((l) => `${l.item} at ${l.tempF}°F on ${md(l.day)}: ${l.note || 'nothing said'}.`))}</> })}
                {row('t6', { name: 'Dish machine', pill: v.safety.machine.readings ? <Pill tone={v.safety.machine.out ? 'warn' : 'ok'}>{v.safety.machine.out ? `${v.safety.machine.out} out` : `${v.safety.machine.readings} readings`}</Pill> : <Pill tone="plain">None logged</Pill>, sub: v.safety.machine.readings ? `${v.safety.machine.readings} readings from the dish screen${v.safety.machine.out ? `, ${v.safety.machine.out} outside the limit` : ''}.` : 'Taken on the dish screen.' })}
              </ul>
              {logs.length > 0 && <button type="button" onClick={() => { const show = open !== 'all'; setOpen(show ? 'all' : null); if (show) setTimeout(() => document.getElementById('every-reading')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }} aria-expanded={open === 'all'} aria-controls="every-reading" className={`${LINK} print:hidden`}>{open === 'all' ? 'Hide every reading' : `See every reading (${logs.length})`}</button>}
            </section>

            <section aria-labelledby="permits-title" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="permits-title" className="text-[17px] font-semibold">Certificates and permits</h2>
                  <p className="text-[13px]" style={{ color: MUTED }}>With a reminder 60 days and 14 days before anything runs out.</p>
                </div>
                {!permitForm && <button type="button" onClick={() => { closeForms(); setPermitForm({ kind: 'health', label: '', staffId: '', expires: '', note: '' }); }} className={`${BTN} print:hidden`} style={{ border: `1px solid ${LINE}` }}>Add one</button>}
              </div>
              {pf && formBox(pf.id ? `Change ${pf.label || 'it'}` : 'Add a certificate or permit', <>
                {label('What it is', <select value={pf.kind} onChange={(e) => setPermitForm({ ...pf, kind: e.target.value as PermitKind })} className={FIELD} style={{ borderColor: LINE }}>{PERMIT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>)}
                {personKind(pf.kind) && label('Whose', <select value={pf.staffId} onChange={(e) => setPermitForm({ ...pf, staffId: e.target.value })} className={FIELD} style={{ borderColor: LINE }}><option value="">Pick someone</option>{v.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}
                <div className="grid gap-3 sm:grid-cols-2">
                  {label('Its name, if you want one', <input value={pf.label} onChange={(e) => setPermitForm({ ...pf, label: e.target.value })} maxLength={80} placeholder={PERMIT_KINDS.find((k) => k.id === pf.kind)?.label} className={FIELD} style={{ borderColor: LINE }} />)}
                  {label('Runs out', <input type="date" value={pf.expires} onChange={(e) => setPermitForm({ ...pf, expires: e.target.value })} className={FIELD} style={{ borderColor: LINE }} />, 'Leave it empty if it doesn’t run out.')}
                </div>
                {label('Note, if any', <input value={pf.note} onChange={(e) => setPermitForm({ ...pf, note: e.target.value })} maxLength={160} placeholder="County health department" className={FIELD} style={{ borderColor: LINE }} />, 'No license or ID numbers here: just what it is and when it runs out.')}
              </>, <button type="button" onClick={() => void savePermit()} disabled={busy === 'permit' || (personKind(pf.kind) && !pf.staffId)} className={DARK} style={{ background: INK }}>{busy === 'permit' ? 'Saving…' : pf.id ? 'Save the change' : 'Add it'}</button>)}
              <ul className="mt-2">
                {v.permits.map((p) => {
                  const left = p.expires ? daysLeft(p.expires, v.today) : null;
                  return row(p.id, {
                    name: <>{p.label}</>,
                    pill: p.state === 'ok' ? <Pill tone="ok">Current</Pill> : p.state === 'soon' ? <Pill tone="warn">Renew soon</Pill> : p.state === 'out' ? <Pill tone="warn">Ran out</Pill> : <Pill tone="plain">No date</Pill>,
                    sub: <>{p.person ? `${p.person}. ` : ''}{!p.expires ? 'Doesn’t run out, or no date put in.' : p.state === 'out' ? `Ran out ${long(p.expires)}.` : p.state === 'soon' ? `Runs out ${long(p.expires)}, in ${left} ${left === 1 ? 'day' : 'days'}.` : `Until ${long(p.expires)}.`}{p.note ? ` ${p.note}.`.replace(/\.\.$/, '.') : ''}</>,
                    action: removing === p.id ? <>
                        <button type="button" onClick={() => void act(`rm-${p.id}`, { action: 'permitRemove', id: p.id }, `${p.label} is off the binder.`).then(() => setRemoving(null))} disabled={busy === `rm-${p.id}`} className={BTN} style={{ border: `1px solid ${LINE}` }}>{busy === `rm-${p.id}` ? 'Taking it off…' : 'Take it off'}</button>
                        <button type="button" onClick={() => setRemoving(null)} className={BTN} style={{ border: `1px solid ${LINE}` }}>Keep</button>
                      </> : <>
                        <button type="button" onClick={() => { closeForms(); setPermitForm({ id: p.id, kind: p.kind, label: p.label, staffId: p.staffId || '', expires: p.expires || '', note: p.note || '' }); }} className={BTN} style={{ border: `1px solid ${LINE}` }} aria-label={`Change ${p.label}${p.person ? `, ${p.person}` : ''}`}>Change</button>
                        <button type="button" onClick={() => setRemoving(p.id)} className={BTN} style={{ border: `1px solid ${LINE}` }} aria-label={`Remove ${p.label}${p.person ? `, ${p.person}` : ''}`}>Remove</button>
                      </>,
                  });
                })}
                {v.permits.length === 0 && <li className="border-t py-2.5 text-[13.5px]" style={{ borderColor: LINE, color: MUTED }}>Nothing yet. Add the health permit first, then the food protection manager’s certificate and each person’s food handler card.</li>}
                {v.handlers.team > 0 && row('handlers', { name: 'Food handler cards', pill: <Pill tone={v.handlers.missing.length ? 'warn' : 'ok'}>{v.handlers.onFile} of {v.handlers.team} on file</Pill>, sub: v.handlers.missing.length
                    ? <>Not on file yet: {list(v.handlers.missing.slice(0, 8))}{v.handlers.missing.length > 8 ? ` and ${v.handlers.missing.length - 8} more` : ''}. Your state may ask for one for anyone who handles food.</>
                    : 'Everyone on the team has a current card on file.' })}
              </ul>
            </section>

            <section aria-labelledby="service-title" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="service-title" className="text-[17px] font-semibold">Equipment and service</h2>
                  <p className="text-[13px]" style={{ color: MUTED }}>Each one opens a ticket in Maintenance when it’s due. Resolve it there, with the report.</p>
                </div>
                <Link href="/maintenance" className={`${BTN} print:hidden`} style={{ border: `1px solid ${LINE}` }}>Open</Link>
              </div>
              <ul className="mt-2">
                {v.service.map((s) => row(s.id, {
                  name: s.title,
                  pill: !s.active ? <Pill tone="plain">Paused</Pill> : s.late ? <Pill tone="warn">Late, due {s.next ? md(s.next) : 'now'}</Pill> : s.next ? <Pill tone="plain">Due {md(s.next)}</Pill> : undefined,
                  sub: `${every(s.everyDays)}. ${s.lastDone ? `Last done ${long(s.lastDone)}${s.note ? `: ${s.note}` : ''}.` : 'Not done here yet.'}`,
                }))}
                {v.service.length === 0 && <li className="border-t py-2.5 text-[13.5px]" style={{ borderColor: LINE, color: MUTED }}>Nothing yet. Add the ones an inspector usually asks about below.</li>}
              </ul>
              {presets.length > 0 && !svc && <div className="mt-1 print:hidden">
                <p className="pt-2 text-[13px] font-semibold">Add a usual service</p>
                <div className="mt-1.5 flex flex-wrap gap-2">{presets.map((p) => <button key={p.id} type="button" onClick={() => { closeForms(); setSvc({ preset: p.id, lastDone: '' }); }} className={BTN} style={{ border: `1px solid ${LINE}` }}>{p.title}</button>)}</div>
              </div>}
              {svc && formBox(SERVICE_PRESETS.find((p) => p.id === svc.preset)?.title || 'Add a service', <>
                <p className="text-[13.5px]" style={{ color: MUTED }}>{SERVICE_PRESETS.find((p) => p.id === svc.preset)?.description} {every(SERVICE_PRESETS.find((p) => p.id === svc.preset)?.everyDays || 30)}.</p>
                {label('When it was last done, if you know', <input type="date" value={svc.lastDone} max={v.today} onChange={(e) => setSvc({ ...svc, lastDone: e.target.value })} className={FIELD} style={{ borderColor: LINE }} />, 'Left empty, the first ticket opens today.')}
              </>, <button type="button" onClick={() => void saveService()} disabled={busy === 'service'} className={DARK} style={{ background: INK }}>{busy === 'service' ? 'Adding…' : 'Add it'}</button>)}
            </section>

            <section aria-labelledby="incidents-title" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4">
              <h2 id="incidents-title" className="text-[17px] font-semibold">Incidents and illness</h2>
              <p className="text-[13px]" style={{ color: MUTED }}>For the insurer and the health department, written down the day it happens.</p>
              {v.incidents.length > 0 && <label className="mt-1 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[13.5px] print:hidden">
                <input type="checkbox" checked={printNames} onChange={(e) => setPrintNames(e.target.checked)} className={`h-5 w-5 shrink-0 accent-[#16171a] ${RING}`} />
                <span>Names on the printout <span style={{ color: MUTED }}>(left off, it says a guest and a team member)</span></span>
              </label>}
              {!inc && <div className="mt-2 flex flex-wrap gap-2 print:hidden">
                <button type="button" onClick={() => { closeForms(); setInc({ kind: 'guest', what: '', person: '', ate: '', done: '', staffId: '' }); }} className={BTN} style={{ border: `1px solid ${LINE}` }}>A guest’s reaction or injury</button>
                <button type="button" onClick={() => { closeForms(); setInc({ kind: 'sent_home', what: '', person: '', ate: '', done: '', staffId: '' }); }} className={BTN} style={{ border: `1px solid ${LINE}` }}>Someone sent home sick</button>
              </div>}
              {inc && inc.kind === 'guest' && formBox('A guest’s reaction or injury', <>
                {label('What happened', <textarea value={inc.what} onChange={(e) => setInc({ ...inc, what: e.target.value })} maxLength={500} rows={3} className={`${FIELD} py-2.5`} style={{ borderColor: LINE }} />, 'What happened and what was seen. Not a diagnosis or a medical detail.')}
                <div className="grid gap-3 sm:grid-cols-2">
                  {label('Who, if they said', <input value={inc.person} onChange={(e) => setInc({ ...inc, person: e.target.value })} maxLength={80} className={FIELD} style={{ borderColor: LINE }} />)}
                  {label('What they ate, if it was food', <input value={inc.ate} onChange={(e) => setInc({ ...inc, ate: e.target.value })} maxLength={200} className={FIELD} style={{ borderColor: LINE }} />)}
                </div>
                {label('What was done', <input value={inc.done} onChange={(e) => setInc({ ...inc, done: e.target.value })} maxLength={300} placeholder="First aid, comped the table, kept the dish" className={FIELD} style={{ borderColor: LINE }} />)}
              </>, <button type="button" onClick={() => void saveIncident()} disabled={busy === 'incident' || !inc.what.trim()} className={DARK} style={{ background: INK }}>{busy === 'incident' ? 'Saving…' : 'Write it down'}</button>)}
              {inc && inc.kind === 'sent_home' && formBox('Someone sent home sick', <>
                {label('Who', <select value={inc.staffId} onChange={(e) => setInc({ ...inc, staffId: e.target.value })} className={FIELD} style={{ borderColor: LINE }}><option value="">Pick someone</option>{v.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}
                <p className="text-[13px]" style={{ color: MUTED }}>Only who and when is kept, never why. They stay off food until you mark them cleared to work.</p>
              </>, <button type="button" onClick={() => void saveIncident()} disabled={busy === 'incident' || !inc.staffId} className={DARK} style={{ background: INK }}>{busy === 'incident' ? 'Saving…' : 'Write it down'}</button>)}
              <ul className="mt-2">
                {v.incidents.map((x) => x.kind === 'sent_home'
                  ? row(x.id, { name: named(`${x.name || 'Someone'} sent home sick`, 'A team member sent home sick'), pill: x.clearedAt ? <Pill tone="ok">Cleared</Pill> : <Pill tone="warn">Off food</Pill>, sub: `${md(x.day)}. ${x.clearedAt ? `Cleared to work ${md(x.clearedAt)}${x.clearedBy ? ` by ${x.clearedBy}` : ''}.` : 'Off food until cleared.'}`,
                      action: !x.clearedAt ? <button type="button" onClick={() => void act(`clear-${x.id}`, { action: 'incidentClear', id: x.id }, `${x.name || 'They'} can work with food again.`)} disabled={busy === `clear-${x.id}`} className={BTN} style={{ border: `1px solid ${LINE}` }} aria-label={`${x.name || 'Someone'} cleared to work`}>{busy === `clear-${x.id}` ? 'Saving…' : 'Cleared to work'}</button> : undefined })
                  : row(x.id, { name: `Guest, ${md(x.day)}`, sub: <>{x.what}{x.person ? named(` (${x.person})`, '') : ''}.{x.ate ? ` Ate: ${x.ate}.` : ''}{x.done ? ` What was done: ${x.done}.` : ''} Written down by {x.by}.</> }))}
                {v.incidents.length === 0 && <li className="border-t py-2.5 text-[13.5px]" style={{ borderColor: LINE, color: MUTED }}>None in {words}.</li>}
              </ul>
            </section>
          </div>

          {logs.length > 0 && (
            <section id="every-reading" aria-labelledby="every-title" className={`scroll-mt-4 rounded-3xl bg-[#fff] px-5 pb-4 pt-4 ${open === 'all' ? '' : 'hidden print:block'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="every-title" className="text-[17px] font-semibold">Every reading, {words}</h2>
                  <p className="text-[13px]" style={{ color: MUTED }}>In the order they were taken, with who took each one.</p>
                </div>
                <button type="button" onClick={() => setOpen(null)} className={`${BTN} print:hidden`} style={{ border: `1px solid ${LINE}` }}>Hide</button>
              </div>
              <div className="relative mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[12.5px]">
                  <thead><tr style={{ color: MUTED }}><th className="py-1.5 pr-2 font-semibold">When</th><th className="py-1.5 pr-2 font-semibold">Log</th><th className="py-1.5 pr-2 font-semibold">What</th><th className="py-1.5 pr-2 text-right font-semibold">°F</th><th className="py-1.5 pr-2 font-semibold">By</th><th className="py-1.5 font-semibold">What was done</th></tr></thead>
                  <tbody>{logs.map((l) => (
                    <tr key={l.id} className="border-t align-top print:break-inside-avoid" style={{ borderColor: LINE }}>
                      <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">{md(l.day)}, {clock(l.at)}</td>
                      <td className="py-1.5 pr-2">{kindWords(l)}</td>
                      <td className="py-1.5 pr-2">{l.item}{l.supplier ? `, from ${l.supplier}` : ''}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums" style={{ color: l.ok || l.kind === 'cooling' ? INK : AMBER }}>{l.tempF}</td>
                      <td className="py-1.5 pr-2">{l.by}</td>
                      <td className="py-1.5" style={{ color: l.ok ? MUTED : AMBER }}>{l.kind === 'cooling' ? coolWords(l) : l.note || (l.ok ? '' : 'Nothing said')}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </section>
          )}
          <section aria-labelledby="allergens-title" className="rounded-3xl bg-[#fff] px-5 pb-4 pt-4 print:break-before-page">
            <h2 id="allergens-title" className="text-[17px] font-semibold">Allergens, dish by dish</h2>
            <p className="text-[13px]" style={{ color: MUTED }}>From what each item on the menu says it contains. Printed for the line and the floor.</p>
            {v.allergens.unset.length > 0 && <p className="mt-2 rounded-2xl px-4 py-3 text-[13.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{v.allergens.unset.length === 1 ? `${v.allergens.unset[0]} doesn’t say what it contains yet.` : `${v.allergens.unset.length} items don’t say what they contain yet: ${list(v.allergens.unset.slice(0, 6))}${v.allergens.unset.length > 6 ? ` and ${v.allergens.unset.length - 6} more` : ''}.`} <Link href="/menu" className={`font-semibold underline underline-offset-4 print:no-underline ${RING}`}>Set them on the Menu</Link>.</p>}
            {v.allergens.rows.length > 0 ? (
              <div className="relative mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[12.5px]">
                  <thead><tr style={{ color: MUTED }}><th className="py-1.5 pr-2 font-semibold">Dish</th>{v.allergens.columns.map((c) => <th key={c.key} className="px-1 py-1.5 text-center font-semibold">{c.label}</th>)}</tr></thead>
                  <tbody>{v.allergens.rows.map((r, i) => (<Fragment key={r.id}>
                    {r.section && r.section !== v.allergens.rows[i - 1]?.section && <tr><td colSpan={v.allergens.columns.length + 1} className="pb-1 pt-3 text-[12.5px] font-semibold" style={{ color: MUTED }}>{r.section}</td></tr>}
                    <tr className="border-t" style={{ borderColor: LINE }}>
                      <td className="py-1.5 pr-2 font-semibold">{r.name}</td>
                      {v.allergens.columns.map((c) => <td key={c.key} className="px-1 py-1.5 text-center">{r.keys.includes(c.key) ? <><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: INK }} /><span className="sr-only">Contains {c.label.toLowerCase()}</span></> : null}</td>)}
                    </tr></Fragment>))}</tbody>
                </table>
                <p className="mt-2 text-[12.5px]" style={{ color: MUTED }}>A dot means it contains it. A blank means the item says it doesn’t.</p>
              </div>
            ) : <p className="mt-2 text-[13.5px]" style={{ color: MUTED }}>No menu item says what it contains yet. Set it on each item in the Menu.</p>}
          </section>
          <p className="text-[13px]" style={{ color: MUTED }}>The limits here are the FDA Food Code’s. Your health department may ask for its own; follow theirs where they differ.</p>
        </>)}
      </div>
    </div>
  );
}
