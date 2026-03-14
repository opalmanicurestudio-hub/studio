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
    Youtube, 
    Clock, 
    KeyRound, 
    RefreshCw, 
    EyeOff,
    Sparkles,
    ArrowRight,
    Check,
    ShieldCheck,
    Fingerprint,
    Award,
    Heart,
    Percent,
    Smartphone,
    Briefcase,
    Zap,
    Scale
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { SelectServicesDialog } from './SelectServicesDialog';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Switch } from '../ui/switch';
import { BrowseConsentFormsDialog } from '../services/BrowseConsentFormsDialog';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';

const editStaffSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('A valid email is required.'),
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
  role: z.enum(['admin', 'staff', 'owner']),
  pricingTierId: z.string().optional(),
  payStructure: z.enum(['commission', 'hourly', 'salary']),
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
});

type EditStaffFormData = z.infer<typeof editStaffSchema>;

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step?: number | string }) => (
    <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20 shrink-0">
            <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5 text-left">
            <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step || 'Refine'}</p>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
        </div>
    </div>
);

const EditStaffFormInternal = ({ services, consentForms, pricingTiers, onSendPasswordReset, onRegeneratePin }: { services: Service[], consentForms: ConsentForm[], pricingTiers: PricingTier[], onSendPasswordReset: () => void, onRegeneratePin: () => void }) => {
    const { register, control, watch, setValue, formState: { errors } } = useFormContext<EditStaffFormData>();
    const payStructure = watch('payStructure');
    const selectedServiceIds = watch('services') || [];
    const assignedFormIds = watch('assignedFormIds') || [];
    
    const [isServicesDialogOpen, setIsServicesDialogOpen] = useState(false);
    const [isConsentFormDialogOpen, setIsConsentFormDialogOpen] = useState(false);
    
    const selectedServices = useMemo(() => services.filter(s => selectedServiceIds.includes(s.id)), [selectedServiceIds, services]);
    const assignedForms = useMemo(() => consentForms.filter(f => assignedFormIds.includes(f.id)), [assignedFormIds, consentForms]);

    return (
        <div className="space-y-12">
            <div className="space-y-10">
                <SectionHeader icon={Fingerprint} title="Identity & Security" step={1} />
                <div className="space-y-8">
                    <div className="flex flex-col sm:flex-row items-center gap-8 p-6 rounded-[2.5rem] border-2 bg-muted/5 shadow-inner">
                        <Controller
                            name="avatarUrl"
                            control={control}
                            render={({ field }) => (
                                <div className="relative group shrink-0">
                                    <Avatar className="w-24 h-24 border-4 border-background shadow-2xl rounded-3xl overflow-hidden transition-all group-hover:scale-105">
                                        <AvatarImage src={field.value || undefined} alt="Staff Avatar" className="object-cover" />
                                        <AvatarFallback className="bg-primary/10 text-primary font-black uppercase"><User className="h-8 w-8 opacity-40" /></AvatarFallback>
                                    </Avatar>
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-3xl cursor-pointer">
                                        <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                                    </div>
                                </div>
                            )}
                        />
                        <div className="flex-1 space-y-4 w-full">
                            <div className="space-y-1.5 text-left">
                                <Label htmlFor="name-edit" className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Full Name</Label>
                                <Input id="name-edit" placeholder="ALEXANDER SMITH" {...register('name')} className="h-12 rounded-xl border-2 font-black uppercase tracking-tight text-base" />
                                {errors.name && <p className="text-[9px] font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                            </div>
                            <div className="space-y-1.5 text-left">
                                <Label htmlFor="email-edit" className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Professional Email</Label>
                                <Input id="email-edit" type="email" {...register('email')} className="h-12 rounded-xl border-2 font-bold text-sm bg-muted/20" disabled />
                            </div>
                        </div>
                    </div>

                    <div className="p-6 bg-primary/5 rounded-[2.5rem] border-4 border-primary/10 space-y-4 shadow-inner">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <KeyRound className="w-5 h-5 text-primary" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Security Protocol</span>
                            </div>
                            <Button variant="ghost" size="sm" type="button" onClick={onRegeneratePin} className="h-7 text-[9px] font-black uppercase tracking-widest text-primary hover:bg-primary/10">
                                <RefreshCw className="w-3 h-3 mr-1.5" /> Reset PIN
                            </Button>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <Input 
                                {...register('pin')} 
                                className="text-center text-5xl h-20 font-black tracking-[0.5em] bg-white border-primary/20 rounded-3xl shadow-xl" 
                                maxLength={4}
                                readOnly
                            />
                            <p className="text-[10px] text-center text-muted-foreground uppercase font-bold tracking-tight opacity-60">Authentication key for terminal and overrides.</p>
                        </div>
                    </div>

                    <div className="p-6 rounded-[2rem] border-2 bg-muted/5 space-y-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                            <ShieldCheck className="w-3.5 h-3.5 opacity-40" /> Authentication Control
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                            <p className="text-[11px] font-medium text-slate-600 uppercase tracking-tight text-center sm:text-left">Dispatch a secure key recovery link to their verified inbox.</p>
                            <Button type="button" variant="outline" onClick={onSendPasswordReset} className="h-10 px-6 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm w-full sm:w-auto shrink-0">
                                Send Reset Link
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-3 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Studio Role</Label>
                            <Controller name="role" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        <SelectItem value="staff" className="font-bold uppercase text-[10px] tracking-widest">STAFF PROVIDER</SelectItem>
                                        <SelectItem value="admin" className="font-bold uppercase text-[10px] tracking-widest">ADMIN MANAGER</SelectItem>
                                        <SelectItem value="owner" className="font-bold uppercase text-[10px] tracking-widest">MASTER OWNER</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}/>
                        </div>
                        <div className="space-y-3 text-left">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Expertise Tier</Label>
                            <Controller name="pricingTierId" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {pricingTiers.map(tier => (<SelectItem key={tier.id} value={tier.id} className="font-bold uppercase text-[10px] tracking-widest">{tier.name.toUpperCase()}</SelectItem>))}
                                    </SelectContent>
                                </Select>
                            )}/>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-6 border-2 border-dashed rounded-[2rem] bg-muted/5">
                        <div className='space-y-1 text-left'>
                            <Label htmlFor="public-toggle-edit" className="text-base font-black uppercase tracking-tight">Public Registry</Label>
                            <p className='text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60'>Show on the public booking directory</p>
                        </div>
                        <Controller name="showOnPublicPage" control={control} render={({ field }) => ( <Switch id="public-toggle-edit" checked={field.value} onCheckedChange={field.onChange} className="scale-125" /> )}/>
                    </div>
                </div>
            </div>

            <Separator className="border-dashed" />

            <div className="space-y-10">
                <SectionHeader icon={Sparkles} title="Profile & Mastery" step={2} />
                <div className="space-y-8 text-left">
                    <div className="space-y-2">
                        <Label htmlFor="bio-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Professional Narrative (Public)</Label>
                        <Textarea id="bio-edit" placeholder="Draft a compelling profile for guests..." {...register('bio')} className="rounded-2xl border-2 bg-muted/5 min-h-[120px] focus-visible:ring-primary/20 font-medium" />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="specialties-edit" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Signature Specialties</Label>
                        <Input id="specialties-edit" placeholder="e.g., BALAYAGE, PRECISION CUTS" {...register('specialties')} className="h-12 rounded-xl border-2 font-black uppercase text-xs shadow-inner" />
                    </div>

                    <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                            <Smartphone className="w-3.5 h-3.5 opacity-40" /> Social Presence
                        </Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {[
                                { id: 'instagramUrl', icon: Instagram, label: 'Instagram' },
                                { id: 'facebookUrl', icon: Facebook, label: 'Facebook' },
                                { id: 'tiktokUrl', icon: Film, label: 'TikTok' },
                                { id: 'twitterUrl', icon: Twitter, label: 'Twitter/X' },
                                { id: 'youtubeUrl', icon: Youtube, label: 'YouTube' },
                                { id: 'portfolioUrl', icon: LinkIcon, label: 'Portfolio' }
                            ].map(social => (
                                <div key={social.id} className="relative group">
                                    <social.icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40 group-focus-within:text-primary transition-colors" />
                                    <Input placeholder={`${social.label} URL...`} {...register(social.id as any)} className="h-11 pl-10 rounded-xl border-2 font-medium text-[10px] shadow-sm" />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-dashed">
                        <div className="flex items-center justify-between px-1">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <List className="w-3.5 h-3.5 opacity-40" /> Active Catalog
                            </Label>
                            <Button variant="ghost" size="sm" type="button" onClick={() => setIsServicesDialogOpen(true)} className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5 shadow-sm">
                                <PlusCircle className="w-3 h-3 mr-1.5" /> Define Skills
                            </Button>
                        </div>
                        {selectedServices.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {selectedServices.map(service => (
                                    <div key={service.id} className="flex items-center justify-between p-3 rounded-xl border-2 bg-white shadow-sm group">
                                        <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate flex-1">{service.name}</span>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setValue('services', selectedServiceIds.filter(id => id !== service.id), { shouldDirty: true })}><Trash2 className="w-3.5 h-3.5" /></Button>
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
                </div>
            </div>

            <Separator className="border-dashed" />

            <div className="space-y-10">
                <SectionHeader icon={Wallet} title="Compensation Engine" step={3} />
                <div className="space-y-8 text-left">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Payout Logic</Label>
                            <Controller name="payStructure" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        <SelectItem value="commission" className="font-bold uppercase text-[10px] tracking-widest">COMMISSION SPLIT</SelectItem>
                                        <SelectItem value="hourly" className="font-bold uppercase text-[10px] tracking-widest">HOURLY WAGE</SelectItem>
                                        <SelectItem value="salary" className="font-bold uppercase text-[10px] tracking-widest">BASE SALARY</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}/>
                        </div>
                        {payStructure === 'commission' && (
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Settlement Cycle</Label>
                                <Controller name="payoutFrequency" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5"><SelectValue /></SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            <SelectItem value="weekly" className="font-bold">WEEKLY</SelectItem>
                                            <SelectItem value="bi-weekly" className="font-bold">BI-WEEKLY</SelectItem>
                                        </SelectContent>
                                    </Select>
                                )}/>
                            </div>
                        )}
                    </div>

                    {payStructure === 'commission' ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="commissionRate-edit" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Service Ratio (%)</Label>
                                <div className="relative"><Input id="commissionRate-edit" type="number" {...register('commissionRate')} className="h-12 pr-8 rounded-xl border-2 font-black text-lg text-primary shadow-inner" /><Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40"/></div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="retailCommission-edit" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Retail Ratio (%)</Label>
                                <div className="relative"><Input id="retailCommission-edit" type="number" {...register('retailCommissionRate')} className="h-12 pr-8 rounded-xl border-2 font-black text-lg text-primary shadow-inner" /><Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40"/></div>
                            </div>
                        </div>
                    ) : payStructure === 'hourly' ? (
                        <div className="space-y-2 animate-in slide-in-from-top-2">
                            <Label htmlFor="hourlyRate-edit" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Hourly Base Rate</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                                <Input id="hourlyRate-edit" type="number" step="0.01" {...register('hourlyRate')} className="h-14 pl-12 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner bg-muted/5" />
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <Separator className="border-dashed" />

            <div className="space-y-10">
                <SectionHeader icon={Shield} title="Governance & Compliance" step={4} />
                <div className="space-y-10 text-left">
                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><Heart className="w-3 h-3" /> Emergency Contact</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Contact Name</Label><Input placeholder="FULL LEGAL NAME" {...register('emergencyContact.name')} className="h-11 rounded-xl border-2 font-bold text-xs uppercase" /></div>
                            <div className="space-y-1.5">
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
                            <div className="sm:col-span-2"><PhoneInput name="emergencyContact.phone" label="Emergency Contact Mobile" className="h-11 rounded-xl" /></div>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-dashed">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60"><ShieldCheck className="w-3 h-3" /> Licensing Ledger</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">License Number</Label><Input placeholder="STATE-ID-XXXX" {...register('compliance.licenseNumber')} className="h-11 rounded-xl border-2 font-mono font-black text-xs" /></div>
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Registry Expiry</Label>
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

                    <div className="space-y-4 pt-4 border-t border-dashed">
                        <div className="flex items-center justify-between px-1">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 opacity-40" /> Compliance Forms
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
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive group-hover:opacity-100 transition-opacity" onClick={() => setValue('assignedFormIds', assignedFormIds.filter(id => id !== form.id), { shouldDirty: true })}><Trash2 className="w-3.5 h-3.5" /></Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-10 text-center border-4 border-dashed rounded-[2.5rem] opacity-30 flex flex-col items-center gap-3">
                                <FileText className="w-8 h-8" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No forms assigned</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <SelectServicesDialog open={isServicesDialogOpen} onOpenChange={setIsServicesDialogOpen} allServices={services} initialSelected={selectedServices} onSelect={(newSelection) => setValue('services', newSelection.map(s => s.id), { shouldDirty: true })} />
            <BrowseConsentFormsDialog open={isConsentFormDialogOpen} onOpenChange={setIsConsentFormDialogOpen} onSelect={(forms) => setValue('assignedFormIds', forms.map(f => f.id), { shouldDirty: true })} allForms={consentForms} initialSelected={assignedForms} />
        </div>
    );
};

export const EditStaffDialog: React.FC<EditStaffDialogProps> = ({
  open, onOpenChange, onSave, staffMember, services, consentForms, pricingTiers, existingStaff,
}) => {
  const isMobile = useIsMobile();
  const { toast: uiToast } = useToast();
  const methods = useForm<EditStaffFormData>({
    resolver: zodResolver(editStaffSchema),
  });

  useEffect(() => {
    if (staffMember && open) {
        const specialtiesString = Array.isArray(staffMember.specialties) ? staffMember.specialties.join(', ') : staffMember.specialties || '';
        methods.reset({
            ...staffMember,
            specialties: specialtiesString,
            avatarUrl: staffMember.avatarUrl || '',
            pricingTierId: staffMember.pricingTierId || '',
            payoutFrequency: staffMember.payoutFrequency || 'weekly',
            compliance: {
                ...staffMember.compliance,
                licenseExpiry: staffMember.compliance?.licenseExpiry ? parseISO(staffMember.compliance.licenseExpiry) : undefined,
            },
            assignedFormIds: staffMember.assignedFormIds || [],
            pin: staffMember.pin || '',
            showOnPublicPage: staffMember.showOnPublicPage !== false,
        });
    }
  }, [staffMember, open, methods]);

  const handleSendPasswordReset = async () => {
    if (!staffMember?.email) return;
    const auth = getAuth();
    try {
        await sendPasswordResetEmail(auth, staffMember.email);
        uiToast({ title: "Reset Link Dispatched", description: `Protocol instructions sent to ${staffMember.email}.` });
    } catch (error: any) {
        uiToast({ variant: 'destructive', title: 'Dispatch Failed', description: error.message });
    }
  };

  const handleRegeneratePin = () => {
    let pin = '';
    let isUnique = false;
    while (!isUnique) {
        pin = Math.floor(1000 + Math.random() * 9000).toString();
        isUnique = !existingStaff.some(s => s.id !== staffMember?.id && s.pin === pin);
    }
    methods.setValue('pin', pin, { shouldDirty: true });
    uiToast({ title: "PIN Synchronized", description: "The provider's security signature has been updated." });
  }

  const handleSave = (data: EditStaffFormData) => {
    if (!staffMember) return;
    const staffDataToSave: Staff = {
        ...staffMember,
        ...data,
        specialties: typeof data.specialties === 'string' ? data.specialties.split(',').map(s => s.trim()).filter(s => s) : data.specialties,
        compliance: data.compliance?.licenseExpiry ? { ...data.compliance, licenseExpiry: data.compliance.licenseExpiry.toISOString() } : undefined,
    };
    onSave(staffDataToSave);
    onOpenChange(false);
  };

  const DialogComponent = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  if (!staffMember) return null;

  return (
    <DialogComponent open={open} onOpenChange={onOpenChange}>
        <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[3rem]" : "sm:max-w-3xl max-h-[90dvh]")}>
            <FormProvider {...methods}>
                <form id="edit-staff-strategic-form" onSubmit={methods.handleSubmit(handleSave)} className="flex flex-col h-full overflow-hidden">
                    <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-8 pb-6" : "p-10 pb-6")}>
                        <div className="flex items-center gap-3 mb-2">
                            <Sparkles className="w-5 h-5 text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Refinement</span>
                        </div>
                        <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">Modify Provider</DialogTitle>
                        <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Refining record ID: {staffMember.id.slice(-8).toUpperCase()}</DialogDescription>
                    </DialogHeader>
                    
                    <ScrollArea className="flex-1">
                        <div className={cn("pb-32", isMobile ? "p-6" : "p-10")}>
                            <EditStaffFormInternal 
                                services={services} 
                                consentForms={consentForms} 
                                pricingTiers={pricingTiers} 
                                staffMember={staffMember}
                                onSendPasswordReset={handleSendPasswordReset}
                                onRegeneratePin={handleRegeneratePin}
                            />
                        </div>
                    </ScrollArea>

                    <DialogFooter className={cn("border-t bg-background flex-shrink-0 shadow-2xl", isMobile ? "p-6 pt-4" : "p-10 pt-6")}>
                        <div className="flex w-full gap-4">
                            <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="flex-1 h-14 font-black uppercase tracking-widest text-[11px] text-slate-500">Cancel</Button>
                            <Button type="submit" className="flex-[2.5] h-14 rounded-[2rem] font-black uppercase tracking-widest text-[11px] shadow-2xl shadow-primary/30 active:scale-95 transition-all group">Commit Changes <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
                        </div>
                    </DialogFooter>
                </form>
             </FormProvider>
        </ContentComponent>
    </DialogComponent>
  );
};
