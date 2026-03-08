
'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { 
    PlusCircle, 
    TrendingUp, 
    FileCheck, 
    Percent, 
    Clock, 
    FileText, 
    Printer, 
    FileStack, 
    Trash2, 
    BarChart, 
    Loader, 
    DollarSign, 
    Target, 
    Activity, 
    ArrowRight, 
    Hash, 
    Sparkles,
    MoreHorizontal
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { type Quote as QuoteType, type Client } from '@/lib/data';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion, AnimatePresence } from 'framer-motion';

const statusConfig: {
  [key in QuoteType['status']]: {
    label: string;
    className: string;
  };
} = {
  draft: { label: 'DRAFT', className: 'bg-muted text-muted-foreground border-transparent' },
  sent: { label: 'DISPATCHED', className: 'bg-blue-500/10 text-blue-700 border-blue-200' },
  accepted: { label: 'ACCEPTED', className: 'bg-green-500/10 text-green-700 border-green-200 shadow-sm' },
  declined: { label: 'DECLINED', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  booked: { label: 'COMMITTED', className: 'bg-primary text-white border-none shadow-lg' },
};

const KpiCard = ({ title, value, icon: Icon, description, colorClass }: { title: string, value: string, icon: any, description: string, colorClass?: string }) => (
    <Card className="border-2 shadow-sm min-w-0 text-left bg-white/50 backdrop-blur-sm">
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

const QuoteTableRow = ({ quote, clients, onStatusChange, onBookEvent }: { quote: QuoteType, clients: Client[], onStatusChange: (id: string, status: QuoteType['status']) => void, onBookEvent: (quote: QuoteType) => void }) => {
  const client = clients.find((c) => c.id === quote.clientId);
  const statusInfo = statusConfig[quote.status];
  const quoteDate = quote.eventDate ? parseISO(quote.eventDate) : parseISO(quote.createdAt);

  const total = useMemo(() => {
    const servicesTotal = quote.lineItems.reduce((acc, item) => acc + (item.price || 0), 0);
    const fee = servicesTotal * (quote.projectFee / 100);
    return servicesTotal + quote.travelExpenses + fee;
  }, [quote]);

  return (
    <TableRow className="group hover:bg-primary/[0.02] transition-colors border-b">
      <TableCell className="p-6">
        <div className="flex items-center gap-3">
            <div className="p-2.5 bg-muted/30 rounded-xl border shadow-inner shrink-0">
                <Hash className="w-3.5 h-3.5 text-muted-foreground opacity-40" />
            </div>
            <span className="font-black font-mono text-xs text-slate-900">{quote.id.slice(-6).toUpperCase()}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 border-2 border-background shadow-sm rounded-xl">
                <AvatarImage src={client?.avatarUrl} className="object-cover" />
                <AvatarFallback className="font-black text-[10px] bg-primary/10 text-primary">{(client?.name || 'G').charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="font-black uppercase tracking-tight text-xs text-slate-700">{client?.name || 'Guest'}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="max-w-[200px] truncate">
            <p className="font-black uppercase tracking-tight text-xs text-slate-900">{quote.eventName}</p>
            <p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">Strategic Proposal</p>
        </div>
      </TableCell>
      <TableCell className="text-[10px] font-black uppercase text-muted-foreground opacity-70">
        {format(quoteDate, 'MMM d, yyyy')}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn('h-6 px-2.5 rounded-lg border-2 font-black text-[8px] uppercase tracking-widest bg-white shadow-sm', statusInfo.className)}>
          {statusInfo.label}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <span className="font-black font-mono text-sm md:text-base tracking-tighter text-slate-900">${total.toFixed(2)}</span>
      </TableCell>
      <TableCell className="text-right pr-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost" className="rounded-xl hover:bg-primary/5 transition-all">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
            <DropdownMenuItem className="font-bold text-[10px] uppercase tracking-widest">
              <FileText className="mr-2 h-3.5 w-3.5 opacity-40"/>
              <span>View/Edit</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="font-bold text-[10px] uppercase tracking-widest">
              <Printer className="mr-2 h-3.5 w-3.5 opacity-40"/>
              <span>Print Quote</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="font-bold text-[10px] uppercase tracking-widest">Mark as...</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="rounded-xl border-2 shadow-2xl p-1">
                  <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'sent')} className="font-bold text-[10px] uppercase">Sent</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'accepted')} className="font-bold text-[10px] uppercase">Accepted</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'declined')} className="font-bold text-[10px] uppercase text-destructive">Declined</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onBookEvent(quote)} disabled={quote.status !== 'accepted'} className="font-bold text-[10px] uppercase tracking-widest text-primary">
              <FileStack className="mr-2 h-3.5 w-3.5"/>
              <span>Finalize & Book</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase tracking-widest">
              <Trash2 className="mr-2 h-3.5 w-3.5"/>
              <span>Terminate</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const QuoteCard = ({ quote, clients, onStatusChange, onBookEvent }: { quote: QuoteType, clients: Client[], onStatusChange: (id: string, status: QuoteType['status']) => void, onBookEvent: (quote: QuoteType) => void }) => {
    const client = clients.find((c) => c.id === quote.clientId);
    const statusInfo = statusConfig[quote.status];

    const total = useMemo(() => {
        const servicesTotal = quote.lineItems.reduce((acc, item) => acc + (item.price || 0), 0);
        const fee = servicesTotal * (quote.projectFee / 100);
        return servicesTotal + quote.travelExpenses + fee;
    }, [quote]);

    return (
        <Card className="border-2 shadow-sm rounded-[1.5rem] overflow-hidden group bg-white">
            <CardContent className="p-5 space-y-4">
                 <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1 min-w-0 text-left">
                        <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{quote.eventName}</p>
                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-60 truncate">
                            {client?.name || 'N/A'} &middot; #{quote.id.slice(-6).toUpperCase()}
                        </p>
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className='-mt-1 -mr-2 rounded-lg'>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2 p-1">
                            <DropdownMenuItem className="font-bold text-[10px] uppercase">View/Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onBookEvent(quote)} disabled={quote.status !== 'accepted'} className="font-bold text-[10px] uppercase text-primary">Finalize & Book</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive font-bold text-[10px] uppercase">Terminate</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-xl bg-muted/20 border shadow-inner">
                        <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-0.5">Investment</p>
                        <p className="font-black font-mono text-sm tracking-tighter text-slate-900">${total.toFixed(2)}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-primary/[0.03] border border-primary/5 shadow-inner text-right">
                        <p className="text-[8px] font-black uppercase text-primary/40 mb-0.5">Status</p>
                        <Badge variant="outline" className={cn("h-5 px-2 font-black text-[8px] uppercase border-2 bg-white", statusInfo.className)}>{statusInfo.label}</Badge>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export default function QuotesPage() {
    const { firestore, user } = useFirebase();
    const { clients, isLoading: isInventoryLoading } = useInventory();
    const { toast } = useToast();
    const router = useRouter();
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id;
    const isMobile = useIsMobile();
    
    const quotesQuery = useMemoFirebase(() => {
        if (!user || !firestore || !tenantId) return null;
        return collection(firestore, 'tenants', tenantId, 'quotes');
    }, [user, firestore, tenantId]);
    
    const { data: quotes, isLoading } = useCollection<QuoteType>(quotesQuery);
    
    const sortedQuotes = useMemo(() => {
        if (!quotes) return [];
        return [...quotes].sort((a,b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
    }, [quotes]);
    
    const kpiData = useMemo(() => {
        if (!quotes) return { acceptedValue: 0, conversionRate: 0, avgQuoteValue: 0, awaitingResponse: 0 };
        
        const sentOrBeyond = quotes.filter(q => q.status !== 'draft');
        const accepted = quotes.filter(q => q.status === 'accepted' || q.status === 'booked');
        
        const acceptedValue = accepted.reduce((acc, q) => {
            const servicesTotal = q.lineItems.reduce((sAcc, item) => sAcc + (item.price || 0), 0);
            const fee = servicesTotal * (q.projectFee / 100);
            return acc + servicesTotal + q.travelExpenses + fee;
        }, 0);
        
        const totalValue = sentOrBeyond.reduce((acc, q) => {
             const servicesTotal = q.lineItems.reduce((sAcc, item) => sAcc + (item.price || 0), 0);
            const fee = servicesTotal * (q.projectFee / 100);
            return acc + servicesTotal + q.travelExpenses + fee;
        }, 0);

        return {
            acceptedValue,
            conversionRate: sentOrBeyond.length > 0 ? (accepted.length / sentOrBeyond.length) * 100 : 0,
            avgQuoteValue: sentOrBeyond.length > 0 ? totalValue / sentOrBeyond.length : 0,
            awaitingResponse: quotes.filter(q => q.status === 'sent').length
        }

    }, [quotes]);

    const handleStatusChange = (id: string, status: QuoteType['status']) => {
        if (!firestore || !tenantId) return;
        const quoteRef = doc(firestore, 'tenants', tenantId, 'quotes', id);
        updateDocumentNonBlocking(quoteRef, { status });
        toast({ title: "Status Synchronized", description: `Quote status updated to ${status.toUpperCase()}.` });
    };
    
    const handleBookEvent = async (quote: QuoteType) => {
        if (!firestore || !tenantId) return;

        const eventRef = collection(firestore, 'tenants', tenantId, 'events');
        
        const newEvent = {
            title: quote.eventName,
            type: 'business',
            startTime: quote.eventDate || new Date().toISOString(),
            endTime: quote.eventDate || new Date().toISOString(),
            location: typeof quote.eventLocation === 'string' ? quote.eventLocation : (quote.eventLocation?.street ? `${quote.eventLocation.street}, ${quote.eventLocation.city}` : 'Client Site'),
            notes: `Booked from Quote #${quote.id.slice(-6).toUpperCase()}. \n\n${quote.notes || ''}`,
            quoteId: quote.id
        }

        await addDocumentNonBlocking(eventRef, newEvent);
        handleStatusChange(quote.id, 'booked');

        toast({
            title: "Project Secured!",
            description: `"${quote.eventName}" has been locked into the planner.`,
        });
        
        router.push('/planner');
    }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Project Invoicing" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-8 md:space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1 text-left">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Quote Ledger</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Project proposals & secured yields
            </p>
          </div>
          <Button asChild className="h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20 w-full md:w-auto">
            <Link href="/quotes/new">
              <PlusCircle className="mr-2 h-4 w-4" /> Initiate New Quote
            </Link>
          </Button>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard title="Secured Pipeline" value={`$${kpiData.acceptedValue.toFixed(0)}`} icon={FileCheck} description="Yield from accepted quotes" colorClass="text-green-600" />
                <KpiCard title="Engagement Delta" value={`${kpiData.conversionRate.toFixed(0)}%`} icon={Percent} description="Acceptance velocity" />
                <KpiCard title="Average Ticket" value={`$${kpiData.avgQuoteValue.toFixed(0)}`} icon={TrendingUp} description="Mean proposal value" colorClass="text-primary" />
                <KpiCard title="Awaiting Response" value={kpiData.awaitingResponse.toString()} icon={Clock} description="Pending client review" />
            </div>
        </motion.div>

        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white/80 backdrop-blur-xl">
            <CardHeader className="bg-muted/5 border-b p-6 md:p-8 flex flex-row items-center justify-between">
                <div className="space-y-1 text-left">
                    <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight">Audit Trail</CardTitle>
                    <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Historical project proposals.</CardDescription>
                </div>
                <div className="hidden sm:flex items-center gap-2 p-2 bg-primary/5 rounded-full border border-primary/10">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-black uppercase text-primary tracking-widest px-2">Secure Ledger</span>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {(isLoading || isInventoryLoading) ? (
                    <div className="flex flex-col items-center justify-center p-24 gap-4">
                        <Loader className="animate-spin h-8 w-8 text-primary" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Archive...</p>
                    </div>
                ) : sortedQuotes.length > 0 ? (
                    <>
                        <div className="hidden md:block overflow-x-auto">
                            <Table>
                            <TableHeader className="bg-muted/10 border-b-2">
                                <TableRow>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] p-6 text-slate-900">Logic ID</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Entity</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Project Label</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Timestamp</TableHead>
                                <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Logic Status</TableHead>
                                <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] text-primary">Yield</TableHead>
                                <TableHead className="text-right pr-10 font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedQuotes.map((quote) => (
                                    <QuoteTableRow key={quote.id} quote={quote} clients={clients || []} onStatusChange={handleStatusChange} onBookEvent={handleBookEvent}/>
                                ))}
                            </TableBody>
                            </Table>
                        </div>
                        <div className="grid gap-4 md:hidden p-5">
                            {sortedQuotes.map((quote) => (
                                <QuoteCard key={quote.id} quote={quote} clients={clients || []} onStatusChange={handleStatusChange} onBookEvent={handleBookEvent} />
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="text-center py-24 md:py-32 px-6 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-6 m-8">
                        <div className="p-6 bg-muted rounded-[2rem] shadow-inner"><FileText className="h-16 w-16 text-muted-foreground" /></div>
                        <div className="space-y-2 text-center">
                            <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Manifest Clear</h3>
                            <p className="text-sm font-bold uppercase tracking-tight max-w-sm mx-auto">
                                No active project proposals in the archive. Initiate a new quote to start tracking project yields.
                            </p>
                        </div>
                        <Button size="lg" asChild className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 mt-4">
                            <Link href="/quotes/new">Create First Quote</Link>
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
      </main>
    </div>
  );
}
