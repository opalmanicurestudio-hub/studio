'use client';
// src/components/pos/desk/TodaysSales.tsx — TODAY'S SALES, and VOIDING ONE (with a manager's approval).
// Cash voids tell the desk exactly how much to hand back and what happened to the till; card voids are refunded.
import { receiptCall, openReceipt } from '@/lib/receipt-client';
import { groupDaySales } from '@/lib/day-sales';
import * as React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { DESK_CSS, Btn, Seg } from '@/components/pos/desk/kit';
import { approveWithPin, askManagerPhone } from '@/lib/approve-client';

const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
function SendToClient({ tenantId, receiptId }: { tenantId: string; receiptId: string }) {
  const [ch, setCh] = React.useState<'email' | 'sms'>('email'); const [to, setTo] = React.useState(''); const [msg, setMsg] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  return <div className="space-y-2 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
    <p className="text-[13px] font-semibold">Send to the client</p>
    <Seg label="Send by" value={ch} onChange={(v) => setCh(v)} options={[['email', 'Email'], ['sms', 'Text']]} />
    <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={ch === 'email' ? 'Their email (leave blank to use the one on file)' : 'Their mobile (leave blank to use the one on file)'} className="h-11 w-full rounded-xl px-3.5 text-[15px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
    <Btn onClick={async () => { setBusy(true); const r: any = await receiptCall({ tenantId, receiptId, action: 'send', channel: ch, to: to.trim() || undefined }); setBusy(false); setMsg(r?.ok ? 'Sent.' : r?.error || 'It didn’t send.'); }} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Btn>
    {msg && <p className="text-[13px] font-semibold">{msg}</p>}
  </div>;
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export function TodaysSales({ open, onClose, tenantId, tenant, role, transactions, staff }: { open: boolean; onClose: () => void; tenantId: string; tenant: any; role?: string | null; transactions?: any[]; staff?: any[] }) {
  const { firestore } = useFirebase() as any;
  // Today's receipts come from the server (reliable; refreshed when a sale lands or after a void).
  const [data, setData] = React.useState<any[] | null>(null); const [loadErr, setLoadErr] = React.useState<string | null>(null);
  const loadReceipts = React.useCallback(async () => { if (!tenantId) return;
    const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(); to.setHours(23, 59, 59, 999);
    const r: any = await receiptCall({ tenantId, action: 'today', from: from.toISOString(), to: to.toISOString() });
    if (r?.ok) { setData(r.receipts || []); setLoadErr(null); } else setLoadErr(r?.error || 'Couldn’t load today’s receipts.'); }, [tenantId]);
  const txCount = (transactions || []).length;
  React.useEffect(() => { if (open) loadReceipts(); }, [open, txCount, loadReceipts]);
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [sel, setSel] = React.useState<any>(null); const [reason, setReason] = React.useState('');
  const [how, setHow] = React.useState<'pin' | 'phone'>('pin'); const [pin, setPin] = React.useState('');
  const [phoneId, setPhoneId] = React.useState<string | null>(null); const [phoneStatus, setPhoneStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null); const [done, setDone] = React.useState<any>(null);
  React.useEffect(() => { if (!phoneId || !firestore) return; return onSnapshot(doc(firestore, `tenants/${tenantId}/approvals/${phoneId}`), (s) => setPhoneStatus((s.data() as any)?.status || null)); }, [phoneId, firestore, tenantId]);
  const [filter, setFilter] = React.useState<'all' | 'checkout' | 'online' | 'fees' | 'voided'>('all'); const [search, setSearch] = React.useState(''); const [openKey, setOpenKey] = React.useState<string | null>(null);
  const day = React.useMemo(() => { const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(); to.setHours(23, 59, 59, 999); return groupDaySales(transactions || [], data || [], from, to); }, [transactions, data]);
  const reset = () => { setSel(null); setReason(''); setPin(''); setPhoneId(null); setPhoneStatus(null); setErr(null); setDone(null); setHow('pin'); };
  if (!open) return null;
  const doVoid = async (approvalToken?: string | null) => {
    setBusy(true); setErr(null);
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    const r = await fetch('/api/checkout/void', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, receiptId: sel.id, reason, approvalToken }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'The void didn’t go through.'); return; }
    setDone(r); loadReceipts();
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
            <Btn big onClick={() => openReceipt(tenantId, sel.id)}>Print void slip{isCash ? ' (with signature lines)' : ''}</Btn>
            <SendToClient tenantId={tenantId} receiptId={sel.id} />
            {(done.warnings || []).map((w: string, i: number) => <p key={i} className="rounded-2xl p-3 text-[14px]" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>{w}</p>)}
            <Btn big onClick={reset}>Back to today’s sales</Btn>
          </> : sel ? <>
            <section className="space-y-1 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
              <p className="text-[16px] font-semibold">{sel.clientName || 'Guest'} · {money(sel.total)}</p>
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{new Date(sel.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {isCash ? 'Cash' : 'Card'}{sel.paidBy && sel.paidBy !== sel.clientName ? ` · paid by ${sel.paidBy}` : ''}</p>
              <p className="pt-1 text-[14px]">{Array.isArray(sel.payments) && sel.payments.length ? (() => { const cards = sel.payments.filter((p: any) => p.method === 'card'); const cash = sel.payments.filter((p: any) => p.method === 'cash').reduce((a: number, p: any) => a + Number(p.amount || 0) + Number(p.tip || 0), 0);
                return `${cards.length ? `The ${cards.length === 1 ? 'card payment is' : `${cards.length} card payments are`} refunded automatically.` : ''}${cash > 0 ? ` You’ll hand back ${money(cash)} in cash — the till is adjusted automatically.` : ''}`; })()
                : isCash ? `You’ll hand back ${money(sel.total)} in cash — the till is adjusted automatically.` : 'The card is refunded automatically.'} Every part of the sale is undone and the visit reopened.</p>
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
            <section className="grid grid-cols-3 gap-2">
              {([['Taken today', money(day.summary.total)], ['Sales', String(day.summary.count)], ['Average', money(day.summary.average)]] as const).map(([l, v]) =>
                <div key={l} className="rounded-2xl p-3" style={{ background: 'var(--card)' }}><p className="text-[12px]" style={{ color: 'var(--muted)' }}>{l}</p><p className="text-[20px] font-semibold tabular-nums">{v}</p></div>)}
            </section>
            <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Cash {money(day.summary.cash)} · Card {money(day.summary.card)} · Online {money(day.summary.online)}{day.summary.other ? ` · Other ${money(day.summary.other)}` : ''} · Tips {money(day.summary.tips)}{day.summary.voidedCount ? ` · ${day.summary.voidedCount} voided (${money(day.summary.voidedTotal)})` : ''}</p>
            {loadErr && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>{loadErr} Receipts and voids may not show — close and reopen.</p>}
            <Seg label="Show" value={filter} onChange={(v) => setFilter(v)} options={[['all', 'All'], ['checkout', 'Checkout'], ['online', 'Online & deposits'], ['fees', 'Fees & balances'], ['voided', 'Voided']]} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a client" aria-label="Find a client" className={inp} style={inpS} />
            {(() => {
              const t = search.trim().toLowerCase();
              const rows = day.sales.filter((x: any) => (filter === 'all' ? true : filter === 'voided' ? x.voided : filter === 'checkout' ? (x.source === 'checkout' || x.source === 'planner') : filter === 'online' ? (x.method === 'online' || x.source === 'deposit' || x.source === 'order') : (x.source === 'fee' || x.source === 'balance'))
                && (!t || String(x.clientName || '').toLowerCase().includes(t) || String(x.paidBy || '').toLowerCase().includes(t)));
              if (!rows.length) return <p className="text-[15px]" style={{ color: 'var(--muted)' }}>{day.sales.length ? 'Nothing matches.' : 'No sales yet today.'}</p>;
              const who = (id: string) => String((staff || []).find((m: any) => m.id === id)?.name || '').split(' ')[0];
              return rows.map((x: any) => {
                const openRow = openKey === x.key; const r = x.receipt;
                return <div key={x.key} className="rounded-2xl" style={{ background: 'var(--card)', opacity: x.voided ? 0.6 : 1 }}>
                  <button type="button" aria-expanded={openRow} onClick={() => setOpenKey(openRow ? null : x.key)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
                    <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{x.clientName || 'Guest'}{x.paidBy && x.paidBy !== x.clientName ? <span className="font-normal" style={{ color: 'var(--muted)' }}> · paid by {x.paidBy}</span> : null}</span>
                      <span className="block text-[13px]" style={{ color: 'var(--muted)' }}>{new Date(x.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {x.label} · {x.method === 'cash' ? 'Cash' : x.method === 'card' ? 'Card' : x.method === 'online' ? 'Online' : x.method === 'split' ? `Split · ${(x.receipt?.payments || []).length} payments` : 'Other'}{x.staffIds.map(who).filter(Boolean).length ? ` · ${x.staffIds.map(who).filter(Boolean).join(', ')}` : ''}{x.voided ? ' · voided' : ''}{r?.needsReview ? ' · needs review' : ''}</span></span>
                    <span className="shrink-0 text-[16px] font-semibold tabular-nums">{x.voided ? <s>{money(x.total)}</s> : money(x.total)}</span>
                  </button>
                  {openRow && <div className="space-y-2 px-3 pb-3">
                    {x.lines.length > 0 && <div className="space-y-1 rounded-xl p-2.5 text-[13px]" style={{ background: 'var(--soft)' }}>
                      {x.lines.map((t: any) => <div key={t.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{t.description}{t.staffId && who(t.staffId) ? <span style={{ color: 'var(--muted)' }}> · {who(t.staffId)}</span> : null}{t.voided ? ' (void)' : ''}</span><span className="tabular-nums">{t.type === 'expense' ? '−' : ''}{money(t.amount)}</span></div>)}
                    </div>}
                    <div className="flex flex-wrap gap-1.5">
                      {r && <Btn quiet onClick={() => openReceipt(tenantId, r.id)}>{r.voided ? 'Void slip' : 'Receipt'}</Btn>}
                      {r && !r.voided && r.reversal && <Btn quiet onClick={() => { reset(); setSel(r); }}>Void sale</Btn>}
                      {!r && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{x.source === 'planner' ? 'Completed from the planner — no receipt was made.' : x.method === 'online' ? 'Paid online — refunds are made from the payment’s page in Money.' : 'Recorded outside checkout — see it in Money.'}</p>}
                    </div>
                  </div>}
                </div>;
              });
            })()}
            <p className="pt-2 text-[12px]" style={{ color: 'var(--muted)' }}>Checkout sales can be voided on the day. After that, refund them instead.</p>
          </>}
        </div>
      </div>
    </div>
  );
}
