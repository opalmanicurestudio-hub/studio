'use client';
// src/components/pos/desk/DeskCancel.tsx — CANCEL / NO-SHOW, in the desk's design.
//
// Same policy maths as the planner dialog (useCancelDialog: your fee rules, the
// cost-recovery amount, the deposit on file, the audit record), plus:
//   · the outcome shown BEFORE confirming, in the words the client will read
//   · the deposit counts toward the fee when your deposit policy keeps it
//   · the card is charged NOW (a decline falls back to what they owe — once)
//   · changing or waiving a fee is a manager's call, with a reason
//   · ONE message to the client from the server (the background function is
//     told not to charge or message again)
//   · "Move instead?" and, afterwards, "offer this slot to the waitlist"

import { hoursToDeadline } from '@/lib/change-rules';
import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { getAuth } from 'firebase/auth';
import { useCancelDialog, CLIENT_REASON_OPTIONS, STUDIO_REASON_OPTIONS } from '@/components/planner/CancelAppointmentDialog';
import { resolveDepositPolicy } from '@/lib/deposit-policy';
import { resolvePolicy } from '@/lib/booking-policies';
import { cancellationOutcomeLines, planCancellation, type CancelOutcome } from '@/lib/policy-copy';
import { logAuditClient } from '@/lib/audit-client';
import { Drawer, Btn, Seg, Pill } from './kit';

const toDate = (v: any): Date | null => { if (!v) return null; try { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : typeof v === 'string' ? parseISO(v) : new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; } };
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
async function staffPost(url: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); return { status: r.status, ...(d || {}) };
}

export function DeskCancel({ e, accent, onReschedule, onOfferSlot }: { e: any; accent?: string | null; onReschedule?: (a: any) => void; onOfferSlot?: () => void }) {
  const appt = e.isCancelDialogOpen ? e.selectedAppointment : null;
  const isMgr = ['owner', 'admin', 'manager'].includes(String(e.role || '').toLowerCase()) || e.selectedTenant?.userId === e.currentUser?.uid;
  const currentStaff = (e.staff || []).find((s: any) => s.id === e.currentUser?.uid) || null;
  const [collect, setCollect] = useState<'card' | 'balance'>('card');
  const [waiveWhy, setWaiveWhy] = useState(''); const [tell, setTell] = useState(true);
  const [done, setDone] = useState<{ lines: string[]; told: boolean } | null>(null); const [err, setErr] = useState('');
  const [snap, setSnap] = useState<any>(null); // outcome computed at confirm time
  const doneRef = useRef(false); // the shared logic closes the dialog after saving — keep the summary open
  const close = () => { doneRef.current = false; e.setIsCancelDialogOpen(false); setDone(null); setErr(''); setWaiveWhy(''); };

  // The desk's own confirm: charge / notify around the POS's cancellation save.
  const onConfirm = async (data: any) => {
    const o = snap as { outcome: CancelOutcome; due: number } | null;
    if (!o || !appt) return;
    let intentId: string | null = null; let collected: CancelOutcome['collected'] = o.outcome.collected;
    let paymentMethod = data.paymentMethod as 'card_on_file' | 'add_to_balance' | 'waived';
    if (o.outcome.who !== 'studio' && o.due > 0 && collected === 'card') {
      const r = await staffPost('/api/stripe/charge-card', { tenantId: e.tenantId, clientId: appt.clientId, amountCents: Math.round(o.due * 100),
        description: `${o.outcome.who === 'no_show' ? 'Missed-appointment' : 'Late-cancellation'} fee`, category: o.outcome.who === 'no_show' ? 'No-Show Fees' : 'Cancellation Fees',
        appointmentId: appt.id, reason: data.reason, mode: 'auto', kind: 'deposit' /* fails cleanly — we add it to the balance once, below */ });
      if (r.ok && r.paymentIntentId) { intentId = r.paymentIntentId; paymentMethod = 'card_on_file'; }
      else { collected = 'balance'; paymentMethod = 'add_to_balance'; setErr(`The card didn’t go through (${r.reason || r.error || 'declined'}) — ${money(o.due)} was added to what they owe.`); }
    }
    const outcome: CancelOutcome = { ...o.outcome, collected };
    await e.handleCancellationConfirm({ ...data, feeAmount: o.outcome.who === 'studio' ? 0 : o.due, chargeFee: o.outcome.who !== 'studio' && o.due > 0 && collected !== 'waived',
      paymentMethod: collected === 'waived' ? 'waived' : paymentMethod, alreadyChargedPaymentIntentId: intentId, notifiedByServer: tell });
    if (collected === 'waived' && Number(o.outcome.feeDollars) > 0) logAuditClient(e.firestore, e.tenantId, { action: 'fee.waived', targetType: 'appointment', targetId: appt.id, amount: Number(o.outcome.feeDollars),
      summary: `${money(Number(o.outcome.feeDollars))} ${o.outcome.who === 'no_show' ? 'no-show' : 'cancellation'} fee waived — ${waiveWhy.trim()}`, actor: { type: 'user', id: e.currentUser?.uid || null, name: e.currentUser?.displayName || currentStaff?.name || 'Manager', role: e.role || 'manager', via: 'front desk' } } as any).catch(() => {});
    let told = false;
    if (tell) { const n = await staffPost('/api/appointments/cancel-notify', { tenantId: e.tenantId, appointmentId: appt.id, outcome }); told = !!(n.told?.email || n.told?.sms); }
    doneRef.current = true; setDone({ lines: cancellationOutcomeLines(outcome), told });
  };
  const r: any = useCancelDialog({ open: !!appt, onOpenChange: (o: boolean) => { if (!o && !doneRef.current) close(); }, appointment: appt || ({} as any), tenant: e.selectedTenant, currentStaff, onConfirm } as any);

  // ── The outcome, from your policy (what will happen, before anything does) ──
  const who: CancelOutcome['who'] = r.actorType === 'no_show' ? 'no_show' : r.actorType === 'studio' ? 'studio' : 'client';
  const start = toDate(appt?.startTime);
  const hrsLeft = start ? (start.getTime() - Date.now()) / 3600000 : 0;          // shown ("5 hours away")
  const hrsToDeadline = appt?.startTime ? hoursToDeadline(e.selectedTenant, appt) : 0;  // decides late/early
  const dp = resolveDepositPolicy(e.selectedTenant);
  const depDollars = r.hasDeposit ? Number(r.depositDollars) || 0 : 0;
  const policyFee = who === 'studio' ? 0 : (who === 'no_show' ? Number(r.finalFeeAmount) || 0 : Number(r.suggestedFeeTotal) || 0);
  const card = r.client?.cardOnFile;
  const plan = useMemo(() => planCancellation({ who, feeDollars: Number(r.finalFeeAmount) || 0, policyFeeDollars: policyFee, chargeFee: !!r.chargeFee,
    depositDollars: r.hasDeposit ? Number(r.depositDollars) || 0 : 0, hoursUntilStart: hrsToDeadline, depositPolicy: dp,
    studioDisposition: r.depositDisposition, collectPref: collect, hasCard: !!r.hasCardOnFile, cardLast4: card?.last4 || null, goodwillDollars: Number(r.additionalCreditValue) || 0,
    lateConsequence: resolvePolicy(e.selectedTenant).cancel.lateConsequence.value }),
  [who, r.finalFeeAmount, policyFee, r.chargeFee, r.hasDeposit, r.depositDollars, Math.round(hrsToDeadline), r.depositDisposition, collect, r.hasCardOnFile, card?.last4, r.additionalCreditValue]); // eslint-disable-line react-hooks/exhaustive-deps
  const { outcome, due, applied, waived, fee } = plan;
  useEffect(() => { setSnap({ outcome, due }); }, [outcome, due]);
  useEffect(() => { if (appt) { setCollect(r.hasCardOnFile ? 'card' : 'balance'); setDone(null); setErr(''); setWaiveWhy(''); setTell(true); } }, [appt?.id, r.hasCardOnFile]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!appt) return <Drawer accent={accent} open={false} onClose={close} title="Cancel">{null}</Drawer>;

  const first = String(appt.clientName || r.client?.name || 'the client').split(' ')[0];
  const svcName = (e.services || []).find((s: any) => s.id === appt.serviceId)?.name || appt.serviceName || 'appointment';
  const provider = (e.staff || []).find((s: any) => s.id === appt.staffId);
  const Card = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) => <section className="space-y-2.5 rounded-3xl p-4" style={{ background: tone ? 'color-mix(in srgb, var(--warn) 8%, var(--card))' : 'var(--card)' }}>{children}</section>;
  const reasons = who === 'studio' ? STUDIO_REASON_OPTIONS : who === 'client' ? CLIENT_REASON_OPTIONS : [];
  const reasonVal = who === 'studio' ? r.studioReason : r.clientReason;
  const needWaiveWhy = waived && !waiveWhy.trim();
  const canConfirm = !r.isSubmitting && !(r.isOtherSelected && !String(r.customReason || '').trim()) && !needWaiveWhy;

  if (done) return (
    <Drawer accent={accent} open onClose={close} title={who === 'no_show' ? 'Marked as a no-show' : 'Cancelled'}>
      <div className="space-y-3">
        <Card><p className="text-[16px] font-semibold">{first} · {svcName}</p><p className="text-[13px]" style={{ color: 'var(--muted)' }}>{start ? format(start, 'EEE, MMM d · h:mm a') : ''}</p>
          <ul className="list-disc space-y-1 pl-5 text-[14px]">{done.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{tell ? (done.told ? `${first} has been told by email/text.` : `${first} has no email or phone on file — not told.`) : `${first} wasn’t messaged.`}</p></Card>
        {err && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
        {start && start.getTime() > Date.now() && onOfferSlot && <Card><p className="text-[14px] font-semibold">This time is free now</p><p className="text-[13px]" style={{ color: 'var(--muted)' }}>{format(start, 'EEE h:mm a')}{provider ? ` with ${String(provider.name).split(' ')[0]}` : ''} — someone on your waitlist may want it.</p>
          <Btn quiet onClick={() => { close(); onOfferSlot(); }}>Offer it to the waitlist</Btn></Card>}
        <Btn big className="w-full" onClick={close}>Done</Btn>
      </div>
    </Drawer>
  );

  return (
    <Drawer accent={accent} open onClose={close} title={who === 'no_show' ? `No-show — ${first}` : `Cancel ${first}’s appointment`}>
      <div className="space-y-3">
        <Card><p className="text-[16px] font-semibold">{svcName}{provider ? ` with ${String(provider.name).split(' ')[0]}` : ''}</p>
          <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{start ? format(start, 'EEE, MMM d · h:mm a') : ''}{start ? ` · ${hrsLeft > 0 ? `${hrsLeft >= 48 ? `${Math.round(hrsLeft / 24)} days` : `${Math.max(0, Math.round(hrsLeft))} hours`} away` : 'already started'}` : ''}</p>
          {onReschedule && who !== 'no_show' && <div className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'var(--soft)' }}><span className="text-[13px]">Could they come another time instead?</span><Btn quiet onClick={() => { close(); onReschedule(appt); }}>Move instead</Btn></div>}
        </Card>

        <Card><p className="text-[14px] font-semibold">What happened?</p>
          <Seg label="Who" value={r.actorType} onChange={(v: any) => r.setActorType(v)} options={[['client', 'They cancelled'], ['no_show', 'No-show'], ['studio', 'We cancelled']] as any} />
          {reasons.length > 0 && <div className="flex flex-wrap gap-1.5">{reasons.map((o: any) => <Btn key={o.value} quiet={reasonVal !== o.value} onClick={() => (who === 'studio' ? r.setStudioReason(o.value) : r.setClientReason(o.value))}>{o.label}</Btn>)}</div>}
          {r.isOtherSelected && <input value={r.customReason} onChange={(ev) => r.setCustomReason(ev.target.value)} placeholder="What happened?" className="h-11 w-full rounded-xl px-3 text-[14px] outline-none" style={{ background: 'var(--soft)' }} />}
        </Card>

        {who !== 'studio' && (policyFee > 0 || fee > 0) && <Card tone={due > 0 ? 'warn' : undefined}><p className="text-[14px] font-semibold">Your policy</p>
          <p className="text-[14px]">{who === 'no_show' ? 'Missed-appointment fee' : hrsToDeadline >= Number(e.selectedTenant?.cancellationWindowHours || 24) ? 'Enough notice — ' : 'Inside your notice window — '}<b>{money(waived ? policyFee : fee)}</b>{!waived && who === 'client' && r.isFeeOverridden ? <Pill tone="warn">changed from {money(Number(r.suggestedFeeTotal) || 0)}</Pill> : null}</p>
          {applied > 0 && <p className="text-[14px]">Their {money(depDollars)} deposit is kept under your policy, so it counts toward this — <b>{due > 0 ? `${money(due)} left to collect` : 'fully covered'}</b>.</p>}
          {isMgr ? <div className="space-y-2">
            {who === 'client' && r.chargeFee && <label className="flex items-center gap-2 text-[13px]"><span style={{ color: 'var(--muted)' }}>Fee</span><input type="number" min={0} step="0.01" value={r.feeValue} onChange={(ev) => r.setFeeValue(Number(ev.target.value) || 0)} className="h-9 w-28 rounded-full px-3 text-[14px]" style={{ background: 'var(--soft)' }} /></label>}
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={!r.chargeFee} onChange={(ev) => r.setChargeFee(!ev.target.checked)} /> Waive it this time</label>
            {waived && <input value={waiveWhy} onChange={(ev) => setWaiveWhy(ev.target.value)} placeholder="Reason for waiving (required)" className="h-11 w-full rounded-xl px-3 text-[14px] outline-none" style={{ background: 'var(--soft)' }} />}
          </div> : <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Only a manager can change or waive this.</p>}
          {due > 0 && <div className="space-y-1.5"><p className="text-[13px] font-semibold">Collect {money(due)}</p>
            <div className="flex flex-wrap gap-1.5">{r.hasCardOnFile && <Btn quiet={collect !== 'card'} onClick={() => setCollect('card')}>Charge {card?.brand || 'card'} •••• {card?.last4 || ''} now</Btn>}<Btn quiet={collect !== 'balance'} onClick={() => setCollect('balance')}>Add to what they owe</Btn></div>
            {collect === 'card' && r.hasCardOnFile && <p className="text-[12px]" style={{ color: 'var(--muted)' }}>If the card is declined, it’s added to what they owe instead.</p>}</div>}
        </Card>}

        {who === 'studio' && depDollars > 0 && <Card><p className="text-[14px] font-semibold">Their {money(depDollars)} deposit</p>
          <div className="flex flex-wrap gap-1.5"><Btn quiet={r.depositDisposition !== 'refund'} onClick={() => r.setDepositDisposition('refund')}>Refund to their card</Btn><Btn quiet={r.depositDisposition !== 'store_credit'} onClick={() => r.setDepositDisposition('store_credit')}>Save as credit</Btn></div>
          {r.depositDisposition === 'store_credit' && <label className="flex items-center gap-2 text-[13px]"><span style={{ color: 'var(--muted)' }}>Plus a little extra to say sorry</span><input type="number" min={0} step="1" value={r.additionalCreditValue} onChange={(ev) => r.setAdditionalCreditValue(Number(ev.target.value) || 0)} className="h-9 w-24 rounded-full px-3 text-[14px]" style={{ background: 'var(--soft)' }} /></label>}</Card>}

        <Card><div className="flex items-center justify-between gap-2"><p className="text-[14px] font-semibold">What {first} will be told</p><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={tell} onChange={(ev) => setTell(ev.target.checked)} /> Send</label></div>
          {tell ? <ul className="list-disc space-y-1 pl-5 text-[14px]">{cancellationOutcomeLines(outcome).map((l) => <li key={l}>{l}</li>)}<li>A “Book again” button for their {svcName}.</li></ul>
            : <p className="text-[13px]" style={{ color: 'var(--muted)' }}>They won’t be messaged — tell them yourself.</p>}</Card>

        {err && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
        <div className="sticky bottom-0 -mx-5 px-5 pb-1 pt-3" style={{ background: 'var(--paper)' }}>
          <Btn big className="w-full" disabled={!canConfirm} onClick={async () => { setErr(''); try { await r.handleAction(); } catch (x: any) { setErr(x?.message || 'That didn’t save — please try again.'); } }}>
            {r.isSubmitting ? 'Working…' : who === 'no_show' ? `Mark as no-show${due > 0 ? ` · ${collect === 'card' && r.hasCardOnFile ? 'charge' : 'owe'} ${money(due)}` : ''}` : `Cancel appointment${due > 0 ? ` · ${collect === 'card' && r.hasCardOnFile ? 'charge' : 'owe'} ${money(due)}` : ''}`}</Btn>
          {needWaiveWhy && <p className="mt-1 text-center text-[12px]" style={{ color: 'var(--warn)' }}>Add a reason for waiving the fee.</p>}
        </div>
      </div>
    </Drawer>
  );
}
