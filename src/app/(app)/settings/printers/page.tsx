'use client';
// src/app/(app)/settings/printers/page.tsx — SETTINGS → PRINTERS (design canvas Printers; api/printers,
// lib/printing-server). The business's networked receipt printers: what each prints (new tickets for some stations or
// all of them, and guest checks), whether it's answering, and the address to put in the printer's own settings. Star
// printers on CloudPRNT and Epson printers on Server Direct Print ask for work by themselves, so nothing has to be open
// for a ticket to print. A manager adds and changes them; anyone can see how they're doing.
import { STICKER_ON_WORDS, type StickerOn } from '@/lib/sticker-on';
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { SettingsPage, Section, Row, Toggle, cfInput, cfInputStyle } from '@/components/settings/settings-ui';

type P = { id: string; name: string; kind: 'star' | 'epson'; cols: number; stations: string[]; tickets: boolean; checks: boolean; buzz: boolean; receipts: boolean; drawer: boolean; labels?: boolean; stickers?: boolean; stickersOn?: StickerOn[] | null; pictures?: boolean; prints: string; ok: boolean; words: string; url?: string };
type Edit = { id: string | null; name: string; kind: 'star' | 'epson'; narrow: boolean; stations: string[]; tickets: boolean; checks: boolean; buzz: boolean; receipts: boolean; drawer: boolean; labels: boolean; stickers: boolean; stickersOn: StickerOn[] | null };
type After = 'ask' | 'print' | 'none';
const COLS = { star: [48, 32], epson: [42, 30] } as const;
const GREEN = '#1f7a4d', AMBER = '#b45309';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/printers', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
/** Stations whose tickets no printer prints, once printers are set to stations: each order's tickets go by the station
 *  each item is made at, so a station left out prints nothing (its tickets are on the kitchen screen). */
function uncoveredOf(list: P[], stations: string[]): string | null {
  const t = list.filter((p) => p.tickets); if (!t.length || t.some((p) => !p.stations.length)) return null;
  const left = stations.filter((s) => !t.some((p) => p.stations.some((x) => x.toLowerCase() === s.toLowerCase())));
  return left.length ? `No printer prints ${left.slice(0, 3).join(', ')}${left.length > 3 ? ' and more' : ''} tickets. They show on the kitchen screen only. Pick ${left.length === 1 ? 'it' : 'them'} on a printer to print ${left.length === 1 ? 'it' : 'them'} too.` : null;
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
const blank = (): Edit => ({ id: null, name: '', kind: 'star', narrow: false, stations: [], tickets: true, checks: false, buzz: true, receipts: false, drawer: false, labels: false, stickers: false, stickersOn: null });
const editOf = (p: P): Edit => ({ id: p.id, name: p.name, kind: p.kind, narrow: p.cols < 40, stations: p.stations, tickets: p.tickets, checks: p.checks, buzz: p.buzz, receipts: !!p.receipts, drawer: !!p.drawer, labels: !!p.labels, stickers: !!p.stickers, stickersOn: p.stickersOn?.length ? p.stickersOn : null });

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
  const [after, setAfter] = React.useState<After>('ask');
  const load = React.useCallback(async () => {
    if (!tenantId) return;
    const d = await post({ tenantId, action: 'list' });
    if (!d.ok) { setErr(d.error || 'The printers couldn’t be read.'); return; }
    setErr(''); setList(d.printers || []); setStations(d.stations || []); setManager(!!d.manager); if (d.receiptAfter) setAfter(d.receiptAfter);
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
    const d = await act('save', { action: 'save', id: edit.id, name: edit.name, kind: edit.kind, cols: COLS[edit.kind][edit.narrow ? 1 : 0], stations: edit.stations, tickets: edit.tickets, checks: edit.checks, buzz: edit.buzz, receipts: edit.receipts, drawer: edit.drawer, labels: edit.labels, stickers: edit.stickers, stickersOn: edit.stickers && edit.stickersOn?.length ? edit.stickersOn : null },
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
          <Row label="Prints new tickets by themselves" help={edit.tickets && (edit.labels || edit.stickers) ? 'On: kitchen tickets come out here too, on the same labels. Turn this off for a label printer' : 'Each table’s course or order on one slip, as soon as it’s fired, with any allergy printed so it stands out'} inline>
            <Toggle checked={edit.tickets} onChange={(v) => E({ tickets: v })} label="Prints new tickets by themselves" />
          </Row>
          {(edit.tickets || edit.stickers) && stations.length > 0 && <Row label="For which stations" help={edit.stations.length ? `Only these stations’ ${edit.tickets ? 'tickets' : 'stickers'}` : `None picked: every station’s ${edit.tickets ? 'tickets' : 'items'}`}>
            <div className="flex flex-wrap gap-2">{stations.map((s) => { const on = edit.stations.includes(s); return (
              <button key={s} type="button" aria-pressed={on} onClick={() => E({ stations: on ? edit.stations.filter((x) => x !== s) : [...edit.stations, s] })} className="min-h-[44px] rounded-full border px-4 text-[14px] font-semibold"
                style={on ? { background: 'var(--ink)', color: 'var(--card)', borderColor: 'var(--ink)' } : { borderColor: 'var(--line)' }}>{s}</button>); })}</div>
          </Row>}
          {edit.tickets && edit.kind === 'star' && <Row label="Beep for a new ticket" help="For a printer with a buzzer" inline><Toggle checked={edit.buzz} onChange={(v) => E({ buzz: v })} label="Beep for a new ticket" /></Row>}
          <Row label="Prints item stickers" help={edit.kind === 'epson' ? 'A sticker for each item made at the stations picked above, as the order comes in: the number, the name, the item with its choices, and a code scanned before a to-go order is handed over. For drinks, put a sticky label printer at the bar and pick the bar' : 'A sticker for each item made at the stations picked above, as the order comes in: the number, the name, the item with its choices, and a code to scan. A Star printer prints the code once it has printed its first slip in the app’s look (most on CloudPRNT do, and Print a test starts it); until then, these aren’t scanned at handover'} inline>
            <Toggle checked={edit.stickers} onChange={(v) => E({ stickers: v, ...(v && edit.id === null && !edit.labels ? { tickets: false } : {}) })} label="Prints item stickers" />
          </Row>
          {edit.stickers && <Row label="Stickers on which orders" help={edit.stickersOn ? 'Only these, where a wrong or missing item costs most. Everyday orders keep the bag scan, so the rush isn’t slowed' : 'Every order, as it comes in'}>
            <div className="space-y-2">
              <Seg label="Stickers on which orders" value={edit.stickersOn ? 'some' : 'all'} onChange={(v) => E({ stickersOn: v === 'some' ? (edit.stickersOn || ['apps', 'drivers', 'bags', 'allergy']) : null })} options={[['all', 'Every order'], ['some', 'Only where it counts']]} />
              {edit.stickersOn && <div role="group" aria-label="Only on these orders" className="flex flex-wrap gap-2">{STICKER_ON_WORDS.map((o) => { const on = edit.stickersOn!.includes(o.id); return (
                <button key={o.id} type="button" aria-pressed={on} onClick={() => { const next = on ? edit.stickersOn!.filter((x) => x !== o.id) : [...edit.stickersOn!, o.id]; if (next.length) E({ stickersOn: next }); }} className="min-h-[44px] rounded-full border px-4 text-[14px] font-semibold"
                  style={on ? { background: 'var(--ink)', color: 'var(--card)', borderColor: 'var(--ink)' } : { borderColor: 'var(--line)' }}>{o.label}</button>); })}</div>}
            </div>
          </Row>}
          <Row label="Prints checks" help="“Print the check” on a server’s tab prints here. With pay at the table on, the check carries the table’s pay link" inline>
            <Toggle checked={edit.checks} onChange={(v) => E({ checks: v })} label="Prints checks" />
          </Row>
          <Row label="Prints receipts" help="Guests’ receipts from the counter, the drive-thru and Today’s sales, when one’s asked for (or every time, as set below)" inline>
            <Toggle checked={edit.receipts} onChange={(v) => E({ receipts: v })} label="Prints receipts" />
          </Row>
          <Row label="Prints bag labels" help={edit.kind === 'epson' ? 'A label for each bag of a food order, as it’s ready: the number, the name, the items and a code to scan before it’s handed over. Best on a sticky label printer with no backing paper' : 'A label for each bag of a food order, as it’s ready: the number, the name, the items and a code to scan before it’s handed over. A Star printer prints the code once it has printed its first slip in the app’s look (most on CloudPRNT do, and Print a test starts it); until then, these aren’t scanned at handover'} inline>
            <Toggle checked={edit.labels} onChange={(v) => E({ labels: v, ...(v && edit.id === null && !edit.stickers ? { tickets: false } : {}) })} label="Prints bag labels" />
          </Row>
          <Row label="Opens the cash drawer" help="A cash drawer plugged into this printer opens for a cash sale, with or without a receipt" inline>
            <Toggle checked={edit.drawer} onChange={(v) => E({ drawer: v })} label="Opens the cash drawer" />
          </Row>
          <div className="flex flex-wrap gap-2 px-5 py-4">
            <button type="button" disabled={busy === 'save' || !edit.name.trim()} onClick={save} className="min-h-[44px] rounded-full px-5 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--card)' }}>{busy === 'save' ? 'Saving…' : edit.id ? 'Save' : 'Add it'}</button>
            <button type="button" onClick={() => setEdit(null)} className="min-h-[44px] rounded-full border px-5 text-[14px] font-semibold" style={{ borderColor: 'var(--line)' }}>Cancel</button>
            {edit.id && <button type="button" disabled={busy === 'remove'} onClick={async () => { if (await act('remove', { action: 'remove', id: edit.id }, 'Taken away. Its address doesn’t work any more.')) setEdit(null); }}
              className="min-h-[44px] rounded-full px-5 text-[14px] font-semibold" style={{ color: '#b42318' }}>Take it away</button>}
          </div>
        </Section>
      )}

      <Section title="Receipts" help="After a sale at the counter or the drive-thru. Text and email are always offered too.">
        <div className="px-5 py-4">
          {manager
            ? <Seg<After> label="After a sale" value={after} onChange={(v) => { setAfter(v); void act('after', { action: 'after', after: v }, v === 'ask' ? 'The counter asks about a receipt after each sale.' : v === 'print' ? 'A receipt prints after each sale.' : 'No receipt prints unless one’s asked for.'); }}
              options={[['ask', 'Ask'], ['print', 'Print one'], ['none', 'Don’t print']]} />
            : <p className="text-[14.5px]">{after === 'ask' ? 'The counter asks about a receipt after each sale.' : after === 'print' ? 'A receipt prints after each sale.' : 'No receipt prints unless one’s asked for.'}</p>}
          {!list.some((p) => p.receipts) && <p className="mt-2 text-[13.5px] cf-muted">No printer here prints receipts yet, so Print opens the tablet’s own print dialog. Turn on Prints receipts for a printer to print there instead.</p>}
        </div>
      </Section>

      <Section title="Your printers" help={list.length ? undefined : 'None yet.'}>
        {overlapOf(list).map((o) => <div key={o} role="note" className="px-5 py-3 text-[14px] font-medium" style={{ color: AMBER }}>{o}</div>)}
        {uncoveredOf(list, stations) && <div role="note" className="px-5 py-3 text-[14px] font-medium" style={{ color: AMBER }}>{uncoveredOf(list, stations)}</div>}
        {list.length === 0 && <div className="px-5 py-4 text-[14.5px] cf-muted">{manager ? 'Add a printer to have tickets print by themselves.' : 'A manager adds printers here.'}</div>}
        {list.map((p) => (
          <div key={p.id} className="space-y-3 px-5 py-4 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px] font-semibold">{p.name}</p>
                <p className="text-[13.5px] cf-muted">{p.kind === 'star' ? 'Star' : 'Epson'}. Prints {p.prints}{p.kind === 'star' && !p.pictures ? ', in plain type until it prints its first slip in the app’s look. Print a test to start it' : ''}</p>
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
