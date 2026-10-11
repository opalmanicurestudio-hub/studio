'use client';
// src/app/(app)/import/page.tsx — MOVING IN: bringing a business over from another app (lib/import-records,
// lib/import-more, /api/import). The checklist shows each kind of record (clients, services, team, appointments, gift
// cards, packages, products) and where it stands; tapping one opens a drawer: get the file (CSV or Excel), see it side by
// side with how it will look here, answer only the questions we couldn't work out, and bring it in. Every import can be
// undone. Switch-over day is a short list for the day the business stops using the old app.
import * as React from 'react';
import { collection, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { parseCsv, autoMatch, cleanRow, mergeWithin, guessKind, howToGet, FIELDS, APPS, type ImportKind, type CleanRow } from '@/lib/import-records';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const card = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18 } as const;
const lab = 'text-[12px] tracking-[0.1em]';
const btn = 'h-11 rounded-full px-5 text-[14.5px] font-semibold disabled:opacity-40';
const $ = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
type Kind = ImportKind | 'other';
const TILES: { kind: Kind | 'team'; title: string; sub: string }[] = [
  { kind: 'clients', title: 'Clients', sub: 'Names, phones, emails, birthdays, notes, marketing choices' },
  { kind: 'services', title: 'Services', sub: 'Your menu — names, lengths and prices' },
  { kind: 'team', title: 'Your team', sub: 'Names, roles, and what each person does' },
  { kind: 'appointments', title: 'Appointments', sub: 'Upcoming visits, and past ones for history' },
  { kind: 'giftcards', title: 'Gift cards', sub: 'Balances clients still have — their codes keep working' },
  { kind: 'packages', title: 'Packages', sub: 'Sessions clients have left' },
  { kind: 'products', title: 'Products', sub: 'Retail items, SKUs, prices and stock' },
  { kind: 'memberships', title: 'Memberships', sub: 'Who’s on which plan and when they’re next charged' },
  { kind: 'balances', title: 'Client balances', sub: 'Store credit clients have, and what they owe' },
  { kind: 'formulas', title: 'Formula notes', sub: 'Color and treatment notes, kept with each client' },
  { kind: 'discounts', title: 'Discount codes', sub: 'Promo codes that should keep working' },
];
const NOUN: Record<ImportKind, [string, string]> = { clients: ['client', 'clients'], services: ['service', 'services'], products: ['product', 'products'], appointments: ['appointment', 'appointments'], giftcards: ['gift card', 'gift cards'], packages: ['package balance', 'package balances'], memberships: ['member', 'members'], balances: ['client balance', 'client balances'], formulas: ['formula note', 'formula notes'], discounts: ['discount code', 'discount codes'] };
const pill = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` });

async function readRows(f: File): Promise<string[][]> {
  if (/\.(xlsx)$/i.test(f.name)) {
    const { readSheet } = await import('read-excel-file/universal'); const data: any[][] = await readSheet(f) as any;
    const cell = (v: any) => v instanceof Date ? `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}${v.getUTCHours() || v.getUTCMinutes() ? ` ${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}` : ''}` : v == null ? '' : String(v).trim();
    return data.map((r) => r.map(cell)).filter((r) => r.some((x) => x !== ''));
  }
  if (/\.(xls|numbers)$/i.test(f.name)) throw new Error('This older spreadsheet type can’t be read here — open it and save it as .xlsx or CSV, then choose that file.');
  return parseCsv(await f.text());
}

// ─────────────────────────────── THE DRAWER ───────────────────────────────
function Drawer({ tenantId, startKind, app, onClose, onDone }: { tenantId: string; startKind: Kind; app: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = React.useState<ImportKind>(startKind === 'other' ? 'clients' : startKind); const [guessed, setGuessed] = React.useState(false);
  const [step, setStep] = React.useState(0); const [file, setFile] = React.useState(''); const [headers, setHeaders] = React.useState<string[]>([]); const [body, setBody] = React.useState<string[][]>([]);
  const [map, setMap] = React.useState<Record<string, number>>({}); const [err, setErr] = React.useState(''); const [drag, setDrag] = React.useState(false); const [reading, setReading] = React.useState(false);
  const [cols, setCols] = React.useState(false); const [shuffle, setShuffle] = React.useState(0);
  const [qs, setQs] = React.useState<any>(null); const [staffMap, setStaffMap] = React.useState<Record<string, string>>({}); const [serviceMap, setServiceMap] = React.useState<Record<string, string>>({});
  const [keepMarketing, setKeepMarketing] = React.useState(true); const [reminders, setReminders] = React.useState(false);
  const [check, setCheck] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [progress, setProgress] = React.useState<number | null>(null); const [done, setDone] = React.useState<any>(null);
  const cleaned = React.useMemo(() => (body.length ? mergeWithin(kind, body.map((c, i) => cleanRow(kind, c, map, i + 2))) : null), [body, map, kind]);
  const good = (cleaned?.rows || []).filter((r) => !r.skip); const skipped = (cleaned?.rows || []).filter((r) => r.skip); const problems = good.filter((r) => r.problems.length);
  const fields = FIELDS[kind]; const missingRequired = fields.filter((f) => f.required && map[f.key] === undefined);
  const nameOk = kind === 'clients' ? ['name', 'firstName', 'email', 'phone'].some((k) => map[k] !== undefined) : kind === 'appointments' ? (map.start !== undefined || map.date !== undefined) && ['client', 'firstName', 'email', 'phone'].some((k) => map[k] !== undefined) : ['packages', 'memberships', 'formulas'].includes(kind) ? ['client', 'firstName', 'email', 'phone'].some((k) => map[k] !== undefined) && !missingRequired.length : kind === 'balances' ? ['client', 'firstName', 'email', 'phone'].some((k) => map[k] !== undefined) && ['credit', 'owed', 'balance'].some((k) => map[k] !== undefined) : !missingRequired.length;

  const read = async (f?: File | null) => {
    if (!f) return; setErr(''); setCheck(null); setQs(null); setDone(null);
    if (f.size > 25 * 1024 * 1024) { setErr('That file is over 25 MB. Split it into smaller files, or export fewer columns.'); return; }
    setReading(true); let rows: string[][] = [];
    try { rows = await readRows(f); } catch (e: any) { setReading(false); setErr(e?.message || 'We couldn’t read that file.'); return; }
    setReading(false); if (rows.length < 2) { setErr('We couldn’t find any rows in that file. Is it the export?'); return; }
    const h = rows[0]; const w = h.length; let k = kind;
    if (startKind === 'other') { k = guessKind(h); setKind(k); setGuessed(true); }
    setFile(f.name); setHeaders(h); setBody(rows.slice(1).map((r) => (r.length < w ? [...r, ...Array(w - r.length).fill('')] : r))); setMap(autoMatch(k, h)); setStep(1);
  };
  React.useEffect(() => { if (headers.length) setMap(autoMatch(kind, headers)); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Questions: for appointments, who's who and which service — asked once, remembered.
  const loadQuestions = async () => {
    if (kind !== 'appointments') return null; setBusy(true); const r = await payPost('/api/import', { tenantId, action: 'questions', kind, rows: good.slice(0, 400).map((x) => x.data) }); setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t work.'); return null; }
    setQs(r); setStaffMap(Object.fromEntries(r.staff.map((s: any) => [s.name, s.suggest || '']))); setServiceMap(Object.fromEntries(r.services.map((s: any) => [s.name, s.suggest || '__keep']))); return r;
  };
  const marketingQ = kind === 'clients' && (map.emailOk !== undefined || map.smsOk !== undefined);
  const toQuestions = async () => {
    const q = await loadQuestions();
    const needs = marketingQ || (q && (q.staff.some((s: any) => !s.sure) || q.services.some((s: any) => !s.sure)));
    if (needs) setStep(2); else await toCheck();
  };
  const toCheck = async () => {
    setBusy(true); setErr(''); let fresh = 0, matched = 0, fills = 0, owed = 0, known = 0, creditC = 0, owedC = 0; const samples: any[] = [];
    for (let i = 0; i < good.length; i += 400) { const r = await payPost('/api/import', { tenantId, action: 'check', kind, rows: good.slice(i, i + 400).map((x) => x.data) }); if (!r.ok) { setErr(r.error || 'That didn’t work.'); setBusy(false); return; }
      fresh += r.fresh; matched += r.matched; fills += r.fills; owed += kind === 'giftcards' ? r.owedCents || 0 : 0; creditC += r.creditCents || 0; owedC += kind === 'balances' ? r.owedCents || 0 : 0; known += r.knownClients || 0; samples.push(...(r.samples || [])); }
    setCheck({ fresh, matched, fills, owed, known, creditCents: creditC, owedCents: owedC, samples: samples.slice(0, 4) }); setBusy(false); setStep(3);
  };
  const save = async () => {
    const importId = `imp${Date.now().toString(36)}`; const appName = APPS.find((a) => a.id === app)?.name || ''; const tot: any = { added: 0, filled: 0, skipped: 0, clientsAdded: 0, owedCents: 0, made: 0 }; setProgress(0); setErr('');
    const step0 = kind === 'appointments' ? 300 : ['giftcards', 'packages', 'memberships', 'balances', 'formulas', 'discounts'].includes(kind) ? 150 : 400;
    for (let i = 0; i < good.length; i += step0) {
      const r = await payPost('/api/import', { tenantId, action: 'save', kind, importId, app, appName, keepMarketing, reminders, staffMap, serviceMap, skipped: i === 0 ? skipped.length : 0, rows: good.slice(i, i + step0).map((x) => x.data) });
      if (!r.ok) { setErr(`${r.error || 'That stopped partway.'} What was saved can be undone from Moving in.`); setProgress(null); return; }
      for (const k of Object.keys(tot)) tot[k] += Number(r[k]) || 0; setProgress(Math.min(100, Math.round(((i + step0) / good.length) * 100)));
    }
    setDone(tot); setProgress(null); onDone();
  };

  // Side by side
  const matchedCols = new Set(Object.values(map)); const showCols = headers.map((h, i) => ({ h, i })).filter(({ i }) => body.slice(0, 30).some((r) => r[i])).slice(0, 6);
  const sample = good.length ? [0, 1, 2].map((j) => good[(j * 7 + shuffle * 3) % good.length]).filter((x, j, a) => a.indexOf(x) === j) : [];
  const Card2 = ({ r }: { r: CleanRow }) => { const d = r.data; const line = (t: any, c = MUTED) => t ? <p className="text-[12.5px]" style={{ color: c }}>{t}</p> : null;
    const probs = r.problems.map((p, i) => <p key={i} className="text-[12px]" style={{ color: AMBER }}>{p}</p>);
    if (kind === 'appointments') { const dt = new Date(`${d.when}:00`); return <div className="grid grid-cols-[64px_1fr] items-center gap-3 p-3" style={card}><div className="border-r text-center" style={{ borderColor: LINE }}><p className="text-[10.5px] uppercase" style={{ color: MUTED }}>{dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p><p className="text-[15px] font-semibold">{dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}</p></div>
      <div className="min-w-0"><p className="truncate text-[14px] font-semibold">{d.client}</p>{line(`${d.service || 'Appointment'}${d.staff ? ` · ${d.staff}` : ''}${d.price != null ? ` · ${$(d.price)}` : ''}`)}{line(d.status === 'cancelled' ? 'Cancelled — kept as history' : d.status === 'no_show' ? 'No-show — kept as history' : +dt < Date.now() ? 'Past visit — history' : 'Upcoming — booked as is', d.status === 'cancelled' || d.status === 'no_show' ? MUTED : +dt < Date.now() ? MUTED : GREEN)}{probs}</div></div>; }
    if (kind === 'giftcards') return <div className="p-3" style={card}><div className="flex items-baseline justify-between"><p className="font-mono text-[13px]">{d.code}</p><p className="text-[15px] font-bold">{$(d.balance)}</p></div>{line(`${d.holder || 'Not linked to a client — it works by code'}${d.initial > d.balance ? ` · was ${$(d.initial)}` : ''}`)}{probs}</div>;
    if (kind === 'packages') return <div className="p-3" style={card}><p className="text-[14px] font-semibold">{d.client}</p>{line(`${d.package} · ${d.remaining} left${d.expires ? ` · until ${d.expires}` : ''}`)}{probs}</div>;
    if (kind === 'memberships') return <div className="p-3" style={card}><div className="flex justify-between"><p className="text-[14px] font-semibold">{d.client}</p><p className="text-[14px]">{d.price != null ? `${$(d.price)}/${d.interval === 'yearly' ? 'yr' : 'mo'}` : ''}</p></div>{line(`${d.plan} · next charge ${d.next}`)}{probs}</div>;
    if (kind === 'balances') return <div className="p-3" style={card}><p className="text-[14px] font-semibold">{d.client}</p>{line([d.credit ? `${$(d.credit)} credit` : '', d.owed ? `owes ${$(d.owed)}` : ''].filter(Boolean).join(' · '), d.owed ? AMBER : GREEN)}{line(d.note)}{probs}</div>;
    if (kind === 'formulas') return <div className="p-3" style={card}><div className="flex justify-between"><p className="text-[14px] font-semibold">{d.client}</p><p className="text-[12.5px]" style={{ color: MUTED }}>{d.date || ''}</p></div>{line([d.service, d.staff].filter(Boolean).join(' · '))}<p className="mt-1 line-clamp-3 whitespace-pre-wrap font-mono text-[12.5px]">{d.formula}</p>{probs}</div>;
    if (kind === 'discounts') return <div className="p-3" style={card}><div className="flex justify-between"><p className="font-mono text-[13px]">{d.code}</p><p className="text-[15px] font-bold">{d.type === 'percentage' ? `${d.value}%` : $(d.value)} off</p></div>{line([d.description, d.ends ? `until ${d.ends}` : '', d.limit ? `${d.used || 0} of ${d.limit} used` : ''].filter(Boolean).join(' · '))}{probs}</div>;
    if (kind === 'services') return <div className="p-3" style={card}><div className="flex justify-between"><p className="text-[14px] font-semibold">{d.name}</p><p className="text-[14px]">{$(Number(d.price) || 0)}</p></div>{line(`${d.duration} min${d.category ? ` · ${d.category}` : ''} · hidden from booking until you check it`)}{probs}</div>;
    if (kind === 'products') return <div className="p-3" style={card}><div className="flex justify-between"><p className="text-[14px] font-semibold">{d.name}</p><p className="text-[14px]">{d.price != null ? $(d.price) : '—'}</p></div>{line(`${d.sku ? `SKU ${d.sku} · ` : ''}${d.stock != null ? `${d.stock} in stock` : 'no stock count'}`)}{probs}</div>;
    const ini = String(d.name || '?').split(' ').map((x: string) => x[0]).slice(0, 2).join('').toUpperCase();
    return <div className="flex gap-3 p-3" style={card}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: SOFT }}>{ini}</span><div className="min-w-0"><p className="truncate text-[14px] font-semibold">{d.name}</p>{line([d.phone, d.email].filter(Boolean).join(' · '))}{line(d.notes?.general ? `Note: ${String(d.notes.general).slice(0, 70)}` : d.birthday ? `Birthday ${String(d.birthday).replace(/^--/, '')}` : null)}{probs}</div></div>;
  };
  const steps = ['File', 'Preview', 'Questions', 'Bring in'];
  const A = APPS.find((a) => a.id === app);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label={`Bring in ${NOUN[kind][1]}`}>
      <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(22,23,26,.18)' }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[680px] flex-col gap-4 overflow-y-auto bg-white p-5 md:p-7" style={{ borderLeft: `1px solid ${LINE}` }}>
        <div className="flex items-start justify-between gap-3"><div><p className={lab} style={{ color: MUTED }}>{NOUN[kind][1]}{A && A.id !== 'other' ? ` · from ${A.name.toLowerCase()}` : ''}{file ? ` · ${body.length.toLocaleString()} rows` : ''}</p>
          <h2 className="text-[26px] font-normal tracking-[-0.02em]">{done ? 'Done' : step === 0 ? `Bring in ${NOUN[kind][1]}` : step === 1 ? 'Here’s how they’ll look' : step === 2 ? 'A few quick questions' : 'Ready to bring in'}</h2></div>
          <button type="button" onClick={onClose} className="text-[24px] leading-none" style={{ color: MUTED }} aria-label="Close">×</button></div>
        <div className="flex gap-1.5">{steps.map((n, i) => <div key={n} className="flex flex-1 flex-col gap-1.5"><div className="h-1 rounded-full" style={{ background: i <= step ? INK : LINE }} /><span className="text-[11.5px]" style={{ color: i === step ? INK : MUTED, fontWeight: i === step ? 600 : 400 }}>{n}</span></div>)}</div>

        {step === 0 && <>
          {startKind === 'other' ? <p className="rounded-2xl p-3.5 text-[14px] leading-relaxed" style={{ background: SOFT }}>Drop any export from your old app — we’ll work out whether it’s clients, appointments, gift cards, packages, services or products.</p>
            : <p className="rounded-2xl p-3.5 text-[14px] leading-relaxed" style={{ background: SOFT }}><b>Getting the file:</b> {howToGet(kind, app)}</p>}
          <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-dashed px-4 py-12 text-center" style={{ borderColor: drag ? INK : '#c9cacd', background: drag ? SOFT : '#fff' }}>
            <span className="text-[16px] font-semibold">{reading ? 'Reading…' : 'Drop the file here'}</span><span className="text-[13px]" style={{ color: MUTED }}>CSV or Excel — or <u>choose a file</u></span>
            <input type="file" accept=".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {kind === 'appointments' && startKind !== 'other' && <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>Upcoming visits come over exactly as booked. Nobody gets a text about it unless you choose to.</p>}
          {kind === 'giftcards' && startKind !== 'other' && <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>The codes on cards people already have keep working here. Balances count as money owed to clients, not new sales.</p>}
          {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
        </>}

        {step === 1 && cleaned && <>
          {guessed && <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl p-3 text-[14px]" style={{ background: SOFT }}><span>This looks like <b>{NOUN[kind][1]}</b>.</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)} aria-label="What this file is" className="h-9 rounded-full border bg-white px-3 text-[13.5px]" style={{ borderColor: LINE }}>{(Object.keys(NOUN) as ImportKind[]).map((k) => <option key={k} value={k}>{NOUN[k][1][0].toUpperCase() + NOUN[k][1].slice(1)}</option>)}</select></div>}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-2"><p className="text-[12px] font-semibold" style={{ color: MUTED }}>YOUR FILE</p>
              <div className="overflow-x-auto" style={card}><table className="w-full text-[11.5px]"><thead><tr>{showCols.map(({ h, i }) => <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold" style={matchedCols.has(i) ? { background: '#e9f3ed', color: GREEN } : { background: SOFT, color: MUTED }}>{h || `Column ${i + 1}`}</th>)}</tr></thead>
                <tbody>{body.slice(0, 4).map((r, j) => <tr key={j} style={{ borderTop: `1px solid ${LINE}` }}>{showCols.map(({ i }) => <td key={i} className="max-w-[110px] truncate whitespace-nowrap px-2 py-1.5" style={{ color: matchedCols.has(i) ? INK : '#b9babd' }}>{r[i]}</td>)}</tr>)}</tbody></table></div>
              <p className="text-[12px]" style={{ color: MUTED }}>Green columns come over. <button type="button" onClick={() => setCols(!cols)} className="font-semibold underline">{cols ? 'Hide' : 'Change'} which column is which</button></p></div>
            <div className="min-w-0 space-y-2"><p className="text-[12px] font-semibold" style={{ color: MUTED }}>HERE</p>{sample.map((r) => <Card2 key={r.row} r={r} />)}
              {good.length > 3 && <button type="button" onClick={() => setShuffle(shuffle + 1)} className="block w-full text-center text-[12.5px] underline" style={{ color: MUTED }}>Show 3 others</button>}</div>
          </div>
          {cols && <div className="overflow-hidden" style={card}>{fields.map((f, i) => { const col = map[f.key]; return <div key={f.key} className="grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[170px_1fr]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
            <span className="text-[14px]">{f.label}{f.required && <span style={{ color: RED }}> *</span>}</span>
            <select value={col ?? -1} onChange={(e) => { const v = Number(e.target.value); setMap((m) => { const o = { ...m }; if (v < 0) delete o[f.key]; else o[f.key] = v; return o; }); }} className="h-10 w-full rounded-xl border bg-white px-3 text-[14px]" style={{ borderColor: LINE }} aria-label={f.label}>
              <option value={-1}>Not in my file</option>{headers.map((h, j) => <option key={j} value={j}>{h || `Column ${j + 1}`}</option>)}</select></div>; })}</div>}
          <div className="grid grid-cols-3 gap-2">{[[good.length, `${NOUN[kind][1]} ready`, INK], [cleaned.merged, 'duplicates joined', MUTED], [skipped.length, 'left out', skipped.length ? AMBER : MUTED]].map(([n, l, c]) => <div key={String(l)} className="rounded-2xl p-3" style={{ background: SOFT }}><p className="text-[24px] font-normal tracking-[-0.03em]" style={{ color: c as string }}>{Number(n).toLocaleString()}</p><p className="text-[12px]" style={{ color: MUTED }}>{l}</p></div>)}</div>
          {(problems.length > 0 || skipped.length > 0) && <details className="rounded-2xl p-3 text-[13.5px]" style={{ background: '#fdf3e6' }}><summary className="cursor-pointer font-semibold" style={{ color: AMBER }}>See what was left out and why</summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">{[...skipped.map((r) => `Row ${r.row}: ${r.skip}`), ...problems.flatMap((r) => r.problems.map((p) => `Row ${r.row} (${r.data.name}): ${p}`))].slice(0, 200).map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
          {!nameOk && <p className="text-[14px] font-semibold" style={{ color: RED }}>We couldn’t find {missingRequired.length ? missingRequired.map((f) => f.label.toLowerCase()).join(' and ') : 'the key columns'} — <button type="button" onClick={() => setCols(true)} className="underline">choose the columns</button>.</p>}
          {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
        </>}

        {step === 2 && <>
          {marketingQ && <div className="space-y-2"><p className="text-[17px] font-medium">Their marketing choices</p>
            <label className="flex items-start gap-3 rounded-2xl p-3.5 text-[14px]" style={{ background: SOFT }}><input type="checkbox" checked={keepMarketing} onChange={(e) => setKeepMarketing(e.target.checked)} className="mt-1 h-4 w-4" />
              <span><b>Keep the choices they made in {A && A.id !== 'other' ? A.name : 'the old app'}.</b> Anyone who said no stays a no. A yes is kept with a note that it came from the import — only keep it if they really agreed there.</span></label></div>}
          {qs && qs.staff.some((s: any) => !s.sure) && <div className="space-y-1"><p className="text-[17px] font-medium">Who is who?</p><p className="text-[13.5px]" style={{ color: MUTED }}>Names in the file, matched to your team. We’ll remember these for every file.</p>
            {qs.staff.map((s: any) => <div key={s.name} className="grid grid-cols-[1fr_20px_1fr] items-center gap-2 py-2" style={{ borderTop: `1px solid ${LINE}` }}><span className="text-[14px]">{s.name} <span style={{ color: MUTED }}>· {s.count}</span></span><span style={{ color: MUTED }}>→</span>
              <select value={staffMap[s.name] || ''} onChange={(e) => setStaffMap({ ...staffMap, [s.name]: e.target.value })} aria-label={`Who is ${s.name}`} className="h-10 rounded-xl border px-3 text-[14px]" style={{ borderColor: staffMap[s.name] ? LINE : AMBER, background: staffMap[s.name] ? '#fff' : '#fffaf3' }}>
                <option value="">Choose…</option>{qs.team.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="__past">Past team member — keep for history</option></select></div>)}</div>}
          {qs && qs.services.some((s: any) => !s.sure) && <div className="space-y-1"><p className="pt-2 text-[17px] font-medium">Which service is it?</p><p className="text-[13.5px]" style={{ color: MUTED }}>Names in the file that aren’t exactly on your menu.</p>
            {qs.services.filter((s: any) => !s.sure).map((s: any) => <div key={s.name} className="grid grid-cols-[1fr_20px_1fr] items-center gap-2 py-2" style={{ borderTop: `1px solid ${LINE}` }}><span className="text-[14px]">{s.name} <span style={{ color: MUTED }}>· {s.count}</span></span><span style={{ color: MUTED }}>→</span>
              <select value={serviceMap[s.name] || '__keep'} onChange={(e) => setServiceMap({ ...serviceMap, [s.name]: e.target.value })} aria-label={`Which service is ${s.name}`} className="h-10 rounded-xl border bg-white px-3 text-[14px]" style={{ borderColor: LINE }}>
                <option value="__keep">Keep the name “{s.name}”</option>{qs.menu.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>)}</div>}
          {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
        </>}

        {step === 3 && check && !done && <>
          <div className="space-y-2 rounded-2xl p-4 text-[14.5px] leading-relaxed" style={{ background: SOFT }}>
            {kind === 'appointments' ? <><p><b>{(qs?.upcoming ?? 0).toLocaleString()}</b> upcoming visits come in as booked, and <b>{(qs?.past ?? 0).toLocaleString()}</b> past ones as history.</p>{check.fresh - check.known > 0 && <p><b>{(check.fresh - check.known).toLocaleString()}</b> {check.fresh - check.known === 1 ? 'visit is for someone' : 'visits are for people'} not in your clients yet — they’re added.</p>}<p style={{ color: MUTED }}>Running the same file again later only adds the new ones.</p></>
              : kind === 'giftcards' ? <><p><b>{check.fresh.toLocaleString()}</b> gift cards come in, with <b>{$(check.owed / 100)}</b> still owed to clients.</p>{check.matched > 0 && <p>{check.matched} are already here (same code) and are skipped.</p>}</>
              : kind === 'memberships' ? <><p><b>{check.fresh.toLocaleString()}</b> members come in with their next charge date.</p>{check.fresh - check.known > 0 && <p>{check.fresh - check.known} aren’t in your clients yet — they’re added.</p>}<p>Card details can’t be moved between apps, so after this, send members their add-your-card link from <a href="/import/cards" className="font-semibold underline underline-offset-4">Cards on file</a>. A charge with no card yet waits — it doesn’t fail.</p><p style={{ color: MUTED }}>A plan that isn’t on your list yet is made, hidden from sale. Someone who’s already a member here is left as they are.</p></>
              : kind === 'balances' ? <><p><b>{$(((check as any).creditCents || 0) / 100)}</b> in store credit goes on clients’ accounts, to use at checkout.</p><p><b>{$(((check as any).owedCents || 0) / 100)}</b> owed goes on their balance, to pay at a visit or by link.</p>{check.fresh - check.known > 0 && <p>{check.fresh - check.known} aren’t in your clients yet — they’re added.</p>}</>
              : kind === 'formulas' ? <><p><b>{check.fresh.toLocaleString()}</b> formula notes go on clients’ records — they show in the formula history on each visit.</p>{check.fresh - check.known > 0 && <p>{check.fresh - check.known} are for people not in your clients yet — they’re added.</p>}</>
              : kind === 'discounts' ? <><p><b>{check.fresh.toLocaleString()}</b> codes come in and keep working, with their dates and uses so far.</p>{check.matched > 0 && <p>{check.matched} are already here (same code) and are skipped.</p>}</>
              : kind === 'packages' ? <><p><b>{check.fresh.toLocaleString()}</b> package balances go on clients’ accounts.</p>{check.fresh - check.known > 0 && <p>{check.fresh - check.known} are for people not in your clients yet — they’re added.</p>}<p style={{ color: MUTED }}>A package that isn’t on your list yet is made, hidden from sale.</p></>
              : <><p><b>{check.fresh.toLocaleString()}</b> new {check.fresh === 1 ? NOUN[kind][0] : NOUN[kind][1]} will be added.</p><p><b>{check.matched.toLocaleString()}</b> already here{check.fills ? <> — <b>{check.fills}</b> get missing details filled in. Nothing already here is overwritten.</> : '.'}</p>
                {check.samples.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>e.g. {check.samples.map((x: any) => `${x.name}: adds ${x.adds.join(', ')}`).join(' · ')}</p>}
                {kind === 'services' && <p style={{ color: MUTED }}>New services come in hidden from your booking page, so you can check prices and lengths first.</p>}</>}
          </div>
          {kind === 'appointments' && <label className="flex items-start gap-3 rounded-2xl p-3.5 text-[14px]" style={{ border: `1px solid ${LINE}` }}><input type="checkbox" checked={reminders} onChange={(e) => setReminders(e.target.checked)} className="mt-1 h-4 w-4" />
            <span><b>Send their usual reminders for upcoming visits from here.</b> Leave this off while your old app is still sending them, so nobody gets two. Turn reminders on for these on switch-over day.</span></label>}
          {progress !== null && <div className="h-2 rounded-full" style={{ background: SOFT }}><div className="h-2 rounded-full transition-all" style={{ width: `${progress}%`, background: INK }} /></div>}
          {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
        </>}
        {done && <div className="space-y-2 rounded-2xl p-4" style={{ background: '#e9f3ed' }}><p className="text-[17px] font-bold" style={{ color: GREEN }}>{done.added.toLocaleString()} {done.added === 1 ? NOUN[kind][0] : NOUN[kind][1]} brought in{done.filled ? `, ${done.filled.toLocaleString()} filled in` : ''}.</p>
          <p className="text-[14px]">{[done.clientsAdded ? `${done.clientsAdded} new clients added` : '', done.owedCents ? `${$(done.owedCents / 100)} in gift card balances` : '', done.skipped ? `${done.skipped} already here, skipped` : ''].filter(Boolean).join(' · ')}</p></div>}

        <div className="mt-auto flex gap-2 pt-2">
          {done ? <button type="button" onClick={onClose} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Back to Moving in</button> : <>
            {step > 0 && <button type="button" onClick={() => setStep(step === 3 && !(marketingQ || qs) ? 1 : step - 1)} className={btn} style={{ border: `1px solid ${LINE}` }}>Back</button>}
            {step === 0 && <button type="button" onClick={onClose} className={btn} style={{ border: `1px solid ${LINE}` }}>Cancel</button>}
            {step === 1 && <button type="button" disabled={!nameOk || !good.length || busy} onClick={toQuestions} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{busy ? 'Checking…' : 'Looks right'}</button>}
            {step === 2 && <button type="button" disabled={busy || (qs && qs.staff.some((s: any) => !staffMap[s.name]))} onClick={toCheck} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{busy ? 'Checking…' : 'Next'}</button>}
            {step === 3 && <button type="button" disabled={progress !== null || (!check?.fresh && !check?.fills)} onClick={save} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{progress !== null ? `Saving… ${progress}%` : kind === 'giftcards' ? `Bring in ${check.fresh} cards · ${$(check.owed / 100)}` : `Bring in ${check.fresh.toLocaleString()}${check.fills ? ` and fill in ${check.fills}` : ''}`}</button>}
          </>}
        </div>
      </div>
    </div>);
}

// ─────────────────────────────── SERVICES CHECK ───────────────────────────────
function ServicesCheck({ tenantId, firestore, onClose, onDone }: { tenantId: string; firestore: any; onClose: () => void; onDone: () => void }) {
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/services`) : null), [firestore, tenantId]);
  const { data } = useCollection<any>(q); const list = (data || []).filter((s: any) => s.createdVia === 'import' && s.status !== 'archived').sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const [on, setOn] = React.useState<Set<string>>(new Set()); const [busy, setBusy] = React.useState(false);
  const save = async (ids: string[]) => { setBusy(true); await payPost('/api/import', { tenantId, action: 'moving', moving: { showServices: ids } }); setBusy(false); onDone(); onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Check your menu"><button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(22,23,26,.18)' }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[640px] flex-col gap-4 overflow-y-auto bg-white p-5 md:p-7">
        <div className="flex items-start justify-between"><div><p className={lab} style={{ color: MUTED }}>{list.length} services brought in</p><h2 className="text-[26px] font-normal tracking-[-0.02em]">Check your menu</h2><p className="text-[14px]" style={{ color: MUTED }}>Hidden from your booking page until you switch them on. Change prices and lengths on Services.</p></div><button type="button" onClick={onClose} className="text-[24px]" style={{ color: MUTED }} aria-label="Close">×</button></div>
        <div className="overflow-hidden" style={card}>{list.map((s: any, i: number) => { const shown = !s.isPrivate || on.has(s.id); const flag = !(Number(s.price) > 0) ? 'No price in the file — set it on Services' : '';
          return <div key={s.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-4 py-3" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}><span className="min-w-0"><span className="block truncate text-[14.5px] font-semibold">{s.name}</span>{flag && <span className="block text-[12px]" style={{ color: AMBER }}>{flag}</span>}</span><span className="text-[13.5px]" style={{ color: MUTED }}>{s.duration} min</span><span className="text-[14px]">{$(Number(s.price) || 0)}</span>
            <button type="button" role="switch" aria-checked={shown} aria-label={`Show ${s.name} on booking`} disabled={!s.isPrivate} onClick={() => setOn((x) => { const y = new Set(x); if (y.has(s.id)) y.delete(s.id); else y.add(s.id); return y; })} className="relative h-7 w-12 rounded-full disabled:opacity-60" style={{ background: shown ? INK : '#dcdde0' }}><span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" style={{ left: shown ? 23 : 3 }} /></button></div>; })}</div>
        <div className="mt-auto flex gap-2"><a href="/services" className={`${btn} inline-flex items-center`} style={{ border: `1px solid ${LINE}` }}>Edit on Services</a>
          <button type="button" disabled={busy || !on.size} onClick={() => save([...on])} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Show {on.size || ''} on booking</button>
          <button type="button" disabled={busy || !list.some((s: any) => s.isPrivate)} onClick={() => save(list.filter((s: any) => s.isPrivate).map((s: any) => s.id))} className={btn} style={{ background: SOFT }}>Show all</button></div>
      </div></div>);
}

// ─────────────────────────────── MOVING IN ───────────────────────────────
const SWITCH: { key: string; title: string; sub: string; href?: string; cta?: string }[] = [
  { key: 'latest', title: 'Bring in appointments booked since your first import', sub: 'Run the same appointments export again — only the new ones come over.' },
  { key: 'oldoff', title: 'Turn off online booking in your old app', sub: 'So nobody books there after today.' },
  { key: 'links', title: 'Change your booking links', sub: 'Instagram, Google, Facebook and your website — copy your new link.', cta: 'Copy link' },
  { key: 'reminders', title: 'Turn on reminders here', sub: 'Your old app stops sending them once you switch it off.', href: '/settings/automations', cta: 'Automations' },
  { key: 'tell', title: 'Tell your clients', sub: 'One text with your new booking link — only to people who said yes to texts.', href: '/import/tell', cta: 'Write it' },
  { key: 'cards', title: 'Cards on file and memberships', sub: 'Card details can’t be moved between apps. Send members a link to add theirs before their next charge.', href: '/import/cards', cta: 'Cards on file' },
  { key: 'number', title: 'Your texting number', sub: 'Clients know your old number — bring it over, or introduce the new one in your text.' },
];

export default function MovingInPage() {
  const { selectedTenant, role } = useTenant() as any; const { firestore } = useFirebase() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [st, setSt] = React.useState<any>(null); const [drawer, setDrawer] = React.useState<Kind | null>(null); const [svcCheck, setSvcCheck] = React.useState(false);
  const [history, setHistory] = React.useState<any[]>([]); const [showSwitch, setShowSwitch] = React.useState(false); const [copied, setCopied] = React.useState(false);
  const load = React.useCallback(() => { if (!tenantId || !isManager) return; payPost('/api/import', { tenantId, action: 'status' }).then((r) => r.ok && setSt(r)); payPost('/api/import', { tenantId, action: 'list' }).then((r) => r.ok && setHistory(r.imports)); }, [tenantId, isManager]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { const k = new URLSearchParams(window.location.search).get('kind'); if (k && ['clients', 'services', 'products', 'appointments', 'giftcards', 'packages', 'memberships', 'balances', 'formulas', 'discounts', 'other'].includes(k)) setDrawer(k as Kind); }, []);
  const setMoving = async (m: any) => { setSt((s: any) => ({ ...s, moving: { ...(s?.moving || {}), ...m, switch: { ...(s?.moving?.switch || {}), ...(m.switch || {}) } } })); await payPost('/api/import', { tenantId, action: 'moving', moving: m }); };
  const undo = async (id: string) => { if (!window.confirm('Undo this import? What it added is removed unless it’s been used since, and anything it filled in on existing records is cleared.')) return; const r = await payPost('/api/import', { tenantId, action: 'undo', importId: id }); if (r.ok) { alert(`Removed ${r.removed}.${r.kept ? ` Kept ${r.kept} that have been used since.` : ''}`); load(); } else alert(r.error || 'That didn’t work.'); };
  if (!isManager) return <div className="p-6"><AppHeader title="Moving in" /><p className="mt-6" style={{ color: MUTED }}>Moving in is for managers.</p></div>;
  const app = st?.moving?.app || ''; const moved = st?.moved || {};
  const stateOf = (k: Kind | 'team') => k === 'team' ? ((st?.team || 0) > 1 ? 'done' : 'todo') : k === 'services' && st?.servicesHidden ? 'review' : (moved[k] || 0) > 0 ? 'done' : 'todo';
  const OPTIONAL = ['memberships', 'balances', 'formulas', 'discounts'];   // only if the old app had them — not counted in the progress
  const core = TILES.map((t) => t.kind).filter((k) => !OPTIONAL.includes(k as string)); const doneN = core.filter((k) => stateOf(k) === 'done').length; const next = core.find((k) => stateOf(k) === 'todo');
  const switchDone = SWITCH.filter((x) => st?.moving?.switch?.[x.key]).length; const allIn = ['clients', 'services', 'appointments'].every((k) => stateOf(k as Kind) !== 'todo');
  const bookingUrl = typeof window !== 'undefined' && st ? `${window.location.origin}${st.bookingPath}` : '';
  const countOf = (k: Kind | 'team') => k === 'team' ? st?.team : k === 'giftcards' && st?.owedCents ? $(st.owedCents / 100) : k === 'services' && st?.servicesHidden ? st.servicesHidden : moved[k];
  return (
    <div className="min-h-screen" style={{ color: INK, backgroundColor: '#f7f7f8', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%), radial-gradient(100% 70% at 100% 0%, #e8eaf0 0%, transparent 50%)' }}>
      <AppHeader title="Moving in" />
      <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><div className="flex items-center gap-2"><span className={lab} style={{ color: MUTED }}>coming from</span>
            <select value={app} onChange={(e) => setMoving({ app: e.target.value })} aria-label="Which app you’re coming from" className="h-8 rounded-full border bg-white px-3 text-[13px] font-semibold" style={{ borderColor: LINE }}><option value="">Choose…</option>{APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <h1 className="text-[36px] font-normal tracking-[-0.03em]">{allIn && switchDone >= 4 ? 'You’re moved in.' : 'Moving in'}</h1>
            <p className="text-[14.5px]" style={{ color: MUTED }}>Bring each part over from your old app. You’ll see everything before it’s saved, and every import can be undone.</p></div>
          <div className="w-full max-w-[340px]"><div className="mb-1.5 flex justify-between text-[13px]"><span>{doneN} of {core.length} moved</span>
            <label className="flex items-center gap-1.5" style={{ color: MUTED }}>switch-over day <input type="date" value={st?.moving?.switchDate || ''} onChange={(e) => setMoving({ switchDate: e.target.value })} className="h-7 rounded-lg border bg-white px-1.5 text-[12.5px]" style={{ borderColor: LINE }} aria-label="Switch-over day" /></label></div>
            <div className="h-2 rounded-full" style={{ background: SOFT }}><div className="h-2 rounded-full" style={{ width: `${(doneN / core.length) * 100}%`, background: INK }} /></div></div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map((t) => { const s = stateOf(t.kind); const isNext = t.kind === next; const badge = s === 'done' ? ['Moved', GREEN, '#e9f3ed'] : s === 'review' ? ['Needs a look', AMBER, '#fdf3e6'] : isNext ? ['Next', '#fff', INK] : OPTIONAL.includes(t.kind as string) ? ['If you had them', MUTED, SOFT] : ['Not started', INK, SOFT];
            const cta = t.kind === 'team' ? (s === 'done' ? 'See your team' : 'Add your team') : t.kind === 'services' && s === 'review' ? `Review ${st?.servicesHidden}` : s === 'done' ? 'Bring in more' : 'Upload a file';
            const go = () => { if (t.kind === 'team') window.location.href = '/staff'; else if (t.kind === 'services' && s === 'review') setSvcCheck(true); else setDrawer(t.kind as Kind); };
            return <div key={t.kind} className="flex flex-col gap-2 p-4" style={{ ...card, boxShadow: isNext ? `0 0 0 2px ${INK}` : undefined }}>
              <div className="flex items-center justify-between gap-2"><span className="text-[15.5px] font-semibold">{t.title}</span><span className="inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-semibold" style={{ color: badge[1], background: badge[2] }}>{badge[0]}</span></div>
              <p className="min-h-[34px] text-[12.5px] leading-snug" style={{ color: MUTED }}>{t.kind === 'team' ? (s === 'done' ? 'Usually quicker to add by hand than to export' : 'Usually quicker to add by hand — then they show up in appointments') : t.sub}</p>
              {countOf(t.kind) ? <p className="text-[26px] font-normal tracking-[-0.03em]">{typeof countOf(t.kind) === 'number' ? Number(countOf(t.kind)).toLocaleString() : countOf(t.kind)}</p> : null}
              <button type="button" onClick={go} className="mt-auto h-10 rounded-full text-[13.5px] font-semibold" style={isNext ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff' }}>{cta}</button></div>; })}
          <button type="button" onClick={() => setDrawer('other')} className="flex flex-col justify-center gap-1.5 rounded-[18px] border-[1.5px] border-dashed p-4 text-left" style={{ borderColor: '#c9cacd' }}><span className="text-[15px] font-semibold">Something else?</span><span className="text-[12.5px]" style={{ color: MUTED }}>Drop any export — we’ll work out what it is.</span></button>
        </div>

        <section className="overflow-hidden" style={card}>
          <button type="button" onClick={() => setShowSwitch(!showSwitch)} className="flex w-full items-center justify-between gap-3 p-4 text-left"><span><span className="block text-[15.5px] font-semibold">Switch-over day{st?.moving?.switchDate ? ` · ${new Date(`${st.moving.switchDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</span><span className="block text-[13px]" style={{ color: MUTED }}>Do these the same day and clients won’t notice a thing · {switchDone} of {SWITCH.length} done</span></span><span className="text-[14px] font-semibold">{showSwitch ? 'Hide' : 'Open'}</span></button>
          {showSwitch && SWITCH.map((x) => { const on = !!st?.moving?.switch?.[x.key]; return <div key={x.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <button type="button" role="checkbox" aria-checked={on} aria-label={x.title} onClick={() => setMoving({ switch: { [x.key]: !on } })} className="flex h-6 w-6 items-center justify-center rounded-full" style={on ? { background: GREEN } : { border: '1.5px dashed #c9cacd' }}>{on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M5 12l5 5 9-10" /></svg>}</button>
            <span><span className="block text-[14.5px] font-semibold">{x.title}</span><span className="block text-[13px] leading-snug" style={{ color: MUTED }}>{x.sub}</span></span>
            {x.key === 'latest' ? <button type="button" onClick={() => setDrawer('appointments')} className="h-9 rounded-full border px-3.5 text-[13px]" style={{ borderColor: LINE }}>Upload</button>
              : x.key === 'links' ? <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(bookingUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Your booking link', bookingUrl); } }} className="h-9 rounded-full border px-3.5 text-[13px]" style={{ borderColor: LINE }}>{copied ? 'Copied' : 'Copy link'}</button>
              : x.href ? <a href={x.href} className="inline-flex h-9 items-center rounded-full border px-3.5 text-[13px]" style={{ borderColor: LINE }}>{x.cta}</a> : <span />}</div>; })}
        </section>

        {history.length > 0 && <section className="p-5" style={card}><h2 className="text-[15px] font-bold">What came over</h2>
          {history.map((h) => <div key={h.id} className="flex items-center justify-between gap-3 py-3 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="min-w-0"><span className="block font-medium">{h.added.toLocaleString()} {NOUN[h.kind as ImportKind]?.[1] || h.kind}{h.filled ? `, ${h.filled} filled in` : ''}{h.app ? ` · from ${APPS.find((a) => a.id === h.app)?.name || h.app}` : ''}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{new Date(h.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{h.by ? ` · ${h.by}` : ''}{h.undoneAt ? ' · undone' : ''}</span></span>
            {!h.undoneAt && <button type="button" onClick={() => undo(h.id)} className="h-9 shrink-0 rounded-full px-3.5 text-[13.5px] font-semibold" style={{ background: SOFT }}>Undo</button>}</div>)}</section>}
        <p className="pb-6 text-[12.5px]" style={{ color: MUTED }}>Your old app isn’t changed by any of this — keep it until you’re comfortable.</p>
      </main>
      {drawer && <Drawer key={drawer} tenantId={tenantId} startKind={drawer} app={app} onClose={() => { setDrawer(null); load(); }} onDone={load} />}
      {svcCheck && <ServicesCheck tenantId={tenantId} firestore={firestore} onClose={() => setSvcCheck(false)} onDone={load} />}
    </div>);
}
