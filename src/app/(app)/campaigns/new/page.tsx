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
import { ArrowLeft, Save, Send, Loader } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { nanoid } from 'nanoid';
import { type Campaign } from '@/lib/data';

const campaignSchema = z.object({
  name: z.string().min(3, "Campaign name must be at least 3 characters."),
  type: z.enum(['email', 'sms']),
  subject: z.string().optional(),
  body: z.string().min(10, "Message body is too short."),
  targetAudience: z.enum(['all', 'new', 'loyal', 'inactive_90']),
  discountId: z.string().optional(),
}).refine(data => data.type !== 'email' || (data.subject && data.subject.length > 0), {
    message: "Subject is required for email campaigns.",
    path: ["subject"],
});

type CampaignFormData = z.infer<typeof campaignSchema>;

export default function NewCampaignPage() {
    const { firestore } = useFirebase();
    const { selectedTenant } = useTenant();
    const router = useRouter();
    const { toast } = useToast();
    const { discounts } = useInventory();
    const [isSaving, setIsSaving] = useState(false);

    const { control, handleSubmit, register, watch, formState: { errors } } = useForm<CampaignFormData>({
        resolver: zodResolver(campaignSchema),
        defaultValues: {
            type: 'email',
            targetAudience: 'all',
        }
    });
    
    const campaignType = watch('type');

    const onSubmit = async (data: CampaignFormData) => {
        if (!firestore || !selectedTenant) return;
        setIsSaving(true);
        
        const newCampaign: Omit<Campaign, 'id'> = {
            ...data,
            status: 'draft',
        };
        
        try {
            await addDocumentNonBlocking(collection(firestore, 'tenants', selectedTenant.id, 'campaigns'), {
              ...newCampaign,
              id: nanoid(),
            });

            toast({
                title: "Campaign Saved!",
                description: `${data.name} has been saved as a draft.`
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
            setIsSaving(false);
        }
    }

    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="New Campaign" />
            <main className="flex-1 p-4 md:p-8">
                <form onSubmit={handleSubmit(onSubmit)}>
                    <div className="flex items-center justify-between gap-4 mb-8">
                        <Button variant="outline" asChild>
                            <Link href="/campaigns">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back to Campaigns
                            </Link>
                        </Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save as Draft
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
                                            <div><RadioGroupItem value="email" id="email" className="peer sr-only" /><Label htmlFor="email" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Email</Label></div>
                                            <div><RadioGroupItem value="sms" id="sms" className="peer sr-only" /><Label htmlFor="sms" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-4 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">SMS</Label></div>
                                        </RadioGroup>
                                    </div>
                                )}
                            />

                            {campaignType === 'email' && (
                                <div className="space-y-2">
                                    <Label htmlFor="subject">Subject Line</Label>
                                    <Input id="subject" placeholder="e.g., A special treat, just for you!" {...register('subject')} />
                                    {errors.subject && <p className="text-sm text-destructive">{errors.subject.message}</p>}
                                </div>
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
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger id="discountId"><SelectValue placeholder="Select a discount code" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="">None</SelectItem>
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
        </div>
    );
}
