
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  ShieldAlert, 
  AlertTriangle, 
  Ear, 
  Upload, 
  UserPlus, 
  Gift, 
  Home, 
  Trash2, 
  X as XIcon, 
  Sparkles, 
  Check, 
  User, 
  Heart,
  FileText,
  Clock,
  Edit,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Client } from '@/lib/data';
import { useForm, FormProvider, Controller, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ImageUpload } from '../shared/ImageUpload';
import { format, parseISO } from 'date-fns';
import { PhoneInput } from '../ui/phone-input';
import { useInventory } from '@/context/InventoryContext';

const clientSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('Invalid email address.').optional().or(z.literal('')),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  intel: z.object({
    medical: z.object({
        flags: z.array(z.string()).optional(),
        notes: z.string().optional()
    }).optional(),
    allergies: z.object({
        flags: z.array(z.string()).optional(),
        notes: z.string().optional()
    }).optional(),
    sensory: z.object({
        flags: z.array(z.string()).optional(),
        notes: z.string().optional()
    }).optional(),
    referralSource: z.string().optional(),
  }).optional(),
  referringClientId: z.string().optional(),
  notes: z.object({
    goals: z.string().optional(),
    routine: z.string().optional(),
    history: z.string().optional(),
    general: z.string().optional()
  }).optional(),
  birthday: z.date().optional(),
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
  emergencyContact: z.object({
      name: z.string().optional(),
      relationship: z.string().optional(),
      phone: z.string().optional(),
  }).optional(),
});

type ClientFormData = z.infer<typeof clientSchema>;

const IntelCategory = ({
  title,
  icon,
  color,
  predefinedItems,
  categoryKey,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  predefinedItems: string[];
  categoryKey: 'medical' | 'allergies' | 'sensory';
}) => {
  const { control, getValues, setValue } = useFormContext<ClientFormData>();
  const [customItems, setCustomItems] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');

  const flagsFieldName = `intel.${categoryKey}.flags` as const;
  const notesFieldName = `intel.${categoryKey}.notes` as const;

  const handleAddItem = () => {
    if (inputValue.trim() && !customItems.includes(inputValue.trim())) {
      setCustomItems([...customItems, inputValue.trim()]);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddItem();
    }
  };

  const handleRemoveItem = (itemToRemove: string) => {
    setCustomItems(customItems.filter(item => item !== itemToRemove));
  };
  
  const handleFlagToggle = (item: string) => {
    const currentFlags = getValues(flagsFieldName) || [];
    const newFlags = currentFlags.includes(item)
      ? currentFlags.filter(flag => flag !== item)
      : [...currentFlags, item];
    setValue(flagsFieldName, newFlags, { shouldDirty: true });
  };
  
  const colorClasses = {
      red: 'bg-red-500/5',
      amber: 'bg-amber-500/5',
      blue: 'bg-blue-500/5',
  }

  return (
    <AccordionItem value={title.toLowerCase().replace(' ', '-')} className="border-2 rounded-2xl overflow-hidden mb-3">
      <AccordionTrigger className={cn("p-4 hover:no-underline font-black uppercase text-[10px] tracking-widest", colorClasses[color as keyof typeof colorClasses] || 'bg-muted/50')}>
        <div className="flex items-center gap-3">
          {icon}
          <span>{title}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-5 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {predefinedItems.map(item => (
            <div key={item} className="flex items-center space-x-3">
              <Checkbox
                id={`check-${title}-${item}`}
                onCheckedChange={() => handleFlagToggle(item)}
                checked={getValues(flagsFieldName)?.includes(item)}
                className="h-5 w-5 rounded-lg border-2"
              />
              <Label htmlFor={`check-${title}-${item}`} className="text-xs font-bold uppercase tracking-tight text-slate-600">{item}</Label>
            </div>
          ))}
        </div>
        <div className="space-y-3">
             <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Custom Markers</Label>
             <div className="flex gap-2">
                <Input 
                    placeholder="Type and enter..." 
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-10 rounded-xl border-2"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="h-10 px-4 rounded-xl font-bold uppercase text-[10px] tracking-widest border-2">Add</Button>
            </div>
             <div className="flex flex-wrap gap-2 pt-1">
                {customItems.map(item => (
                    <Badge key={item} variant="secondary" className="text-[10px] font-black uppercase h-7 px-3 rounded-lg border-2">
                        {item}
                        <button type="button" onClick={() => handleRemoveItem(item)} className="ml-2 -mr-1 rounded-full p-0.5 hover:bg-destructive/20 text-destructive">
                            <XIcon className="h-3 w-3" />
                        </button>
                    </Badge>
                ))}
            </div>
        </div>
        <div className="space-y-2">
            <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Detailed Intel</Label>
            <Controller
                name={notesFieldName}
                control={control}
                render={({ field }) => (
                    <Textarea 
                        placeholder={`Provide context for ${title.toLowerCase()}...`} 
                        className="text-sm rounded-xl border-2 bg-muted/5 min-h-[100px]"
                        {...field}
                    />
                )}
            />
        </div>
      </AccordionContent>
    </AccordionItem>
  )
};

const EditClientFormInternal = ({ client }: { client: Client }) => {
    const { clients: allClients } = useInventory();
    const { register, control, watch, setValue, formState: { errors } } = useFormContext<ClientFormData>();
    const referralSource = watch('intel.referralSource');
    
    const [birthDay, setBirthDay] = useState('');
    const [birthMonth, setBirthMonth] = useState('');
    const [birthYear, setBirthYear] = useState('');

    useEffect(() => {
        const bday = watch('birthday');
        if (bday) {
            const date = new Date(bday);
            setBirthMonth((date.getMonth() + 1).toString());
            setBirthDay(date.getDate().toString());
            setBirthYear(date.getFullYear().toString());
        }
    }, [watch]);

    useEffect(() => {
        if (birthYear && birthMonth && birthDay) {
            const date = new Date(parseInt(birthYear), parseInt(birthMonth) - 1, parseInt(birthDay));
            if (date.getFullYear() === parseInt(birthYear) && (date.getMonth() + 1) === parseInt(birthMonth) && date.getDate() === parseInt(birthDay)) {
                setValue('birthday', date, { shouldValidate: true, shouldDirty: true });
            }
        }
    }, [birthDay, birthMonth, birthYear, setValue]);

    const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number }) => (
        <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20">
                <Icon className="w-5 h-5" />
            </div>
            <div className="space-y-0.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-primary/60">Module {step}</p>
                <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">{title}</h3>
            </div>
        </div>
    );

    return (
        <div className="space-y-12">
            <div className="space-y-8">
                <SectionHeader icon={User} title="Primary Identity" step={1} />
                 <div className="flex flex-col sm:flex-row items-center gap-8 p-6 rounded-[2rem] border-2 bg-muted/5">
                    <Controller
                        name="avatarUrl"
                        control={control}
                        render={({ field }) => (
                            <div className="relative group">
                                <Avatar className="w-24 h-24 border-4 border-background shadow-2xl rounded-3xl overflow-hidden transition-all group-hover:scale-105">
                                    <AvatarImage src={field.value || undefined} alt="Client Avatar" className="object-cover" />
                                    <AvatarFallback className="bg-primary/10 text-primary font-black uppercase"><Upload className="h-8 w-8 opacity-40" /></AvatarFallback>
                                </Avatar>
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-[2rem] cursor-pointer">
                                    <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                                </div>
                            </div>
                        )}
                    />
                    <div className="flex-1 space-y-4 w-full">
                        <div className="space-y-1.5">
                            <Label htmlFor="full-name-edit" className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Legal Name</Label>
                            <Input id="full-name-edit" placeholder="ALEXANDER SMITH" {...register('name')} className="h-12 rounded-xl border-2 font-black uppercase tracking-tight text-base" />
                            {errors.name && <p className="text-[9px] font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="email-edit" className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Secure Email</Label>
                            <Input id="email-edit" type="email" placeholder="ALEX@EXAMPLE.COM" {...register('email')} className="h-12 rounded-xl border-2 font-bold text-sm" />
                        </div>
                    </div>
                </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                        <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Contact Phone</Label>
                        <PhoneInput name="phone" label="" placeholder="(555) 000-0000" className="h-12 rounded-xl border-2 font-black text-lg" />
                    </div>
                     <div className="space-y-1.5">
                        <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Birth Milestone</Label>
                        <div className="grid grid-cols-3 gap-2">
                            <Select value={birthMonth} onValueChange={setBirthMonth}>
                                <SelectTrigger className="h-12 rounded-xl border-2 font-bold"><SelectValue placeholder="MO" /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {Array.from({ length: 12 }, (_, i) => (
                                        <SelectItem key={i + 1} value={(i + 1).toString()} className="font-bold">
                                            {format(new Date(2000, i, 1), 'MMM').toUpperCase()}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={birthDay} onValueChange={setBirthDay}>
                                <SelectTrigger className="h-12 rounded-xl border-2 font-bold"><SelectValue placeholder="DAY" /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {Array.from({ length: 31 }, (_, i) => (
                                        <SelectItem key={i + 1} value={(i + 1).toString()} className="font-bold">{i + 1}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={birthYear} onValueChange={setBirthYear}>
                                <SelectTrigger className="h-12 rounded-xl border-2 font-bold"><SelectValue placeholder="YR" /></SelectTrigger>
                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                    {Array.from({ length: 100 }, (_, i) => {
                                        const year = new Date().getFullYear() - i;
                                        return (
                                            <SelectItem key={year} value={year.toString()} className="font-bold">{year}</SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-8">
                <SectionHeader icon={Home} title="Domicile" step={2} />
                <div className="space-y-4 p-6 rounded-[2rem] border-2 bg-muted/5">
                    <div className="space-y-1.5">
                        <Label htmlFor="street-edit" className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Street Address</Label>
                        <Input id="street-edit" placeholder="123 AVENUE OF THE STARS" {...register('address.street')} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">City</Label>
                            <Input placeholder="CITY" {...register('address.city')} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">State</Label>
                            <Input placeholder="STATE" {...register('address.state')} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-8">
                <SectionHeader icon={Heart} title="Emergency Data" step={3} />
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-6 rounded-[2rem] border-2 bg-muted/5">
                     <div className="space-y-1.5">
                        <Label htmlFor="emergency-name-edit" className="text-[9px] uppercase font-black text-muted-foreground ml-1">Contact Name</Label>
                        <Input id="emergency-name-edit" placeholder="CONTACT NAME" {...register('emergencyContact.name')} className="h-12 rounded-xl border-2 font-bold uppercase text-xs" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Contact Phone</Label>
                        <PhoneInput name="phone" label="" className="h-12 rounded-xl border-2" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="emergency-relationship-edit" className="text-[9px] uppercase font-black text-muted-foreground ml-1">Relationship</Label>
                        <Controller
                            name="emergencyContact.relationship"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="emergency-relationship-edit" className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest">
                                        <SelectValue placeholder="SELECT RELATIONSHIP..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        {['Spouse', 'Partner', 'Parent', 'Guardian', 'Sibling', 'Child', 'Friend', 'Other'].map(r => (
                                            <SelectItem key={r} value={r} className="font-bold uppercase text-[10px] tracking-widest">{r.toUpperCase()}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </div>
                </div>
            </div>

             <div className="space-y-8">
                <SectionHeader icon={Gift} title="Growth Intel" step={4} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                        <Label htmlFor="referral-source-edit" className="text-[9px] uppercase font-black text-muted-foreground ml-1">Discovery Source</Label>
                        <Controller
                            name="intel.referralSource"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger id="referral-source-edit" className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest">
                                        <SelectValue placeholder="HOW DID THEY FIND YOU?" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-2 shadow-2xl">
                                        <SelectItem value="social-media" className="font-bold">SOCIAL MEDIA</SelectItem>
                                        <SelectItem value="online-search" className="font-bold">ONLINE SEARCH</SelectItem>
                                        <SelectItem value="client-referral" className="font-bold">CLIENT REFERRAL</SelectItem>
                                        <SelectItem value="walk-in" className="font-bold">WALK-IN</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </div>
                    {referralSource === 'client-referral' && (
                        <Controller
                            name="referringClientId"
                            control={control}
                            render={({ field }) => (
                                <div className="space-y-1.5">
                                    <Label htmlFor="referring-client-edit" className="text-[9px] uppercase font-black text-muted-foreground ml-1">Referring Guest</Label>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <SelectTrigger id="referring-client-edit" className="h-12 rounded-xl border-2 font-bold uppercase text-[10px] tracking-widest">
                                        <SelectValue placeholder="SELECT REFERRER..." />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-2 shadow-2xl">
                                            {allClients.map(client => (
                                                <SelectItem key={client.id} value={client.id} className="font-bold">{client.name.toUpperCase()}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        />
                    )}
                </div>
             </div>

             <div className="space-y-8">
                <SectionHeader icon={ShieldAlert} title="Medical & Safety" step={5} />
                <Accordion type="multiple" className="w-full space-y-2">
                    <IntelCategory title="Medical & Health" icon={<ShieldAlert className="w-4 h-4 text-red-500" />} color="red" predefinedItems={['Pregnant', 'Pacemaker', 'Diabetes', 'High Blood Pressure']} categoryKey="medical" />
                    <IntelCategory title="Allergies & Sensitivities" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} color="amber" predefinedItems={['Latex', 'Fragrance', 'Nuts', 'Aspirin']} categoryKey="allergies" />
                    <IntelCategory title="Sensory Needs" icon={<Ear className="w-4 h-4 text-blue-500" />} color="blue" predefinedItems={['Wheelchair Access', 'Prefers Quiet', 'Sensory Sensitivities', 'Service Animal']} categoryKey="sensory" />
                </Accordion>
             </div>

            <div className="space-y-8">
                <SectionHeader icon={Sparkles} title="Discovery Notes" step={6} />
                <Accordion type="multiple" className="w-full space-y-3" defaultValue={['goals']}>
                    {[
                        { id: 'goals', label: 'Client Strategic Goals', placeholder: 'What are we looking to achieve today and long-term?' },
                        { id: 'routine', label: 'Current Maintenance & Routine', placeholder: 'Daily care and products currently in use.' },
                        { id: 'history', label: 'Historical Service Context', placeholder: 'Past experiences and preferences.' },
                        { id: 'other', label: 'Miscellaneous Intel', placeholder: 'Other relevant tactical details.' }
                    ].map(section => (
                        <AccordionItem key={section.id} value={section.id} className="border-2 rounded-[1.5rem] overflow-hidden bg-white shadow-sm">
                            <AccordionTrigger className="px-6 py-4 text-xs font-black uppercase tracking-widest hover:no-underline bg-muted/10">{section.label}</AccordionTrigger>
                            <AccordionContent className="p-6">
                                <Textarea placeholder={section.placeholder} className="text-sm rounded-xl border-2 bg-muted/5 min-h-[120px]" {...register(`notes.${section.id}` as any)} />
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </div>
        </div>
    );
};

export const EditClientDialog = ({ open, onOpenChange, client, onSave }: { open: boolean, onOpenChange: (open: boolean) => void, client: Client, onSave: (data: Partial<Client>) => void }) => {
  const isMobile = useIsMobile();
  const methods = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
  });
  
  const { handleSubmit, reset } = methods;

  useEffect(() => {
    if(open && client) {
        reset({
            name: client.name,
            email: client.email,
            phone: client.phone,
            avatarUrl: client.avatarUrl,
            birthday: client.birthday ? parseISO(client.birthday) : undefined,
            address: client.address || {},
            emergencyContact: client.emergencyContact || {},
            notes: client.notes || {},
            intel: client.intel || {},
        });
    }
  }, [open, client, reset]);

  const handleSaveSubmit = (data: ClientFormData) => {
    const finalData = {
        ...data,
        birthday: data.birthday?.toISOString(),
    };
    onSave(finalData);
    onOpenChange(false);
  };
  
  const title = "Modify Guest Dossier";
  const description = `Refining record ID: ${client.id.slice(-6).toUpperCase()}`;

  const DialogContainer = isMobile ? Sheet : Dialog;
  const ContentComponent = isMobile ? SheetContent : DialogContent;

  return (
    <DialogContainer open={open} onOpenChange={onOpenChange}>
      <ContentComponent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-3xl max-h-[90dvh]")}>
         <DialogHeader className={cn("flex-shrink-0 text-left border-b bg-muted/5", isMobile ? "p-6" : "p-10 pb-6")}>
            <div className="flex items-center gap-3 mb-2">
                <Edit className="w-5 h-5 text-primary" />
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Operations Suite</span>
            </div>
            <DialogTitle className={cn("font-black uppercase tracking-tighter text-slate-900 leading-none", isMobile ? "text-xl" : "text-3xl")}>{title}</DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60 mt-1">{description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1">
            <div className={cn(isMobile ? "p-6" : "p-10")}>
                <FormProvider {...methods}>
                    <EditClientFormInternal client={client} />
                </FormProvider>
            </div>
        </ScrollArea>
        <DialogFooter className={cn("border-t bg-background flex-shrink-0", isMobile ? "p-6 pt-4" : "p-10 pt-6")}>
          <div className="flex w-full gap-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl font-bold uppercase tracking-tight flex-1">Cancel</Button>
            <Button onClick={handleSubmit(handleSaveSubmit)} className="h-14 px-12 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20 active:scale-95 transition-all group flex-[2]">Commit Changes <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1"/></Button>
          </div>
        </DialogFooter>
      </ContentComponent>
    </DialogContainer>
  );
};
