'use client';
// src/components/orders/ProblemPanel.tsx — ONE ORDER'S PROBLEMS. Each problem is a card with its next step right on it:
// answer the message (or mark it solved), send the refund, check in the return, release the hold, go to the customer
// outside. Problem reports open in Claims, where the photos and the packing record sit side by side.
import * as React from 'react';
import Link from 'next/link';
import type { Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { money } from '@/lib/orders-view';
import { isFollowUp } from '@/lib/order-family';
import { threadOf, type Problem, type ProblemGroup } from '@/lib/problems-view';
import type { Actor } from '@/lib/retail-fulfill';
import { setHold } from './bulk';
import { ReturnSheet } from './ReturnSheet';
import { Btn, C, Sheet, feel, muted, Ic } from './ui';

const when = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

function Card({ p, children }: { p: Problem; children?: React.ReactNode }) {
  const tone = p.urgent ? C.warn : p.kind === 'refund' ? C.ok : C.ink;
  return (
    <div className="cf-anim-rise rounded-2xl p-4" style={{ background: C.soft }}>
      <p className="m-0 text-[17px] font-semibold tracking-[-0.01em]" style={{ color: tone }}>{p.title}</p>
      {p.detail ? <p className="m-0 mt-0.5 text-[14px]" style={muted}>{p.detail}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>);
}

function MessageCard({ p, tenantId, onToast }: { p: Problem; tenantId: string; onToast: (m: string) => void }) {
  const [text, setText] = React.useState(''); const [busy, setBusy] = React.useState('');
  const thread = threadOf(p.ref);
  const send = async (resolve: boolean) => {
    setBusy(resolve && !text.trim() ? 'solve' : 'send');
    try {
      const r = await fetch('/api/retail/support-reply', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ticketId: p.ref.id, reply: text.trim(), resolve }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { feel(false); onToast(d.error || 'That didn’t send. Try again.'); return; }
      feel(true); setText(''); onToast(d.message || 'Sent.');
    } finally { setBusy(''); }
  };
  return (
    <Card p={{ ...p, detail: '' }}>
      <div className="space-y-2">
        {thread.map((m, i) => (
          <div key={i} className={`flex ${m.who === 'shop' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5" style={m.who === 'shop' ? { background: C.ink, color: C.paper } : { background: C.paper, color: C.ink }}>
              <p className="m-0 whitespace-pre-wrap text-[15px] leading-snug">{m.text}</p>
              <p className="m-0 mt-1 text-[11px]" style={{ opacity: 0.6 }}>{m.who === 'shop' ? `${m.by || 'You'} · ` : m.via === 'email' ? 'By email · ' : ''}{when(m.at)}</p>
            </div>
          </div>))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={`Reply to ${String(p.ref.customerName || '').split(' ')[0] || 'them'}`} aria-label="Reply"
        className="mt-3 block w-full resize-y rounded-2xl border-0 px-3.5 py-3 text-[15px] outline-none ring-0 focus:ring-0" style={{ background: C.paper, color: C.ink }} />
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Btn kind="primary" className="flex-1" disabled={!text.trim() || !!busy} onClick={() => void send(false)}>{busy === 'send' ? 'Sending…' : 'Send'}</Btn>
        <Btn kind="soft" className="flex-1" style={{ background: C.paper }} disabled={!!busy} onClick={() => void send(true)}>{text.trim() ? 'Send and mark solved' : busy === 'solve' ? 'Saving…' : 'Mark solved'}</Btn>
      </div>
      <p className="m-0 mt-2 text-[12px]" style={muted}>It appears on their order page, and they get a text or email pointing them to it. Their reply lands right here.</p>
    </Card>);
}

export function ProblemPanel({ fs, tenantId, group, actor, rs, canRefund, canManage, inline, onClose, onToast }: {
  fs: Firestore; tenantId: string; group: ProblemGroup; actor: Actor; rs: any; canRefund: boolean; canManage: boolean; inline: boolean; onClose: () => void; onToast: (m: string) => void;
}) {
  const [refund, setRefund] = React.useState<Problem | null>(null);
  const [ret, setRet] = React.useState<any | null>(null);
  const [closing, setClosing] = React.useState<any | null>(null); const [closeNote, setCloseNote] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const o = group.order || group.items[0]?.ref || {};
  const first = String(group.customerName || '').split(' ')[0] || 'them';

  // Within the shop's automatic amount anyone on the team can send it (api/retail/refund); never a lost parcel's
  // replacement.
  const autoBelow = Math.max(0, Number(rs?.policies?.refundAutoBelowCents) || 0);
  const inAuto = (o: any) => { const c = Number(o?.pendingRefundCents) || 0; return autoBelow > 0 && c > 0 && c <= autoBelow && o?.replacementFor !== 'lost_in_transit'; };
  const sendRefund = async (p: Problem) => {
    setBusy('refund');
    try {
      const r = await fetch('/api/retail/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: p.orderId, qrToken: p.ref.qrToken || '', ...(inAuto(p.ref) ? { reason: 'policy' } : {}) }) });
      const d = await r.json().catch(() => ({}));
      // Only a plain card refund gets the short line: anything that went back by gift card or store credit, or that
      // couldn't go back at all, is spelled out in the route's own message.
      const plain = (Number(d.cardCents) || 0) > 0 && !(Number(d.otherCents) || 0) && !(Number(d.overCardCents) || 0) && d.recorded !== false;
      feel(r.ok); onToast(!r.ok ? d.error || 'The refund didn’t go through.'
        : plain ? `Refund sent. ${first} usually sees it in 5 to 10 days.` : d.message || 'Refund sent.');
      if (r.ok) setRefund(null);
    } finally { setBusy(''); }
  };

  // A return whose label couldn't be made: try again (api/retail/return-label, the order's own link key).
  const sendLabel = async (r: any) => {
    setBusy(`label-${r.id}`);
    try {
      const res = await fetch('/api/retail/return-label', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: r.orderId, returnId: r.id, qrToken: group.order?.qrToken || '' }) });
      const d = await res.json().catch(() => ({}));
      feel(res.ok); onToast(res.ok ? (d.alreadySent ? `${first} already has a label for this return.` : `Label emailed to ${first}.`) : d.error || 'The label couldn’t be made.');
    } finally { setBusy(''); }
  };
  // A return that isn't coming back: closed, its items free to be returned again, and they're told (lib/return-close).
  const closeIt = async () => {
    if (!closing) return;
    setBusy('close');
    try {
      const res = await fetch('/api/retail/return-close', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, returnId: closing.id, note: closeNote.trim() }) });
      const d = await res.json().catch(() => ({}));
      feel(res.ok); onToast(res.ok ? d.message || 'Return closed.' : d.error || 'The return couldn’t be closed.');
      if (res.ok) { setClosing(null); setCloseNote(''); }
    } finally { setBusy(''); }
  };

  const body = group.items.map((p) => {
    if (p.kind === 'message') return <MessageCard key={p.key} p={p} tenantId={tenantId} onToast={onToast} />;
    if (p.kind === 'refund') return <Card key={p.key} p={p}>{canRefund || inAuto(p.ref) ? <Btn kind="primary" className="w-full" onClick={() => setRefund(p)}>Send {money(p.ref.pendingRefundCents)}</Btn> : <p className="m-0 text-[14px]" style={muted}>Waiting for someone allowed to send refunds.</p>}</Card>;
    if (p.kind === 'return') {
      const r = p.ref;
      const untouched = !(r.lines || []).some((l: any) => !!l.disposition);
      const labelFix = r.status === 'open' && !r.labelUrl && !!group.order?.shippingAddress;
      return <Card key={p.key} p={p}>
        {labelFix && r.labelError?.message ? <p className="m-0 mb-3 text-[15px]" style={{ color: C.warn }}>Their return label couldn’t be made: {String(r.labelError.message).slice(0, 180)}</p> : null}
        <Btn kind={r.status === 'received' ? 'primary' : 'soft'} className="w-full" style={r.status === 'received' ? undefined : { background: C.paper }} onClick={() => setRet(r)}>{r.status === 'received' ? 'Finish checking in' : 'It’s here, check it in'}</Btn>
        {labelFix && <Btn kind="soft" className="mt-2 w-full" style={{ background: C.paper }} disabled={busy === `label-${r.id}`} onClick={() => void sendLabel(r)}>{busy === `label-${r.id}` ? 'Sending…' : 'Send the return label'}</Btn>}
        {untouched && <Btn kind="soft" className="mt-2 w-full" style={{ background: C.paper }} onClick={() => { setCloseNote(''); setClosing(r); }}>It isn’t coming, close it</Btn>}
      </Card>;
    }
    if (p.kind === 'claim') return <Card key={p.key} p={p}>
      {p.ref.description ? <p className="m-0 mb-3 text-[15px]">“{String(p.ref.description).slice(0, 240)}”</p> : null}
      {Array.isArray(p.ref.evidence?.photoUrls) && p.ref.evidence.photoUrls.length > 0 && <div className="mb-3 flex gap-2">{p.ref.evidence.photoUrls.slice(0, 4).map((u: string) => <img key={u} src={u} alt="Customer photo" className="h-16 w-16 rounded-xl object-cover" />)}</div>}
      <Link href="/retail-orders/claims" className="cf-press inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold" style={{ background: C.ink, color: C.paper }}>Decide in Claims</Link>
    </Card>;
    if (p.kind === 'held') {
      const o = p.ref; const reasons: string[] = Array.isArray(o.riskCheck?.reasons) && o.riskCheck.reasons.length ? o.riskCheck.reasons : o.holdReason ? [String(o.holdReason)] : [];
      const idc = o.idCheck?.status as string | undefined;
      const idLine = idc === 'verified' ? 'ID check passed' : idc === 'failed' ? 'ID check didn’t pass' : idc === 'sent' || idc === 'processing' ? 'ID check sent, waiting for them' : idc === 'canceled' ? 'They didn’t finish the ID check' : '';
      return <Card key={p.key} p={{ ...p, detail: o.holdAuto ? 'Held by the automatic check. The customer hasn’t been told.' : `Held by ${o.heldBy || 'the team'}. The customer hasn’t been told.` }}>
        {reasons.length > 0 && <ul className="m-0 mb-3 list-none space-y-1 p-0">{reasons.map((r) => <li key={r} className="flex gap-2 text-[15px]"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.warn }} />{r}</li>)}</ul>}
        {idLine && <p className="m-0 mb-3 text-[15px] font-semibold" style={{ color: idc === 'verified' ? C.ok : idc === 'failed' ? C.bad : C.ink }}>{idLine}</p>}
        {canManage ? <div className="flex flex-col gap-2">
          <Btn kind="primary" className="w-full" disabled={busy === 'hold'} onClick={async () => { setBusy('hold'); onToast(await setHold(fs, tenantId, [o], actor, false)); setBusy(''); }}>{busy === 'hold' ? 'Releasing…' : 'Looks fine, release to pack'}</Btn>
          {(!idc || idc === 'canceled' || idc === 'failed') && <Btn kind="soft" className="w-full" style={{ background: C.paper }} disabled={busy === 'id'} onClick={async () => {
            setBusy('id');
            try { const r = await fetch('/api/retail/id-check', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: p.orderId }) }); const d = await r.json().catch(() => ({})); feel(r.ok); onToast(d.message || d.error || 'Done.'); } finally { setBusy(''); }
          }}>{busy === 'id' ? 'Sending…' : 'Ask them to confirm their ID'}</Btn>}
          <Link href={`/retail-orders?order=${p.orderId}`} className="cf-press inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold" style={{ background: C.badSoft, color: C.bad }}>Cancel and refund</Link>
        </div> : <p className="m-0 text-[14px]" style={muted}>A manager decides on held orders.</p>}
      </Card>;
    }
    return <Card key={p.key} p={p}><Link href={`/retail-orders?order=${p.orderId}`} className="cf-press inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold" style={p.kind === 'outside' ? { background: C.ink, color: C.paper } : { background: C.paper }}>{p.kind === 'outside' ? 'Go to the order' : 'Open order'}</Link></Card>;
  });

  return (
    <div className={inline ? 'cf-anim-rise flex min-h-full flex-col' : 'cf-anim-push fixed inset-0 z-30 overflow-y-auto'} style={{ background: C.paper, color: C.ink }}>
      <div className="flex h-14 items-center justify-between px-4">
        {inline ? <span /> : <button type="button" onClick={onClose} className="cf-press inline-flex h-11 items-center gap-1 text-[17px]">{Ic.back}Problems</button>}
        <Link href={`/retail-orders?order=${group.orderId}`} className="h-11 content-center text-[15px] font-semibold" style={muted}>Order {group.num}</Link>
      </div>
      <div className="px-4 pb-12">
        <p className="m-0 text-[28px] font-light tracking-[-0.02em]">{group.customerName}</p>
        <p className="m-0 mt-0.5 text-[15px]" style={muted}>{[o.customerEmail, o.totalCents ? `${money(o.totalCents)} order` : ''].filter(Boolean).join(' · ') || `${group.items.length} to sort`}</p>
        <div className="mt-5 space-y-3">{body}</div>
      </div>
      {refund && (
        <Sheet title={`Send ${money(refund.ref.pendingRefundCents)} to ${first}?`} sub={isFollowUp(refund.ref) ? 'It goes back to the card they paid with on the original order.' : 'It goes back to the card they paid with. Anything paid by store credit or gift card is returned that way.'} onClose={() => setRefund(null)}>
          {refund.ref.returnSummary?.restockingFeeCents ? <p className="m-0 mt-2 text-[15px]" style={muted}>Includes a {money(refund.ref.returnSummary.restockingFeeCents)} restocking fee taken off.</p> : null}
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy === 'refund'} onClick={() => void sendRefund(refund)}>{busy === 'refund' ? 'Sending…' : `Send ${money(refund.ref.pendingRefundCents)}`}</Btn>
        </Sheet>)}
      {closing && (
        <Sheet title="Close this return?" sub={`For when it isn’t coming back. ${first} is told on their order page, and the items can be returned again later.`} onClose={() => setClosing(null)} closeLabel="Keep it open">
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Note for {first} (optional)<input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="For example: you told us you’re keeping it" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy === 'close'} onClick={() => void closeIt()}>{busy === 'close' ? 'Closing…' : 'Close the return'}</Btn>
        </Sheet>)}
      {ret && <ReturnSheet fs={fs} tenantId={tenantId} ret={ret} initialOrder={group.order && group.order.id === ret.orderId ? group.order : null} actor={actor} rs={rs} canRefund={canRefund} onClose={() => setRet(null)} onDone={(m) => { setRet(null); onToast(m); }} />}
    </div>);
}
