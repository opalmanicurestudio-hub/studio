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
  const [busy, setBusy] = React.useState('');
  const o = group.order || group.items[0]?.ref || {};
  const first = String(group.customerName || '').split(' ')[0] || 'them';

  const sendRefund = async (p: Problem) => {
    setBusy('refund');
    try {
      const r = await fetch('/api/retail/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: p.orderId, qrToken: p.ref.qrToken || '' }) });
      const d = await r.json().catch(() => ({}));
      const over = Number(d.overCardCents) || 0;
      feel(r.ok); onToast(r.ok ? `Refund sent. ${first} usually sees it in 5 to 10 days.${over > 0 ? ` The other ${money(over)} is more than the card has left to refund, so give it back as store credit.` : ''}` : d.error || 'The refund didn’t go through.');
      if (r.ok) setRefund(null);
    } finally { setBusy(''); }
  };

  const body = group.items.map((p) => {
    if (p.kind === 'message') return <MessageCard key={p.key} p={p} tenantId={tenantId} onToast={onToast} />;
    if (p.kind === 'refund') return <Card key={p.key} p={p}>{canRefund ? <Btn kind="primary" className="w-full" onClick={() => setRefund(p)}>Send {money(p.ref.pendingRefundCents)}</Btn> : <p className="m-0 text-[14px]" style={muted}>A manager sends refunds.</p>}</Card>;
    if (p.kind === 'return') return <Card key={p.key} p={p}><Btn kind={p.ref.status === 'received' ? 'primary' : 'soft'} className="w-full" style={p.ref.status === 'received' ? undefined : { background: C.paper }} onClick={() => setRet(p.ref)}>{p.ref.status === 'received' ? 'Finish checking in' : 'It’s here, check it in'}</Btn></Card>;
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
      {ret && <ReturnSheet fs={fs} tenantId={tenantId} ret={ret} initialOrder={group.order && group.order.id === ret.orderId ? group.order : null} actor={actor} rs={rs} canRefund={canRefund} onClose={() => setRet(null)} onDone={(m) => { setRet(null); onToast(m); }} />}
    </div>);
}
