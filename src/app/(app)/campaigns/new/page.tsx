'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { ArrowLeft, Save, Send, Loader, Eye, Mail, MessageSquare, Wand2, HandHeart, Sparkles, PartyPopper, Search, User as UserIcon, FlaskConical, Gift, ChevronDown } from 'lucide-react';
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

const CampaignPreviewDialog = ({
  previewData,
  onOpenChange,
}: {
  previewData: CampaignFormData | null;
  onOpenChange: (open: boolean) => void;
}) => {
  if (!previewData) return null;

  const sampleClientName = 'Jane Doe';
  const bodyWithPlaceholders = previewData.body.replace(/{{clientName}}/g, sampleClientName);

  return (
    <Dialog open={!!previewData} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="p-6 pb-2 text-left">
          <DialogTitle>Campaign Preview</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[80vh]">
          <div className="p-6 pt-0">
            {previewData.type === 'email' ? (
              <div className="border rounded-lg overflow-hidden bg-background">
                <div className="p-4 bg-muted/50 border-b text-sm">
                  <p><strong>To:</strong> {sampleClientName} &lt;jane.doe@example.com&gt;</p>
                  <p><strong>From:</strong> Your Business &lt;hello@yourbusiness.com&gt;</p>
                  <p><strong>Subject (A):</strong> {previewData.subject}</p>
                  {previewData.subjectB && <p><strong>Subject (B):</strong> {previewData.subjectB}</p>}
                </div>
                <div className="p-4">
                  {previewData.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewData.imageUrl} alt="Campaign visual" className="w-full h-auto rounded-md mb-4" />
                  )}
                  <div className="prose prose-sm dark:prose-invert max-w-full" dangerouslySetInnerHTML={{ __html: bodyWithPlaceholders.replace(/\n/g, '<br />') }} />
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-4">
                <div className="w-[320px] h-[580px] bg-muted rounded-3xl border-8 border-foreground p-4 flex flex-col">
                  <div className="flex-1 bg-background rounded-lg p-3 overflow-y-auto flex flex-col justify-end">
                     <div className="bg-primary text-primary-foreground p-2 rounded-lg ml-auto max-w-[80%]">
                      <p className="text-sm whitespace-pre-wrap">{bodyWithPlaceholders}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
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
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Select Clients</DialogTitle>
                    <DialogDescription>Choose specific clients to receive this campaign.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4 text-left">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search clients..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
                    </div>
                    <ScrollArea className="h-72">
                        <div className="space-y-2 pr-4">
                            {filteredClients.map(client => (
                                <div key={client.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted">
                                    <Checkbox id={`client-${client.id}`} checked={selectedIds.has(client.id)} onCheckedChange={() => handleToggle(client.id)} />
                                    <Avatar className="h-8 w-8"><AvatarImage src={client.avatarUrl} /><AvatarFallback>{client.name.charAt(0)}</AvatarFallback></Avatar>
                                    <label htmlFor={`client-${client.id}`} className="text-sm font-medium">{client.name}</label>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirm}>Confirm ({selectedIds.size})</Button>
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

    const { control, handleSubmit, register, watch, setValue, formState: { errors } } = useForm<CampaignFormData>({
        resolver: zodResolver(campaignSchema),
        defaultValues: {
            type: 'email',
            targetAudience: 'all',
            targetClientIds: [],
        }
    });
    
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
            
            setValue('body', newText, { shouldDirty: true });

            // We need to wait for the re-render to complete before setting cursor
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
                textarea.focus();
            }, 0);
        }
    };
    
    const handleTemplateSelect = (templateName: string) => {
        const template = premadeCampaigns.find(t => t.name === templateName);
        if (template) {
            setValue('name', template.name, { shouldDirty: true });
            setValue('type', template.type as 'email' | 'sms', { shouldDirty: true });
            setValue('subject', template.subject, { shouldDirty: true });
            setValue('body', template.body, { shouldDirty: true });
            setValue('targetAudience', template.targetAudience as any, { shouldDirty: true });
            
            toast({
                title: "Template Applied",
                description: `Script for "${template.name}" has been loaded.`,
            });
        }
    };

    const processSubmit = async (data: CampaignFormData, status: 'draft' | 'sent') => {
        if (!firestore || !selectedTenant) return;

        if (status === 'draft') setIsSaving(true);
        else setIsSending(true);

        const newCampaign: Omit<Campaign, 'id' | 'sentAt'> = {
            ...data,
            status,
        };

        const finalCampaign = {
            ...newCampaign,
            id: nanoid(),
            sentAt: status === 'sent' ? new Date().toISOString() : undefined,
        }
        
        try {
            await addDocumentNonBlocking(collection(firestore, 'tenants', selectedTenant.id, 'campaigns'), finalCampaign);

            toast({
                title: status === 'draft' ? "Campaign Saved!" : "Campaign Sent!",
                description: `${data.name} has been ${status === 'draft' ? 'saved as a draft' : 'sent'}.`
            });
            router.push('/campaigns');
        } catch (error) {
            console.error("Error saving campaign: ", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "There was a problem saving your campaign."
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
                title: 'Invalid Email',
                description: 'Please enter a valid email address to send the test.',
            });
            return;
        }
    
        setIsSendingTest(true);
        setIsTestSendDialogOpen(false);
    
        // This is a simulation, as we don't have a mailer service integrated.
        await new Promise(resolve => setTimeout(resolve, 1500));
    
        toast({
            title: 'Test "Sent"!',
            description: `A test campaign would be sent to ${testEmail}. This is a simulation.`,
        });
    
        setIsSendingTest(false);
    };

    const { ref: bodyRef, ...bodyRegister } = register('body');

    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="New Campaign" />
            <main className="flex-1 p-4 md:p-8">
                <form>
                     <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 mb-8">
                        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                             <Button type="button" variant="outline" onClick={handleSubmit((data) => processSubmit(data, 'draft'))} disabled={isSaving || isSending || isSendingTest} className="flex-1 sm:flex-auto">
                                {isSaving ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save Draft
                            </Button>
                            <Button type="button" variant="secondary" onClick={handleSubmit((data) => setPreviewData(data))} disabled={isSaving || isSending || isSendingTest}>
                                <Eye className="mr-2 h-4 w-4" /> Preview
                            </Button>
                             <Button type="button" variant="secondary" onClick={() => setIsTestSendDialogOpen(true)} disabled={isSaving || isSending || isSendingTest}>
                                {isSendingTest ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                                Send Test
                            </Button>
                            <Button type="button" onClick={handleSubmit((data) => processSubmit(data, 'sent'))} disabled={isSaving || isSending || isSendingTest} className="flex-1 sm:flex-auto">
                                {isSending ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                Send
                            </Button>
                        </div>
                        <Button variant="outline" asChild className="w-full sm:w-auto self-start sm:self-center">
                            <Link href="/campaigns">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back
                            </Link>
                        </Button>
                    </div>
                     <Card>
                        <CardHeader className="text-left">
                            <CardTitle>Compose Your Campaign</CardTitle>
                             <div className="pt-4">
                                <Select onValueChange={handleTemplateSelect}>
                                    <SelectTrigger className="w-full md:w-1/2 border-primary/50 ring-primary/20">
                                        <SelectValue placeholder="✨ Start from a template script..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {premadeCampaigns.map(template => (
                                            <SelectItem key={template.name} value={template.name}>
                                                <div className="flex items-center gap-2">
                                                    <template.icon className="h-4 w-4 text-primary" />
                                                    <span>{template.name}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 text-left">
                            <div className="space-y-2">
                                <Label htmlFor="name">Campaign Name (Internal)</Label>
                                <Input id="name" placeholder="e.g., July Summer Special" {...register('name')} />
                                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                            </div>
                            
                            <Controller
                                name="type"
                                control={control}
                                render={({ field }) => (
                                    <div className="space-y-2">
                                        <Label>Campaign Type</Label>
                                        <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-4">
                                            <div><RadioGroupItem value="email" id="email" className="peer sr-only" /><Label htmlFor="email" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"><Mail className="w-6 h-6 mb-2"/>Email</Label></div>
                                            <div><RadioGroupItem value="sms" id="sms" className="peer sr-only" /><Label htmlFor="sms" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"><MessageSquare className="w-6 h-6 mb-2"/>SMS</Label></div>
                                        </RadioGroup>
                                    </div>
                                )}
                            />

                            {campaignType === 'email' && (
                                <>
                                    <div className="space-y-2">
                                        <Label htmlFor="subject">Subject Line (Variant A)</Label>
                                        <Input id="subject" placeholder="e.g., A special treat, just for you!" {...register('subject')} />
                                        {errors.subject && <p className="text-sm text-destructive">{errors.subject.message}</p>}
                                    </div>

                                    {isABTest ? (
                                        <div className="space-y-2 p-4 border-l-2 border-primary bg-primary/5 rounded-r-lg">
                                            <Label htmlFor="subjectB">Subject Line (Variant B)</Label>
                                            <Input id="subjectB" placeholder="e.g., Your next favorite service is here..." {...register('subjectB')} />
                                        </div>
                                    ) : (
                                        <Button type="button" variant="outline" size="sm" onClick={() => setIsABTest(true)}>
                                            <FlaskConical className="mr-2 h-4 w-4" /> Create A/B Test
                                        </Button>
                                    )}

                                    <Controller
                                        name="imageUrl"
                                        control={control}
                                        render={({ field }) => (
                                            <div className="space-y-2">
                                                <Label>Header Image (Optional)</Label>
                                                <ImageUpload onImageUploaded={field.onChange} initialImage={field.value} />
                                            </div>
                                        )}
                                    />
                                </>
                            )}

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="body">Message Body</Label>
                                    <div className="flex items-center gap-2">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" size="sm" className="h-7 text-[10px] font-black uppercase">
                                                    Insert Service <ChevronDown className="ml-1 h-3 w-3" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-56 max-h-64 overflow-y-auto">
                                                {services.map(s => (
                                                    <DropdownMenuItem key={s.id} onClick={() => handleInsertPlaceholder(s.name)}>
                                                        {s.name}
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                        <Button
                                            type="button"
                                            variant="link"
                                            className="p-1 h-auto text-[10px] uppercase font-black"
                                            onClick={() => handleInsertPlaceholder('{{clientName}}')}
                                        >
                                            Insert Client Name
                                        </Button>
                                    </div>
                                </div>
                                <Textarea
                                    id="body"
                                    placeholder="Hi {{clientName}}, ..."
                                    {...bodyRegister}
                                    ref={(e) => {
                                        bodyRef(e);
                                        bodyTextareaRef.current = e;
                                    }}
                                    rows={8}
                                />
                                <p className="text-xs text-muted-foreground">Use {'{{clientName}}'} to personalize your message.</p>
                                {errors.body && <p className="text-sm text-destructive">{errors.body.message}</p>}
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Controller
                                    name="targetAudience"
                                    control={control}
                                    render={({ field }) => (
                                        <div className="space-y-2">
                                            <Label htmlFor="targetAudience">Target Audience</Label>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger id="targetAudience"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">All Clients</SelectItem>
                                                    <SelectItem value="new">New Clients (first visit)</SelectItem>
                                                    <SelectItem value="loyal">Loyal Clients (5+ visits)</SelectItem>
                                                    <SelectItem value="inactive_90">Inactive (90+ days)</SelectItem>
                                                    <SelectItem value="birthday">Birthday Month</SelectItem>
                                                    <SelectItem value="specific">Specific Clients</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                />
                                <Controller
                                    name="discountId"
                                    control={control}
                                    render={({ field }) => (
                                        <div className="space-y-2">
                                            <Label htmlFor="discountId">Attach Discount (Optional)</Label>
                                            <Select 
                                                onValueChange={(value) => field.onChange(value === 'none' ? undefined : value)} 
                                                value={field.value || 'none'}
                                            >
                                                <SelectTrigger id="discountId"><SelectValue placeholder="Select a discount code" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">None</SelectItem>
                                                    {discounts.map(d => <SelectItem key={d.id} value={d.id}>{d.code} - {d.description}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                />
                            </div>
                             {targetAudience === 'specific' && (
                                <div className="space-y-2">
                                    <Label>Selected Clients</Label>
                                    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setIsClientSelectorOpen(true)}>
                                        <UserIcon className="mr-2 h-4 w-4" />
                                        Select Clients ({watch('targetClientIds')?.length || 0} selected)
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
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
                <DialogContent className="sm:max-w-md">
                    <DialogHeader className="p-6 pb-4 text-left">
                        <DialogTitle>Send Test Campaign</DialogTitle>
                        <DialogDescription>Enter the email address to receive this test.</DialogDescription>
                    </DialogHeader>
                    <div className="p-6 pt-0 space-y-2">
                        <Label htmlFor="test-email">Email Address</Label>
                        <Input
                            id="test-email"
                            type="email"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            placeholder="test@example.com"
                        />
                    </div>
                    <DialogFooter className="p-6 pt-0">
                        <Button variant="outline" onClick={() => setIsTestSendDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleConfirmSendTest}>Send Test</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
