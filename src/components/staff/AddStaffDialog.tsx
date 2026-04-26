'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { PhoneInput } from '@/components/ui/phone-input';
import { type Staff, type Service, type ConsentForm, type PricingTier } from '@/lib/data';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '../ui/scroll-area';
import {
  User, Wallet, CalendarIcon, Shield, FileText, List, PlusCircle, Trash2,
  BookText, Instagram, Link as LinkIcon, Facebook, Twitter, Film,
  Youtube, Clock, KeyRound, Sparkles, ArrowRight, Check, ShieldCheck,
  Fingerprint, Award, Heart, Percent, DollarSign, RefreshCw,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
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
    licenseExpiry: z.string().optional(),
    documentUrl: z.string().optional(),
  }).optional(),
  // FIX: pin must be a 4-digit string — validated here, set via setValue not readOnly
  pin: z.string().length(4, 'PIN must be exactly 4 digits.').regex(/^\d{4}$/, 'PIN must be numeric.'),
  showOnPublicPage: z.boolean().default(true),
}).superRefine((data, ctx) => {
  if (data.payStructure === 'commission' || data.payStructure === 'hourly_plus_commission') {
    if (data.commissionRate === undefined || data.commissionRate === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Commission rate is required.', path: ['commissionRate'] });
    }
    if (!data.payoutFrequency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Payout frequency is required.', path: ['payoutFrequency'] });
    }
  }
  if ((data.payStructure === 'hourly' || data.payStructure === 'hourly_plus_commission') && (data.hourlyRate === undefined || data.hourlyRate === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Hourly rate is required.', path: ['hourlyRate'] });
  }
});

export type AddStaffFormData = z.infer<typeof addStaffSchema>;

interface AddStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: AddStaffFormData) => void;
  services: Service[];
  consentForms: ConsentForm[];
  pricingTiers: PricingTier[];
  existingStaff?: Staff[];
}

const SectionHeader = ({ icon: Icon, title, step }: { icon: any; title: string; step: number | string }) => (
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

// ─── STEP 1 ───────────────────────────────────────────────────────────────────
const Step1 = ({ pricingTiers }: { pricingTiers: PricingTier[] }) => {
  const { register, control, watch, setValue, formState: { errors } } = useFormContext<AddStaffFormData>();
  const pin = watch('pin') || '';

  // Regenerate PIN — called from the refresh button
  // FIX: uses setValue (not readOnly + reset) so RHF actually tracks the new value
  const handleRegeneratePin = () => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    setValue('pin', newPin, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <div className="space-y-10">
      <SectionHeader icon={Fingerprint} title="Identity & Access" step={1} />
      <div className="space-y-6">

        {/* Name */}
        <div className="space-y-2 text-left">
          <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Full Name</Label>
          <Input
            id="name"
            placeholder="e.g., Brenda Barnes"
            {...register('name')}
            className="h-14 rounded-2xl border-2 font-black uppercase text-lg tracking-tight shadow-inner"
          />
          {errors.name && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
        </div>

        {/* Email */}
        <div className="space-y-2 text-left">
          <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Professional Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="brenda@example.com"
            {...register('email')}
            className="h-14 rounded-2xl border-2 font-bold"
          />
          {errors.email && <p className="text-[10px] font-black text-destructive uppercase ml-1">{errors.email.message}</p>}
        </div>

        {/* Phone */}
        <div className="space-y-2 text-left">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Phone (Optional)</Label>
          <PhoneInput name="phone" label="" />
        </div>

        {/* PIN block — FIX: no readOnly, uses hidden input pattern so staff can't accidentally edit
            but RHF can still read + validate the value */}
        <div className="p-6 bg-primary/5 rounded-[2.5rem] border-4 border-primary/10 space-y-4 shadow-inner">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Security Signature</span>
            </div>
            <Badge className="bg-primary text-white border-none font-black text-[9px] uppercase h-6 px-3">Unique PIN</Badge>
          </div>

          <div className="flex flex-col items-center gap-3">
            {/*
              FIX: The critical change is here.
              - We removed `readOnly` — that attribute silently breaks RHF form submission
                because the browser excludes read-only inputs from the FormData payload,
                and RHF mirrors this behaviour.
              - Instead we use `tabIndex={-1}` + `onKeyDown preventDefault` so it looks
                locked to the user but RHF can still read and validate the value.
              - The `{...register('pin')}` spread ensures the field is registered properly.
            */}
            <div className="relative w-full">
              <Input
                {...register('pin')}
                className="text-center text-5xl h-20 font-black tracking-[0.5em] bg-white border-primary/20 rounded-3xl shadow-xl cursor-not-allowed caret-transparent select-all"
                maxLength={4}
                tabIndex={-1}
                onKeyDown={(e) => {
                  // Allow tab/shift-tab for accessibility but block all typing
                  if (!['Tab', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
                    e.preventDefault();
                  }
                }}
                autoComplete="off"
              />
              {/* Refresh button overlaid on the input */}
              <button
                type="button"
                onClick={handleRegeneratePin}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors"
                title="Generate new PIN"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-center text-muted-foreground uppercase font-bold tracking-tight opacity-60">
              Auto-generated · tap <RefreshCw className="inline w-3 h-3" /> to regenerate · required for terminal access
            </p>
            {errors.pin && (
              <p className="text-[10px] font-bold text-destructive uppercase">{errors.pin.message}</p>
            )}
          </div>
        </div>

        {/* Role + Tier */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Studio Role</Label>
            <Controller name="role" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  <SelectItem value="staff" className="font-bold uppercase text-[10px] tracking-widest">STAFF PROVIDER</SelectItem>
                  <SelectItem value="admin" className="font-bold uppercase text-[10px] tracking-widest">ADMIN MANAGER</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Expertise Tier</Label>
            <Controller name="pricingTierId" control={control} render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="h-14 rounded-2xl border-2 font-black uppercase text-xs shadow-inner bg-muted/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  {pricingTiers.map(tier => (
                    <SelectItem key={tier.id} value={tier.id} className="font-bold uppercase text-[10px] tracking-widest">
                      {tier.name.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
          </div>
        </div>

        {/* Public directory toggle */}
        <div className="flex items-center justify-between p-6 border-2 border-dashed rounded-[2rem] bg-muted/5">
          <div className="space-y-1 text-left">
            <Label htmlFor="showOnPublicPage" className="text-base font-black uppercase tracking-tight">Public Directory</Label>
            <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Show on the guest booking page</p>
          </div>
          <Controller name="showOnPublicPage" control={control} render={({ field }) => (
            <Switch id="showOnPublicPage" checked={field.value} onCheckedChange={field.onChange} className="scale-125" />
          )} />
        </div>

      </div>
    </div>
  );
};

// ─── STEP 2 ───────────────────────────────────────────────────────────────────
const Step2 = ({ services, consentForms }: { services: Service[]; consentForms: ConsentForm[] }) => {
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

        {/* Avatar upload */}
        <div className="flex flex-col items-center gap-6 mb-6">
          <Controller name="avatarUrl" control={control} render={({ field }) => (
            <div className="relative group">
              <Avatar className="w-28 h-28 border-4 border-background shadow-2xl rounded-[2rem] overflow-hidden transition-all group-hover:scale-105">
                <AvatarImage src={field.value || undefined} alt="Staff Avatar" className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary font-black uppercase text-xl">
                  {(watch('name') || 'S').charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-[2rem] cursor-pointer">
                <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
              </div>
            </div>
          )} />
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Provider Portrait</p>
        </div>

        {/* Bio */}
        <div className="space-y-2 text-left">
          <Label htmlFor="bio" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Professional Bio</Label>
          <Textarea
            id="bio"
            placeholder="Draft a compelling profile for guests..."
            {...register('bio')}
            className="rounded-2xl border-2 bg-muted/5 min-h-[100px]"
          />
        </div>

        {/* Specialties */}
        <div className="space-y-2 text-left">
          <Label htmlFor="specialties" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Signature Specialties</Label>
          <Input
            id="specialties"
            placeholder="e.g., BALAYAGE, VIVIDS, PRECISION CUTS"
            {...register('specialties')}
            className="h-12 rounded-xl border-2 font-black uppercase text-xs shadow-inner"
          />
          <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 ml-1">Delimited by commas</p>
        </div>

        {/* Services */}
        <div className="space-y-4 pt-4 border-t border-dashed text-left">
          <div className="flex items-center justify-between px-1">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <List className="w-3.5 h-3.5 opacity-40" /> Treatment Catalog
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsServicesDialogOpen(true)}
              className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5"
            >
              <PlusCircle className="w-3 h-3 mr-1.5" /> Define Skills
            </Button>
          </div>
          {selectedServices.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedServices.map(service => (
                <div key={service.id} className="flex items-center justify-between p-3 rounded-xl border-2 bg-white shadow-sm group">
                  <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate flex-1">{service.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setValue('services', selectedServiceIds.filter(id => id !== service.id), { shouldDirty: true })}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
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

        {/* Consent forms */}
        <div className="space-y-4 text-left">
          <div className="flex items-center justify-between px-1">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 opacity-40" /> Associated Documents
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsConsentFormDialogOpen(true)}
              className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20 rounded-lg hover:bg-primary/5"
            >
              <PlusCircle className="w-3 h-3 mr-1.5" /> Assign Forms
            </Button>
          </div>
          {assignedForms.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {assignedForms.map(form => (
                <div key={form.id} className="flex items-center justify-between p-3 rounded-xl border-2 bg-white shadow-sm group">
                  <span className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{form.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive group-hover:opacity-100 transition-opacity"
                    onClick={() => setValue('assignedFormIds', assignedFormIds.filter(id => id !== form.id), { shouldDirty: true })}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
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

      <SelectServicesDialog
        open={isServicesDialogOpen}
        onOpenChange={setIsServicesDialogOpen}
        allServices={services}
        initialSelected={selectedServices}
        onSelect={(newSelection) => setValue('services', newSelection.map(s => s.id), { shouldDirty: true })}
      />
      <BrowseConsentFormsDialog
        open={isConsentFormDialogOpen}
        onOpenChange={setIsConsentFormDialogOpen}
        onSelect={(forms) => setValue('assignedFormIds', forms.map(f => f.id), { shouldDirty: true })}
        allForms={consentForms}
        initialSelected={assignedForms}
      />
    </div>
  );
};

// ─── STEP 3 ───────────────────────────────────────────────────────────────────
const Step3 = () => {
  const { control, register, watch, formState: { errors } } = useFormContext<AddStaffFormData>();
  const payStructure = watch('payStructure');

  return (
    <div className="space-y-10">
      <SectionHeader icon={Wallet} title="Compensation & Logistics" step={3} />
      <div className="space-y-8">
        <div className="space-y-6 text-left">

          {/* Pay structure + payout cadence */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Pay Structure</Label>
              <Controller name="payStructure" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest shadow-inner bg-muted/5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-2 shadow-2xl">
                    <SelectItem value="commission" className="font-bold uppercase text-[10px] tracking-widest">COMMISSION</SelectItem>
                    <SelectItem value="hourly" className="font-bold uppercase text-[10px] tracking-widest">HOURLY WAGE</SelectItem>
                    <SelectItem value="hourly_plus_commission" className="font-bold uppercase text-[10px] tracking-widest">HOURLY + COMMISSION</SelectItem>
                    <SelectItem value="salary" className="font-bold uppercase text-[10px] tracking-widest">SALARY</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>

            {(payStructure === 'commission' || payStructure === 'hourly_plus_commission') && (
              <div className="space-y-2 text-left">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Payout Cadence</Label>
                <Controller name="payoutFrequency" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest shadow-inner bg-muted/5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                      <SelectItem value="weekly" className="font-bold uppercase text-[10px] tracking-widest">WEEKLY</SelectItem>
                      <SelectItem value="bi-weekly" className="font-bold uppercase text-[10px] tracking-widest">BI-WEEKLY</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
                {errors.payoutFrequency && (
                  <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.payoutFrequency.message}</p>
                )}
              </div>
            )}
          </div>

          {/* Commission rates */}
          {(payStructure === 'commission' || payStructure === 'hourly_plus_commission') && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="commissionRate" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Service %</Label>
                <div className="relative">
                  <Input
                    id="commissionRate"
                    type="number"
                    placeholder="40"
                    {...register('commissionRate')}
                    className="h-12 pr-8 rounded-xl border-2 font-black text-lg text-primary shadow-inner"
                  />
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                </div>
                {errors.commissionRate && (
                  <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.commissionRate.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="retailCommissionRate" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Retail %</Label>
                <div className="relative">
                  <Input
                    id="retailCommissionRate"
                    type="number"
                    placeholder="10"
                    {...register('retailCommissionRate')}
                    className="h-12 pr-8 rounded-xl border-2 font-black text-lg text-primary shadow-inner"
                  />
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary opacity-40" />
                </div>
              </div>
            </div>
          )}

          {/* Hourly rate */}
          {(payStructure === 'hourly' || payStructure === 'hourly_plus_commission') && (
            <div className="space-y-2">
              <Label htmlFor="hourlyRate" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Hourly Base Rate</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary opacity-40" />
                <Input
                  id="hourlyRate"
                  type="number"
                  placeholder="25.00"
                  {...register('hourlyRate')}
                  className="h-14 pl-10 rounded-2xl border-2 font-black text-xl font-mono text-primary shadow-inner"
                />
              </div>
              {errors.hourlyRate && (
                <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.hourlyRate.message}</p>
              )}
            </div>
          )}
        </div>

        <Separator className="border-dashed" />

        {/* Emergency contact */}
        <div className="space-y-6">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60 text-left">
              <Heart className="w-3 h-3" /> Emergency Protocol
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 text-left">
                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Legal Contact Name</Label>
                <Input
                  placeholder="EMERGENCY CONTACT"
                  {...register('emergencyContact.name')}
                  className="h-11 rounded-xl border-2 font-bold text-xs uppercase"
                />
              </div>
              <div className="space-y-1.5 text-left">
                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">Relationship</Label>
                <Controller name="emergencyContact.relationship" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[9px] tracking-widest bg-muted/5">
                      <SelectValue placeholder="SELECT..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                      {['Spouse', 'Partner', 'Parent', 'Guardian', 'Sibling', 'Child', 'Friend', 'Other'].map(r => (
                        <SelectItem key={r} value={r} className="font-bold uppercase text-[9px] tracking-widest">
                          {r.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="sm:col-span-2 text-left">
                <PhoneInput name="emergencyContact.phone" label="Emergency Contact Mobile" className="h-11 rounded-xl" />
              </div>
            </div>
          </div>

          {/* Licensing */}
          <div className="space-y-4 pt-4 border-t border-dashed text-left">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-60">
              <ShieldCheck className="w-3 h-3" /> Licensing Record
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">License Number</Label>
                <Input
                  placeholder="STATE-ID-XXXX"
                  {...register('compliance.licenseNumber')}
                  className="h-11 rounded-xl border-2 font-mono font-black text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-muted-foreground ml-1">License Expiry Date</Label>
                <input
                  type="date"
                  {...register('compliance.licenseExpiry')}
                  className="w-full h-11 rounded-xl border-2 border-input px-3 font-bold text-sm bg-background outline-none focus:border-primary/40 focus:ring-0"
                />
                <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-40 ml-1">mm/dd/yyyy</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

// ─── MAIN DIALOG ──────────────────────────────────────────────────────────────
export const AddStaffDialog: React.FC<AddStaffDialogProps> = ({
  open, onOpenChange, onSave, services, consentForms, pricingTiers, existingStaff,
}) => {
  const [step, setStep] = useState(1);
  const totalSteps = 3;
  const isMobile = useIsMobile();

  const methods = useForm<AddStaffFormData>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: {
      role: 'staff',
      email: '',
      name: '',
      pricingTierId: '',
      payStructure: 'commission',
      payoutFrequency: 'weekly',
      commissionRate: 40,
      retailCommissionRate: 10,
      services: [],
      assignedFormIds: [],
      showOnPublicPage: true,
      pin: '',
    },
  });

  // Generates a PIN that doesn't collide with any existing staff member's PIN
  const generateUniquePin = (staffList: Staff[]) => {
    let pin = '';
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 100) {
      pin = Math.floor(1000 + Math.random() * 9000).toString();
      isUnique = !staffList.some(s => s.pin === pin);
      attempts++;
    }
    return pin;
  };

  useEffect(() => {
    if (open) {
      const newPin = generateUniquePin(existingStaff || []);

      // FIX: reset() sets the form back to initial values including PIN
      methods.reset({
        name: '',
        email: '',
        role: 'staff',
        pricingTierId: pricingTiers?.[0]?.id || '',
        payStructure: 'commission',
        payoutFrequency: 'weekly',
        commissionRate: 40,
        retailCommissionRate: 10,
        services: [],
        assignedFormIds: [],
        showOnPublicPage: true,
        pin: newPin,
      });

      // FIX: setTimeout(0) runs after the React render cycle so the reset has
      // settled before we call setValue. Without this, Zod may see an empty
      // string from the reset before the PIN value has been applied.
      setTimeout(() => {
        methods.setValue('pin', newPin, { shouldValidate: true, shouldDirty: true });
      }, 0);

      setStep(1);
    }
  }, [open, pricingTiers, existingStaff, methods]);

  // Per-step field validation before advancing
  const handleNext = async (e: React.MouseEvent) => {
    e.preventDefault();

    const fieldsToValidate =
      step === 1 ? (['name', 'email', 'role', 'pin'] as const) :
      step === 2 ? (['services'] as const) :
      (['payStructure', 'payoutFrequency', 'commissionRate'] as const);

    const valid = await methods.trigger(fieldsToValidate as any);
    if (valid) setStep(prev => prev + 1);
  };

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    setStep(prev => prev - 1);
  };

  // FIX: handleSubmit from RHF wraps our onSave — if there are any validation
  // errors (including the PIN) they surface here rather than silently blocking.
  const handleFormSubmit = methods.handleSubmit(
    (data) => {
      onSave(data);
    },
    (errors) => {
      // Log validation errors in dev so they're visible
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AddStaffDialog] Form validation errors:', errors);
      }
    }
  );

  const formBody = (
    <FormProvider {...methods}>
      <form id="add-staff-wizard-form" onSubmit={handleFormSubmit} className="flex flex-col flex-1 min-h-0">

        {/* Header with progress bar */}
        <DialogHeader className={cn('flex-shrink-0 text-left border-b bg-muted/5', isMobile ? 'p-6' : 'p-8 pb-6')}>
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Intake</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">
            Register Provider
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">
            Onboard a new technician and secure their studio credentials.
          </DialogDescription>
          <div className="pt-6">
            <Progress value={(step / totalSteps) * 100} className="h-1 rounded-full bg-muted" />
          </div>
        </DialogHeader>

        {/* Scrollable body */}
        <ScrollArea className="flex-1">
          <div className={cn('pb-32', isMobile ? 'p-6' : 'p-8')}>
            {step === 1 && <Step1 pricingTiers={pricingTiers} />}
            {step === 2 && <Step2 services={services} consentForms={consentForms} />}
            {step === 3 && <Step3 />}
          </div>
        </ScrollArea>

        {/* Footer nav */}
        <DialogFooter className={cn('border-t bg-background flex-shrink-0 shadow-2xl', isMobile ? 'p-4' : 'p-6 sm:p-8 pt-4')}>
          <div className="flex w-full gap-4">
            {step > 1 && (
              <Button
                variant="ghost"
                onClick={handleBack}
                type="button"
                className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-tighter text-[10px] md:text-2xl text-slate-400"
              >
                Back
              </Button>
            )}
            <div className={cn('flex gap-3', step === 1 ? 'w-full' : 'flex-[2.5]')}>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                type="button"
                className="flex-1 h-12 md:h-16 rounded-3xl font-black uppercase tracking-widest text-[10px] md:text-xl border-2"
              >
                Cancel
              </Button>
              {step < totalSteps ? (
                <Button
                  onClick={handleNext}
                  type="button"
                  className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30 group"
                >
                  Continue <ArrowRight className="ml-3 w-4 h-4 md:w-8 md:h-8 transition-transform group-hover:translate-x-1" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="flex-[1.5] h-12 md:h-16 font-black uppercase tracking-widest text-[10px] md:text-xl rounded-[2rem] shadow-2xl shadow-primary/30"
                >
                  Save Provider
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>

      </form>
    </FormProvider>
  );

  // Render as Sheet on mobile, Dialog on desktop — same inner content
  const DialogContainer = isMobile ? Sheet : Dialog;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden',
          isMobile ? 'h-[92dvh] rounded-t-[2.5rem]' : 'sm:max-w-4xl max-h-[90dvh]'
        )}
        side={isMobile ? 'bottom' : undefined}
      >
        {formBody}
      </DialogContent>
    </DialogContainer>
  );
};