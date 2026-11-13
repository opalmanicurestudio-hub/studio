'use client';
// src/components/orders/HandoverSheet.tsx — HAND IT OVER. First each bag's tag is scanned (lib/bag-tag: "Bag 1 of 3"),
// so the right bags go to the right person and none is left on the shelf; a bag that belongs to someone else says
// whose it is and where theirs is; a tag that won't scan (or a wrong count) is skipped on a manager's PIN, checked by
// the server and kept on the order. Then the customer: scan the code on their phone, type the 4-digit pickup code they
// say (checked on the server, lib/pickup-pass), or check their name and the last four digits of their phone. When the
// customer named someone else to collect it, that's said first. Scanning a different order's code says so instead of
// handing over the wrong bag. The handoff records who handed it over, who collected it, how, and the bags scanned (the
// server checks the bags' signed codes too, whatever screen sends it). An order with products for licensed pros says
// the license it was sold on, so the name can be checked against it.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { handOver } from '@/lib/orders-flow';
import { parseOrderQr } from '@/lib/retail-orders';
import { PIN_TRIES } from '@/lib/pickup-limits';
import { firstName, itemCount } from '@/lib/orders-view';
import { stateName } from '@/lib/wholesale-tax';
import { licenseLapsed, localDay } from '@/lib/pickups-view';
import { bagWords, bagsToScan, parseBagCode } from '@/lib/bag-tag';
import { approversOf } from '@/lib/scan-rule';
import { useTenant } from '@/context/TenantContext';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, feel, muted, Ic } from './ui';

export function HandoverSheet({ fs, tenantId, order, actor, onClose, onDone, lookup }: { fs: Firestore; tenantId: string; order: any; actor: Actor; onClose: () => void; onDone: (msg: string) => void; lookup?: (orderId: string) => any }) {
  const { selectedTenant } = useTenant() as any;
  const rs = selectedTenant?.retailSettings || {};
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [pin, setPin] = React.useState(''); const [pinLocked, setPinLocked] = React.useState(Number(order.pinTries || 0) >= PIN_TRIES);
  // The bags' tags scanned so far, by bag number (each code once).
  const [bags, setBags] = React.useState<Map<number, string>>(new Map());
  // A manager's PIN to hand over without every tag scanned (checked by the server with the handover), and its form.
  const [bagPin, setBagPin] = React.useState(''); const [skipOpen, setSkipOpen] = React.useState(false); const [skipPin, setSkipPin] = React.useState('');
  const need = bagsToScan(order, rs);
  const bagStep = need > 0 && bags.size < need && !bagPin;
  const who = firstName(order.customerName);
  const other = String(order.collector?.name || '').trim();
  const collecting = other || who;
  const last4 = String(order.customerPhone || '').replace(/\D/g, '').slice(-4);
  const codes = [...bags.values()];
  const tagHref = order.qrToken ? `/print/label/${tenantId}/${order.id}?t=${encodeURIComponent(order.qrToken)}` : '';
  const finish = (r: { ok: boolean; message: string; locked?: boolean; needBags?: boolean; badBagPin?: boolean }) => {
    feel(r.ok);
    if (r.ok) onDone(other ? `Handed over to ${other}. ${who} gets a note that ${other} collected it.` : `Handed over to ${who}. Their receipt is on its way.`);
    else { setErr(r.message); if (r.locked) { setPinLocked(true); setPin(''); } if (r.needBags) { setBags(new Map()); setBagPin(''); setSkipPin(''); } if (r.badBagPin) { setBagPin(''); setSkipPin(''); } }
  };
  // A bag's tag: this order's (counted once), another order's (whose, and where this one is), or not a tag at all.
  const onBag = (v: string) => {
    if (busy) return;
    const tag = parseBagCode(v);
    if (!tag) { feel(false); setErr(parseOrderQr(v) || (order.qrToken && v.trim() === order.qrToken) ? 'That’s their code. Scan the bag first, then theirs.' : 'That isn’t a bag tag. Scan the tag on the bag.'); return; }
    if (tag.orderId !== order.id) {
      const o = lookup?.(tag.orderId);
      feel(false);
      setErr(o ? `Wrong bag. This one is #${String(o.orderNumber ?? '').padStart(4, '0')} for ${o.customerName || 'someone else'}.${o.shelfSlot ? ` Put it back on shelf ${o.shelfSlot}.` : ''}${order.shelfSlot ? ` ${who}’s ${need > 1 ? 'bags are' : 'bag is'} on shelf ${order.shelfSlot}.` : ''}`
        : `Wrong bag. This one is for another order.${order.shelfSlot ? ` ${who}’s ${need > 1 ? 'bags are' : 'bag is'} on shelf ${order.shelfSlot}.` : ''}`);
      return;
    }
    if (tag.n > need) { feel(false); setErr('That tag is from an earlier print. Reprint the tags and scan the new ones.'); return; }
    if (bags.has(tag.n)) { feel(false); setErr(`${bagWords(tag.n, need)} is already scanned.`); return; }
    feel(true); setErr('');
    setBags((m) => new Map(m).set(tag.n, v.trim()));
  };
  const onScan = async (v: string) => {
    if (busy) return;
    if (parseBagCode(v)) { feel(false); setErr('That’s a bag tag. Now scan the code on their phone.'); return; }
    const token = parseOrderQr(v) ?? v.trim();
    if (order.qrToken && token !== order.qrToken) { feel(false); setErr('That code is for a different order. Check the name on their phone.'); return; }
    setBusy(true); finish(await handOver(fs, tenantId, order, actor, { scan: v, bags: codes, bagPin: bagPin || undefined })); setBusy(false);
  };
  const byPin = async () => { if (busy || pin.length !== 4) return; setBusy(true); setErr(''); finish(await handOver(fs, tenantId, order, actor, { pin, bags: codes, bagPin: bagPin || undefined })); setBusy(false); };
  const byName = async () => {
    setBusy(true);
    const checked = other ? `${other} collecting for ${order.customerName || who}; name checked by ${actor.name}` : `Name${last4 ? ` and phone ending ${last4}` : ''} checked by ${actor.name}`;
    finish(await handOver(fs, tenantId, order, actor, { verifiedBy: checked, bags: codes, bagPin: bagPin || undefined })); setBusy(false);
  };
  return (
    <Sheet title={`Hand over to ${other || order.customerName || who}`} sub={`${order.shelfSlot ? `Shelf ${order.shelfSlot} · ` : ''}${need > 1 ? `${need} bags · ` : ''}${itemCount(order)} item${itemCount(order) === 1 ? '' : 's'}`} onClose={onClose}>
      {need > 0 && (
        <ol aria-label="Steps" className="m-0 mt-1 flex list-none gap-2 p-0">
          <li aria-current={bagStep ? 'step' : undefined} className="flex h-11 flex-1 items-center gap-2 rounded-full px-3.5 text-[15px] font-semibold" style={bagStep ? { background: C.ink, color: C.paper } : bagPin ? { background: C.warnSoft, color: C.warn } : { background: C.okSoft, color: C.ok }}>
            {bagStep ? <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-full text-[13px]" style={{ background: C.paper, color: C.ink }}>1</span> : <span aria-hidden="true">{Ic.check}</span>}
            {need > 1 ? 'Scan the bags' : 'Scan the bag'}</li>
          <li aria-current={bagStep ? undefined : 'step'} className="flex h-11 flex-1 items-center gap-2 rounded-full px-3.5 text-[15px] font-semibold" style={bagStep ? { background: C.soft, color: C.muted } : { background: C.ink, color: C.paper }}>
            <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-full text-[13px]" style={bagStep ? { border: `2px solid ${C.muted}` } : { background: C.paper, color: C.ink }}>2</span>
            Check it’s {other ? firstName(other) : who}</li>
        </ol>)}
      {other && <p className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: C.okSoft, color: C.ok }}>{other} is collecting for {order.customerName || who}.</p>}
      {order.proLicense?.number ? (() => { const L = order.proLicense; const holder = String(L.name || '').trim(); const lapsed = licenseLapsed(order, localDay());
        const until = L.expiresOn ? (() => { const t = Date.parse(`${L.expiresOn}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : L.expiresOn; })() : '';
        return <p className="m-0 mt-2 rounded-2xl px-4 py-3 text-[15px]" style={lapsed ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.ink }}>
          Products for licensed pros, sold on {holder ? `the license of ${holder}` : 'the license on file'}: {stateName(L.state) || L.state} {L.number}{until ? `, ${lapsed ? 'expired' : 'good to'} ${until}` : ''}. {lapsed ? 'Check a current one before you hand it over.' : holder ? 'Check the name matches.' : 'Check their name against it.'}</p>; })()
        : (order.lines || []).some((l: any) => l?.prosOnly === true) ? <p className="m-0 mt-2 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>Products for licensed pros: check their license before you hand it over.</p> : null}
      {bagStep ? (
        <>
          {bags.size > 0 && <p role="status" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.okSoft }}><b className="font-semibold" style={{ color: C.ok }}>Right {bags.size === 1 ? 'bag' : 'bags'}. </b>{[...bags.keys()].sort((a, b) => a - b).map((n) => bagWords(n, need)).join(', ')} scanned. {need - bags.size} to go.</p>}
          {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
          <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => onBag(v)} paused={busy} label={need > 1 ? `Point at the tag on bag ${[...Array(need)].map((_, i) => i + 1).find((n) => !bags.has(n))}` : 'Point at the tag on the bag'} /></div>
          {tagHref && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: C.line }}>
              <p className="m-0 min-w-[200px] flex-1 text-[15px] leading-snug">Tag torn or missing? Reprint {need > 1 ? 'the tags' : 'it'} for #{String(order.orderNumber ?? '').padStart(4, '0')}.</p>
              <a href={tagHref} target="_blank" rel="noreferrer" className="cf-press inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold" style={{ background: C.soft, color: C.ink }}>Reprint</a>
            </div>)}
          {!skipOpen ? <button type="button" onClick={() => setSkipOpen(true)} className="mt-2 h-11 text-[15px] font-semibold underline underline-offset-4" style={muted}>A tag won’t scan, or the count is wrong?</button> : (
            <form className="mt-3 rounded-2xl px-4 py-3.5" style={{ background: C.soft }} onSubmit={(e) => { e.preventDefault(); if (skipPin.length === 4) { setBagPin(skipPin); setErr(''); } }}>
              <label htmlFor="bag-skip-pin" className="block text-[15px] font-semibold">{approversOf(rs) === 'managers' ? 'Manager PIN' : 'Your PIN, or a manager’s'}</label>
              <p className="m-0 mt-0.5 text-[13.5px]" style={muted}>Hands it over without every tag scanned. Who approved it goes on the order.</p>
              <div className="mt-2 flex gap-2">
                <input id="bag-skip-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off" value={skipPin} onChange={(e) => setSkipPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 digits"
                  className="h-12 min-w-0 flex-1 rounded-xl px-4 text-[20px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink, letterSpacing: skipPin ? '0.3em' : undefined }} />
                <Btn kind="primary" type="submit" className="shrink-0" disabled={skipPin.length !== 4}>Skip the bag scan</Btn>
              </div>
            </form>)}
        </>
      ) : (
        <>
          {need > 0 && (bagPin
            ? <p role="status" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft }}><b className="font-semibold" style={{ color: C.warn }}>Bag scan skipped. </b>The PIN is checked as it’s handed over, and kept on the order. Now check it’s {other ? firstName(other) : who}.</p>
            : <p role="status" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.okSoft }}><b className="font-semibold" style={{ color: C.ok }}>Right {need > 1 ? 'bags' : 'bag'}. </b>Now check it’s {other ? firstName(other) : who}.</p>)}
          <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy} label="Point at the code on their phone" /></div>
          {!pinLocked && (
            <form className="mt-4" onSubmit={(e) => { e.preventDefault(); void byPin(); }}>
              <label htmlFor="handover-pin" className="block text-[15px] font-semibold" style={{ color: C.ink }}>Or the pickup code they say</label>
              <div className="mt-2 flex gap-2">
                <input id="handover-pin" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={4} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(''); }} placeholder="4 digits"
                  className="h-12 min-w-0 flex-1 rounded-xl px-4 text-[20px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink, letterSpacing: pin ? '0.2em' : undefined }} />
                <Btn kind="primary" type="submit" className="shrink-0 text-[17px]" disabled={busy || pin.length !== 4}>Check</Btn>
              </div>
            </form>
          )}
          {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
          <p className="m-0 mt-4 text-[15px]" style={muted}>{other ? `No code? Ask their name: it should be ${other}.` : `No code? Ask their name${last4 ? ` and the last 4 of their phone: ending ${last4}` : ''}.`}</p>
          <Btn kind="soft" className="mt-3 w-full text-[17px]" disabled={busy} onClick={() => void byName()}>Checked, hand over to {collecting}</Btn>
        </>
      )}
    </Sheet>);
}
