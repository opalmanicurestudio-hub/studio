'use client';
// components/renters/RentMoney.tsx — RENT AND DEPOSITS (the top of the Rent page). Owed now, collected this month,
// what's due in the next week and deposits held; then who owes what, bill by bill, with Waive and Record payment;
// deposits to settle or still to come in; rent coming up; what was paid this month; and former renters who still owe
// (or who were barred from booking until they paid), with Write off and the bar.
// Worked out by lib/rent-money from what the Rent page already has; the page does the writing (its Record payment,
// waivers, write-off and booking bar), so there is one of each. A waiver or write-off is read again as it's saved, and
// the panel stays open with what went wrong when it doesn't go through.
import * as React from 'react';
import Link from 'next/link';
import { PrintLink } from '@/components/shared/PrintLink';
import { RENTALS_BTN, RENTALS_BTN_DARK } from '@/components/renters/RentalsNav';
import type { rentMoney, OwedRow } from '@/lib/rent-money';

type Data = ReturnType<typeof rentMoney>;
type Tab = 'owed' | 'upcoming' | 'paid' | 'former';
type Waivable = { key: string; what: 'fee' | 'invoice' | 'charge'; id: string; label: string; cents: number };
const sub = 'text-[13px] leading-snug text-[#6d7075]';
const card = 'min-w-0 rounded-[20px] border border-[#ececee] bg-white px-5 pb-3 pt-4';
const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(Math.round(c)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const md = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const renterLink = (id: string, tab?: string) => `/renters/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`;
const short = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };

/** What can be waived for one renter: each late fee, each bill, each one-off charge. */
function waivables(o: OwedRow): Waivable[] {
  const out: Waivable[] = [];
  for (const b of o.bills) {
    if (b.feeCents > 0) out.push({ key: `fee:${b.id}`, what: 'fee', id: b.id, label: `The late fee on the ${short(b.dueDate)} rent`, cents: b.feeCents });
    out.push({ key: `invoice:${b.id}`, what: 'invoice', id: b.id, label: `The whole ${short(b.dueDate)} bill${b.feeCents > 0 ? ', fee included' : ''}`, cents: b.leftCents });
  }
  for (const c of o.charges) out.push({ key: `charge:${c.id}`, what: 'charge', id: c.id, label: c.text, cents: c.cents });
  return out;
}

export function RentMoney({ tenantId, data, busy, onRecordPayment, onWaive, onWriteOff, onPayLink, onAutopayNotTaken, onBar }: {
  tenantId: string; data: Data;
  /** A booking bar being saved: 'bar:<renterId>'. */
  busy: string;
  onRecordPayment: (renterId: string) => void;
  /** Waive a late fee, a bill or a one-off charge, by its id. True when it went through. */
  onWaive: (what: 'fee' | 'invoice' | 'charge', id: string, reason: string) => Promise<boolean>;
  /** Write off what a former renter still owes (the amount shown, so nothing is written if it changed). True when done. */
  onWriteOff: (renterId: string, reason: string, cents: number) => Promise<boolean>;
  /** Email them a link to pay what they owe; says what happened. */
  onPayLink: (renterId: string) => Promise<{ ok: boolean; said: string }>;
  onAutopayNotTaken: (inv: any) => void;
  onBar: (renterId: string, bar: boolean) => void;
}) {
  const [tab, setTab] = React.useState<Tab>('owed');
  const [panel, setPanel] = React.useState<{ renterId: string; mode: 'waive' | 'writeoff' } | null>(null);
  const [pick, setPick] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState('');
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const [linking, setLinking] = React.useState('');
  const [linkSaid, setLinkSaid] = React.useState<Record<string, { ok: boolean; said: string }>>({});
  const sentFor = React.useRef<Record<string, string>>({});
  const payLink = async (renterId: string) => {
    if (linking) return;
    setLinking(renterId);
    sentFor.current[renterId] = String(data.owed.concat(data.former).find((o) => o.renterId === renterId)?.totalCents ?? '');
    try { const r = await onPayLink(renterId); setLinkSaid((m) => ({ ...m, [renterId]: r })); }
    catch { setLinkSaid((m) => ({ ...m, [renterId]: { ok: false, said: 'That didn’t go out. Try again.' } })); }
    finally { setLinking(''); }
  };
  const tabs = ([
    { id: 'owed', label: 'Owed and deposits' },
    { id: 'upcoming', label: `Coming up${data.upcoming.length ? ` · ${data.upcoming.length}` : ''}` },
    { id: 'paid', label: `Paid${data.paid.length ? ` · ${data.paid.length}` : ''}` },
    { id: 'former', label: `Former renters${data.former.length ? ` · ${data.former.length}` : ''}` },
  ] as { id: Tab; label: string }[]).filter((t) => t.id !== 'former' || data.former.length > 0 || tab === 'former');
  // Arrow keys move between the tabs, Home and End to the first and last.
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === tab);
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); setTab(tabs[j].id); tabRefs.current[tabs[j].id]?.focus();
  };
  // A "Sent to…" line goes once what they owe changes (they paid, or more came due), so it never describes an old amount.
  const owedKey = data.owed.concat(data.former).map((o) => `${o.renterId}:${o.totalCents}`).join('|');
  React.useEffect(() => {
    const now = Object.fromEntries(data.owed.concat(data.former).map((o) => [o.renterId, String(o.totalCents)]));
    setLinkSaid((m) => { const k = Object.keys(m).filter((id) => now[id] === sentFor.current[id]); return k.length === Object.keys(m).length ? m : Object.fromEntries(k.map((id) => [id, m[id]])); });
  }, [owedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // A panel whose renter has left the list (paid up, written off) closes, so it can't reopen by itself later.
  React.useEffect(() => {
    if (panel && !data.owed.concat(data.former).some((o) => o.renterId === panel.renterId && (panel.mode === 'waive' ? waivables(o).length > 0 : o.totalCents > 0))) { setPanel(null); setErr(''); }
  }, [data, panel]);
  const open = (renterId: string, mode: 'waive' | 'writeoff', first = '') => { setPanel({ renterId, mode }); setPick(first); setReason(''); setErr(''); };
  const close = () => { if (!saving) { setPanel(null); setErr(''); } };
  const confirm = async (o: OwedRow) => {
    if (!panel || saving) return;
    const w = panel.mode === 'waive' ? waivables(o).find((x) => x.key === pick) : null;
    if (panel.mode === 'waive' && !w) { setErr('Pick what to waive.'); return; }
    setSaving(true); setErr('');
    try {
      const ok = panel.mode === 'waive' ? await onWaive(w!.what, w!.id, reason.trim()) : await onWriteOff(o.renterId, reason.trim(), o.totalCents);
      if (ok) setPanel(null);
      else setErr(panel.mode === 'waive' ? 'That wasn’t waived: it may have been paid or changed just now. Check the amounts and try again.' : 'That wasn’t written off: what they owe may have changed just now. Check the amount and try again.');
    } catch { setErr('That didn’t save. Try again.'); }
    finally { setSaving(false); }
  };

  const owedRow = (o: OwedRow, formerRow: boolean) => {
    const opts = waivables(o);
    const here = panel?.renterId === o.renterId ? panel : null;
    return (
      <li key={o.renterId} className="border-t border-[#ececee] py-3.5 first:border-t-0">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-[15px] font-semibold text-[#16171a]"><Link href={renterLink(o.renterId)} className="hover:underline">{o.name}</Link>{o.space && <span className="font-normal text-[#6d7075]"> · {o.space}</span>}</p>
            {o.bills.map((b, bi) => (
              <div key={b.id} className="mt-1">
                <p className={sub}>{b.text}{!formerRow && bi === 0 ? ` · ${o.autopay}` : ''}{b.late ? <span className="text-[#b45309]"> · late</span> : ''}</p>
                {b.autopayUnconfirmed && (
                  <div className="mt-1.5 space-y-2 rounded-xl bg-[#fff7ed] p-3">
                    <p className="text-[13px] leading-snug text-[#b45309]">Autopay tried this{b.autopayTriedAt ? ` on ${md(b.autopayTriedAt)}` : ''} but the card company didn’t answer, so it may have gone through. Check your Stripe payments. If it went through, record it with Record payment. If it didn’t, let them pay it.</p>
                    <button type="button" className={RENTALS_BTN} onClick={() => onAutopayNotTaken(b.inv)}>It didn’t go through: let them pay</button>
                  </div>
                )}
              </div>
            ))}
            {o.charges.map((c) => <p key={c.id} className={sub}>{c.text}, {money(c.cents)}</p>)}
            {o.totalCents === 0 && o.barred && <p className={sub}>Paid up. Still barred from booking.</p>}
            {o.totalCents > 0 && o.barred && <p className="text-[13px] leading-snug text-[#b45309]">Barred from booking until it’s cleared</p>}
          </div>
          {o.totalCents > 0 && <p className={`shrink-0 text-[17px] font-bold tabular-nums ${o.late ? 'text-[#b45309]' : 'text-[#16171a]'}`}>{money(o.totalCents)}</p>}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {opts.length > 0 && <button type="button" className={RENTALS_BTN} aria-expanded={here?.mode === 'waive'} onClick={() => (here?.mode === 'waive' ? close() : open(o.renterId, 'waive', opts.length === 1 ? opts[0].key : ''))}>Waive…</button>}
          {o.totalCents > 0 && <button type="button" className={RENTALS_BTN_DARK} onClick={() => onRecordPayment(o.renterId)}>Record payment</button>}
          {o.totalCents > 0 && <button type="button" className={RENTALS_BTN} disabled={linking === o.renterId} onClick={() => void payLink(o.renterId)}>{linking === o.renterId ? 'Sending…' : 'Email a pay link'}</button>}
          {formerRow && o.totalCents > 0 && <button type="button" className={RENTALS_BTN} aria-expanded={here?.mode === 'writeoff'} onClick={() => (here?.mode === 'writeoff' ? close() : open(o.renterId, 'writeoff'))}>Write off</button>}
          {formerRow && <button type="button" className={RENTALS_BTN} disabled={busy === `bar:${o.renterId}`} onClick={() => onBar(o.renterId, !o.barred)}>{o.barred ? 'Let them book again' : 'Bar from booking'}</button>}
          {formerRow && <Link href={renterLink(o.renterId, 'money')} className={RENTALS_BTN}>History and statement</Link>}
        </div>
        {linkSaid[o.renterId] && <p role="status" className={`mt-2 text-[13px] leading-snug ${linkSaid[o.renterId].ok ? 'text-[#1f7a4d]' : 'text-[#b45309]'}`}>{linkSaid[o.renterId].said}</p>}
        {here && (
          <div className="mt-3 space-y-2 rounded-xl bg-[#f5f5f7] p-3">
            {here.mode === 'waive' ? (
              <fieldset className="space-y-1">
                <legend className="pb-1 text-[14px] text-[#16171a]">What should {o.name} not have to pay?</legend>
                {opts.map((w) => (
                  <label key={w.key} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-white">
                    <input type="radio" name={`waive-${o.renterId}`} value={w.key} checked={pick === w.key} onChange={() => { setPick(w.key); setErr(''); }} className="h-5 w-5 accent-[#16171a]" />
                    <span className="min-w-0 flex-1 text-[14px] text-[#16171a]">{w.label}</span>
                    <span className="shrink-0 text-[14px] tabular-nums text-[#16171a]">{money(w.cents)}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="text-[14px] text-[#16171a]">Write off the {money(o.totalCents)} {o.name} still owes? Their open bills are closed and the amount stays on their record as written off. It doesn’t bar them from booking: that’s its own choice.</p>
            )}
            <label className="block">
              <span className="text-[13px] font-medium text-[#16171a]">Reason, for their record and statement</span>
              <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 160))} autoFocus={here.mode === 'writeoff' || opts.length === 1} className="mt-1 h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px]" />
            </label>
            {err && <p role="alert" className="text-[13px] leading-snug text-[#b45309]">{err}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={RENTALS_BTN_DARK} disabled={saving || (here.mode === 'waive' && !pick)} onClick={() => void confirm(o)}>
                {saving ? 'Saving…' : here.mode === 'waive' ? `Waive${pick ? ` ${money(opts.find((w) => w.key === pick)?.cents || 0)}` : ''}` : `Write off ${money(o.totalCents)}`}
              </button>
              <button type="button" className={RENTALS_BTN} disabled={saving} onClick={close}>Keep it</button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {data.kpis.map((k) => (
          <div key={k.key} className="min-w-0 rounded-[18px] border border-[#ececee] bg-white px-4 py-3.5">
            <p className={sub}>{k.label}</p>
            <p className={`text-[24px] font-bold leading-8 tabular-nums ${k.warn ? 'text-[#b45309]' : 'text-[#16171a]'}`}>{k.value}</p>
            <p className={sub}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Rent" onKeyDown={onTabKey} className="flex max-w-full gap-1 overflow-x-auto border-b border-[#ececee]">
        {tabs.map((t) => (
          <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} type="button" role="tab" id={`rm-${t.id}`} aria-selected={tab === t.id} aria-controls={`rmp-${t.id}`} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}
            className={`-mb-px min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-4 text-[15px] ${tab === t.id ? 'border-[#16171a] font-semibold text-[#16171a]' : 'border-transparent text-[#6d7075] hover:text-[#16171a]'}`}>{t.label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`rmp-${tab}`} aria-labelledby={`rm-${tab}`} tabIndex={0} className="focus:outline-none">
        {tab === 'owed' && (
          <div className="flex flex-wrap items-start gap-5">
            <section aria-labelledby="rm-owed-h" className={card} style={{ flex: '999 1 520px' }}>
              <h2 id="rm-owed-h" className="text-[17px] font-bold leading-6 text-[#16171a]">Owed {data.owed.length > 0 && <span className="font-medium text-[#6d7075]">· {data.owed.length}</span>}</h2>
              {data.owed.length === 0 ? <p className={`py-2 ${sub}`}>Nobody owes anything right now.</p> : <ul className="mt-1">{data.owed.map((o) => owedRow(o, false))}</ul>}
              {data.owed.length > 0 && <p className={`border-t border-[#ececee] py-3 ${sub}`}>Nothing else is owed.{data.paidUp ? ` ${data.paidUp === 1 ? 'One renter is' : `${data.paidUp} renters are`} paid up.` : ''}</p>}
              {data.owed.length === 0 && data.paidUp > 0 && <p className={`pb-2 ${sub}`}>{data.paidUp === 1 ? 'One renter is' : `${data.paidUp} renters are`} paid up.</p>}
            </section>
            <section aria-labelledby="rm-dep-h" className={card} style={{ flex: '1 1 320px' }}>
              <h2 id="rm-dep-h" className="text-[17px] font-bold leading-6 text-[#16171a]">Deposits</h2>
              {data.deposits.toSettle.length + data.deposits.unpaid.length > 0 && <ul className="mt-1">
                {[...data.deposits.toSettle, ...data.deposits.unpaid].map((d) => (
                  <li key={`${d.kind}-${d.leaseId}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[#ececee] py-3 first:border-t-0">
                    <div className="min-w-0 flex-1 basis-44">
                      <p className="text-[15px] font-semibold text-[#16171a]">{d.name} <span className="font-normal text-[#6d7075]">· {d.space}</span></p>
                      <p className={`text-[13px] leading-snug ${d.kind === 'settle' ? 'text-[#b45309]' : 'text-[#6d7075]'}`}>{d.text}</p>
                    </div>
                    <Link href={renterLink(d.renterId, 'money')} className={RENTALS_BTN}>{d.kind === 'settle' ? 'Settle it' : 'Record it'}</Link>
                  </li>
                ))}
              </ul>}
              {(() => {
                const listed = data.deposits.toSettle.length + data.deposits.unpaid.length > 0;
                const said = data.deposits.restHeld.count ? `${listed ? `${data.deposits.restHeld.count} more held` : `${data.deposits.restHeld.count} held`}, ${money(data.deposits.restHeld.cents)} in total, nothing to settle.` : listed ? '' : 'No deposits held.';
                return said ? <p className={`${listed ? 'border-t border-[#ececee] py-3' : 'py-2'} ${sub}`}>{said}</p> : null;
              })()}
              <p className={`pb-1 ${sub}`}>Every deduction needs a reason, and the renter gets the itemized list with what comes back. Refunds go back to their card or are recorded by hand, from their page.</p>
            </section>
          </div>
        )}

        {tab === 'upcoming' && (
          <section className={card}>
            {data.upcoming.length === 0 ? <p className={`py-2 ${sub}`}>No rent is due in the next seven days.</p> : (
              <ul>
                {data.upcoming.map((u) => (
                  <li key={`${u.leaseId}|${u.date}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[#ececee] py-3 first:border-t-0">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-[15px] font-semibold text-[#16171a]"><Link href={renterLink(u.renterId)} className="hover:underline">{u.name}</Link> <span className="font-normal text-[#6d7075]">· {u.space}</span></p>
                      <p className={sub}>{md(u.date)} · <span className={u.warn ? 'text-[#b45309]' : ''}>{u.how}</span></p>
                    </div>
                    <p className="text-[15px] font-semibold tabular-nums text-[#16171a]">{money(u.cents)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'paid' && (
          <section className={card}>
            {data.paid.length === 0 ? <p className={`py-2 ${sub}`}>Nothing paid yet this month.</p> : (
              <ul>
                {data.paid.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[#ececee] py-3 first:border-t-0">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-[15px] font-semibold text-[#16171a]"><Link href={renterLink(p.renterId)} className="hover:underline">{p.name}</Link></p>
                      <p className={sub}>{md(p.date)} · {p.how}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className={`text-[15px] font-semibold tabular-nums ${p.refund ? 'text-[#6d7075]' : 'text-[#16171a]'}`}>{money(p.cents)}</p>
                      {p.receiptId && <PrintLink path="/api/booths/account-statement" params={{ tenantId, renterId: p.renterId, receipt: p.receiptId }} className={RENTALS_BTN}>Receipt</PrintLink>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'former' && (
          <section className={card}>
            <p className={`pb-1 ${sub}`}>No lease and nothing more coming due. Collect it, waive or write it off, or bar them from booking until it’s cleared.</p>
            {data.former.length === 0 ? <p className={`py-2 ${sub}`}>No former renter owes anything.</p> : <ul>{data.former.map((o) => owedRow(o, true))}</ul>}
          </section>
        )}
      </div>
    </div>
  );
}
