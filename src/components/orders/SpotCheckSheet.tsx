'use client';
// src/components/orders/SpotCheckSheet.tsx — A SPOT CHECK (lib/spot-check). An order picked as it was packed is checked by
// someone other than its packer: every unit scanned again. A wrong or extra item is taken out (the server counts it as a
// mistake); an item that isn't there is marked missing, put in and scanned. Done, it goes on as it would have: onto the
// ready shelf (the customer is told), or on to its label. A manager's PIN can let it go unchecked, kept on the order.
import * as React from 'react';
import { ScanGate } from '@/components/retail/ScanGate';
import { spotDone, spotMissing, spotScan } from '@/lib/fulfil-client';
import { spotLines, spotMistakes } from '@/lib/spot-check';
import { Btn, C, Sheet, feel, muted } from './ui';

export function SpotCheckSheet({ tenantId, order, meId, onClose, onDone }: { tenantId: string; order: any; meId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [say, setSay] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [skipOpen, setSkipOpen] = React.useState(false);
  const [pin, setPin] = React.useState('');
  const lines = spotLines(order);
  const left = lines.reduce((a, l) => a + Math.max(0, l.need - l.got), 0);
  const m = spotMistakes(order);
  const mine = String(order.spotCheck?.packedById || '') === meId;
  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;

  const run = async (f: () => Promise<any>, after?: (r: any) => void) => {
    if (busy) return; setBusy(true);
    const r = await f(); setBusy(false); feel(!!r.ok);
    if (after) after(r); else setSay({ text: r.message, bad: !r.ok });
  };
  const finish = (p?: string) => run(() => spotDone(tenantId, order.id, p), (r) => { if (r.ok) onDone(r.message); else { setSay({ text: r.message, bad: true }); if (r.badPin) setPin(''); } });

  return (
    <Sheet title={`Spot check ${num}`} sub={`${order.customerName || 'Customer'} · packed by ${order.spotCheck?.packedByName || 'a teammate'}`} onClose={onClose}>
      {mine && <p role="alert" className="m-0 mt-2 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>You packed this one, so someone else checks it. A manager can let it go with their PIN below.</p>}
      <ul className="m-0 mt-2 list-none p-0" aria-label="Items to check">
        {lines.map((l) => (
          <li key={l.lineId} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0" style={{ borderColor: C.line }}>
            <span className="min-w-0 flex-1 text-[15px]">{l.name}{l.missing ? <span className="ml-2 text-[13px] font-semibold" style={{ color: C.warn }}>{l.missing} missing</span> : null}</span>
            <span className="text-[15px] font-semibold tabular-nums" style={{ color: l.got >= l.need ? C.ok : C.ink }}>{l.got} of {l.need}</span>
            {l.got + l.missing < l.need && !mine && <button type="button" disabled={busy} onClick={() => void run(() => spotMissing(tenantId, order.id, l.lineId))} className="h-11 text-[14px] font-semibold underline underline-offset-4" style={muted}>It’s missing</button>}
          </li>))}
      </ul>
      {(m.wrong > 0 || m.missing > 0) && <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>Found so far: {[m.wrong ? `${m.wrong} wrong or extra` : '', m.missing ? `${m.missing} missing` : ''].filter(Boolean).join(' and ')}.</p>}
      {say && <p role={say.bad ? 'alert' : 'status'} className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={say.bad ? { background: C.warnSoft, color: C.warn } : { background: C.okSoft, color: C.ok }}>{say.text}</p>}
      {!mine && <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void run(() => spotScan(tenantId, order.id, v))} paused={busy} label={left > 0 ? 'Scan each item in the bag or box' : 'Every item scanned'} /></div>}
      {!mine && <Btn kind="primary" className="mt-3 w-full" disabled={busy || left > 0} onClick={() => void finish()}>{left > 0 ? `${left} more to scan` : 'Finish the check'}</Btn>}
      {!skipOpen ? <button type="button" onClick={() => setSkipOpen(true)} className="mt-2 h-11 text-[15px] font-semibold underline underline-offset-4" style={muted}>No one else is here to check it?</button> : (
        <form className="mt-3 rounded-2xl px-4 py-3.5" style={{ background: C.soft }} onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) void finish(pin); }}>
          <label htmlFor="spot-pin" className="block text-[15px] font-semibold">Manager PIN</label>
          <p className="m-0 mt-0.5 text-[13.5px]" style={muted}>Lets it go without the check. Who approved it goes on the order. Not the person who packed it.</p>
          <div className="mt-2 flex gap-2">
            <input id="spot-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 digits"
              className="h-12 min-w-0 flex-1 rounded-xl px-4 text-[20px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink, letterSpacing: pin ? '0.3em' : undefined }} />
            <Btn kind="primary" type="submit" className="shrink-0" disabled={pin.length !== 4 || busy}>Let it go</Btn>
          </div>
        </form>)}
    </Sheet>);
}
