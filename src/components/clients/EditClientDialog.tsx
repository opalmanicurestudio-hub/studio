
'use client';

import React, { useState, useEffect, KeyboardEvent } from 'react';
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
import { useForm, FormProvider, Controller, useFormContext } from 'react-hook-form';
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
import { ShieldAlert, AlertTriangle, Ear, Upload, CalendarIcon, PlusCircle, Trash2 } from 'lucide-react';
import { ImageUpload } from '../shared/ImageUpload';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { clients as allClients } from '@/lib/data';
import { Checkbox } from '../ui/checkbox';


const clientSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('Invalid email address.'),
  phone: z.string().min(1, 'Phone number is required.'),
  avatarUrl: z.string().optional(),
  medicalNotes: z.string().optional(),
  allergyNotes: z.string().optional(),
  sensoryNeeds: z.string().optional(),
  notes: z.string().optional(),
  birthday: z.date().optional(),
  address: z.string().optional(),
  referralSource: z.string().optional(),
});

type ClientFormData = z.infer<typeof clientSchema>;


const ClientIntelCategory = ({
  title,
  icon,
  color,
  predefinedItems,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  predefinedItems: string[];
}) => {
  const [customItems, setCustomItems] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');

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
        <div className="grid grid-cols-2 gap-4">
          {predefinedItems.map(item => (
            <div key={item} className="flex items-center space-x-2">
              <Checkbox id={`check-${title}-${item}`} />
              <Label htmlFor={`check-${title}-${item}`}>{item}</Label>
            </div>
          ))}
        </div>
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
        <Textarea placeholder={`Add detailed ${title.toLowerCase()} notes...`} />
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
        />
        <ClientIntelCategory
            title="Allergies & Sensitivities"
            icon={<AlertTriangle className="w-5 h-5 text-amber-500" />}
            color="amber"
            predefinedItems={['Latex', 'Fragrance', 'Nuts', 'Aspirin']}
        />
        <ClientIntelCategory
            title="Disabilities & Sensory Needs"
            icon={<Ear className="w-5 h-5 text-blue-500" />}
            color="blue"
            predefinedItems={['Wheelchair Access', 'Prefers Quiet', 'Sensory Sensitivities', 'Service Animal']}
        />
    </Accordion>
);


const EditClientForm = ({ client }: { client: Client }) => {
  const { register, control, formState: { errors } } = useFormContext<ClientFormData>();
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [referralSource, setReferralSource] = useState<string>(client.intel?.referralSource || '');

  return (
    <ScrollArea className="h-[70vh] pr-6">
      <div className="space-y-8">
        <div className="space-y-4">
            <h3 className="text-lg font-medium">Basic Information</h3>
            <div className="flex flex-col items-center space-y-4">
                  <Controller
                    name="avatarUrl"
                    control={control}
                    render={({ field }) => (
                         <Avatar className="w-24 h-24 text-lg">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="full-name">Full Name</Label>
                    <Input id="full-name" {...register('name')} />
                    {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" {...register('email')} />
                    {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input id="phone" type="tel" {...register('phone')} />
                    {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="birthday">Birthday</Label>
                    <Controller
                        name="birthday"
                        control={control}
                        render={({ field }) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={field.value}
                                    onSelect={field.onChange}
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
            <h3 className="text-lg font-medium">Tags & Referral Source</h3>
            <div className="space-y-2">
                <Label htmlFor="custom-tags">Custom Tags</Label>
                <div className="flex items-center gap-2">
                    <Input 
                        id="custom-tags" 
                        placeholder="Type a tag and press Enter..." 
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (tagInput.trim()) {
                                    setTags(prev => [...prev, tagInput.trim()]);
                                    setTagInput('');
                                }
                            }
                        }}
                    />
                    <Button type="button" onClick={() => {
                        if (tagInput.trim()) {
                            setTags(prev => [...prev, tagInput.trim()]);
                            setTagInput('');
                        }
                    }}>Add</Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                    {tags.map(tag => (
                        <Badge key={tag} variant="secondary">
                            {tag}
                            <button
                                type="button"
                                className="ml-1.5 -mr-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                                onClick={() => setTags(prev => prev.filter(t => t !== tag))}
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
                    name="referralSource"
                    control={control}
                    render={({ field }) => (
                        <Select onValueChange={(value) => { field.onChange(value); setReferralSource(value); }} value={field.value}>
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
                <div className="space-y-2">
                    <Label htmlFor="referring-client">Referring Client</Label>
                    <Select>
                        <SelectTrigger id="referring-client">
                        <SelectValue placeholder="Select referring client" />
                        </SelectTrigger>
                        <SelectContent>
                            {allClients.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
        </div>

        <div className="space-y-4">
            <h3 className="text-lg font-medium">Client Intel</h3>
            <ClientIntelAccordion />
        </div>

        <div className="space-y-4">
            <h3 className="text-lg font-medium">Consultation Notes</h3>
             <Accordion type="multiple" className="w-full space-y-2">
                <AccordionItem value="goals" className="border rounded-lg">
                    <AccordionTrigger className="p-3 text-base font-semibold">Client Goals</AccordionTrigger>
                    <AccordionContent className="p-4">
                        <Textarea placeholder="What is the client hoping to achieve today and in the long term?" />
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="routine" className="border rounded-lg">
                    <AccordionTrigger className="p-3 text-base font-semibold">Current Routine & Products</AccordionTrigger>
                    <AccordionContent className="p-4">
                        <Textarea placeholder="What products are they currently using? What is their daily maintenance routine?" />
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="history" className="border rounded-lg">
                    <AccordionTrigger className="p-3 text-base font-semibold">Past Service History</AccordionTrigger>
                    <AccordionContent className="p-4">
                        <Textarea placeholder="Any good or bad experiences with this type of service in the past? What did they like or dislike?" />
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="other" className="border rounded-lg">
                    <AccordionTrigger className="p-3 text-base font-semibold">Other Notes</AccordionTrigger>
                    <AccordionContent className="p-4">
                        <Controller
                            name="notes"
                            control={control}
                            render={({ field }) => (
                                <Textarea placeholder="Any other relevant details, preferences, or notes." {...field}/>
                            )}
                        />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
      </div>
    </ScrollArea>
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
      <form id={formId} onSubmit={methods.handleSubmit(handleSave)}>
        <EditClientForm client={client} />
      </form>
  );

  if (isMobile) {
    return (
      <FormProvider {...methods}>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[95vh] flex flex-col">
            <SheetHeader className="text-left px-4">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            <div className="py-4 flex-1 overflow-y-auto px-4">{FormContent}</div>
            <SheetFooter className="px-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" form={formId} className="w-full">Save Changes</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </FormProvider>
    );
  }

  return (
    <FormProvider {...methods}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
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
    </FormProvider>
  );
};
