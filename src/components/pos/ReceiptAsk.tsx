'use client';
// src/components/pos/ReceiptAsk.tsx — THE RECEIPT, JUST AFTER A SALE (design board "Receipts at the counter"; api/receipts).
// Print, Text, Email or No receipt. Just after the sale it does what the business set in Printers (lib/printing
// receiptAfterOf): "Print one" prints by itself on this screen's receipt printer; "Don’t print" and "Ask" wait for a tap.
// A cash sale opens the cash drawer, with a receipt or without one (the server opens it once, only for cash, and only just
// after the sale). Print with no networked receipt printer opens this device's own print dialog with the same slip.
// Opened again later (Waiting's Receipt, Today's sales), nothing prints by itself and the drawer stays shut.
// White surfaces are set inline, so the app's black look (lib/app-theme) takes them over.
import { useEffect, useRef, useState } from 'react';
import { receiptCall } from '@/lib/receipt-client';
import { renderHtml, type PrintDoc } from '@/lib/printing';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const GREEN_TINT = '#ecf6f0', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;
const dark = { background: INK, color: '#fff' } as const;
const quiet = { background: '#fff', border: `1px solid ${LINE}`, color: INK } as const;
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

/** What the lane says about receipts (api/counter): the business's setting, the receipt printers, and whether any
 *  printer opens a cash drawer. */
export type ReceiptSetup = { after: 'ask' | 'print' | 'none'; printers: { id: string; name: string; drawer: boolean }[]; drawer: boolean };
/** This screen's receipt printer, with more than one (picked here, as its card reader is). */
export const RECEIPT_PRINTER_KEY = 'cf.receipt.printer';
export const savedReceiptPrinter = () => { try { return localStorage.getItem(RECEIPT_PRINTER_KEY) || ''; } catch { return ''; } };

/** The slip in this device's own print dialog (a hidden frame, so no pop-up has to be allowed). */
export function printHere(doc: PrintDoc): boolean {
  try {
    const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    const w = f.contentWindow; if (!w) { f.remove(); return false; }
    w.document.open(); w.document.write(renderHtml(doc, { font: PRINT_FONT_STACK, fontHref: PRINT_FONT_HREF })); w.document.close();
    const go = () => { try { w.focus(); w.print(); } catch { /* this device can't print */ } setTimeout(() => f.remove(), 1500); };
    const fonts = (w.document as any).fonts; if (fonts?.ready) fonts.ready.then(go, go); else setTimeout(go, 300);
    return true;
  } catch { return false; }
}

/** How a screen asks about a receipt: signed in (api/receipts), or a lane screen with its own key (api/counter
 *  'receipt'). The same actions either way (lib/receipt-actions-server). */
export type ReceiptCall = (body: { action: 'link' | 'print' | 'drawer' | 'send'; [k: string]: unknown }) => Promise<any>;
export const deskCall = (tenantId: string, receiptId: string): ReceiptCall => (x) => receiptCall({ tenantId, receiptId, ...x });

/** Prints a receipt: on the receipt printer picked (or the only one), or here when there's none. The words to show. */
export async function printReceipt(call: ReceiptCall, o: { printerId?: string | null; drawer?: boolean } = {}): Promise<{ ok: boolean; text: string; drawer?: boolean }> {
  const r: any = await call({ action: 'print', ...(o.printerId ? { printerId: o.printerId } : {}), ...(o.drawer ? { drawer: true } : {}) });
  if (!r?.ok) return { ok: false, text: r?.error || 'The receipt didn’t print. Try again.' };
  const drawer = r.drawer === true; const opened = drawer ? ' The drawer opened.' : '';
  if (r.printer) return { ok: true, text: `Printing on ${r.printer}.${opened}`, drawer };
  if (r.doc && printHere(r.doc)) return { ok: true, text: `It opened in this device’s print dialog.${opened}`, drawer };
  return { ok: false, text: `This device couldn’t open its print dialog. Text or email it instead.${opened}`, drawer };
}

type Props = {
  tenantId: string; receiptId: string;
  /** "C14, Mia" */
  title: string;
  cash: boolean;
  /** The change to give (cash), shown large; null for none. */
  change?: number | null;
  setup: ReceiptSetup | null;
  /** Opened again later: nothing prints by itself, and the drawer stays shut. */
  later?: boolean;
  /** false: nothing by itself (a sale that was already paid, asked again): Print opens the drawer only if it hasn't been. */
  auto?: boolean;
  /** A lane screen with its own key asks through api/counter (deskCall otherwise). */
  call?: ReceiptCall;
  onClose: () => void;
};

export function ReceiptAsk({ tenantId, receiptId, title, cash, change, setup, later, auto = true, call, onClose }: Props) {
  const ask: ReceiptCall = call || deskCall(tenantId, receiptId);
  const printers = setup?.printers || [];
  const [printerId, setPrinterId] = useState(savedReceiptPrinter);
  const printer = printers.find((p) => p.id === printerId) || (printers.length === 1 ? printers[0] : null);
  const [way, setWay] = useState<'sms' | 'email' | null>(null); const [to, setTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null); const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const drawerOpened = useRef(false); const started = useRef(false);

  const say = (text: string, tone: 'good' | 'warn') => setMsg({ text, tone });
  const print = async (withDrawer: boolean) => {
    if (printers.length > 1 && !printer) { say('Pick this screen’s receipt printer first.', 'warn'); return; }
    setBusy('print');
    const r = await printReceipt(ask, { printerId: printer?.id || null, drawer: withDrawer && !drawerOpened.current });
    setBusy(null); if (r.drawer) drawerOpened.current = true;
    if (r.ok) setDone(true);
    say(r.text, r.ok ? 'good' : 'warn');
  };
  const openDrawer = async () => {
    setBusy('drawer');
    const r: any = await ask({ action: 'drawer', ...(printer?.drawer ? { printerId: printer.id } : {}) });
    setBusy(null);
    if (r?.ok) { drawerOpened.current = true; say('The drawer opened.', 'good'); } else say(r?.error || 'The drawer didn’t open. Open it with its key.', 'warn');
  };
  // Just after the sale: the business's setting, and the drawer for cash.
  useEffect(() => {
    if (later || !auto || started.current || !setup) return; started.current = true;
    if (setup.after === 'print' && printer) void print(cash);
    else if (cash && setup.drawer) void openDrawer();
  }, [setup]); // eslint-disable-line react-hooks/exhaustive-deps

  const okTo = way === 'sms' ? to.replace(/\D/g, '').length >= 10 : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const sendIt = async () => {
    if (!way || !okTo) return; setBusy('send');
    const r: any = await ask({ action: 'send', channel: way, to: to.trim() });
    setBusy(null);
    if (r?.ok) { say(`Sent to ${to.trim()}.`, 'good'); setDone(true); setWay(null); setTo(''); } else say(r?.error || 'It didn’t send. Check it and try again.', 'warn');
  };
  const pick = (id: string) => { setPrinterId(id); try { localStorage.setItem(RECEIPT_PRINTER_KEY, id); } catch { /* private window */ } };
  const seg = (on: boolean) => (on ? dark : quiet);

  return (
    <section aria-label={`Receipt for ${title}`} className="space-y-3 rounded-3xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[19px] font-semibold">{title}</h2>
        <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Paid</span>
      </div>
      {!later && (cash && Number(change) > 0
        ? <p className="text-[24px] font-semibold tabular-nums" style={{ color: GREEN }}>Change: {usd(Number(change))}</p>
        : <p className="text-[14.5px]" style={{ color: MUTED }}>{cash ? 'Paid in cash, no change.' : 'Paid by card.'}</p>)}
      <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Receipt</p>
      {printers.length > 1 && <select aria-label="Receipt printer" value={printer?.id || ''} onChange={(e) => pick(e.target.value)} className={`min-h-[44px] w-full rounded-xl border px-3 text-[14.5px] ${RING}`} style={{ background: '#fff', borderColor: LINE, color: INK }}>
        <option value="">Pick a receipt printer</option>{printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void print(cash && !later)} disabled={!!busy} className={btn} style={dark}>{busy === 'print' ? 'Printing…' : 'Print'}</button>
        <button type="button" aria-pressed={way === 'sms'} onClick={() => { setWay(way === 'sms' ? null : 'sms'); setTo(''); }} disabled={!!busy} className={btn} style={seg(way === 'sms')}>Text</button>
        <button type="button" aria-pressed={way === 'email'} onClick={() => { setWay(way === 'email' ? null : 'email'); setTo(''); }} disabled={!!busy} className={btn} style={seg(way === 'email')}>Email</button>
        <button type="button" onClick={onClose} disabled={busy === 'send'} className={btn} style={quiet}>{done || later ? 'Done' : 'No receipt'}</button>
      </div>
      {way && <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}>
        <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>{way === 'sms' ? 'Text it' : 'Email it'}
          <input autoFocus type={way === 'sms' ? 'tel' : 'email'} inputMode={way === 'sms' ? 'tel' : 'email'} value={to} onChange={(e) => setTo(e.target.value.slice(0, 120))} onKeyDown={(e) => { if (e.key === 'Enter') void sendIt(); }}
            placeholder={way === 'sms' ? 'Mobile number' : 'Email address'} autoComplete="off" className="mt-1 block min-h-[44px] w-full rounded-xl border px-3 text-[16px] font-normal outline-none focus:border-[#16171a]" style={{ background: '#fff', borderColor: LINE, color: INK }} /></label>
        <button type="button" onClick={() => void sendIt()} disabled={!okTo || !!busy} className={`${btn} w-full`} style={dark}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
        <p className="text-[12.5px]" style={{ color: MUTED }}>It sends a private link to the full receipt.</p>
      </div>}
      <p role="status" aria-live="polite" className={msg ? 'rounded-xl px-3 py-2 text-[13.5px]' : 'sr-only'} style={msg ? (msg.tone === 'good' ? { background: GREEN_TINT, color: GREEN } : { background: AMBER_TINT, color: AMBER }) : undefined}>{msg?.text || ''}</p>
    </section>
  );
}
