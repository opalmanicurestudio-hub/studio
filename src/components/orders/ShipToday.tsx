'use client';
// src/components/orders/ShipToday.tsx — SHIP TODAY. Everything packed for shipping, as three steps that tick off in
// order, then the day closed:
//   1. Buy every label at once. Before anyone pays, each service and how many (the standard one, or the one the
//      customer paid for), orders going in more than one box, the insured goods and what the insurance costs, the
//      signatures, any order that can't get a label yet and why, and the total (api/retail/shipping-labels-bulk). A
//      label is one box's. Priced again when an order's address, boxes or items change, never while a buy is running.
//   2. Print them in one stack, in the order the boxes were packed, and check each label onto its box at the bench: how
//      many are checked and which aren't (lib/ship-run benchCheck). Scanning the slip in a box and then a label that
//      isn't that box's beeps and says whose it is (the Orders screen's scanner). Printed, or every label checked, and
//      the step is done; the stack can always be printed again.
//   3. Hand them to the carrier: mark them shipped, and book the USPS pickup (api/retail/pickup), one a day, unless the
//      shop has a regular one. A booking USPS didn't answer about says to check with USPS before booking again.
//   Close the day: the USPS form (one sheet the carrier scans, every box on it), the labels bought today, and the
//   postage coming back for labels nobody used (api/retail/close-day).
import { labelFormatOf, slipAfterLabel } from '@/lib/label-format';
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Actor } from '@/lib/retail-fulfill';
import { useTenant } from '@/context/TenantContext';
import { firstName, money, orderNum } from '@/lib/orders-view';
import { liveSlots } from '@/lib/label-boxes';
import { addressKey } from '@/lib/address-flow';
import { benchCheck, packBoxesOf, planSummary, type LabelPlan, type LeftOut } from '@/lib/ship-run';
import { clockLabel, dayLabel } from '@/lib/ship-promise';
import { whenWord } from '@/lib/ship-day';
import { dayKey, tenantTimeZone } from '@/lib/tenant-time';
import { bookPickup, buyLabels, canMarkShipped, closeDay, formsReady, markAllShipped, needsLabel, pickupStatus, previewLabels, printLabels, type Closed, type PickupBooking, type PickupStatus } from './bulk';
import { Btn, C, Sheet, muted, Ic } from './ui';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Whole dollars when there are no cents ($612), otherwise to the cent. */
const dollars = (c: number) => (Math.round(c) % 100 === 0 ? `$${Math.round(c) / 100}` : money(c));

function Step({ n, state, title, sub, children, last }: { n: number; state: 'done' | 'now' | 'later'; title: string; sub: string; children?: React.ReactNode; last?: boolean }) {
  const done = state === 'done';
  // A step still to come is quieter in its heading only: its buttons keep full contrast.
  return (
    <div className="flex gap-3.5 py-4" style={{ borderBottom: last ? undefined : `1px solid ${C.line}` }}>
      <span key={done ? 'd' : 'n'} className={`${done ? 'cf-anim-pop ' : ''}grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold`} style={done ? { background: C.ok, color: '#fff' } : state === 'now' ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.muted }}>{done ? Ic.check : n}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[17px] font-semibold tracking-[-0.01em]" style={state === 'later' ? { color: C.muted } : undefined}>{title}</p>
        <p className="m-0 mt-0.5 text-[14px] leading-snug" style={muted}>{sub}</p>
        {children ? <div className="mt-3 flex flex-col gap-2.5">{children}</div> : null}
      </div>
    </div>);
}

function Line({ left, right, tone, strong }: { left: React.ReactNode; right?: React.ReactNode; tone?: string; strong?: boolean }) {
  return <span className="flex justify-between gap-2.5 text-[14px] leading-snug" style={{ color: tone || C.ink, fontWeight: strong ? 600 : 400 }}><span className="min-w-0">{left}</span>{right != null ? <span className="shrink-0 text-right">{right}</span> : null}</span>;
}

function Panel({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' }) {
  const look = tone === 'warn' ? { background: C.warnSoft, color: C.warn } : tone === 'ok' ? { background: C.okSoft, color: C.ok } : { background: C.soft, color: C.ink };
  return <div className="flex flex-col gap-1.5 rounded-2xl px-4 py-3 text-[14px] leading-snug" style={look}>{children}</div>;
}

/** Why an order was left out, in the customer's name where it's about them. */
function leftWhy(why: string, o: any): string {
  const who = o ? firstName(o.customerName) : 'The customer';
  if (/asked to change the address/i.test(why)) return `${who} asked to change the address. Answer that first.`;
  return `${o ? `${who}: ` : ''}${why.replace(/\.$/, '')}.`;
}

/** What the form's message adds after "Hand the carrier the sheet." (boxes that couldn't go on it, labels left off). */
const formNotes = (message: string): string => String(message || '').split(/Hand the carrier the sheets?\.\s*/)[1]?.trim() || '';

/** A pickup's window as Shippo confirmed it ("9:00 AM to 5:00 PM"), else the window asked for. */
function windowOf(start: string, end: string): string {
  const hm = (v: string) => { const m = /T(\d{2}):(\d{2})/.exec(String(v || '')); return m ? clockLabel(`${m[1]}:${m[2]}`) : ''; };
  const a = hm(start), b = hm(end);
  return a && b ? `${a} to ${b}` : '9:00 AM to 5:00 PM';
}

/** What a price depends on, per order: its address, a change waiting, its boxes and its items. */
const priceSig = (o: any) => [o.id, addressKey(o.shippingAddress), String(o.addressRequest?.status || ''), JSON.stringify(o.packBoxes || []),
  (o.lines || []).map((l: any) => `${l.lineId}:${l.qtyOrdered}:${l.qtyShorted || 0}:${l.status || ''}`).join(',')].join('|');

export function ShipToday({ fs, tenantId, orders, actor, rs, onClose, onToast }: { fs: Firestore; tenantId: string; orders: any[]; actor: Actor; rs: any; onClose: () => void; onToast: (m: string) => void }) {
  const { selectedTenant } = useTenant() as any;
  const tz = tenantTimeZone(selectedTenant);
  const ship = orders.filter((o) => o.method === 'ship' && o.stage === 'packed' && !o.holdForReview);
  const toLabel = ship.filter(needsLabel);
  const labelled = ship.filter((o) => o.labelUrl || o.trackingNumber);
  const toHand = ship.filter(canMarkShipped);
  const boxesOf = (o: any) => (o.labelUrl || o.trackingNumber ? Math.max(1, liveSlots(o).length) : Math.max(1, packBoxesOf(o).length));
  const own = (o: any) => !o.labelFromOrderId && !o.shippedWithOrderId;
  const boxCount = ship.filter(own).reduce((a, o) => a + boxesOf(o), 0);
  const handBoxes = toHand.filter(own).reduce((a, o) => a + boxesOf(o), 0);
  const check = benchCheck(labelled);

  const [busy, setBusy] = React.useState('');
  const [printed, setPrinted] = React.useState(false);
  const [handed, setHanded] = React.useState(0);
  const [bought, setBought] = React.useState<{ orders: number; boxes: number; cents: number } | null>(null);
  const [closed, setClosed] = React.useState<Closed | null>(null);
  const go = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } finally { setBusy(''); } };
  const buying = busy === 'buy';

  // 1. THE LABELS, PRICED. Asked again when an order waiting for a label changes (its address, boxes or items), or on
  // "Price again"; never while labels are being bought (each one bought changes the list), and once when that's done.
  const labelKey = toLabel.map(priceSig).sort().join('\n');
  const [preview, setPreview] = React.useState<{ key: string; plans: LabelPlan[]; left: LeftOut[]; error?: string } | null>(null);
  const [tries, setTries] = React.useState(0);
  React.useEffect(() => {
    if (!labelKey || buying) return;
    const ctl = new AbortController();
    setPreview((p) => (p && p.key === labelKey ? null : p));
    void previewLabels(tenantId, toLabel, ctl.signal).then((r) => { if (!ctl.signal.aborted) setPreview({ key: labelKey, plans: r.plans, left: r.left, error: r.error }); });
    return () => ctl.abort();
  }, [labelKey, tenantId, tries, buying]); // eslint-disable-line react-hooks/exhaustive-deps
  const priced = preview && preview.key === labelKey ? preview : null;
  const sum = priced ? planSummary(priced.plans) : null;
  const byId = new Map(ship.map((o) => [o.id, o]));
  const buyable = priced ? toLabel.filter((o) => priced.plans.some((p) => p.orderId === o.id)) : toLabel;
  const buyLabelsCount = sum ? sum.boxes : toLabel.filter(own).reduce((a, o) => a + boxesOf(o), 0);

  // 3. THE PICKUP. Where it stands, asked when the sheet opens, after a booking, and a moment after labels land.
  const [pickup, setPickup] = React.useState<PickupStatus | null>(null);
  const [pickupErr, setPickupErr] = React.useState('');
  React.useEffect(() => {
    if (buying) return;
    let stop = false;
    const tm = setTimeout(() => { void pickupStatus(tenantId).then((p) => { if (!stop) setPickup(p); }); }, 600);
    return () => { stop = true; clearTimeout(tm); };
  }, [tenantId, handed, labelled.length, buying]);
  const book = (retry: boolean) => void go('pickup', async () => {
    setPickupErr('');
    const r = await bookPickup(tenantId, retry);
    if (r.booking) setPickup((p) => (p ? { ...p, booking: r.booking! } : p));
    if (!r.ok) { setPickupErr(r.error || 'The pickup didn’t book.'); return; }
    onToast(r.booking?.status === 'PENDING' ? 'USPS pickup requested.' : 'USPS pickup booked.');
  });

  // Shippo makes the USPS form in the background: keep asking (every 5 seconds, for up to 2 minutes) until it's there.
  const waitKey = (closed?.waitingIds || []).join(',');
  React.useEffect(() => {
    if (!waitKey) return;
    let tries = 0; let stop = false;
    const tick = async () => {
      if (stop || tries++ > 24) return;
      const r = await formsReady(tenantId, waitKey.split(','));
      if (stop) return;
      setClosed((c) => (c ? { ...c, documents: [...new Set([...c.documents, ...r.documents])], waitingIds: r.pending,
        message: r.failed && !c.message.includes('couldn’t make') ? `${c.message} Shippo couldn’t make ${r.failed > 1 ? 'some of the forms' : 'the form'}; those boxes go on the next one, and the carrier scans them meanwhile.` : c.message } : c));
      if (r.pending.length) setTimeout(() => void tick(), 5000);
    };
    const first = setTimeout(() => void tick(), 4000);
    return () => { stop = true; clearTimeout(first); };
  }, [waitKey, tenantId]);

  // The steps: what's left to buy is what can be bought (an order left out doesn't hold the others up), printing is done
  // once the stack is printed or every label is checked at the bench, and handing over comes once nothing waits on those.
  const toBuy = priced ? buyable.length : toLabel.length;
  const stepBuy: 'done' | 'now' = ship.length > 0 && toLabel.length === 0 ? 'done' : 'now';
  const allChecked = check.total > 0 && check.checked >= check.total;
  const stepPrint: 'done' | 'now' | 'later' = !labelled.length ? 'later' : printed || allChecked ? 'done' : 'now';
  const stepHand: 'done' | 'now' | 'later' = toHand.length ? (toBuy > 0 || stepPrint === 'now' ? 'later' : 'now') : handed ? 'done' : 'later';
  const today = dayKey(new Date(), tz);
  const leftOut = priced ? priced.left : [];

  // ── Closed: the form, the day, the money coming back ──
  if (closed) {
    const s = closed.summary;
    const others = (s?.carriers || []).filter((c) => c.carrier !== 'USPS');
    return (
      <Sheet title="Close the day" sub={dayLabel(today, tz)} onClose={onClose} closeLabel="Done" wide>
        <div className="mt-2 flex flex-col gap-3">
          {closed.documents.length > 0 || closed.waitingIds.length > 0 ? (
            <Panel tone="ok">
              <span className="flex items-center gap-2 text-[15px] font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: C.ok }}>{Ic.check}</span>USPS form {closed.waitingIds.length && !closed.documents.length ? 'being made' : 'ready'} for {plural(closed.count, 'box', 'boxes')}</span>
              <span style={{ color: C.ink }}>Hand it to the carrier with the boxes. One scan and every box on it shows as received by USPS: your proof of handoff for claims and “never arrived” disputes.</span>
            </Panel>
          ) : <Panel>{closed.message}</Panel>}
          {closed.documents.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="cf-press inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold" style={{ background: C.ink, color: C.paper }}>Print the USPS form{closed.documents.length > 1 ? ` ${i + 1}` : ''}</a>)}
          {closed.waitingIds.length > 0 && <p className="m-0 text-[14px]" style={muted}>Shippo is still making {closed.waitingIds.length > 1 ? 'some of the forms' : 'the form'}. {closed.waitingIds.length > 1 ? 'They’ll' : 'It’ll'} appear here in a minute.</p>}
          {(closed.documents.length > 0 || closed.waitingIds.length > 0) && formNotes(closed.message) && <p className="m-0 text-[14px]" style={muted}>{formNotes(closed.message)}</p>}
          {s && s.labels > 0 && (
            <div className="flex flex-col gap-1.5 rounded-2xl px-4 py-3" style={{ border: `1px solid ${C.line}` }}>
              <span className="text-[15px] font-semibold">Today</span>
              <Line left="Labels bought" right={s.labels} />
              <Line left="Postage" right={money(s.postageCents)} />
              {s.insured.orders > 0 && <Line left="Insured goods" right={`${dollars(s.insured.goodsCents)} · ${money(s.insured.feeCents)}`} />}
              {s.signatures > 0 && <Line left="Signature" right={plural(s.signatures, 'order')} />}
              {others.map((c) => <Line key={c.carrier} left={`${c.carrier}, scanned at pickup`} right={plural(c.boxes, 'box', 'boxes')} tone={C.muted} />)}
            </div>)}
          {s && s.moneyBack.labels > 0 && (
            <Panel>
              <span className="font-semibold">Money back</span>
              <span>{plural(s.moneyBack.labels, 'label')} nobody used {s.moneyBack.labels === 1 ? 'was' : 'were'} voided this week{s.moneyBack.cents > 0 ? `: ${money(s.moneyBack.cents)} ${s.moneyBack.backCents >= s.moneyBack.cents ? 'is back' : s.moneyBack.backCents > 0 ? `coming back (${money(s.moneyBack.backCents)} back so far)` : 'is on its way back'}` : ''}.</span>
              {s.moneyBack.checkCents > 0 && <span>{money(s.moneyBack.checkCents)} Shippo hasn’t confirmed: check it under Labels.</span>}
            </Panel>)}
          <p className="m-0 text-center text-[13px]" style={muted}>A label bought on another day gets its own form for that day, so nothing is left out.</p>
        </div>
      </Sheet>);
  }

  const pickupCard = (b: PickupBooking, when: string, dayOf: string) => b.status === 'UNKNOWN' ? (<>
    <span className="text-[15px] font-semibold" style={{ color: C.warn }}>USPS pickup {when}: not confirmed</span>
    <span className="text-[14px] leading-snug">We asked USPS for a pickup {dayLabel(dayOf, tz)} and didn’t hear back, so it may already be booked. Check on usps.com (Package Pickup, with your ship-from address) before booking again.</span>
    <Btn kind="soft" className="h-11 w-full text-[15px]" style={{ background: C.paper, border: `1px solid ${C.ink}` }} disabled={!!busy} onClick={() => book(true)}>{busy === 'pickup' ? 'Booking…' : 'It isn’t booked: book it'}</Btn>
  </>) : (<>
    <span className="text-[15px] font-semibold">USPS pickup {b.status === 'PENDING' ? 'requested' : 'booked'}, {when}</span>
    <span className="text-[14px] leading-snug">{dayLabel(dayOf, tz)}, {windowOf(b.start, b.end)}, at your ship-from address. {plural(b.boxes, 'box', 'boxes')}.{b.confirmationCode ? ` Confirmation ${b.confirmationCode}.` : b.status === 'PENDING' ? ' USPS hasn’t sent a confirmation number yet.' : ''}</span>
    <span className="text-[13px] leading-snug" style={muted}>To change or cancel it, contact USPS{b.confirmationCode ? ' with the confirmation number' : ''}.</span>
  </>);

  return (
    <Sheet title="Ship today" sub={ship.length ? `${plural(boxCount, 'box', 'boxes')} packed for shipping` : 'Nothing packed for shipping yet'} onClose={onClose} closeLabel="Done" wide>
      <Step n={1} state={stepBuy}
        title={toLabel.length ? (priced && !buyable.length ? `${plural(leftOut.length, 'order')} can’t get a label yet` : `Buy ${plural(buyLabelsCount, 'label')}`) : 'Labels bought'}
        sub={toLabel.length ? 'Each order gets the service its customer paid for, with your insurance and signature rules. One label per box.'
          : bought ? `${plural(bought.boxes, 'label')} for ${plural(bought.orders, 'order')} · ${money(bought.cents)}` : ship.length ? 'Every packed box has a label.' : 'Packed ship orders appear here.'}>
        {toLabel.length > 0 && (<>
          <div aria-live="polite" className="flex flex-col gap-2.5">
            {!priced ? <Panel><span style={muted}>{buying ? 'Buying labels…' : `Pricing ${plural(toLabel.length, 'order')}…`}</span></Panel> : sum && sum.orders > 0 ? (<>
              <Panel>
                {sum.lines.map((l) => <Line key={`${l.label}|${l.note}`} left={`${l.count} × ${l.label}`} right={<span style={muted}>{l.note}</span>} />)}
                {sum.multiBox > 0 && <Line left={`${plural(sum.multiBox, 'order')} in ${sum.boxes - (sum.orders - sum.multiBox)} boxes`} right={<span style={muted}>sizes from the bench</span>} />}
              </Panel>
              {(sum.insured.orders > 0 || sum.signatures > 0) && (
                <Panel>
                  {sum.insured.orders > 0 && <Line left={`Insured: ${plural(sum.insured.orders, 'order')}, ${dollars(sum.insured.goodsCents)} of goods`} right={money(sum.insured.feeCents)} />}
                  {sum.signatures > 0 && <Line left={`Signature: ${plural(sum.signatures, 'order')}`} right={<span style={muted}>in the price</span>} />}
                </Panel>)}
            </>) : null}
            {leftOut.length > 0 && (
              <Panel tone="warn">
                {leftOut.slice(0, 4).map((l) => { const o = byId.get(l.orderId); return <span key={l.orderId}><b className="font-semibold">Left out: {o ? orderNum(o) : 'an order'}.</b> {leftWhy(l.why, o)}</span>; })}
                {leftOut.length > 4 && <span>And {plural(leftOut.length - 4, 'more order')}.</span>}
              </Panel>)}
          </div>
          {priced && leftOut.length > 0 && <Btn kind="soft" className="h-11 w-full text-[15px]" disabled={!!busy} onClick={() => setTries((t) => t + 1)}>Price again</Btn>}
          {buyable.length > 0 && <Btn kind="primary" className="h-12 w-full text-[15px]" disabled={!!busy || !priced} onClick={() => void go('buy', async () => {
            const r = await buyLabels(tenantId, buyable, rs);
            if (r.boughtIds.length) setBought({ orders: r.boughtIds.length, boxes: r.boxes, cents: r.spentCents });
            onToast(r.message);
            setTries((t) => t + 1);
          })}>{buying ? 'Buying labels…' : `Buy ${plural(buyLabelsCount, 'label')}${sum && sum.orders === buyable.length ? ` · ${money(sum.totalCents)}` : ''}`}</Btn>}
        </>)}
      </Step>

      <Step n={2} state={stepPrint} title={stepPrint === 'done' ? (allChecked ? 'Printed and checked' : 'Printed') : labelled.length ? `Print ${plural(check.total || labelled.length, 'label')}` : 'Print the labels'}
        sub={stepPrint === 'done' ? (allChecked ? `All ${plural(check.total, 'label')} on the right boxes` : 'Scan each label onto its box at the bench, if you can.') : labelled.length ? `One stack, in the order the boxes were packed${labelFormatOf(rs) === 'paper' ? ', one per letter page' : labelFormatOf(rs) === 'zpl' ? ', as a label-printer file' : ''}${slipAfterLabel(rs) ? ', each with its packing slip' : ''}.` : 'Once labels are bought.'}>
        {labelled.length > 0 && (<>
          <Btn kind={stepPrint === 'now' ? 'primary' : 'soft'} className="h-12 w-full text-[15px]" disabled={!!busy} onClick={() => void go('print', async () => { const e = await printLabels(tenantId, labelled); if (e) onToast(e); else setPrinted(true); })}>{printed || stepPrint === 'done' ? 'Print again' : `Print all ${plural(check.total || labelled.length, 'label')}`}</Btn>
          {check.total > 0 && !allChecked && (
            <div className="flex flex-col gap-2 rounded-2xl px-4 py-3" style={{ border: `1px solid ${C.line}` }}>
              <Line left="At the bench: scan each label onto its box" right={`${check.checked} of ${check.total}`} strong />
              <span className="block h-2 overflow-hidden rounded-full" style={{ background: C.soft }} role="progressbar" aria-valuemin={0} aria-valuemax={check.total} aria-valuenow={check.checked} aria-label="Labels checked">
                <span className="block h-full rounded-full" style={{ width: `${Math.round((check.checked / check.total) * 100)}%`, background: C.mint, transition: 'width .4s ease' }} />
              </span>
              {check.waiting.slice(0, 2).map((w) => <Line key={`${w.order.id}-${w.box}`} left={`${orderNum(w.order)} ${firstName(w.order.customerName)}${w.of > 1 ? ` · box ${w.box} of ${w.of}` : ''}`} right="not yet" tone={C.muted} />)}
              {check.waiting.length > 2 && <Line left={`${check.waiting.length - 2} more`} tone={C.muted} />}
              <span className="text-[13px] leading-snug" style={muted}>Scan the slip in a box, then its label. A label on the wrong box beeps and shows whose it is.</span>
            </div>)}
        </>)}
      </Step>

      <Step n={3} state={stepHand} last title={toHand.length ? `Hand ${plural(handBoxes, 'box', 'boxes')} to the carrier` : handed ? `${plural(handed, 'order')} handed over` : 'Hand them to the carrier'}
        sub={toHand.length ? 'Customers get tracking at the first carrier scan.' : 'Labeled boxes appear here.'}>
        {toHand.length > 0 && check.total > check.checked && <Panel tone="warn"><span>{plural(check.total - check.checked, 'label')} {check.total - check.checked === 1 ? 'hasn’t' : 'haven’t'} been checked. Scan each label on its box first, so the right box goes out.</span></Panel>}
        {toHand.length > 0 && <Btn kind={stepHand === 'now' ? 'primary' : 'soft'} className="h-12 w-full text-[15px]" disabled={!!busy} onClick={() => void go('hand', async () => { const n = toHand.length; onToast(await markAllShipped(fs, tenantId, toHand, actor)); setHanded((h) => h + n); })}>{busy === 'hand' ? 'Marking…' : `Mark ${toHand.length === 1 ? 'it' : `all ${toHand.length}`} as shipped`}</Btn>}
        {pickup?.today && pickup.today.day !== pickup.day && (
          <div className="flex flex-col gap-2 rounded-2xl px-4 py-3" style={{ border: `1px solid ${C.line}` }}>{pickupCard(pickup.today, 'today', pickup.today.day || today)}</div>)}
        {pickup && (pickup.booking || pickup.boxes > 0) && (
          <div className="flex flex-col gap-2 rounded-2xl px-4 py-3" style={{ border: `1px solid ${C.line}` }}>
            {pickup.booking ? pickupCard(pickup.booking, whenWord(pickup.day, today, tz), pickup.day) : pickup.regular ? (<>
              <span className="text-[15px] font-semibold">USPS picks up {whenWord(pickup.day, today, tz)} at {clockLabel(pickup.regular.time)}</span>
              <span className="text-[13px] leading-snug" style={muted}>Your regular pickup, from your shipping schedule. Nothing to book.</span>
            </>) : (<>
              <span className="text-[15px] font-semibold">USPS pickup {whenWord(pickup.day, today, tz)}</span>
              <span className="text-[14px] leading-snug">{dayLabel(pickup.day, tz)}, 9:00 AM to 5:00 PM, at your ship-from address. {plural(pickup.boxes, 'box', 'boxes')}.</span>
              <Btn kind="soft" className="h-11 w-full text-[15px]" style={{ background: C.paper, border: `1px solid ${C.ink}` }} disabled={!!busy || !pickup.allowed || !pickup.zone} onClick={() => book(false)}>{busy === 'pickup' ? 'Booking…' : 'Book the USPS pickup'}</Btn>
              <span className="text-[13px] leading-snug" style={muted}>{!pickup.zone ? 'Set your shop’s time zone in Setup first, so the pickup window is in your hours.' : pickup.allowed ? 'USPS takes one booking a day, and it needs at least one Priority Mail box.' : 'USPS only books a pickup with at least one Priority Mail box. Drop these off instead.'} UPS and FedEx: drop off, or your regular pickup.</span>
            </>)}
            {pickupErr && <span role="alert" className="text-[14px]" style={{ color: C.warn }}>{pickupErr}</span>}
          </div>)}
      </Step>

      <div className="pt-4">
        <Btn kind={toHand.length === 0 && handed > 0 ? 'primary' : 'soft'} className="h-12 w-full text-[15px]" disabled={!!busy} onClick={() => void go('close', async () => { const r = await closeDay(tenantId); if (r.ok || r.summary) setClosed(r); else onToast(r.message); })}>{busy === 'close' ? 'Closing…' : 'Close the day'}</Btn>
        <p className="m-0 mt-2 text-center text-[13px]" style={muted}>Makes one USPS form for today’s boxes, so the carrier scans once, and shows what went out.</p>
      </div>
    </Sheet>);
}
