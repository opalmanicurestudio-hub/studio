
'use client';

import React, { useState } from 'react';
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
import { ArrowLeft, Save, Send, Loader, Eye, Mail, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { nanoid } from 'nanoid';
import { type Campaign } from '@/lib/data';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const campaignSchema = z.object({
  name: z.string().min(3, "Campaign name must be at least 3 characters."),
  type: z.enum(['email', 'sms']),
  subject: z.string().optional(),
  body: z.string().min(10, "Message body is too short."),
  targetAudience: z.enum(['all', 'new', 'loyal', 'inactive_90']),
  discountId: z.string().optional(),
  imageUrl: z.string().url().optional(),
}).refine(data => data.type !== 'email' || (data.subject && data.subject.length > 0), {
    message: "Subject is required for email campaigns.",
    path: ["subject"],
});

type CampaignFormData = z.infer<typeof campaignSchema>;

const CampaignPreviewDialog = ({
  previewData,
  onOpenChange,
}: {
  previewData: CampaignFormData | null;
  onOpenChange: (open: boolean) => void;
}) => {
  if (!previewData) return null;

  const sampleClientName = 'Jane Doe';
  const bodyWithPlaceholders = previewData.body.replace('{{clientName}}', sampleClientName);

  return (
    <Dialog open={!!previewData} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Campaign Preview</DialogTitle>
        </DialogHeader>
        {previewData.type === 'email' ? (
          <div className="border rounded-lg overflow-hidden bg-background">
            <div className="p-4 bg-muted/50 border-b text-sm">
              <p><strong>To:</strong> {sampleClientName} &lt;jane.doe@example.com&gt;</p>
              <p><strong>From:</strong> Your Business &lt;hello@yourbusiness.com&gt;</p>
              <p><strong>Subject:</strong> {previewData.subject}</p>
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
          <div className="flex justify-center p-4">
            <div className="w-[320px] h-[580px] bg-muted rounded-3xl border-8 border-foreground p-4 flex flex-col">
              <div className="flex-1 bg-background rounded-lg p-3 overflow-y-auto flex flex-col justify-end">
                 <div className="bg-primary text-primary-foreground p-2 rounded-lg ml-auto max-w-[80%]">
                  <p className="text-sm whitespace-pre-wrap">{bodyWithPlaceholders}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};


export default function NewCampaignPage() {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const router = useRouter();
    const { toast } = useToast();
    const { discounts } = useInventory();
    const [isSaving, setIsSaving] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [previewData, setPreviewData] = useState<CampaignFormData | null>(null);

    const { control, handleSubmit, register, watch, formState: { errors } } = useForm<CampaignFormData>({
        resolver: zodResolver(campaignSchema),
        defaultValues: {
            type: 'email',
            targetAudience: 'all',
        }
    });
    
    const campaignType = watch('type');

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

    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="New Campaign" />
            <main className="flex-1 p-4 md:p-8">
                <form>
                     <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 mb-8">
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                             <Button type="button" variant="outline" onClick={handleSubmit((data) => processSubmit(data, 'draft'))} disabled={isSaving || isSending} className="flex-1 sm:flex-auto">
                                {isSaving ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save Draft
                            </Button>
                            <Button type="button" variant="secondary" onClick={handleSubmit((data) => setPreviewData(data))}>
                                <Eye className="mr-2 h-4 w-4" /> Preview
                            </Button>
                            <Button type="button" onClick={handleSubmit((data) => processSubmit(data, 'sent'))} disabled={isSaving || isSending} className="flex-1 sm:flex-auto">
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
                        <CardHeader>
                            <CardTitle>Compose Your Campaign</CardTitle>
                            <CardDescription>Fill in the details for your new marketing campaign.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
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
                                        <Label htmlFor="subject">Subject Line</Label>
                                        <Input id="subject" placeholder="e.g., A special treat, just for you!" {...register('subject')} />
                                        {errors.subject && <p className="text-sm text-destructive">{errors.subject.message}</p>}
                                    </div>
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
                                <Label htmlFor="body">Message Body</Label>
                                <Textarea id="body" placeholder="Hi {{clientName}}, ..." {...register('body')} rows={8} />
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
                        </CardContent>
                    </Card>
                </form>
            </main>
             <CampaignPreviewDialog 
                previewData={previewData}
                onOpenChange={(open) => !open && setPreviewData(null)}
            />
        </div>
    );
}
