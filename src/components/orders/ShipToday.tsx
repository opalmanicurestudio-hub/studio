'use client';
// src/components/orders/ShipToday.tsx — SHIP TODAY. Everything packed for shipping, as three steps that tick off in
// order: buy the labels, print them, hand the boxes over. Then Close the day makes the USPS manifest (one sheet the
// carrier scans) and shows what went out.
import { labelFormatOf, slipAfterLabel } from '@/lib/label-format';
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Actor } from '@/lib/retail-fulfill';
import { firstName, orderNum } from '@/lib/orders-view';
import { buyLabels, canMarkShipped, closeDay, formsReady, markAllShipped, needsLabel, printLabels } from './bulk';
import { Btn, C, Sheet, muted, Ic } from './ui';

function Step({ n, done, title, sub, children }: { n: number; done: boolean; title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3.5 border-b py-4" style={{ borderColor: C.line }}>
      <span key={done ? 'd' : 'n'} className={`${done ? 'cf-anim-pop ' : ''}grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold`} style={done ? { background: C.ok, color: '#fff' } : { background: C.soft, color: C.ink }}>{done ? Ic.check : n}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
        <p className="m-0 mt-0.5 text-[14px]" style={muted}>{sub}</p>
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </div>);
}

export function ShipToday({ fs, tenantId, orders, actor, rs, onClose, onToast }: { fs: Firestore; tenantId: string; orders: any[]; actor: Actor; rs: any; onClose: () => void; onToast: (m: string) => void }) {
  const ship = orders.filter((o) => o.method === 'ship' && o.stage === 'packed' && !o.holdForReview);
  const toLabel = ship.filter(needsLabel);
  const labelled = ship.filter((o) => o.labelUrl || o.trackingNumber);
  const toHand = ship.filter(canMarkShipped);
  const unchecked = labelled.filter((o) => !o.labelCheckedAt);
  const [busy, setBusy] = React.useState('');
  const [printed, setPrinted] = React.useState(false);
  const [handed, setHanded] = React.useState(0);
  const [closed, setClosed] = React.useState<{ message: string; documents: string[]; waitingIds: string[] } | null>(null);
  // Shippo makes the USPS form in the background: keep asking (every 5 seconds, for up to 2 minutes) until the sheet is there.
  const waitKey = (closed?.waitingIds || []).join(',');
  React.useEffect(() => {
    if (!waitKey) return;
    let tries = 0; let stop = false;
    const tick = async () => {
      if (stop || tries++ > 24) return;
      const r = await formsReady(tenantId, waitKey.split(','));
      if (stop) return;
      if (r.documents.length) setClosed((c) => (c ? { ...c, documents: [...new Set([...c.documents, ...r.documents])], waitingIds: r.pending } : c));
      if (r.pending.length) setTimeout(() => void tick(), 5000);
    };
    const first = setTimeout(() => void tick(), 4000);
    return () => { stop = true; clearTimeout(first); };
  }, [waitKey, tenantId]);
  const go = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } finally { setBusy(''); } };

  const current = toLabel.length ? 1 : labelled.length && !printed ? 2 : toHand.length ? 3 : 4;
  const names = (list: any[]) => list.slice(0, 3).map((o) => firstName(o.customerName) || orderNum(o)).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');

  return (
    <Sheet title="Ship today" sub={ship.length ? `${ship.length} box${ship.length === 1 ? '' : 'es'} packed for shipping` : 'Nothing packed for shipping yet'} onClose={onClose} closeLabel="Done" wide>
      <Step n={1} done={ship.length > 0 && toLabel.length === 0} title={toLabel.length ? `Buy ${toLabel.length} label${toLabel.length === 1 ? '' : 's'}` : 'Labels bought'} sub={toLabel.length ? `For ${names(toLabel)}. The service each customer paid for, with your signature and insurance rules.` : ship.length ? 'Every packed box has a label.' : 'Packed ship orders appear here.'}>
        {toLabel.length > 0 && <Btn kind={current === 1 ? 'primary' : 'soft'} className="w-full sm:w-auto" disabled={!!busy} onClick={() => void go('buy', async () => { const r = await buyLabels(tenantId, toLabel, rs); onToast(r.message); })}>{busy === 'buy' ? 'Buying labels…' : `Buy ${toLabel.length} label${toLabel.length === 1 ? '' : 's'}`}</Btn>}
      </Step>
      <Step n={2} done={printed && labelled.length > 0} title="Print the labels" sub={labelled.length ? `${labelled.length} ready to print${labelFormatOf(rs) === 'paper' ? ', one per letter page' : labelFormatOf(rs) === 'zpl' ? ' as a label-printer file' : ', one per page for a 4 × 6 printer'}${slipAfterLabel(rs) ? ', each with its packing slip' : ''}.` : 'Once labels are bought.'}>
        {labelled.length > 0 && <Btn kind={current === 2 ? 'primary' : 'soft'} className="w-full sm:w-auto" disabled={!!busy} onClick={() => void go('print', async () => { const e = await printLabels(tenantId, labelled); if (e) onToast(e); else setPrinted(true); })}>{printed ? 'Print again' : `Print ${labelled.length} label${labelled.length === 1 ? '' : 's'}`}</Btn>}
      </Step>
      <Step n={3} done={handed > 0 && toHand.length === 0} title={toHand.length ? 'Hand them to the carrier' : handed ? `${handed} handed over` : 'Hand them to the carrier'} sub={unchecked.length && toHand.length ? `${unchecked.length} label${unchecked.length === 1 ? ' hasn’t' : 's haven’t'} been checked. Scan each label on its box first, so the right box goes out.` : toHand.length ? 'Marks them shipped. Customers get tracking from the carrier as it moves.' : 'Labelled boxes appear here.'}>
        {toHand.length > 0 && <Btn kind={current === 3 ? 'primary' : 'soft'} className="w-full sm:w-auto" disabled={!!busy} onClick={() => void go('hand', async () => { const n = toHand.length; onToast(await markAllShipped(fs, tenantId, toHand, actor)); setHanded((h) => h + n); })}>{busy === 'hand' ? 'Marking…' : `Mark ${toHand.length} shipped`}</Btn>}
      </Step>
      <div className="pt-4">
        {closed ? (
          <div className="cf-anim-rise rounded-2xl p-4" style={{ background: closed.documents.length ? C.okSoft : C.soft }}>
            <p className="m-0 text-[15px] font-semibold" style={{ color: closed.documents.length ? C.ok : C.ink }}>{closed.message}</p>
            {closed.waitingIds.length > 0 && <p className="m-0 mt-1 text-[14px]" style={muted}>Shippo is still making {closed.waitingIds.length > 1 ? 'some of the forms' : 'the form'}. {closed.waitingIds.length > 1 ? 'They’ll' : 'It’ll'} appear here in a minute.</p>}
            {closed.documents.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-11 items-center text-[15px] font-semibold underline" style={{ color: C.ink }}>Open the manifest{closed.documents.length > 1 ? ` ${i + 1}` : ''}</a>)}
          </div>
        ) : (
          <>
            <Btn kind={current === 4 ? 'primary' : 'soft'} className="w-full text-[17px]" disabled={!!busy} onClick={() => void go('close', async () => { const r = await closeDay(tenantId); setClosed(r); })}>{busy === 'close' ? 'Closing…' : 'Close the day'}</Btn>
            <p className="m-0 mt-2 text-center text-[13px]" style={muted}>Makes one USPS sheet for today’s boxes, so the carrier scans once.</p>
          </>)}
      </div>
    </Sheet>);
}
