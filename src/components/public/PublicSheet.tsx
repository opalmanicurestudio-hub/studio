'use client';
// src/components/public/PublicSheet.tsx — a panel over a public page (the booking page's full policy, member sign-in):
// rises from the bottom on a phone, sits in the middle on a wide screen. Escape, the close button or a tap outside
// closes it; focus moves into it and back to where it was; Tab stays inside while it's open.

import * as React from 'react';
import { X } from 'lucide-react';

export function PublicSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const box = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose); closeRef.current = onClose;
  React.useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(box.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])') || []).filter((el) => el.tabIndex >= 0);
    requestAnimationFrame(() => { const f = focusables(); (f.find((el) => el.tagName === 'INPUT') || f[0])?.focus(); });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      // Focus outside the panel (a tap on its text leaves it on the page behind): Tab brings it back in.
      if (!box.current?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    const scroll = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = scroll; before?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-stone-900/40" onClick={onClose} aria-hidden />
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="outline-none pub-rise pub-safe-bottom relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] bg-[#faf8f5] px-5 pt-5 shadow-xl sm:max-w-lg sm:rounded-[1.75rem] sm:pb-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[20px] tracking-tight" style={{ fontWeight: 600 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-stone-600 shadow-sm"><X className="h-5 w-5" aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
