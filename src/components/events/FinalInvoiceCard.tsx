'use client';
// src/components/events/FinalInvoiceCard.tsx — THE FINAL INVOICE on the event sheet, for managers (design canvas "Event
// sheet and final invoice"; lib/event-invoice, api/event-invoice). After the event: the guests who came and the price
// for each one beyond those guaranteed, the bar tab, anything else; the total, what's been paid and the balance. Saved,
// sent to the client by email with a link to pay by card, or marked paid another way.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import type { InvoiceIn, InvoiceView, Payment } from '@/lib/event-invoice';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed', RED = '#b42318';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const input = `h-11 w-full rounded-xl border bg-[#fff] px-3 text-[15px] tabular-nums ${RING}`;
type Data = { invoice: InvoiceIn; saved: boolean; status: string; overpaidCents?: number; sentAt: string | null; sentTo: string | null; paidAt: string | null; payments: Payment[]; view: InvoiceView; checkedIn: number; suggestEach: number | null; clientEmail: string | null; cardOn: boolean };
type Form = { came: string; each: string; bar: string; extras: { name: string; amount: string }[] };

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dollars = (c: number | null) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));
const toCents = (s: string): number | null | undefined => { const t = s.replace(/[$,\s]/g, ''); if (!t) return null; if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined; return Math.round(Number(t) * 100); };
async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/event-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
const formOf = (i: InvoiceIn): Form => ({ came: i.came === null ? '' : String(i.came), each: dollars(i.eachCents), bar: i.barCents ? dollars(i.barCents) : '', extras: i.extras.map((x) => ({ name: x.name, amount: dollars(x.cents) })) });

export default function FinalInvoiceCard({ tenantId, eventId, guaranteed, quotedCents, paidBeforeCents }: { tenantId: string; eventId: string; guaranteed: number | null; quotedCents: number; paidBeforeCents: number }) {
  const [d, setD] = React.useState<Data | null>(null); const [f, setF] = React.useState<Form | null>(null);
  const [err, setErr] = React.useState(''); const [note, setNote] = React.useState(''); const [busy, setBusy] = React.useState<string | null>(null);
  const [paidHow, setPaidHow] = React.useState<'cash' | 'check' | 'other' | null>(null);

  const take = (r: any) => { if (r.ok) { setD(r.invoice); setF(formOf(r.invoice.invoice)); setErr(''); return true; } setErr(r.error || 'That didn’t go through. Try again.'); return false; };
  React.useEffect(() => { void post({ tenantId, eventId, action: 'view' }).then(take); }, [tenantId, eventId]);
  if (!d || !f) return err ? <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p> : null;

  // The invoice as it stands in the form (worked out again on the server when it's saved).
  const parsed = (() => {
    const came = f.came.trim() ? Number(f.came) : null; const each = toCents(f.each); const bar = toCents(f.bar);
    const extras = f.extras.map((x) => ({ name: x.name.trim(), cents: toCents(x.amount) }));
    const okNums = (came === null || (Number.isInteger(came) && came >= 0)) && each !== undefined && bar !== undefined && extras.every((x) => x.cents !== undefined && (!!x.name || !x.cents));
    if (!okNums) return null;
    return { came, eachCents: each ?? null, barCents: bar ?? 0, extras: extras.filter((x) => x.name && x.cents !== null).map((x) => ({ name: x.name, cents: x.cents as number })) } as InvoiceIn;
  })();
  const extraGuests = parsed?.came !== null && parsed?.came !== undefined && guaranteed ? Math.max(0, parsed.came - guaranteed) : 0;
  const lines: { label: string; cents: number }[] = [];
  if (quotedCents > 0) lines.push({ label: 'As quoted', cents: quotedCents });
  if (parsed && extraGuests && parsed.eachCents) lines.push({ label: `${extraGuests} more ${extraGuests === 1 ? 'guest' : 'guests'}`, cents: extraGuests * parsed.eachCents });
  if (parsed?.barCents) lines.push({ label: 'Bar tab', cents: parsed.barCents });
  for (const x of parsed?.extras || []) lines.push({ label: x.name, cents: x.cents });
  const total = lines.reduce((a, l) => a + l.cents, 0);
  const paid = paidBeforeCents + d.payments.reduce((a, p) => a + Math.max(0, p.cents - (p.refundedCents || 0)), 0);
  const balance = Math.max(0, total - paid);
  const isPaid = d.status === 'paid';

  const save = async () => { if (!parsed) { setErr('Check the amounts: dollars and cents, like 105 or 105.50.'); return false; } setBusy('save'); const r = await post({ tenantId, eventId, action: 'save', invoice: parsed }); setBusy(null); if (take(r)) { setNote('Saved.'); return true; } return false; };
  const send = async () => { setNote(''); if (!(await save())) return; setBusy('send'); const r = await post({ tenantId, eventId, action: 'send' }); setBusy(null); if (take(r)) setNote(`Sent to ${r.invoice.sentTo || 'the client'}.`); };
  const markPaid = async () => { if (!paidHow) return; setBusy('paid'); const r = await post({ tenantId, eventId, action: 'mark_paid', how: paidHow }); setBusy(null); if (take(r)) { setPaidHow(null); setNote('Marked paid.'); } };
  const statusChip = isPaid ? { text: 'Paid', bg: GREEN_TINT, fg: GREEN } : d.status === 'sent' ? { text: 'Sent', bg: SOFT, fg: INK } : { text: 'Draft', bg: SOFT, fg: MUTED };

  return (
    <section aria-labelledby="fi-title" className="space-y-3 rounded-2xl border bg-[#fff] p-5 sm:p-6 print:hidden" style={{ borderColor: LINE, color: INK }}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="fi-title" className="text-[17px] font-semibold">Final invoice</h2>
        <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: statusChip.bg, color: statusChip.fg }}>{statusChip.text}</span>
      </div>
      {!!d.overpaidCents && <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>The client paid {money(d.overpaidCents)} more than was owed. Refund {money(d.overpaidCents)} to their card in Stripe.</p>}
      {d.sentAt && !isPaid && <p className="text-[13px]" style={{ color: MUTED }}>Sent to {d.sentTo} on {new Date(d.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Changes show on the client’s link.</p>}

      <fieldset disabled={isPaid} className="space-y-3">
        <div>
          <p className="text-[14px] font-semibold">Extra guests</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <label className="block"><span className="text-[12.5px]" style={{ color: MUTED }}>Came</span><input id="fi-came" inputMode="numeric" value={f.came} onChange={(e) => setF({ ...f, came: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })} className={input} style={{ borderColor: LINE }} /></label>
            <label className="block"><span className="text-[12.5px]" style={{ color: MUTED }}>Price each extra</span><input id="fi-each" inputMode="decimal" value={f.each} onChange={(e) => setF({ ...f, each: e.target.value })} placeholder="0.00" className={input} style={{ borderColor: LINE }} /></label>
          </div>
          <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>{guaranteed ? `${guaranteed} guaranteed` : 'No guest count on the event'}{d.checkedIn ? `, ${d.checkedIn} checked in` : ''}.{extraGuests ? ` ${extraGuests} extra${parsed?.eachCents ? `, ${money(extraGuests * parsed.eachCents)}` : ''}.` : ''}{d.suggestEach && !d.saved ? ` The price each starts from the quote, per guest.` : ''}</p>
        </div>
        <label className="block"><span className="text-[14px] font-semibold">Bar tab</span><input id="fi-bar" inputMode="decimal" value={f.bar} onChange={(e) => setF({ ...f, bar: e.target.value })} placeholder="0.00" className={`${input} mt-1.5`} style={{ borderColor: LINE }} /></label>
        <div>
          <p className="text-[14px] font-semibold">Anything else</p>
          {f.extras.map((x, i) => (
            <div key={i} className="mt-1.5 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_110px_auto]">
              <label className="sr-only" htmlFor={`fi-x-${i}`}>What it is</label>
              <input id={`fi-x-${i}`} value={x.name} maxLength={60} onChange={(e) => setF({ ...f, extras: f.extras.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} placeholder="Late finish, one hour" className={`${input} col-span-2 sm:col-span-1`} style={{ borderColor: LINE }} />
              <label className="sr-only" htmlFor={`fi-xa-${i}`}>Amount</label>
              <input id={`fi-xa-${i}`} inputMode="decimal" value={x.amount} onChange={(e) => setF({ ...f, extras: f.extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)) })} placeholder="0.00" className={input} style={{ borderColor: LINE }} />
              <button type="button" onClick={() => setF({ ...f, extras: f.extras.filter((_, j) => j !== i) })} className={`${btn} px-3`} style={{ color: RED }} aria-label={`Remove ${x.name || 'this line'}`}>Remove</button>
            </div>))}
          {f.extras.length < 10 && <button type="button" onClick={() => setF({ ...f, extras: [...f.extras, { name: '', amount: '' }] })} className={`${btn} mt-1 px-0 underline underline-offset-4`}>Add a line</button>}
        </div>
      </fieldset>

      <dl className="space-y-1 border-t pt-3" style={{ borderColor: LINE }}>
        {lines.map((l, i) => <div key={i} className="flex justify-between gap-3 text-[14.5px]"><dt>{l.label}</dt><dd className="tabular-nums">{money(l.cents)}</dd></div>)}
        <div className="flex justify-between gap-3 text-[14.5px]"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
        {paid > 0 && <div className="flex justify-between gap-3 text-[14.5px]"><dt>Paid so far</dt><dd className="tabular-nums">−{money(paid)}</dd></div>}
        <div className="flex justify-between gap-3 text-[16px] font-semibold"><dt>{isPaid ? 'Paid in full' : 'Balance due'}</dt><dd className="tabular-nums">{money(balance)}</dd></div>
      </dl>

      {!isPaid && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={send} disabled={!!busy || !d.clientEmail || !d.cardOn || balance <= 0} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{busy === 'send' ? 'Sending' : d.status === 'sent' ? 'Send again' : 'Send to the client'}</button>
            <button type="button" onClick={() => void save()} disabled={!!busy} className={btn} style={{ border: `1px solid ${LINE}` }}>{busy === 'save' ? 'Saving' : 'Save'}</button>
          </div>
          <p className="text-[13px]" style={{ color: MUTED }}>{!d.clientEmail ? 'Add the client’s email on the event to send it.' : !d.cardOn ? 'Turn on card payments in Settings to send a link to pay.' : `They get an email with the invoice and a link to pay it by card.`}</p>
          {balance > 0 && (paidHow === null
            ? <button type="button" onClick={() => setPaidHow('cash')} className={`${btn} px-0 underline underline-offset-4`}>Paid another way?</button>
            : <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Paid how">
                {(['cash', 'check', 'other'] as const).map((h) => <button key={h} type="button" aria-pressed={paidHow === h} onClick={() => setPaidHow(h)} className={btn} style={paidHow === h ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}` }}>{h === 'cash' ? 'Cash' : h === 'check' ? 'Check' : 'Other'}</button>)}
                <button type="button" onClick={markPaid} disabled={!!busy} className={btn} style={{ background: GREEN, color: '#fff' }}>{busy === 'paid' ? 'Marking' : `Mark ${money(balance)} paid`}</button>
                <button type="button" onClick={() => setPaidHow(null)} className={btn} style={{ color: MUTED }}>Cancel</button>
              </div>)}
        </div>
      )}
      {note && <p role="status" className="text-[13.5px]" style={{ color: GREEN }}>{note}</p>}
      {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
    </section>
  );
}
