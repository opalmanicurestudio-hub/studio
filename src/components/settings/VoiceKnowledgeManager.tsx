'use client';

/**
 * VoiceKnowledgeManager — v1
 *
 * The uniform knowledge base UI. Three zones, matching the compiler's
 * three layers:
 *
 *   KNOWN AUTOMATICALLY — a read-only preview of what the assistant
 *     already knows from platform data: hours (rendered with the SAME
 *     grouping function the compiler uses — what you see is what it
 *     says), services count + live-prices toggle, team roster, and the
 *     policy sentences derived from the tenant's real policy settings.
 *     Each block points at its source of truth ("edit in Settings /
 *     Services / Schedule") instead of duplicating editors.
 *
 *   FREQUENTLY ASKED — the voiceFaq collection as uniform Q&A cards:
 *     add, edit, toggle, delete. Entries captured from missed calls (the
 *     inbox "Teach" action) arrive here flagged NEEDS AN ANSWER and
 *     pinned to the top — answer them and flip them live in one place.
 *     A starter pack seeds the questions every appointment business gets.
 *
 *   ANYTHING ELSE — the legacy freeform field, demoted to a small
 *     catch-all (existing tenants' text keeps working, compiled last).
 *
 * Firestore: voiceFaq is covered by the staff catch-all rule; no rules or
 * index changes. Everything is single-collection reads.
 */

import React from 'react';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc,
} from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  BookOpen, Clock, Users, Scale, Sparkles, Plus, Trash2, Check, Loader,
  Pencil, AlertCircle, ToggleLeft, ToggleRight, DollarSign,
} from 'lucide-react';
import { summarizeWeekHours, derivePolicyLines } from '@/lib/voice/knowledge-compiler';

type Faq = {
  id: string;
  question: string;
  answer: string;
  enabled?: boolean;
  needsAnswer?: boolean;
  source?: string;
  createdAt?: string;
};

const STARTER_FAQS: { question: string; answer: string }[] = [
  { question: 'Do you take walk-ins?', answer: '' },
  { question: 'Where do I park?', answer: '' },
  { question: 'What forms of payment do you accept?', answer: '' },
  { question: 'Can I bring a friend or my kids?', answer: '' },
  { question: 'How early should I arrive?', answer: '' },
  { question: 'Do you sell gift cards?', answer: '' },
];

const genId = () => `faq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function AutoBlock({
  icon: Icon, title, source, children,
}: {
  icon: React.ElementType; title: string; source: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
          <Icon className="w-3 h-3" /> {title}
        </p>
        <p className="text-[8px] font-bold uppercase tracking-widest text-slate-300">
          {source}
        </p>
      </div>
      {children}
    </div>
  );
}

export function VoiceKnowledgeManager({
  firestore,
  tenantId,
  tenant,
  scheduleProfiles,
  servicesCount,
  staffNames,
  className,
}: {
  firestore: any;
  tenantId: string;
  tenant: any;
  /** Pass the tenant's schedule profiles if the page already has them;
   *  otherwise the hours block simply notes its source. */
  scheduleProfiles?: any[];
  servicesCount?: number;
  staffNames?: string[];
  className?: string;
}) {
  const { toast } = useToast();
  const va = tenant?.voiceAgent || {};

  const [faqs, setFaqs] = React.useState<Faq[]>([]);
  const [draft, setDraft] = React.useState<{ id: string; question: string; answer: string } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<string>(va.knowledgeBase || '');
  const [notesSaving, setNotesSaving] = React.useState(false);
  const [includePrices, setIncludePrices] = React.useState<boolean>(va.includeServicePrices !== false);

  React.useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
      collection(firestore, `tenants/${tenantId}/voiceFaq`),
      (snap: any) => {
        const list: Faq[] = [];
        snap.forEach((d: any) => list.push({ id: d.id, ...(d.data() as any) }));
        list.sort((a, b) => {
          const aN = a.needsAnswer ? 1 : 0;
          const bN = b.needsAnswer ? 1 : 0;
          if (aN !== bN) return bN - aN; // needs-answer pinned first
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        });
        setFaqs(list);
      },
      () => { /* non-fatal */ },
    );
    return () => unsub();
  }, [firestore, tenantId]);

  const needsAnswerCount = faqs.filter((f) => f.needsAnswer && !(f.answer || '').trim()).length;

  const saveFaq = async (faq: { id: string; question: string; answer: string }) => {
    if (!faq.question.trim()) return;
    setBusyId(faq.id);
    try {
      const answered = !!faq.answer.trim();
      await setDoc(
        doc(firestore, `tenants/${tenantId}/voiceFaq`, faq.id),
        {
          question: faq.question.trim(),
          answer: faq.answer.trim(),
          enabled: answered, // answering it turns it on; empty answers stay off
          needsAnswer: !answered,
          updatedAt: new Date().toISOString(),
          createdAt: faqs.find((f) => f.id === faq.id)?.createdAt || new Date().toISOString(),
        },
        { merge: true },
      );
      setDraft(null);
    } catch {
      toast({ variant: 'destructive', title: 'Could not save that entry' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleFaq = async (faq: Faq) => {
    if (!(faq.answer || '').trim()) return; // can't enable an unanswered entry
    await setDoc(
      doc(firestore, `tenants/${tenantId}/voiceFaq`, faq.id),
      { enabled: faq.enabled === false ? true : false },
      { merge: true },
    ).catch(() => toast({ variant: 'destructive', title: 'Could not update' }));
  };

  const deleteFaq = async (id: string) => {
    setBusyId(id);
    try {
      await deleteDoc(doc(firestore, `tenants/${tenantId}/voiceFaq`, id));
    } catch {
      toast({ variant: 'destructive', title: 'Could not delete' });
    } finally {
      setBusyId(null);
    }
  };

  const seedStarters = async () => {
    setBusyId('seed');
    try {
      const existing = new Set(faqs.map((f) => f.question.toLowerCase()));
      const now = new Date().toISOString();
      await Promise.all(
        STARTER_FAQS.filter((s) => !existing.has(s.question.toLowerCase())).map((s) =>
          setDoc(doc(firestore, `tenants/${tenantId}/voiceFaq`, genId()), {
            question: s.question,
            answer: '',
            enabled: false,
            needsAnswer: true,
            source: 'starter_pack',
            createdAt: now,
          }),
        ),
      );
      toast({ title: 'Starter questions added', description: 'Answer each one to turn it on.' });
    } finally {
      setBusyId(null);
    }
  };

  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      await setDoc(
        doc(firestore, 'tenants', tenantId),
        { voiceAgent: { knowledgeBase: notes.trim(), includeServicePrices: includePrices } },
        { merge: true },
      );
      toast({ title: 'Knowledge updated' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not save' });
    } finally {
      setNotesSaving(false);
    }
  };

  const activeProfile = (scheduleProfiles || []).find((p: any) => p.isActive);
  const hourLines = activeProfile?.week ? summarizeWeekHours(activeProfile.week) : [];
  const policyLines = derivePolicyLines(tenant);

  return (
    <div className={cn('rounded-2xl border bg-white overflow-hidden shadow-sm', className)}>
      <div className="p-4 border-b flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">What the assistant knows</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Compiled fresh on every call — the top section updates itself from
            your existing settings; you only maintain the questions below.
          </p>
        </div>
        {needsAnswerCount > 0 && (
          <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full shrink-0 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {needsAnswerCount} need answers
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">

        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-300">
            Known automatically
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            <AutoBlock icon={Clock} title="Hours" source="Schedule">
              {hourLines.length > 0 ? (
                <div className="space-y-0.5">
                  {hourLines.map((l) => (
                    <p key={l} className="text-[11px] text-slate-600">{l}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  From your active schedule profile — set one under Settings → Schedule.
                </p>
              )}
            </AutoBlock>
            <AutoBlock icon={Scale} title="Policies" source="Settings">
              {policyLines.length > 0 ? (
                <div className="space-y-0.5">
                  {policyLines.map((l) => (
                    <p key={l} className="text-[11px] text-slate-600">{l}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Cancellation, late & no-show policies flow in from Settings the
                  moment you configure them.
                </p>
              )}
            </AutoBlock>
            <AutoBlock icon={DollarSign} title="Service menu & prices" source="Services">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-600">
                  {servicesCount !== undefined
                    ? `${servicesCount} live services with current prices`
                    : 'Your live menu with current prices'}
                </p>
                <button
                  type="button"
                  onClick={() => setIncludePrices((v) => !v)}
                  className="shrink-0 text-teal-600"
                  title={includePrices ? 'Prices shared with callers' : 'Prices not shared'}
                >
                  {includePrices ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6 text-slate-300" />}
                </button>
              </div>
            </AutoBlock>
            <AutoBlock icon={Users} title="Team" source="Pro Team">
              <p className="text-[11px] text-slate-600">
                {staffNames && staffNames.length > 0
                  ? staffNames.join(', ')
                  : 'Active providers, by first name'}
              </p>
            </AutoBlock>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-300">
              Frequently asked
            </p>
            <div className="flex items-center gap-1.5">
              {faqs.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-[10px] font-black uppercase tracking-widest"
                  disabled={busyId === 'seed'}
                  onClick={seedStarters}
                >
                  {busyId === 'seed' ? <Loader className="w-3 h-3 animate-spin" /> : (
                    <><Sparkles className="w-3 h-3 mr-1" /> Starter pack</>
                  )}
                </Button>
              )}
              <Button
                size="sm"
                className="h-8 text-[10px] font-black uppercase tracking-widest"
                onClick={() => setDraft({ id: genId(), question: '', answer: '' })}
              >
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
          </div>

          {draft && (
            <div className="rounded-xl border-2 border-teal-200 bg-teal-50/40 p-3 space-y-2">
              <Input
                autoFocus
                value={draft.question}
                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                placeholder="The question, as a caller would ask it"
                className="h-9 text-xs bg-white"
              />
              <textarea
                value={draft.answer}
                onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                rows={2}
                placeholder="The answer, exactly as the assistant should say it"
                className="w-full rounded-lg border px-3 py-2 text-xs resize-y bg-white"
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDraft(null)}>
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!draft.question.trim() || busyId === draft.id}
                  onClick={() => saveFaq(draft)}
                >
                  {busyId === draft.id ? <Loader className="w-3 h-3 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>
          )}

          {faqs.length === 0 && !draft && (
            <div className="p-6 text-center border-2 border-dashed rounded-2xl opacity-40">
              <p className="text-[10px] font-black uppercase tracking-widest">
                No questions yet — start with the starter pack
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            {faqs.map((faq) => {
              const answered = !!(faq.answer || '').trim();
              const live = answered && faq.enabled !== false;
              const isEditing = draft?.id === faq.id;
              if (isEditing) return null;
              return (
                <div
                  key={faq.id}
                  className={cn(
                    'rounded-xl border p-2.5 flex items-start gap-2.5',
                    !answered && 'border-amber-200 bg-amber-50/50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleFaq(faq)}
                    disabled={!answered}
                    className={cn('shrink-0 mt-0.5', live ? 'text-teal-600' : 'text-slate-300')}
                    title={
                      !answered ? 'Answer it to turn it on'
                        : live ? 'The assistant uses this — tap to turn off'
                          : 'Off — tap to turn on'
                    }
                  >
                    {live ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-900">{faq.question}</p>
                    {answered ? (
                      <p className="text-[11px] text-slate-500 mt-0.5">{faq.answer}</p>
                    ) : (
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mt-0.5 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Needs an answer
                        {faq.source === 'missed_call' && ' · asked on a call'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDraft({ id: faq.id, question: faq.question, answer: faq.answer || '' })}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFaq(faq.id)}
                      disabled={busyId === faq.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-300">
            Anything else
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything that doesn't fit above — seasonal notes, house rules, directions quirks."
            className="w-full rounded-lg border px-3 py-2.5 text-xs resize-y bg-white leading-relaxed"
          />
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" onClick={saveNotes} disabled={notesSaving}>
              {notesSaving ? <Loader className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3 mr-1" /> Save</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
