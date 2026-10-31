'use client';
// src/components/orders/ClaimCard.tsx — DECIDING ON A CUSTOMER'S REPORT, IN ONE PLACE (mockups 10A, 10B). Opened from
// Problems on a computer or a phone: what they said and sent, what the order's record shows (facts, no score), who
// they are from their history, why the shop's rules didn't approve it on their own, the carrier claim to file if it's
// approved; then ask them for something, approve the refund (up to what's left to refund of what they paid), or
// decline with a reason they see word for word. Everything is decided on the server (api/retail/fulfil,
// lib/claim-decide), and only those the server lets decide see the buttons.
import * as React from 'react';
import Link from 'next/link';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { decideClaim, requestClaimInfo } from '@/lib/fulfil-client';
import { carrierLine, claimRefundable, claimWaiting, recordFacts, whyNotAuto } from '@/lib/claim-view';
import { hasGap, type ReplyContext } from '@/lib/replies';
import { money } from '@/lib/orders-view';
import { tenantTimeZone } from '@/lib/tenant-time';
import { useTenant } from '@/context/TenantContext';
import { GapNote, ReplyChips, pickInto } from './ReplyChips';
import { historyLine, useCustomerHistory } from './use-customer-history';
import { Btn, C, Sheet, feel, muted } from './ui';

const ASK_MAX = 400;
const WHY_MAX = 400;
// A pick that won't fit after what's typed replaces it instead of being cut (the server keeps 400 characters, and the
// customer's email quotes the reason word for word).
const fitPick = (cur: string, prev: string | null, pick: string, max: number) => { const one = pick.slice(0, max); const joined = pickInto(cur, prev, one, '\n\n'); return joined.length > max ? one : joined; };

function FactRow({ ok, text }: { ok: boolean | null; text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-[14.5px] leading-snug">
      <span aria-hidden="true" className="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: ok === true ? C.okSoft : ok === false ? C.warnSoft : C.paper }}>
        {ok === true ? <svg width="12" height="12" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke={C.ok} strokeWidth="2.6" fill="none" strokeLinecap="round" /></svg>
          : ok === false ? <svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 7v6M12 16.5v.5" stroke={C.warn} strokeWidth="2.6" fill="none" strokeLinecap="round" /></svg>
          : <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill={C.muted} /></svg>}
      </span>
      <span>{text}</span>
    </li>);
}

export function ClaimCard({ fs, tenantId, claim, order: given, rs, canDecide, onToast }: {
  fs: Firestore; tenantId: string; claim: any; order: any | null; rs: any; canDecide: boolean; onToast: (m: string) => void;
}) {
  const t: any = useTenant();
  const tz = tenantTimeZone(t?.selectedTenant);
  const day = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz }) : ''; };
  // The order's record (Problems only carries the orders still being worked on; a report is usually on a finished one).
  const [order, setOrder] = React.useState<any | null>(given);
  React.useEffect(() => {
    if (given && given.id === claim.orderId) { setOrder(given); return; }
    let live = true;
    if (fs && tenantId && claim.orderId) getDoc(doc(fs, `tenants/${tenantId}/retailOrders/${claim.orderId}`)).then((s) => { if (live && s.exists()) setOrder({ ...(s.data() as any), id: s.id }); }).catch(() => {});
    return () => { live = false; };
  }, [fs, tenantId, claim.orderId, given]);
  const history = useCustomerHistory(fs, tenantId, claim.customerEmail, claim.id);
  const first = String(claim.customerName || '').trim().split(/\s+/)[0] || 'them';
  const named = first !== 'them';
  const facts = recordFacts(claim, order, history ? history.reports : null);
  const waiting = claimWaiting(claim);
  const carrier = carrierLine(claim, order, day, tz);
  // What's left to refund, worked out as the server will: part of it returned or refunded already isn't paid again.
  const left = claimRefundable(claim, order);
  const max = left.cents;
  const noUnits = !!claim.lineId && !!order && left.units <= 0;
  const ctx: ReplyContext = { client_first: named ? first : '', order_number: claim.orderNumber != null ? String(claim.orderNumber).padStart(4, '0') : '', item: claim.lineName || '', amount: money(max) };
  const photoGate = claim.photosRequired && !(Array.isArray(claim.photoUrls) && claim.photoUrls.length);

  const [ask, setAsk] = React.useState(''); const askFill = React.useRef<string | null>(null);
  const [amount, setAmount] = React.useState((max / 100).toFixed(2));
  const touched = React.useRef(false);
  // The order arrives after the card: the amount follows what's left to refund until someone changes it.
  React.useEffect(() => { if (!touched.current) setAmount((max / 100).toFixed(2)); }, [max]);
  const [done, setDone] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [why, setWhy] = React.useState(''); const whyFill = React.useRef<string | null>(null);
  const [busy, setBusy] = React.useState('');
  const [err, setErr] = React.useState('');
  const cents = Math.round((Number(String(amount).replace(/[^0-9.]/g, '')) || 0) * 100);
  const amountOk = max === 0 || (cents > 0 && cents <= max);
  const off = !!busy || done;

  const sendAsk = async () => {
    const text = ask.trim(); if (!text || hasGap(text)) return;
    setBusy('ask'); setErr('');
    const r = await requestClaimInfo(tenantId, claim.id, text.slice(0, ASK_MAX));
    setBusy(''); feel(r.ok);
    if (!r.ok) { setErr(r.message || 'That didn’t send. Try again.'); return; }
    setAsk(''); askFill.current = null; setAsking(false); onToast(`Asked. ${named ? `${first} sees` : 'They see'} it on their order page and gets a nudge to look.`);
  };
  const approve = async () => {
    if (!amountOk || photoGate || noUnits || off) return;
    setBusy('approve'); setErr('');
    // Nothing left to refund (already refunded another way): approved with no refund, and the loss still recorded.
    const r = await decideClaim(tenantId, claim.id, true, { cents: max === 0 ? null : cents });
    setBusy(''); feel(r.ok);
    if (!r.ok) { setErr(r.message || 'That didn’t go through. Try again.'); return; }
    setDone(true);
    const got = Number((r as any).cents ?? cents) || 0;
    onToast(got > 0 ? `Approved. ${money(got)} is added to the order’s refund to send, and ${named ? `${first} is` : 'they’re'} told.` : `Approved with no refund, and ${named ? `${first} is` : 'they’re'} told.`);
  };
  const decline = async () => {
    const text = why.trim().slice(0, WHY_MAX); if (!text || hasGap(text) || busy || done) return;
    setBusy('decline'); setErr('');
    const r = await decideClaim(tenantId, claim.id, false, { declineWhy: text });
    setBusy(''); feel(r.ok);
    if (!r.ok) { setErr(r.message || 'That didn’t go through. Try again.'); return; }
    setDone(true); setDeclining(false); onToast(`Declined. ${named ? `${first} sees` : 'They see'} your reason${claim.appealedAt ? '. The decision is final.' : ' and can appeal once.'}`);
  };

  return (
    <div className="space-y-4">
      {claim.appealedAt && (
        <div className="rounded-2xl p-3.5" style={{ background: C.warnSoft }}>
          <p className="m-0 text-[13px] font-semibold" style={{ color: C.warn }}>They appealed</p>
          {claim.declineReason && <p className="m-0 mt-1 text-[14px]">You declined: “{String(claim.declineReason).slice(0, 300)}”</p>}
          {claim.appealNote && <p className="m-0 mt-1 text-[14.5px]">They wrote back: “{String(claim.appealNote).slice(0, 400)}”</p>}
        </div>)}
      {(claim.description || (Array.isArray(claim.photoUrls) && claim.photoUrls.length > 0)) && (
        <div>
          <p className="m-0 text-[13px] font-semibold" style={muted}>What {named ? first : 'they'} said{claim.component ? ` about ${String(claim.component).slice(0, 80)}` : ''}</p>
          {claim.description ? <p className="m-0 mt-1 text-[15px] leading-snug">“{String(claim.description).slice(0, 500)}”</p> : null}
          {Array.isArray(claim.photoUrls) && claim.photoUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">{claim.photoUrls.slice(0, 6).map((u: string, i: number) => (
              <a key={`${i}-${u}`} href={u} target="_blank" rel="noreferrer" aria-label={`Open their photo ${i + 1} full size`}><img src={u} alt={`Their photo ${i + 1}`} className="h-20 w-20 rounded-xl object-cover" /></a>))}</div>)}
        </div>)}

      <div>
        <p className="m-0 text-[13px] font-semibold" style={muted}>What the record shows</p>
        <ul className="m-0 mt-2 list-none space-y-2 p-0">{facts.map((f, i) => <FactRow key={i} ok={f.ok} text={f.text} />)}</ul>
        {historyLine(history) && <p className="m-0 mt-2 text-[13px]" style={muted}>{historyLine(history)}</p>}
        <p className="m-0 mt-1 text-[12.5px]" style={muted}>Facts from the order, for you to weigh. They don’t decide it for you. <Link href={`/retail-orders/evidence/${claim.orderId}`} className="font-semibold underline underline-offset-2" style={{ color: C.ink }}>Packing record</Link></p>
      </div>
      <p className="m-0 rounded-xl px-3 py-2.5 text-[13.5px] leading-snug" style={{ background: C.paper }}>{whyNotAuto(claim, rs, order)}</p>
      {carrier && <p className="m-0 rounded-xl px-3 py-2.5 text-[13.5px] leading-snug" style={{ background: C.paper }}>{carrier}</p>}

      {claim.infoRequestText && (
        <div className="rounded-2xl p-3.5" style={{ background: C.paper }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>You asked</p>
          <p className="m-0 mt-1 text-[14.5px]">{claim.infoRequestText}</p>
          {waiting ? <p className="m-0 mt-1.5 text-[13px] font-semibold" style={{ color: C.warn }}>Waiting for {named ? `${first}’s` : 'their'} answer</p>
            : claim.infoResponseText ? <p className="m-0 mt-1.5 text-[14.5px]"><span className="font-semibold">{named ? first : 'They'} answered:</span> {claim.infoResponseText}</p> : null}
        </div>)}

      {canDecide ? (
        <div className="space-y-2.5 border-t pt-4" style={{ borderColor: C.line }}>
          {noUnits ? <p className="m-0 text-[14px]" style={{ color: C.warn }}>That item has already been refunded, through a return or another report. Decline this one with that as the reason.</p>
            : max > 0 ? <>
              <label className="block text-[13px] font-semibold" style={muted}>Refund
                <span className="mt-1.5 flex items-center gap-2">
                  <input inputMode="decimal" value={amount} onChange={(e) => { touched.current = true; setAmount(e.target.value); }} aria-describedby={`max-${claim.id}`}
                    className="h-12 w-28 rounded-2xl border-0 px-3.5 text-[17px] font-normal" style={{ background: C.paper, color: C.ink }} />
                  <span id={`max-${claim.id}`} className="text-[13px] font-normal">up to {money(max)}, {left.all ? 'what they paid for it' : `for the ${left.units} not already returned or refunded`}</span>
                </span></label>
              <p role="status" aria-live="polite" className="m-0 text-[13px] empty:hidden" style={{ color: C.warn }}>{amountOk ? '' : `Pick an amount from $0.01 to ${money(max)}.`}</p>
            </> : <p className="m-0 text-[14px]" style={muted}>Nothing is left to refund on this order. Approving records the loss and tells {named ? first : 'them'} it’s approved, with no refund.</p>}
          {photoGate && <p className="m-0 text-[13.5px]" style={{ color: C.warn }}>Your policy asks for a photo before approving. {waiting ? 'You’ve asked; it waits for their answer.' : `Ask ${named ? first : 'them'} for one, or decline if it doesn’t hold up.`}</p>}
          {!noUnits && <Btn kind="primary" className="w-full" disabled={!amountOk || photoGate || off} onClick={() => void approve()}>{busy === 'approve' ? 'Approving…' : max === 0 ? 'Approve, no refund' : `Approve, refund ${amountOk ? money(cents) : ''}`.trim()}</Btn>}
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            {!waiting && <Btn kind="soft" className="w-full px-3 min-[420px]:flex-1" style={{ background: C.paper }} disabled={off} onClick={() => { setErr(''); setAsking(true); }}>Ask for something</Btn>}
            <Btn kind="soft" className="w-full px-3 min-[420px]:flex-1" style={{ background: C.paper }} disabled={off} onClick={() => { setErr(''); setDeclining(true); }}>Decline</Btn>
          </div>
          <p className="m-0 text-[12.5px] leading-snug" style={muted}>Approving adds the refund to the order’s refunds to send and records the loss. {named ? `${first} is` : 'They’re'} told in your Claim decision wording.</p>
        </div>
      ) : <p className="m-0 text-[14px]" style={muted}>A manager, or someone allowed to refund, decides on reports.</p>}
      {err && !asking && !declining && <p role="alert" className="m-0 text-[14px]" style={{ color: C.warn }}>{err}</p>}

      {asking && (
        <Sheet title={`Ask ${named ? first : 'them'} for something`} sub="They see it on their order page and get a text or email. The report waits under Waiting on them until they answer." onClose={() => setAsking(false)} closeLabel="Not now">
          <ReplyChips className="mt-3" fs={fs} tenantId={tenantId} situation="claim_ask" ctx={ctx}
            onPick={(txt) => { const prev = askFill.current; const next = fitPick(ask, prev, txt, ASK_MAX); setAsk(next); askFill.current = next === txt.slice(0, ASK_MAX) ? next : prev; }} />
          <label className="mt-3 block text-[13px] font-semibold" style={muted}>What you need (edit it if you like)
            <textarea value={ask} maxLength={ASK_MAX} rows={3} onChange={(e) => setAsk(e.target.value)} placeholder="For example: a photo of the bag it came in" className="mt-1 block w-full resize-y rounded-2xl border px-3.5 py-3 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <GapNote text={ask} />
          {err && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err}</p>}
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={!ask.trim() || hasGap(ask) || !!busy || done} onClick={() => void sendAsk()}>{busy === 'ask' ? 'Sending…' : 'Ask'}</Btn>
        </Sheet>)}
      {declining && (
        <Sheet title={`Decline ${named ? `${first}’s` : 'this'} report?`} sub={`Tell them why. They see it word for word on their order page and in an email${claim.appealedAt ? '. This is the second look, so the decision is final.' : ', and they can appeal once.'}`} onClose={() => setDeclining(false)} closeLabel="Not yet">
          <ReplyChips className="mt-3" fs={fs} tenantId={tenantId} situation="claim_decline" ctx={ctx}
            onPick={(txt) => { const prev = whyFill.current; const next = fitPick(why, prev, txt, WHY_MAX); setWhy(next); whyFill.current = next === txt.slice(0, WHY_MAX) ? next : prev; }} />
          <label className="mt-3 block text-[13px] font-semibold" style={muted}>Why (edit it if you like)
            <textarea value={why} maxLength={WHY_MAX} rows={4} onChange={(e) => setWhy(e.target.value)} className="mt-1 block w-full resize-y rounded-2xl border px-3.5 py-3 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <GapNote text={why} />
          {err && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err}</p>}
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={!why.trim() || hasGap(why) || !!busy || done} onClick={() => void decline()}>{busy === 'decline' ? 'Declining…' : 'Decline'}</Btn>
        </Sheet>)}
    </div>);
}
