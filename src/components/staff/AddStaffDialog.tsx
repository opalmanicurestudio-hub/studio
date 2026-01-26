

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
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
import { type Staff, type Service } from '@/lib/data';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '../ui/scroll-area';
import { User, Wallet, CalendarIcon, Shield, FileText, List, PlusCircle, Trash2, BookText, Instagram, Link as LinkIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { buttonVariants } from '../ui/button';
import { nanoid } from 'nanoid';
import { SelectServicesDialog } from './SelectServicesDialog';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';

const addStaffSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  bio: z.string().optional(),
  specialties: z.string().optional(),
  instagramUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  portfolioUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  role: z.enum(['admin', 'staff']),
  payStructure: z.enum(['commission', 'hourly', 'salary']),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  services: z.array(z.string()).optional(),
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
}).superRefine((data, ctx) => {
    if (data.payStructure === 'commission' && (data.commissionRate === undefined || data.commissionRate === null)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Commission rate is required.",
            path: ["commissionRate"],
        });
    }
    if (data.payStructure === 'hourly' && (data.hourlyRate === undefined || data.hourlyRate === null)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Hourly rate is required.",
            path: ["hourlyRate"],
        });
    }
});


type AddStaffFormData = z.infer<typeof addStaffSchema>;

interface AddStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (staffData: Omit<Staff, 'id' | 'avatarUrl'>) => void;
  services: Service[];
}

const AddStaffForm = ({ services }: { services: Service[] }) => {
    const { register, control, watch, setValue, formState: { errors } } = useFormContext<AddStaffFormData>();
    const payStructure = watch('payStructure');
    const selectedServiceIds = watch('services') || [];
    const [isServicesDialogOpen, setIsServicesDialogOpen] = useState(false);
    
    const selectedServices = useMemo(() => {
        return services.filter(s => selectedServiceIds.includes(s.id));
    }, [selectedServiceIds, services]);


    return (
        <>
            <div className="space-y-6">
                <Accordion type="multiple" defaultValue={['item-1']} className="w-full space-y-4">
                    <AccordionItem value="item-1" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><User className="w-5 h-5 text-primary"/>Basic Information</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="flex flex-col items-center gap-4 mt-4 mb-6">
                                <Controller
                                    name="avatarUrl"
                                    control={control}
                                    render={({ field }) => (
                                    <>
                                        <Avatar className="w-24 h-24 text-lg">
                                            <AvatarImage src={field.value || undefined} alt="Staff Avatar" className="object-cover" />
                                            <AvatarFallback><User className="h-8 w-8 text-muted-foreground" /></AvatarFallback>
                                        </Avatar>
                                        <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                                    </>
                                    )}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
                                <div className="space-y-2"><Label htmlFor="name">Full Name</Label><Input id="name" placeholder="e.g., Brenda Barnes" {...register('name')} />{errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}</div>
                                <div className="space-y-2"><Label htmlFor="email">Email Address</Label><Input id="email" type="email" placeholder="brenda@example.com" {...register('email')} />{errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}</div>
                                <PhoneInput name="phone" label="Phone Number" />
                                <Controller name="role" control={control} render={({ field }) => ( <div className="space-y-2"><Label htmlFor="role">Role</Label><Select onValueChange={field.onChange} defaultValue={field.value}><SelectTrigger id="role"><SelectValue placeholder="Select a role" /></SelectTrigger><SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select>{errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}</div> )}/>
                            </div>
                            <div className="space-y-2 mt-4"><Label htmlFor="bio">Bio</Label><Textarea id="bio" placeholder="A short bio for their public profile..." {...register('bio')} /></div>
                            <div className="space-y-2 mt-4"><Label htmlFor="specialties">Specialties</Label><Input id="specialties" placeholder="e.g., Balayage, Nail Art, Vivid Colors" {...register('specialties')} /><p className="text-xs text-muted-foreground">Enter specialties separated by commas.</p></div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
                                <div className="space-y-2">
                                    <Label htmlFor="instagramUrl">Instagram URL</Label>
                                    <div className="relative">
                                        <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="instagramUrl" placeholder="https://instagram.com/..." {...register('instagramUrl')} className="pl-9" />
                                    </div>
                                    {errors.instagramUrl && <p className="text-sm text-destructive">{errors.instagramUrl.message}</p>}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="portfolioUrl">Portfolio URL</Label>
                                    <div className="relative">
                                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="portfolioUrl" placeholder="https://your-portfolio.com" {...register('portfolioUrl')} className="pl-9" />
                                    </div>
                                    {errors.portfolioUrl && <p className="text-sm text-destructive">{errors.portfolioUrl.message}</p>}
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="item-services" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><List className="w-5 h-5 text-primary"/>Services Offered</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="space-y-4 mt-4">
                                {selectedServices.length > 0 ? (
                                    <div className="space-y-2">
                                        {selectedServices.map(service => (
                                            <div key={service.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                                                <span className="text-sm font-medium">{service.name}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    type="button"
                                                    className="h-6 w-6 text-destructive"
                                                    onClick={() => setValue('services', selectedServiceIds.filter(id => id !== service.id), { shouldDirty: true })}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-center text-muted-foreground p-4 border rounded-md">No services selected.</p>
                                )}
                                <Button variant="outline" className="w-full" type="button" onClick={() => setIsServicesDialogOpen(true)}>
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Select Services
                                </Button>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-2" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><Wallet className="w-5 h-5 text-primary"/>Pay Structure</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
                             <Controller name="payStructure" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="payStructure">Pay Structure</Label><Select onValueChange={field.onChange} defaultValue={field.value}><SelectTrigger id="payStructure"><SelectValue placeholder="Select a pay structure" /></SelectTrigger><SelectContent><SelectItem value="commission">Commission</SelectItem><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="salary">Salary</SelectItem></SelectContent></Select>{errors.payStructure && <p className="text-sm text-destructive">{errors.payStructure.message}</p>}</div> )}/>
                            {payStructure === 'commission' && ( <Controller name="commissionRate" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="commissionRate">Commission Rate (%)</Label><Input id="commissionRate" type="number" placeholder="e.g., 40" {...field} value={field.value ?? ''} />{errors.commissionRate && <p className="text-sm text-destructive">{errors.commissionRate.message}</p>}</div> )}/> )}
                            {payStructure === 'hourly' && ( <Controller name="hourlyRate" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="hourlyRate">Hourly Rate ($)</Label><Input id="hourlyRate" type="number" placeholder="e.g., 25" {...field} value={field.value ?? ''} />{errors.hourlyRate && <p className="text-sm text-destructive">{errors.hourlyRate.message}</p>}</div> )}/> )}
                           </div>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="item-3" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><Shield className="w-5 h-5 text-primary"/>Emergency Contact</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
                             <div className="space-y-2"><Label htmlFor="emergencyContact.name">Contact Name</Label><Input id="emergencyContact.name" placeholder="e.g., John Barnes" {...register('emergencyContact.name')} /></div>
                             <Controller
                                name="emergencyContact.relationship"
                                control={control}
                                render={({ field }) => (
                                    <div className="space-y-2">
                                        <Label htmlFor="emergencyContact.relationship">Relationship</Label>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <SelectTrigger id="emergencyContact.relationship">
                                                <SelectValue placeholder="Select a relationship" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Spouse">Spouse</SelectItem>
                                                <SelectItem value="Partner">Partner</SelectItem>
                                                <SelectItem value="Parent">Parent</SelectItem>
                                                <SelectItem value="Guardian">Guardian</SelectItem>
                                                <SelectItem value="Sibling">Sibling</SelectItem>
                                                <SelectItem value="Child">Child</SelectItem>
                                                <SelectItem value="Friend">Friend</SelectItem>
                                                <SelectItem value="Other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                             />
                             <PhoneInput name="emergencyContact.phone" label="Contact Phone" />
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="item-4" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><FileText className="w-5 h-5 text-primary"/>Compliance & Licensing</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
                                <div className="space-y-2"><Label htmlFor="compliance.licenseNumber">License Number</Label><Input id="compliance.licenseNumber" placeholder="e.g., C-123456" {...register('compliance.licenseNumber')} /></div>
                                <Controller name="compliance.licenseExpiry" control={control} render={({ field }) => ( <div className="space-y-2"><Label>License Expiry</Label><Popover><PopoverTrigger className={cn('w-full justify-start text-left font-normal', buttonVariants({ variant: 'outline' }), !field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover></div> )}/>
                                <div className="space-y-2 md:col-span-2"><Label>Upload License Document</Label><Controller name="compliance.documentUrl" control={control} render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} /> )}/></div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="item-5" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><BookText className="w-5 h-5 text-primary"/>Notes & Preferences</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
                             <div className="space-y-2 md:col-span-2"><Label htmlFor="availabilityNotes">Availability Notes</Label><Textarea id="availabilityNotes" placeholder="e.g., Prefers morning shifts, not available on weekends." {...register('availabilityNotes')} /></div>
                             <div className="space-y-2 md:col-span-2"><Label htmlFor="preferences">Preferences</Label><Textarea id="preferences" placeholder="e.g., Allergic to lavender, prefers working with specific product lines." {...register('preferences')} /></div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
            <SelectServicesDialog
                open={isServicesDialogOpen}
                onOpenChange={setIsServicesDialogOpen}
                allServices={services}
                initialSelected={selectedServices}
                onSelect={(newSelection) => {
                    setValue('services', newSelection.map(s => s.id), { shouldDirty: true });
                }}
            />
        </>
    )
}

export const AddStaffDialog: React.FC<AddStaffDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  services,
}) => {
  const methods = useForm<AddStaffFormData>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: {
      name: '',
      email: '',
      role: 'staff',
      payStructure: 'commission',
      commissionRate: 40,
      services: [],
    },
  });

  const { handleSubmit, reset } = methods;
  const isMobile = useIsMobile();

  const handleSave = (data: AddStaffFormData) => {
    const staffDataToSave: Omit<Staff, 'id' | 'avatarUrl'> = {
        ...data,
        specialties: data.specialties?.split(',').map(s => s.trim()).filter(s => s),
        commissionRate: data.commissionRate || 0,
        hourlyRate: data.hourlyRate,
        services: data.services || [],
        compliance: data.compliance?.licenseExpiry 
            ? { ...data.compliance, licenseExpiry: data.compliance.licenseExpiry.toISOString() }
            : undefined
    };
    onSave(staffDataToSave);
    reset();
    onOpenChange(false);
  };
  
  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : undefined} className={isMobile ? "h-[90vh] p-0 flex flex-col" : "sm:max-w-2xl max-h-[90vh] flex flex-col"}>
            <FormProvider {...methods}>
                <form id="add-staff-form-comprehensive" onSubmit={handleSubmit(handleSave)} className="flex-1 flex flex-col overflow-hidden">
                    <DialogHeader className="p-6 pb-0">
                        <DialogTitle>Add New Staff Member</DialogTitle>
                        <DialogDescription>
                            Enter the details for your new team member. They will receive an invitation via email.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        <AddStaffForm services={services} />
                    </div>
                    <DialogFooter className="p-6 pt-4 border-t">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit">Save & Send Invite</Button>
                    </DialogFooter>
                </form>
             </FormProvider>
        </ContentComponent>
    </DialogComponent>
  );
};
