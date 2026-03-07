'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
    PlusCircle, 
    Megaphone, 
    Mail, 
    MessageSquare, 
    Users, 
    Star, 
    UserPlus, 
    Clock, 
    MoreHorizontal, 
    Send, 
    Trash2, 
    Eye, 
    TrendingUp, 
    DollarSign as DollarSignIcon, 
    FlaskConical, 
    Gift, 
    Loader,
    Sparkles,
    CheckCircle2,
    Activity,
    ChevronRight,
    Search
} from 'lucide-react';
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
import { cn } from '@/lib/utils';

const AudienceIcon = ({ audience }: { audience: Campaign['targetAudience'] }) => {
    switch (audience) {
        case 'all': return <Users className="w-3.5 h-3.5" />;
        case 'new': return <UserPlus className="w-3.5 h-3.5" />;
        case 'loyal': return <Star className="w-3.5 h-3.5" />;
        case 'inactive_90': return <Clock className="w-3.5 h-3.5" />;
        case 'specific': return <Users className="w-3.5 h-3.5" />;
        case 'birthday': return <Gift className="w-3.5 h-3.5" />;
        default: return null;
    }
}

const audienceText: Record<Campaign['targetAudience'], string> = {
    all: 'ALL GUESTS',
    new: 'NEW GUESTS',
    loyal: 'LOYAL GUESTS',
    inactive_90: 'INACTIVE (90D)',
    specific: 'SPECIFIC GROUP',
    birthday: 'BIRTHDAY MONTH',
};

const KpiCard = ({ title, value, icon: Icon, description, colorClass }: { title: string, value: string, icon: any, description: string, colorClass?: string }) => (
    <Card className="border-2 shadow-sm min-w-0 text-left">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                {title}
            </CardTitle>
            <Icon className={cn("h-4 w-4 opacity-40", colorClass)} />
        </CardHeader>
        <CardContent>
            <div className={cn("text-2xl md:text-3xl font-black tracking-tighter font-mono", colorClass || "text-slate-900")}>
                {value}
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-40">{description}</p>
        </CardContent>
    </Card>
);

const CampaignCard = ({ campaign, onSend, onDelete }: { campaign: Campaign, onSend: (id: string) => void, onDelete: (campaign: Campaign) => void }) => (
    <Card className="border-2 shadow-sm rounded-[1.5rem] overflow-hidden group">
        <CardContent className="p-5 space-y-4">
            <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{campaign.name}</p>
                        {campaign.subjectB && <FlaskConical className="h-3 w-3 text-purple-500 shrink-0" />}
                    </div>
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60 flex items-center gap-1.5">
                        {campaign.type === 'email' ? <Mail className="w-2.5 h-2.5" /> : <MessageSquare className="w-2.5 h-2.5" />}
                        {campaign.type} &middot; {audienceText[campaign.targetAudience]}
                    </p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2 rounded-lg"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
                        <DropdownMenuItem onClick={() => onSend(campaign.id)} disabled={campaign.status === 'sent'} className="font-bold text-[10px] uppercase tracking-widest">
                            <Send className="mr-2 h-3.5 w-3.5" /> Dispatch Now
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase tracking-widest" onClick={() => onDelete(campaign)}>
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Terminate
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            
            <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 rounded-xl bg-muted/20 border shadow-inner">
                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-0.5">Reach</p>
                    <p className="font-black font-mono text-sm">{campaign.status === 'sent' ? (campaign.recipientCount || 0) : '—'}</p>
                </div>
                <div className="p-3 rounded-xl bg-primary/[0.03] border border-primary/5 shadow-inner">
                    <p className="text-[8px] font-black uppercase text-primary/40 mb-0.5">Yield</p>
                    <p className="font-black font-mono text-sm text-primary">${(campaign.generatedRevenue || 0).toFixed(0)}</p>
                </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-dashed mt-2">
                <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'} className="h-5 px-2 font-black text-[8px] uppercase border-none shadow-sm">{campaign.status}</Badge>
                <span className="text-[9px] font-black uppercase text-muted-foreground opacity-40">{campaign.sentAt ? format(new Date(campaign.sentAt), 'MMM d, yy') : 'NOT DISPATCHED'}</span>
            </div>
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
    toast({ title: "Campaign Dispatched!", description: "Dispatch successful. Data tracking initiated." });
  };

  const handleDeleteClick = (campaign: Campaign) => {
    setCampaignToDelete(campaign);
  };

  const confirmDelete = () => {
    if (!campaignToDelete || !firestore || !selectedTenant) return;
    const campaignRef = doc(firestore, 'tenants', selectedTenant.id, 'campaigns', campaignToDelete.id);
    deleteDocumentNonBlocking(campaignRef);
    toast({ title: "Campaign Terminated" });
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
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Outreach Pulse" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-8 md:space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Campaign Hub</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Retention engine & dispatch matrix
            </p>
          </div>
          <Button asChild className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
            <Link href="/campaigns/new">
                <PlusCircle className="mr-2 h-4 w-4" /> New Dispatch
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="Total Dispatches" value={kpiData.totalCampaigns.toString()} icon={Megaphone} description="Total campaigns created." />
            <KpiCard title="Tactical Reach" value={kpiData.totalRecipients.toLocaleString()} icon={Users} description="Total clients engaged." />
            <KpiCard title="Avg. Open Velocity" value={`${kpiData.avgOpenRate}%`} icon={Eye} description="Email engagement rate." />
            <KpiCard title="Marketing Yield" value={`$${kpiData.totalRevenue.toFixed(0)}`} icon={TrendingUp} colorClass="text-primary" description="Direct revenue yield." />
        </div>
        
        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
          <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
            <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight">Dispatch Archive</CardTitle>
            <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Complete audit trail of studio outreach.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
                <div className="flex flex-col items-center justify-center p-24 gap-4">
                    <Loader className="animate-spin h-8 w-8 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Archive...</p>
                </div>
            ) : campaigns && campaigns.length > 0 ? (
              <>
                <div className="hidden md:block overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-muted/10 border-b-2">
                            <TableRow>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] p-6 text-slate-900">Campaign Label</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Logic Type</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Target Audience</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Reach</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Yield</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Status</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] pr-10 text-slate-900">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedCampaigns.map(campaign => (
                                <TableRow key={campaign.id} className="group hover:bg-primary/[0.02] transition-colors border-b">
                                    <TableCell className="p-6">
                                        <div className="flex items-center gap-2">
                                            <span className="font-black uppercase tracking-tight text-sm text-slate-900">{campaign.name}</span>
                                            {campaign.subjectB && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger><FlaskConical className="h-3.5 w-3.5 text-purple-500 opacity-60" /></TooltipTrigger>
                                                        <TooltipContent className="rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">A/B Strategy Active</TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="h-6 px-2.5 rounded-lg border-2 font-black text-[8px] uppercase tracking-widest bg-white shadow-sm flex items-center gap-1.5 w-fit">
                                            {campaign.type === 'email' ? <Mail className="w-2.5 h-2.5" /> : <MessageSquare className="w-2.5 h-2.5" />}
                                            {campaign.type}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-600 tracking-tight">
                                            <AudienceIcon audience={campaign.targetAudience} />
                                            <span>{audienceText[campaign.targetAudience]}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-black font-mono text-sm text-slate-700">{campaign.status === 'sent' ? (campaign.recipientCount || '0') : '—'}</TableCell>
                                    <TableCell className="font-black font-mono text-sm text-primary">{campaign.status === 'sent' ? `$${(campaign.generatedRevenue || 0).toFixed(0)}` : '—'}</TableCell>
                                    <TableCell>
                                        <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'} className="h-5 px-2 font-black text-[8px] uppercase border-none shadow-sm">{campaign.status}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right pr-10">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="rounded-xl hover:bg-primary/5"><MoreHorizontal className="h-4 w-4" /></Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
                                                <DropdownMenuItem onClick={() => handleSendCampaign(campaign.id)} disabled={campaign.status === 'sent'} className="font-bold text-[10px] uppercase tracking-widest">
                                                    <Send className="mr-2 h-3.5 w-3.5" /> Dispatch Now
                                                </DropdownMenuItem>
                                                <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase tracking-widest" onClick={() => handleDeleteClick(campaign)}>
                                                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Terminate
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                <div className="md:hidden space-y-4 p-5">
                    {sortedCampaigns.map(campaign => (
                        <CampaignCard key={campaign.id} campaign={campaign} onSend={handleSendCampaign} onDelete={handleDeleteClick} />
                    ))}
                </div>
              </>
            ) : (
              <div className="text-center py-24 md:py-32 px-6 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-6">
                <div className="p-6 bg-muted rounded-[2rem] shadow-inner"><Megaphone className="h-16 w-16 text-muted-foreground" /></div>
                <div className="space-y-2">
                    <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Archive Idle</h3>
                    <p className="text-sm font-bold uppercase tracking-tight max-w-sm mx-auto">
                        Your retention engine is waiting. Create a targeted Email or SMS dispatch to drive growth.
                    </p>
                </div>
                <Button size="lg" asChild className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 mt-4">
                    <Link href="/campaigns/new">Initiate First Dispatch</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!campaignToDelete} onOpenChange={() => setCampaignToDelete(null)}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
            <AlertDialogHeader className="p-6 pb-0">
                <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Terminate Dispatch</AlertDialogTitle>
                <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase">
                    You are about to permanently delete the archive for <strong>"{campaignToDelete?.name}"</strong>. This will purge all associated performance metrics and history. <strong>This action is non-reversible.</strong>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                <Button onClick={confirmDelete} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Purge Record</Button>
                <AlertDialogCancel className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
