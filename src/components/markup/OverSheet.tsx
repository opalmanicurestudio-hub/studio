'use client';
// src/components/markup/OverSheet.tsx — a full-screen markup screen over the appointment's own sheet. The sheet is a
// dialog that keeps the keys, the focus and the pointer to itself, so anything opened from it (the markup tool,
// Compare) opens as a dialog of its own, on top, and is drawn inside it (`inline`). Leaving is the screen's own: a click
// outside, Escape and focus moving away never close it from here.
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export function OverSheet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} className="fixed inset-0 z-[400] outline-none">
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>);
}
