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
import { ArrowLeft, Clock, Lock, Mail, MapPin, MessageSquare, Moon, Pencil, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  MESSAGE_KINDS, resolveQuietHours, resolveAddressPolicy, validateOverride, type MessageKindDef,
} from '@/lib/message-policy';
import { cn } from '@/lib/utils';

const GROUPS = ['Booking', 'Money', 'Reminders', 'Retail', 'Renters', 'Account'] as const;

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
  const [offsetDraft, setOffsetDraft] = useState<Record<string, string>>({});
  const [draftBody, setDraftBody] = useState('');
  const [draftSubject, setDraftSubject] = useState('');

  const kinds = useMemo(() => MESSAGE_KINDS.filter((k) => k.group === group), [group]);
  const qh = useMemo(() => resolveQuietHours(selectedTenant), [selectedTenant]);
  const [qhDraft, setQhDraft] = useState<Record<string, string>>({});
  const addr = useMemo(() => resolveAddressPolicy(selectedTenant), [selectedTenant]);
  const [addrDraft, setAddrDraft] = useState<Record<string, string>>({});

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
          <Link href="/message-log"
            className="h-9 shrink-0 inline-flex items-center gap-1.5 rounded-xl border-2 bg-white px-2.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
            <Mail className="h-3.5 w-3.5" /> Delivery log
          </Link>
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
        {/* Quiet hours protect every kind at once — one setting instead of a
            per-message rule nobody would keep consistent. */}
        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-black"><Moon className="h-3.5 w-3.5" /> Quiet hours</p>
                <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">
                  Texts are held back overnight. Emails are unaffected — an email waits in an inbox, a text wakes someone up.
                </p>
              </div>
              <button type="button" role="switch" aria-checked={qh.enabled} aria-label="Quiet hours"
                disabled={!isMgr || busy === 'qh'}
                onClick={() => void save('qh', 'messageQuietHours.enabled', !qh.enabled, 'Quiet hours')}
                className={cn('relative h-6 w-11 shrink-0 rounded-full border-2 transition-all disabled:opacity-40',
                  qh.enabled ? 'border-green-600 bg-green-500/20' : 'border-muted-foreground/30 bg-muted/40')}>
                <span className={cn('absolute top-0.5 h-4 w-4 rounded-full transition-all',
                  qh.enabled ? 'right-0.5 bg-green-600' : 'left-0.5 bg-muted-foreground/50')} />
              </button>
            </div>
            {qh.enabled && (
              <div className="flex items-center gap-2">
                {(['startHour', 'endHour'] as const).map((f) => (
                  <span key={f} className="flex items-center gap-1.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{f === 'startHour' ? 'From' : 'Until'}</span>
                    <input inputMode="numeric" aria-label={f === 'startHour' ? 'Quiet hours start' : 'Quiet hours end'}
                      value={qhDraft[f] !== undefined ? qhDraft[f] : String(qh[f])}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQhDraft((d) => ({ ...d, [f]: e.target.value.replace(/[^0-9]/g, '') }))}
                      disabled={!isMgr}
                      className="h-8 w-14 rounded-lg border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">:00</span>
                  </span>
                ))}
                <Button size="sm" variant="outline" disabled={!isMgr || busy === 'qh-hours'}
                  onClick={() => {
                    const clamp = (v: string, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d; };
                    void save('qh-hours', 'messageQuietHours', {
                      enabled: true,
                      startHour: clamp(qhDraft.startHour ?? String(qh.startHour), qh.startHour),
                      endHour: clamp(qhDraft.endHour ?? String(qh.endHour), qh.endHour),
                    }, 'Quiet hours');
                  }}
                  className="h-8 rounded-lg border-2 px-2.5 font-black uppercase text-[8px] tracking-widest">
                  Set
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Where you are is not the same class of information as when. One
            setting governs every message that carries {{address}}. */}
        <Card className="border-2 rounded-[2rem] bg-white">
          <CardContent className="p-4 space-y-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-black"><MapPin className="h-3.5 w-3.5" /> Sharing your address</p>
              <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-muted-foreground">
                When a message may print your street address. Held back, it shows the area instead and says when the full address arrives — never a blank line.
              </p>
            </div>

            <div className="grid gap-1.5">
              {([
                ['always', 'Always', 'Anyone who gets a message sees it.'],
                ['on_confirm', 'Once confirmed', 'Only after the visit or booking is actually confirmed.'],
                ['before_event', 'Shortly before', 'Confirmed, and only inside a window you choose.'],
              ] as const).map(([mode, label, note]) => (
                <button key={mode} type="button" disabled={!isMgr || busy === 'addr'}
                  aria-pressed={addr.mode === mode}
                  onClick={() => void save('addr', 'addressPolicy', { ...addr, mode }, 'Address sharing')}
                  className={cn('rounded-2xl border-2 px-3 py-2.5 text-left transition-colors disabled:opacity-40',
                    addr.mode === mode ? 'border-foreground bg-foreground text-background' : 'bg-white hover:border-primary/40')}>
                  <span className="block text-[11px] font-black uppercase tracking-widest">{label}</span>
                  <span className={cn('block text-[10px] font-bold', addr.mode === mode ? 'opacity-70' : 'text-muted-foreground')}>{note}</span>
                </button>
              ))}
            </div>

            {addr.mode === 'before_event' && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Hours before</span>
                <input inputMode="numeric" aria-label="Hours before the visit to share the address"
                  value={addrDraft.offsetHours !== undefined ? addrDraft.offsetHours : String(addr.offsetHours)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddrDraft((d) => ({ ...d, offsetHours: e.target.value.replace(/[^0-9]/g, '') }))}
                  disabled={!isMgr}
                  className="h-8 w-16 rounded-lg border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60" />
                <Button size="sm" variant="outline" disabled={!isMgr || busy === 'addr-offset'}
                  onClick={() => {
                    const n = Number(addrDraft.offsetHours ?? String(addr.offsetHours));
                    void save('addr-offset', 'addressPolicy',
                      { ...addr, offsetHours: Number.isFinite(n) && n > 0 && n <= 720 ? n : addr.offsetHours },
                      'Address sharing');
                  }}
                  className="h-8 rounded-lg border-2 px-2.5 font-black uppercase text-[8px] tracking-widest">
                  Set
                </Button>
              </div>
            )}

            {addr.mode !== 'always' && (
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Say this instead</p>
                <div className="flex items-center gap-2">
                  <input aria-label="Area shown before the address is released"
                    placeholder="e.g. Downtown Burlington"
                    value={addrDraft.areaLabel !== undefined ? addrDraft.areaLabel : addr.areaLabel}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddrDraft((d) => ({ ...d, areaLabel: e.target.value }))}
                    disabled={!isMgr}
                    className="h-9 flex-1 rounded-lg border-2 bg-white px-2.5 text-sm font-bold outline-none focus:border-foreground/60" />
                  <Button size="sm" variant="outline" disabled={!isMgr || busy === 'addr-area'}
                    onClick={() => void save('addr-area', 'addressPolicy',
                      { ...addr, areaLabel: String(addrDraft.areaLabel ?? addr.areaLabel).slice(0, 80) }, 'Address sharing')}
                    className="h-9 rounded-lg border-2 px-2.5 font-black uppercase text-[8px] tracking-widest">
                    Set
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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

                {/* Timing — only where this kind actually has a schedule. */}
                {k.timing !== 'immediate' && !k.timingOwnedElsewhere && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-dashed px-2.5 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                      <Clock className="h-3 w-3" /> Sends
                    </span>
                    <span className="flex items-center gap-1.5">
                      <input inputMode="numeric" aria-label={`${k.label} lead time in hours`}
                        value={offsetDraft[k.id] !== undefined ? offsetDraft[k.id] : String(cfg.offsetHours ?? k.defaultOffsetHours ?? 0)}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOffsetDraft((d) => ({ ...d, [k.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                        disabled={!isMgr}
                        className="h-8 w-16 rounded-lg border-2 bg-white px-2 text-center font-mono text-sm font-bold outline-none focus:border-foreground/60" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                        hrs before {k.offsetAnchor}
                      </span>
                      <Button size="sm" variant="outline" disabled={!isMgr || busy === `${k.id}-offset`}
                        onClick={() => void save(`${k.id}-offset`, `messagePolicy.${k.id}.offsetHours`,
                          Math.max(0, Number(offsetDraft[k.id] ?? cfg.offsetHours ?? k.defaultOffsetHours ?? 0)), `${k.label} timing`)}
                        className="h-8 rounded-lg border-2 px-2 font-black uppercase text-[8px] tracking-widest">
                        Set
                      </Button>
                    </span>
                  </div>
                )}
                {k.timingOwnedElsewhere && (
                  <p className="flex items-start gap-1.5 text-[10px] font-bold leading-relaxed text-muted-foreground">
                    <Clock className="mt-0.5 h-3 w-3 shrink-0" /> {k.timingOwnedElsewhere}
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
                      onClick={() => {
                        setEditing(k.id);
                        // Prefill with what ACTUALLY goes out today — their own
                        // wording if they wrote it, otherwise the shipped
                        // default. Editing beats writing from a blank box, and
                        // it means no sentence in the product is hidden.
                        setDraftBody(String(cfg.body || k.defaultBody));
                        setDraftSubject(String(cfg.subject || k.defaultSubject));
                      }}
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
