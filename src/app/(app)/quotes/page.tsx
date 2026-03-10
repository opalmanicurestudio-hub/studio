'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
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
    CheckCircle,
    Activity,
    ChevronRight,
    Search,
    Percent,
    FileText,
    ShieldCheck
} from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { type Campaign, type Quote as QuoteType } from '@/lib/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useInventory } from '@/context/InventoryContext';
import { useRouter } from 'next/navigation';

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
            <Icon className={cn("h-4 w-4 opacity-40", colorClass || "text-slate-900")} />
        </CardHeader>
        <CardContent>
            <div className={cn("text-2xl md:text-3xl font-black tracking-tighter font-mono", colorClass || "text-slate-900")}>
                {value}
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-40">{description}</p>
        </CardContent>
    </Card>
);

const QuoteCard = ({ quote, onBookEvent, onDelete }: { quote: QuoteType, onBookEvent: (quote: QuoteType) => void, onDelete: (id: string) => void }) => (
    <Card className="border-2 shadow-sm rounded-[1.5rem] overflow-hidden group">
        <CardContent className="p-5 space-y-4">
            <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0 text-left">
                    <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{quote.eventName}</p>
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60">Status: {quote.status}</p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2 rounded-lg"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
                        <DropdownMenuItem asChild className="font-bold text-[10px] uppercase tracking-widest">
                            <Link href={`/quotes/${quote.id}`}>
                                <Eye className="mr-2 h-3.5 w-3.5 opacity-40"/>
                                View Details
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onBookEvent(quote)} disabled={quote.status !== 'accepted'} className="font-bold text-[10px] uppercase text-primary">
                            <CheckCircle className="mr-2 h-3.5 w-3.5 opacity-40"/>
                            <span>Finalize & Book</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase" onClick={() => onDelete(quote.id)}>
                            <Trash2 className="mr-2 h-3.5 w-3.5 opacity-40"/>
                            Terminate
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            
            <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 rounded-xl bg-muted/20 border shadow-inner">
                    <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-0.5">Value</p>
                    <p className="font-black font-mono text-sm">${(quote.lineItems.reduce((acc, i) => acc + (i.price * i.quantity), 0) + quote.travelExpenses).toFixed(0)}</p>
                </div>
                <div className="p-3 rounded-xl bg-primary/[0.03] border border-primary/5 shadow-inner">
                    <p className="text-[8px] font-black uppercase text-primary/40 mb-0.5">Retainer</p>
                    <p className="font-black font-mono text-sm text-primary">${(quote as any).depositAmount?.toFixed(0) || '0'}</p>
                </div>
            </div>
        </CardContent>
    </Card>
);

export default function QuotesPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const router = useRouter();
  const [quoteToDeleteId, setQuoteToDeleteId] = useState<string | null>(null);

  const quotesQuery = useMemoFirebase(() => 
    firestore && selectedTenant
      ? collection(firestore, 'tenants', selectedTenant.id, 'quotes')
      : null
  , [firestore, selectedTenant]);

  const { data: quotes, isLoading } = useCollection<QuoteType>(quotesQuery);

  const handleDeleteClick = (id: string) => {
    setQuoteToDeleteId(id);
  };

  const confirmDelete = () => {
    if (!quoteToDeleteId || !firestore || !selectedTenant) return;
    const quoteRef = doc(firestore, 'tenants', selectedTenant.id, 'quotes', quoteToDeleteId);
    deleteDocumentNonBlocking(quoteRef);
    toast({ title: "Proposal Terminated" });
    setQuoteToDeleteId(null);
  };
  
  const sortedQuotes = useMemo(() => {
    if (!quotes) return [];
    return [...quotes].sort((a,b) => {
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
    })
  }, [quotes]);

  const kpiData = useMemo(() => {
    if (!quotes) return { totalQuotes: 0, totalAccepted: 0, totalValue: 0, conversionRate: 0 };
    
    const acceptedQuotes = quotes.filter(q => q.status === 'accepted' || q.status === 'booked');
    const totalValue = acceptedQuotes.reduce((sum, q) => {
        const itemsTotal = q.lineItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        return sum + itemsTotal + q.travelExpenses;
    }, 0);
    
    const conversionRate = quotes.length > 0 ? (acceptedQuotes.length / quotes.length) * 100 : 0;

    return {
      totalQuotes: quotes.length,
      totalAccepted: acceptedQuotes.length,
      totalValue,
      conversionRate: parseFloat(conversionRate.toFixed(1)),
    };
  }, [quotes]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Project Invoicing" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-8 md:space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1 text-left">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Proposal Ledger</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Contract management & quote engine
            </p>
          </div>
          <Button asChild className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
            <Link href="/quotes/new">
                <PlusCircle className="mr-2 h-4 w-4" /> New Proposal
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="Active Protocols" value={kpiData.totalQuotes.toString()} icon={FileText} description="Total proposals created." />
            <KpiCard title="Accepted Yield" value={`$${kpiData.totalValue.toLocaleString()}`} icon={TrendingUp} description="Value of secured contracts." colorClass="text-primary" />
            <KpiCard title="Conversion Flow" value={`${kpiData.conversionRate}%`} icon={Activity} description="Accepted vs Draft ratio." />
            <KpiCard title="Secured Retainers" value={kpiData.totalAccepted.toString()} icon={ShieldCheck} description="Total projects locked." colorClass="text-green-600" />
        </div>
        
        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden">
          <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
            <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight text-left">Active Matrix</CardTitle>
            <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 text-left">Audit trail of all studio proposals.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
                <div className="flex flex-col items-center justify-center p-24 gap-4">
                    <Loader className="animate-spin h-8 w-8 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Ledger...</p>
                </div>
            ) : quotes && quotes.length > 0 ? (
              <>
                <div className="hidden md:block overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-muted/10 border-b-2">
                            <TableRow>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] p-6 text-slate-900">Project Label</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Deployment Date</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Value</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Status</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] pr-10 text-slate-900">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedQuotes.map(quote => {
                                const totalValue = quote.lineItems.reduce((acc, i) => acc + (i.price * i.quantity), 0) + quote.travelExpenses;
                                return (
                                    <TableRow key={quote.id} className="group hover:bg-primary/[0.02] transition-colors border-b text-left">
                                        <TableCell className="p-6">
                                            <p className="font-black uppercase tracking-tight text-xs md:text-sm text-slate-900">{quote.eventName}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">ID: #{quote.id.slice(-6).toUpperCase()}</p>
                                        </TableCell>
                                        <TableCell className="font-black text-[10px] uppercase text-slate-600">
                                            {quote.eventDate ? format(parseISO(quote.eventDate), 'MMM d, yyyy') : 'TBD'}
                                        </TableCell>
                                        <TableCell className="font-black font-mono text-sm text-slate-700">${totalValue.toFixed(2)}</TableCell>
                                        <TableCell>
                                            <Badge variant={quote.status === 'accepted' ? 'default' : quote.status === 'booked' ? 'outline' : 'secondary'} className={cn("h-5 px-2 font-black text-[8px] uppercase border-none shadow-sm", quote.status === 'booked' && "bg-green-500 text-white")}>
                                                {quote.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-10">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="rounded-xl hover:bg-primary/5"><MoreHorizontal className="h-4 w-4" /></Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
                                                    <DropdownMenuItem asChild className="font-bold text-[10px] uppercase tracking-widest">
                                                        <Link href={`/quotes/${quote.id}`}>
                                                            <Eye className="mr-2 h-3.5 w-3.5 opacity-40"/>
                                                            View Details
                                                        </Link>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => {}} disabled={quote.status !== 'accepted'} className="font-bold text-[10px] uppercase text-primary">
                                                        <CheckCircle className="mr-2 h-3.5 w-3.5 opacity-40"/>
                                                        <span>Finalize & Book</span>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase" onClick={() => handleDeleteClick(quote.id)}>
                                                        <Trash2 className="mr-2 h-3.5 w-3.5 opacity-40"/>
                                                        Terminate
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
                <div className="md:hidden space-y-4 p-5">
                    {sortedQuotes.map(quote => (
                        <QuoteCard key={quote.id} quote={quote} onBookEvent={() => {}} onDelete={handleDeleteClick} />
                    ))}
                </div>
              </>
            ) : (
              <div className="text-center py-24 md:py-32 px-6 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-6">
                <div className="p-6 bg-muted rounded-[2rem] shadow-inner"><FileText className="h-16 w-16 text-muted-foreground" /></div>
                <div className="space-y-2 text-center">
                    <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Ledger Empty</h3>
                    <p className="text-sm font-bold uppercase tracking-tight max-w-sm mx-auto text-muted-foreground">
                        No active project proposals. Create a strategic quote to secure high-value events.
                    </p>
                </div>
                <Button size="lg" asChild className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 mt-4">
                    <Link href="/quotes/new">Create First Proposal</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!quoteToDeleteId} onOpenChange={() => setQuoteToDeleteId(null)}>
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
            <AlertDialogHeader className="p-6 pb-0">
                <AlertDialogTitle className="text-2xl font-black uppercase tracking-tighter">Terminate Protocol</AlertDialogTitle>
                <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed uppercase">
                    You are about to permanently delete this proposal. This will purge all associated yield projections and logistics details. <strong>This action is non-reversible.</strong>
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3 text-left">
                <Button onClick={confirmDelete} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 bg-destructive text-destructive-foreground hover:bg-destructive/90">Purge Record</Button>
                <AlertDialogCancel onClick={() => setQuoteToDeleteId(null)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-transparent">Abort</AlertDialogCancel>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
