'use client';
// src/components/drive-thru/BagSheets.tsx — BAG LABELS AND THE SCAN BEFORE IT GOES, on the counter, the drive-thru window
// and the curbside screen (lib/food-bags; design board "Bag labels, and a check before it goes", A):
//   - BagScanSheet: a handover refused until each bag's label is scanned opens this: each bag of the order, ticked as
//     it's scanned (a scanner, or the camera), a bag from another order says whose it is; once every bag is scanned it
//     hands over by itself. A label that won't scan: print it again, or a manager's PIN lets it go without, with why.
//     Its item stickers too (lib/item-stickers; design board "A sticker on each item", A), each by name, with Print
//     again for a remake or a torn sticker.
//   - BagLabelsSheet: print the labels, here on this device or on the bag-label printer, with how many bags.
//   - printLabelsHere: the labels through this device's own print dialog, each with its code to scan.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check } from 'lucide-react';
import { ScanGate } from '@/components/retail/ScanGate';
import { esc, PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';
import { bagName, MAX_FOOD_BAGS, SKIP_REASONS, type BagLabel } from '@/lib/food-bags';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const btn = 'min-h-[48px] rounded-xl px-4 text-[15px] font-semibold disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;

export type BagWait = { orderId: string; number: string; of: number; left: number[];
  /** Its item stickers to scan too (lib/item-stickers), each ticked or not. */
  items?: { k: string; name: string; done: boolean }[] };
type ScanReply = { ok: true; orderId: string; n: number | null; k: string | null; name: string | null; left: number[]; itemsLeft: string[] } | { ok: false; error: string };
/** A scan's answer from the server, for the sheet: a bag (n) or an item's sticker (k, name), and what's left. */
export const scanReplyOf = (d: any): ScanReply => d?.ok
  ? { ok: true, orderId: String(d.orderId), n: d.n != null ? Number(d.n) : null, k: d.k ? String(d.k) : null, name: d.name ? String(d.name) : null, left: Array.isArray(d.left) ? d.left : [], itemsLeft: Array.isArray(d.itemsLeft) ? d.itemsLeft.map(String) : [] }
  : { ok: false, error: String(d?.error || 'That didn’t go through. Try again.') };

function feel(ok: boolean) { try { navigator.vibrate?.(ok ? 30 : [70, 50, 70]); } catch { /* best effort */ } }
/** A sheet's own keys and focus: its first button in focus as it opens, Escape closes it, and focus goes back to where it
 *  was. */
function useSheet(onClose: () => void) {
  const box = useRef<HTMLDivElement | null>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  return box;
}

const Tick = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
  <span className="inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3 text-[14px] font-semibold" style={done ? { background: GREEN_TINT, color: GREEN } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>
    <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[12px]" style={done ? { background: GREEN, color: '#fff' } : { border: `1.5px solid #b8bbc0` }}>{done ? <Check size={13} strokeWidth={3} /> : null}</span>
    {children}<span className="sr-only">{done ? ', scanned' : ', to scan'}</span>
  </span>);

/** Each bag of the order, and each item sticker, scanned before it goes. */
export function BagScanSheet({ title, waiting, scan, onDone, skip, print, printItem, onClose }: {
  title: string; waiting: BagWait[];
  scan: (code: string) => Promise<ScanReply>;
  /** Everything scanned: hand it over now. */
  onDone: () => void;
  /** A manager's PIN, and why: hand it over without everything scanned. */
  skip: (pin: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  /** Print an order's labels again (torn, or never printed): the scan closes, and opens afresh with the next handover. */
  print?: (orderId: string) => void;
  /** Print one item's sticker again (a remake, a torn one): the old one stops scanning. */
  printItem?: (orderId: string, k: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [left, setLeft] = useState<Record<string, number[]>>(() => Object.fromEntries(waiting.map((w) => [w.orderId, w.left])));
  const [itemsLeft, setItemsLeft] = useState<Record<string, string[]>>(() => Object.fromEntries(waiting.map((w) => [w.orderId, (w.items || []).filter((i) => !i.done).map((i) => i.k)])));
  const [err, setErr] = useState(''); const [good, setGood] = useState(''); const [busy, setBusy] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false); const [pin, setPin] = useState(''); const [why, setWhy] = useState('');
  const box = useSheet(onClose);
  const onScan = async (v: string) => {
    if (busy) return;
    setBusy(true); setErr('');
    const r = await scan(v).catch(() => ({ ok: false as const, error: 'No connection. Try again.' }));
    setBusy(false);
    if (!r.ok) { feel(false); setGood(''); setErr(r.error); return; }
    feel(true);
    const next = { ...left, [r.orderId]: r.left }; const nextItems = { ...itemsLeft, [r.orderId]: r.itemsLeft };
    setLeft(next); setItemsLeft(nextItems);
    const w = waiting.find((x) => x.orderId === r.orderId); const of = w && waiting.length > 1 ? ` (${w.number})` : '';
    setGood(r.k ? `${r.name || 'The item'}${of} scanned.` : `${w && w.of > 1 ? `Bag ${r.n} of ${w.of}` : 'The bag'}${of} scanned.`);
    if (Object.values(next).every((l) => l.length === 0) && Object.values(nextItems).every((l) => l.length === 0)) { setGood('Everything scanned. Handing it over.'); onDone(); }
  };
  const again = async (orderId: string, k: string, name: string) => {
    if (!printItem || busy) return;
    setBusy(true); setErr('');
    const r = await printItem(orderId, k).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    setBusy(false);
    if (!r.ok) { setGood(''); setErr(r.error || 'That didn’t print.'); return; }
    setItemsLeft((x) => ({ ...x, [orderId]: Array.from(new Set([...(x[orderId] || []), k])) }));
    setGood(`A new sticker for ${name} is printing. The old one won’t scan.`);
  };
  const doSkip = async () => {
    if (pin.length !== 4 || !why || busy) return;
    setBusy(true); setErr('');
    const r = await skip(pin, why).catch(() => ({ ok: false, error: 'No connection. Try again.' }));
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'That didn’t go through.'); setPin(''); }
  };
  const total = Object.values(left).reduce((n, l) => n + l.length, 0) + Object.values(itemsLeft).reduce((n, l) => n + l.length, 0);
  const bags = waiting.reduce((n, w) => n + w.of, 0); const anyItems = waiting.some((w) => (w.items || []).length > 0);
  const lead = anyItems ? `Scan ${bags ? 'each bag’s label and ' : ''}each item’s sticker, so the right order goes to the right guest. ${total} still to scan.`
    : bags === 1 ? 'Scan the code on the bag’s label, so the right bag goes to the right guest.' : `Scan the code on each bag’s label, so the right bags go to the right guest. ${total} still to scan.`;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="bag-scan-title" className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 sm:p-6 space-y-4" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="bag-scan-title" className="text-[20px] font-semibold">{title}</h2>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>{lead}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border text-[20px]" style={{ borderColor: LINE }}>×</button>
        </div>
        <ul className="space-y-2" aria-label={anyItems ? 'Bags and items' : 'Bags'}>
          {waiting.map((w) => (
            <li key={w.orderId} className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}>
              {waiting.length > 1 && <p className="text-[14px] font-semibold">{w.number}</p>}
              {w.of > 0 && <div className="flex flex-wrap gap-2">
                {Array.from({ length: w.of }, (_, i) => i + 1).map((n) => <Tick key={n} done={!(left[w.orderId] || []).includes(n)}>{bagName(n, w.of)}</Tick>)}
              </div>}
              {(w.items || []).map((it) => { const done = !(itemsLeft[w.orderId] || []).includes(it.k); return (
                <div key={it.k} className="flex flex-wrap items-center gap-2">
                  <Tick done={done}>{it.name}</Tick>
                  {!done && printItem && <button type="button" disabled={busy} onClick={() => void again(w.orderId, it.k, it.name)} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold underline underline-offset-4 disabled:opacity-40" style={{ color: MUTED }} aria-label={`Print again, ${it.name}`}>Print again</button>}
                </div>); })}
            </li>))}
        </ul>
        {good && !err && <p role="status" className="rounded-xl px-3 py-2 text-[14px] font-medium" style={{ background: GREEN_TINT, color: GREEN }}>{good}</p>}
        {err && <p role="alert" className="rounded-xl px-3 py-2 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        <div className="overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy} label={anyItems ? 'Point at the code on a label or sticker' : 'Point at the code on the bag’s label'} /></div>
        {print && waiting.some((w) => w.of > 0) && <div className="flex flex-wrap gap-2">{waiting.filter((w) => w.of > 0).map((w) => <button key={w.orderId} type="button" onClick={() => print(w.orderId)} className={btn} style={quiet}>{waiting.length > 1 ? `Print ${w.number}’s labels again` : 'Print the labels again'}</button>)}</div>}
        {!skipOpen
          ? <button type="button" onClick={() => setSkipOpen(true)} className="min-h-[44px] text-[15px] font-semibold underline underline-offset-4" style={{ color: MUTED }}>{anyItems ? 'A label or sticker won’t scan?' : 'A label won’t scan?'}</button>
          : <form className="rounded-2xl p-4 space-y-3" style={{ background: SOFT }} onSubmit={(e) => { e.preventDefault(); void doSkip(); }}>
              <div role="group" aria-labelledby="bag-skip-why" className="space-y-2">
                <p id="bag-skip-why" className="text-[15px] font-semibold">Why it’s going without everything scanned</p>
                <div className="flex flex-wrap gap-2">
                  {SKIP_REASONS.map((r) => <button key={r.id} type="button" aria-pressed={why === r.id} onClick={() => setWhy(r.id)} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]"
                    style={why === r.id ? { background: INK, color: '#fff' } : quiet}>{r.label}</button>)}
                </div>
              </div>
              <label htmlFor="bag-skip-pin" className="block text-[15px] font-semibold">A manager’s PIN</label>
              <p className="text-[13.5px]" style={{ color: MUTED }}>Hands it over without everything scanned. Who okayed it, and why, go on the order.</p>
              <div className="flex gap-2">
                <input id="bag-skip-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 digits"
                  className="h-12 min-w-0 flex-1 rounded-xl px-4 text-[20px] tabular-nums outline-none" style={{ border: `1px solid ${LINE}`, background: '#fff', letterSpacing: pin ? '0.3em' : undefined }} />
                <button type="submit" disabled={pin.length !== 4 || !why || busy} aria-describedby={!why ? 'bag-skip-first' : undefined} className={`${btn} shrink-0`} style={{ background: INK, color: '#fff' }}>Hand over</button>
              </div>
              {!why && <p id="bag-skip-first" className="text-[13.5px]" style={{ color: MUTED }}>Pick why first.</p>}
            </form>}
      </div>
    </div>
  );
}

/** How many bags, and where to print the labels. */
export function BagLabelsSheet({ number, start, printer, onPrint, onClose }: {
  number: string; start: number; printer: string | null;
  onPrint: (count: number, where: 'here' | 'printer') => Promise<string | null>;
  onClose: () => void;
}) {
  const [count, setCount] = useState(Math.min(MAX_FOOD_BAGS, Math.max(1, start)));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const box = useSheet(onClose);
  const go = async (where: 'here' | 'printer') => { setBusy(true); setErr(''); const e = await onPrint(count, where); setBusy(false); if (e) setErr(e); else onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="bag-labels-title" className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 sm:p-6 space-y-4" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="bag-labels-title" className="text-[20px] font-semibold">Bag labels for {number}</h2>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>One label for each bag, with the items and a code to scan before it’s handed over.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border text-[20px]" style={{ borderColor: LINE }}>×</button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-semibold">How many bags</span>
          <div className="flex h-12 items-center overflow-hidden rounded-xl" style={{ border: `1px solid ${LINE}` }}>
            <button type="button" disabled={count <= 1} onClick={() => setCount((c) => c - 1)} aria-label="One bag fewer" className="h-12 w-12 text-[22px] disabled:opacity-40">−</button>
            <span className="w-10 text-center text-[18px] font-semibold tabular-nums" aria-live="polite">{count}</span>
            <button type="button" disabled={count >= MAX_FOOD_BAGS} onClick={() => setCount((c) => c + 1)} aria-label="One bag more" className="h-12 w-12 text-[22px] disabled:opacity-40">+</button>
          </div>
        </div>
        {err && <p role="alert" className="rounded-xl px-3 py-2 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        <div className="grid gap-2">
          {printer && <button type="button" disabled={busy} onClick={() => void go('printer')} className={btn} style={{ background: INK, color: '#fff' }}>Print on {printer}</button>}
          <button type="button" disabled={busy} onClick={() => void go('here')} className={btn} style={printer ? quiet : { background: INK, color: '#fff' }}>{printer ? 'Print here instead' : 'Print here'}</button>
        </div>
      </div>
    </div>
  );
}

/** The labels through this device's own print dialog (a label or receipt printer set up on it): one to a page, each
 *  with its code to scan. False when it couldn't open. */
export async function printLabelsHere(labels: BagLabel[]): Promise<boolean> {
  if (typeof document === 'undefined' || !labels.length) return false;
  const qr = await Promise.all(labels.map((l) => (l.code ? QRCode.toDataURL(l.code, { margin: 0, width: 220, errorCorrectionLevel: 'M' }).catch(() => '') : Promise.resolve(''))));
  const one = (l: BagLabel, i: number) => `<section style="page-break-after:always;break-after:page;padding:6px 4px 10px">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div><div style="font-size:30px;font-weight:700;line-height:1">${esc(l.number || 'Order')}</div><div style="font-size:12px;margin-top:2px">${esc(l.way)}</div>
${l.name ? `<div style="font-size:18px;font-weight:700;margin-top:4px">${esc(l.name)}</div>` : ''}<div style="font-size:13px;margin-top:2px">${esc(bagName(l.n, l.of))}</div></div>
${qr[i] ? `<img src="${qr[i]}" alt="" style="width:26mm;height:26mm;image-rendering:pixelated">` : ''}</div>
<hr style="border:none;border-top:1px dashed #000;margin:6px 0">
${l.items.map((it) => `<div style="font-size:14px;font-weight:700">${it.qty}&nbsp;&nbsp;${esc(it.name)}</div>${it.sub.map((s) => `<div style="padding-left:16px;font-size:12px">${esc(s)}</div>`).join('')}`).join('')}
${l.allergy ? `<div style="background:#000;color:#fff;font-weight:700;padding:3px 5px;margin-top:6px;font-size:13px">${esc(l.allergy)}</div>` : ''}</section>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bag labels</title><link href="${PRINT_FONT_HREF}" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:${PRINT_FONT_STACK};width:72mm;color:#000;background:#fff;line-height:1.35}@media print{@page{margin:0;size:80mm auto}body{width:80mm}}</style></head><body>${labels.map(one).join('')}</body></html>`;
  const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  const w = f.contentWindow; if (!w) { f.remove(); return false; }
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch { /* the device can't print */ } setTimeout(() => f.remove(), 2000); };
  const fonts = (w.document as any).fonts; if (fonts?.ready) fonts.ready.then(go, go); else setTimeout(go, 300);
  return true;
}
