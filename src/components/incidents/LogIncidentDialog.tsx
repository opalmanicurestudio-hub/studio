

'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LogIncidentForm, type IncidentFormData } from './LogIncidentForm';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { incidentSchema } from './LogIncidentForm';
import type { Client } from '@/lib/data';
import { ScrollArea } from '../ui/scroll-area';

interface LogIncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
  onIncidentLogged: (incident: IncidentFormData) => void;
}

export const LogIncidentDialog: React.FC<LogIncidentDialogProps> = ({
  open,
  onOpenChange,
  client,
  onIncidentLogged,
}) => {
  const methods = useForm<IncidentFormData>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      type: 'Other',
      severity: 'Minor',
      description: '',
      actionsTaken: '',
      photoUrls: [],
    }
  });

  const { handleSubmit, reset } = methods;

  const handleFormSubmit = (data: IncidentFormData) => {
    onIncidentLogged(data);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log New Incident</DialogTitle>
          <DialogDescription>
            Create a formal record for an event involving {client.name}.
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...methods}>
          <form id="log-incident-form" onSubmit={handleSubmit(handleFormSubmit)}>
             <ScrollArea className="max-h-[60vh] -mr-6 pr-6">
                 <div className="py-4 pl-6">
                    <LogIncidentForm />
                 </div>
            </ScrollArea>
          </form>
        </FormProvider>
        <DialogFooter className="pt-4 border-t pr-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="log-incident-form">Log Incident</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
