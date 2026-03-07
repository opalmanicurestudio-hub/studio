'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useForm, Controller, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { ArrowLeft, Save, Send, Loader, Eye, Mail, MessageSquare, Wand2, HandHeart, Sparkles, PartyPopper, Search, User as UserIcon, FlaskConical, Gift, ChevronDown, Activity, ListChecks, ShieldCheck, Zap, ArrowRight, X, Tag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { nanoid } from 'nanoid';
import { type Campaign, type Client, type Service } from '@/lib/data';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

const campaignSchema = z.object({
  name: z.string().min(3, "Campaign name must be at least 3 characters."),
  type: z.enum(['email', 'sms']),
  subject: z.string().optional(),
  subjectB: z.string().optional(),
  body: z.string().min(10, "Message body is too short."),
  targetAudience: z.enum(['all', 'new', 'loyal', 'inactive_90', 'specific', 'birthday']),
  targetClientIds: z.array(z.string()).optional(),
  discountId: z.string().optional(),
  imageUrl: z.string().optional(),
}).refine(data => data.type !== 'email' || (data.subject && data.subject.length > 0), {
    message: "Subject is required for email campaigns.",
    path: ["subject"],
});

type CampaignFormData = z.infer<typeof campaignSchema>;

const premadeCampaigns = [
  {
    name: "Welcome New Client",
    icon: HandHeart,
    targetAudience: 'new',
    type: 'email',
    subject: "Welcome to the family! A special gift inside 💖",
    body: "Hi {{clientName}},\n\nIt was such a pleasure meeting you at the studio! We're so glad you chose us for your service.\n\nTo say thank you, we've added a special welcome gift to your profile: 15% OFF your next visit. Whether you're coming back for a fresh look or just a touch-up, we can't wait to see you again.\n\nWarmly,\nThe Team",
  },
  {
    name: "Re-engage Inactive Client",
    icon: Sparkles,
    targetAudience: 'inactive_90',
    type: 'sms',
    subject: "",
    body: "Hi {{clientName}}, we miss you! It's been a while since your last visit. Come back this week and enjoy $10 off your next service as a 'welcome back' gift. Book your spot here: [Link]",
  },
  {
    name: "Birthday Special",
    icon: PartyPopper,
    targetAudience: 'birthday',
    type: 'email',
    subject: "Happy Birthday! Time for a celebratory treat 🎂",
    body: "Hi {{clientName}},\n\nWishing you a fantastic birthday! We believe you deserve to be pampered on your special day.\n\nAs a birthday gift from us, please enjoy 20% OFF any service this month. Treat yourself to that look you've been eyeing—you've earned it!\n\nWarmly,\nThe Team",
  },
    {
    name: "Promote New Service",
    icon: Wand2,
    targetAudience: 'all',
    type: 'email',
    subject: "✨ BIG NEWS: Our newest treatment is here! ✨",
    body: "Hi {{clientName}},\n\nWe've been working on something special, and it's finally here! We are excited to introduce our new [Service Name] to the menu.\n\nThis treatment is perfect for achieving that healthy, radiant glow we know you love. Be among the first to experience it and get 10% off when you book in the next 7 days.\n\nSee you in the chair,\nThe Team",
  },
];

const SectionHeader = ({ icon: Icon, title, step }: { icon: any, title: string, step: number | string }) => (
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

const CampaignPreviewDialog = ({
  previewData,
  onOpenChange,
}: {
  previewData: CampaignFormData | null;
  onOpenChange: (open: boolean) => void;
}) => {
  if (!previewData) return null;

  const sampleClientName = 'Alexander Smith';
  const bodyWithPlaceholders = previewData.body.replace(/{{clientName}}/g, sampleClientName);

  return (
    <Dialog open={!!previewData} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 border-4 rounded-[3rem] overflow-hidden shadow-3xl bg-background">
        <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-3 mb-2">
            <Eye className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Visual Inspection</span>
          </div>
          <DialogTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900">Dispatch Preview</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="p-8">
            {previewData.type === 'email' ? (
              <div className="border-2 rounded-[2rem] overflow-hidden bg-white shadow-inner">
                <div className="p-6 bg-muted/20 border-b text-[10px] font-bold uppercase tracking-tight space-y-1.5">
                  <p><span className="opacity-40">Recipient:</span> {sampleClientName} &lt;alex@example.com&gt;</p>
                  <p><span className="opacity-40">Subject (A):</span> {previewData.subject}</p>
                  {previewData.subjectB && <p className="text-purple-600"><span className="opacity-40">Subject (B):</span> {previewData.subjectB}</p>}
                </div>
                <div className="p-8">
                  {previewData.imageUrl && (
                    <div className="relative aspect-video rounded-2xl overflow-hidden mb-8 border-2 shadow-lg">
                        <img src={previewData.imageUrl} alt="Campaign visual" className="object-cover w-full h-full" />
                    </div>
                  )}
                  <div className="prose prose-sm dark:prose-invert max-w-full font-medium text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: bodyWithPlaceholders.replace(/\n/g, '<br />') }} />
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-4">
                <div className="w-[320px] h-[580px] bg-slate-900 rounded-[3rem] border-[8px] border-slate-800 p-4 flex flex-col shadow-2xl relative">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-800 rounded-b-2xl z-20" />
                  <div className="flex-1 bg-white rounded-[2rem] p-4 overflow-y-auto flex flex-col justify-end">
                     <div className="bg-primary text-primary-foreground p-3 rounded-2xl rounded-br-none ml-auto max-w-[85%] shadow-lg">
                      <p className="text-xs font-bold leading-relaxed whitespace-pre-wrap">{bodyWithPlaceholders}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="p-8 pt-4 border-t bg-muted/5">
            <Button className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl" onClick={() => onOpenChange(false)}>Close Review</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ClientSelectorDialog = ({
    open,
    onOpenChange,
    allClients,
    initialSelectedIds,
    onConfirm
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    allClients: Client[];
    initialSelectedIds: string[];
    onConfirm: (selectedIds: string[]) => void;
}) => {
    const [selectedIds, setSelectedIds] = useState(new Set(initialSelectedIds));
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (open) {
            setSelectedIds(new Set(initialSelectedIds));
        }
    }, [open, initialSelectedIds]);
    
    const filteredClients = allClients.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const handleToggle = (clientId: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(clientId)) {
            newSet.delete(clientId);
        } else {
            newSet.add(clientId);
        }
        setSelectedIds(newSet);
    }
    
    const handleConfirm = () => {
        onConfirm(Array.from(selectedIds));
        onOpenChange(false);
    }
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg rounded-[3rem] border-4 p-0 overflow-hidden shadow-3xl">
                <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Client Selection</DialogTitle>
                    <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Target specific individuals for this dispatch.</DialogDescription>
                </DialogHeader>
                <div className="p-8 space-y-6">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                        <Input placeholder="SEARCH ROSTER..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-12 h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5" />
                    </div>
                    <ScrollArea className="h-72 -mx-2 px-2">
                        <div className="space-y-2 pr-4">
                            {filteredClients.map(client => (
                                <div key={client.id} className="flex items-center space-x-4 p-3 rounded-2xl border-2 border-transparent hover:border-primary/10 hover:bg-primary/[0.02] transition-all">
                                    <Checkbox id={`client-${client.id}`} checked={selectedIds.has(client.id)} onCheckedChange={() => handleToggle(client.id)} className="h-6 w-6 rounded-lg border-2" />
                                    <Avatar className="h-10 w-10 border-2 border-background shadow-sm rounded-xl shrink-0"><AvatarImage src={client.avatarUrl} className="object-cover" /><AvatarFallback className="font-black bg-primary/10 text-primary">{client.name.charAt(0)}</AvatarFallback></Avatar>
                                    <label htmlFor={`client-${client.id}`} className="text-xs font-black uppercase tracking-tight text-slate-900 cursor-pointer flex-1 truncate">{client.name}</label>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
                <DialogFooter className="p-8 pt-4 border-t bg-muted/5">
                    <div className="grid grid-cols-2 gap-3 w-full">
                        <Button variant="outline" onClick={() => onOpenChange(false)} className="h-12 rounded-xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                        <Button onClick={handleConfirm} className="h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-xl">Confirm ({selectedIds.size})</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default function NewCampaignPage() {
    const { firestore, user } = useFirebase();
    const { selectedTenant } = useTenant();
    const router = useRouter();
    const { toast } = useToast();
    const { discounts, clients, services } = useInventory();
    const [isSaving, setIsSaving] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isSendingTest, setIsSendingTest] = useState(false);
    const [previewData, setPreviewData] = useState<CampaignFormData | null>(null);
    const [isClientSelectorOpen, setIsClientSelectorOpen] = useState(false);
    const [isABTest, setIsABTest] = useState(false);
    const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [isTestSendDialogOpen, setIsTestSendDialogOpen] = useState(false);
    const [testEmail, setTestEmail] = useState('');

    const methods = useForm<CampaignFormData>({
        resolver: zodResolver(campaignSchema),
        defaultValues: {
            type: 'email',
            targetAudience: 'all',
            targetClientIds: [],
        }
    });
    
    const { control, handleSubmit, register, watch, setValue, formState: { errors } } = methods;
    const campaignType = watch('type');
    const targetAudience = watch('targetAudience');

    useEffect(() => {
        if (isTestSendDialogOpen && user?.email) {
            testEmail || setTestEmail(user.email);
        }
    }, [isTestSendDialogOpen, user, testEmail]);

    const handleInsertPlaceholder = (placeholder: string) => {
        const textarea = bodyTextareaRef.current;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            const newText = text.substring(0, start) + placeholder + text.substring(end);
            
            setValue('body', newText, { shouldDirty: true, shouldValidate: true });

            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
                textarea.focus();
            }, 0);
        }
    };
    
    const handleTemplateSelect = (templateName: string) => {
        const template = premadeCampaigns.find(t => t.name === templateName);
        if (template) {
            setValue('name', template.name, { shouldDirty: true, shouldValidate: true });
            setValue('type', template.type as 'email' | 'sms', { shouldDirty: true, shouldValidate: true });
            setValue('subject', template.subject, { shouldDirty: true, shouldValidate: true });
            setValue('body', template.body, { shouldDirty: true, shouldValidate: true });
            setValue('targetAudience', template.targetAudience as any, { shouldDirty: true, shouldValidate: true });
            
            toast({
                title: "Protocol Loaded",
                description: `Script for "${template.name}" has been synchronized.`,
            });
        }
    };

    const processSubmit = async (data: CampaignFormData, status: 'draft' | 'sent') => {
        if (!firestore || !selectedTenant) return;

        if (status === 'draft') setIsSaving(true);
        else setIsSending(true);

        const finalCampaign = {
            ...data,
            id: nanoid(),
            status,
            sentAt: status === 'sent' ? new Date().toISOString() : undefined,
            recipientCount: status === 'sent' ? (data.targetAudience === 'specific' ? data.targetClientIds?.length : 42) : undefined, // Simulated recipient count
        }
        
        try {
            await addDocumentNonBlocking(collection(firestore, 'tenants', selectedTenant.id, 'campaigns'), finalCampaign);

            toast({
                title: status === 'draft' ? "Protocol Cached" : "Dispatch Initiated",
                description: `${data.name} has been ${status === 'draft' ? 'saved as a draft' : 'successfully dispatched'}.`
            });
            router.push('/campaigns');
        } catch (error) {
            console.error("Error saving campaign: ", error);
            toast({
                variant: "destructive",
                title: "Critical Error",
                description: "There was a problem finalizing the campaign protocol."
            });
        } finally {
            if (status === 'draft') setIsSaving(false);
            else setIsSending(false);
        }
    }

    const handleConfirmSendTest = async () => {
        if (!testEmail || !/\S+@\S+\.\S+/.test(testEmail)) {
            toast({
                variant: 'destructive',
                title: 'Invalid Target',
                description: 'A valid email address is required for test dispatch.',
            });
            return;
        }
    
        setIsSendingTest(true);
        setIsTestSendDialogOpen(false);
    
        await new Promise(resolve => setTimeout(resolve, 1500));
    
        toast({
            title: 'Test Dispatch "Sent"',
            description: `A mock dispatch has been recorded for ${testEmail}.`,
        });
    
        setIsSendingTest(false);
    };

    const { ref: bodyRef, ...bodyRegister } = register('body');

    return (
        <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
            <AppHeader title="New Dispatch" />
            <main className="flex-1 p-4 md:p-10 w-full max-w-5xl mx-auto min-w-0">
                <form className="space-y-10">
                     <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                        <div className="space-y-1">
                            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Draft Protocol</h1>
                            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Strategic dispatch configuration</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                             <Button type="button" variant="outline" onClick={handleSubmit((data) => processSubmit(data, 'draft'))} disabled={isSaving || isSending || isSendingTest} className="flex-1 md:flex-none h-14 px-6 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm bg-white/50 backdrop-blur-sm">
                                {isSaving ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4 opacity-40" />}
                                Cache Draft
                            </Button>
                            <Button type="button" onClick={handleSubmit((data) => processSubmit(data, 'sent'))} disabled={isSaving || isSending || isSendingTest} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20">
                                {isSending ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                Dispatch
                            </Button>
                        </div>
                    </div>

                     <div className="grid grid-cols-1 gap-10">
                        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
                            <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                    <div>
                                        <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight text-slate-900">Configuration Matrix</CardTitle>
                                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Select a verified script or draft a custom message.</CardDescription>
                                    </div>
                                    <Select onValueChange={handleTemplateSelect}>
                                        <SelectTrigger className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest w-full sm:w-64 bg-white/50 backdrop-blur-sm shadow-sm ring-primary/20 border-primary/20 text-primary">
                                            <Sparkles className="w-3.5 h-3.5 mr-2" />
                                            <SelectValue placeholder="LOAD TEMPLATE SCRIPT..." />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                            {premadeCampaigns.map(template => (
                                                <SelectItem key={template.name} value={template.name} className="font-bold uppercase text-[10px] tracking-widest">
                                                    <div className="flex items-center gap-2">
                                                        <template.icon className="h-3.5 w-3.5 text-primary" />
                                                        <span>{template.name}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 md:p-8 space-y-10 text-left">
                                <div className="space-y-8">
                                    <SectionHeader icon={Tag} title="Internal Identity" step={1} />
                                    <div className="space-y-2">
                                        <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Dispatch Label (Internal)</Label>
                                        <Input id="name" placeholder="e.g., JULY SUMMER SPECIAL" {...register('name')} className="h-14 rounded-2xl border-2 font-black uppercase text-base tracking-tight shadow-inner bg-muted/5" />
                                        {errors.name && <p className="text-[9px] font-black text-destructive uppercase ml-1">{errors.name.message}</p>}
                                    </div>
                                    
                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Dispatch Mode</Label>
                                        <Controller
                                            name="type"
                                            control={control}
                                            render={({ field }) => (
                                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-4">
                                                    <label htmlFor="email-mode" className="cursor-pointer">
                                                        <div className={cn(
                                                            "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all",
                                                            field.value === 'email' ? "border-primary bg-primary/5 shadow-lg" : "border-border/50 bg-white hover:border-primary/20"
                                                        )}>
                                                            <Mail className={cn("mb-2 h-8 w-8", field.value === 'email' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                            <span className="text-xs font-black uppercase tracking-widest text-slate-900">Email</span>
                                                            <RadioGroupItem value="email" id="email-mode" className="sr-only" />
                                                        </div>
                                                    </label>
                                                    <label htmlFor="sms-mode" className="cursor-pointer">
                                                        <div className={cn(
                                                            "flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all",
                                                            field.value === 'sms' ? "border-primary bg-primary/5 shadow-lg" : "border-border/50 bg-white hover:border-primary/20"
                                                        )}>
                                                            <MessageSquare className={cn("mb-2 h-8 w-8", field.value === 'sms' ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                            <span className="text-xs font-black uppercase tracking-widest text-slate-900">SMS</span>
                                                            <RadioGroupItem value="sms" id="sms-mode" className="sr-only" />
                                                        </div>
                                                    </label>
                                                </RadioGroup>
                                            )}
                                        />
                                    </div>
                                </div>

                                <Separator className="border-dashed" />

                                <div className="space-y-8">
                                    <SectionHeader icon={Activity} title="Message Composition" step={2} />
                                    {campaignType === 'email' && (
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <Label htmlFor="subject" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Subject Line (Primary)</Label>
                                                <Input id="subject" placeholder="Draft a compelling subject..." {...register('subject')} className="h-12 rounded-xl border-2 font-bold shadow-inner" />
                                                {errors.subject && <p className="text-[9px] font-black text-destructive uppercase ml-1">{errors.subject.message}</p>}
                                            </div>

                                            {isABTest ? (
                                                <div className="space-y-2 p-6 border-4 rounded-[2rem] border-purple-500/20 bg-purple-500/[0.03] animate-in slide-in-from-top-2">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Label htmlFor="subjectB" className="text-[10px] font-black uppercase tracking-widest text-purple-600 ml-1">A/B Subject Variant</Label>
                                                        <Button variant="ghost" size="xs" onClick={() => { setIsABTest(false); setValue('subjectB', ''); }} className="h-6 px-2 text-[8px] font-black uppercase text-destructive hover:bg-destructive/5"><X className="w-3 h-3 mr-1"/> Terminate Test</Button>
                                                    </div>
                                                    <Input id="subjectB" placeholder="Draft a secondary variant..." {...register('subjectB')} className="h-12 rounded-xl border-2 border-purple-500/20 font-bold shadow-inner bg-white" />
                                                </div>
                                            ) : (
                                                <Button type="button" variant="outline" size="sm" onClick={() => setIsABTest(true)} className="h-10 rounded-xl border-2 border-purple-500/20 text-purple-600 font-black uppercase tracking-widest text-[9px] hover:bg-purple-50">
                                                    <FlaskConical className="mr-2 h-3.5 w-3.5" /> Initialize A/B Performance Test
                                                </Button>
                                            )}

                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Header Visual</Label>
                                                <Controller
                                                    name="imageUrl"
                                                    control={control}
                                                    render={({ field }) => ( <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} /> )}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between px-1">
                                            <Label htmlFor="body" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Message Narrative</Label>
                                            <div className="flex items-center gap-2">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="h-7 text-[9px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 border border-primary/20 rounded-lg">
                                                            Insert Service <ChevronDown className="ml-1 h-3 w-3" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-56 max-h-64 rounded-xl border-2 shadow-2xl overflow-y-auto">
                                                        {services.map(s => (
                                                            <DropdownMenuItem key={s.id} onClick={() => handleInsertPlaceholder(s.name)} className="font-bold uppercase text-[9px] tracking-widest">
                                                                {s.name}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="h-7 px-3 text-[9px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 border border-primary/20 rounded-lg"
                                                    onClick={() => handleInsertPlaceholder('{{clientName}}')}
                                                >
                                                    Inject Client Name
                                                </Button>
                                            </div>
                                        </div>
                                        <Textarea
                                            id="body"
                                            placeholder="Draft your dispatch narrative here..."
                                            {...bodyRegister}
                                            ref={(e) => {
                                                bodyRef(e);
                                                bodyTextareaRef.current = e;
                                            }}
                                            rows={10}
                                            className="rounded-2xl border-2 bg-muted/5 font-medium leading-relaxed focus-visible:ring-primary/20 p-6 text-slate-900"
                                        />
                                        <div className="flex justify-between items-center px-1">
                                            <p className="text-[9px] text-muted-foreground font-black uppercase tracking-tight opacity-40">Variable injection enabled</p>
                                            {errors.body && <p className="text-[10px] font-black text-destructive uppercase">{errors.body.message}</p>}
                                        </div>
                                    </div>
                                </div>

                                <Separator className="border-dashed" />

                                <div className="space-y-8">
                                    <SectionHeader icon={ListChecks} title="Audience & Strategy" step={3} />
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <Label htmlFor="targetAudience" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Target Persona</Label>
                                            <Controller
                                                name="targetAudience"
                                                control={control}
                                                render={({ field }) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger id="targetAudience" className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                                            <SelectItem value="all" className="font-bold uppercase text-[10px] tracking-widest">ALL REGISTERED GUESTS</SelectItem>
                                                            <SelectItem value="new" className="font-bold uppercase text-[10px] tracking-widest">NEW GUESTS (1ST VISIT)</SelectItem>
                                                            <SelectItem value="loyal" className="font-bold uppercase text-[10px] tracking-widest">LOYAL MATURED (5+ VISITS)</SelectItem>
                                                            <SelectItem value="inactive_90" className="font-bold uppercase text-[10px] tracking-widest">INACTIVE (90+ DAYS)</SelectItem>
                                                            <SelectItem value="birthday" className="font-bold uppercase text-[10px] tracking-widest">CURRENT BIRTHDAY MONTH</SelectItem>
                                                            <SelectItem value="specific" className="font-bold uppercase text-[10px] tracking-widest">SPECIFIC MANUAL GROUP</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="discountId" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Incentive Attachment</Label>
                                            <Controller
                                                name="discountId"
                                                control={control}
                                                render={({ field }) => (
                                                    <Select 
                                                        onValueChange={(value) => field.onChange(value === 'none' ? undefined : value)} 
                                                        value={field.value || 'none'}
                                                    >
                                                        <SelectTrigger id="discountId" className="h-14 rounded-2xl border-2 font-black uppercase text-xs tracking-widest shadow-inner bg-muted/5">
                                                            <SelectValue placeholder="Select a discount code" />
                                                        </SelectTrigger>
                                                        <SelectContent className="rounded-2xl border-2 shadow-2xl">
                                                            <SelectItem value="none" className="font-bold uppercase text-[10px] tracking-widest">NO INCENTIVE ATTACHED</SelectItem>
                                                            {discounts.map(d => <SelectItem key={d.id} value={d.id} className="font-bold uppercase text-[10px] tracking-widest">{d.code} &middot; {d.description}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            />
                                        </div>
                                    </div>
                                    
                                    {targetAudience === 'specific' && (
                                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Target Group</Label>
                                            <Button type="button" variant="outline" className="w-full h-14 rounded-2xl border-2 font-black uppercase tracking-widest text-xs justify-start px-6 bg-primary/[0.02] border-primary/20 text-primary shadow-sm" onClick={() => setIsClientSelectorOpen(true)}>
                                                <UserIcon className="mr-3 h-5 w-5 opacity-40" />
                                                Selected Group ({watch('targetClientIds')?.length || 0} Targets)
                                            </Button>
                                        </motion.div>
                                    )}
                                </div>
                            </CardContent>
                            <CardFooter className="bg-muted/5 border-t p-6 md:p-8 flex flex-col sm:flex-row gap-4">
                                <Button type="button" variant="outline" className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white flex-1" onClick={handleSubmit((data) => setPreviewData(data))} disabled={isSaving || isSending || isSendingTest}>
                                    <Eye className="mr-2 h-4 w-4 opacity-40" /> Tactical Preview
                                </Button>
                                <Button type="button" variant="outline" className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white flex-1" onClick={() => setIsTestSendDialogOpen(true)} disabled={isSaving || isSending || isSendingTest}>
                                    {isSendingTest ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4 opacity-40" />}
                                    Dispatch Test
                                </Button>
                            </CardFooter>
                        </Card>
                    </div>
                </form>
            </main>

            <CampaignPreviewDialog 
                previewData={previewData}
                onOpenChange={(open) => !open && setPreviewData(null)}
            />
            
            <ClientSelectorDialog
                open={isClientSelectorOpen}
                onOpenChange={setIsClientSelectorOpen}
                allClients={clients || []}
                initialSelectedIds={watch('targetClientIds') || []}
                onConfirm={(selectedIds) => {
                    setValue('targetClientIds', selectedIds, { shouldDirty: true });
                }}
            />

            <Dialog open={isTestSendDialogOpen} onOpenChange={setIsTestSendDialogOpen}>
                <DialogContent className="sm:max-w-md rounded-[3rem] border-4 p-0 overflow-hidden shadow-3xl">
                    <DialogHeader className="p-8 pb-4 border-b bg-muted/5 text-left">
                        <div className="flex items-center gap-3 mb-2">
                            <FlaskConical className="w-5 h-5 text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">Strategic Testing</span>
                        </div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Test Dispatch</DialogTitle>
                        <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-60">Authorize a mock dispatch to a verified address.</DialogDescription>
                    </DialogHeader>
                    <div className="p-8 space-y-4">
                        <div className="space-y-2 text-left">
                            <Label htmlFor="test-email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Target Address</Label>
                            <Input
                                id="test-email"
                                type="email"
                                value={testEmail}
                                onChange={(e) => setTestEmail(e.target.value)}
                                placeholder="test@example.com"
                                className="h-14 rounded-2xl border-2 font-bold shadow-inner"
                            />
                        </div>
                    </div>
                    <DialogFooter className="p-8 pt-0 flex flex-col gap-3">
                        <Button onClick={handleConfirmSendTest} className="w-full h-16 rounded-2xl text-lg font-black uppercase tracking-tight shadow-2xl shadow-primary/20">Authorize Dispatch</Button>
                        <Button variant="ghost" onClick={() => setIsTestSendDialogOpen(false)} className="w-full font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
