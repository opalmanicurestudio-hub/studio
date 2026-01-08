
'use client';

import React, { useState } from 'react';
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ShieldAlert, AlertTriangle, Ear, Upload, CalendarIcon, PlusCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Client } from '@/lib/data';

const ClientIntelAccordion = () => (
  <Accordion type="multiple" className="w-full space-y-4">
    <AccordionItem value="medical-health" className="border rounded-lg">
      <AccordionTrigger className="p-4 bg-red-500/5 hover:no-underline rounded-t-lg">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-500" />
          <span className="font-semibold text-base">Medical & Health</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {['Pregnant', 'Pacemaker', 'Diabetes', 'High Blood Pressure'].map(item => (
            <div key={item} className="flex items-center space-x-2">
              <Checkbox id={`med-${item}`} />
              <Label htmlFor={`med-${item}`}>{item}</Label>
            </div>
          ))}
        </div>
        <Textarea placeholder="Add detailed medical notes..." />
      </AccordionContent>
    </AccordionItem>

    <AccordionItem value="allergies-sensitivities" className="border rounded-lg">
      <AccordionTrigger className="p-4 bg-amber-500/5 hover:no-underline rounded-t-lg">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <span className="font-semibold text-base">Allergies & Sensitivities</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-4 space-y-4">
         <div className="grid grid-cols-2 gap-4">
          {['Latex', 'Fragrance', 'Nuts', 'Aspirin'].map(item => (
            <div key={item} className="flex items-center space-x-2">
              <Checkbox id={`allergy-${item}`} />
              <Label htmlFor={`allergy-${item}`}>{item}</Label>
            </div>
          ))}
        </div>
        <Textarea placeholder="Add detailed allergy notes..." />
      </AccordionContent>
    </AccordionItem>

    <AccordionItem value="disabilities-sensory" className="border rounded-lg">
      <AccordionTrigger className="p-4 bg-blue-500/5 hover:no-underline rounded-t-lg">
        <div className="flex items-center gap-3">
          <Ear className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-base">Disabilities & Sensory Needs</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {['Wheelchair Access', 'Prefers Quiet', 'Sensory Sensitivities', 'Service Animal'].map(item => (
            <div key={item} className="flex items-center space-x-2">
              <Checkbox id={`need-${item}`} />
              <Label htmlFor={`need-${item}`}>{item}</Label>
            </div>
          ))}
        </div>
        <Textarea placeholder="Add detailed needs or preferences..." />
      </AccordionContent>
    </AccordionItem>
  </Accordion>
);


const AddClientForm = ({ clients }: { clients: Client[] }) => {
    const [date, setDate] = useState<Date>();
    const [referralSource, setReferralSource] = useState<string>('');
    const [tags, setTags] = useState<string[]>(['Friend of Owner']);
    const [tagInput, setTagInput] = useState('');

    const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && tagInput.trim()) {
            e.preventDefault();
            const newTag = tagInput.trim();
            if (!tags.includes(newTag)) {
                setTags([...tags, newTag]);
            }
            setTagInput('');
        }
    };

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(tag => tag !== tagToRemove));
    };


    return (
        <ScrollArea className="h-[70vh] pr-6">
            <div className="space-y-8">
                {/* Section 1: Basic Info */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Basic Information</h3>
                    <div className="flex flex-col items-center space-y-4">
                         <Avatar className="w-24 h-24 text-lg">
                            <AvatarImage src="" alt="Client Avatar" />
                            <AvatarFallback><Upload className="h-8 w-8 text-muted-foreground" /></AvatarFallback>
                        </Avatar>
                        <Button variant="outline">Upload Photo</Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                         <div className="space-y-2">
                            <Label htmlFor="full-name">Full Name</Label>
                            <Input id="full-name" placeholder="e.g., Jane Doe" required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" type="email" placeholder="e.g., jane.doe@example.com" required />
                        </div>
                    </div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="phone">Phone Number</Label>
                            <Input id="phone" type="tel" placeholder="(123) 456-7890" />
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="birthday">Birthday</Label>
                             <Popover>
                                <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !date && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date ? date.toLocaleDateString() : <span>Pick a date</span>}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={setDate}
                                    initialFocus
                                />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </div>

                 {/* Section 2: Tags & Referral */}
                 <div className="space-y-4">
                    <h3 className="text-lg font-medium">Tags & Referral Source</h3>
                    <div className="space-y-2">
                        <Label htmlFor="custom-tags">Custom Tags</Label>
                        <Input 
                            id="custom-tags" 
                            placeholder="Type a tag and press Enter (e.g., VIP)" 
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={handleTagInputKeyDown}
                        />
                        <div className="flex flex-wrap gap-2 pt-2">
                            {tags.map(tag => (
                                <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                                    {tag}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4 -mr-1"
                                        onClick={() => removeTag(tag)}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </Badge>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="referral-source">Referral Source</Label>
                        <Select onValueChange={setReferralSource}>
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
                    </div>
                    {referralSource === 'client-referral' && (
                        <div className="space-y-2">
                            <Label htmlFor="referring-client">Referring Client</Label>
                            <Select>
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
                 </div>

                 {/* Section 3: Client Intel */}
                 <div className="space-y-4">
                    <h3 className="text-lg font-medium">Client Intel</h3>
                    <ClientIntelAccordion />
                 </div>

                {/* Section 4: Notes */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Initial Consultation Notes</h3>
                    <Textarea rows={5} placeholder="Add any initial notes, preferences, or goals from your first interaction."/>
                </div>
            </div>
        </ScrollArea>
    )
}

export const AddClientDialog = ({ open, onOpenChange, clients }: { open: boolean, onOpenChange: (open: boolean) => void, clients: Client[] }) => {
  const isMobile = useIsMobile();

  const title = "Add New Client";
  const description = "Capture all the important details for your new client.";

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95dvh]">
          <SheetHeader className="text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="py-4">
            <AddClientForm clients={clients} />
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="w-full">Save Client</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <AddClientForm clients={clients} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit">Save Client</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
