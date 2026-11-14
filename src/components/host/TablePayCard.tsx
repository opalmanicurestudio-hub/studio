'use client';
// src/components/host/TablePayCard.tsx — PAY AT THE TABLE, the server's side (design canvas TablePayStaff), in a table's
// tab: the check's own code for the guests to scan (by seat, by item or evenly, with their own tip, on their own phone),
// what's paid so far and by what, what someone is paying right now, and what's left. The rest can be taken in cash.
// Once it's all paid, "Close the check" records the sale (api/checkout/complete 'table_close'), the same as the desk
// finishing a split bill. While anything's been paid here, the table is finished here, not at the desk (so nobody pays
// twice). Reads api/tab 'pay_status'; only when the business has pay at the table on.
import * as React from 'react';
import QRCode from 'qrcode';
import { getAuth } from 'firebase/auth';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309';
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const btn = 'min-h-[48px] w-full rounded-full px-4 text-[15px] font-semibold disabled:opacity-40';

async function call(body: any, path = '/api/tab'): Promise<any> {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
type Status = { url: string; why: string | null; closed: boolean; total: number; paid: number; left: number; full: boolean;
  shares: { label: string; amount: number; tip: number; how: string; at: string | null }[]; paying: { label: string; amount: number }[];
  stuck?: { label: string; amount: number; piId: string | null }[] };

export function TablePayCard({ tenantId, visitId, table, poke, onPaid }: { tenantId: string; visitId: string; table: string; poke?: unknown; onPaid?: (paid: number, full: boolean) => void }) {
  const [s, setS] = React.useState<Status | null>(null); const [qr, setQr] = React.useState(''); const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState(''); const [cash, setCash] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await call({ tenantId, action: 'pay_status', visitId });
    if (r.ok) { setS(r); onPaid?.(Number(r.paid) || 0, !!r.full); } else setErr(r.error || 'The check couldn’t be read.');
  }, [tenantId, visitId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load(); const i = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10000); return () => clearInterval(i); }, [load, poke]);
  React.useEffect(() => { if (s?.url) QRCode.toDataURL(s.url, { width: 360, margin: 1 }).then(setQr).catch(() => setQr('')); }, [s?.url]);

  const takeCash = async () => {
    setBusy('cash'); setErr(''); setMsg('');
    const r = await call({ tenantId, action: 'pay_cash', visitId });
    setBusy(null); setCash(false);
    if (!r.ok) { setErr(r.error || 'That didn’t go through.'); return; }
    setMsg(`${money(r.left)} in cash is on the check.`); void load();
  };
  const close = async () => {
    setBusy('close'); setErr(''); setMsg('');
    const r = await call({ tenantId, action: 'table_close', visitId }, '/api/checkout/complete');
    setBusy(null);
    if (!r.ok) { setErr(r.error || 'The check couldn’t be closed.'); void load(); return; }
    setMsg(r.already ? 'This check was closed already.' : `Closed. The sale is recorded${r.total ? `: ${money(r.total)}` : ''}.`);
    if (Array.isArray(r.warnings) && r.warnings.length) setErr(r.warnings.slice(0, 3).join(' '));
    void load();
  };

  if (!s) return err ? <p className="text-[14px]" role="alert" style={{ color: AMBER }}>{err}</p> : null;
  const pct = s.total > 0 ? Math.min(100, Math.round((s.paid / s.total) * 100)) : 0;
  return (
    <section aria-label="Pay at the table" className="space-y-3 rounded-3xl bg-[#fff] p-4" style={{ border: `1px solid ${LINE}` }}>
      <div className="flex items-baseline justify-between gap-3"><h3 className="text-[16px] font-semibold">Pay at the table</h3><span className="text-[13px]" style={{ color: MUTED }}>{table}</span></div>
      {s.closed ? <>
        <p className="text-[14.5px]" style={{ color: GREEN }}>{msg || 'This check is closed.'}</p>
        {err && <p role="alert" className="text-[14px] font-medium" style={{ color: AMBER }}>{err}</p>}</> : <>
        {s.full ? null : s.why ? <p className="text-[14px]" style={{ color: MUTED }}>{s.why}</p>
          : show && qr ? (
            <div className="flex flex-wrap items-center gap-4">
              <img src={qr} alt={`Code to pay the ${table} check`} width={168} height={168} className="rounded-2xl" style={{ border: `1px solid ${LINE}` }} />
              <div className="min-w-[160px] flex-1 space-y-1">
                <p className="text-[15px] font-semibold">They scan this to pay</p>
                <p className="text-[13.5px] leading-snug" style={{ color: MUTED }}>By seat, by item or evenly, with their own tip. Each payment shows here as it’s made.</p>
                <button type="button" onClick={() => setShow(false)} className="min-h-[44px] text-[14px] font-semibold underline underline-offset-4">Hide the code</button>
              </div>
            </div>)
          : <button type="button" onClick={() => setShow(true)} className={btn} style={{ background: SOFT, color: INK }}>Show the code to pay</button>}
        <div className="flex items-baseline justify-between gap-3 pt-1"><span className="text-[15px] font-semibold">Paid so far</span>
          <span className="text-[19px] font-semibold tabular-nums">{money(s.paid)} <span className="text-[14px] font-medium" style={{ color: MUTED }}>of {money(s.total)}</span></span></div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: LINE }} aria-hidden><i className="block h-full" style={{ width: `${pct}%`, background: GREEN }} /></div>
        {s.shares.map((x, i) => (
          <div key={i} className="flex min-h-[48px] items-center gap-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="flex-1"><span className="block text-[15px] font-semibold">{x.label}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{x.how === 'cash' ? 'Cash' : x.how === 'phone' ? 'On their phone' : 'By card'}{x.tip > 0 ? `, ${money(x.tip)} tip` : ''}</span></span>
            <span className="text-[15px] font-semibold tabular-nums">{money(x.amount)}</span></div>))}
        {s.paying.map((x, i) => (
          <div key={`p${i}`} className="flex min-h-[48px] items-center gap-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="flex-1 text-[15px]" style={{ color: MUTED }}>{x.label}, paying now</span><span className="text-[15px] tabular-nums" style={{ color: MUTED }}>{money(x.amount)}</span></div>))}
        {(s.stuck || []).map((x, i) => (
          <p key={`x${i}`} role="alert" className="py-2 text-[14px] font-medium leading-snug" style={{ color: AMBER, borderTop: `1px solid ${LINE}` }}>{x.label}: {money(x.amount)} went through on their phone but couldn’t go on the check. Ask a manager before taking anything else for it{x.piId ? ` (payment ${x.piId})` : ''}.</p>))}
        {s.left > 0 && <div className="flex min-h-[44px] items-center justify-between gap-3" style={{ borderTop: `1px solid ${LINE}` }}><span className="text-[15px]" style={{ color: MUTED }}>Left to pay</span><span className="text-[15px] font-semibold tabular-nums">{money(s.left)}</span></div>}
        {msg && <p role="status" className="text-[14px] font-medium" style={{ color: GREEN }}>{msg}</p>}
        {err && <p role="alert" className="text-[14px] font-medium" style={{ color: AMBER }}>{err}</p>}
        {s.left > 0 && !s.why && (cash
          ? <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}>
              <p className="text-[14.5px] font-medium">Take {money(s.left)} in cash for the rest of the check?</p>
              <div className="flex gap-2"><button type="button" disabled={busy === 'cash'} onClick={takeCash} className={btn} style={{ background: INK, color: '#fff' }}>Yes, {money(s.left)} in cash</button>
                <button type="button" onClick={() => setCash(false)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Not yet</button></div></div>
          : <button type="button" disabled={s.paying.length > 0} onClick={() => setCash(true)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>They paid the rest in cash</button>)}
        {s.paid > 0 && <button type="button" disabled={!s.full || busy === 'close'} onClick={close} className={btn} style={{ background: INK, color: '#fff' }}>{busy === 'close' ? 'Closing…' : s.full ? 'Close the check' : 'Close the check once it’s all paid'}</button>}
      </>}
    </section>
  );
}
