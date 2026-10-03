'use client';
// src/components/pos/SaleComplete.tsx — WHAT HAPPENS WHEN A SALE IS DONE: the amount, change due (cash), the receipt
// (print · text · email), book their next visit, then a new sale or done. Nothing disappears on the desk.
import * as React from 'react';
import { receiptCall, openReceipt } from '@/lib/receipt-client';

const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
export function SaleComplete({ sale, tenantId, onNewSale, onDone, screenName, onBookOnScreen, autoReturnSec = 10 }: { sale: any; tenantId: string; onNewSale: () => void; onDone?: () => void; screenName?: string | null; onBookOnScreen?: () => void; autoReturnSec?: number }) {
  // Back to the desk by itself (the business's setting) — unless there's change to count back, or staff tap Stay / start doing something.
  const [left, setLeft] = React.useState<number | null>(autoReturnSec > 0 && !(Number(sale?.change) > 0) ? autoReturnSec : null);
  React.useEffect(() => { if (left === null) return; if (left <= 0) { onNewSale(); onDone?.(); return; } const t = setTimeout(() => setLeft((n) => (n === null ? null : n - 1)), 1000); return () => clearTimeout(t); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ch, setCh] = React.useState<'sms' | 'email' | null>(null); const [to, setTo] = React.useState(''); const [msg, setMsg] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (ch) setLeft(null); }, [ch]);   // sending a receipt → stay
  const cash = sale.method === 'cash'; const first = String(sale.clientName || '').split(' ')[0];
  // What the sale did (from the server). "Book their next visit" only where there was a visit — never for rent,
  // tuition, a membership or a retail-only sale. Older results (no outcomes) keep the old rule.
  const outcomes: any[] = Array.isArray(sale.outcomes) ? sale.outcomes : [];
  const hadVisit = outcomes.length ? outcomes.some((o) => o.kind === 'visit') : !!sale.serviceId;
  const rent = outcomes.find((o) => o.kind === 'rent');
  const [kept, setKept] = React.useState<string | null>(null);
  const keepChange = async () => {
    const cents = Math.round(Number(sale.change) * 100); setBusy(true);
    try { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken();
      const r = await fetch('/api/rent/change-credit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, receiptId: sale.receiptId, renterId: rent?.renterId, cents }) }).then((x) => x.json());
      setKept(r.ok ? `${money(cents / 100)} kept in the till — it comes off ${rent?.name?.split(' ')[0] || 'their'}’s next rent.` : r.error || 'That didn’t save.');
    } catch { setKept('No connection — try again.'); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setMsg(null);
    const r: any = await receiptCall({ tenantId, receiptId: sale.receiptId, action: 'send', channel: ch, to: to.trim() || undefined }); setBusy(false);
    setMsg(r?.ok ? `Sent to ${to.trim() || (ch === 'email' ? sale.email : sale.phone)}.` : r?.error || 'It didn’t send.'); if (r?.ok) setCh(null);
  };
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties;
  const btn = 'h-12 rounded-full px-5 text-[15px] font-semibold disabled:opacity-40';
  return (
    <div className="mx-auto max-w-md space-y-3" role="status" aria-live="polite">
      <section className="space-y-1 rounded-3xl p-6 text-center" style={box}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-[28px]" style={{ background: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' }} aria-hidden>✓</div>
        <p className="pt-2 text-[15px]" style={{ color: 'var(--muted)' }}>{first ? `${first} · ` : ''}paid {cash ? 'in cash' : sale.method === 'other' ? '' : 'by card'}</p>
        <p className="text-[40px] font-semibold tabular-nums leading-tight">{money(sale.collected ?? sale.total)}</p>
        {Number(sale.depositUsed) > 0 && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Total {money(sale.total)} · {money(sale.depositUsed)} deposit already paid</p>}
      </section>
      {outcomes.filter((o) => o.kind !== 'visit' && o.kind !== 'retail').map((o, i) => (
        <section key={i} className="space-y-1 rounded-3xl p-4" style={box}>
          {o.kind === 'rent' && <><p className="text-[15px] font-semibold">Rent — {o.name}</p>
            <p className="text-[14px]">Paid {money(o.paidCents / 100)}.{' '}{o.owedAfterCents > 0 ? `Still owed: ${money(o.owedAfterCents / 100)}.` : o.creditCents > 0 ? `${money(o.creditCents / 100)} paid ahead — it comes off their next rent.` : 'All paid up.'}</p></>}
          {o.kind === 'tuition' && <><p className="text-[15px] font-semibold">Tuition — {o.name}{o.program ? ` (${o.program})` : ''}</p>
            <p className="text-[14px]">Paid {money(o.paidCents / 100)}. {o.remainingCents > 0 ? `Remaining: ${money(o.remainingCents / 100)}.` : 'Paid in full.'}</p></>}
          {(o.kind === 'membership' || o.kind === 'package') && <p className="text-[15px]"><b>{o.name}</b> is on their account.</p>}
          {o.kind === 'booth' && <p className="text-[15px]"><b>Booth time paid</b>{o.name ? ` — ${o.name}` : ''}. Book their next day from Booths.</p>}
        </section>))}
      {cash && Number(sale.change) > 0 && <section className="rounded-3xl p-5 text-center" style={{ ...box, background: 'color-mix(in srgb, var(--accent) 8%, var(--card))' }}>
        <p className="text-[14px] font-semibold" style={{ color: 'var(--muted)' }}>Change due</p>
        <p className="text-[36px] font-semibold tabular-nums">{money(sale.change)}</p>
        <p className="text-[13px]" style={{ color: 'var(--muted)' }}>From {money(sale.tendered)} handed over</p>
        {rent?.renterId && !kept && <button type="button" disabled={busy} onClick={() => { setLeft(null); void keepChange(); }} className="mt-2 h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--soft)' }}>Put the {money(sale.change)} change toward their next rent</button>}
        {kept && <p className="mt-2 text-[13px] font-semibold">{kept}</p>}
      </section>}
      {sale.receiptId && <section className="space-y-2 rounded-3xl p-4" style={box}>
        <p className="text-[15px] font-semibold">Receipt</p>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => openReceipt(tenantId, sale.receiptId)} className="h-11 rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft)' }}>Print</button>
          <button type="button" aria-pressed={ch === 'sms'} onClick={() => { setCh(ch === 'sms' ? null : 'sms'); setTo(sale.phone || ''); setMsg(null); }} className="h-11 rounded-full text-[14px] font-semibold" style={{ background: ch === 'sms' ? 'var(--accent)' : 'var(--soft)', color: ch === 'sms' ? 'var(--accent-ink)' : undefined }}>Text</button>
          <button type="button" aria-pressed={ch === 'email'} onClick={() => { setCh(ch === 'email' ? null : 'email'); setTo(sale.email || ''); setMsg(null); }} className="h-11 rounded-full text-[14px] font-semibold" style={{ background: ch === 'email' ? 'var(--accent)' : 'var(--soft)', color: ch === 'email' ? 'var(--accent-ink)' : undefined }}>Email</button>
        </div>
        {ch && <div className="flex gap-2"><input value={to} onChange={(e) => setTo(e.target.value)} type={ch === 'email' ? 'email' : 'tel'} inputMode={ch === 'email' ? 'email' : 'tel'} autoComplete={ch === 'email' ? 'email' : 'tel'} placeholder={ch === 'email' ? 'Their email' : 'Their mobile'} aria-label={ch === 'email' ? 'Email for the receipt' : 'Mobile for the receipt'} className="h-11 min-w-0 flex-1 rounded-xl px-3.5 text-[16px] outline-none" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }} />
          <button type="button" onClick={send} disabled={busy || !to.trim()} className={btn} style={{ background: 'var(--accent)', color: 'var(--accent-ink)', height: 44 }}>{busy ? 'Sending…' : 'Send'}</button></div>}
        {msg && <p className="text-[13px] font-semibold">{msg}</p>}
      </section>}
      {hadVisit && sale.clientId && sale.serviceId && onBookOnScreen && <button type="button" onClick={onBookOnScreen} className={btn} style={{ background: 'color-mix(in srgb, var(--accent) 12%, var(--soft))' }}>Book their next visit on {screenName || 'the client screen'}</button>}
      {hadVisit && sale.clientId && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('cf:resume-callback', { detail: { fromCheckout: true, snapshotKind: 'staff_book_sheet', snapshot: { clientId: sale.clientId, serviceId: sale.serviceId || undefined } } }))}
        className={`${btn} w-full`} style={{ background: 'var(--soft)' }}>Book {first ? `${first}’s` : 'their'} next visit</button>}
      {(sale.warnings || []).map((w: string, i: number) => <p key={i} className="rounded-2xl p-3 text-[14px]" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>{w}</p>)}
      <div className="grid grid-cols-2 gap-2">
        {left !== null && <p className="col-span-2 text-center text-[13px]" style={{ color: 'var(--muted)' }} aria-live="polite">Back to the desk in {left}s · <button type="button" onClick={() => setLeft(null)} className="font-semibold underline underline-offset-4">Stay</button></p>}
        <button type="button" onClick={onNewSale} className={btn} style={{ background: 'var(--soft)' }}>New sale</button>
        <button type="button" onClick={() => { onNewSale(); onDone?.(); }} className={btn} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Done</button>
      </div>
    </div>
  );
}
