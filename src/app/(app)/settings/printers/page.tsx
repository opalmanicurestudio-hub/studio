'use client';
// src/app/(app)/settings/printers/page.tsx — SETTINGS → PRINTERS (design canvas Printers; api/printers,
// lib/printing-server). The business's networked receipt printers: what each prints (new tickets for some stations or
// all of them, and guest checks), whether it's answering, and the address to put in the printer's own settings. Star
// printers on CloudPRNT and Epson printers on Server Direct Print ask for work by themselves, so nothing has to be open
// for a ticket to print. A manager adds and changes them; anyone can see how they're doing.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { SettingsPage, Section, Row, Toggle, cfInput, cfInputStyle } from '@/components/settings/settings-ui';

type P = { id: string; name: string; kind: 'star' | 'epson'; cols: number; stations: string[]; tickets: boolean; checks: boolean; buzz: boolean; prints: string; ok: boolean; words: string; url?: string };
type Edit = { id: string | null; name: string; kind: 'star' | 'epson'; narrow: boolean; stations: string[]; tickets: boolean; checks: boolean; buzz: boolean };
const COLS = { star: [48, 32], epson: [42, 30] } as const;
const GREEN = '#1f7a4d', AMBER = '#b45309';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/printers', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
/** Two printers putting the same station's tickets on paper (it can be on purpose: one for the cooks, one to run). */
function overlapOf(list: P[]): string[] {
  const t = list.filter((p) => p.tickets); const out: string[] = [];
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
    const a = t[i], b = t[j];
    const shared = !a.stations.length && !b.stations.length ? null : !a.stations.length ? b.stations : !b.stations.length ? a.stations : a.stations.filter((x) => b.stations.includes(x));
    if (shared && !shared.length) continue;
    out.push(`${a.name} and ${b.name} both print ${shared ? `${shared.slice(0, 3).join(', ')}${shared.length > 3 ? ' and more' : ''}` : 'every station’s'} tickets, so those come out on both. Pick different stations if that isn’t what you want.`);
  }
  return out.slice(0, 3);
}
const blank = (): Edit => ({ id: null, name: '', kind: 'star', narrow: false, stations: [], tickets: true, checks: false, buzz: true });
const editOf = (p: P): Edit => ({ id: p.id, name: p.name, kind: p.kind, narrow: p.cols < 40, stations: p.stations, tickets: p.tickets, checks: p.checks, buzz: p.buzz });

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--line)' }}>
      {options.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className="min-h-[44px] rounded-lg px-3 text-[14px] font-semibold"
        style={value === v ? { background: 'var(--ink)', color: 'var(--card)' } : { color: 'var(--muted)' }}>{l}</button>)}
    </div>
  );
}

export default function PrintersSettings() {
  const { selectedTenant } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const [list, setList] = React.useState<P[] | null>(null); const [stations, setStations] = React.useState<string[]>([]);
  const [manager, setManager] = React.useState(false); const [err, setErr] = React.useState(''); const [msg, setMsg] = React.useState('');
  const [edit, setEdit] = React.useState<Edit | null>(null); const [busy, setBusy] = React.useState(''); const [rekey, setRekey] = React.useState('');
  const load = React.useCallback(async () => {
    if (!tenantId) return;
    const d = await post({ tenantId, action: 'list' });
    if (!d.ok) { setErr(d.error || 'The printers couldn’t be read.'); return; }
    setErr(''); setList(d.printers || []); setStations(d.stations || []); setManager(!!d.manager);
  }, [tenantId]);
  React.useEffect(() => { void load(); const i = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000); return () => clearInterval(i); }, [load]);

  const act = async (key: string, body: any, done: string) => {
    setBusy(key); setMsg(''); setErr('');
    const d = await post({ tenantId, ...body });
    setBusy('');
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return null; }
    setMsg(done); void load(); return d;
  };
  const save = async () => {
    if (!edit) return;
    const d = await act('save', { action: 'save', id: edit.id, name: edit.name, kind: edit.kind, cols: COLS[edit.kind][edit.narrow ? 1 : 0], stations: edit.stations, tickets: edit.tickets, checks: edit.checks, buzz: edit.buzz },
      edit.id ? 'Saved.' : 'Added. Put its address in the printer’s own settings, then print a test.');
    if (d) setEdit(null);
  };
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setMsg('Address copied.'); } catch { setMsg('Select the address and copy it.'); } };
  const E = (patch: Partial<Edit>) => setEdit((e) => (e ? { ...e, ...patch } : e));

  if (!list) return <SettingsPage title="Printers"><p className="cf-muted">{err || 'Loading…'}</p></SettingsPage>;
  return (
    <SettingsPage title="Printers" help={<>Kitchen tickets print by themselves at the station that makes them, and checks print when a server asks. For Star printers on CloudPRNT and Epson printers on Server Direct Print. No printer like that? A tablet can print through its own print dialog: turn on “Print new tickets here” on the kitchen screen.</>}
      actions={manager && !edit ? <button type="button" onClick={() => { setEdit(blank()); setMsg(''); }} className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-semibold" style={{ background: 'var(--ink)', color: 'var(--card)' }}>Add a printer</button> : undefined}>
      {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: AMBER }}>{err}</p>}
      {msg && <p role="status" className="text-[14px]">{msg}</p>}

      {edit && manager && (
        <Section title={edit.id ? `Change ${edit.name || 'this printer'}` : 'Add a printer'}>
          <Row label="Name" help="What the team calls it: Kitchen printer, Bar printer">
            <input value={edit.name} maxLength={40} onChange={(e) => E({ name: e.target.value })} className={cfInput} style={cfInputStyle} aria-label="Printer name" />
          </Row>
          <Row label="Make" help={edit.kind === 'star' ? 'A Star printer that has CloudPRNT (you’ll find it in the printer’s own web settings)' : 'An Epson printer that has Server Direct Print (you’ll find it in the printer’s own web settings)'}>
            <Seg label="Make" value={edit.kind} onChange={(v) => E({ kind: v })} options={[['star', 'Star (CloudPRNT)'], ['epson', 'Epson (Server Direct Print)']]} />
          </Row>
          <Row label="Paper" inline><Seg label="Paper" value={edit.narrow ? 'n' : 'w'} onChange={(v) => E({ narrow: v === 'n' })} options={[['w', '80 mm'], ['n', '58 mm']]} /></Row>
          <Row label="Prints new tickets by themselves" help="Each table’s course or order on one slip, as soon as it’s fired, with any allergy printed so it stands out" inline>
            <Toggle checked={edit.tickets} onChange={(v) => E({ tickets: v })} label="Prints new tickets by themselves" />
          </Row>
          {edit.tickets && stations.length > 0 && <Row label="For which stations" help={edit.stations.length ? 'Only these stations’ tickets' : 'None picked: every station’s tickets'}>
            <div className="flex flex-wrap gap-2">{stations.map((s) => { const on = edit.stations.includes(s); return (
              <button key={s} type="button" aria-pressed={on} onClick={() => E({ stations: on ? edit.stations.filter((x) => x !== s) : [...edit.stations, s] })} className="min-h-[44px] rounded-full border px-4 text-[14px] font-semibold"
                style={on ? { background: 'var(--ink)', color: 'var(--card)', borderColor: 'var(--ink)' } : { borderColor: 'var(--line)' }}>{s}</button>); })}</div>
          </Row>}
          {edit.tickets && edit.kind === 'star' && <Row label="Beep for a new ticket" help="For a printer with a buzzer" inline><Toggle checked={edit.buzz} onChange={(v) => E({ buzz: v })} label="Beep for a new ticket" /></Row>}
          <Row label="Prints checks" help="“Print the check” on a server’s tab prints here. With pay at the table on, the check carries the table’s pay link" inline>
            <Toggle checked={edit.checks} onChange={(v) => E({ checks: v })} label="Prints checks" />
          </Row>
          <div className="flex flex-wrap gap-2 px-5 py-4">
            <button type="button" disabled={busy === 'save' || !edit.name.trim()} onClick={save} className="min-h-[44px] rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--card)' }}>{busy === 'save' ? 'Saving…' : edit.id ? 'Save' : 'Add it'}</button>
            <button type="button" onClick={() => setEdit(null)} className="min-h-[44px] rounded-full border px-5 text-[14px] font-semibold" style={{ borderColor: 'var(--line)' }}>Cancel</button>
            {edit.id && <button type="button" disabled={busy === 'remove'} onClick={async () => { if (await act('remove', { action: 'remove', id: edit.id }, 'Taken away. Its address doesn’t work any more.')) setEdit(null); }}
              className="min-h-[44px] rounded-full px-5 text-[14px] font-semibold" style={{ color: '#b42318' }}>Take it away</button>}
          </div>
        </Section>
      )}

      <Section title="Your printers" help={list.length ? undefined : 'None yet.'}>
        {overlapOf(list).map((o) => <div key={o} role="note" className="px-5 py-3 text-[14px] font-medium" style={{ color: AMBER }}>{o}</div>)}
        {list.length === 0 && <div className="px-5 py-4 text-[14.5px] cf-muted">{manager ? 'Add a printer to have tickets print by themselves.' : 'A manager adds printers here.'}</div>}
        {list.map((p) => (
          <div key={p.id} className="space-y-3 px-5 py-4 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px] font-semibold">{p.name}</p>
                <p className="text-[13.5px] cf-muted">{p.kind === 'star' ? 'Star' : 'Epson'}. Prints {p.prints}</p>
                <p className="mt-1 flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: p.ok ? GREEN : AMBER }}><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: p.ok ? GREEN : AMBER }} />{p.words}</p>
              </div>
              {manager && <button type="button" onClick={() => { setEdit(editOf(p)); setMsg(''); }} className="min-h-[44px] rounded-full border px-4 text-[14px] font-semibold" style={{ borderColor: 'var(--line)' }}>Change</button>}
            </div>
            {manager && p.url && <div className="space-y-2 rounded-2xl p-3" style={{ background: 'var(--soft, #f5f5f7)' }}>
              <p className="text-[13.5px] font-semibold">{p.kind === 'star' ? 'In the printer’s own settings, turn on CloudPRNT and put this in as the server address. Have it ask every 5 seconds.' : 'In the printer’s own settings (EpsonNet Config), turn on Server Direct Print, put this in as the address, and set the interval to 5 seconds.'}</p>
              <p className="break-all font-mono text-[12.5px]">{p.url}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => copy(p.url!)} className="min-h-[44px] rounded-full border bg-[var(--card)] px-4 text-[14px] font-semibold" style={{ borderColor: 'var(--line)' }}>Copy</button>
                <button type="button" disabled={busy === `test:${p.id}`} onClick={() => act(`test:${p.id}`, { action: 'test', id: p.id }, `A test page is on its way to ${p.name}.`)} className="min-h-[44px] rounded-full border bg-[var(--card)] px-4 text-[14px] font-semibold" style={{ borderColor: 'var(--line)' }}>Print a test</button>
                {rekey === p.id
                  ? <button type="button" onClick={async () => { setRekey(''); await act(`rekey:${p.id}`, { action: 'rekey', id: p.id }, `${p.name} has a new address. Put it in the printer’s settings.`); }} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold" style={{ color: AMBER }}>Yes, the old one stops within a minute</button>
                  : <button type="button" onClick={() => setRekey(p.id)} className="min-h-[44px] rounded-full px-4 text-[14px] font-semibold cf-muted">New address</button>}
              </div>
            </div>}
          </div>
        ))}
      </Section>
    </SettingsPage>
  );
}
