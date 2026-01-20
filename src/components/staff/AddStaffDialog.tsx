

'use client';

import React, { useState, useEffect } from 'react';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { PhoneInput } from '@/components/ui/phone-input';
import { type Staff } from '@/lib/data';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '../ui/scroll-area';
import { User, Wallet, CalendarIcon, Shield, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const addStaffSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  phone: z.string().optional(),
  role: z.enum(['admin', 'staff']),
  payStructure: z.enum(['commission', 'hourly', 'salary']),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  emergencyContact: z.object({
      name: z.string().optional(),
      relationship: z.string().optional(),
      phone: z.string().optional(),
  }).optional(),
  availabilityNotes: z.string().optional(),
  preferences: z.string().optional(),
  compliance: z.object({
      licenseNumber: z.string().optional(),
      licenseExpiry: z.date().optional(),
      documentUrl: z.string().optional(),
  }).optional(),
}).refine(data => {
    if (data.payStructure === 'commission') {
        return data.commissionRate !== undefined && data.commissionRate !== null;
    }
    if (data.payStructure === 'hourly') {
        return data.hourlyRate !== undefined && data.hourlyRate !== null;
    }
    return true;
}, {
    message: "A rate is required for this pay structure.",
    path: ["commissionRate"],
});


type AddStaffFormData = z.infer<typeof addStaffSchema>;

interface AddStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (staffData: Omit<Staff, 'id' | 'avatarUrl'>) => void;
}

const AddStaffForm = () => {
    const { register, control, watch, formState: { errors } } = useForm<AddStaffFormData>();
    const payStructure = watch('payStructure');

    return (
        <FormProvider {...{register, control, watch, errors}}>
            <div className="space-y-6">
                <Accordion type="multiple" defaultValue={['item-1']} className="w-full space-y-4">
                    <AccordionItem value="item-1" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><User className="w-5 h-5 text-primary"/>Basic Information</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0 space-y-4">
                            <div className="space-y-2"><Label htmlFor="name">Full Name</Label><Input id="name" placeholder="e.g., Brenda Barnes" {...register('name')} />{errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}</div>
                            <div className="space-y-2"><Label htmlFor="email">Email Address</Label><Input id="email" type="email" placeholder="brenda@example.com" {...register('email')} />{errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}</div>
                            <PhoneInput name="phone" label="Phone Number" />
                            <Controller name="role" control={control} render={({ field }) => ( <div className="space-y-2"><Label htmlFor="role">Role</Label><Select onValueChange={field.onChange} defaultValue={field.value}><SelectTrigger id="role"><SelectValue placeholder="Select a role" /></SelectTrigger><SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select>{errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}</div> )}/>
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-2" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><Wallet className="w-5 h-5 text-primary"/>Pay Structure</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0 space-y-4">
                             <Controller name="payStructure" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="payStructure">Pay Structure</Label><Select onValueChange={field.onChange} defaultValue={field.value}><SelectTrigger id="payStructure"><SelectValue placeholder="Select a pay structure" /></SelectTrigger><SelectContent><SelectItem value="commission">Commission</SelectItem><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="salary">Salary</SelectItem></SelectContent></Select>{errors.payStructure && <p className="text-sm text-destructive">{errors.payStructure.message}</p>}</div> )}/>
                            {payStructure === 'commission' && ( <Controller name="commissionRate" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="commissionRate">Commission Rate (%)</Label><Input id="commissionRate" type="number" placeholder="e.g., 40" {...field} />{errors.commissionRate && <p className="text-sm text-destructive">{errors.commissionRate.message}</p>}</div> )}/> )}
                            {payStructure === 'hourly' && ( <Controller name="hourlyRate" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="hourlyRate">Hourly Rate ($)</Label><Input id="hourlyRate" type="number" placeholder="e.g., 25" {...field} />{errors.hourlyRate && <p className="text-sm text-destructive">{errors.hourlyRate.message}</p>}</div> )}/> )}
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="item-3" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><Shield className="w-5 h-5 text-primary"/>Emergency Contact</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0 space-y-4">
                             <div className="space-y-2"><Label htmlFor="emergencyContact.name">Contact Name</Label><Input id="emergencyContact.name" placeholder="e.g., John Barnes" {...register('emergencyContact.name')} /></div>
                             <div className="space-y-2"><Label htmlFor="emergencyContact.relationship">Relationship</Label><Input id="emergencyContact.relationship" placeholder="e.g., Spouse" {...register('emergencyContact.relationship')} /></div>
                            <PhoneInput name="emergencyContact.phone" label="Contact Phone" />
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="item-4" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><FileText className="w-5 h-5 text-primary"/>Compliance & Licensing</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0 space-y-4">
                            <div className="space-y-2"><Label htmlFor="compliance.licenseNumber">License Number</Label><Input id="compliance.licenseNumber" placeholder="e.g., C-123456" {...register('compliance.licenseNumber')} /></div>
                            <Controller name="compliance.licenseExpiry" control={control} render={({ field }) => ( <div className="space-y-2"><Label>License Expiry</Label><Popover><PopoverTrigger className={cn('w-full justify-start text-left font-normal', buttonVariants({ variant: 'outline' }), !field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover></div> )}/>
                            <Controller name="compliance.documentUrl" control={control} render={({ field }) => ( <div className="space-y-2"><Label>Upload License</Label><ImageUpload onImageUploaded={field.onChange} /></div> )}/>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="item-5" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><FileText className="w-5 h-5 text-primary"/>Notes & Preferences</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0 space-y-4">
                             <div className="space-y-2"><Label htmlFor="availabilityNotes">Availability Notes</Label><Textarea id="availabilityNotes" placeholder="e.g., Prefers morning shifts, not available on weekends." {...register('availabilityNotes')} /></div>
                             <div className="space-y-2"><Label htmlFor="preferences">Preferences</Label><Textarea id="preferences" placeholder="e.g., Allergic to lavender, prefers working with specific product lines." {...register('preferences')} /></div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </FormProvider>
    )
}

export const AddStaffDialog: React.FC<AddStaffDialogProps> = ({
  open,
  onOpenChange,
  onSave,
}) => {
  const methods = useForm<AddStaffFormData>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: {
      name: '',
      email: '',
      role: 'staff',
      payStructure: 'commission',
      commissionRate: 40,
    },
  });

  const { handleSubmit, reset } = methods;
  const isMobile = useIsMobile();

  const handleSave = (data: AddStaffFormData) => {
    const staffDataToSave: Omit<Staff, 'id' | 'avatarUrl'> = {
        ...data,
        commissionRate: data.commissionRate || 0,
        compliance: data.compliance?.licenseExpiry 
            ? { ...data.compliance, licenseExpiry: data.compliance.licenseExpiry.toISOString() }
            : data.compliance
    };
    onSave(staffDataToSave);
    reset();
    onOpenChange(false);
  };
  
  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : undefined} className={isMobile ? "h-[90vh] p-0 flex flex-col" : "sm:max-w-2xl"}>
            <DialogHeader className="p-6 pb-0">
                <DialogTitle>Add New Staff Member</DialogTitle>
                <DialogDescription>
                    Enter the details for your new team member. They will receive an invitation via email.
                </DialogDescription>
            </DialogHeader>
             <FormProvider {...methods}>
                <form id="add-staff-form-comprehensive" onSubmit={handleSubmit(handleSave)} className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full px-6 py-4">
                        <AddStaffForm />
                    </ScrollArea>
                </form>
             </FormProvider>
            <DialogFooter className="p-6 pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" form="add-staff-form-comprehensive">Save & Send Invite</Button>
            </DialogFooter>
        </ContentComponent>
    </DialogComponent>
  );
};
