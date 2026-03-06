
'use client';

import React, { useState, KeyboardEvent, useEffect } from 'react';
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
import { Button, buttonVariants } from '@/components/ui/button';
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ShieldAlert, AlertTriangle, Ear, Upload, CalendarIcon, PlusCircle, Trash2, User, Home, Gift, UserPlus, Check, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client } from '@/lib/data';
import { useForm, FormProvider, Controller, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ImageUpload } from '../shared/ImageUpload';
import { format } from 'date-fns';
import { PhoneInput } from '../ui/phone-input';

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

export type ClientFormData = z.infer<typeof clientSchema>;


const ClientIntelCategory = ({
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
    <AccordionItem value={title.toLowerCase().replace(' ', '-')} className="border rounded-lg overflow-hidden">
      <AccordionTrigger className={cn("p-3 md:p-4 hover:no-underline", colorClasses[color as keyof typeof colorClasses] || 'bg-muted/50')}>
        <div className="flex items-center gap-2 md:gap-3">
          {icon}
          <span className="font-semibold text-sm md:text-base">{title}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 md:p-4 space-y-4">
        <Controller
          name={flagsFieldName}
          control={control}
          defaultValue={[]}
          render={({ field }) => (
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              {predefinedItems.map(item => (
                <div key={item} className="flex items-center space-x-2">
                  <Checkbox
                    id={`check-${title}-${item}`}
                    checked={field.value?.includes(item)}
                    onCheckedChange={() => handleFlagToggle(item)}
                  />
                  <Label htmlFor={`check-${title}-${item}`} className="text-xs md:text-sm">{item}</Label>
                </div>
              ))}
            </div>
          )}
        />
        <div className="space-y-2">
             <Label className="text-[10px] uppercase font-bold text-muted-foreground">Custom Fields</Label>
             <div className="flex gap-2">
                <Input 
                    placeholder="Add..." 
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-9"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="h-9 px-3">Add</Button>
            </div>
             <div className="flex flex-wrap gap-1.5 pt-1">
                {customItems.map(item => (
                    <Badge key={item} variant="secondary" className="text-[10px] h-6">
                        {item}
                        <button type="button" onClick={() => handleRemoveItem(item)} className="ml-1 -mr-0.5 rounded-full p-0.5 hover:bg-destructive/20">
                            <XIcon className="h-3 w-3" />
                        </button>
                    </Badge>
                ))}
            </div>
        </div>
        <Controller
            name={notesFieldName}
            control={control}
            render={({ field }) => (
                <Textarea 
                    placeholder={`Detailed notes...`} 
                    className="text-xs md:text-sm min-h-[80px]"
                    {...field}
                />
            )}
        />
      </AccordionContent>
    </AccordionItem>
  )
};

const ClientIntelAccordion = () => (
  <Accordion type="multiple" className="w-full space-y-3">
    <ClientIntelCategory
        title="Medical & Health"
        icon={<ShieldAlert className="w-4 h-4 md:w-5 md:h-5 text-red-500" />}
        color="red"
        predefinedItems={['Pregnant', 'Pacemaker', 'Diabetes', 'High Blood Pressure']}
        categoryKey="medical"
    />
    <ClientIntelCategory
        title="Allergies & Sensitivities"
        icon={<AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-amber-500" />}
        color="amber"
        predefinedItems={['Latex', 'Fragrance', 'Nuts', 'Aspirin']}
        categoryKey="allergies"
    />
    <ClientIntelCategory
        title="Sensory Needs"
        icon={<Ear className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />}
        color="blue"
        predefinedItems={['Wheelchair Access', 'Prefers Quiet', 'Sensory Sensitivities', 'Service Animal']}
        categoryKey="sensory"
    />
  </Accordion>
);


const AddClientForm = ({ clients }: { clients: Client[] }) => {
    const isMobile = useIsMobile();
    const { register, control, watch, setValue, formState: { errors } } = useFormContext<ClientFormData>();
    const referralSource = watch('intel.referralSource');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    
    const [birthDay, setBirthDay] = useState('');
    const [birthMonth, setBirthMonth] = useState('');
    const [birthYear, setBirthYear] = useState('');

    useEffect(() => {
        if (birthYear && birthMonth && birthDay) {
            const date = new Date(parseInt(birthYear), parseInt(birthMonth) - 1, parseInt(birthDay));
            if (date.getFullYear() === parseInt(birthYear) && (date.getMonth() + 1) === parseInt(birthMonth) && date.getDate() === parseInt(birthDay)) {
                setValue('birthday', date, { shouldValidate: true, shouldDirty: true });
            } else {
                setValue('birthday', undefined, { shouldValidate: true, shouldDirty: true });
            }
        } else {
            setValue('birthday', undefined, { shouldValidate: true, shouldDirty: true });
        }
    }, [birthDay, birthMonth, birthYear, setValue]);
    
    const handleAddTag = () => {
        if (tagInput.trim()) {
            const newTag = tagInput.trim();
            if (!tags.includes(newTag)) {
                setTags([...tags, newTag]);
            }
            setTagInput('');
        }
    };

    const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddTag();
        }
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(tag => tag !== tagToRemove));
    };


    return (
        <div className="space-y-6 md:space-y-8">
            {/* Section 1: Basic Info */}
            <div className="space-y-4">
                <h3 className="text-sm md:text-lg font-black uppercase tracking-widest text-primary">1. Basic Information</h3>
                 <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-4">
                    <Controller
                        name="avatarUrl"
                        control={control}
                        render={({ field }) => (
                            <>
                            <Avatar className={cn("border-2 shadow-sm", isMobile ? "w-16 h-16" : "w-24 h-24")}>
                                <AvatarImage src={field.value || undefined} alt="Client Avatar" className="object-cover" />
                                <AvatarFallback><Upload className="h-6 w-6 text-muted-foreground" /></AvatarFallback>
                            </Avatar>
                            <div className="flex-1 w-full sm:w-auto">
                                <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                            </div>
                            </>
                        )}
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                        <Label htmlFor="full-name" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Full Name</Label>
                        <Input id="full-name" placeholder="e.g., Jane Doe" {...register('name')} className="h-11 md:h-12" />
                        {errors.name && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.name.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="email" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Email</Label>
                        <Input id="email" type="email" placeholder="e.g., jane.doe@example.com" {...register('email')} className="h-11 md:h-12" />
                        {errors.email && <p className="text-[10px] font-bold text-destructive uppercase ml-1">{errors.email.message}</p>}
                    </div>
                </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase font-black text-muted-foreground ml-1">Phone Number</Label>
                        <PhoneInput name="phone" label="" placeholder="e.g., (555) 123-4567" className="h-11 md:h-12" />
                    </div>
                     <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase font-black text-muted-foreground ml-1">Birthday</Label>
                        <div className="grid grid-cols-3 gap-1.5">
                            <Select value={birthMonth} onValueChange={setBirthMonth}>
                                <SelectTrigger className="h-11 md:h-12"><SelectValue placeholder="Mo" /></SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 12 }, (_, i) => (
                                        <SelectItem key={i + 1} value={(i + 1).toString()}>
                                            {format(new Date(2000, i, 1), 'MMM')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={birthDay} onValueChange={setBirthDay}>
                                <SelectTrigger className="h-11 md:h-12"><SelectValue placeholder="Day" /></SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 31 }, (_, i) => (
                                        <SelectItem key={i + 1} value={(i + 1).toString()}>
                                            {i + 1}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={birthYear} onValueChange={setBirthYear}>
                                <SelectTrigger className="h-11 md:h-12"><SelectValue placeholder="Yr" /></SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 100 }, (_, i) => {
                                        const year = new Date().getFullYear() - i;
                                        return (
                                            <SelectItem key={year} value={year.toString()}>
                                                {year}
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-sm md:text-lg font-black uppercase tracking-widest text-primary flex items-center gap-2"><Home className="w-4 h-4 md:w-5 md:h-5"/>2. Address</h3>
                <div className="space-y-3 p-4 md:p-5 rounded-2xl border-2 bg-muted/5">
                    <div className="space-y-1.5">
                        <Label htmlFor="street" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Street Address</Label>
                        <Input id="street" placeholder="123 Main St" {...register('address.street')} className="h-11 md:h-12" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-black text-muted-foreground ml-1">City</Label>
                            <Input placeholder="City" {...register('address.city')} className="h-11 md:h-12" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-black text-muted-foreground ml-1">State</Label>
                            <Input placeholder="State" {...register('address.state')} className="h-11 md:h-12" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-black text-muted-foreground ml-1">ZIP</Label>
                            <Input placeholder="ZIP" {...register('address.zip')} className="h-11 md:h-12" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-black text-muted-foreground ml-1">Country</Label>
                            <Input placeholder="Country" {...register('address.country')} className="h-11 md:h-12" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-sm md:text-lg font-black uppercase tracking-widest text-primary flex items-center gap-2"><User className="w-4 h-4 md:w-5 md:h-5"/>3. Emergency Contact</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                        <Label htmlFor="emergency-name" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Contact Name</Label>
                        <Input id="emergency-name" placeholder="e.g., John Smith" {...register('emergencyContact.name')} className="h-11 md:h-12" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase font-black text-muted-foreground ml-1">Contact Phone</Label>
                        <PhoneInput name="emergencyContact.phone" label="" className="h-11 md:h-12" />
                    </div>
                </div>
                 <div className="space-y-1.5">
                    <Label htmlFor="emergency-relationship" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Relationship</Label>
                    <Controller
                        name="emergencyContact.relationship"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger id="emergency-relationship" className="h-11 md:h-12">
                                    <SelectValue placeholder="Select..." />
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
                        )}
                    />
                </div>
            </div>

             {/* Section 2: Tags & Referral */}
             <div className="space-y-4">
                <h3 className="text-sm md:text-lg font-black uppercase tracking-widest text-primary">4. Marketing Intel</h3>
                <div className="space-y-1.5">
                    <Label htmlFor="referral-code" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Promo Code</Label>
                    <div className="relative">
                        <Gift className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input id="referral-code" placeholder="e.g., JANE10" className="pl-9 h-11 md:h-12" />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="custom-tags" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Custom Tags</Label>
                    <div className="flex items-center gap-2">
                        <Input 
                            id="custom-tags" 
                            placeholder="Add tag..." 
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={handleTagInputKeyDown}
                            className="h-11 md:h-12"
                        />
                        <Button type="button" onClick={handleAddTag} variant="secondary" className="h-11 md:h-12">Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-[10px] h-6">
                                {tag}
                                <button
                                    type="button"
                                    className="ml-1 -mr-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                                    onClick={() => removeTag(tag)}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="referral-source" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Referral Source</Label>
                     <Controller
                        name="intel.referralSource"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger id="referral-source" className="h-11 md:h-12">
                                    <SelectValue placeholder="How did they find you?" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="social-media">Social Media</SelectItem>
                                    <SelectItem value="online-search">Online Search</SelectItem>
                                    <SelectItem value="client-referral">Client Referral</SelectItem>
                                    <SelectItem value="walk-in">Walk-in</SelectItem>
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
                                <Label htmlFor="referring-client" className="text-[10px] uppercase font-black text-muted-foreground ml-1">Referring Client</Label>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger id="referring-client" className="h-11 md:h-12">
                                    <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {clients.map(client => (
                                            <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    />
                )}
             </div>

             {/* Section 3: Client Intel */}
             <div className="space-y-4">
                <h3 className="text-sm md:text-lg font-black uppercase tracking-widest text-primary">5. Health & Safety</h3>
                <ClientIntelAccordion />
             </div>

            {/* Section 4: Notes */}
            <div className="space-y-4">
                <h3 className="text-sm md:text-lg font-black uppercase tracking-widest text-primary">6. Discovery Notes</h3>
                <Accordion type="multiple" className="w-full space-y-2" defaultValue={['goals']}>
                    <AccordionItem value="goals" className="border rounded-xl overflow-hidden">
                        <AccordionTrigger className="p-3 text-sm font-bold bg-muted/20">Client Goals</AccordionTrigger>
                        <AccordionContent className="p-3">
                            <Textarea placeholder="What is the client hoping to achieve?" className="text-xs min-h-[80px]" {...register('notes.goals')} />
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="routine" className="border rounded-xl overflow-hidden">
                        <AccordionTrigger className="p-3 text-sm font-bold bg-muted/20">Routine & Products</AccordionTrigger>
                        <AccordionContent className="p-3">
                            <Textarea placeholder="Current home care and products..." className="text-xs min-h-[80px]" {...register('notes.routine')} />
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="history" className="border rounded-xl overflow-hidden">
                        <AccordionTrigger className="p-3 text-sm font-bold bg-muted/20">Past Service History</AccordionTrigger>
                        <AccordionContent className="p-3">
                            <Textarea placeholder="Past experiences, good or bad..." className="text-xs min-h-[80px]" {...register('notes.history')} />
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="other" className="border rounded-xl overflow-hidden">
                        <AccordionTrigger className="p-3 text-sm font-bold bg-muted/20">Miscellaneous</AccordionTrigger>
                        <AccordionContent className="p-3">
                             <Textarea placeholder="Other relevant details..." className="text-xs min-h-[80px]" {...register('notes.general')}/>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </div>
    );
};


export const AddClientDialog = ({ open, onOpenChange, clients, onSave }: { open: boolean, onOpenChange: (open: boolean) => void, clients: Client[], onSave: (data: ClientFormData) => void }) => {
  const isMobile = useIsMobile();
  const methods = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      avatarUrl: '',
      notes: {
        goals: '',
        routine: '',
        history: '',
        general: ''
      }
    },
  });
  
  const { handleSubmit, reset } = methods;

  useEffect(() => {
    if(open) {
        reset();
    }
  }, [open, reset]);

  const handleSaveSubmit = (data: ClientFormData) => {
    onSave(data);
    onOpenChange(false);
  };
  
  const formId = "add-client-form";
  const title = "New Client Record";
  const description = "Register a guest account in the rolodex.";
  
  const DialogOrSheet = isMobile ? Sheet : Dialog;
  const DialogOrSheetContent = isMobile ? SheetContent : DialogContent;

  const FormBody = (
    <FormProvider {...methods}>
      <form id={formId} onSubmit={handleSubmit(handleSaveSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={isMobile ? 'p-6 pb-4 border-b text-left flex-shrink-0 bg-muted/5' : 'p-6 pb-4 flex-shrink-0'}>
          <div className="flex items-center gap-3 mb-2">
            <UserPlus className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Guest Registration</span>
          </div>
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">{title}</DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto bg-background">
          <div className={cn("p-6", isMobile && "pb-24")}>
            <AddClientForm clients={clients} />
          </div>
        </div>
             
        <DialogFooter className={cn("flex-shrink-0 bg-white", isMobile ? "p-6 border-t fixed bottom-0 left-0 right-0 z-20" : "p-6 border-t")}>
          <div className={cn("flex w-full gap-3", isMobile ? "grid grid-cols-2" : "justify-end")}>
            <Button variant="ghost" onClick={() => onOpenChange(false)} type="button" className="h-12 md:h-14 font-black uppercase tracking-tighter text-[10px] md:text-sm text-slate-400">Cancel</Button>
            <Button type="submit" className="h-12 md:h-14 font-black uppercase tracking-widest text-[10px] md:text-sm rounded-2xl md:rounded-[2rem] shadow-2xl shadow-primary/30">Complete Registration</Button>
          </div>
        </DialogFooter>
      </form>
    </FormProvider>
  );

  return (
    <DialogOrSheet open={open} onOpenChange={onOpenChange}>
      <DialogOrSheetContent
        side={isMobile ? 'bottom' : undefined}
        className={
          isMobile
            ? "h-[95vh] flex flex-col p-0 border-none rounded-t-[3rem] overflow-hidden"
            : "max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden"
        }
      >
        {FormBody}
      </DialogOrSheetContent>
    </DialogOrSheet>
  );
};
