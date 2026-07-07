'use client';

/**
 * VoiceAgentSettingsCard — v5 "zero-config"
 *
 * The adoption principle: a busy owner should open this card and find it
 * ALREADY DONE — every field pre-answered from data the platform has —
 * so "setup" collapses to review-and-save. Concretely:
 *
 *   NICHE — preset chips, PRE-SELECTED by inferring from their own
 *     service menu (a menu of gel fills is a nail studio; fades are a
 *     barbershop). "Other…" remains the escape hatch.
 *   VOICE — a curated voice-style picker (warm/bright female, calm/
 *     friendly male, smooth unisex). Applied when the assistant's number
 *     is provisioned — each style maps to a platform agent variant the
 *     number gets attached to.
 *   NAMES — suggestions now span female, male, and unisex.
 *   CONSULTATION SCRIPT — resolves itself: an explicit choice wins; else
 *     the first Intake form with questions is auto-selected (one builder,
 *     two channels — sign it digitally or conduct it by voice); else the
 *     niche's expert question pack auto-loads. The card shows the
 *     RESOLVED script as a compact numbered preview with a single
 *     "Change" affordance — owners see a finished script, never an empty
 *     editor.
 *
 * Persists voiceAgent.{agentName, voiceStyle, businessNicheId,
 * businessNiche, bookingMode, voiceReminders, consultationSource,
 * consultationFormId, consultationQuestions[], consultationServiceId,
 * phoneNumber, transferNumber}. Legacy consultationGuide still works as
 * the final fallback server-side.
 */

import React from 'react';
import { doc, setDoc, collection, onSnapshot } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, Loader, Sparkles, Phone, PhoneForwarded, Tag, ClipboardList,
  FileSignature, Plus, Trash2, Pencil, Mic, Check,
} from 'lucide-react';
import { VOICE_NICHES, nicheById, inferNicheFromServices } from '@/lib/voice/niches';

const NAME_SUGGESTIONS = ['Chloe', 'Pearl', 'Maya', 'Nova', 'Theo', 'Miles', 'Jordan', 'Quinn'];

const VOICE_STYLES = [
  { id: 'warm_female', label: 'Warm & friendly', sub: 'Female' },
  { id: 'bright_female', label: 'Bright & upbeat', sub: 'Female' },
  { id: 'calm_male', label: 'Calm & professional', sub: 'Male' },
  { id: 'friendly_male', label: 'Friendly & casual', sub: 'Male' },
  { id: 'smooth_neutral', label: 'Smooth & neutral', sub: 'Unisex' },
] as const;

const QUESTION_TYPES = ['short-text', 'long-text', 'multiple-choice', 'checkboxes'];

const sanitize = (obj: Record<string, any>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

function FieldLabel({ icon: Icon, children, optional }: { icon: React.ElementType; children: React.ReactNode; optional?: boolean }) {
  return (
    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1.5">
      <Icon className="w-3 h-3" /> {children}
      {optional && <span className="normal-case tracking-normal font-bold text-slate-300">(optional)</span>}
    </p>
  );
}

export function VoiceAgentSettingsCard({
  firestore,
  tenantId,
  tenant,
  className,
}: {
  firestore: any;
  tenantId: string;
  tenant: any;
  className?: string;
}) {
  const { toast } = useToast();
  const va = tenant?.voiceAgent || {};

  const [agentName, setAgentName] = React.useState<string>(va.agentName || 'Chloe');
  const [voiceStyle, setVoiceStyle] = React.useState<string>(va.voiceStyle || 'warm_female');
  const [nicheId, setNicheId] = React.useState<string>(va.businessNicheId || '');
  const [nicheTouched, setNicheTouched] = React.useState<boolean>(!!va.businessNicheId || !!va.businessNiche);
  const [customNiche, setCustomNiche] = React.useState<string>(va.businessNicheId ? '' : va.businessNiche || '');
  const [bookingMode, setBookingMode] = React.useState<'approval' | 'instant'>(
    va.bookingMode === 'instant' ? 'instant' : 'approval',
  );
  const [voiceReminders, setVoiceReminders] = React.useState<boolean>(va.voiceReminders === true);
  const [consultationSource, setConsultationSource] = React.useState<'' | 'form' | 'custom'>(
    va.consultationSource === 'form' || va.consultationSource === 'custom' ? va.consultationSource : '',
  );
  const [consultationFormId, setConsultationFormId] = React.useState<string>(va.consultationFormId || '');
  const [questions, setQuestions] = React.useState<string[]>(
    Array.isArray(va.consultationQuestions) ? va.consultationQuestions : [],
  );
  const [editingScript, setEditingScript] = React.useState(false);
  const [consultationServiceId, setConsultationServiceId] = React.useState<string>(va.consultationServiceId || '');
  const [phoneNumber, setPhoneNumber] = React.useState<string>(va.phoneNumber || '');
  const [transferNumber, setTransferNumber] = React.useState<string>(va.transferNumber || '');
  const [isSaving, setIsSaving] = React.useState(false);

  const [services, setServices] = React.useState<any[]>([]);
  const [forms, setForms] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsubServices = onSnapshot(
      collection(firestore, `tenants/${tenantId}/services`),
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => {
          const data = { id: d.id, ...(d.data() as any) };
          if (data.type === 'service' && data.isActive !== false) list.push(data);
        });
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setServices(list);
      },
      () => { /* non-fatal */ },
    );
    const unsubForms = onSnapshot(
      collection(firestore, `tenants/${tenantId}/consentForms`),
      (snap: any) => {
        const list: any[] = [];
        snap.forEach((d: any) => {
          const data = { id: d.id, ...(d.data() as any) };
          const questionCount = (data.fields || []).filter((f: any) => QUESTION_TYPES.includes(f.type)).length;
          if (questionCount > 0) list.push({ ...data, questionCount });
        });
        list.sort((a, b) => {
          const aI = a.category === 'Intake' ? 0 : 1;
          const bI = b.category === 'Intake' ? 0 : 1;
          if (aI !== bI) return aI - bI;
          return (a.title || '').localeCompare(b.title || '');
        });
        setForms(list);
      },
      () => { /* non-fatal */ },
    );
    return () => { unsubServices(); unsubForms(); };
  }, [firestore, tenantId]);

  // Pre-populate the niche from the service menu (only until touched)
  React.useEffect(() => {
    if (nicheTouched || services.length === 0) return;
    const inferred = inferNicheFromServices(services);
    if (inferred) setNicheId(inferred);
  }, [services, nicheTouched]);

  const selectedNiche = nicheById(nicheId);

  // ── Resolve the effective consultation script (zero-config defaults) ──
  const bestIntakeForm = forms[0] || null; // Intake-category sorted first
  const effectiveSource: 'form' | 'custom' =
    consultationSource === 'form' && consultationFormId
      ? 'form'
      : consultationSource === 'custom'
        ? 'custom'
        : bestIntakeForm && bestIntakeForm.category === 'Intake'
          ? 'form'
          : 'custom';
  const effectiveFormId =
    effectiveSource === 'form' ? (consultationFormId || bestIntakeForm?.id || '') : '';
  const effectiveForm = forms.find((f) => f.id === effectiveFormId) || null;
  const effectiveQuestions: string[] =
    effectiveSource === 'form' && effectiveForm
      ? (effectiveForm.fields || [])
          .filter((f: any) => QUESTION_TYPES.includes(f.type) && (f.label || '').trim())
          .map((f: any) => f.label.trim())
      : questions.length > 0
        ? questions
        : selectedNiche?.consultQuestions || [];
  const scriptSourceLabel =
    effectiveSource === 'form' && effectiveForm
      ? `From your "${effectiveForm.title}" form`
      : questions.length > 0
        ? 'Your custom questions'
        : selectedNiche
          ? `${selectedNiche.label} expert pack`
          : 'Pick a niche or add questions';

  const handleSave = async () => {
    if (!firestore || !tenantId) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(firestore, 'tenants', tenantId),
        {
          voiceAgent: sanitize({
            agentName: agentName.trim() || 'Chloe',
            voiceStyle,
            businessNicheId: nicheId || '',
            businessNiche: nicheId ? '' : customNiche.trim(),
            bookingMode,
            voiceReminders,
            // Persist the RESOLVED defaults so they become explicit:
            consultationSource: effectiveSource,
            consultationFormId: effectiveSource === 'form' ? effectiveFormId : '',
            consultationQuestions:
              effectiveSource === 'custom'
                ? effectiveQuestions.map((q) => q.trim()).filter(Boolean)
                : questions.map((q) => q.trim()).filter(Boolean),
            consultationServiceId,
            phoneNumber: phoneNumber.trim(),
            transferNumber: transferNumber.trim(),
            updatedAt: new Date().toISOString(),
          }),
        },
        { merge: true },
      );
      toast({ title: 'Assistant saved', description: `${agentName.trim() || 'Chloe'} is up to date.` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save assistant settings' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn('rounded-2xl border bg-white overflow-hidden shadow-sm', className)}>
      <div className="p-4 border-b flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Your assistant</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Pre-filled from what we already know about your business — review,
            tweak, save.
          </p>
        </div>
      </div>

      <div className="p-4 space-y-5">

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <FieldLabel icon={Sparkles}>Name</FieldLabel>
            <Input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Chloe"
              className="h-10 text-sm"
              maxLength={24}
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {NAME_SUGGESTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAgentName(n)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors',
                    agentName === n
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel icon={Mic}>Voice</FieldLabel>
            <div className="space-y-1.5">
              {VOICE_STYLES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVoiceStyle(v.id)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors',
                    voiceStyle === v.id
                      ? 'border-indigo-200 bg-indigo-50'
                      : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <span className="text-[11px] font-medium text-slate-700">{v.label}</span>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{v.sub}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">
              Applied when your assistant's number is connected.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel icon={Tag}>What kind of business is this?</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {VOICE_NICHES.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => { setNicheId(n.id); setCustomNiche(''); setNicheTouched(true); }}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors',
                  nicheId === n.id
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300',
                )}
              >
                {n.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setNicheId(''); setNicheTouched(true); }}
              className={cn(
                'px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors',
                !nicheId
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300',
              )}
            >
              Other…
            </button>
          </div>
          {!nicheId && (
            <Input
              value={customNiche}
              onChange={(e) => setCustomNiche(e.target.value)}
              placeholder='In a few words: "a bridal boutique", "a pet grooming salon"'
              className="h-10 text-xs"
              maxLength={80}
            />
          )}
          {nicheId && !nicheTouched && (
            <p className="text-[10px] text-teal-600 font-medium">
              Guessed from your service menu — tap another if we got it wrong.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel icon={ClipboardList}>Consultation script</FieldLabel>
            <button
              type="button"
              onClick={() => setEditingScript((v) => !v)}
              className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1"
            >
              <Pencil className="w-3 h-3" /> {editingScript ? 'Done' : 'Change'}
            </button>
          </div>

          <div className="rounded-xl border bg-slate-50/60 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-teal-600 mb-1.5 flex items-center gap-1">
              <Check className="w-3 h-3" /> Ready · {scriptSourceLabel}
            </p>
            {effectiveQuestions.length > 0 ? (
              <div className="space-y-0.5">
                {effectiveQuestions.slice(0, 3).map((q, i) => (
                  <p key={i} className="text-[11px] text-slate-600">
                    <span className="text-slate-300 font-bold">{i + 1}.</span> {q}
                  </p>
                ))}
                {effectiveQuestions.length > 3 && (
                  <p className="text-[10px] text-slate-400">
                    + {effectiveQuestions.length - 3} more
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">
                Pick a business type above or add questions to build the script.
              </p>
            )}
          </div>

          {editingScript && (
            <div className="space-y-2 rounded-xl border-2 border-indigo-100 p-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConsultationSource('form')}
                  className={cn(
                    'rounded-xl border p-2.5 text-left transition-all',
                    effectiveSource === 'form' ? 'border-teal-200 bg-teal-50' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <p className="text-xs font-medium text-slate-900 flex items-center gap-1.5">
                    <FileSignature className="w-3.5 h-3.5" /> Use a form
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                    Walk an intake form from your form builder — build once,
                    sign digitally or conduct by voice.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConsultationSource('custom');
                    if (questions.length === 0 && selectedNiche) {
                      setQuestions([...selectedNiche.consultQuestions]);
                    }
                  }}
                  className={cn(
                    'rounded-xl border p-2.5 text-left transition-all',
                    effectiveSource === 'custom' ? 'border-teal-200 bg-teal-50' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <p className="text-xs font-medium text-slate-900">Custom questions</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                    Edit the list — starts from your niche's expert pack.
                  </p>
                </button>
              </div>

              {effectiveSource === 'form' ? (
                <select
                  value={effectiveFormId}
                  onChange={(e) => { setConsultationSource('form'); setConsultationFormId(e.target.value); }}
                  className="w-full h-10 rounded-lg border text-xs px-3 bg-white"
                >
                  <option value="">Choose a form…</option>
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title} · {f.category} · {f.questionCount} question{f.questionCount !== 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-1.5">
                  {(questions.length > 0 ? questions : effectiveQuestions).map((q, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        value={q}
                        onChange={(e) => {
                          const base = questions.length > 0 ? [...questions] : [...effectiveQuestions];
                          base[i] = e.target.value;
                          setQuestions(base);
                        }}
                        placeholder={`Question ${i + 1}`}
                        className="h-9 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const base = questions.length > 0 ? questions : effectiveQuestions;
                          setQuestions(base.filter((_, idx) => idx !== i));
                        }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-[10px] font-black uppercase tracking-widest"
                    onClick={() => setQuestions([...(questions.length > 0 ? questions : effectiveQuestions), ''])}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add question
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="pt-0.5 space-y-1">
            <select
              value={consultationServiceId}
              onChange={(e) => setConsultationServiceId(e.target.value)}
              className="w-full h-10 rounded-lg border text-xs px-3 bg-white"
            >
              <option value="">Consultations are a free quick chat</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  Paid: {s.name}{Number(s.price) > 0 ? ` — $${Number(s.price)}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400">
              Pick a service to make consultations a paid, scheduled call the
              assistant sells, books, and conducts with this script.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
            When a caller agrees to a time
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setBookingMode('approval')}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                bookingMode === 'approval' ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <p className="text-xs font-medium text-slate-900">Hold for my approval</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                Slot held instantly; you approve before the deposit link goes out.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setBookingMode('instant')}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                bookingMode === 'instant' ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <p className="text-xs font-medium text-slate-900">Book instantly</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                Deposit link texts within seconds — the deposit is the approval.
              </p>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setVoiceReminders((v) => !v)}
          className={cn(
            'w-full rounded-xl border p-3.5 text-left transition-all',
            voiceReminders ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-700">Voice appointment reminders</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Calls clients before their visit (9am–8pm) — and reschedules
                them on the spot if they can't make it.
              </p>
            </div>
            <div className={cn('w-10 h-5.5 rounded-full shrink-0 relative transition-colors', voiceReminders ? 'bg-indigo-500' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', voiceReminders ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <FieldLabel icon={Phone}>Assistant phone number</FieldLabel>
            <Input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+13365551234"
              className="h-10 text-xs font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel icon={PhoneForwarded} optional>Human transfer number</FieldLabel>
            <Input
              value={transferNumber}
              onChange={(e) => setTransferNumber(e.target.value)}
              placeholder="+13365550000"
              className="h-10 text-xs font-mono"
            />
          </div>
        </div>
        <p className="text-[10px] text-slate-400 -mt-2">
          Calls to the assistant number load this business. Transfer is only
          for callers who ask for a person — complaints are always call-backs
          you review first.
        </p>

        <div className="flex justify-end pt-1">
          <Button className="h-10 text-xs px-5 font-black uppercase tracking-widest" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Save assistant'}
          </Button>
        </div>
      </div>
    </div>
  );
}
