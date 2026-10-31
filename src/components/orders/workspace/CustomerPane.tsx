'use client';
// src/components/orders/workspace/CustomerPane.tsx — THE CUSTOMER, ON THE ORDER. Their name, email and mobile (changed
// here by managers and the front desk, api/retail/customer-contact), where it ships, what they've bought before, and the
// whole conversation in both directions: what they wrote, the shop's replies and messages, and the updates they were
// sent. Writing here answers their open case, or starts a new message on their order page (api/retail/support-reply,
// api/retail/order-message); either way they get a text or an email pointing to it.
import * as React from 'react';
import { collection, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { firstName, money } from '@/lib/orders-view';
import { conversationOf, openCase, waitingOnShop, type ThreadMsg } from '@/lib/order-thread';
import { cleanContact, contactDiff } from '@/lib/contact-change';
import { AddressCard } from '../AddressCard';
import { Btn, C, Toggle, feel, muted } from '../ui';
import { GapNote, ReplyChips, pickInto, replyContext } from '../ReplyChips';
import { hasGap } from '@/lib/replies';
import { useTenant } from '@/context/TenantContext';

const when = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
const NOT_A_SALE = ['placed', 'cancelled'];

/** What they've bought before, by email: a quick sense of who this is. Read once per customer. */
function useHistory(fs: Firestore, tenantId: string, email: string, orderId: string) {
  const [h, setH] = React.useState<{ orders: number; spent: number; since: string; returns: number } | null>(null);
  React.useEffect(() => {
    const e = String(email || '').trim().toLowerCase();
    if (!fs || !tenantId || !e) { setH(null); return; }
    let live = true;
    getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('customerEmail', '==', e), limit(60))).then((s) => {
      if (!live) return;
      const rows = s.docs.map((d) => ({ ...(d.data() as any), id: d.id })).filter((o) => !NOT_A_SALE.includes(String(o.stage)) && !o.isTest && !o.parentOrderId);
      const spent = rows.reduce((a, o) => a + Math.max(0, (Number(o.chargedCents ?? o.totalCents) || 0) - (Number(o.refundedCents) || 0)), 0);
      const first = rows.map((o) => Date.parse(String(o.paidAt || o.placedAt || ''))).filter(Number.isFinite).sort((a, b) => a - b)[0];
      setH({ orders: rows.length, spent, since: first ? new Date(first).getFullYear().toString() : '', returns: rows.filter((o) => o.returnSummary || (Number(o.refundedCents) || 0) > 0).length });
    }).catch(() => { if (live) setH(null); });
    return () => { live = false; };
  }, [fs, tenantId, email, orderId]);
  return h;
}

export function CustomerPane({ fs, tenantId, order, canEdit, tickets, inbox, startMessage, aside, documents, onToast }: {
  fs: Firestore; tenantId: string; order: any; canEdit: boolean; tickets: any[]; inbox: any[]; startMessage?: string | null; aside: boolean;
  /** The order's documents, shown under the conversation beside the order on a computer. */
  documents?: React.ReactNode; onToast: (m: string) => void;
}) {
  const who = firstName(order.customerName);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', email: '', phone: '', textsOff: false });
  const [saving, setSaving] = React.useState(false); const [formErr, setFormErr] = React.useState('');
  const [text, setText] = React.useState(startMessage || '');
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const [updatesOpen, setUpdatesOpen] = React.useState(false);
  React.useEffect(() => { setEditing(false); setFormErr(''); setErr(''); setUpdatesOpen(false); }, [order.id]);
  React.useEffect(() => { setText(startMessage || ''); }, [order.id, startMessage]);
  const history = useHistory(fs, tenantId, order.customerEmail, order.id);
  const thread = React.useMemo(() => conversationOf(inbox, tickets), [inbox, tickets]);
  const open = React.useMemo(() => openCase(tickets), [tickets]);
  const waiting = waitingOnShop(thread, tickets);
  const shown = updatesOpen ? thread : thread.filter((m, i) => m.who !== 'update' || i >= thread.length - 2);
  const hiddenUpdates = thread.length - shown.length;
  const endRef = React.useRef<HTMLDivElement>(null);

  const startEdit = () => { setForm({ name: String(order.customerName || ''), email: String(order.customerEmail || ''), phone: String(order.customerPhone || ''), textsOff: order.textsOff === true }); setFormErr(''); setEditing(true); };
  const check = cleanContact(order, form);
  const changes = contactDiff(order, check.next);
  const save = async () => {
    if (check.errors.length) { setFormErr(check.errors[0]); return; }
    if (!changes.length) { setEditing(false); return; }
    setSaving(true); setFormErr('');
    try {
      const r = await fetch('/api/retail/customer-contact', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, ...form }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setFormErr(d.error || 'That didn’t save. Try again.'); return; }
      feel(true); setEditing(false); onToast(d.message || 'Saved.');
    } catch { setFormErr('That didn’t save. Try again.'); } finally { setSaving(false); }
  };

  // Ready replies (lib/replies): the one picked, and the shop's name to fill in.
  const [picked, setPicked] = React.useState<string | null>(null);
  const lastFill = React.useRef<string | null>(null);
  const tc: any = useTenant();
  const shopName = String(tc?.selectedTenant?.businessName || tc?.selectedTenant?.name || '');
  const reachable = !!(order.customerEmail || order.customerPhone);
  const send = async (resolve: boolean) => {
    const t = text.trim();
    if (!t && !resolve) { setErr('Write the message first.'); return; }
    setBusy(resolve && !t ? 'solve' : 'send'); setErr('');
    try {
      const r = open
        ? await fetch('/api/retail/support-reply', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ticketId: open.id, reply: t, resolve }) })
        : await fetch('/api/retail/order-message', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, text: t }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) { feel(false); setErr(d.error || 'That didn’t send. Try again.'); return; }
      feel(true); setText(''); setPicked(null); onToast(d.message || 'Sent.');
      setTimeout(() => endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 120);
    } catch { setErr('That didn’t send. Try again.'); } finally { setBusy(''); }
  };
  const draft = async () => {
    if (!open) return;
    setBusy('draft'); setErr('');
    try {
      const r = await fetch('/api/retail/support-draft', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ticketId: open.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.draft) { setErr(d.error ? 'A drafted reply isn’t available right now. Write it here.' : 'No draft came back. Write it here.'); return; }
      setText(String(d.draft));
    } catch { setErr('A drafted reply isn’t available right now. Write it here.'); } finally { setBusy(''); }
  };

  const field = 'mt-1 block h-11 w-full rounded-xl border px-3 text-[15.5px] font-normal';
  const bubble = (m: ThreadMsg) => {
    if (m.who === 'update') return (
      <div key={m.id} className="flex items-start gap-2 py-1">
        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.line }} />
        <p className="m-0 min-w-0 flex-1 text-[13px] leading-snug" style={muted}><span className="font-semibold">Update sent</span> · {m.title || m.text.split('\n')[0]}<span className="block text-[11.5px]">{when(m.at)}</span></p>
      </div>);
    const mine = m.who === 'shop';
    return (
      <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <div className="max-w-[88%]">
          <div className="rounded-2xl px-3.5 py-2.5" style={mine ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>
            {m.text && <p className="m-0 whitespace-pre-wrap text-[14.5px] leading-snug">{m.text}</p>}
            {m.photos && m.photos.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{m.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="A photo they sent" className="h-16 w-16 rounded-lg object-cover" /></a>)}</div>}
          </div>
          <p className={`m-0 mt-0.5 text-[11.5px] ${mine ? 'text-right' : ''}`} style={muted}>{mine ? `${m.by || 'The shop'} · ` : m.chaser ? 'Checking in · ' : ''}{when(m.at)}</p>
        </div>
      </div>);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold" style={muted}>{editing ? 'Customer · editing' : 'Customer'}</p>
        {canEdit && !editing && <button type="button" onClick={startEdit} className="h-9 rounded-full px-3 text-[14px] font-semibold" style={{ background: C.soft }}>Edit</button>}
      </div>
      {!editing ? (
        <div className="mt-1.5 text-[14.5px] leading-relaxed">
          <p className="m-0 text-[16px] font-semibold">{order.customerName || 'Customer'}</p>
          {order.customerEmail ? <p className="m-0 break-all">{order.customerEmail}</p> : <p className="m-0" style={muted}>No email</p>}
          {order.customerPhone ? <p className="m-0">{order.customerPhone}<span style={muted}> · {order.textsOff ? 'texts off' : 'texts on'}</span></p> : <p className="m-0" style={muted}>No mobile</p>}
          {!canEdit && <p className="m-0 mt-1 text-[12.5px]" style={muted}>Managers and the front desk can change these.</p>}
        </div>
      ) : (
        <div className="mt-1">
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" className={field} style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Email<input type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" autoCapitalize="off" className={field} style={{ borderColor: changes.some((c) => c.field === 'email') ? C.ink : C.line, background: C.paper, color: C.ink }} /></label>
          {changes.some((c) => c.field === 'email') && order.customerEmail && <p className="m-0 mt-1 text-[13px] leading-snug" style={muted}>Was {order.customerEmail}. Saving sends the order link to the new email and tells the old one it changed.</p>}
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Mobile<input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" className={field} style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <div className="mt-3 flex items-center justify-between gap-3 text-[15px]"><span>Texts about this order</span><Toggle on={!form.textsOff} onChange={(v) => setForm({ ...form, textsOff: !v })} label="Texts about this order" /></div>
          {formErr && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{formErr}</p>}
          <div className="mt-3 flex gap-2">
            <Btn kind="primary" className="h-11 flex-1" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Btn>
            <Btn kind="soft" className="h-11" disabled={saving} onClick={() => setEditing(false)}>Cancel</Btn>
          </div>
          <p className="m-0 mt-2 text-[12.5px]" style={muted}>Every change is on the order’s record, with your name.</p>
        </div>)}

      {order.method === 'ship' && order.shippingAddress && (
        <div className="mt-4">
          {['paid', 'picking', 'packed'].includes(String(order.stage)) ? <AddressCard order={order} tenantId={tenantId} onToast={onToast} /> : <AddressCard order={order} compact />}
        </div>)}
      {order.gift && (
        <div className="mt-3 rounded-2xl px-4 py-3 text-[14.5px]" style={{ border: `1px solid ${C.line}` }}>
          <p className="m-0 font-semibold">A gift{order.gift.to ? ` for ${order.gift.to}` : ''}</p>
          {order.gift.message ? <p className="m-0 mt-1">“{order.gift.message}”</p> : null}
          <p className="m-0 mt-1 text-[13px]" style={muted}>Prices are left off the slip.</p>
        </div>)}
      {history && history.orders > 0 && (
        <div className="mt-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: C.soft }}>
          <p className="m-0 font-semibold">{history.orders} order{history.orders === 1 ? '' : 's'} · {money(history.spent)}{history.since ? ` · since ${history.since}` : ''}</p>
          <p className="m-0 mt-0.5" style={muted}>{history.returns ? `${history.returns} with a refund or return` : 'No refunds or returns'}</p>
        </div>)}

      <div className="mt-5 flex items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold" style={muted}>Messages</p>
        <span className="text-[12.5px]" style={waiting ? { color: C.warn, fontWeight: 600 } : muted}>{waiting ? `${who} is waiting for an answer` : 'On their order page'}</span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {hiddenUpdates > 0 && <button type="button" onClick={() => setUpdatesOpen(true)} className="h-9 self-start text-[13px] font-semibold underline underline-offset-4">Show {hiddenUpdates} earlier update{hiddenUpdates === 1 ? '' : 's'}</button>}
        {shown.length === 0 && <p className="m-0 text-[14px]" style={muted}>Nothing yet. Updates about the order, and anything {who} writes, show here.</p>}
        {shown.map(bubble)}
        <div ref={endRef} />
      </div>
      {reachable ? (
        <div className="mt-3">
          <ReplyChips className="mb-2" fs={fs} tenantId={tenantId} situation="message" ctx={replyContext(order, shopName)} picked={picked} onPick={(t, id) => { const prev = lastFill.current; setText((cur) => pickInto(cur, prev, t)); lastFill.current = t; setPicked(id); setErr(''); }} />
          <label className="block">
            <span className="sr-only">{open ? `Reply to ${who}` : `Write to ${who}`}</span>
            <textarea value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value.trim()) setPicked(null); }} rows={aside ? 3 : 4} maxLength={1500} placeholder={open ? `Reply to ${who}` : `Write to ${who}`}
              className="block w-full resize-y rounded-2xl border px-3.5 py-3 text-[15px] outline-none" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          </label>
          <GapNote text={text} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="primary" className="h-11 flex-1" disabled={!text.trim() || !!busy || hasGap(text)} onClick={() => void send(false)}>{busy === 'send' ? 'Sending…' : open ? 'Send reply' : 'Send'}</Btn>
            {open && <Btn kind="soft" className="h-11" disabled={!!busy || hasGap(text)} onClick={() => void send(true)}>{text.trim() ? 'Send and mark solved' : busy === 'solve' ? 'Saving…' : 'Mark solved'}</Btn>}
            {open && !text.trim() && <Btn kind="plain" className="h-11" disabled={!!busy} onClick={() => void draft()}>{busy === 'draft' ? 'Drafting…' : 'Draft a reply'}</Btn>}
          </div>
          {err && <p role="alert" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{err}</p>}
          <p className="m-0 mt-2 text-[12px]" style={muted}>It appears on their order page, and they get {order.customerPhone && !order.textsOff ? 'a text' : 'an email'} pointing them to it. Their answer lands here.</p>
        </div>) : <p className="m-0 mt-3 text-[14px]" style={muted}>There’s no email or mobile on this order to reach them.</p>}
      {documents ? <div className="mt-6">{documents}</div> : null}
    </div>);
}
