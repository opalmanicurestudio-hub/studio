
'use client';

import React, { useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Megaphone, Mail, MessageSquare, Users, Star, UserPlus, Clock, MoreHorizontal, Send, Trash2 } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { type Campaign } from '@/lib/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import Link from 'next/link';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';

const AudienceIcon = ({ audience }: { audience: Campaign['targetAudience']}) => {
    switch (audience) {
        case 'all': return <Users className="w-4 h-4 mr-2" />;
        case 'new': return <UserPlus className="w-4 h-4 mr-2" />;
        case 'loyal': return <Star className="w-4 h-4 mr-2" />;
        case 'inactive_90': return <Clock className="w-4 h-4 mr-2" />;
        default: return null;
    }
}

const audienceText = {
    all: 'All Clients',
    new: 'New Clients',
    loyal: 'Loyal Clients',
    inactive_90: 'Inactive (90+ days)',
};

export default function CampaignsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);

  const campaignsQuery = useMemoFirebase(() => 
    firestore && selectedTenant
      ? collection(firestore, 'tenants', selectedTenant.id, 'campaigns')
      : null
  , [firestore, selectedTenant]);

  const { data: campaigns, isLoading } = useCollection<Campaign>(campaignsQuery);

  const handleSendCampaign = (campaignId: string) => {
    if (!firestore || !selectedTenant) return;
    const campaignRef = doc(firestore, 'tenants', selectedTenant.id, 'campaigns', campaignId);
    updateDocumentNonBlocking(campaignRef, {
        status: 'sent',
        sentAt: new Date().toISOString(),
    });
    toast({ title: "Campaign Sent!", description: "Your campaign is on its way." });
  };

  const handleDeleteClick = (campaign: Campaign) => {
    setCampaignToDelete(campaign);
  };

  const confirmDelete = () => {
    if (!campaignToDelete || !firestore || !selectedTenant) return;
    const campaignRef = doc(firestore, 'tenants', selectedTenant.id, 'campaigns', campaignToDelete.id);
    deleteDocumentNonBlocking(campaignRef);
    toast({ title: "Campaign Deleted" });
    setCampaignToDelete(null);
  };

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Campaigns" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Marketing Campaigns</h1>
            <p className="text-muted-foreground mt-1">
              Engage your clients with targeted email and SMS campaigns.
            </p>
          </div>
          <Button asChild>
            <Link href="/campaigns/new">
                <PlusCircle className="mr-2 h-4 w-4" /> New Campaign
            </Link>
          </Button>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Your Campaigns</CardTitle>
            <CardDescription>A list of all your marketing campaigns, past and present.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
                <p>Loading campaigns...</p>
            ) : campaigns && campaigns.length > 0 ? (
              <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Audience</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent At</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {campaigns.map(campaign => (
                        <TableRow key={campaign.id}>
                            <TableCell className="font-medium">{campaign.name}</TableCell>
                            <TableCell>
                                <Badge variant="outline" className="capitalize flex items-center gap-1.5">
                                    {campaign.type === 'email' ? <Mail className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                                    {campaign.type}
                                </Badge>
                            </TableCell>
                             <TableCell>
                                <div className="flex items-center">
                                    <AudienceIcon audience={campaign.targetAudience} />
                                    <span>{audienceText[campaign.targetAudience]}</span>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'} className="capitalize">{campaign.status}</Badge>
                            </TableCell>
                            <TableCell>{campaign.sentAt ? format(new Date(campaign.sentAt), 'PPp') : 'Not sent'}</TableCell>
                            <TableCell className="text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuItem onClick={() => handleSendCampaign(campaign.id)} disabled={campaign.status === 'sent'}>
                                            <Send className="mr-2 h-4 w-4" /> Send Now
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteClick(campaign)}>
                                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-20 px-6 border-2 border-dashed rounded-lg">
                <Megaphone className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Campaigns Created Yet</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Click the button to create your first email or SMS campaign.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <AlertDialog open={!!campaignToDelete} onOpenChange={() => setCampaignToDelete(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
                This will permanently delete the "{campaignToDelete?.name}" campaign. This action cannot be undone.
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
                onClick={confirmDelete}
                className={buttonVariants({ variant: "destructive" })}
            >
                Delete
            </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
