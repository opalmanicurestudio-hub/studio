'use client';

// src/components/staff/StaffOnboardingDialog.tsx
//
// New-hire onboarding, built on the shared e-sign core. Walks a staff member
// through (1) confirming how they are CLASSIFIED, (2) signing the matching work
// agreement, and (3) signing the studio's house rules — recording each as an
// immutable signed document (tenants/{tid}/signedDocuments), then stamping the
// staff record onboardingComplete so they're cleared to work.
//
// Open it from the Team page's provider card ("Onboard" / "Finish onboarding").
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY STEP 1 EXISTS (read before you "simplify" this)
//
// This dialog used to pick the agreement like so:
//
//     staffMember?.payStructure === 'hourly' ? 'employment_agreement'
//                                            : 'contractor_agreement'
//
// payStructure answers "how do we calculate their pay" — its values are
// 'hourly' | 'commission' | 'hourly_plus_commission' | 'salary'. It does NOT
// answer "are they a W-2 employee or a 1099 contractor." Those are two
// different questions, and the old line silently assumed one answered the
// other. The result: everyone except pure-hourly staff — commission,
// hourly-plus-commission, AND salaried — was handed an Independent Contractor
// Agreement. Because payStructure defaults to 'commission' when a staff record
// is created, that was most of the team, including the owner's own record.
//
// That is a worker-misclassification document with the signer's name on it,
// and it directly contradicts the payroll draft, which already puts commission
// staff on W-2 payroll lines and runs employer payroll tax on their gross.
//
// So we ask. Once, per person, in plain language, and we store the answer on
// the staff record as `employmentType` — after which this step is skipped for
// that person forever. There was no employment-classification field anywhere
// in the app before this; `employmentType` is it.
//
// NOTE ON ALREADY-SIGNED BAD RECORDS: signedDocuments is append-only by
// security rule (allow update, delete: if false) and write-once by design.
// A wrong agreement CANNOT be deleted or edited. The only correct remedy is to
// have the person sign the right document now, so the record set shows the
// correction and its date. When that's the situation, this dialog says so
// out loud and stamps the new document with supersedesDocumentId pointing at
// the old one, so the audit trail explains itself years from now.
//
// This is not legal advice. Classification turns on the actual working
// relationship (who controls the work, the schedule, the tools, the pricing),
// not on what either party prefers. If a case is close, ask an accountant or
// employment attorney — a misclassification finding carries back taxes,
// penalties, and interest.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ESignAgreement } from '@/components/shared/ESignAgreement';
import { AGREEMENT_TEMPLATES, fillTemplate, saveSignedDocument, type SignedDocumentKind } from '@/lib/esign';
import { doc, setDoc } from 'firebase/firestore';
import { CheckCircle2, PartyPopper, Briefcase, UserCheck, AlertTriangle, Info, Check } from 'lucide-react';

type EmploymentType = 'w2_employee' | 'contractor';

interface StaffOnboardingDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  firestore: any;
  tenantId: string;
  studioName: string;
  // { id, name, email, phone, role, payStructure, employmentType?, onboarding? }
  staffMember: any;
  // Optional override. When supplied, the classification step is skipped and
  // this agreement is used as-is. Leave it off and the dialog will ask.
  agreementKind?: 'contractor_agreement' | 'employment_agreement';
  onComplete?: () => void;
}

type Step = 'classify' | 'agreement' | 'house_rules' | 'done';

// Human labels for payStructure, used in the classification explanation.
const PAY_LABEL: Record<string, string> = {
  hourly: 'Hourly wage',
  commission: 'Commission only',
  hourly_plus_commission: 'Hourly plus commission',
  salary: 'Salary',
};

// Pay structures that are strong evidence of EMPLOYMENT. A guaranteed hourly
// wage or a salary is very hard to square with independent-contractor status,
// so choosing "contractor" alongside one of these gets a warning.
const WAGE_LIKE = new Set(['hourly', 'salary', 'hourly_plus_commission']);

export function StaffOnboardingDialog({
  open, onOpenChange, firestore, tenantId, studioName, staffMember,
  agreementKind, onComplete,
}: StaffOnboardingDialogProps) {
  const name = staffMember?.name || 'Team member';
  const payStructure: string = staffMember?.payStructure || '';
  const priorKind: string | null = staffMember?.onboarding?.agreementKind || null;
  const priorAgreementId: string | null = staffMember?.onboarding?.agreementSignedId || null;

  // Anything already on the staff record wins, so nobody is asked twice.
  const savedType: EmploymentType | null =
    staffMember?.employmentType === 'w2_employee' || staffMember?.employmentType === 'contractor'
      ? staffMember.employmentType
      : null;

  // If the caller forced a kind, or we already know the type, skip step 1.
  const needsClassify = !agreementKind && !savedType;

  const [step, setStep] = useState<Step>(needsClassify ? 'classify' : 'agreement');
  const [choice, setChoice] = useState<EmploymentType | null>(savedType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIds, setSignedIds] = useState<{ agreement?: string; houseRules?: string }>({});

  // The effective classification driving everything downstream.
  const employmentType: EmploymentType | null = agreementKind
    ? (agreementKind === 'employment_agreement' ? 'w2_employee' : 'contractor')
    : choice;

  const kind: SignedDocumentKind =
    agreementKind || (employmentType === 'w2_employee' ? 'employment_agreement' : 'contractor_agreement');

  // True when this person previously signed a contractor agreement and is now
  // being classified as a W-2 employee. The old record can't be removed, so we
  // say so plainly and link the new document to it.
  const isCorrection = priorKind === 'contractor_agreement' && kind === 'employment_agreement';

  // Paying a wage or salary but signing a contractor agreement is the exact
  // combination that draws an audit. Flag it — but don't block it, because the
  // owner may have context we don't (e.g. a genuine flat-fee arrangement).
  const payConflict = employmentType === 'contractor' && WAGE_LIKE.has(payStructure);

  const vars = useMemo(() => ({
    date: (() => { try { return new Date().toLocaleDateString('en-US', { dateStyle: 'long' } as any); } catch { return ''; } })(),
    studioName,
    signerName: name,
    role: staffMember?.role || 'Professional',
  }), [studioName, name, staffMember?.role]);

  const agreementText = fillTemplate(AGREEMENT_TEMPLATES[kind].body, vars);
  const houseRulesText = fillTemplate(AGREEMENT_TEMPLATES.house_rules.body, vars);

  const totalSteps = needsClassify ? 3 : 2;
  const stepIndex = step === 'classify' ? 0 : step === 'agreement' ? (needsClassify ? 1 : 0) : (needsClassify ? 2 : 1);

  const reset = () => {
    setStep(needsClassify ? 'classify' : 'agreement');
    setChoice(savedType);
    setBusy(false); setError(null); setSignedIds({});
  };

  // Persist the classification before signing, so the answer survives even if
  // the signer walks away mid-agreement. Merge-write: touches nothing else.
  const confirmClassification = async () => {
    if (!choice) return;
    if (!firestore || !tenantId || !staffMember?.id) { setStep('agreement'); return; }
    setBusy(true); setError(null);
    try {
      await setDoc(
        doc(firestore, 'tenants', tenantId, 'staff', staffMember.id),
        {
          employmentType: choice,
          employmentTypeSetAt: new Date().toISOString(),
        },
        { merge: true },
      );
      setStep('agreement');
    } catch {
      setError('Could not save the classification. Please try again.');
    } finally { setBusy(false); }
  };

  const signAgreement = async (signedName: string) => {
    if (!firestore || !tenantId) return;
    setBusy(true); setError(null);
    try {
      const rec = await saveSignedDocument(firestore, tenantId, {
        subjectType: 'staff', subjectId: staffMember?.id || null, subjectName: name,
        kind, title: AGREEMENT_TEMPLATES[kind].title, agreementText,
        meta: {
          role: vars.role,
          // Recorded on the document itself so the record explains its own
          // reasoning without needing the staff doc alongside it.
          employmentType: employmentType || null,
          payStructure: payStructure || null,
          ...(isCorrection
            ? { supersedesDocumentId: priorAgreementId, supersedesKind: priorKind, correctsMisclassification: true }
            : {}),
        },
      }, signedName);
      setSignedIds(s => ({ ...s, agreement: rec.id }));
      setStep('house_rules');
    } catch {
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
          employmentType: employmentType || null,
          onboarding: {
            status: 'complete',
            completedAt: now,
            agreementSignedId: signedIds.agreement || null,
            houseRulesSignedId: rec.id,
            agreementKind: kind,
            employmentType: employmentType || null,
            ...(isCorrection
              ? { supersededAgreementId: priorAgreementId, supersededKind: priorKind }
              : {}),
          },
          onboardingComplete: true,
        },
        { merge: true },
      );
      setSignedIds(s => ({ ...s, houseRules: rec.id }));
      setStep('done');
      onComplete?.();
    } catch {
      setError('Could not finalize onboarding. Please try again.');
    } finally { setBusy(false); }
  };

  const headerLabel =
    step === 'classify' ? `Step 1 of ${totalSteps} · Classification`
      : step === 'agreement' ? `Step ${needsClassify ? 2 : 1} of ${totalSteps} · ${AGREEMENT_TEMPLATES[kind].title}`
      : step === 'house_rules' ? `Step ${needsClassify ? 3 : 2} of ${totalSteps} · House Rules`
      : 'Complete';

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-lg rounded-[2rem] border-2 shadow-2xl p-0 overflow-hidden max-h-[92vh] overflow-y-auto">
        <DialogHeader className="p-6 pb-3 border-b bg-muted/5 text-left">
          <DialogTitle className="text-xl font-black uppercase tracking-tighter">Onboard {name}</DialogTitle>
          <DialogDescription className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            {headerLabel}
          </DialogDescription>
          {/* progress */}
          <div className="mt-3 flex gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  step === 'done' || i < stepIndex ? 'bg-primary w-8'
                    : i === stepIndex ? 'bg-primary w-8'
                    : 'bg-muted w-4'
                }`}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-xl border-2 border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] font-bold text-destructive">
              {error}
            </div>
          )}

          {/* ── STEP 1: CLASSIFICATION ─────────────────────────────────────── */}
          {step === 'classify' && (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-slate-900 leading-tight">
                  How is {name.split(' ')[0]} classified?
                </h3>
                <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-muted-foreground">
                  This decides which agreement they sign. It is a separate question from how they're
                  paid{payStructure && PAY_LABEL[payStructure] ? `, which is set to ${PAY_LABEL[payStructure].toLowerCase()}` : ''}.
                  You'll only be asked once.
                </p>
              </div>

              <div className="flex flex-col gap-2.5">
                {([
                  {
                    id: 'w2_employee' as EmploymentType,
                    icon: UserCheck,
                    label: 'W-2 Employee',
                    blurb: 'You set their schedule, direct how the work is done, and withhold taxes from their pay. Commission-paid employees belong here.',
                    doc: 'Signs an Employment Agreement',
                  },
                  {
                    id: 'contractor' as EmploymentType,
                    icon: Briefcase,
                    label: '1099 Independent Contractor',
                    blurb: 'They run their own business, set their own hours and prices, bring their own tools, and handle their own taxes.',
                    doc: 'Signs an Independent Contractor Agreement',
                  },
                ]).map(opt => {
                  const active = choice === opt.id;
                  const Icon: React.ComponentType<{ className?: string }> = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setChoice(opt.id)}
                      aria-pressed={active}
                      className={`w-full text-left rounded-2xl border-2 p-4 transition-colors ${
                        active ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${
                          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-slate-500'
                        }`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-black uppercase tracking-tight text-slate-900">{opt.label}</span>
                            {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </div>
                          <p className="mt-1 text-[12px] font-medium leading-snug text-slate-600">{opt.blurb}</p>
                          <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{opt.doc}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Contradiction warning — pay says wage, choice says contractor. */}
              {payConflict && (
                <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-[12px] font-semibold leading-snug text-amber-900">
                      Their pay structure is set to {(PAY_LABEL[payStructure] || payStructure).toLowerCase()}.
                      Paying a guaranteed wage or salary is one of the strongest signs of employment, and it
                      sits badly next to a contractor agreement. Double-check this one before you continue.
                    </p>
                  </div>
                </div>
              )}

              {/* Correction notice — a bad record already exists. */}
              {isCorrection && (
                <div className="rounded-2xl border-2 border-slate-300 bg-slate-50 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    <p className="text-[12px] font-semibold leading-snug text-slate-700">
                      {name.split(' ')[0]} previously signed an Independent Contractor Agreement. Signed
                      documents are permanent and can't be deleted, so that record stays. Signing the
                      Employment Agreement now supersedes it, and the new document will reference the old
                      one by ID so the correction is on the record.
                    </p>
                  </div>
                </div>
              )}

              <p className="text-[11px] font-medium leading-relaxed text-muted-foreground">
                Classification depends on the real working relationship, not on preference. If this one is
                close, check with your accountant first — getting it wrong means back taxes and penalties.
              </p>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                  className="flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] text-slate-400"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={confirmClassification}
                  disabled={!choice || busy}
                  className="flex-[2] h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-lg shadow-primary/20"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 2: THE WORK AGREEMENT ─────────────────────────────────── */}
          {step === 'agreement' && (
            <div className="flex flex-col gap-4">
              {isCorrection && (
                <div className="rounded-2xl border-2 border-slate-300 bg-slate-50 px-3.5 py-3">
                  <p className="text-[11px] font-bold leading-snug text-slate-700">
                    This supersedes a previously signed Independent Contractor Agreement.
                  </p>
                </div>
              )}
              <ESignAgreement
                title={AGREEMENT_TEMPLATES[kind].title}
                agreementText={agreementText}
                signerName={name}
                busy={busy}
                submitLabel="Sign & Continue"
                onSign={signAgreement}
                onCancel={needsClassify ? () => setStep('classify') : () => onOpenChange(false)}
              />
            </div>
          )}

          {/* ── STEP 3: HOUSE RULES ───────────────────────────────────────── */}
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

          {/* ── DONE ──────────────────────────────────────────────────────── */}
          {step === 'done' && (
            <div className="py-6 flex flex-col items-center text-center gap-4">
              <span className="h-16 w-16 rounded-3xl bg-emerald-500/10 flex items-center justify-center">
                <PartyPopper className="h-8 w-8 text-emerald-600" />
              </span>
              <div className="space-y-1">
                <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">{name} is onboarded</h3>
                <p className="text-[12px] font-medium text-muted-foreground max-w-xs">
                  Both documents are signed and stored. They're cleared to be scheduled and to work.
                </p>
              </div>

              <div className="w-full space-y-1.5 pt-2 text-left">
                {[AGREEMENT_TEMPLATES[kind].title, AGREEMENT_TEMPLATES.house_rules.title].map(t => (
                  <div key={t} className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> {t} — signed
                  </div>
                ))}
              </div>

              {/* A W-2 hire needs federal paperwork this app does not collect.
                  Saying so is better than letting the owner assume onboarding
                  is legally finished. */}
              {employmentType === 'w2_employee' && (
                <div className="w-full rounded-2xl border-2 border-slate-300 bg-slate-50 p-3.5 text-left">
                  <div className="flex items-start gap-2.5">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Still needed for a W-2 hire</p>
                      <p className="mt-1 text-[12px] font-semibold leading-snug text-slate-700">
                        Form W-4 and Form I-9 are required for every employee. ClarityFlow doesn't collect
                        those yet — handle them outside the app and keep them in your own personnel file.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Button
                onClick={() => { onOpenChange(false); reset(); }}
                className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] mt-1"
              >
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
