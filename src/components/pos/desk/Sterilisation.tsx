'use client';
// src/components/pos/desk/Sterilisation.tsx — STERILISATION RECORDS on screen: start a cycle (machine, settings, which
// kits are inside), watch its countdown, record the result, record spore tests, and print the log for an inspector.
// A passed cycle is stamped on each kit in the load; a failed one sends them round again. Nothing here can be deleted.
import * as React from 'react';
import { collection, doc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { moveKit, findKit, type Kit } from '@/lib/kits';
import { readyForNextStep } from '@/lib/cleanse';
import { nextCycleNumber, cycleProblem, sporeStatus, logRows, type Cycle } from '@/lib/sterilisation';
import { brandOf, printCodeLabels } from '@/lib/print-labels';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { useSeconds } from '@/components/pos/desk/LiveTimer';
import { Ring } from '@/components/pos/desk/hk-ui';

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function Sterilisation({ tenantId, tenant, kits, manager, incoming = null, hideScan = false }: { tenantId: string; tenant: any; kits: Kit[]; manager: boolean; incoming?: { code: string; n: number } | null; hideScan?: boolean }) {
  const { firestore } = useFirebase();
  const since = React.useMemo(() => new Date(Date.now() - 120 * 86400000).toISOString(), []);
  const cq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'sterilisationCycles'), where('startedAt', '>=', since)) : null), [firestore, tenantId, since]);
  const { data: raw } = useCollection<any>(cq); const cycles: Cycle[] = React.useMemo(() => [...(raw || [])].sort((a: any, b: any) => String(b.startedAt).localeCompare(String(a.startedAt))), [raw]);
  const ops = tenant?.ops || {}; const devices: string[] = Array.isArray(ops.sterilisers) && ops.sterilisers.length ? ops.sterilisers : ['Autoclave'];
  const [open, setOpen] = React.useState<'start' | 'spore' | null>(null); const [device, setDevice] = React.useState(devices[0]); const [minutes, setMinutes] = React.useState(String(ops.cycleMinutes || '')); const [temp, setTemp] = React.useState(String(ops.cycleTemp || '')); const [unit, setUnit] = React.useState<'F' | 'C'>(ops.cycleTempUnit === 'C' ? 'C' : 'F');
  const [load, setLoad] = React.useState<string[]>([]); const [typed, setTyped] = React.useState(''); const [note, setNote] = React.useState(''); const [lab, setLab] = React.useState(''); const [finishing, setFinishing] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = React.useState(false); const [newDevice, setNewDevice] = React.useState(''); const [scanText, setScanText] = React.useState(''); const [cam, setCam] = React.useState(false);
  const now = useSeconds();   // the rings count down live
  const who = () => (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0];
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who(), role: manager ? 'manager' : 'staff' });
  const running = cycles.filter((c) => c.type === 'cycle' && c.status === 'running'); const inRunning = new Set(running.flatMap((c) => c.kits.map((k) => k.id)));
  // Kits that can go in a load: waiting to be cleaned, or being cleaned but not already in a running cycle.
  // Only kits whose cleanse is complete can go in; the rest are shown greyed with what's left.
  const loadable = (kits || []).filter((k) => readyForNextStep(k).ok && !inRunning.has(k.id));
  const notYet = (kits || []).filter((k) => (k.status === 'dirty' || k.status === 'cleaning') && !readyForNextStep(k).ok && !inRunning.has(k.id));
  const spore = sporeStatus(cycles, Math.max(0, Number(ops.sporeTestDays) || 0));
  const scanRef = React.useRef<(v: string) => void>(() => undefined);
  React.useEffect(() => { if (incoming?.code) scanRef.current(incoming.code); }, [incoming?.n]); // eslint-disable-line react-hooks/exhaustive-deps   // a scan from the one-scanner sheet
  if (!firestore) return null;

  const start = async () => { const problem = cycleProblem({ device, kitIds: load, minutes, running }); if (problem) { setMsg({ ok: false, text: problem }); return; }
    setBusy(true); const at = new Date().toISOString(); const ref = doc(collection(firestore, 'tenants', tenantId, 'sterilisationCycles')); const inside = loadable.filter((k) => load.includes(k.id));
    const rec: Cycle = { id: ref.id, type: 'cycle', number: nextCycleNumber(cycles), device: device.trim(), startedAt: at, startedBy: who(), startedById: getAuth().currentUser?.uid || null, minutes: Number(minutes), temp: Number(temp) || null, tempUnit: Number(temp) ? unit : null, kits: inside.map((k) => ({ id: k.id, name: k.name, code: k.code })), status: 'running', note: note.trim() || null };
    try { await setDoc(ref, rec);
      for (const k of inside) { const patch: any = { cycleId: ref.id }; if (k.status === 'dirty') { const r = moveKit(k, 'cleaning', { name: who(), manager }); if ('patch' in r) Object.assign(patch, r.patch, { byId: getAuth().currentUser?.uid || null }); } await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', k.id), patch); }
      void logAuditClient(firestore, tenantId, { action: 'sterilisation.started', targetType: 'sterilisationCycle', targetId: ref.id, actor: actor(), after: { device: rec.device, minutes: rec.minutes, temp: rec.temp, tempUnit: rec.tempUnit, kits: rec.kits.map((k) => k.code) }, summary: `Cycle ${rec.number} started on ${rec.device}: ${rec.kits.length} kit${rec.kits.length === 1 ? '' : 's'} (${rec.kits.map((k) => k.code).join(', ')}), ${rec.minutes} min${rec.temp ? ` at ${rec.temp}°${rec.tempUnit}` : ''}` });
      setMsg({ ok: true, text: `Cycle ${rec.number} started on ${rec.device}.` }); setOpen(null); setLoad([]); setNote(''); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(false); };
  const finish = async (c: Cycle, passed: boolean) => { if (!passed && !note.trim()) { setMsg({ ok: false, text: 'Say what happened (e.g. the indicator didn’t change).' }); return; }
    setBusy(true); const at = new Date().toISOString();
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'sterilisationCycles', c.id), { status: passed ? 'passed' : 'failed', indicator: passed ? 'pass' : 'fail', endedAt: at, endedBy: who(), endedById: getAuth().currentUser?.uid || null, ...(note.trim() ? { note: [c.note, note.trim()].filter(Boolean).join(' — ') } : {}) });
      for (const ck of c.kits) { const k = (kits || []).find((x) => x.id === ck.id); if (!k) continue;
        if (passed) await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', k.id), { lastSterilised: { cycleId: c.id, at, by: who(), passed: true, device: c.device }, cycleId: null });
        else if (k.status === 'cleaning') { const r = moveKit(k, 'dirty', { name: who(), manager }, { note: `Cycle ${c.number} failed` }); await updateDoc(doc(firestore, 'tenants', tenantId, 'kits', k.id), { ...('patch' in r ? r.patch : {}), cycleId: null }); } }
      void logAuditClient(firestore, tenantId, { action: passed ? 'sterilisation.passed' : 'sterilisation.failed', targetType: 'sterilisationCycle', targetId: c.id, actor: actor(), summary: `Cycle ${c.number} on ${c.device} ${passed ? 'passed' : 'FAILED'} — ${c.kits.map((k) => k.code).join(', ')}${note.trim() ? ` — ${note.trim()}` : ''}` });
      setMsg({ ok: passed, text: passed ? `Cycle ${c.number} passed. Check each kit’s contents and mark it ready.` : `Cycle ${c.number} failed — its kits are back under “needs cleaning”.` }); setFinishing(null); setNote(''); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(false); };
  const saveSpore = async (passed: boolean) => { setBusy(true); const at = new Date().toISOString(); const ref = doc(collection(firestore, 'tenants', tenantId, 'sterilisationCycles'));
    try { await setDoc(ref, { id: ref.id, type: 'spore', device: device.trim() || devices[0], startedAt: at, startedBy: who(), startedById: getAuth().currentUser?.uid || null, kits: [], status: passed ? 'passed' : 'failed', endedAt: at, endedBy: who(), lab: lab.trim() || null, note: note.trim() || null });
      void logAuditClient(firestore, tenantId, { action: passed ? 'sterilisation.spore_pass' : 'sterilisation.spore_fail', targetType: 'sterilisationCycle', targetId: ref.id, actor: actor(), summary: `Spore test on ${device} recorded: ${passed ? 'pass' : 'FAIL'}${lab.trim() ? ` (${lab.trim()})` : ''}` });
      setMsg({ ok: passed, text: passed ? 'Spore test recorded: pass.' : 'Spore test recorded: FAIL. Stop using that machine and follow your board’s steps.' }); setOpen(null); setNote(''); setLab(''); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); }
    setBusy(false); };
  // Each machine has a label too: scan it to start a load on it, or to record its result when one is running.
  const machineCode = (d: string) => `M${d.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14)}`;
  const handleScan = (raw: string) => { const t = String(raw || '').trim().toUpperCase().split(/[/=#]/).pop() || ''; const dev = devices.find((d) => machineCode(d) === t);
    if (dev) { const c = running.find((x) => x.device.trim().toLowerCase() === dev.trim().toLowerCase()); scanFeedback(true);
      if (c) { setOpen(null); setMsg({ ok: true, text: `${dev}: cycle ${c.number} is on its tile below — tap Pass or Fail.` }); } else { setDevice(dev); if (open !== 'start') { setOpen('start'); setLoad([]); } setMsg({ ok: true, text: `${dev} — now scan each kit going in.` }); } return; }
    const k = findKit(loadable, raw);
    if (!k) { scanFeedback(false); const other = findKit(kits || [], raw); setMsg({ ok: false, text: other ? `${other.name} ${other.code}: ${readyForNextStep(other).reason || 'it isn’t waiting to be sterilised.'}` : 'That isn’t a kit or a machine label.' }); return; }
    scanFeedback(true); if (open !== 'start') { setOpen('start'); setLoad([k.id]); } else setLoad((l) => (l.includes(k.id) ? l : [...l, k.id])); setMsg({ ok: true, text: `${k.name} ${k.code} added to the load.` }); };
  scanRef.current = handleScan;
  const saveOps = async (patch: any) => { try { await updateDoc(doc(firestore, 'tenants', tenantId), { ops: { ...(tenant?.ops || {}), ...patch } }); void logAuditClient(firestore, tenantId, { action: 'sterilisation.settings', targetType: 'tenant', actor: actor(), after: patch, summary: `Sterilisation settings changed: ${Object.keys(patch).join(', ')}` }); } catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); } };
  const printLog = (days: number) => { const brand = brandOf(tenant); const rows = logRows(cycles, Date.now() - days * 86400000); const w = window.open('', '_blank'); if (!w) { setMsg({ ok: false, text: 'Allow pop-ups to print the log.' }); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Sterilisation log</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet"><style>@page{margin:12mm}body{font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#16171a;font-size:9pt}h1{font-size:15pt;margin:0}p{margin:2px 0 10px;color:#6b6760}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:#6b6760;border-bottom:1.5px solid #16171a;padding:5px 6px}td{border-bottom:1px solid #ddd;padding:5px 6px;vertical-align:top}.f{font-weight:700}tr{break-inside:avoid}</style>
<h1>${esc(brand.name || 'Sterilisation log')}</h1><p>Sterilisation log · last ${days} days · printed ${esc(new Date().toLocaleString())} · ${rows.length} record${rows.length === 1 ? '' : 's'}</p>
<table><thead><tr><th>When</th><th>Record</th><th>Machine</th><th>Settings</th><th>Load</th><th>Result</th><th>By</th><th>Note</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.when)}</td><td>${esc(r.what)}</td><td>${esc(r.device)}</td><td>${esc(r.settings)}</td><td>${esc(r.load)}</td><td class="${r.result === 'FAIL' ? 'f' : ''}">${esc(r.result)}</td><td>${esc(r.by)}</td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table><script>onload=()=>setTimeout(()=>print(),200)<\/script>`); w.document.close(); };

  return (
    <div className="space-y-3">
      {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      {!hideScan && <form onSubmit={(e) => { e.preventDefault(); const v = scanText; setScanText(''); if (v.trim()) handleScan(v); }} className="flex gap-2">
        <input value={scanText} onChange={(e) => setScanText(e.target.value.slice(0, 80))} placeholder="Scan a machine or a kit" aria-label="Scan a machine or a kit" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[15px] uppercase tracking-wider" />
        <button type="button" onClick={() => setCam((c) => !c)} className="h-11 rounded-xl border px-3 text-[13px] font-semibold">{cam ? 'Close camera' : 'Camera'}</button>
      </form>}
      {cam && !hideScan && <ScanGate onScan={handleScan} label="Scan the machine’s label, then each kit" />}
      {spore.due && <p className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-[13px] font-semibold text-amber-900">{spore.last ? `Last spore test was ${spore.daysSince} days ago` : 'No spore test on record'} — one is due (every {ops.sporeTestDays} days).</p>}
      {running.map((c) => { const total = Math.max(1, Number(c.minutes) || 0) * 60; const gone = Math.max(0, (now - (Date.parse(c.startedAt) || now)) / 1000); const done = gone >= total; const left = Math.max(0, Math.round(total - gone)); return (
        <div key={c.id} className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-[24px] p-4 ${done ? 'border-2 border-emerald-700 bg-emerald-50' : 'border bg-card'}`}>
          <Ring value={gone / total} done={done} size={124}>{done ? <><span aria-hidden className="text-[34px] font-extrabold leading-none text-emerald-800">✓</span><span className="text-[12px] font-bold text-emerald-800">Time’s up</span></>
            : <><span className="text-[26px] font-[800] leading-none tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span><span className="mt-1 text-[12px] text-muted-foreground">left</span></>}</Ring>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="text-[20px] font-[700]">{c.device}</p><p className={`text-[13px] font-bold ${done ? 'text-emerald-800' : ''}`}>{done ? 'Finished' : 'Running'} · cycle {c.number}</p></div>
            <p className="text-[13px] text-muted-foreground">{c.minutes} min{c.temp ? ` at ${c.temp}°${c.tempUnit}` : ''} · started by {c.startedBy} at {new Date(c.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
            <div className="flex flex-wrap gap-1.5">{c.kits.map((k) => <span key={k.id} title={k.name} className={`rounded-lg px-2 py-1 font-mono text-[12px] font-bold tracking-wider ${done ? 'bg-white' : 'bg-muted'}`}>{k.code}</span>)}</div>
            {finishing === c.id ? (
              <div className="space-y-2">
                <input autoFocus value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="What happened? (e.g. the indicator didn’t change)" className="h-11 w-full rounded-xl border bg-background px-3 text-[14px]" />
                <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => finish(c, false)} className="h-11 flex-1 rounded-xl bg-red-700 text-[14px] font-bold text-white disabled:opacity-40">Record the fail</button><button type="button" onClick={() => setFinishing(null)} className="h-11 px-3 text-[14px]">Cancel</button></div>
              </div>
            ) : (<>
              <p className="text-[14px] font-semibold">{done ? 'Did the indicator show a pass?' : 'Record the result when it ends.'}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy} onClick={() => { setNote(''); void finish(c, true); }} className={`h-12 rounded-[14px] text-[16px] font-bold disabled:opacity-40 ${done ? 'bg-emerald-700 text-white' : 'border-[1.5px] bg-card'}`}>Pass</button>
                <button type="button" onClick={() => { setFinishing(c.id); setNote(''); }} className="h-12 rounded-[14px] border-2 border-red-700 bg-card text-[16px] font-bold text-red-700">Fail</button>
              </div></>)}
          </div>
        </div>); })}
      {open === 'start' && (
        <div className="space-y-2 rounded-2xl border-2 bg-card p-3">
          <p className="text-[14px] font-semibold">Start a cycle</p>
          <div className="flex flex-wrap items-end gap-2 text-[13px]">
            <label>Machine<select value={device} onChange={(e) => setDevice(e.target.value)} className="mt-1 block h-10 rounded-xl border bg-background px-2 text-[14px]">{devices.map((d) => <option key={d}>{d}</option>)}</select></label>
            <label>Minutes<input type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="mt-1 block h-10 w-20 rounded-xl border bg-background px-2 text-[14px]" /></label>
            <label>Temperature<input type="number" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="optional" className="mt-1 block h-10 w-24 rounded-xl border bg-background px-2 text-[14px]" /></label>
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'F' | 'C')} aria-label="Unit" className="h-10 rounded-xl border bg-background px-2 text-[14px]"><option value="F">°F</option><option value="C">°C</option></select>
          </div>
          <p className="text-[12px] text-muted-foreground">Use the settings from your machine’s instructions and your state board. This records what you ran; it doesn’t choose it for you.</p>
          <form onSubmit={(e) => { e.preventDefault(); const k = findKit(loadable, typed); setTyped(''); if (!k) { setMsg({ ok: false, text: 'No kit waiting to be cleaned has that code.' }); return; } setLoad((l) => (l.includes(k.id) ? l : [...l, k.id])); setMsg(null); }} className="flex gap-2">
            <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 80))} placeholder="Scan each kit as it goes in" aria-label="Kit code" autoCapitalize="characters" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[14px] uppercase tracking-wider" />
            <button type="submit" disabled={!typed.trim()} className="h-10 rounded-xl border px-3 text-[13px] font-semibold disabled:opacity-40">Add</button>
          </form>
          {notYet.length > 0 && <p className="text-[12px] text-muted-foreground">Not yet — still cleansing or not started: {notYet.map((k) => k.code).join(', ')}</p>}
          {!loadable.length ? <p className="text-[13px] text-muted-foreground">No cleansed kits are waiting to be sterilised.</p> : (
            <div className="flex flex-wrap gap-2">{loadable.map((k) => { const on = load.includes(k.id); return <button key={k.id} type="button" aria-pressed={on} onClick={() => setLoad((l) => (on ? l.filter((x) => x !== k.id) : [...l, k.id]))} className={`h-9 rounded-full border px-3 text-[13px] ${on ? 'bg-foreground text-background' : ''}`}>{k.name} <span className="font-mono">{k.code}</span></button>; })}
              <button type="button" onClick={() => setLoad(loadable.map((k) => k.id))} className="h-9 rounded-full px-2 text-[13px] underline">All</button></div>)}
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Note (optional)" className="h-10 w-full rounded-xl border bg-background px-3 text-[14px]" />
          <div className="flex gap-2"><button type="button" disabled={busy} onClick={start} className="h-10 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-40">Start cycle · {load.length} kit{load.length === 1 ? '' : 's'}</button><button type="button" onClick={() => setOpen(null)} className="h-10 px-2 text-[13px]">Cancel</button></div>
        </div>)}
      {open === 'spore' && (
        <div className="space-y-2 rounded-2xl border-2 bg-card p-3">
          <p className="text-[14px] font-semibold">Record a spore test</p>
          <div className="flex flex-wrap gap-2"><select value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Machine" className="h-10 rounded-xl border bg-background px-2 text-[14px]">{devices.map((d) => <option key={d}>{d}</option>)}</select>
            <input value={lab} onChange={(e) => setLab(e.target.value.slice(0, 80))} placeholder="Lab or test kit (optional)" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[14px]" /></div>
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Note (optional)" className="h-10 w-full rounded-xl border bg-background px-3 text-[14px]" />
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => saveSpore(true)} className="h-10 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white">Passed</button><button type="button" disabled={busy} onClick={() => saveSpore(false)} className="h-10 rounded-full bg-red-600 px-4 text-[13px] font-semibold text-white">Failed</button><button type="button" onClick={() => setOpen(null)} className="h-10 px-2 text-[13px]">Cancel</button></div>
        </div>)}
      {!open && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setOpen('start'); setLoad([]); setNote(''); setMsg(null); }} className="h-10 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background">Start a cycle</button>
        <button type="button" onClick={() => { setOpen('spore'); setNote(''); setMsg(null); }} className="h-10 rounded-full border px-4 text-[13px]">Record a spore test</button>
        {cycles.length > 0 && <><button type="button" onClick={() => printLog(30)} className="h-10 rounded-full border px-4 text-[13px]">Print log · 30 days</button><button type="button" onClick={() => printLog(120)} className="h-10 rounded-full border px-4 text-[13px]">120 days</button></>}
      </div>}
      {cycles.filter((c) => c.status !== 'running').slice(0, 6).map((c) => (
        <p key={c.id} className="flex flex-wrap justify-between gap-x-3 border-b pb-1 text-[13px] last:border-0"><span>{c.type === 'spore' ? 'Spore test' : `Cycle ${c.number}`} · {c.device} · {new Date(c.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{c.type === 'cycle' ? ` · ${c.kits.length} kit${c.kits.length === 1 ? '' : 's'}` : ''} · {c.endedBy || c.startedBy}</span><span className={c.status === 'passed' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>{c.status === 'passed' ? 'Pass' : 'FAIL'}</span></p>))}
      {manager && (
        <details className="rounded-2xl border bg-card p-3 text-[13px]"><summary className="cursor-pointer font-semibold">Sterilisation settings</summary>
          <div className="mt-2 space-y-2">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!!ops.requireSterilisation} onChange={(e) => saveOps({ requireSterilisation: e.target.checked })} /> A kit can only be marked clean after a passed, recorded cycle</label>
            <label className="block">Spore test every <input type="number" min={0} max={90} defaultValue={Number(ops.sporeTestDays) || 0} onBlur={(e) => saveOps({ sporeTestDays: Math.max(0, Math.min(90, Math.round(Number(e.target.value)) || 0)) })} className="mx-1 h-9 w-16 rounded-lg border bg-background px-2" /> days (0 = don’t remind)</label>
            <label className="block">Usual cycle: <input type="number" min={0} defaultValue={Number(ops.cycleMinutes) || ''} onBlur={(e) => saveOps({ cycleMinutes: Math.max(0, Math.round(Number(e.target.value)) || 0) || null })} className="mx-1 h-9 w-16 rounded-lg border bg-background px-2" /> min</label>
            <div><p>Machines: {devices.join(' · ')} <button type="button" onClick={async () => { if (!(await printCodeLabels(devices.map((d) => ({ title: d, sub: 'Steriliser', code: machineCode(d), steps: ['Scan this label', 'Scan each kit going in', 'Start the cycle', 'Scan again to record the result'] })), 'Steriliser labels', brandOf(tenant), 'sticker'))) setMsg({ ok: false, text: 'Allow pop-ups to print labels.' }); }} className="ml-2 underline">Print their labels</button></p>
              <form onSubmit={(e) => { e.preventDefault(); const d = newDevice.trim().slice(0, 40); if (!d) return; saveOps({ sterilisers: Array.from(new Set([...(Array.isArray(ops.sterilisers) ? ops.sterilisers : []), d])).slice(0, 8) }); setNewDevice(''); }} className="mt-1 flex gap-2"><input value={newDevice} onChange={(e) => setNewDevice(e.target.value)} placeholder="Add a machine (e.g. Autoclave 2)" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2" /><button type="submit" className="h-9 rounded-lg border px-3 font-semibold">Add</button></form></div>
          </div>
        </details>)}
    </div>);
}
