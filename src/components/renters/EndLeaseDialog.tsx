'use client';
// components/renters/EndLeaseDialog.tsx — ONE END LEASE, EVERYWHERE. Ending a renter's lease from Spaces, Renters or
// their own page goes through this one dialog: what happens (the space is freed; they're marked past unless they rent
// another space), what's still to settle (their deposit, anything owed), the move-out statement to print, and End
// lease. It writes through lib/booth-rental-service endLease, as every page did, and notes it in the audit log.
import * as React from 'react';
import { collection, doc, setDoc } from 'firebase/firestore';
import { endLease } from '@/lib/booth-rental-service';
import { auditEntry } from '@/lib/audit';
import { PrintLink } from '@/components/shared/PrintLink';

const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#ececee] bg-white px-4 text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7] disabled:opacity-40';
const red = 'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#b42318] px-4 text-[15px] font-semibold text-white disabled:opacity-40';
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function EndLeaseDialog({ tenantId, firestore, renter, leases, owedCents, depositsByLease, onClose, onEnded }: {
  tenantId: string; firestore: any; renter: any;
  /** Every lease, to find theirs and the ones they keep. */
  leases: any[];
  /** What they owe now and the deposit still held on each lease, when known, so what's left to settle can be said. */
  owedCents?: number; depositsByLease?: Record<string, number>;
  onClose: () => void; onEnded?: (said: string) => void;
}) {
  const OCC = ['active', 'on_leave', 'pending_signature'];
  const mine = leases.filter((l) => l.renterId === renter?.id && OCC.includes(String(l.status)));
  const [leaseId, setLeaseId] = React.useState<string>(mine[0]?.id || '');
  const lease = mine.find((l) => l.id === leaseId) || null;
  const others = mine.filter((l) => l.id !== leaseId);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const name = `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || 'this renter';
  const titleId = React.useId();
  React.useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [busy, onClose]);
  // Focus starts on the safe choice, and goes back where it was when the dialog closes.
  const keepRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => { const was = document.activeElement as HTMLElement | null; keepRef.current?.focus(); return () => { try { was?.focus(); } catch { /* gone */ } }; }, []);

  const end = async () => {
    if (!lease || busy) return;
    setBusy(true); setErr('');
    try {
      await endLease(firestore, tenantId, lease, renter.id, leases);
      try {
        const aRef = doc(collection(firestore, 'tenants', tenantId, 'auditLogs'));
        await setDoc(aRef, { id: aRef.id, ...auditEntry({ action: 'booth.lease_ended', targetType: 'lease', targetId: lease.id, summary: `Lease ended: ${name}`, amount: (Number(lease.rentAmountCents) || 0) / 100, actor: { type: 'user' } } as any) });
      } catch { /* the lease is ended either way */ }
      onEnded?.(`${name}’s lease is ended.`);
      onClose();
    } catch {
      setErr('The lease wasn’t ended. It’s still running. Try again.');
    } finally { setBusy(false); }
  };

  const settle: string[] = [];
  const held = lease && depositsByLease ? depositsByLease[lease.id] : undefined;
  if ((held || 0) > 0) settle.push(`Their deposit: ${money(held!)} held. Return it, or keep part with a reason for each deduction, from their Money tab.`);
  else if (lease?.deposit?.amountCents > 0 && held === undefined) settle.push('Their deposit, if one was paid: return it, or keep part with a reason for each deduction, from their Money tab.');
  if ((owedCents || 0) > 0) settle.push(`What they owe: ${money(owedCents!)}. Ending the lease doesn’t clear it.`);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md space-y-4 rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="text-[19px] font-bold leading-7 text-[#16171a]">End {name}’s lease?</h2>
        {mine.length > 1 && (
          <label className="block">
            <span className="text-[13px] font-medium text-[#16171a]">Which lease</span>
            <select value={leaseId} onChange={(e) => setLeaseId(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]">
              {mine.map((l) => <option key={l.id} value={l.id}>{l.boothName || 'Space'}{l.status === 'pending_signature' ? ' (not signed yet)' : ''}</option>)}
            </select>
          </label>
        )}
        {!lease ? <p className="text-[15px] text-[#6d7075]">They don’t have a lease running.</p> : (
          <>
            <p className="text-[15px] leading-relaxed text-[#16171a]">It ends today and the space is free for someone else. This can’t be undone.{lease.status === 'pending_signature' ? ' The lease waiting in their portal is taken back, so it can’t be signed later.' : ''}</p>
            <p className="text-[14px] leading-relaxed text-[#6d7075]">{others.length ? `They still rent ${others.length === 1 ? 'another space' : `${others.length} other spaces`}, so they stay a current renter and keep taking bookings.` : 'They’re marked as moved out and stop taking bookings, so clients can’t book someone who has left. A new lease later turns it all back on.'}</p>
            {settle.length > 0 && (
              <div className="space-y-1 rounded-xl bg-[#f5f5f7] p-3">
                <p className="text-[13px] font-semibold text-[#b45309]">Still to settle</p>
                {settle.map((t) => <p key={t} className="text-[14px] leading-snug text-[#16171a]">{t}</p>)}
              </div>
            )}
            <PrintLink path="/api/booths/account-statement" params={{ tenantId, renterId: renter.id, mode: 'final' }} className={`${btn} w-full justify-between`}>
              <span>Print the move-out statement</span><span aria-hidden className="text-[#6d7075]">↗</span>
            </PrintLink>
          </>
        )}
        {err && <p role="alert" className="text-[14px] text-[#b45309]">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" ref={keepRef} className={btn} onClick={onClose} disabled={busy}>Keep the lease</button>
          {lease && <button type="button" className={red} onClick={end} disabled={busy}>{busy ? 'Ending…' : 'End lease'}</button>}
        </div>
      </div>
    </div>
  );
}
