
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { PhoneInput } from '@/components/ui/phone-input';
import { type Staff, type Service, type ConsentForm, type PricingTier } from '@/lib/data';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '../ui/scroll-area';
import { 
    User, 
    Wallet, 
    CalendarIcon, 
    Shield, 
    FileText, 
    List, 
    PlusCircle, 
    Trash2, 
    BookText, 
    Instagram, 
    Link as LinkIcon, 
    Facebook, 
    Twitter, 
    Film, 
    Pin as PinIcon, 
    Youtube, 
    Clock, 
    KeyRound, 
    Sparkles, 
    ArrowRight, 
    Check, 
    ShieldCheck, 
    Fingerprint, 
    Award,
    Heart,
    Percent
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { SelectServicesDialog } from './SelectServicesDialog';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';
import { BrowseConsentFormsDialog } from '../services/BrowseConsentFormsDialog';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

const addStaffSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  confirmPassword: z.string(),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  bio: z.string().optional(),
  specialties: z.string().optional(),
  instagramUrl: z.string().optional(),
  facebookUrl: z.string().optional(),
  tiktokUrl: z.string().optional(),
  twitterUrl: z.string().optional(),
  pinterestUrl: z.string().optional(),
  youtubeUrl: z.string().optional(),
  portfolioUrl: z.string().optional(),
  role: z.enum(['admin', 'staff']),
  pricingTierId: z.string().optional(),
  payStructure: z.enum(['commission', 'hourly', 'salary', 'hourly_plus_commission']),
  payoutFrequency: z.enum(['weekly', 'bi-weekly']).optional(),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  retailCommissionRate: z.coerce.number().min(0).max(100).optional(),
  hourlyRate: z.coerce.number().min(0).optional(),
  services: z.array(z.string()).optional(),
  assignedFormIds: z.array(z.string()).optional(),
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
  pin: z.string().length(4, "PIN must be exactly 4 digits."),
  showOnPublicPage: z.boolean().default(true),
}).superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
        ctx.addIssue({
            code: "custom",
            message: "The passwords do not match",
            path: ['confirmPassword'],
        });
    }
}).superRefine((data, ctx) => {
    if (data.payStructure === 'commission' || data.payStructure === 'hourly_plus_commission') {
        if (data.commissionRate === undefined || data.commissionRate === null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Commission rate is required.",
                path: ["commissionRate"],
            });
        }
        if (!data.payoutFrequency) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Payout frequency is required.",
                path: ["payoutFrequency"],
            });
        }
    }
    if ((data.payStructure === 'hourly' || data.payStructure === 'hourly_plus_commission') && (data.hourlyRate === undefined || data.hourlyRate === null)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Hourly rate is required.",
            path: ["hourlyRate"],
        });
    }
});

export type AddStaffFormData = z.infer<typeof addStaffSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const Step1 = ({ pricingTiers }: { pricingTiers: PricingTier[] }) => {
    const { register, control, formState: { errors } } = useFormContext<AddStaffFormData>();
    
    return (
        <div className="space-y-10">
            <SectionHeader icon={Fingerprint} title="Identity & Access" step={1} />
            <div className="space-y-6">
                <div className="space-y-2 text-left">
                    <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Full Name</Label>
                    <Input id="name" placeholder="e.g., Brenda Barnes" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner" />
                    {errors.name && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                </div>
                <div className="space-y-2 text-left">
                    <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Professional Email</Label>
                    <Input id="email" type="email" placeholder="brenda@example.com" {...register('email')} className="h-14 rounded-2xl border-2 font-bold" />
                    {errors.email && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.email.message}</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Login Password</Label>
                        <Input id="password" type="password" {...register('password')} className="h-14 rounded-2xl border-2 font-bold" />
                        {errors.password && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.password.message}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="confirmPassword" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Confirm Password</Label>
                        <Input id="confirmPassword" type="password" {...register('confirmPassword')} className="h-14 rounded-2xl border-2 font-bold" />
                        {errors.confirmPassword && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.confirmPassword.message}</p>}
                    </div>
                </div>

                <div className="p-6 bg-primary/5 rounded-[2.5rem] border-4 border-primary/10 space-y-4 shadow-inner">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <KeyRound className="w-5 h-5 text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Security Signature</span>
                        </div>
                        <Badge className="bg-primary text-white border-none font-black text-[9px] uppercase h-6 px-3">Unique PIN</Badge>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <Input 
                            {...register('pin')} 
                            className="text-center text-5xl h-20 font-black tracking-[0.5em] bg-white border-primary/20 rounded-3xl shadow-xl" 
                            maxLength={4}
                            readOnly
                        />
                        <p className="text-[10px] text-center text-muted-foreground uppercase font-bold tracking-tight opacity-60">This code is required for terminal access and overrides.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Studio Role</Label>
                        <Controller name="role" control={control} render={({ field }) => (
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    <SelectItem value="staff" className="font-bold uppercase text-[10px] tracking-widest">STAFF PROVIDER</SelectItem>
                                    <SelectItem value="admin" className="font-bold uppercase text-[10px] tracking-widest">ADMIN MANAGER</SelectItem>
                                </SelectContent>
                            </Select>
                        )}/>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Expertise Tier</Label>
                        <Controller name="pricingTierId" control={control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {pricingTiers.map(tier => (<SelectItem key={tier.id} value={tier.id} className="font-bold uppercase text-[10px] tracking-widest">{tier.name.toUpperCase()}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        )}/>
                    </div>
                </div>

                <div className="flex items-center justify-between p-6 border-2 border-dashed rounded-[2rem] bg-muted/5">
                    <div className='space-y-1 text-left'>
                        <Label htmlFor="showOnPublicPage" className="text-base font-black uppercase tracking-tight">Public Directory</Label>
                        <p className='text-[10px] font-bold text-muted-foreground uppercase opacity-60'>Show on the guest booking page</p>
                    </div>
                    <Controller name="showOnPublicPage" control={control} render={({ field }) => ( <Switch id="showOnPublicPage" checked={field.value} onCheckedChange={field.onChange} className="scale-125" /> )}/>
                </div>
            </div>
        </div>
    );
};

const Step2 = ({ services, consentForms }: { services: Service[], consentForms: ConsentForm[] }) => {
    const { control, register, setValue, watch } = useFormContext<AddStaffFormData>();
    const [isServicesDialogOpen, setIsServicesDialogOpen] = useState(false);
    const [isConsentFormDialogOpen, setIsConsentFormDialogOpen] = useState(false);

    const selectedServiceIds = watch('services') || [];
    const assignedFormIds = watch('assignedFormIds') || [];

    const selectedServices = useMemo(() => services.filter(s => selectedServiceIds.includes(s.id)), [selectedServiceIds, services]);
    const assignedForms = useMemo(() => consentForms.filter(f => assignedFormIds.includes(f.id)), [assignedFormIds, consentForms]);

    return (
        <div className="space-y-10">
            <SectionHeader icon={Sparkles} title="Profile & Mastery" step={2} />
            <div className="space-y-8">
                <div className="flex flex-col items-center gap-6 mb-6">
                    <Controller
                        name="avatarUrl"
                        control={control}
                        render={({ field }) => (
                            <div className="relative group">
                                <Avatar className="w-28 h-28 border-4 border-background shadow-2xl rounded-[2rem] overflow-hidden transition-all group-hover:scale-105">
                                    <AvatarImage src={field.value || undefined} alt="Staff Avatar" className="object-cover" />
                                    <AvatarFallback className="bg-primary/10 text-primary font-black uppercase text-xl">{(watch('name') || 'S').charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-[2rem] cursor-pointer">
                                    <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                                </div>
                            </div>
                        )}
                    />
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Provider Portrait</p>
                </div>

                <div className="space-y-2 text-left">
                    <Label htmlFor="bio" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Professional Bio</Label>
                    <Textarea id="bio" placeholder="Draft a compelling profile for guests..." {...register('bio')} className="rounded-2xl border-2 bg-muted/5 min-h-[100px] focus-visible:ring-primary/20" />
                </div>

                <div className="space-y-2 text-left">
                    <Label htmlFor="specialties" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Signature Specialties</Label>
                    <Input id="specialties" placeholder="e.g., BALAYAGE, VIVIDS, PRECISION CUTS" {...register('specialties')} className="h-12 rounded-xl border-2 font-black uppercase text-xs shadow-inner" />
                    <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 ml-1 text-left">Delimited by commas</p>
                </div>

                <div className="space-y-4 pt-4 border-t border-dashed text-left">
                    <div className="flex items-center justify-between px-1">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                            <List className="w-3.5 h-3.5 opacity-40" /> Treatment Catalog
                        </Label>
                        <Button variant="ghost" size="sm" onClick={() => setIsServicesDialogOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Define Skills
                        </Button>
                    </div>
                    {selectedServices.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {selectedServices.map(service => (
                                <div key={service.id} className="flex items-center justify-between p-3 rounded-xl border-2 bg-white shadow-sm group">
                                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate flex-1">{service.name}</span>
                                    <Button variant="ghost" size="icon" className="h-7 h-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setValue('services', selectedServiceIds.filter(id => id !== service.id), { shouldDirty: true })}><Trash2 className="w-3.5 h-3.5" /></Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-10 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                            <PlusCircle className="w-8 h-8" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No services assigned</p>
                        </div>
                    )}
                </div>

                <div className="space-y-4 text-left">
                    <div className="flex items-center justify-between px-1">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 opacity-40" /> Associated Documents
                        </Label>
                        <Button variant="ghost" size="sm" onClick={() => setIsConsentFormDialogOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                            <PlusCircle className="w-3 h-3 mr-1.5" /> Assign Forms
                        </Button>
                    </div>
                    {assignedForms.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2">
                            {assignedForms.map(form => (
                                <div key={form.id} className="flex items-center justify-between p-3 rounded-xl border-2 bg-white shadow-sm group">
                                    <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{form.title}</span>
                                    <Button variant="ghost" size="icon" className="h-7 h-7 text-destructive group-hover:opacity-100 transition-opacity" onClick={() => setValue('assignedFormIds', assignedFormIds.filter(id => id !== form.id), { shouldDirty: true })}><Trash2 className="w-3.5 h-3.5" /></Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-10 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                            <FileText className="w-8 h-8" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No compliance forms</p>
                        </div>
                    )}
                </div>
            </div>
            <SelectServicesDialog open={isServicesDialogOpen} onOpenChange={setIsServicesDialogOpen} allServices={services} initialSelected={selectedServices} onSelect={(newSelection) => setValue('services', newSelection.map(s => s.id), { shouldDirty: true })} />
            <BrowseConsentFormsDialog open={isConsentFormDialogOpen} onOpenChange={setIsConsentFormDialogOpen} onSelect={(forms) => setValue('assignedFormIds', forms.map(f => f.id), { shouldDirty: true })} allForms={consentForms} initialSelected={assignedForms} />
        </div>
    );
};

const Step3 = () => {
    const { control, register, watch, formState: { errors } } = useFormContext<AddStaffFormData>();
    const payStructure = watch('payStructure');

    return (
        <div className="space-y-10">
            <SectionHeader icon={Wallet} title="Compensation & Logistics" step={3} />
            <div className="space-y-8">
                <div className="space-y-6 text-left">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Pay Structure</Label>
                            <Controller name="payStructure" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        <SelectItem value="commission" className="font-bold uppercase text-[10px] tracking-widest">COMMISSION</SelectItem>
                                        <SelectItem value="hourly" className="font-bold uppercase text-[10px] tracking-widest">HOURLY WAGE</SelectItem>
                                        <SelectItem value="hourly_plus_commission" className="font-bold uppercase text-[10px] tracking-widest">HOURLY + COMMISSION</SelectItem>
                                        <SelectItem value="salary" className="font-bold uppercase text-[10px] tracking-widest">SALARY</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}/>
                        </div>
                        {(payStructure === 'commission' || payStructure === 'hourly_plus_commission') && (
                            <div className="space-y-2 text-left">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Payout Cadence</Label>
                                <Controller name="payoutFrequency" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            <SelectItem value="weekly" className="font-bold uppercase text-[10px] tracking-widest">WEEKLY</SelectItem>
                                            <SelectItem value="bi-weekly" className="font-bold uppercase text-[10px] tracking-widest">BI-WEEKLY</SelectItem>
                                        </SelectContent>
                                    </Select>
                                )}/>
                            </div>
                        )}
                    </div>

                    {(payStructure === 'commission' || payStructure === 'hourly_plus_commission') && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="commissionRate" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Service %</Label>
                                <div className="relative"><Input id="commissionRate" type="number" placeholder="40" {...register('commissionRate')} className="h-12 pr-8 rounded-xl border-2 font-black text-lg text-primary shadow-inner" /><Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40"/></div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="retailCommissionRate" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Retail %</Label>
                                <div className="relative"><Input id="retailCommissionRate" type="number" placeholder="10" {...register('retailCommissionRate')} className="h-12 pr-8 rounded-xl border-2 font-black text-lg text-primary shadow-inner" /><Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40"/></div>
                            </div>
                        </div>
                    )} 
                    
                    {(payStructure === 'hourly' || payStructure === 'hourly_plus_commission') && (
                        <div className="space-y-2 animate-in slide-in-from-top-2">
                            <Label htmlFor="hourlyRate" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Hourly Base Rate</Label>
                            <div className="relative"><DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" /><Input id="hourlyRate" type="number" placeholder="25.00" {...register('hourlyRate')} className="h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner" /></div>
                        </div>
                    )}
                </div>

                <Separator className="border-dashed" />

                <div className="space-y-6">
                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60 text-left"><Heart className="w-3 h-3" /> Emergency Protocol</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5 text-left"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Legal Contact Name</Label><Input placeholder="EMERGENCY CONTACT" {...register('emergencyContact.name')} className="h-11 rounded-xl border-2 font-bold text-xs uppercase" /></div>
                            <div className="space-y-1.5 text-left">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Relationship</Label>
                                <Controller name="emergencyContact.relationship" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[9px] tracking-widest bg-muted/5"><SelectValue placeholder="SELECT..." /></SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            {['Spouse', 'Partner', 'Parent', 'Guardian', 'Sibling', 'Child', 'Friend', 'Other'].map(r => ( <SelectItem key={r} value={r} className="font-bold uppercase text-[9px] tracking-widest">{r.toUpperCase()}</SelectItem> ))}
                                        </SelectContent>
                                    </Select>
                                )}/>
                            </div>
                            <div className="sm:col-span-2 text-left"><PhoneInput name="emergencyContact.phone" label="Emergency Contact Mobile" className="h-11 rounded-xl" /></div>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-dashed text-left">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><ShieldCheck className="w-3 h-3" /> Licensing Record</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">License Number</Label><Input placeholder="STATE-ID-XXXX" {...register('compliance.licenseNumber')} className="h-11 rounded-xl border-2 font-mono font-black text-xs" /></div>
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Expiry Date</Label>
                                <Controller name="compliance.licenseExpiry" control={control} render={({ field }) => (
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-full h-11 rounded-xl border-2 font-bold justify-start px-4 text-xs bg-muted/5"><CalendarIcon className="mr-2 h-4 w-4 opacity-40" /> {field.value ? format(field.value, 'MMM d, yyyy') : 'No date set'}</Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-3xl border-4"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
                                    </Popover>
                                )}/>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
};

export const AddStaffDialog: React.FC<AddStaffDialogProps> = ({
  open, onOpenChange, onSave, services, consentForms, pricingTiers, existingStaff,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const isMobile = useIsMobile();
  const methods = useForm<AddStaffFormData>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: { role: 'staff', pricingTierId: '', payStructure: 'commission', payoutFrequency: 'weekly', commissionRate: 40, retailCommissionRate: 10, services: [], assignedFormIds: [], showOnPublicPage: true }
  });

  const generateUniquePin = (staffList: Staff[]) => {
    let pin = '';
    let isUnique = false;
    while (!isUnique) {
        pin = Math.floor(1000 + Math.random() * 9000).toString();
        isUnique = !staffList.some(s => s.pin === pin);
    }
    return pin;
  };

  useEffect(() => {
    if (open) {
      const newPin = generateUniquePin(existingStaff || []);
      methods.reset({ name: '', email: '', password: '', confirmPassword: '', role: 'staff', pricingTierId: pricingTiers?.[0]?.id || '', payStructure: 'commission', payoutFrequency: 'weekly', commissionRate: 40, retailCommissionRate: 10, services: [], assignedFormIds: [], pin: newPin, showOnPublicPage: true });
      setStep(1);
    }
  }, [open, pricingTiers, existingStaff, methods]);

  const handleNext = async (e: any) => { e.preventDefault(); if (await methods.trigger(step === 1 ? ['name', 'email', 'password', 'confirmPassword', 'role', 'pin'] : [])) setStep(step + 1); };
  const handleBack = (e: any) => { e.preventDefault(); setStep(step - 1); };

  const formBody = (
    <FormProvider {...methods}>
      <form id="add-staff-wizard-form" onSubmit={methods.handleSubmit(onSave)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-8 pb-6")}>
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Register Provider</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Onboard a new technician and secure their studio credentials.</DialogDescription>
          <div className="pt-6"><Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" /></div>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn("pb-32", isMobile ? "p-6" : "p-8")}>
                {step === 1 && <Step1 pricingTiers={pricingTiers} />}
                {step === 2 && <Step2 services={services} consentForms={consentForms} />}
                {step === 3 && <Step3 />}
            </div>
        </ScrollArea>
        <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-4" : "p-6 sm:p-8 pt-4")}>
          <div className='flex w-full gap-4'>
            {step > 1 && <Button variant="ghost" onClick={handleBack} type="button" className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-tighter text-[10px] md:text-2xl text-slate-400">Back</Button>}
            <div className={cn("flex gap-3", step === 1 ? "w-full" : "flex-[2.5]")}>
              <Button variant="outline" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-widest text-[10px] md:text-xl border-2">Cancel</Button>
              {step < totalSteps ? (
                <Button onClick={handleNext} type="button" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30 group">Continue <ArrowRight className="ml-3 w-4 h-4 md:w-8 md:h-8 transition-transform group-hover:translate-x-1" /></Button>
              ) : (
                <Button type="submit" className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30">Save Provider</Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </form>
    </FormProvider>
  );

  const DialogContainer = isMobile ? Sheet : Dialog;
  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-4xl max-h-[90dvh]")} side="right">
        {formBody}
      </DialogContent>
    </DialogContainer>
  );
};
