'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Megaphone, Mail, MessageSquare, Users, Star, UserPlus, Clock, MoreHorizontal, Send, Trash2, Eye, TrendingUp, DollarSign as DollarSignIcon, FlaskConical, Gift } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const AudienceIcon = ({ audience }: { audience: Campaign['targetAudience'] }) => {
    switch (audience) {
        case 'all': return <Users className="w-4 h-4 mr-2" />;
        case 'new': return <UserPlus className="w-4 h-4 mr-2" />;
        case 'loyal': return <Star className="w-4 h-4 mr-2" />;
        case 'inactive_90': return <Clock className="w-4 h-4 mr-2" />;
        case 'specific': return <Users className="w-4 h-4 mr-2" />;
        case 'birthday': return <Gift className="w-4 h-4 mr-2" />;
        default: return null;
    }
}

const audienceText: Record<Campaign['targetAudience'], string> = {
    all: 'All Clients',
    new: 'New Clients',
    loyal: 'Loyal Clients',
    inactive_90: 'Inactive (90+ days)',
    specific: 'Specific Clients',
    birthday: 'Birthday Month',
};

const CampaignCard = ({ campaign, onSend, onDelete }: { campaign: Campaign, onSend: (id: string) => void, onDelete: (campaign: Campaign) => void }) => (
    <Card>
        <CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-start gap-4">
                <div className="flex items-center gap-2">
                    <p className="font-semibold">{campaign.name}</p>
                    {campaign.subjectB && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger><FlaskConical className="h-4 w-4 text-purple-500" /></TooltipTrigger>
                                <TooltipContent><p>A/B Test</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => onSend(campaign.id)} disabled={campaign.status === 'sent'}>
                            <Send className="mr-2 h-4 w-4" /> Send Now
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => onDelete(campaign)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
             <p className="text-sm text-muted-foreground capitalize flex items-center gap-1.5">
                {campaign.type === 'email' ? <Mail className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                {campaign.type}
            </p>
            <div className="flex items-center text-sm">
                <AudienceIcon audience={campaign.targetAudience} />
                <span>{audienceText[campaign.targetAudience]} {campaign.targetAudience === 'specific' ? `(${campaign.targetClientIds?.length || 0})` : ''}</span>
            </div>
             <div className="flex items-center text-sm text-muted-foreground">
                <Users className="w-4 h-4 mr-2"/>
                <span>{campaign.status === 'sent' ? (campaign.recipientCount || 0) : 'N/A'} Recipients</span>
            </div>
             <div className="flex items-center justify-between text-sm pt-3 border-t">
                <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'} className="capitalize">{campaign.status}</Badge>
                <span className="text-muted-foreground">{campaign.sentAt ? format(new Date(campaign.sentAt), 'P') : 'Not sent'}</span>
            </div>
        </CardContent>
    </Card>
);

const KpiCard = ({ title, value, icon: Icon, description }: { title: string, value: string, icon: React.ElementType, description: string }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
            <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
    </Card>
);

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
  
  const sortedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return [...campaigns].sort((a,b) => {
        const aDate = a.sentAt ? new Date(a.sentAt).getTime() : 0;
        const bDate = b.sentAt ? new Date(b.sentAt).getTime() : 0;
        return bDate - aDate;
    })
  }, [campaigns]);

  const kpiData = useMemo(() => {
    if (!campaigns) return { totalCampaigns: 0, totalRecipients: 0, avgOpenRate: 0, totalRevenue: 0 };
    
    const sentCampaigns = campaigns.filter(c => c.status === 'sent');
    const totalRecipients = sentCampaigns.reduce((sum, c) => sum + (c.recipientCount || 0), 0);
    const totalRevenue = sentCampaigns.reduce((sum, c) => sum + (c.generatedRevenue || 0), 0);
    
    const campaignsWithOpenRate = sentCampaigns.filter(c => typeof c.openRate === 'number');
    const avgOpenRate = campaignsWithOpenRate.length > 0
      ? campaignsWithOpenRate.reduce((sum, c) => sum + (c.openRate || 0), 0) / campaignsWithOpenRate.length
      : 0;

    return {
      totalCampaigns: campaigns.length,
      totalRecipients,
      avgOpenRate: parseFloat(avgOpenRate.toFixed(1)),
      totalRevenue,
    };
  }, [campaigns]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Campaigns" />
      <main className="flex-1 p-4 md:p-8 space-y-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="Total Campaigns" value={kpiData.totalCampaigns.toString()} icon={Megaphone} description="Number of campaigns created." />
            <KpiCard title="Total Recipients" value={kpiData.totalRecipients.toLocaleString()} icon={Users} description="Total clients reached." />
            <KpiCard title="Avg. Open Rate" value={`${kpiData.avgOpenRate}%`} icon={Eye} description="Average email open rate." />
            <KpiCard title="Generated Revenue" value={`$${kpiData.totalRevenue.toFixed(2)}`} icon={DollarSignIcon} description="Direct revenue from campaigns." />
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
              <>
                <div className="hidden md:block">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Audience</TableHead>
                                <TableHead>Recipients</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Sent At</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedCampaigns.map(campaign => (
                                <TableRow key={campaign.id}>
                                    <TableCell className="font-medium flex items-center gap-2">
                                        {campaign.name}
                                        {campaign.subjectB && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger><FlaskConical className="h-4 w-4 text-purple-500" /></TooltipTrigger>
                                                    <TooltipContent><p>A/B Test</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="capitalize flex items-center gap-1.5">
                                            {campaign.type === 'email' ? <Mail className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                                            {campaign.type}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center">
                                            <AudienceIcon audience={campaign.targetAudience} />
                                            <span>{audienceText[campaign.targetAudience]} {campaign.targetAudience === 'specific' ? `(${campaign.targetClientIds?.length || 0})` : ''}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{campaign.status === 'sent' ? (campaign.recipientCount || '0') : 'N/A'}</TableCell>
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
                </div>
                <div className="md:hidden space-y-4">
                    {sortedCampaigns.map(campaign => (
                        <CampaignCard key={campaign.id} campaign={campaign} onSend={handleSendCampaign} onDelete={handleDeleteClick} />
                    ))}
                </div>
              </>
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
