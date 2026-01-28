
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
import { type Staff, type Service, type DayHours, type ConsentForm } from '@/lib/data';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '../ui/scroll-area';
import { User, Wallet, CalendarIcon, Shield, FileText, List, PlusCircle, Trash2, BookText, Instagram, Link as LinkIcon, Facebook, Twitter, Film, Pin, Youtube, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { buttonVariants } from '../ui/button';
import { nanoid } from 'nanoid';
import { SelectServicesDialog } from './SelectServicesDialog';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';
import { BrowseConsentFormsDialog } from '../services/BrowseConsentFormsDialog';

const DayScheduleRow = ({ day, dayData, onDayChange, isEditing }: { day: string; dayData: any; onDayChange: any; isEditing: boolean }) => {
  const timeOptions = Array.from({ length: (22 - 8) * 2 + 1 }, (_, i) => {
    const hour = Math.floor(i / 2) + 8;
    const minute = i % 2 === 0 ? '00' : '30';
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minute} ${period}`;
  });

  return (
    <div className="flex items-center gap-4 p-2">
      <div className="flex items-center gap-3 w-32">
        <Switch
          id={`switch-${day}`}
          checked={dayData.enabled}
          onCheckedChange={(checked) => onDayChange('enabled', checked)}
          disabled={!isEditing}
        />
        <Label htmlFor={`switch-${day}`} className="font-semibold text-base capitalize">{day}</Label>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4">
        <Select
          value={dayData.start}
          onValueChange={(value) => onDayChange('start', value)}
          disabled={!isEditing || !dayData.enabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeOptions.map(time => <SelectItem key={`${day}-start-${time}`} value={time}>{time}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={dayData.end}
          onValueChange={(value) => onDayChange('end', value)}
          disabled={!isEditing || !dayData.enabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeOptions.map(time => <SelectItem key={`${day}-end-${time}`} value={time}>{time}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};


const editStaffSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  bio: z.string().optional(),
  specialties: z.string().optional(),
  instagramUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  facebookUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  tiktokUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  twitterUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  pinterestUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  youtubeUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  portfolioUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal('')),
  role: z.enum(['admin', 'staff']),
  skillLevel: z.enum(['junior', 'senior', 'master']),
  payStructure: z.enum(['commission', 'hourly', 'salary']),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  retailCommissionRate: z.coerce.number().min(0).max(100).optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  services: z.array(z.string()).optional(),
  documents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    uploadedAt: z.string()
  })).optional(),
  assignedFormIds: z.array(z.string()).optional(),
  emergencyContact: z.object({
      name: z.string().optional(),
      relationship: z.string().optional(),
      phone: z.string().optional(),
  }).optional(),
  availability: z.any().optional(), // Allow any for form handling
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


type EditStaffFormData = z.infer<typeof editStaffSchema>;

interface EditStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (staffData: Staff) => void;
  staffMember: Staff | null;
  services: Service[];
  consentForms: ConsentForm[];
}

const EditStaffForm = ({ services, consentForms }: { services: Service[], consentForms: ConsentForm[] }) => {
    const { register, control, watch, setValue, formState: { errors } } = useFormContext<EditStaffFormData>();
    const payStructure = watch('payStructure');
    const selectedServiceIds = watch('services') || [];
    const availability = watch('availability');
    const documents = watch('documents') || [];
    const assignedFormIds = watch('assignedFormIds') || [];
    
    const [isServicesDialogOpen, setIsServicesDialogOpen] = useState(false);
    const [isConsentFormDialogOpen, setIsConsentFormDialogOpen] = useState(false);
    const [documentName, setDocumentName] = useState('');
    
    const selectedServices = useMemo(() => {
        return services.filter(s => selectedServiceIds.includes(s.id));
    }, [selectedServiceIds, services]);

    const assignedForms = useMemo(() => {
        return consentForms.filter(f => assignedFormIds.includes(f.id));
    }, [assignedFormIds, consentForms]);

    const orderedDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    const handleDayChange = (day: string, field: string, value: any) => {
        setValue(`availability.week.${day}`, {
            ...availability.week[day],
            [field]: value
        }, { shouldDirty: true });
    };

    const handleAddDocument = (url: string) => {
        if (!documentName.trim() || !url) return;
        const newDoc = {
            id: nanoid(),
            name: documentName,
            url: url,
            uploadedAt: new Date().toISOString()
        };
        setValue('documents', [...documents, newDoc], { shouldDirty: true });
        setDocumentName('');
    }

    const handleRemoveDocument = (id: string) => {
        setValue('documents', documents.filter(d => d.id !== id), { shouldDirty: true });
    }

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
                                <div className="grid grid-cols-2 gap-4">
                                    <Controller name="role" control={control} render={({ field }) => ( <div className="space-y-2"><Label htmlFor="role">Role</Label><Select onValueChange={field.onChange} defaultValue={field.value}><SelectTrigger id="role"><SelectValue placeholder="Select a role" /></SelectTrigger><SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select>{errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}</div> )}/>
                                    <Controller name="skillLevel" control={control} render={({ field }) => ( <div className="space-y-2"><Label htmlFor="skillLevel">Skill Level</Label><Select onValueChange={field.onChange} defaultValue={field.value}><SelectTrigger id="skillLevel"><SelectValue placeholder="Select a level" /></SelectTrigger><SelectContent><SelectItem value="junior">Junior</SelectItem><SelectItem value="senior">Senior</SelectItem><SelectItem value="master">Master</SelectItem></SelectContent></Select>{errors.skillLevel && <p className="text-sm text-destructive">{errors.skillLevel.message}</p>}</div> )}/>
                                </div>
                            </div>
                            <div className="space-y-2 mt-4"><Label htmlFor="bio">Bio</Label><Textarea id="bio" placeholder="A short bio for their public profile..." {...register('bio')} /></div>
                            <div className="space-y-2 mt-4"><Label htmlFor="specialties">Specialties</Label><Input id="specialties" placeholder="e.g., Balayage, Nail Art, Vivid Colors" {...register('specialties')} /><p className="text-xs text-muted-foreground">Enter specialties separated by commas.</p></div>
                             <div className="space-y-2 mt-4">
                                <Label>Social & Portfolio Links</Label>
                                <div className="space-y-3">
                                    <div className="relative">
                                        <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="instagramUrl" placeholder="https://instagram.com/..." {...register('instagramUrl')} className="pl-9" />
                                    </div>
                                    <div className="relative">
                                        <Facebook className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="facebookUrl" placeholder="https://facebook.com/..." {...register('facebookUrl')} className="pl-9" />
                                    </div>
                                    <div className="relative">
                                        <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="twitterUrl" placeholder="https://x.com/..." {...register('twitterUrl')} className="pl-9" />
                                    </div>
                                    <div className="relative">
                                        <Film className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="tiktokUrl" placeholder="https://tiktok.com/..." {...register('tiktokUrl')} className="pl-9" />
                                    </div>
                                    <div className="relative">
                                        <Pin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="pinterestUrl" placeholder="https://pinterest.com/..." {...register('pinterestUrl')} className="pl-9" />
                                    </div>
                                    <div className="relative">
                                        <Youtube className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="youtubeUrl" placeholder="https://youtube.com/..." {...register('youtubeUrl')} className="pl-9" />
                                    </div>
                                    <div className="relative">
                                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input id="portfolioUrl" placeholder="https://your-portfolio.com" {...register('portfolioUrl')} className="pl-9" />
                                    </div>
                                </div>
                                {errors.instagramUrl && <p className="text-sm text-destructive">{errors.instagramUrl.message}</p>}
                                {errors.facebookUrl && <p className="text-sm text-destructive">{errors.facebookUrl.message}</p>}
                                {errors.tiktokUrl && <p className="text-sm text-destructive">{errors.tiktokUrl.message}</p>}
                                {errors.twitterUrl && <p className="text-sm text-destructive">{errors.twitterUrl.message}</p>}
                                {errors.pinterestUrl && <p className="text-sm text-destructive">{errors.pinterestUrl.message}</p>}
                                {errors.youtubeUrl && <p className="text-sm text-destructive">{errors.youtubeUrl.message}</p>}
                                {errors.portfolioUrl && <p className="text-sm text-destructive">{errors.portfolioUrl.message}</p>}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-availability" className="border rounded-lg">
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><Clock className="w-5 h-5 text-primary"/>Availability</div></AccordionTrigger>
                        <AccordionContent className="p-4">
                            {availability?.week && orderedDays.map(day => (
                                <DayScheduleRow 
                                    key={day}
                                    day={day}
                                    dayData={availability.week[day]}
                                    onDayChange={(field: string, value: any) => handleDayChange(day, field, value)}
                                    isEditing={true}
                                />
                            ))}
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
                             <Controller name="payStructure" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="payStructure">Pay Structure</Label><Select onValueChange={field.onChange} value={field.value}><SelectTrigger id="payStructure"><SelectValue placeholder="Select a pay structure" /></SelectTrigger><SelectContent><SelectItem value="commission">Commission</SelectItem><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="salary">Salary</SelectItem></SelectContent></Select>{errors.payStructure && <p className="text-sm text-destructive">{errors.payStructure.message}</p>}</div> )}/>
                            {payStructure === 'commission' && (
                                <>
                                <Controller name="commissionRate" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="commissionRate">Service Commission Rate (%)</Label><Input id="commissionRate" type="number" placeholder="e.g., 40" {...field} value={field.value ?? ''} />{errors.commissionRate && <p className="text-sm text-destructive">{errors.commissionRate.message}</p>}</div> )}/>
                                <Controller name="retailCommissionRate" control={control} render={({ field }) => (<div className="space-y-2"><Label htmlFor="retailCommissionRate">Retail Commission Rate (%)</Label><Input id="retailCommissionRate" type="number" placeholder="e.g., 10" {...field} value={field.value ?? ''} /></div> )}/>
                                </>
                            )}
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
                        <AccordionTrigger className="p-4"><div className="flex items-center gap-3"><FileText className="w-5 h-5 text-primary"/>Compliance & Documents</div></AccordionTrigger>
                        <AccordionContent className="p-4 pt-0 mt-4 space-y-6">
                            <div>
                                <h4 className="font-semibold text-sm mb-2">Licensing</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                    <div className="space-y-2"><Label htmlFor="compliance.licenseNumber">License Number</Label><Input id="compliance.licenseNumber" placeholder="e.g., C-123456" {...register('compliance.licenseNumber')} /></div>
                                    <Controller name="compliance.licenseExpiry" control={control} render={({ field }) => ( <div className="space-y-2"><Label>License Expiry</Label><Popover><PopoverTrigger className={cn('w-full justify-start text-left font-normal', buttonVariants({ variant: 'outline' }), !field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover></div> )}/>
                                </div>
                            </div>

                            <div>
                                <h4 className="font-semibold text-sm mb-2">Uploaded Documents</h4>
                                <div className="space-y-2">
                                    {documents.map(doc => (
                                        <div key={doc.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                                            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">{doc.name}</a>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveDocument(doc.id)}><Trash2 className="w-4 w-4"/></Button>
                                        </div>
                                    ))}
                                    {documents.length === 0 && <p className="text-xs text-center text-muted-foreground p-3 border rounded-md">No documents uploaded.</p>}
                                </div>
                                <div className="mt-4 p-4 border rounded-lg space-y-3">
                                    <Label>Add New Document</Label>
                                    <Input placeholder="Document Name (e.g., Contract)" value={documentName} onChange={e => setDocumentName(e.target.value)} />
                                    <ImageUpload onImageUploaded={handleAddDocument} />
                                </div>
                            </div>
                            
                             <div>
                                <h4 className="font-semibold text-sm mb-2">Assigned Forms</h4>
                                <div className="space-y-2">
                                    {assignedForms.map(form => (
                                        <div key={form.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                                            <p className="text-sm font-medium">{form.title}</p>
                                        </div>
                                    ))}
                                    <Button variant="outline" className="w-full" type="button" onClick={() => setIsConsentFormDialogOpen(true)}>
                                        <PlusCircle className="mr-2 h-4 w-4" />
                                        Assign Forms
                                    </Button>
                                </div>
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
             <BrowseConsentFormsDialog
                open={isConsentFormDialogOpen}
                onOpenChange={setIsConsentFormDialogOpen}
                onSelect={(forms) => setValue('assignedFormIds', forms.map(f => f.id), { shouldDirty: true })}
                allForms={consentForms}
                initialSelected={assignedForms}
            />
        </>
    )
}

export const EditStaffDialog: React.FC<EditStaffDialogProps> = ({
  open,
  onOpenChange,
  onSave,
  staffMember,
  services,
  consentForms,
}) => {
  const methods = useForm<EditStaffFormData>({
    resolver: zodResolver(editStaffSchema),
  });

  const { handleSubmit, reset } = methods;
  const isMobile = useIsMobile();

  useEffect(() => {
    if (staffMember) {
        const specialtiesString = Array.isArray(staffMember.specialties) ? staffMember.specialties.join(', ') : staffMember.specialties;
        reset({
            ...staffMember,
            specialties: specialtiesString,
            avatarUrl: staffMember.avatarUrl || '',
            skillLevel: staffMember.skillLevel || 'junior',
            instagramUrl: staffMember.instagramUrl || '',
            facebookUrl: staffMember.facebookUrl || '',
            tiktokUrl: staffMember.tiktokUrl || '',
            twitterUrl: staffMember.twitterUrl || '',
            pinterestUrl: staffMember.pinterestUrl || '',
            youtubeUrl: staffMember.youtubeUrl || '',
            portfolioUrl: staffMember.portfolioUrl || '',
            compliance: {
                ...staffMember.compliance,
                licenseExpiry: staffMember.compliance?.licenseExpiry ? parseISO(staffMember.compliance.licenseExpiry) : undefined,
            },
            availability: staffMember.availability || {
                week: {
                    sunday: { enabled: false, start: '09:00 AM', end: '05:00 PM' },
                    monday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                    tuesday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                    wednesday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                    thursday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                    friday: { enabled: true, start: '09:00 AM', end: '05:00 PM' },
                    saturday: { enabled: false, start: '09:00 AM', end: '05:00 PM' },
                }
            },
            documents: staffMember.documents || [],
            assignedFormIds: staffMember.assignedFormIds || [],
        });
    }
  }, [staffMember, reset]);

  const handleSave = (data: EditStaffFormData) => {
    if (!staffMember) return;
    const staffDataToSave: Staff = {
        ...staffMember,
        ...data,
        skillLevel: data.skillLevel,
        specialties: typeof data.specialties === 'string' ? data.specialties.split(',').map(s => s.trim()).filter(s => s) : data.specialties,
        avatarUrl: data.avatarUrl || staffMember.avatarUrl,
        commissionRate: data.commissionRate || 0,
        retailCommissionRate: data.retailCommissionRate || 0,
        hourlyRate: data.hourlyRate,
        services: data.services || [],
        documents: data.documents || [],
        assignedFormIds: data.assignedFormIds || [],
        compliance: data.compliance?.licenseExpiry 
            ? { ...data.compliance, licenseExpiry: data.compliance.licenseExpiry.toISOString() }
            : undefined
    };

    // Sanitize the object to remove undefined values
    const sanitizedData = Object.fromEntries(
        Object.entries(staffDataToSave).map(([key, value]) => {
            if (key === 'compliance' && value) {
                const sanitizedCompliance = Object.fromEntries(Object.entries(value).filter(([_, v]) => v !== undefined));
                return [key, sanitizedCompliance];
            }
            if (key === 'emergencyContact' && value) {
                const sanitizedContact = Object.fromEntries(Object.entries(value).filter(([_, v]) => v !== undefined));
                return [key, sanitizedContact];
            }
            return [key, value];
        }).filter(([_, value]) => value !== undefined)
    ) as Staff;
    
    onSave(sanitizedData);
    onOpenChange(false);
  };
  
  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  if (!staffMember) return null;

  return (
    <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : undefined} className={isMobile ? "h-[90vh] p-0 flex flex-col" : "sm:max-w-2xl max-h-[90vh] flex flex-col"}>
            <FormProvider {...methods}>
                <form id="edit-staff-form" onSubmit={handleSubmit(handleSave)} className="flex-1 flex flex-col overflow-hidden">
                    <DialogHeader className="p-6 pb-0">
                        <DialogTitle>Edit: {staffMember.name}</DialogTitle>
                        <DialogDescription>
                            Update the details for this team member.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        <EditStaffForm services={services} consentForms={consentForms} />
                    </div>
                    <DialogFooter className="p-6 pt-4 border-t">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit">Save Changes</Button>
                    </DialogFooter>
                </form>
             </FormProvider>
        </ContentComponent>
    </DialogComponent>
  );
};
