
'use client';

import React, { useState, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Client } from '@/lib/data';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Textarea } from '../ui/textarea';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ShieldAlert, AlertTriangle, Ear, Upload } from 'lucide-react';
import { ImageUpload } from '../shared/ImageUpload';

const clientSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('Invalid email address.'),
  phone: z.string().min(1, 'Phone number is required.'),
  avatarUrl: z.string().optional(),
  medicalNotes: z.string().optional(),
  allergyNotes: z.string().optional(),
  sensoryNeeds: z.string().optional(),
  notes: z.string().optional(),
});

type ClientFormData = z.infer<typeof clientSchema>;

const EditClientIntelCategory = ({
  title,
  icon,
  fieldName,
}: {
  title: string;
  icon: React.ReactNode;
  fieldName: keyof ClientFormData;
}) => {
  const { control } = useFormContext<ClientFormData>();
  return (
    <AccordionItem value={title.toLowerCase().replace(' ', '-')}>
      <AccordionTrigger>{title}</AccordionTrigger>
      <AccordionContent>
        <Controller
          name={fieldName}
          control={control}
          render={({ field }) => (
            <Textarea
              placeholder={`Enter ${title.toLowerCase()} notes...`}
              {...field}
            />
          )}
        />
      </AccordionContent>
    </AccordionItem>
  );
};


const EditClientForm = ({ client }: { client: Client }) => {
  const { register, control, formState: { errors } } = useFormContext<ClientFormData>();

  return (
    <div className="space-y-6">
        <div className="space-y-2">
            <Label>Profile Picture</Label>
            <div className="flex items-center gap-4">
                 <Controller
                    name="avatarUrl"
                    control={control}
                    render={({ field }) => (
                         <Avatar className="w-20 h-20">
                            <AvatarImage src={field.value || undefined} alt={client.name} />
                            <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                        </Avatar>
                    )}
                 />
                 <Controller
                    name="avatarUrl"
                    control={control}
                    render={({ field }) => (
                        <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                    )}
                 />
            </div>
        </div>

      <div className="space-y-2">
        <Label htmlFor="name">Full Name</Label>
        <Input id="name" {...register('name')} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register('email')} />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone Number</Label>
        <Input id="phone" type="tel" {...register('phone')} />
        {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
      </div>
      
       <Accordion type="multiple" className="w-full space-y-4">
          <EditClientIntelCategory
            title="Medical & Health"
            icon={<ShieldAlert className="w-5 h-5 text-red-500" />}
            fieldName="medicalNotes"
          />
          <EditClientIntelCategory
            title="Allergies & Sensitivities"
            icon={<AlertTriangle className="w-5 h-5 text-amber-500" />}
            fieldName="allergyNotes"
          />
          <EditClientIntelCategory
            title="Disabilities & Sensory Needs"
            icon={<Ear className="w-5 h-5 text-blue-500" />}
            fieldName="sensoryNeeds"
          />
        </Accordion>
        
        <div className="space-y-2">
            <Label htmlFor="general-notes">General Notes</Label>
            <Controller
              name="notes"
              control={control}
              render={({ field }) => (
                <Textarea id="general-notes" placeholder="General client notes, preferences, etc." {...field} />
              )}
            />
        </div>

    </div>
  );
};

export const EditClientDialog = ({
  open,
  onOpenChange,
  client,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
  onSave: (data: Partial<Client>) => void;
}) => {
  const isMobile = useIsMobile();
  const methods = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
  });

  useEffect(() => {
    if (client) {
      methods.reset({
        name: client.name,
        email: client.email,
        phone: client.phone,
        avatarUrl: client.avatarUrl,
        medicalNotes: client.medicalNotes || '',
        allergyNotes: client.allergyNotes || '',
        sensoryNeeds: client.sensoryNeeds || '',
        notes: client.notes || '',
      });
    }
  }, [client, methods]);

  const handleSave = (data: ClientFormData) => {
    onSave(data);
  };
  
  const title = `Edit ${client.name}`;
  const description = "Update the client's information.";

  const formId = `edit-client-form-${client.id}`;
  
  const FormContent = (
    <FormProvider {...methods}>
      <form id={formId} onSubmit={methods.handleSubmit(handleSave)}>
        <ScrollArea className="h-[70vh] pr-4">
          <EditClientForm client={client} />
        </ScrollArea>
      </form>
    </FormProvider>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] flex flex-col">
          <SheetHeader className="text-left px-4">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4 flex-1 px-4">{FormContent}</div>
          <SheetFooter className="px-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form={formId} className="w-full">Save Changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">{FormContent}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={formId}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
