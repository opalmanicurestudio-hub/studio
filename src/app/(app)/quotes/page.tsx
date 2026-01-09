
'use client';

import React from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { clients, quotes, type Quote } from '@/lib/data';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const kpiData = {
  acceptedValue: 2150.0,
  conversionRate: 66.7,
  avgQuoteValue: 1762.5,
  awaitingResponse: 1,
};

const statusConfig: {
  [key in Quote['status']]: {
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

const QuoteTableRow = ({ quote }: { quote: Quote }) => {
  const client = clients.find((c) => c.id === quote.clientId);
  const statusInfo = statusConfig[quote.status];

  // By using parseISO, we treat the date string as UTC, avoiding timezone shifts.
  const quoteDate = parseISO(quote.date);

  return (
    <TableRow>
      <TableCell className="font-medium">{quote.quoteNumber}</TableCell>
      <TableCell>{client?.name || 'N/A'}</TableCell>
      <TableCell>{quote.eventName}</TableCell>
      <TableCell>{format(quoteDate, 'MMM d, yyyy')}</TableCell>
      <TableCell>
        <Badge variant="secondary" className={cn('capitalize', statusInfo.className)}>
          {statusInfo.label}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono">${quote.total.toFixed(2)}</TableCell>
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
              <FileText />
              <span>View/Edit</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Printer />
              <span>Print Quote</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileStack />
              <span>Create Invoice & Book</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">
              <Trash2 />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const QuoteCard = ({ quote }: { quote: Quote }) => {
    const client = clients.find((c) => c.id === quote.clientId);
    const statusInfo = statusConfig[quote.status];

    return (
        <Card>
            <CardContent className="p-4 space-y-4">
                 <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                        <p className="font-semibold">{quote.eventName}</p>
                        <p className="text-sm text-muted-foreground">{client?.name || 'N/A'} &middot; {quote.quoteNumber}</p>
                    </div>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className='-mt-2'>
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
                            <DropdownMenuItem>
                              <FileStack className="mr-2 h-4 w-4"/>
                              <span>Create Invoice & Book</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">
                              <Trash2 className="mr-2 h-4 w-4"/>
                              <span>Delete</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="flex items-center justify-between text-sm">
                    <Badge variant="secondary" className={cn('capitalize', statusInfo.className)}>{statusInfo.label}</Badge>
                    <span className="font-semibold text-lg">${quote.total.toFixed(2)}</span>
                </div>
            </CardContent>
        </Card>
    )
}

export default function QuotesPage() {
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
              <PlusCircle className="mr-2" /> Create New Quote
            </Link>
          </Button>
        </div>

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
              <div className="text-2xl font-bold">{kpiData.conversionRate}%</div>
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

        <Card>
            <CardHeader>
                <CardTitle>All Quotes</CardTitle>
                <CardDescription>A list of all project proposals you've created.</CardDescription>
            </CardHeader>
            <CardContent>
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
                        {quotes.map((quote) => (
                            <QuoteTableRow key={quote.id} quote={quote} />
                        ))}
                    </TableBody>
                    </Table>
                </div>
                 <div className="grid gap-4 md:hidden">
                    {quotes.map((quote) => (
                        <QuoteCard key={quote.id} quote={quote} />
                    ))}
                 </div>
            </CardContent>
        </Card>
      </main>
    </div>
  );
}
