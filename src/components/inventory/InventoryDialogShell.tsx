'use client';

/**
 * InventoryDialogShell
 *
 * Shared wrapper for all inventory add/edit dialogs.
 * Handles the mobile (Sheet) vs desktop (Dialog) split cleanly so no
 * cross-prop contamination ever occurs, and sets up the correct CSS chain
 * for header-fixed / body-scrolling / footer-fixed layouts.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The original dialogs passed `side="right"` to DialogContent (a SheetContent-
 * only prop). Radix forwards unknown props silently but the portal cleanup
 * fails, leaving pointer-events:none on the page after close.
 *
 * ── SCROLL CHAIN (how desktop scroll works) ──────────────────────────────────
 *  1. DialogContent gets h-[90dvh] (NOT max-h).
 *     max-h only caps height; it never DEFINES it. Without a concrete height,
 *     flex children have nothing to fill and collapse to zero.
 *
 *  2. DialogContent needs !flex because shadcn bakes `grid` into its default
 *     className. In Tailwind's generated CSS, `.grid` appears after `.flex`,
 *     so `grid` wins on specificity. `!flex` = `display:flex !important`.
 *
 *  3. Every dialog's <form> must have:  `flex flex-col flex-1 min-h-0`
 *     min-h-0 is the critical piece — it lets a flex child shrink below its
 *     intrinsic content size, which is what allows the inner scroll region
 *     to be shorter than the full form content.
 *
 *  4. The scrollable body region must be a native div (not Radix ScrollArea).
 *     Radix ScrollArea wraps in `overflow:hidden` which breaks the flex chain.
 *     Use: <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
 *
 *  5. Header and footer must have `flex-shrink-0` so they never compress.
 */

import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  desktopClassName?: string;
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
          className={cn(
            'h-[92dvh] rounded-t-[2.5rem]',
            'p-0 border-none',
            '!flex flex-col',
            'overflow-hidden',
            'shadow-2xl',
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
        className={cn(
          maxWidth,
          // Explicit height — MUST be h- not max-h so flex children fill it
          'h-[90dvh]',
          // !flex overrides shadcn's default `grid` (which would win by CSS order)
          '!flex flex-col',
          // Remove shadcn's default padding and gap
          'p-0 gap-0',
          // Clip overflow so header/footer stay fixed
          'overflow-hidden',
          // App's rounded corner style
          'border-4 rounded-[2.5rem]',
          'shadow-2xl',
          desktopClassName,
        )}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}