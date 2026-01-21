

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
import { ShieldAlert, AlertTriangle, Ear, Upload, CalendarIcon, PlusCircle, Trash2, User, Home, Gift } from 'lucide-react';
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
    <AccordionItem value={title.toLowerCase().replace(' ', '-')} className="border rounded-lg">
      <AccordionTrigger className={cn("p-4 hover:no-underline rounded-t-lg", colorClasses[color as keyof typeof colorClasses] || 'bg-muted/50')}>
        <div className="flex items-center gap-3">
          {icon}
          <span className="font-semibold text-base">{title}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-4 space-y-4">
        <Controller
          name={flagsFieldName}
          control={control}
          defaultValue={[]}
          render={({ field }) => (
            <div className="grid grid-cols-2 gap-4">
              {predefinedItems.map(item => (
                <div key={item} className="flex items-center space-x-2">
                  <Checkbox
                    id={`check-${title}-${item}`}
                    checked={field.value?.includes(item)}
                    onCheckedChange={() => handleFlagToggle(item)}
                  />
                  <Label htmlFor={`check-${title}-${item}`}>{item}</Label>
                </div>
              ))}
            </div>
          )}
        />
        <div className="space-y-2">
             <Label className="text-xs">Custom Fields</Label>
             <div className="flex gap-2">
                <Input 
                    placeholder="Add custom field..." 
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <Button type="button" variant="outline" onClick={handleAddItem}>Add</Button>
            </div>
             <div className="flex flex-wrap gap-2 pt-2">
                {customItems.map(item => (
                    <Badge key={item} variant="secondary">
                        {item}
                        <button type="button" onClick={() => handleRemoveItem(item)} className="ml-1.5 -mr-0.5 rounded-full p-0.5 hover:bg-destructive/20">
                            <Trash2 className="h-3 w-3" />
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
                    placeholder={`Add detailed ${title.toLowerCase()} notes...`} 
                    {...field}
                />
            )}
        />
      </AccordionContent>
    </AccordionItem>
  )
};

const ClientIntelAccordion = () => (
  <Accordion type="multiple" className="w-full space-y-4">
    <ClientIntelCategory
        title="Medical & Health"
        icon={<ShieldAlert className="w-5 h-5 text-red-500" />}
        color="red"
        predefinedItems={['Pregnant', 'Pacemaker', 'Diabetes', 'High Blood Pressure']}
        categoryKey="medical"
    />
    <ClientIntelCategory
        title="Allergies & Sensitivities"
        icon={<AlertTriangle className="w-5 h-5 text-amber-500" />}
        color="amber"
        predefinedItems={['Latex', 'Fragrance', 'Nuts', 'Aspirin']}
        categoryKey="allergies"
    />
    <ClientIntelCategory
        title="Disabilities & Sensory Needs"
        icon={<Ear className="w-5 h-5 text-blue-500" />}
        color="blue"
        predefinedItems={['Wheelchair Access', 'Prefers Quiet', 'Sensory Sensitivities', 'Service Animal']}
        categoryKey="sensory"
    />
  </Accordion>
);


const AddClientForm = ({ clients }: { clients: Client[] }) => {
    const { register, control, watch, formState: { errors } } = useFormContext<ClientFormData>();
    const referralSource = watch('intel.referralSource');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    
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
        <div className="space-y-8">
            {/* Section 1: Basic Info */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium">Basic Information</h3>
                 <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-4">
                    <Controller
                        name="avatarUrl"
                        control={control}
                        render={({ field }) => (
                            <>
                            <Avatar className="w-24 h-24 text-lg">
                                <AvatarImage src={field.value || undefined} alt="Client Avatar" className="object-cover" />
                                <AvatarFallback><Upload className="h-8 w-8 text-muted-foreground" /></AvatarFallback>
                            </Avatar>
                            <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                            </>
                        )}
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <Label htmlFor="full-name">Full Name</Label>
                        <Input id="full-name" placeholder="e.g., Jane Doe" {...register('name')} />
                        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" placeholder="e.g., jane.doe@example.com" {...register('email')} />
                        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                    </div>
                </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <PhoneInput name="phone" label="Phone Number" placeholder="e.g., (555) 123-4567" />
                     <div className="space-y-2">
                        <Label htmlFor="birthday">Birthday</Label>
                         <Controller
                            name="birthday"
                            control={control}
                            render={({ field }) => (
                                <Popover>
                                    <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), "w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                    <span className="flex items-center">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {field.value ? format(field.value, 'PPP') : "Pick a date"}
                                    </span>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={field.value}
                                        onSelect={field.onChange}
                                        captionLayout="dropdown-buttons"
                                        fromYear={new Date().getFullYear() - 120}
                                        toYear={new Date().getFullYear()}
                                        initialFocus
                                    />
                                    </PopoverContent>
                                </Popover>
                            )}
                        />
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2"><Home className="w-5 h-5"/>Address</h3>
                <div className="space-y-2">
                    <Label htmlFor="street">Street Address</Label>
                    <Input id="street" placeholder="123 Main St" {...register('address.street')}/>
                </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input placeholder="City" {...register('address.city')} />
                    <Input placeholder="State / Province" {...register('address.state')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <Input placeholder="ZIP / Postal Code" {...register('address.zip')} />
                    <Input placeholder="Country" {...register('address.country')} />
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2"><User className="w-5 h-5"/>Emergency Contact</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <Label htmlFor="emergency-name">Contact Name</Label>
                        <Input id="emergency-name" placeholder="e.g., John Smith" {...register('emergencyContact.name')} />
                    </div>
                    <PhoneInput name="emergencyContact.phone" label="Contact Phone" />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="emergency-relationship">Relationship</Label>
                    <Controller
                        name="emergencyContact.relationship"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger id="emergency-relationship">
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
                        )}
                    />
                </div>
            </div>

             {/* Section 2: Tags & Referral */}
             <div className="space-y-4">
                <h3 className="text-lg font-medium">Acquisition & Marketing</h3>
                <div className="space-y-2">
                    <Label htmlFor="referral-code">Referral or Promo Code</Label>
                    <div className="relative">
                        <Gift className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input id="referral-code" placeholder="e.g., JANE10" className="pl-9" />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="custom-tags">Custom Tags</Label>
                    <div className="flex items-center gap-2">
                        <Input 
                            id="custom-tags" 
                            placeholder="Type a tag and press Enter..." 
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={handleTagInputKeyDown}
                        />
                        <Button type="button" onClick={handleAddTag}>Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                        {tags.map(tag => (
                            <Badge key={tag} variant="secondary">
                                {tag}
                                <button
                                    type="button"
                                    className="ml-1.5 -mr-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                                    onClick={() => removeTag(tag)}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="referral-source">Referral Source</Label>
                     <Controller
                        name="intel.referralSource"
                        control={control}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger id="referral-source">
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
                            <div className="space-y-2">
                                <Label htmlFor="referring-client">Referring Client</Label>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger id="referring-client">
                                    <SelectValue placeholder="Select referring client" />
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
                <h3 className="text-lg font-medium">Client Intel</h3>
                <ClientIntelAccordion />
             </div>

            {/* Section 4: Notes */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium">Initial Consultation Notes</h3>
                <Accordion type="multiple" className="w-full space-y-2" defaultValue={['goals', 'routine', 'history', 'general']}>
                    <AccordionItem value="goals" className="border rounded-lg">
                        <AccordionTrigger className="p-3 text-base font-semibold">Client Goals</AccordionTrigger>
                        <AccordionContent className="p-4">
                            <Textarea placeholder="What is the client hoping to achieve today and in the long term?" {...register('notes.goals')} />
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="routine" className="border rounded-lg">
                        <AccordionTrigger className="p-3 text-base font-semibold">Current Routine & Products</AccordionTrigger>
                        <AccordionContent className="p-4">
                            <Textarea placeholder="What products are they currently using? What is their daily maintenance routine?" {...register('notes.routine')} />
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="history" className="border rounded-lg">
                        <AccordionTrigger className="p-3 text-base font-semibold">Past Service History</AccordionTrigger>
                        <AccordionContent className="p-4">
                            <Textarea placeholder="Any good or bad experiences with this type of service in the past? What did they like or dislike?" {...register('notes.history')} />
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="other" className="border rounded-lg">
                        <AccordionTrigger className="p-3 text-base font-semibold">Other Notes</AccordionTrigger>
                        <AccordionContent className="p-4">
                             <Textarea placeholder="Any other relevant details, preferences, or notes." {...register('notes.general')}/>
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
  const title = "Add New Client";
  const description = "Capture all the important details for your new client.";
  
  const DialogOrSheet = isMobile ? Sheet : Dialog;
  const DialogOrSheetContent = isMobile ? SheetContent : DialogContent;

  const FormBody = (
    <FormProvider {...methods}>
      <form id={formId} onSubmit={handleSubmit(handleSaveSubmit)} className="flex flex-col flex-1 min-h-0">
        <DialogHeader className={isMobile ? 'p-4 border-b text-left flex-shrink-0' : 'p-6 pb-4 flex-shrink-0'}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-6">
            <AddClientForm clients={clients} />
          </div>
        </div>
             
        <DialogFooter className={cn("flex-shrink-0", isMobile ? "p-4 border-t" : "p-6 border-t")}>
          <div className={cn("flex w-full", isMobile ? "grid grid-cols-2 gap-2" : "justify-end gap-2")}>
            <Button variant="outline" onClick={() => onOpenChange(false)} type="button">Cancel</Button>
            <Button type="submit">Save Client</Button>
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
            ? "h-[95vh] flex flex-col p-0"
            : "max-w-3xl max-h-[90vh] flex flex-col p-0"
        }
      >
        {FormBody}
      </DialogOrSheetContent>
    </DialogOrSheet>
  );
};
