'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle, Clock, CheckCircle2, XCircle, FileText,
  Upload, Shield, ChevronRight, Loader, ExternalLink,
  FileSignature, Receipt, User, Calendar, DollarSign,
  AlertCircle, Info, Check, ShieldCheck, FlaskConical,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking } from '@/firebase';
import { setDoc, doc, collection } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Dispute {
  id:                    string;
  stripeDisputeId:       string;
  stripeChargeId:        string;
  clientId?:             string;
  clientName:            string;
  amount:                number;
  currency:              string;
  reason:                string;
  status:                string;         // warning_needs_response | needs_response | under_review | won | lost | charge_refunded
  deadline?:             string;         // ISO — respond by this date
  evidenceSubmitted:     boolean;
  evidenceSubmittedAt?:  string;
  outcome?:              string;
  checkoutSessionId?:    string;
  consentFormUrls?:      string[];
  signatureUrls?:        string[];
  receiptUrl?:           string;
  appointmentId?:        string;
  stripeConnectedAccountId: string;
  createdAt:             string;
  tenantId:              string;
  notes?:                string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const REASON_LABELS: Record<string, string> = {
  'fraudulent':               'Fraudulent — client claims they didn\'t make this charge',
  'product_not_received':     'Service not received',
  'product_unacceptable':     'Service disputed as unacceptable',
  'credit_not_processed':     'Client claims refund not processed',
  'duplicate':                'Duplicate charge',
  'subscription_canceled':    'Subscription cancellation dispute',
  'unrecognized':             'Unrecognized charge',
  'general':                  'General dispute',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  'warning_needs_response': { label: 'Urgent — Respond Now',  color: '#dc2626', bg: '#fef2f2', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  'needs_response':         { label: 'Response Required',     color: '#d97706', bg: '#fffbeb', icon: <Clock className="w-3.5 h-3.5" /> },
  'under_review':           { label: 'Under Review',          color: '#2563eb', bg: '#eff6ff', icon: <Shield className="w-3.5 h-3.5" /> },
  'won':                    { label: 'Won',                   color: '#16a34a', bg: '#f0fdf4', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  'lost':                   { label: 'Lost',                  color: '#dc2626', bg: '#fef2f2', icon: <XCircle className="w-3.5 h-3.5" /> },
  'charge_refunded':        { label: 'Refunded',              color: '#6b7280', bg: '#f9fafb', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
};

function getDaysUntilDeadline(deadline?: string): number | null {
  if (!deadline) return null;
  return Math.ceil((safeDate(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ─── Evidence Builder Dialog ──────────────────────────────────────────────────
function EvidenceBuilderDialog({
  open, onOpenChange, dispute, tenantId, onSubmitted,
}: {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
  dispute:       Dispute;
  tenantId:      string;
  onSubmitted:   () => void;
}) {
  const { toast }         = useToast();
  const [step,            setStep]            = useState<'review' | 'submitting' | 'done'>('review');
  const [extraNotes,      setExtraNotes]      = useState(dispute.notes || '');
  const [uploadedFiles,   setUploadedFiles]   = useState<File[]>([]);
  const [isSubmitting,    setIsSubmitting]    = useState(false);

  const daysLeft = getDaysUntilDeadline(dispute.deadline);

  // Pre-built evidence text Stripe accepts
  const buildEvidenceText = () => {
    const lines = [
      `SERVICE DATE: ${dispute.createdAt ? format(safeDate(dispute.createdAt), 'MMMM d, yyyy') : 'On file'}`,
      `CLIENT NAME: ${dispute.clientName}`,
      `AMOUNT CHARGED: $${dispute.amount.toFixed(2)}`,
      `DISPUTE REASON: ${REASON_LABELS[dispute.reason] || dispute.reason}`,
      '',
      'SERVICE DOCUMENTATION:',
      'This charge represents professional nail services rendered at Opal Manicure Studio.',
      'Services were completed in full at the time of the appointment.',
      dispute.checkoutSessionId
        ? `Checkout session reference: ${dispute.checkoutSessionId}`
        : '',
      '',
      extraNotes ? `ADDITIONAL CONTEXT:\n${extraNotes}` : '',
    ].filter(Boolean).join('\n');

    return lines;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/stripe/submit-dispute-evidence', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tenantId,
          disputeId:             dispute.id,
          stripeDisputeId:       dispute.stripeDisputeId,
          stripeConnectedAccountId: dispute.stripeConnectedAccountId,
          evidenceText:          buildEvidenceText(),
          consentFormUrls:       dispute.consentFormUrls || [],
          signatureUrls:         dispute.signatureUrls   || [],
          receiptUrl:            dispute.receiptUrl,
          extraNotes,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Submission failed');

      setStep('done');
      toast({ title: 'Evidence Submitted', description: 'Stripe has received your dispute response.' });
      onSubmitted();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Submission Failed', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasConsent    = (dispute.consentFormUrls?.length || 0) > 0 || (dispute.signatureUrls?.length || 0) > 0;
  const hasReceipt    = !!dispute.receiptUrl;
  const hasAppointment= !!dispute.appointmentId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-[2rem] border-4 shadow-3xl p-0 overflow-hidden h-[90dvh] !flex flex-col !gap-0">
        <DialogHeader className="p-6 pb-4 border-b bg-muted/5 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black uppercase tracking-tighter text-slate-900 text-left">
                  Evidence Package
                </DialogTitle>
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mt-0.5">
                  {dispute.clientName} · ${dispute.amount.toFixed(2)}
                </p>
              </div>
            </div>
            {daysLeft !== null && daysLeft >= 0 && (
              <Badge className={cn(
                'font-black text-[10px] uppercase border-none',
                daysLeft <= 2 ? 'bg-red-100 text-red-700' : daysLeft <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
              )}>
                {daysLeft === 0 ? 'Due today' : `${daysLeft}d left`}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {step === 'done' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 gap-4 text-center">
            <div className="p-5 bg-green-100 rounded-full">
              <ShieldCheck className="w-12 h-12 text-green-600" />
            </div>
            <h3 className="text-xl font-black uppercase tracking-tight">Evidence Submitted</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Stripe has received your dispute response. You'll be notified of the outcome. Most disputes are resolved within 60-75 days.</p>
            <Button onClick={() => onOpenChange(false)} className="mt-4 h-12 px-8 rounded-2xl font-black uppercase tracking-widest">Done</Button>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-6 space-y-6">

              {/* Dispute reason */}
              <div className="p-4 rounded-2xl border-2 border-amber-200 bg-amber-50">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-1">Dispute Reason</p>
                <p className="text-sm font-bold text-amber-900">{REASON_LABELS[dispute.reason] || dispute.reason}</p>
              </div>

              {/* Evidence checklist */}
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Evidence Available</p>

                <EvidenceItem
                  icon={<FileSignature className="w-4 h-4" />}
                  label="Signed Consent Form"
                  available={hasConsent}
                  description={hasConsent
                    ? `${(dispute.consentFormUrls?.length || 0) + (dispute.signatureUrls?.length || 0)} document(s) attached`
                    : 'No consent form on file for this client — collect signatures at future appointments'}
                  tip={hasConsent ? 'This is your strongest evidence — a signed document is very hard to dispute.' : undefined}
                />

                <EvidenceItem
                  icon={<Receipt className="w-4 h-4" />}
                  label="Service Receipt"
                  available={hasReceipt}
                  description={hasReceipt ? 'Itemized receipt with timestamp and payment method' : 'Receipt not attached to this charge'}
                />

                <EvidenceItem
                  icon={<Calendar className="w-4 h-4" />}
                  label="Appointment Record"
                  available={hasAppointment}
                  description={hasAppointment ? 'Service date, staff, and duration on record' : 'Appointment record not linked'}
                />

                <EvidenceItem
                  icon={<User className="w-4 h-4" />}
                  label="Client History"
                  available={!!dispute.clientId}
                  description={dispute.clientId ? 'Prior service history demonstrates ongoing relationship' : 'Walk-in guest — no history on file'}
                />
              </div>

              {/* Stripe winning tips */}
              <div className="p-4 rounded-2xl bg-blue-50 border-2 border-blue-100 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" /> Tips to Win This Dispute
                </p>
                <ul className="space-y-1.5">
                  {[
                    dispute.reason === 'fraudulent'
                      ? 'For fraud disputes, a signed consent form with the date is near-conclusive evidence the card owner was present.'
                      : 'Describe the service rendered in specific detail — what was done, duration, and the result.',
                    'Attach as many documents as possible. Stripe considers the totality of evidence.',
                    'If you have any text messages or emails with the client about the appointment, note that.',
                    'Respond before the deadline — unreplied disputes are automatically lost.',
                  ].map((tip, i) => (
                    <li key={i} className="text-[11px] font-bold text-blue-800 flex items-start gap-2">
                      <Check className="w-3 h-3 text-blue-500 mt-0.5 shrink-0" /> {tip}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Additional notes */}
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Additional Context for Stripe
                </Label>
                <Textarea
                  value={extraNotes}
                  onChange={e => setExtraNotes(e.target.value)}
                  placeholder="Describe the service, any communication with the client, or anything that supports your case..."
                  className="rounded-2xl border-2 min-h-[100px] font-medium resize-none"
                />
                <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">
                  Be specific. Mention the service name, date, staff member, and what was completed.
                </p>
              </div>

              {/* Evidence preview */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Evidence Preview</p>
                <pre className="text-[10px] font-mono bg-slate-50 border-2 rounded-xl p-4 whitespace-pre-wrap text-slate-600">
                  {buildEvidenceText()}
                </pre>
              </div>
            </div>
          </ScrollArea>
        )}

        {step !== 'done' && (
          <DialogFooter className="p-6 pt-4 border-t flex-shrink-0 flex flex-col gap-3">
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full h-14 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20"
            >
              {isSubmitting
                ? <><Loader className="w-4 h-4 animate-spin mr-2" /> Submitting to Stripe...</>
                : <><Shield className="w-4 h-4 mr-2" /> Submit Evidence to Stripe</>}
            </Button>
            <p className="text-[9px] font-bold text-center text-muted-foreground uppercase tracking-widest opacity-60">
              Evidence cannot be changed after submission
            </p>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EvidenceItem({ icon, label, available, description, tip }: {
  icon:        React.ReactNode;
  label:       string;
  available:   boolean;
  description: string;
  tip?:        string;
}) {
  return (
    <div className={cn(
      'p-4 rounded-2xl border-2 flex items-start gap-3',
      available ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50 opacity-60'
    )}>
      <div className={cn('p-2 rounded-xl shrink-0', available ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-400')}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-black uppercase tracking-tight text-slate-900">{label}</p>
          {available
            ? <Badge className="bg-green-100 text-green-700 border-none font-black text-[8px] h-4 px-1.5">Attached</Badge>
            : <Badge className="bg-slate-100 text-slate-500 border-none font-black text-[8px] h-4 px-1.5">Missing</Badge>}
        </div>
        <p className="text-[10px] font-bold text-muted-foreground mt-0.5">{description}</p>
        {tip && <p className="text-[10px] font-bold text-green-700 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{tip}</p>}
      </div>
    </div>
  );
}

// ─── Dispute Card ─────────────────────────────────────────────────────────────
function DisputeCard({ dispute, onOpenEvidence }: { dispute: Dispute; onOpenEvidence: (d: Dispute) => void }) {
  const cfg      = STATUS_CONFIG[dispute.status] || STATUS_CONFIG['needs_response'];
  const daysLeft = getDaysUntilDeadline(dispute.deadline);
  const isOpen   = ['warning_needs_response', 'needs_response'].includes(dispute.status);
  const isUrgent = daysLeft !== null && daysLeft <= 3 && isOpen;

  return (
    <Card className={cn(
      'border-2 rounded-[1.5rem] overflow-hidden transition-all',
      isUrgent ? 'border-red-200 shadow-lg shadow-red-500/10' : 'border-border/50',
      isOpen    ? 'bg-white' : 'bg-muted/5 opacity-75'
    )}>
      <CardContent className="p-5 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-black text-sm uppercase tracking-tight text-slate-900">{dispute.clientName}</p>
              {isUrgent && (
                <Badge className="bg-red-100 text-red-700 border-none font-black text-[8px] uppercase animate-pulse">
                  {daysLeft === 0 ? 'Due today!' : `${daysLeft}d left!`}
                </Badge>
              )}
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase mt-0.5">
              {dispute.reason ? REASON_LABELS[dispute.reason]?.split(' — ')[0] : 'Dispute'} · {format(safeDate(dispute.createdAt), 'MMM d, yyyy')}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-black text-lg font-mono text-slate-900">${dispute.amount.toFixed(2)}</p>
            <div className="flex items-center justify-end gap-1 mt-1"
              style={{ color: cfg.color }}>
              {cfg.icon}
              <span className="text-[9px] font-black uppercase tracking-widest">{cfg.label}</span>
            </div>
          </div>
        </div>

        {/* Deadline bar */}
        {isOpen && dispute.deadline && (
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
              <span>Response deadline</span>
              <span>{format(safeDate(dispute.deadline), 'MMM d, yyyy')}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', isUrgent ? 'bg-red-500' : 'bg-amber-500')}
                style={{ width: `${Math.min(100, Math.max(5, 100 - ((daysLeft || 0) / 7) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Evidence status */}
        <div className="flex items-center gap-2 flex-wrap">
          <EvidencePill
            label="Consent"
            has={(dispute.consentFormUrls?.length || 0) + (dispute.signatureUrls?.length || 0) > 0}
          />
          <EvidencePill label="Receipt"     has={!!dispute.receiptUrl}    />
          <EvidencePill label="Appointment" has={!!dispute.appointmentId} />
        </div>

        {/* Actions */}
        {isOpen && !dispute.evidenceSubmitted && (
          <Button
            onClick={() => onOpenEvidence(dispute)}
            className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/10"
          >
            <Shield className="w-3.5 h-3.5 mr-2" /> Build & Submit Evidence
          </Button>
        )}
        {dispute.evidenceSubmitted && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <p className="text-[10px] font-black uppercase text-green-700">
              Evidence submitted {dispute.evidenceSubmittedAt ? format(safeDate(dispute.evidenceSubmittedAt), 'MMM d') : ''}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EvidencePill({ label, has }: { label: string; has: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border',
      has ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200'
    )}>
      {has ? <Check className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DisputeCenterPage() {
  const { firestore }                             = useFirebase();
  const { selectedTenant }                        = useTenant();
  const tenantId                                  = selectedTenant?.id;
  const [selectedDispute, setSelectedDispute]     = useState<Dispute | null>(null);
  const [isEvidenceOpen,  setIsEvidenceOpen]      = useState(false);

  const disputesQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, `tenants/${tenantId}/disputes`);
  }, [firestore, tenantId]);

  const { data: disputes, isLoading } = useCollection<Dispute>(disputesQuery);

  const openDisputes = useMemo(() =>
    (disputes || [])
      .filter(d => ['warning_needs_response', 'needs_response', 'under_review'].includes(d.status))
      .sort((a, b) => {
        const da = getDaysUntilDeadline(a.deadline) ?? 999;
        const db = getDaysUntilDeadline(b.deadline) ?? 999;
        return da - db;
      }),
    [disputes]
  );

  const closedDisputes = useMemo(() =>
    (disputes || []).filter(d => ['won', 'lost', 'charge_refunded'].includes(d.status)),
    [disputes]
  );

  const totalExposure  = openDisputes.reduce((s, d) => s + d.amount, 0);
  const wonCount       = closedDisputes.filter(d => d.status === 'won').length;
  const lostCount      = closedDisputes.filter(d => d.status === 'lost').length;
  const totalLost      = closedDisputes.filter(d => d.status === 'lost').reduce((s, d) => s + d.amount, 0);

  const handleOpenEvidence = (dispute: Dispute) => {
    setSelectedDispute(dispute);
    setIsEvidenceOpen(true);
  };

  const handleEvidenceSubmitted = () => {
    setIsEvidenceOpen(false);
    setSelectedDispute(null);
  };

  const handleCreateTestDispute = async () => {
    if (!firestore || !tenantId) return;
    const id       = nanoid();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 4); // 4 days from now — urgent but not critical

    await setDoc(doc(firestore, `tenants/${tenantId}/disputes`, id), {
      id,
      stripeDisputeId:          `dp_test_${id.slice(-8)}`,
      stripeChargeId:           `ch_test_${id.slice(-8)}`,
      stripeConnectedAccountId: 'acct_test_clarityflow',
      clientId:                 null,
      clientName:               'Test Client (Jane Doe)',
      amount:                   160.00,
      currency:                 'usd',
      reason:                   'fraudulent',
      status:                   'needs_response',
      deadline:                 deadline.toISOString(),
      evidenceSubmitted:        false,
      checkoutSessionId:        `cs_test_${id.slice(-8)}`,
      receiptUrl:               null,
      appointmentId:            null,
      signatureUrls:            [],
      consentFormUrls:          [],
      createdAt:                new Date().toISOString(),
      tenantId,
      notes:                    'This is a test dispute. Safe to delete from Firestore.',
    });

    toast({
      title:       'Test Dispute Created',
      description: 'A fake dispute has been added. Delete it from Firestore when done testing.',
    });
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Dispute Center" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">
              Dispute Center
            </h1>
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Manage chargebacks and submit evidence to win disputes
            </p>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <Button
              variant="outline"
              onClick={handleCreateTestDispute}
              className="h-10 px-5 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 font-black uppercase text-[9px] tracking-widest gap-2 shrink-0"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Create Test Dispute
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Open Disputes"    value={openDisputes.length}      color={openDisputes.length > 0 ? 'text-red-600' : 'text-slate-900'} />
          <StatCard label="At Risk"          value={`$${totalExposure.toFixed(2)}`} color={totalExposure > 0 ? 'text-amber-600' : 'text-slate-900'} />
          <StatCard label="Disputes Won"     value={wonCount}                 color="text-green-600" />
          <StatCard label="Total Lost"       value={`$${totalLost.toFixed(2)}`}    color={totalLost > 0 ? 'text-red-600' : 'text-slate-900'} />
        </div>

        {/* Main content */}
        <Tabs defaultValue="open">
          <TabsList className="bg-muted/30 p-1 rounded-2xl border-2 border-muted shadow-inner gap-1.5">
            <TabsTrigger value="open"   className="px-6 h-10 rounded-xl font-black text-[10px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-md">
              Open ({openDisputes.length})
            </TabsTrigger>
            <TabsTrigger value="closed" className="px-6 h-10 rounded-xl font-black text-[10px] uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-md">
              Closed ({closedDisputes.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="mt-6">
            {isLoading ? (
              <div className="grid gap-4">
                {[1,2].map(i => <div key={i} className="h-40 rounded-[1.5rem] bg-muted/20 animate-pulse" />)}
              </div>
            ) : openDisputes.length === 0 ? (
              <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                <ShieldCheck className="w-16 h-16" />
                <p className="font-black uppercase tracking-widest">No Open Disputes</p>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">All clear — no chargebacks require your attention</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {openDisputes.map(d => (
                  <DisputeCard key={d.id} dispute={d} onOpenEvidence={handleOpenEvidence} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="closed" className="mt-6">
            {closedDisputes.length === 0 ? (
              <div className="py-20 text-center border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-4">
                <FileText className="w-16 h-16" />
                <p className="font-black uppercase tracking-widest">No Closed Disputes</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {closedDisputes.map(d => (
                  <DisputeCard key={d.id} dispute={d} onOpenEvidence={handleOpenEvidence} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Prevention tips */}
        <Card className="border-2 rounded-[1.5rem] bg-blue-50 border-blue-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center gap-2">
              <Info className="w-3.5 h-3.5" /> Prevention Guide
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              'Always collect a signed consent form before services — it\'s your strongest evidence.',
              'Use descriptive service names on receipts so clients recognize the charge.',
              'Card-present terminal charges (tap/chip) are harder to dispute than card-on-file.',
              'If a client seems unhappy, resolve it directly — a refund costs less than a lost dispute.',
              'Keep appointment notes current — staff names and service details matter in evidence.',
            ].map((tip, i) => (
              <p key={i} className="text-[11px] font-bold text-blue-800 flex items-start gap-2">
                <Check className="w-3 h-3 text-blue-500 mt-0.5 shrink-0" /> {tip}
              </p>
            ))}
          </CardContent>
        </Card>
      </main>

      {selectedDispute && (
        <EvidenceBuilderDialog
          open={isEvidenceOpen}
          onOpenChange={setIsEvidenceOpen}
          dispute={selectedDispute}
          tenantId={tenantId!}
          onSubmitted={handleEvidenceSubmitted}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Card className="border-2 rounded-[1.5rem] bg-white">
      <CardContent className="p-4">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mb-1">{label}</p>
        <p className={cn('text-2xl font-black font-mono tracking-tighter', color)}>{value}</p>
      </CardContent>
    </Card>
  );
}