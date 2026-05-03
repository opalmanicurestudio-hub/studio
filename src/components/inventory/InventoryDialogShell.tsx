'use client';

/**
 * InventoryDialogShell
 *
 * Shared wrapper used by all inventory add/edit dialogs.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The previous pattern was:
 *
 *   const DialogContainer = isMobile ? Sheet : Dialog;
 *   <DialogContainer ...>
 *     <DialogContent side="right" ...>   ← BUG
 *
 * `side` is a SheetContent-only prop. Passing it to DialogContent causes
 * Radix's focus trap / portal cleanup to fail silently. The backdrop
 * `aria-hidden` attribute or `pointer-events:none` body style is left in place
 * after the dialog closes, requiring a full page refresh to restore
 * interactivity.
 *
 * This shell renders the correct component tree for each viewport so no
 * cross-contamination of props ever occurs.
 *
 * SCROLL FIX
 * ──────────
 * Desktop: DialogContent gets `flex flex-col overflow-hidden` + explicit
 * max-height. Children must use `flex-1 min-h-0` to let their inner
 * ScrollArea claim remaining space. Applying overflow-hidden to DialogContent
 * prevents double scrollbars while the internal ScrollArea handles the rest.
 *
 * Mobile: SheetContent `h-[92dvh]` with the same flex rules.
 */

import React from 'react';
import {
  Dialog, DialogContent,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Extra classes applied to the desktop DialogContent wrapper */
  desktopClassName?: string;
  /** Extra classes applied to the mobile SheetContent wrapper */
  mobileClassName?: string;
  /** Max-width of the desktop dialog. Default: sm:max-w-4xl */
  maxWidth?: string;
};

export function InventoryDialogShell({
  open,
  onOpenChange,
  children,
  desktopClassName,
  mobileClassName,
  maxWidth = 'sm:max-w-4xl',
}: Props) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          // No `side` confusion — SheetContent always receives it here
          className={cn(
            'h-[92dvh] rounded-t-[2.5rem] p-0 border-none flex flex-col',
            'shadow-2xl overflow-hidden',
            mobileClassName,
          )}
        >
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // IMPORTANT: no `side` prop here — this is DialogContent, not SheetContent
        className={cn(
          maxWidth,
          'max-h-[90dvh]',
          'p-0 border-4 rounded-[2.5rem]',
          'flex flex-col',
          'overflow-hidden',   // ← prevents body scroll leak
          'shadow-2xl',
          desktopClassName,
        )}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}