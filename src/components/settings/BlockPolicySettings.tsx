'use client';

import React from 'react';
import { CalendarOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  BLOCK_TYPES, DEFAULT_BLOCK_POLICY,
  type BlockPermission, type BlockPolicy,
} from '@/lib/block-policy';

const CHOICES: Array<{ id: BlockPermission; label: string }> = [
  { id: 'free', label: 'Free' },
  { id: 'notify', label: 'Tell me' },
  { id: 'approval', label: 'Approve' },
];

export function BlockPolicySettings({
  policy,
  canEdit,
  busy,
  onSave,
}: {
  policy: BlockPolicy | null;
  canEdit: boolean;
  busy?: string | null;
  onSave: (key: string, field: string, value: any, label: string) => void | Promise<void>;
}) {
  const p = policy || {};
  const ruleFor = (id: string) => p[id as keyof BlockPolicy] || DEFAULT_BLOCK_POLICY[id as keyof typeof DEFAULT_BLOCK_POLICY];

  const write = (id: string, patch: any, key: string) =>
    onSave(key, 'blockPolicy', { ...p, [id]: { ...ruleFor(id), ...patch } }, 'Calendar blocks');

  const gated = BLOCK_TYPES.filter(b => ruleFor(b.id)?.permission === 'approval').length;

  return (
    <Card className="border-2 rounded-[2rem] bg-white">
      <CardContent className="p-5 space-y-4">
        <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          <CalendarOff className="h-3 w-3" aria-hidden="true" /> Blocking their own calendar
        </p>
        <p className="text-[11px] font-bold leading-relaxed text-muted-foreground">
          A block is a decline made in advance, so this is the other half of booking authority. Renters and
          contractors are never gated here — their calendar is their business. Neither are managers.
        </p>
        <p className="rounded-xl border-2 border-dashed px-3 py-2 text-[11px] font-bold leading-relaxed text-foreground">
          {gated === 0
            ? 'Nothing needs your approval right now. Anyone can block any time they like.'
            : `${gated} of ${BLOCK_TYPES.length} kinds need your approval. The rest go straight on.`}
        </p>

        <div className="space-y-2">
          {BLOCK_TYPES.map(b => {
            const rule = ruleFor(b.id);
            const cap = typeof rule?.dailyCapMinutes === 'number' ? rule.dailyCapMinutes : 0;
            return (
              <div key={b.id} className="rounded-2xl border-2 border-border bg-white p-3 space-y-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-black tracking-tight text-foreground">{b.label}</p>
                  <p className="text-[11px] font-bold leading-snug text-muted-foreground">{b.blurb}</p>
                </div>

                <div className="flex gap-1.5">
                  {CHOICES.map(c => {
                    const active = rule?.permission === c.id;
                    return (
                      <Button
                        key={c.id}
                        variant="outline"
                        disabled={!canEdit || !!busy}
                        aria-pressed={active}
                        aria-label={`${b.label}: ${c.label}`}
                        onClick={() => write(b.id, { permission: c.id }, `blk-${b.id}-${c.id}`)}
                        className={cn(
                          'h-8 flex-1 rounded-lg border-2 text-[10px] font-black uppercase tracking-widest',
                          active && 'border-primary bg-primary/[0.06] text-primary',
                        )}
                      >
                        {c.label}
                      </Button>
                    );
                  })}
                </div>

                {rule?.permission !== 'approval' && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={480} inputMode="numeric"
                      defaultValue={String(cap)}
                      disabled={!canEdit || !!busy}
                      aria-label={`Daily limit for ${b.label} in minutes`}
                      onBlur={(e) => {
                        const v = Math.max(0, Math.min(480, Number(e.target.value) || 0));
                        if (v !== cap) write(b.id, { dailyCapMinutes: v || undefined }, `cap-${b.id}`);
                      }}
                      className="h-9 w-20 rounded-lg border-2 text-[13px]"
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {cap > 0 ? 'min a day' : 'no daily limit'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
