'use client';
// src/app/(app)/import/page.tsx — BRING YOUR RECORDS FROM ANOTHER APP (lib/import-records, /api/import). For a business
// moving over: pick what (clients, services, products) and where from, upload the export, check how the columns were
// matched, see what will happen (new, filled in, skipped and why) and bring it in. Every import can be undone.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { parseCsv, autoMatch, cleanRow, mergeWithin, FIELDS, APPS, type ImportKind, type CleanRow } from '@/lib/import-records';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const card = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18 } as const;
const pill = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` });
const KINDS: { id: ImportKind; label: string; hint: string }[] = [
  { id: 'clients', label: 'Clients', hint: 'Names, phones, emails, birthdays, notes, marketing choices' },
  { id: 'services', label: 'Services', hint: 'Your menu: names, lengths, prices' },
  { id: 'products', label: 'Products', hint: 'Retail: names, SKUs, prices, stock' },
];
const Step = ({ n, title, children, on }: { n: number; title: string; children: React.ReactNode; on: boolean }) => (
  <section className="p-5 md:p-6" style={{ ...card, opacity: on ? 1 : 0.55 }}>
    <div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold" style={on ? { background: INK, color: '#fff' } : { background: SOFT, color: MUTED }}>{n}</span><h2 className="text-[17px] font-bold">{title}</h2></div>
    {on && <div className="mt-4 space-y-4">{children}</div>}
  </section>);

export default function ImportPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [kind, setKind] = React.useState<ImportKind>('clients'); const [app, setApp] = React.useState('');
  const [file, setFile] = React.useState(''); const [headers, setHeaders] = React.useState<string[]>([]); const [body, setBody] = React.useState<string[][]>([]);
  const [map, setMap] = React.useState<Record<string, number>>({}); const [err, setErr] = React.useState('');
  const [check, setCheck] = React.useState<any>(null); const [checking, setChecking] = React.useState(false);
  const [keepMarketing, setKeepMarketing] = React.useState(true); const [progress, setProgress] = React.useState<number | null>(null); const [done, setDone] = React.useState<any>(null);
  const [history, setHistory] = React.useState<any[]>([]); const [drag, setDrag] = React.useState(false); const [allCols, setAllCols] = React.useState(false);
  const loadHistory = React.useCallback(() => { if (tenantId && isManager) payPost('/api/import', { tenantId, action: 'list' }).then((r) => r.ok && setHistory(r.imports)); }, [tenantId, isManager]);
  React.useEffect(() => { loadHistory(); }, [loadHistory]);
  const reset = () => { setFile(''); setHeaders([]); setBody([]); setMap({}); setCheck(null); setDone(null); setErr(''); setProgress(null); };

  const cleaned = React.useMemo(() => { if (!body.length) return null; const rows = body.map((c, i) => cleanRow(kind, c, map, i + 2)); return mergeWithin(kind, rows); }, [body, map, kind]);
  const good = (cleaned?.rows || []).filter((r) => !r.skip); const skipped = (cleaned?.rows || []).filter((r) => r.skip); const problems = good.filter((r) => r.problems.length);
  const nameOk = kind !== 'clients' ? map.name !== undefined : map.name !== undefined || map.firstName !== undefined || map.email !== undefined || map.phone !== undefined;

  const read = async (f: File | null | undefined) => {
    reset(); if (!f) return;
    if (/\.(xlsx|xls|numbers)$/i.test(f.name)) { setErr('Save the spreadsheet as CSV first (File → Save as / Download → CSV), then choose that file.'); return; }
    if (f.size > 15 * 1024 * 1024) { setErr('That file is over 15 MB. Split it into smaller files, or export fewer columns.'); return; }
    const text = await f.text(); const rows = parseCsv(text);
    if (rows.length < 2) { setErr('We couldn’t find any rows in that file. Is it the CSV export?'); return; }
    const h = rows[0]; const width = h.length; setFile(f.name); setHeaders(h); setBody(rows.slice(1).map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r)));
    setMap(autoMatch(kind, h));
  };
  React.useEffect(() => { if (headers.length) { setMap(autoMatch(kind, headers)); setCheck(null); } }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const runCheck = async () => {
    setChecking(true); setErr(''); let fresh = 0, matched = 0, fills = 0; const samples: any[] = []; let existing = 0;
    for (let i = 0; i < good.length; i += 400) { const r = await payPost('/api/import', { tenantId, action: 'check', kind, rows: good.slice(i, i + 400).map((x) => x.data) }); if (!r.ok) { setErr(r.error || 'That didn’t work.'); setChecking(false); return; } fresh += r.fresh; matched += r.matched; fills += r.fills; existing = r.existing; samples.push(...r.samples); }
    setCheck({ fresh, matched, fills, samples: samples.slice(0, 5), existing }); setChecking(false);
  };
  const save = async () => {
    const importId = `imp${Date.now().toString(36)}`; const appName = APPS.find((a) => a.id === app)?.name || ''; let added = 0, filled = 0; setProgress(0); setErr('');
    for (let i = 0; i < good.length; i += 400) {
      const r = await payPost('/api/import', { tenantId, action: 'save', kind, importId, app, appName, keepMarketing, skipped: i === 0 ? skipped.length : 0, rows: good.slice(i, i + 400).map((x) => x.data) });
      if (!r.ok) { setErr(`${r.error || 'That stopped partway.'} ${added + filled} were saved — you can undo this import below.`); setProgress(null); loadHistory(); return; }
      added += r.added; filled += r.filled; setProgress(Math.min(100, Math.round(((i + 400) / good.length) * 100)));
    }
    setDone({ added, filled, importId }); setProgress(null); loadHistory();
  };
  const undo = async (id: string) => { if (!window.confirm('Undo this import? Records it added are removed unless they’ve been used since, and anything it filled in on existing records is cleared.')) return; const r = await payPost('/api/import', { tenantId, action: 'undo', importId: id }); if (r.ok) { alert(`Removed ${r.removed}.${r.kept ? ` Kept ${r.kept} that have been used since.` : ''}`); loadHistory(); } else alert(r.error || 'That didn’t work.'); };

  if (!isManager) return <div className="p-6"><AppHeader title="Bring your records" /><p className="mt-6" style={{ color: MUTED }}>Importing is for managers.</p></div>;
  const A = APPS.find((a) => a.id === app); const fields = FIELDS[kind]; const noun = kind === 'clients' ? 'client' : kind === 'services' ? 'service' : 'product';
  return (
    <div className="min-h-screen" style={{ color: INK, backgroundColor: '#f7f7f8', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%), radial-gradient(100% 70% at 100% 0%, #e8eaf0 0%, transparent 50%)' }}>
      <AppHeader title="Bring your records" />
      <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
        <div className="pb-2"><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>moving from another app</p>
          <h1 className="text-[34px] font-normal tracking-[-0.03em] md:text-[40px]">Bring your records</h1>
          <p className="mt-1 text-[15px]" style={{ color: MUTED }}>Upload the export from your old app. You’ll see exactly what happens before anything is saved, and you can undo it after.</p></div>

        <Step n={1} title="What are you bringing in?" on>
          <div className="grid gap-2 sm:grid-cols-3">{KINDS.map((k) => <button key={k.id} type="button" onClick={() => setKind(k.id)} className="rounded-2xl p-4 text-left" style={kind === k.id ? { background: INK, color: '#fff' } : { background: SOFT }}><span className="block text-[15.5px] font-bold">{k.label}</span><span className="mt-1 block text-[13px]" style={{ opacity: 0.75 }}>{k.hint}</span></button>)}</div>
          <div><p className="pb-2 text-[13px] font-semibold" style={{ color: MUTED }}>From</p>
            <div className="flex flex-wrap gap-2">{APPS.map((a) => <button key={a.id} type="button" onClick={() => setApp(a.id)} className="h-10 rounded-full px-4 text-[14px] font-medium" style={pill(app === a.id)}>{a.name}</button>)}</div>
            {A && <p className="mt-3 rounded-2xl p-3.5 text-[14px] leading-relaxed" style={{ background: SOFT }}><b>Getting the file:</b> {A.how} Menus change from time to time — if it isn’t where we say, their help pages or support will point you to it.</p>}</div>
        </Step>

        <Step n={2} title="Upload the file" on>
          <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-8 text-center" style={{ borderColor: drag ? INK : '#d6d7da', background: drag ? SOFT : '#fff' }}>
            <span className="text-[15.5px] font-semibold">{file || 'Choose a CSV file'}</span>
            <span className="text-[13px]" style={{ color: MUTED }}>{file ? `${body.length.toLocaleString()} rows · ${headers.length} columns — choose another to replace it` : 'or drop it here · Excel files: save as CSV first'}</span>
            <input type="file" accept=".csv,text/csv,.txt,.tsv" className="hidden" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {err && !headers.length && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
        </Step>

        <Step n={3} title="Check the columns" on={headers.length > 0}>
          <p className="text-[14px]" style={{ color: MUTED }}>We matched what we could. Change any that are wrong, or set them to “Not in my file”.</p>
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: LINE }}>{fields.filter((f) => allCols || f.required || map[f.key] !== undefined || ['name', 'firstName', 'lastName', 'email', 'phone'].includes(f.key)).map((f, i) => { const col = map[f.key]; const sample = col !== undefined ? body.slice(0, 40).map((r) => r[col]).filter(Boolean).slice(0, 2).join(' · ') : '';
            return <div key={f.key} className="grid items-center gap-2 px-4 py-3 sm:grid-cols-[180px_1fr]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
              <span className="text-[14.5px] font-medium">{f.label}{f.required && <span style={{ color: RED }}> *</span>}</span>
              <span className="flex min-w-0 flex-col gap-1"><select value={col ?? -1} onChange={(e) => { const v = Number(e.target.value); setMap((m) => { const o = { ...m }; if (v < 0) delete o[f.key]; else o[f.key] = v; return o; }); setCheck(null); }} className="h-10 w-full rounded-xl border bg-white px-3 text-[14px]" style={{ borderColor: LINE }} aria-label={f.label}>
                <option value={-1}>Not in my file</option>{headers.map((h, j) => <option key={j} value={j}>{h || `Column ${j + 1}`}</option>)}</select>
                {sample && <span className="truncate text-[12.5px]" style={{ color: MUTED }}>e.g. {sample}</span>}</span></div>; })}</div>
          {fields.some((f) => map[f.key] === undefined && !f.required && !['name', 'firstName', 'lastName', 'email', 'phone'].includes(f.key)) && <button type="button" onClick={() => setAllCols(!allCols)} className="text-[14px] font-semibold underline underline-offset-2">{allCols ? 'Show only the matched columns' : `Match more columns (${fields.filter((f) => map[f.key] === undefined && !['name', 'firstName', 'lastName', 'email', 'phone'].includes(f.key)).length} more we can bring in)`}</button>}
          {!nameOk && <p className="text-[14px] font-semibold" style={{ color: RED }}>{kind === 'clients' ? 'Match a name, email or phone column.' : 'Match the name column.'}</p>}
          {kind === 'clients' && (map.emailOk !== undefined || map.smsOk !== undefined) && <label className="flex items-start gap-3 rounded-2xl p-3.5 text-[14px]" style={{ background: SOFT }}><input type="checkbox" checked={keepMarketing} onChange={(e) => setKeepMarketing(e.target.checked)} className="mt-1 h-4 w-4" />
            <span><b>Keep their marketing choices from {A?.name || 'the old app'}.</b> Anyone who said no stays a no. A yes is kept with a note that it came from the import — only keep it if they really agreed there.</span></label>}
        </Step>

        <Step n={4} title="See what will happen" on={!!cleaned && nameOk}>
          {cleaned && <div className="grid grid-cols-3 gap-2">
            {[[good.length, `${noun}s ready`, INK], [cleaned.merged, 'duplicates in the file, joined', MUTED], [skipped.length, 'rows left out', skipped.length ? AMBER : MUTED]].map(([n, l, c]) => <div key={String(l)} className="rounded-2xl p-3.5" style={{ background: SOFT }}><p className="text-[26px] font-normal tracking-[-0.03em]" style={{ color: c as string }}>{Number(n).toLocaleString()}</p><p className="text-[12.5px]" style={{ color: MUTED }}>{l}</p></div>)}</div>}
          {good.length > 0 && <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: LINE }}><table className="w-full text-left text-[13.5px]"><thead><tr style={{ color: MUTED }}>{(kind === 'clients' ? ['Name', 'Phone', 'Email', 'Birthday'] : kind === 'services' ? ['Service', 'Length', 'Price', 'Category'] : ['Product', 'SKU', 'Price', 'Stock']).map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{good.slice(0, 6).map((r) => <tr key={r.row} style={{ borderTop: `1px solid ${LINE}` }}>{(kind === 'clients' ? [r.data.name, r.data.phone, r.data.email, r.data.birthday?.replace(/^--/, '')] : kind === 'services' ? [r.data.name, `${r.data.duration} min`, `$${Number(r.data.price).toFixed(2)}`, r.data.category] : [r.data.name, r.data.sku, r.data.price != null ? `$${Number(r.data.price).toFixed(2)}` : '', r.data.stock]).map((v, i) => <td key={i} className="max-w-[200px] truncate px-3 py-2">{v ?? '—'}</td>)}</tr>)}</tbody></table></div>}
          {(problems.length > 0 || skipped.length > 0) && <details className="rounded-2xl p-3.5 text-[14px]" style={{ background: '#fdf3e6' }}><summary className="cursor-pointer font-semibold" style={{ color: AMBER }}>{problems.length ? `${problems.length} row${problems.length === 1 ? '' : 's'} with something left out` : ''}{problems.length && skipped.length ? ' · ' : ''}{skipped.length ? `${skipped.length} left out` : ''} — see which</summary>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">{[...skipped.map((r) => `Row ${r.row}: ${r.skip}`), ...problems.flatMap((r: CleanRow) => r.problems.map((p) => `Row ${r.row} (${r.data.name}): ${p}`))].slice(0, 200).map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
          {!check ? <button type="button" disabled={checking || !good.length} onClick={runCheck} className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: INK, color: '#fff' }}>{checking ? 'Checking against your records…' : `Check against your ${kind}`}</button>
            : <div className="space-y-2 rounded-2xl p-4 text-[14.5px]" style={{ background: SOFT }}>
              <p><b>{check.fresh.toLocaleString()}</b> new {noun}{check.fresh === 1 ? '' : 's'} will be added.</p>
              <p><b>{check.matched.toLocaleString()}</b> already here{kind === 'clients' ? ' (same email or mobile)' : ''}{check.fills ? <> — <b>{check.fills}</b> of them get missing details filled in. Nothing already here is overwritten.</> : ' — nothing to change.'}</p>
              {check.samples.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>e.g. {check.samples.map((x: any) => `${x.name}: adds ${x.adds.join(', ')}`).join(' · ')}</p>}
              {kind === 'services' && <p className="text-[13px]" style={{ color: MUTED }}>New services come in hidden from your booking page, so you can check prices and lengths first.</p>}
            </div>}
        </Step>

        <Step n={5} title="Bring it in" on={!!check}>
          {done ? <div className="space-y-2 rounded-2xl p-4" style={{ background: '#e9f3ed' }}><p className="text-[16px] font-bold" style={{ color: GREEN }}>Done — {done.added.toLocaleString()} added{done.filled ? `, ${done.filled.toLocaleString()} filled in` : ''}.</p>
              <div className="flex flex-wrap gap-2"><a href={kind === 'clients' ? '/clients' : kind === 'services' ? '/services' : '/retail'} className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-semibold text-white" style={{ background: INK }}>See your {kind}</a><button type="button" onClick={reset} className="h-10 rounded-full bg-white px-4 text-[14px] font-semibold">Bring in another file</button></div></div>
            : <>{progress !== null && <div className="h-2 rounded-full" style={{ background: SOFT }}><div className="h-2 rounded-full transition-all" style={{ width: `${progress}%`, background: INK }} /></div>}
              <button type="button" disabled={progress !== null || (!check?.fresh && !check?.fills)} onClick={save} className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: INK, color: '#fff' }}>{progress !== null ? `Saving… ${progress}%` : `Bring in ${(check?.fresh || 0).toLocaleString()} new${check?.fills ? ` and fill in ${check.fills}` : ''}`}</button></>}
          {err && headers.length > 0 && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
        </Step>

        {history.length > 0 && <section className="p-5" style={card}><h2 className="text-[15px] font-bold">Recent imports</h2>
          <div className="mt-2">{history.map((h) => <div key={h.id} className="flex items-center justify-between gap-3 py-3 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="min-w-0"><span className="block font-medium">{h.added.toLocaleString()} {h.kind}{h.filled ? `, ${h.filled} filled in` : ''}{h.app ? ` · from ${APPS.find((a) => a.id === h.app)?.name || h.app}` : ''}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{new Date(h.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{h.by ? ` · ${h.by}` : ''}{h.undoneAt ? ' · undone' : ''}</span></span>
            {!h.undoneAt && <button type="button" onClick={() => undo(h.id)} className="h-9 shrink-0 rounded-full px-3.5 text-[13.5px] font-semibold" style={{ background: SOFT }}>Undo</button>}</div>)}</div></section>}
        <p className="pb-6 text-[12.5px]" style={{ color: MUTED }}>Appointment history, gift card balances and packages are next — for now, keep the old app’s records for those.</p>
      </main>
    </div>);
}
