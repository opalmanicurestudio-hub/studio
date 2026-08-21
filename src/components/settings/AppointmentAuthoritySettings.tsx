'use client';

import React, { useMemo, useState } from 'react';
import { Plus, ShieldCheck, Trash2, Users2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  DECLINE_REASONS,
  DEFAULT_AUTO_CODES,
  customReasonCode,
  resolveReasonList,
  type AuthorityPolicy,
  type DecisionAuthority,
} from '@/lib/appointment-authority';

const OVERDUE_ACTIONS: Array<{ id: 'escalate' | 'auto_accept' | 'raise_issue'; label: string; blurb: string }> = [
  { id: 'escalate', label: 'Tell a manager', blurb: 'Somebody picks up the phone. The booking is untouched.' },
  { id: 'raise_issue', label: 'Put it in the issue queue', blurb: 'Handled the same way every other exception is.' },
  { id: 'auto_accept', label: 'Accept it for them', blurb: 'Only for people who could have declined it — everyone else falls back to telling a manager.' },
];

/**
 * EVERY CONTROL BELOW IS DOWNSTREAM OF A DECISION ALREADY MADE.
 *
 * The response window, the overdue behaviour, the nudge, the auto-accept floor
 * and the self-serve ticks were all rendered unconditionally, so a shop that
 * had set none of it still scrolled past six controls that could not do
 * anything. A setting that cannot take effect yet is not information — it is
 * noise that makes the settings that DO matter harder to find.
 *
 * So each one appears only once its prerequisite is on:
 *   response window > 0        → what to do when it elapses, and the nudge
 *   overdue action = accept    → who that is allowed to happen for
 *   ceiling = approved reasons → which reasons a provider may settle alone
 *
 * Turning a prerequisite back off hides its dependants but never clears them,
 * so a shop that experiments does not lose what it configured.
 */
const AUTO_ACCEPT_FLOORS: Array<{ id: DecisionAuthority; label: string }> = [
  { id: 'limited', label: 'Anyone who may decline for approved reasons' },
  { id: 'request_approval', label: 'Anyone who may raise it with a manager' },
  { id: 'full', label: 'Only people who answer their own bookings' },
];

const CEILINGS: Array<{ id: DecisionAuthority | 'unset'; label: string; blurb: string }> = [
  { id: 'unset', label: 'No ceiling', blurb: 'Everyone stays on whatever their working relationship gives them.' },
  { id: 'none', label: 'Assigned only', blurb: 'Eligible bookings simply appear. Employees report issues rather than decline.' },
  { id: 'limited', label: 'Approved reasons', blurb: 'They may release a booking for the reasons you tick below, and no others.' },
  { id: 'request_approval', label: 'A manager decides', blurb: 'They may raise anything; the call is always a manager\u2019s.' },
];

export function AppointmentAuthoritySettings({
  policy,
  canEdit,
  busy,
  onSave,
}: {
  policy: AuthorityPolicy | null;
  canEdit: boolean;
  busy?: string | null;
  onSave: (key: string, field: string, value: any, label: string) => void | Promise<void>;
}) {
  const [newLabel, setNewLabel] = useState('');
  const p = policy || {};
  const ceiling = p.maxProviderAuthority || 'unset';
  const autoCodes = p.autoDeclineCodes || DEFAULT_AUTO_CODES;
  const custom = p.customReasons || [];
  const hidden = p.hiddenReasonCodes || [];
  const shown = useMemo(() => resolveReasonList(p), [p]);
  const responseHours = Number(p.providerResponseHours ?? 0);
  /* The self-serve tick only means something when the shop has said providers
   * may decline for approved reasons. At every other ceiling the answer is
   * already "a manager decides", so offering the tick invites someone to set
   * a rule that will never fire. */
  const selfServeApplies = ceiling === 'limited';

  const write = (patch: Partial<AuthorityPolicy>, key: string, label: string) =>
    onSave(key, 'appointmentAuthority', { ...p, ...patch }, label);

  const toggleAuto = (code: string) => {
    const next = autoCodes.includes(code) ? autoCodes.filter(c => c !== code) : [...autoCodes, code];
    write({ autoDeclineCodes: next }, `auto-${code}`, 'Approved reasons');
  };

  const toggleHidden = (code: string) => {
    const next = hidden.includes(code) ? hidden.filter(c => c !== code) : [...hidden, code];
    write({ hiddenReasonCodes: next }, `hide-${code}`, 'Reason list');
  };

  const addCustom = () => {
    const label = newLabel.trim();
    if (!label) return;
    const code = customReasonCode(label);
    if (!code || code === 'custom:' || custom.some(c => c.code === code)) { setNewLabel(''); return; }
    write({ customReasons: [...custom, { code, label, group: 'personal', resolution: 'manager' }] }, 'add-reason', 'Your reasons');
    setNewLabel('');
  };

  const removeCustom = (code: string) =>
    write({
      customReasons: custom.filter(c => c.code !== code),
      autoDeclineCodes: autoCodes.filter(c => c !== code),
    }, `rm-${code}`, 'Your reasons');

  return (
    <>
      <Card className="border-2 rounded-[2rem] bg-white">
        <CardContent className="p-5 space-y-4">
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Users2 className="h-3 w-3" /> What a provider may decide
          </p>
          <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
            A ceiling for employees and commission staff. Renters and contractors run their own book and are never
            capped here — and a manager is never capped at all.
          </p>
          <p className="rounded-xl border-2 border-dashed px-3 py-2 text-[11px] font-bold leading-relaxed text-foreground">
            {ceiling === 'unset'
              ? 'Right now nothing here is capped. Everyone answers their own bookings unless their working relationship says otherwise.'
              : ceiling === 'none'
                ? 'Employees and commission staff report issues instead of declining. A manager handles every one.'
                : ceiling === 'limited'
                  ? `They may settle ${autoCodes.length} of ${shown.length} reasons themselves. Everything else comes to a manager.`
                  : 'They may raise anything, and a manager makes every call.'}
            {responseHours > 0
              ? ` They have ${responseHours} ${responseHours === 1 ? 'hour' : 'hours'} to answer.`
              : ' There is no answer deadline.'}
          </p>
          <div className="space-y-2 rounded-2xl border-2 border-dashed px-4 py-3">
            <Label htmlFor="respond-hours" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              How long they have to answer
            </Label>
            <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
              A booking should not sit unanswered on someone&apos;s screen all day. This is separate from the window you
              promise the client — leave it at 0 for no deadline.
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="respond-hours"
                type="number" min={0} max={168} inputMode="numeric"
                defaultValue={String(p.providerResponseHours ?? 0)}
                disabled={!canEdit || !!busy}
                onBlur={(e) => {
                  const v = Math.max(0, Math.min(168, Number(e.target.value) || 0));
                  if (v !== Number(p.providerResponseHours ?? 0)) {
                    void write({ providerResponseHours: v || undefined }, 'respond-hours', 'Response window');
                  }
                }}
                className="h-10 w-24 rounded-xl border-2 text-[13px]"
              />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">hours</span>
            </div>
          </div>

          {responseHours > 0 && (
          <div className="space-y-2 rounded-2xl border-2 border-dashed px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              When nobody answers in time
            </p>
            <div className="grid gap-1.5">
              {OVERDUE_ACTIONS.map(a => {
                const active = (p.overdueAction || 'escalate') === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!canEdit || !!busy}
                    aria-pressed={active}
                    onClick={() => write({ overdueAction: a.id }, `overdue-${a.id}`, 'Overdue handling')}
                    className={cn(
                      'rounded-xl border-2 px-3 py-2 text-left transition-colors disabled:opacity-40',
                      active ? 'border-primary bg-primary/[0.05]' : 'border-border bg-white hover:bg-muted/30',
                    )}
                  >
                    <span className="block text-[12px] font-black tracking-tight text-foreground">{a.label}</span>
                    <span className="mt-0.5 block text-[11px] font-bold leading-relaxed text-muted-foreground">{a.blurb}</span>
                  </button>
                );
              })}
            </div>
            <Label htmlFor="nudge-min" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Nudge them first
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="nudge-min"
                type="number" min={0} max={720} inputMode="numeric"
                defaultValue={String(p.overdueReminderMinutes ?? 0)}
                disabled={!canEdit || !!busy}
                onBlur={(e) => {
                  const v = Math.max(0, Math.min(720, Number(e.target.value) || 0));
                  if (v !== Number(p.overdueReminderMinutes ?? 0)) {
                    void write({ overdueReminderMinutes: v || undefined }, 'nudge-min', 'Reminder');
                  }
                }}
                className="h-10 w-24 rounded-xl border-2 text-[13px]"
              />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                min before the deadline
              </span>
            </div>
            <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
              A nudge is what stops most of these becoming anybody&apos;s problem. 0 turns it off.
            </p>

            {p.overdueAction === 'auto_accept' && (
              <div className="space-y-1.5 border-t-2 border-dashed pt-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Accept it for whom
                </p>
                <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
                  Accepting on behalf of somebody who could never have declined is just an assignment with extra
                  steps. Anyone below this falls back to telling a manager.
                </p>
                <div className="grid gap-1.5">
                  {AUTO_ACCEPT_FLOORS.map(fl => {
                    const active = (p.autoAcceptMinAuthority || 'limited') === fl.id;
                    return (
                      <button
                        key={fl.id}
                        type="button"
                        disabled={!canEdit || !!busy}
                        aria-pressed={active}
                        onClick={() => write({ autoAcceptMinAuthority: fl.id }, `floor-${fl.id}`, 'Auto-accept floor')}
                        className={cn(
                          'rounded-xl border-2 px-3 py-2 text-left text-[12px] font-bold transition-colors disabled:opacity-40',
                          active ? 'border-primary bg-primary/[0.05] text-foreground' : 'border-border bg-white text-muted-foreground hover:bg-muted/30',
                        )}
                      >
                        {fl.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          )}

          <div className="grid gap-2">
            {CEILINGS.map(c => {
              const active = ceiling === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!canEdit || !!busy}
                  aria-pressed={active}
                  onClick={() => write(
                    { maxProviderAuthority: c.id === 'unset' ? undefined : (c.id as DecisionAuthority) },
                    `ceiling-${c.id}`,
                    'Provider authority',
                  )}
                  className={cn(
                    'rounded-2xl border-2 px-4 py-3 text-left transition-colors disabled:opacity-40',
                    active ? 'border-primary bg-primary/[0.05]' : 'border-border bg-white hover:bg-muted/30',
                  )}
                >
                  <span className="block text-[12px] font-black tracking-tight text-foreground">{c.label}</span>
                  <span className="mt-0.5 block text-[11px] font-bold leading-relaxed text-muted-foreground">{c.blurb}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 rounded-[2rem] bg-white">
        <CardContent className="p-5 space-y-4">
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Reasons, and which they can settle themselves
          </p>
          <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
            Tick a reason to let a provider release a booking for it without asking. Everything unticked comes to a
            manager instead. Hide anything your trade has no use for.
          </p>

          <div className="space-y-1.5">
            {DECLINE_REASONS.map(r => {
              const isHidden = hidden.includes(r.code);
              const isAuto = autoCodes.includes(r.code);
              return (
                <div
                  key={r.code}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border-2 px-3 py-2',
                    isHidden ? 'border-dashed border-border bg-muted/20 opacity-60' : 'border-border bg-white',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-foreground">{r.label}</span>
                    <span className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {isHidden ? 'Hidden' : !selfServeApplies ? 'Comes to a manager' : isAuto ? 'They can settle it' : 'Comes to a manager'}
                    </span>
                  </span>
                  {selfServeApplies && (
                    <Button
                      variant="outline" disabled={!canEdit || !!busy || isHidden}
                      aria-pressed={isAuto}
                      aria-label={`${isAuto ? 'Stop letting' : 'Let'} providers settle "${r.label}" themselves`}
                      onClick={() => toggleAuto(r.code)}
                      className={cn(
                        'h-8 shrink-0 rounded-lg border-2 px-2.5 text-[9px] font-black uppercase tracking-widest',
                        isAuto && 'border-primary bg-primary/[0.06] text-primary',
                      )}
                    >
                      {isAuto ? 'Self-serve' : 'Manager'}
                    </Button>
                  )}
                  <Button
                    variant="ghost" disabled={!canEdit || !!busy}
                    aria-label={`${isHidden ? 'Show' : 'Hide'} "${r.label}"`}
                    onClick={() => toggleHidden(r.code)}
                    className="h-8 shrink-0 rounded-lg px-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground"
                  >
                    {isHidden ? 'Show' : 'Hide'}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="space-y-2 border-t-2 border-dashed pt-4">
            <Label htmlFor="new-reason" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Your own reasons
            </Label>
            <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
              Whatever this trade actually says. New reasons come to a manager until you tick them above.
            </p>
            {custom.map(c => (
              <div key={c.code} className="flex items-center gap-2 rounded-xl border-2 bg-white px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold text-foreground">{c.label}</span>
                  <span className="block truncate text-[10px] font-black uppercase tracking-widest text-muted-foreground">{c.code}</span>
                </span>
                {selfServeApplies && (
                  <Button
                    variant="outline" disabled={!canEdit || !!busy}
                    aria-pressed={autoCodes.includes(c.code)}
                    onClick={() => toggleAuto(c.code)}
                    className={cn(
                      'h-8 shrink-0 rounded-lg border-2 px-2.5 text-[9px] font-black uppercase tracking-widest',
                      autoCodes.includes(c.code) && 'border-primary bg-primary/[0.06] text-primary',
                    )}
                  >
                    {autoCodes.includes(c.code) ? 'Self-serve' : 'Manager'}
                  </Button>
                )}
                <Button
                  variant="ghost" disabled={!canEdit || !!busy}
                  aria-label={`Remove "${c.label}"`}
                  onClick={() => removeCustom(c.code)}
                  className="h-8 w-8 shrink-0 rounded-lg p-0 text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                id="new-reason"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                maxLength={60}
                disabled={!canEdit || !!busy}
                placeholder="Kitchen closed"
                className="h-10 rounded-xl border-2 text-[13px]"
              />
              <Button
                disabled={!canEdit || !!busy || !newLabel.trim()}
                onClick={addCustom}
                className="h-10 shrink-0 rounded-xl px-3 font-black uppercase text-[9px] tracking-widest"
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Add
              </Button>
            </div>
            <p className="text-[10px] font-bold leading-relaxed text-muted-foreground">
              {shown.length} reason{shown.length === 1 ? '' : 's'} will be offered to providers.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
