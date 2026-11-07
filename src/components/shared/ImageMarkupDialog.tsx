'use client';
// src/components/shared/ImageMarkupDialog.tsx — the team's photo markup on the appointment, the review screen and photo
// uploads. It opens the one markup tool (components/markup/MarkupEditor), which has every tool this screen had (a pen,
// dashed or as a highlighter; text in three sizes; a magnifier lens; arrow, star, warning, check, cross, target and
// numbered stamps that never renumber; a circle sized by dragging; selecting a mark to move, resize and turn it; pan and
// zoom with the wheel; six colors and more, a custom color and picking one from the photo; reset view) and much more.
// On a computer its tools run down the side with a key for each. It opens as a dialog of its own, so it works over the
// appointment's sheet (which keeps the keys and the pointer to itself otherwise); leaving is the editor's own (Cancel,
// Escape and Back ask before anything is lost). The marked-up photo is handed back as
// before (a PNG), so every screen that uses this keeps saving it the same way.
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MarkupEditor } from '@/components/markup/MarkupEditor';

interface ImageMarkupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  onSave: (markedUpDataUrl: string) => void | Promise<void>;
  title?: string;
}

export const ImageMarkupDialog: React.FC<ImageMarkupDialogProps> = ({ open, onOpenChange, imageUrl, onSave, title }) => {
  if (!open || !imageUrl) return null;
  const name = title || 'Mark up the photo';
  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} className="fixed inset-0 z-[400] outline-none">
          <DialogPrimitive.Title className="sr-only">{name}</DialogPrimitive.Title>
          <MarkupEditor inline src={imageUrl} layer="team" title={name} doneLabel="Save markup" format="png" sendLayers={['client', 'team']}
            onCancel={() => onOpenChange(false)}
            onDone={async (r) => {
              try { await onSave(r.dataUrl); onOpenChange(false); return null; }
              catch { return 'That didn’t save. Please try again.'; }
            }} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ImageMarkupDialog;
