'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { resolveReasonList, type AuthorityPolicy, type DeclineReason } from '@/lib/appointment-authority';

const GROUP_ORDER: Array<{ key: string; label: string }> = [
  { key: 'service', label: 'The service' },
  { key: 'client', label: 'The client' },
  { key: 'schedule', label: 'My schedule' },
  { key: 'operational', label: 'Something we need' },
  { key: 'personal', label: 'Me' },
];

export function ReportIssueDialog({
  open,
  onOpenChange,
  clientName,
  policy,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientName?: string;
  policy?: AuthorityPolicy | null;
  busy?: boolean;
  onSubmit: (code: string, note: string) => void | Promise<void>;
}) {
  const [code, setCode] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [touched, setTouched] = useState(false);

  const reasons = useMemo(() => resolveReasonList(policy), [policy]);
  const grouped = useMemo(() => {
    const map = new Map<string, DeclineReason[]>();
    reasons.forEach(r => {
      const list = map.get(r.group) || [];
      list.push(r);
      map.set(r.group, list);
    });
    return GROUP_ORDER
      .map(g => ({ ...g, items: map.get(g.key) || [] }))
      .filter(g => g.items.length > 0);
  }, [reasons]);

  const chosen = reasons.find(r => r.code === code) || null;
  const needsNote = chosen?.code === 'other' || chosen?.code.endsWith(':other');

  const submit = () => {
    setTouched(true);
    if (!chosen) return;
    if (needsNote && !note.trim()) return;
    void onSubmit(chosen.code, note.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) { setCode(''); setNote(''); setTouched(false); }
      }}
    >
      <DialogContent className="rounded-2xl border-2 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-black tracking-tight">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Report an issue
          </DialogTitle>
          <DialogDescription className="text-[12px] font-bold leading-snug text-muted-foreground">
            {clientName ? `${clientName} keeps their time while this is sorted.` : 'The booking is kept while this is sorted.'} A manager picks it up from here.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45dvh] space-y-4 overflow-y-auto pr-1">
          {grouped.map(group => (
            <div key={group.key} className="space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{group.label}</p>
              <div className="grid gap-1.5">
                {group.items.map(r => (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => setCode(r.code)}
                    aria-pressed={code === r.code}
                    className={cn(
                      'w-full rounded-xl border-2 px-3 py-2.5 text-left text-[12px] font-bold leading-snug transition-colors active:scale-[0.99]',
                      code === r.code
                        ? 'border-primary bg-primary/[0.06] text-foreground'
                        : 'border-border bg-white text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="issue-note" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Anything a manager should know{needsNote ? '' : ' (optional)'}
          </Label>
          <Textarea
            id="issue-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Kept between you and management."
            className="rounded-xl border-2 text-[13px]"
          />
          {touched && !chosen && (
            <p className="text-[12px] font-bold text-destructive">Pick a reason first.</p>
          )}
          {touched && chosen && needsNote && !note.trim() && (
            <p className="text-[12px] font-bold text-destructive">Add a short note so this can be handled.</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!!busy}
            className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest"
            onClick={submit}
          >
            {busy ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Send to a manager'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
