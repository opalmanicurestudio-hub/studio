
'use client';

import React, { useMemo, useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  MoreHorizontal,
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
import { useFirebase, useCollection, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';

const statusConfig: {
  [key in QuoteType['status']]: {
    label: string;
    className: string;
  };
} = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300' },
  sent: { label: 'Sent', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' },
  accepted: { label: 'Accepted', className: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300' },
  booked: { label: 'Booked', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300' },
};

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
    <TableRow>
      <TableCell className="font-medium">{quote.id.slice(-6).toUpperCase()}</TableCell>
      <TableCell>{client?.name || 'N/A'}</TableCell>
      <TableCell>{quote.eventName}</TableCell>
      <TableCell>{format(quoteDate, 'MMM d, yyyy')}</TableCell>
      <TableCell>
        <Badge variant="secondary" className={cn('capitalize', statusInfo.className)}>
          {statusInfo.label}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono">${total.toFixed(2)}</TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <FileText className="mr-2 h-4 w-4"/>
              <span>View/Edit</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Printer className="mr-2 h-4 w-4"/>
              <span>Print Quote</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Mark as...</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'sent')}>Sent</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'accepted')}>Accepted</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'declined')}>Declined</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onBookEvent(quote)} disabled={quote.status !== 'accepted'}>
              <FileStack className="mr-2 h-4 w-4"/>
              <span>Book</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4"/>
              <span>Delete</span>
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
        <Card>
            <CardContent className="p-4 space-y-4">
                 <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1 min-w-0">
                        <p className="font-semibold truncate">{quote.eventName}</p>
                        <p className="text-sm text-muted-foreground">{client?.name || 'N/A'} &middot; {quote.id.slice(-6).toUpperCase()}</p>
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className='-mt-2 -mr-2'>
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <FileText className="mr-2 h-4 w-4"/>
                              <span>View/Edit</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                               <Printer className="mr-2 h-4 w-4"/>
                              <span>Print Quote</span>
                            </DropdownMenuItem>
                             <DropdownMenuSeparator />
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>Mark as...</DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                    <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'sent')}>Sent</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'accepted')}>Accepted</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onStatusChange(quote.id, 'declined')}>Declined</DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                             <DropdownMenuItem onClick={() => onBookEvent(quote)} disabled={quote.status !== 'accepted'}>
                              <FileStack className="mr-2 h-4 w-4"/>
                              <span>Book</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive">
                              <Trash2 className="mr-2 h-4 w-4"/>
                              <span>Delete</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="flex items-center justify-between text-sm">
                    <Badge variant="secondary" className={cn('capitalize', statusInfo.className)}>{statusInfo.label}</Badge>
                    <span className="font-semibold text-lg">${total.toFixed(2)}</span>
                </div>
            </CardContent>
        </Card>
    )
}

const KpiCards = ({ kpiData }: { kpiData: any }) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Accepted Value</CardTitle>
                <FileCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">${kpiData.acceptedValue.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Total from accepted quotes</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
                <Percent className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{kpiData.conversionRate.toFixed(0)}%</div>
                <p className="text-xs text-muted-foreground">Of sent quotes are accepted</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg. Quote Value</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">${kpiData.avgQuoteValue.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Average of all sent quotes</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Awaiting Response</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{kpiData.awaitingResponse}</div>
                <p className="text-xs text-muted-foreground">Quotes waiting for client review</p>
            </CardContent>
        </Card>
    </div>
);


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
        toast({ title: "Status Updated", description: `Quote status changed to ${status}.` });
    };
    
    const handleBookEvent = async (quote: QuoteType) => {
        if (!firestore || !tenantId) return;

        const eventRef = collection(firestore, 'tenants', tenantId, 'events');
        
        const newEvent = {
            title: quote.eventName,
            type: 'business',
            startTime: parseISO(quote.eventDate),
            endTime: parseISO(quote.eventDate),
            location: quote.eventLocation,
            notes: `Booked from Quote #${quote.id.slice(-6).toUpperCase()}. \n\n${quote.notes}`,
            quoteId: quote.id
        }

        await addDocumentNonBlocking(eventRef, newEvent);
        handleStatusChange(quote.id, 'booked');

        toast({
            title: "Event Booked!",
            description: `"${quote.eventName}" has been added to your planner.`,
        });
        
        router.push('/planner');
    }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Quotes" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Quotes</h1>
            <p className="text-muted-foreground">
              Create, manage, and analyze project proposals.
            </p>
          </div>
          <Button asChild>
            <Link href="/quotes/new">
              <PlusCircle className="mr-2 h-4 w-4" /> Create New Quote
            </Link>
          </Button>
        </div>

        {isMobile ? (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="w-full">
                <BarChart className="mr-2 h-4 w-4" /> View KPIs
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[75vh]">
                <SheetHeader>
                    <SheetTitle>Quote KPIs</SheetTitle>
                </SheetHeader>
                <div className="py-4">
                     <KpiCards kpiData={kpiData} />
                </div>
            </SheetContent>
          </Sheet>
        ) : (
          <KpiCards kpiData={kpiData} />
        )}

        <Card>
            <CardHeader>
                <CardTitle>All Quotes</CardTitle>
                <CardDescription>A list of all project proposals you've created.</CardDescription>
            </CardHeader>
            <CardContent>
                {(isLoading || isInventoryLoading) && <p>Loading quotes...</p>}
                {!(isLoading || isInventoryLoading) && (
                    <>
                        <div className="hidden md:block">
                            <Table>
                            <TableHeader>
                                <TableRow>
                                <TableHead>Quote #</TableHead>
                                <TableHead>Client</TableHead>
                                <TableHead>Event</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead>
                                    <span className="sr-only">Actions</span>
                                </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedQuotes.map((quote) => (
                                    <QuoteTableRow key={quote.id} quote={quote} clients={clients || []} onStatusChange={handleStatusChange} onBookEvent={handleBookEvent}/>
                                ))}
                            </TableBody>
                            </Table>
                        </div>
                        <div className="grid gap-4 md:hidden">
                            {sortedQuotes.map((quote) => (
                                <QuoteCard key={quote.id} quote={quote} clients={clients || []} onStatusChange={handleStatusChange} onBookEvent={handleBookEvent} />
                            ))}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
      </main>
    </div>
  );
}
