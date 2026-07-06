'use client';

/**
 * VoiceAgentSettingsCard — v1
 *
 * Per-tenant configuration for the AI receptionist, written to the tenant
 * doc's `voiceAgent` map — the exact fields the inbound-webhook route reads
 * at the start of every call:
 *
 *   voiceAgent.agentName            → the assistant's name (default Chloe)
 *   voiceAgent.businessNiche        → one line: "a nail studio", "a lash
 *                                     bar", "a barbershop" — keeps the
 *                                     agent's language native to the niche
 *   voiceAgent.knowledgeBase        → freeform facts: hours, location,
 *                                     parking, policies, FAQ answers. This
 *                                     is the ONLY source the agent may
 *                                     answer questions from (besides the
 *                                     auto price list) — anything not in
 *                                     here becomes "let me take a message".
 *   voiceAgent.includeServicePrices → auto-append the live services +
 *                                     prices list from the services
 *                                     collection on every call (never stale)
 *   voiceAgent.phoneNumber          → the Retell number assigned to this
 *                                     business, E.164 — this is how a call
 *                                     is matched to the right tenant
 *   voiceAgent.bookingMode          → 'approval' (default) or 'instant'.
 *                                     Either way the slot is CLAIMED the
 *                                     moment a caller commits — approval
 *                                     mode only holds the deposit link /
 *                                     confirmation for staff review;
 *                                     instant mode sends it within seconds
 *                                     of hangup.
 *   voiceAgent.transferNumber       → optional. If set, callers who
 *                                     explicitly ask for a human during
 *                                     hours can be transferred. Complaints
 *                                     are ALWAYS callbacks regardless —
 *                                     the business reviews the recording
 *                                     and inbox item first, then decides.
 *
 * Usage on the settings page:
 *   <VoiceAgentSettingsCard firestore={firestore} tenantId={tenantId} tenant={tenant} />
 */

import React from 'react';
import { doc, setDoc, collection, onSnapshot } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, Loader, Sparkles, BookOpen, Phone, PhoneForwarded, Tag,
} from 'lucide-react';

const NAME_SUGGESTIONS = ['Chloe', 'Pearl', 'Maya', 'Sofia', 'Ivy', 'Nova'];

const sanitize = (obj: Record<string, any>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

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
  const [businessNiche, setBusinessNiche] = React.useState<string>(va.businessNiche || '');
  const [knowledgeBase, setKnowledgeBase] = React.useState<string>(va.knowledgeBase || '');
  const [includeServicePrices, setIncludeServicePrices] = React.useState<boolean>(
    va.includeServicePrices !== false,
  );
  const [phoneNumber, setPhoneNumber] = React.useState<string>(va.phoneNumber || '');
  const [bookingMode, setBookingMode] = React.useState<'approval' | 'instant'>(
    va.bookingMode === 'instant' ? 'instant' : 'approval',
  );
  const [voiceReminders, setVoiceReminders] = React.useState<boolean>(va.voiceReminders === true);
  const [consultationServiceId, setConsultationServiceId] = React.useState<string>(va.consultationServiceId || '');
  const [services, setServices] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
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
    return () => unsub();
  }, [firestore, tenantId]);
  const [consultationGuide, setConsultationGuide] = React.useState<string>(va.consultationGuide || '');
  const [transferNumber, setTransferNumber] = React.useState<string>(va.transferNumber || '');
  const [isSaving, setIsSaving] = React.useState(false);

  const handleSave = async () => {
    if (!firestore || !tenantId) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(firestore, 'tenants', tenantId),
        {
          voiceAgent: sanitize({
            agentName: agentName.trim() || 'Chloe',
            businessNiche: businessNiche.trim(),
            knowledgeBase: knowledgeBase.trim(),
            includeServicePrices,
            bookingMode,
            voiceReminders,
            consultationServiceId,
            consultationGuide: consultationGuide.trim(),
            phoneNumber: phoneNumber.trim(),
            transferNumber: transferNumber.trim(),
            updatedAt: new Date().toISOString(),
          }),
        },
        { merge: true },
      );
      toast({ title: 'Voice assistant saved', description: `${agentName.trim() || 'Chloe'} is up to date.` });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save voice assistant settings' });
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
          <p className="text-sm font-semibold text-slate-900">AI voice assistant</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Who answers your phone, what they know, and how they sound like
            they work here.
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Assistant name
          </p>
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
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Tag className="w-3 h-3" /> What kind of business is this?
          </p>
          <Input
            value={businessNiche}
            onChange={(e) => setBusinessNiche(e.target.value)}
            placeholder='e.g. "a nail studio", "a lash and brow bar", "a barbershop"'
            className="h-10 text-xs"
            maxLength={80}
          />
          <p className="text-[10px] text-slate-400">
            One phrase — it keeps the assistant's language native to your niche.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="w-3 h-3" /> Knowledge base
          </p>
          <textarea
            value={knowledgeBase}
            onChange={(e) => setKnowledgeBase(e.target.value)}
            rows={8}
            placeholder={
              'Everything the assistant may tell callers. Plain sentences work best:\n\n' +
              'Hours: Tuesday to Saturday, 9am to 7pm. Closed Sunday and Monday.\n' +
              'Location: 123 Main St, Burlington — free parking behind the building.\n' +
              'Cancellations need 24 hours notice or a fee may apply.\n' +
              'Deposits are required for services over $50.\n' +
              'Q: Do you take walk-ins? A: Yes when there is an opening, but booking ahead is safer.'
            }
            className="w-full rounded-lg border px-3 py-2.5 text-xs resize-y outline-none focus:border-indigo-300 transition-colors bg-white leading-relaxed"
          />
          <p className="text-[10px] text-slate-400">
            The assistant answers questions ONLY from what's written here (plus
            your live price list below). Anything not covered becomes "let me
            take a message" — so the more you add, the fewer callbacks.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="w-3 h-3" /> Consultation questions
            <span className="normal-case tracking-normal text-slate-300">(optional)</span>
          </p>
          <textarea
            value={consultationGuide}
            onChange={(e) => setConsultationGuide(e.target.value)}
            rows={5}
            placeholder={
              'If a caller is unsure what they need, the assistant walks these one at a time:\n\n' +
              '1. What look are you going for — natural, glam, something in between?\n' +
              '2. How are your natural nails right now — any lifting, peeling, or soreness?\n' +
              '3. Any allergies or sensitivities to products?\n' +
              '4. How long do you want the set to last?'
            }
            className="w-full rounded-lg border px-3 py-2.5 text-xs resize-y outline-none focus:border-indigo-300 transition-colors bg-white leading-relaxed"
          />
          <p className="text-[10px] text-slate-400">
            The full Q&amp;A lands in your inbox before the visit. The assistant
            never gives medical advice — anything concerning gets flagged for
            your provider to review.
          </p>
          <div className="pt-1 space-y-1">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">
              Paid virtual consultation service
              <span className="normal-case tracking-normal text-slate-300 ml-1">(optional)</span>
            </p>
            <select
              value={consultationServiceId}
              onChange={(e) => setConsultationServiceId(e.target.value)}
              className="w-full h-10 rounded-lg border text-xs px-3 bg-white"
            >
              <option value="">None — consultations stay a free quick chat</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{Number(s.price) > 0 ? ` — $${Number(s.price)}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400">
              Pick a service (create one like "Virtual Consultation — 20 min")
              and clients book &amp; pay for it like any appointment. The
              assistant calls them AT the scheduled time, runs the questions
              above as a full session, and offers to book their treatment on
              the same call. Callers asking to "get a consultation" get offered
              this instead of the free walkthrough.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIncludeServicePrices((v) => !v)}
          className={cn(
            'w-full rounded-xl border p-3.5 text-left transition-all',
            includeServicePrices ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-700">
                Share live service menu &amp; prices
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Auto-pulled fresh from your services list on every call — never
                stale, updates the moment you change a price.
              </p>
            </div>
            <div className={cn('w-10 h-5.5 rounded-full shrink-0 relative transition-colors', includeServicePrices ? 'bg-indigo-500' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', includeServicePrices ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>

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
              <p className="text-xs font-medium text-slate-700">
                Voice appointment reminders
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                The assistant calls clients before their appointment (9am–8pm
                only) — and if they can't make it, reschedules them on the
                spot instead of losing the booking.
              </p>
            </div>
            <div className={cn('w-10 h-5.5 rounded-full shrink-0 relative transition-colors', voiceReminders ? 'bg-indigo-500' : 'bg-slate-200')}>
              <div className={cn('absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all', voiceReminders ? 'left-[22px]' : 'left-0.5')} />
            </div>
          </div>
        </button>

        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">
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
                The slot is held instantly; you approve before the deposit link
                or confirmation goes out.
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
                Deposit link texts within seconds of the call — the client's
                deposit is the approval. You can still cancel anything.
              </p>
            </button>
          </div>
          <p className="text-[10px] text-slate-400">
            Either way, the calendar slot is protected the moment the caller
            says yes — no one else can take it while paperwork is pending.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Phone className="w-3 h-3" /> Assistant phone number
          </p>
          <Input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+13365551234"
            className="h-10 text-xs font-mono"
          />
          <p className="text-[10px] text-slate-400">
            The number provisioned for this business's assistant, in +1 format
            exactly. Incoming calls on this number load this business's
            assistant, knowledge, and calendar.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <PhoneForwarded className="w-3 h-3" /> Human transfer number
            <span className="normal-case tracking-normal text-slate-300">(optional)</span>
          </p>
          <Input
            value={transferNumber}
            onChange={(e) => setTransferNumber(e.target.value)}
            placeholder="+13365550000"
            className="h-10 text-xs font-mono"
          />
          <p className="text-[10px] text-slate-400">
            If set, callers who ask for a person during business hours can be
            transferred here. Leave blank to have every request handled as a
            call-back instead. Complaints are always call-backs either way —
            you review the recording first, then decide how to handle it.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button className="h-10 text-xs px-5" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Save assistant'}
          </Button>
        </div>
      </div>
    </div>
  );
}
