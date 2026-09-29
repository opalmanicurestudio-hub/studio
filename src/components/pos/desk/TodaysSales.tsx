'use client';
// src/components/pos/desk/TodaysSales.tsx — TODAY'S SALES, and VOIDING ONE (with a manager's approval).
// Cash voids tell the desk exactly how much to hand back and what happened to the till; card voids are refunded.
import * as React from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { DESK_CSS, Btn, Seg } from '@/components/pos/desk/kit';
import { approveWithPin, askManagerPhone } from '@/lib/approve-client';

const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export function TodaysSales({ open, onClose, tenantId, tenant, role }: { open: boolean; onClose: () => void; tenantId: string; tenant: any; role?: string | null }) {
  const { firestore } = useFirebase() as any;
  const q = useMemoFirebase(() => (open && firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/receipts`), where('date', '>=', startOfToday())) : null), [open, firestore, tenantId]);
  const { data } = useCollection<any>(q);
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [sel, setSel] = React.useState<any>(null); const [reason, setReason] = React.useState('');
  const [how, setHow] = React.useState<'pin' | 'phone'>('pin'); const [pin, setPin] = React.useState('');
  const [phoneId, setPhoneId] = React.useState<string | null>(null); const [phoneStatus, setPhoneStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null); const [done, setDone] = React.useState<any>(null);
  React.useEffect(() => { if (!phoneId || !firestore) return; return onSnapshot(doc(firestore, `tenants/${tenantId}/approvals/${phoneId}`), (s) => setPhoneStatus((s.data() as any)?.status || null)); }, [phoneId, firestore, tenantId]);
  const reset = () => { setSel(null); setReason(''); setPin(''); setPhoneId(null); setPhoneStatus(null); setErr(null); setDone(null); setHow('pin'); };
  if (!open) return null;
  const list = (data || []).slice().sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date));
  const doVoid = async (approvalToken?: string | null) => {
    setBusy(true); setErr(null);
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    const r = await fetch('/api/checkout/void', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, receiptId: sel.id, reason, approvalToken }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'The void didn’t go through.'); return; }
    setDone(r);
  };
  const approveAndVoid = async () => {
    if (!reason.trim()) { setErr('Say why the sale is being voided.'); return; }
    if (isManager) return doVoid(null);
    if (how === 'pin') { setBusy(true); const ap = await approveWithPin(tenantId, pin, { kind: 'void', ref: sel.id, reason, amount: Number(sel.total) || 0 }); setBusy(false);
      if (!ap.ok) { setErr(ap.error || 'Not approved.'); return; } return doVoid(ap.token); }
    setBusy(true); const r: any = await askManagerPhone(tenantId, { kind: 'void', ref: sel.id, reason, amount: Number(sel.total) || 0, summary: `${sel.clientName || 'A client'} · ${money(sel.total)} · ${sel.paymentMethod}` }); setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'Couldn’t ask a manager.'); return; } setPhoneId(r.id);
  };
  const inp = 'h-11 w-full rounded-xl px-3.5 text-[15px] outline-none'; const inpS = { background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)' } as React.CSSProperties;
  const accent = tenant?.bookingPageSettings?.cfPageConfig?.accentColor || tenant?.brandColor || 'hsl(var(--primary))';
  const isCash = sel && String(sel.paymentMethod) === 'cash';
  return (
    <div className="desk fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(28,25,23,.45)', ['--accent' as any]: accent, ['--accent-ink' as any]: '#fff' }} onClick={() => { reset(); onClose(); }}>
      <style>{DESK_CSS}</style>
      <div role="dialog" aria-modal="true" aria-label="Today's sales" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-xl flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <header className="flex items-center justify-between px-5 pb-3 pt-5"><p className="text-[20px] font-semibold">{done ? 'Sale voided' : sel ? 'Void this sale' : 'Today’s sales'}</p><Btn quiet onClick={() => { reset(); onClose(); }}>Close</Btn></header>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-6">
          {done ? <>
            {done.cashToReturn > 0 && <section className="space-y-1 rounded-3xl p-5 text-center" style={{ background: 'var(--card)' }}>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>Hand back in cash</p>
              <p className="text-[40px] font-semibold">{money(done.cashToReturn)}</p>
              <p className="text-[14px]">{done.tillNote}</p></section>}
            {done.refunded && <section className="rounded-3xl p-5" style={{ background: 'var(--card)' }}><p className="text-[16px] font-semibold">Refunded to their card.</p><p className="text-[14px]" style={{ color: 'var(--muted)' }}>They’ll get a message; it usually shows in 5–10 business days.</p></section>}
            <section className="space-y-1.5 rounded-3xl p-5 text-[14px]" style={{ background: 'var(--card)' }}>
              <p className="font-semibold">What the void did</p>
              <p>• Every payment line reversed (the originals are kept, marked void)</p>
              <p>• Stock back on the shelf; owed fees and any deposit credit restored</p>
              {done.reopened > 0 && <p>• {done.reopened} visit{done.reopened === 1 ? '' : 's'} reopened — check {done.reopened === 1 ? 'it' : 'them'} out again correctly</p>}
              <p>• Approved by {done.approvedBy}; recorded in the activity log</p>
              {isCash && <p className="pt-1"><b>Front desk:</b> count the cash back to the client, give them the voided receipt if they want it, and keep the till drawer closed until it’s counted.</p>}
            </section>
            {(done.warnings || []).map((w: string, i: number) => <p key={i} className="rounded-2xl p-3 text-[14px]" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>{w}</p>)}
            <Btn big onClick={reset}>Back to today’s sales</Btn>
          </> : sel ? <>
            <section className="space-y-1 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
              <p className="text-[16px] font-semibold">{sel.clientName || 'Guest'} · {money(sel.total)}</p>
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{new Date(sel.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {isCash ? 'Cash' : 'Card'}{sel.paidBy && sel.paidBy !== sel.clientName ? ` · paid by ${sel.paidBy}` : ''}</p>
              <p className="pt-1 text-[14px]">{isCash ? `You’ll hand back ${money(sel.total)} in cash — the till is adjusted automatically.` : 'The card is refunded automatically.'} Every part of the sale is undone and the visit reopened.</p>
            </section>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is it being voided? (e.g. rung up on the wrong client)" className="w-full resize-none rounded-xl px-3.5 py-2.5 text-[15px] outline-none" style={inpS} />
            {!isManager && <section className="space-y-2 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
              <p className="text-[13px] font-semibold">A manager approves</p>
              <Seg label="How a manager approves" value={how} onChange={(v) => setHow(v)} options={[['pin', 'Manager’s PIN'], ['phone', 'Ask a manager’s phone']]} />
              {how === 'pin' ? <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" placeholder="Manager PIN" className={inp} style={inpS} />
                : phoneId ? <p className="text-[14px]">{phoneStatus === 'approved' ? 'Approved — voiding…' : phoneStatus === 'declined' ? 'A manager declined.' : 'Waiting for a manager to answer on their phone…'}</p> : null}
            </section>}
            {phoneStatus === 'approved' && phoneId && !busy && !done && <Btn big onClick={() => doVoid(phoneId)}>Finish the void</Btn>}
            {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
            {!(how === 'phone' && phoneId) && <Btn big onClick={approveAndVoid} disabled={busy || !reason.trim() || (!isManager && how === 'pin' && pin.length < 4)}>{busy ? 'Working…' : isManager ? 'Void the sale' : how === 'pin' ? 'Approve and void' : 'Ask a manager'}</Btn>}
            <Btn quiet onClick={reset}>Back</Btn>
          </> : <>
            {!list.length && <p className="text-[15px]" style={{ color: 'var(--muted)' }}>No sales yet today.</p>}
            {list.map((r: any) => <div key={r.id} className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'var(--card)', opacity: r.voided ? 0.6 : 1 }}>
              <div><p className="text-[15px] font-semibold">{r.clientName || 'Guest'} · {money(r.total)}</p>
                <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{new Date(r.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {String(r.paymentMethod) === 'cash' ? 'Cash' : 'Card'}{r.voided ? ` · voided (${r.voidReason || 'no reason'})` : ''}{r.needsReview ? ' · needs review' : ''}</p></div>
              {!r.voided && r.reversal && <Btn quiet onClick={() => { reset(); setSel(r); }}>Void sale</Btn>}
            </div>)}
            <p className="pt-2 text-[12px]" style={{ color: 'var(--muted)' }}>Sales can be voided on the day. After that, refund them instead.</p>
          </>}
        </div>
      </div>
    </div>
  );
}
