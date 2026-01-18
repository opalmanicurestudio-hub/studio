
'use client';

import React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { FormFieldRenderer } from './FormFieldRenderer';
import { type ConsentForm } from '@/lib/data';


interface PreviewConsentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ConsentForm;
}

const PreviewContent = ({ form }: { form: ConsentForm }) => (
    <div className="space-y-6">
      {form.fields && form.fields.length > 0 ? (
        form.fields.map(field => <FormFieldRenderer key={field.id} field={field} />)
      ) : (
        <p className="text-center text-muted-foreground p-8">This form has no fields.</p>
      )}
    </div>
);

export const PreviewConsentFormDialog: React.FC<PreviewConsentFormDialogProps> = ({
  open,
  onOpenChange,
  form,
}) => {
  const isMobile = useIsMobile();
  const title = `Preview: ${form.title}`;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0">
          <SheetHeader className="p-6 pb-4 text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>This is what your client will see.</SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
             <div className="px-6 pb-6">
                <PreviewContent form={form} />
             </div>
          </ScrollArea>
          <SheetFooter className="p-4 border-t bg-background">
            <Button onClick={() => onOpenChange(false)} className="w-full">Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>This is what your client will see.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 max-h-[70vh]">
            <div className="px-6 pb-6">
                <PreviewContent form={form} />
            </div>
        </ScrollArea>
        <DialogFooter className="p-6 pt-4 border-t">
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
