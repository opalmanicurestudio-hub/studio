
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
import { FormField } from './FieldEditor';
import { FormFieldRenderer } from './FormFieldRenderer';

type ConsentForm = {
  id: string;
  title: string;
  category: 'Intake' | 'Waiver' | 'Release' | 'General';
  clientsSigned: number;
  totalClients: number;
  isPasswordProtected: boolean;
  notifyOnEdit: boolean;
  fields?: FormField[];
};

interface PreviewConsentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ConsentForm;
}

const PreviewContent = ({ form }: { form: ConsentForm }) => (
  <ScrollArea className="h-[70vh] pr-4">
    <div className="space-y-6">
      {form.fields && form.fields.length > 0 ? (
        form.fields.map(field => <FormFieldRenderer key={field.id} field={field} />)
      ) : (
        <p className="text-center text-muted-foreground p-8">This form has no fields.</p>
      )}
    </div>
  </ScrollArea>
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
        <SheetContent side="bottom" className="h-[95vh] flex flex-col">
          <SheetHeader className="text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>This is what your client will see.</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 overflow-y-auto">
            <PreviewContent form={form} />
          </div>
          <SheetFooter>
            <Button onClick={() => onOpenChange(false)} className="w-full">Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>This is what your client will see.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <PreviewContent form={form} />
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
