'use client';

// ─── /settings/messages ───────────────────────────────────────────────────────
// Every automatic message the shop sends, in one list: what triggers it, which
// channels it uses, whether it is on, and the owner's own wording if they want
// their own wording.
//
// The screen is built to make two things obvious without a manual:
//   • some messages have no switch, and the reason is printed where the switch
//     would have been — not hidden behind a disabled toggle the owner will
//     keep poking at;
//   • custom copy is checked as you save it, so a message that would have gone
//     out missing its amount or its link is caught here rather than in a
//     client's inbox.

import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { ArrowLeft, Lock, Mail, MessageSquare, Pencil, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { MESSAGE_KINDS, validateOverride, type MessageKindDef } from '@/lib/message-policy';
import { cn } from '@/lib/utils';

const GROUPS = ['Booking', 'Money', 'Reminders', 'Retail', 'Account'] as const;

export default function MessageSettingsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const stored = ((selectedTenant as any)?.messagePolicy || {}) as Record<string, any>;
  const staffRole = String((selectedTenant as any)?.staffMember?.role || 'owner').toLowerCase();
  const isMgr = ['owner', 'admin'].includes(staffRole);

  const [group, setGroup] = useState<typeof GROUPS[number]>('Booking');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [draftSubject, setDraftSubject] = useState('');

  const kinds = useMemo(() => MESSAGE_KINDS.filter((k) => k.group === group), [group]);

  const save = async (key: string, field: string, value: any, label: string) => {
    if (!firestore || !tenantId || !isMgr || busy) return;
    setBusy(key);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value });
      toast({ title: `${label} saved` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save', description: e?.message });
    } finally { setBusy(null); }
  };

  const saveCopy = async (k: MessageKindDef) => {
    const check = validateOverride(k.id, draftBody);
    if (!check.ok) {
      toast({ variant: 'destructive', title: 'Message not saved', description: check.error });
      return;
    }
    if (!firestore || !tenantId || busy) return;
    setBusy(`${k.id}-copy`);
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), {
        [`messagePolicy.${k.id}.body`]: draftBody.trim(),
        [`messagePolicy.${k.id}.subject`]: draftSubject.trim(),
      });
      toast({
        title: draftBody.trim() ? 'Your wording is live' : 'Back to the built-in wording',
        description: draftBody.trim() ? 'It will be used on the next send.' : undefined,
      });
      setEditing(null);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save', description: e?.message });
    } finally { setBusy(null); }
  };

  const Toggle = ({ on, onFlip, disabled, label }: { on: boolean; onFlip: () => void; disabled?: boolean; label: string }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={onFlip}
      className={cn('relative h-6 w-11 shrink-0 rounded-full border-2 transition-all disabled:opacity-40',
        on ? 'border-green-600 bg-green-500/20' : 'border-muted-foreground/30 bg-muted/40')}>
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full transition-all',
        on ? 'right-0.5 bg-green-600' : 'left-0.5 bg-muted-foreground/50')} />
    </button>
  );

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Messages</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              What goes out, and what it says{isMgr ? '' : ' · view only'}
            </p>
          </div>
          <Mail className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="max-w-2xl mx-auto px-4 pb-3 flex gap-1.5 overflow-x-auto">
          {GROUPS.map((g) => (
            <button key={g} type="button" onClick={() => { setGroup(g); setEditing(null); }}
              className={cn('h-8 shrink-0 rounded-full border-2 px-3 text-[9px] font-black uppercase tracking-widest transition-all',
                group === g ? 'border-foreground bg-foreground text-background' : 'bg-white hover:border-primary/40')}>
              {g}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {kinds.map((k) => {
          const cfg = stored[k.id] || {};
          const emailOn = k.canDisable ? cfg.emailEnabled !== false : true;
          const smsOn = k.canDisable ? cfg.smsEnabled !== false : true;
          const hasCustom = String(cfg.body || '').trim().length > 0;
          const isEditing = editing === k.id;

          return (
            <Card key={k.id} className="border-2 rounded-[2rem] bg-white">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black leading-tight">{k.label}</p>
                    <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">{k.when}</p>
                  </div>
                  {hasCustom && (
                    <span className="shrink-0 rounded-full border-2 border-primary/30 bg-primary/5 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-primary">
                      Your wording
                    </span>
                  )}
                </div>

                {k.canDisable ? (
                  <div className="flex flex-wrap items-center gap-4">
                    {k.channels.includes('email') && (
                      <span className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Email</span>
                        <Toggle on={emailOn} disabled={!isMgr || busy === `${k.id}-email`} label={`${k.label} email`}
                          onFlip={() => void save(`${k.id}-email`, `messagePolicy.${k.id}.emailEnabled`, !emailOn, k.label)} />
                      </span>
                    )}
                    {k.channels.includes('sms') && (
                      <span className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Text</span>
                        <Toggle on={smsOn} disabled={!isMgr || busy === `${k.id}-sms`} label={`${k.label} text`}
                          onFlip={() => void save(`${k.id}-sms`, `messagePolicy.${k.id}.smsEnabled`, !smsOn, k.label)} />
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="flex items-start gap-2 rounded-xl border-2 border-dashed px-2.5 py-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                    <span><strong className="uppercase tracking-widest">Always sends.</strong> {k.mandatoryNote} You can still change the wording.</span>
                  </p>
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    {k.channels.includes('email') && (
                      <input value={draftSubject} disabled={!isMgr}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftSubject(e.target.value)}
                        placeholder="Subject line (optional — leave blank for the built-in)"
                        className="h-10 w-full rounded-xl border-2 bg-white px-3 text-sm font-bold outline-none focus:border-foreground/60" />
                    )}
                    <Textarea value={draftBody} rows={4} disabled={!isMgr}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraftBody(e.target.value)}
                      placeholder="Write it in your own voice — or leave blank to use the built-in wording."
                      className="rounded-xl border-2 text-sm font-bold" />
                    <div className="flex flex-wrap gap-1.5">
                      {k.tokens.map((t) => (
                        <button key={t} type="button"
                          onClick={() => setDraftBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}${t}`)}
                          className="rounded-full border-2 bg-white px-2 py-1 font-mono text-[9px] font-bold transition-all hover:border-primary/40 active:scale-95">
                          {t}
                        </button>
                      ))}
                    </div>
                    {k.requiredTokens.length > 0 && (
                      <p className="text-[10px] font-bold leading-relaxed text-amber-700">
                        Keep {k.requiredTokens.join(' and ')} in there — without it the message loses the point it exists to make.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button disabled={!isMgr || busy === `${k.id}-copy`} onClick={() => void saveCopy(k)}
                        className="h-10 flex-1 rounded-2xl font-black uppercase text-[10px] tracking-widest">
                        Save wording
                      </Button>
                      <Button variant="outline" onClick={() => setEditing(null)}
                        className="h-10 rounded-2xl border-2 px-4 font-black uppercase text-[10px] tracking-widest">
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={!isMgr}
                      onClick={() => { setEditing(k.id); setDraftBody(String(cfg.body || '')); setDraftSubject(String(cfg.subject || '')); }}
                      className="h-9 rounded-xl border-2 px-3 font-black uppercase text-[9px] tracking-widest">
                      <Pencil className="mr-1.5 h-3 w-3" /> {hasCustom ? 'Edit wording' : 'Write my own'}
                    </Button>
                    {hasCustom && (
                      <Button variant="ghost" disabled={!isMgr || busy === `${k.id}-reset`}
                        onClick={() => void save(`${k.id}-reset`, `messagePolicy.${k.id}.body`, '', k.label)}
                        className="h-9 rounded-xl px-3 font-black uppercase text-[9px] tracking-widest text-muted-foreground">
                        <RotateCcw className="mr-1.5 h-3 w-3" /> Built-in
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <p className="px-2 text-[10px] font-bold leading-relaxed text-muted-foreground">
          Switched-off messages still appear in your message log marked as skipped, so nothing disappears without a trace.
          Reminders for unpaid deposits and missing forms are timed separately under Automations.
        </p>
      </main>
    </div>
  );
}
