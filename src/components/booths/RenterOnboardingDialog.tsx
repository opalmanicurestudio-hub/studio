'use client';

// src/components/booths/RenterOnboardingDialog.tsx
//
// Renter onboarding, built on the shared e-sign engine (the same one staff
// onboarding uses). Walks an approved renter through signing their booth
// lease and the studio house rules, records the security deposit, then flips
// the lease to 'active'. Each signature is stored as an immutable record in
// tenants/{tid}/signedDocuments.
//
// Open it from the renter/lease detail once a lease exists (it starts life as
// 'pending_signature'); finishing here is what makes it 'active'.

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ESignAgreement } from '@/components/shared/ESignAgreement';
import { AGREEMENT_TEMPLATES, fillTemplate, saveSignedDocument, DEFAULT_INCIDENTALS_SCHEDULE } from '@/lib/esign';
import { doc, setDoc, collection } from 'firebase/firestore';
import { CheckCircle2, PartyPopper } from 'lucide-react';

interface Lease {
  id: string;
  boothName?: string;
  rentAmountCents?: number;
  frequency?: string;              // monthly | weekly | daily | hourly
  securityDepositCents?: number;
  startDate?: string;
}

interface RenterOnboardingDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  firestore: any;
  tenantId: string;
  studioName: string;
  renterName: string;
  renterId?: string | null;
  lease: Lease;
  incidentalsSchedule?: string;   // the studio's capped charge list, shown in the lease
  onComplete?: () => void;
}

type Step = 'lease' | 'house_rules' | 'deposit' | 'done';

const PERIOD: Record<string, string> = { monthly: 'month', weekly: 'week', daily: 'day', hourly: 'hour' };
const money = (c?: number) => `$${(((c || 0) / 100)).toFixed(2)}`;

export function RenterOnboardingDialog({
  open, onOpenChange, firestore, tenantId, studioName, renterName, renterId, lease, incidentalsSchedule, onComplete,
}: RenterOnboardingDialogProps) {
  const [step, setStep] = useState<Step>('lease');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ lease?: string; houseRules?: string }>({});
  const depositCents = lease.securityDepositCents || 0;
  const [depositCollected, setDepositCollected] = useState(depositCents > 0);
  const [depositAmt, setDepositAmt] = useState((depositCents / 100).toFixed(2));

  const vars = {
    date: (() => { try { return new Date().toLocaleDateString('en-US', { dateStyle: 'long' } as any); } catch { return ''; } })(),
    studioName,
    signerName: renterName,
    boothName: lease.boothName || 'the space',
    startDate: lease.startDate || 'the agreed date',
    rentAmount: money(lease.rentAmountCents),
    rentPeriod: PERIOD[String(lease.frequency)] || 'period',
    deposit: money(depositCents),
    incidentalsSchedule: incidentalsSchedule || DEFAULT_INCIDENTALS_SCHEDULE,
  };
  const leaseText = fillTemplate(AGREEMENT_TEMPLATES.lease.body, vars);
  const houseRulesText = fillTemplate(AGREEMENT_TEMPLATES.house_rules.body, vars);

  const reset = () => { setStep('lease'); setBusy(false); setError(null); setSigned({}); };

  const signLease = async (signedName: string) => {
    setBusy(true); setError(null);
    try {
      const rec = await saveSignedDocument(firestore, tenantId, {
        subjectType: 'renter', subjectId: renterId || lease.id, subjectName: renterName,
        kind: 'lease', title: AGREEMENT_TEMPLATES.lease.title, agreementText: leaseText,
        meta: { leaseId: lease.id, boothName: lease.boothName || null },
      }, signedName);
      setSigned(s => ({ ...s, lease: rec.id }));
      setStep('house_rules');
    } catch { setError('Could not save the signature. Please try again.'); }
    finally { setBusy(false); }
  };

  const signHouseRules = async (signedName: string) => {
    setBusy(true); setError(null);
    try {
      const rec = await saveSignedDocument(firestore, tenantId, {
        subjectType: 'renter', subjectId: renterId || lease.id, subjectName: renterName,
        kind: 'house_rules', title: AGREEMENT_TEMPLATES.house_rules.title, agreementText: houseRulesText,
        meta: { leaseId: lease.id },
      }, signedName);
      setSigned(s => ({ ...s, houseRules: rec.id }));
      setStep(depositCents > 0 ? 'deposit' : 'done');
      if (depositCents <= 0) await finalize(rec.id, false);
    } catch { setError('Could not save the signature. Please try again.'); }
    finally { setBusy(false); }
  };

  const finalize = async (houseRulesId?: string, collected?: boolean) => {
    setBusy(true); setError(null);
    try {
      const nowIso = new Date().toISOString();
      const cents = Math.round((parseFloat(depositAmt) || 0) * 100);
      await setDoc(doc(firestore, 'tenants', tenantId, 'leases', lease.id), {
        status: 'active',
        signedLeaseId: signed.lease || null,
        signedHouseRulesId: houseRulesId || signed.houseRules || null,
        securityDepositCents: depositCents > 0 ? (cents || depositCents) : 0,
        securityDepositCollected: !!collected,
        securityDepositCollectedAt: collected ? nowIso : null,
        onboarding: { status: 'complete', completedAt: nowIso },
        onboardingComplete: true,
      }, { merge: true });
      // A held deposit is a refundable liability, not revenue — recorded on the
      // lease above and logged here for the audit trail (not the income ledger).
      if (collected && (cents || depositCents) > 0) {
        const logRef = doc(collection(firestore, `tenants/${tenantId}/depositLog`));
        await setDoc(logRef, {
          id: logRef.id, leaseId: lease.id, renterId: renterId || null, renterName,
          amountCents: cents || depositCents, status: 'held', at: nowIso,
        });
      }
      setStep('done');
      onComplete?.();
    } catch { setError('Could not finalize onboarding. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-lg rounded-[2rem] border-2 shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-3 border-b bg-muted/5 text-left">
          <DialogTitle className="text-xl font-black uppercase tracking-tighter">Onboard {renterName}</DialogTitle>
          <DialogDescription className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            {step === 'lease' ? `Step 1 · ${AGREEMENT_TEMPLATES.lease.title}`
              : step === 'house_rules' ? 'Step 2 · House Rules'
              : step === 'deposit' ? 'Step 3 · Security Deposit'
              : 'Complete'}
          </DialogDescription>
          <div className="mt-3 flex gap-1.5">
            {['lease', 'house_rules', ...(depositCents > 0 ? ['deposit'] : [])].map((s, i) => {
              const order = ['lease', 'house_rules', 'deposit'];
              const active = step === 'done' || order.indexOf(step) >= order.indexOf(s);
              return <div key={s} className={`h-1.5 rounded-full transition-all ${active ? 'bg-primary w-8' : 'bg-muted w-4'}`} />;
            })}
          </div>
        </DialogHeader>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-xl border-2 border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] font-bold text-destructive">{error}</div>
          )}

          {step === 'lease' && (
            <ESignAgreement
              title={AGREEMENT_TEMPLATES.lease.title}
              agreementText={leaseText}
              signerName={renterName}
              busy={busy}
              submitLabel="Sign & Continue"
              onSign={signLease}
              onCancel={() => onOpenChange(false)}
            />
          )}

          {step === 'house_rules' && (
            <ESignAgreement
              title={AGREEMENT_TEMPLATES.house_rules.title}
              agreementText={houseRulesText}
              signerName={renterName}
              busy={busy}
              submitLabel={depositCents > 0 ? 'Sign & Continue' : 'Sign & Finish'}
              onSign={signHouseRules}
            />
          )}

          {step === 'deposit' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-slate-900">Security deposit</h3>
                <p className="text-[12px] font-medium text-muted-foreground mt-1">Record the refundable deposit for {lease.boothName || 'this space'}. It's held as a liability, not counted as income.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black">$</span>
                <Input value={depositAmt} onChange={e => setDepositAmt(e.target.value)} inputMode="decimal" className="h-12 rounded-2xl border-2 font-black text-lg w-32" />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => { setDepositCollected(true); finalize(undefined, true); }} disabled={busy} className="flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-[11px]">
                  {busy ? '…' : `Collected — Activate`}
                </Button>
                <Button onClick={() => finalize(undefined, false)} disabled={busy} variant="outline" className="h-12 px-4 rounded-2xl font-black uppercase tracking-widest text-[10px] border-2">
                  Waive / later
                </Button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="py-8 flex flex-col items-center text-center gap-4">
              <span className="h-16 w-16 rounded-3xl bg-emerald-500/10 flex items-center justify-center"><PartyPopper className="h-8 w-8 text-emerald-600" /></span>
              <div className="space-y-1">
                <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">{renterName} is onboarded</h3>
                <p className="text-[12px] font-medium text-muted-foreground max-w-xs">The lease is signed and active. Rent invoicing runs on schedule, and their card-on-file covers incidentals.</p>
              </div>
              <div className="w-full space-y-1.5 pt-2">
                {[AGREEMENT_TEMPLATES.lease.title, AGREEMENT_TEMPLATES.house_rules.title, ...(depositCents > 0 && depositCollected ? [`Security deposit ${money(depositCents)} held`] : [])].map(t => (
                  <div key={t} className="flex items-center gap-2 text-[11px] font-bold text-slate-600"><CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> {t}</div>
                ))}
              </div>
              <Button onClick={() => { onOpenChange(false); reset(); }} className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] mt-2">Done</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default RenterOnboardingDialog;
