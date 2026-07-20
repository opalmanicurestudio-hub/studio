'use client';

// src/components/staff/StaffOnboardingDialog.tsx
//
// New-hire onboarding, built on the shared e-sign core. Walks a staff member
// through signing their work agreement and the studio's house rules, records
// each as an immutable signed document (tenants/{tid}/signedDocuments), then
// stamps the staff record onboardingComplete so they're cleared to work.
//
// Open it from the Team page's provider card ("Onboard" / "Finish onboarding").

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ESignAgreement } from '@/components/shared/ESignAgreement';
import { AGREEMENT_TEMPLATES, fillTemplate, saveSignedDocument, type SignedDocumentKind } from '@/lib/esign';
import { doc, setDoc } from 'firebase/firestore';
import { CheckCircle2, PartyPopper } from 'lucide-react';

interface StaffOnboardingDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  firestore: any;
  tenantId: string;
  studioName: string;
  staffMember: any;   // { id, name, email, phone, role, payStructure }
  // Contractors sign a contractor agreement; W-2 hires an employment one.
  agreementKind?: 'contractor_agreement' | 'employment_agreement';
  onComplete?: () => void;
}

type Step = 'agreement' | 'house_rules' | 'done';

export function StaffOnboardingDialog({
  open, onOpenChange, firestore, tenantId, studioName, staffMember,
  agreementKind, onComplete,
}: StaffOnboardingDialogProps) {
  const [step, setStep] = useState<Step>('agreement');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIds, setSignedIds] = useState<{ agreement?: string; houseRules?: string }>({});

  const name = staffMember?.name || 'Team member';
  // Default: commission-only providers are typically contractors.
  const kind: SignedDocumentKind =
    agreementKind || (staffMember?.payStructure === 'hourly' ? 'employment_agreement' : 'contractor_agreement');

  const vars = {
    date: (() => { try { return new Date().toLocaleDateString('en-US', { dateStyle: 'long' } as any); } catch { return ''; } })(),
    studioName,
    signerName: name,
    role: staffMember?.role || 'Professional',
  };

  const agreementText = fillTemplate(AGREEMENT_TEMPLATES[kind].body, vars);
  const houseRulesText = fillTemplate(AGREEMENT_TEMPLATES.house_rules.body, vars);

  const reset = () => { setStep('agreement'); setBusy(false); setError(null); setSignedIds({}); };

  const signAgreement = async (signedName: string) => {
    if (!firestore || !tenantId) return;
    setBusy(true); setError(null);
    try {
      const rec = await saveSignedDocument(firestore, tenantId, {
        subjectType: 'staff', subjectId: staffMember?.id || null, subjectName: name,
        kind, title: AGREEMENT_TEMPLATES[kind].title, agreementText,
        meta: { role: vars.role },
      }, signedName);
      setSignedIds(s => ({ ...s, agreement: rec.id }));
      setStep('house_rules');
    } catch (e: any) {
      setError('Could not save the signature. Please try again.');
    } finally { setBusy(false); }
  };

  const signHouseRules = async (signedName: string) => {
    if (!firestore || !tenantId) return;
    setBusy(true); setError(null);
    try {
      const rec = await saveSignedDocument(firestore, tenantId, {
        subjectType: 'staff', subjectId: staffMember?.id || null, subjectName: name,
        kind: 'house_rules', title: AGREEMENT_TEMPLATES.house_rules.title, agreementText: houseRulesText,
      }, signedName);
      const now = new Date().toISOString();
      await setDoc(
        doc(firestore, 'tenants', tenantId, 'staff', staffMember.id),
        {
          onboarding: {
            status: 'complete',
            completedAt: now,
            agreementSignedId: signedIds.agreement || null,
            houseRulesSignedId: rec.id,
            agreementKind: kind,
          },
          onboardingComplete: true,
        },
        { merge: true },
      );
      setSignedIds(s => ({ ...s, houseRules: rec.id }));
      setStep('done');
      onComplete?.();
    } catch (e: any) {
      setError('Could not finalize onboarding. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-lg rounded-[2rem] border-2 shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-3 border-b bg-muted/5 text-left">
          <DialogTitle className="text-xl font-black uppercase tracking-tighter">Onboard {name}</DialogTitle>
          <DialogDescription className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            {step === 'agreement' ? `Step 1 of 2 · ${AGREEMENT_TEMPLATES[kind].title}`
              : step === 'house_rules' ? 'Step 2 of 2 · House Rules'
              : 'Complete'}
          </DialogDescription>
          {/* progress */}
          <div className="mt-3 flex gap-1.5">
            {['agreement', 'house_rules'].map((s, i) => (
              <div key={s} className={`h-1.5 rounded-full transition-all ${
                (step === 'done') || (step === 'house_rules' && i === 0) || step === s ? 'bg-primary w-8' : 'bg-muted w-4'
              }`} />
            ))}
          </div>
        </DialogHeader>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-xl border-2 border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] font-bold text-destructive">
              {error}
            </div>
          )}

          {step === 'agreement' && (
            <ESignAgreement
              title={AGREEMENT_TEMPLATES[kind].title}
              agreementText={agreementText}
              signerName={name}
              busy={busy}
              submitLabel="Sign & Continue"
              onSign={signAgreement}
              onCancel={() => onOpenChange(false)}
            />
          )}

          {step === 'house_rules' && (
            <ESignAgreement
              title={AGREEMENT_TEMPLATES.house_rules.title}
              agreementText={houseRulesText}
              signerName={name}
              busy={busy}
              submitLabel="Sign & Finish"
              onSign={signHouseRules}
            />
          )}

          {step === 'done' && (
            <div className="py-8 flex flex-col items-center text-center gap-4">
              <span className="h-16 w-16 rounded-3xl bg-emerald-500/10 flex items-center justify-center">
                <PartyPopper className="h-8 w-8 text-emerald-600" />
              </span>
              <div className="space-y-1">
                <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">{name} is onboarded</h3>
                <p className="text-[12px] font-medium text-muted-foreground max-w-xs">
                  Both documents are signed and stored. They're cleared to be scheduled and to work.
                </p>
              </div>
              <div className="w-full space-y-1.5 pt-2">
                {[AGREEMENT_TEMPLATES[kind].title, AGREEMENT_TEMPLATES.house_rules.title].map(t => (
                  <div key={t} className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> {t} — signed
                  </div>
                ))}
              </div>
              <Button onClick={() => { onOpenChange(false); reset(); }} className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] mt-2">
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default StaffOnboardingDialog;
