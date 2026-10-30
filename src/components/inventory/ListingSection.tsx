'use client';
// src/components/inventory/ListingSection.tsx — one collapsible section of a product's In the shop tab, with its own
// save, so a phone that rings mid-edit costs only the section in hand.
import { ChevronDown, Loader } from 'lucide-react';
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** One collapsible section with its own save — the unit of work. */
export function Section({
  title, hint, children, onSave, dirty,
}: { title: string; hint: string; children: React.ReactNode; onSave: () => void; dirty: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[1.5rem] border-2 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-black uppercase tracking-tight text-sm">{title}</span>
          <span className="mt-0.5 block text-[11px] font-bold text-muted-foreground">{hint}</span>
        </span>
        {dirty && (
          <Badge className="bg-amber-500 text-white border-none h-5 px-2 font-black text-[8px] uppercase tracking-widest">
            Unsaved
          </Badge>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-3 border-t-2 px-5 py-4">
          {children}
          <Button
            disabled={!dirty || busy}
            onClick={async () => { setBusy(true); try { await onSave(); } finally { setBusy(false); } }}
            className="h-11 w-full rounded-xl font-black uppercase text-[10px] tracking-widest"
          >
            {busy ? <Loader className="h-4 w-4 animate-spin" /> : dirty ? 'Save this section' : 'Saved'}
          </Button>
        </div>
      )}
    </div>
  );
}

