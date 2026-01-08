'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  MoreHorizontal,
  PlusCircle,
  Search,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Paperclip,
  Calendar as CalendarIcon,
  BookOpen,
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
import { type Transaction } from '@/lib/financial-data';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';

const TransactionIcon = ({ type }: { type: Transaction['type'] }) => {
  const iconClass = "h-5 w-5";
  switch (type) {
    case 'income':
      return <TrendingUp className={cn(iconClass, "text-green-500")} />;
    case 'expense':
      return <TrendingDown className={cn(iconClass, "text-red-500")} />;
    case 'payment':
        return <BookOpen className={cn(iconClass, "text-blue-500")} />;
    case 'reversal':
      return <RefreshCw className={cn(iconClass, "text-gray-500")} />;
    default:
      return null;
  }
};

const TransactionFilters = ({ transactions }: { transactions: Transaction[] }) => {
    const [date, setDate] = React.useState<DateRange | undefined>({
        from: new Date(2024, 0, 20),
        to: new Date(),
    });
    
    const categories = useMemo(() => {
        if (!transactions) return [];
        const allCategories = transactions.map(t => t.category);
        return [...new Set(allCategories)];
    }, [transactions]);

  return (
    <Card className="h-fit sticky top-20">
      <CardHeader>
        <CardTitle>Ledger</CardTitle>
        <CardDescription>The ledger for every dollar in and out.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
            <Label>Date range</Label>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                        "w-full justify-start text-left font-normal",
                        !date && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date?.from ? (
                        date.to ? (
                            <>
                            {format(date.from, "LLL dd, y")} -{" "}
                            {format(date.to, "LLL dd, y")}
                            </>
                        ) : (
                            format(date.from, "LLL dd, y")
                        )
                        ) : (
                        <span>Pick a date</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={date?.from}
                        selected={date}
                        onSelect={setDate}
                        numberOfMonths={2}
                    />
                </PopoverContent>
            </Popover>
        </div>

        <Accordion type="single" collapsible>
            <AccordionItem value="summary" className='border-0'>
                <AccordionTrigger className='p-3 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>Financial Summary</AccordionTrigger>
                <AccordionContent className='p-4 text-sm'>
                    <div className='space-y-2'>
                        <div className='flex justify-between'><span>Total Revenue:</span><span className='font-medium text-green-500'>$5,890.00</span></div>
                        <div className='flex justify-between'><span>Operating Expenses:</span><span className='font-medium text-red-500'>$1,234.50</span></div>
                        <div className='flex justify-between'><span>Net Income:</span><span className='font-bold text-primary'>$4,655.50</span></div>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>

        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search description..." className="pl-9" />
            </div>
            <RadioGroup defaultValue="all" className="grid grid-cols-3 gap-2">
                <div>
                    <RadioGroupItem value="all" id="all" className="peer sr-only" />
                    <Label htmlFor="all" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">All</Label>
                </div>
                <div>
                    <RadioGroupItem value="business" id="business" className="peer sr-only" />
                    <Label htmlFor="business" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label>
                </div>
                <div>
                    <RadioGroupItem value="personal" id="personal" className="peer sr-only" />
                    <Label htmlFor="personal" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label>
                </div>
            </RadioGroup>
            <Select>
                <SelectTrigger>
                    <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                    {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>

        <Button className='w-full'>Apply Filters</Button>
      </CardContent>
    </Card>
  );
};

const TransactionRow = ({ transaction }: { transaction: Transaction }) => {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <TransactionIcon type={transaction.type} />
          <div className='flex flex-col'>
            <span className="font-medium">{transaction.description}</span>
            <span className='text-xs text-muted-foreground'>{transaction.clientOrVendor}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>{format(new Date(transaction.date), 'MMM d, yyyy')}</TableCell>
      <TableCell>
        <Badge
          variant={transaction.context === 'Business' ? 'secondary' : 'outline'}
          className={cn({
            'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': transaction.context === 'Business',
            'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': transaction.context === 'Personal'
          })}
        >
          {transaction.context}
        </Badge>
      </TableCell>
      <TableCell>{transaction.category}</TableCell>
      <TableCell className="text-right">
        <div className='flex items-center justify-end gap-2'>
            {transaction.hasReceipt && <Paperclip className="h-4 w-4 text-muted-foreground" />}
            <span className={cn('font-mono', {
                'text-green-600 dark:text-green-400': transaction.type === 'income',
                'text-red-600 dark:text-red-400': transaction.type === 'expense',
                 'text-blue-600 dark:text-blue-400': transaction.type === 'payment',
            })}>
                {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : ''}${transaction.amount.toFixed(2)}
            </span>
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Revert</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const TransactionCard = ({ transaction }: { transaction: Transaction }) => {
    return (
        <Card>
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="p-2 bg-muted/50 rounded-full">
                        <TransactionIcon type={transaction.type} />
                    </div>
                    <div className="flex-1 space-y-1">
                        <p className="font-semibold">{transaction.description}</p>
                        <p className="text-sm text-muted-foreground">{transaction.clientOrVendor} &middot; {format(new Date(transaction.date), 'MMM d')}</p>
                    </div>
                    <div className='text-right'>
                        <p className={cn('font-bold font-mono text-lg', {
                            'text-green-600 dark:text-green-400': transaction.type === 'income',
                            'text-red-600 dark:text-red-400': transaction.type === 'expense',
                            'text-blue-600 dark:text-blue-400': transaction.type === 'payment',
                        })}>
                           {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : ''}${transaction.amount.toFixed(2)}
                        </p>
                        {transaction.hasReceipt && <Paperclip className="h-4 w-4 text-muted-foreground inline-block" />}
                    </div>
                </div>
                 <div className="flex items-center justify-between text-sm">
                    <div className='flex items-center gap-2'>
                        <Badge
                            variant={transaction.context === 'Business' ? 'secondary' : 'outline'}
                            className={cn({
                                'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': transaction.context === 'Business',
                                'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': transaction.context === 'Personal'
                            })}
                            >
                            {transaction.context}
                        </Badge>
                        <Badge variant="outline">{transaction.category}</Badge>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="sm" variant="ghost">
                                <MoreHorizontal className="h-4 w-4 mr-2" /> More
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem>Edit</DropdownMenuItem>
                            <DropdownMenuItem>Revert</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardContent>
        </Card>
    );
};

export default function LedgerPage() {
  const { firestore } = useFirebase();
  // TODO: Replace with dynamic tenant ID
  const tenantId = 'tenant-abc';

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return collection(firestore, 'tenants', tenantId, 'transactions');
  }, [firestore, tenantId]);

  const { data: transactions, isLoading } = useCollection<Transaction>(transactionsQuery);

  const sortedTransactions = useMemo(() => {
    if (!transactions) return [];
    return [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions]);


  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Ledger" />
      <main className="flex-1 p-4 md:p-8">
        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8">
          <div className="md:col-span-1 lg:col-span-1">
            <TransactionFilters transactions={sortedTransactions} />
          </div>
          <div className="md:col-span-2 lg:col-span-3 space-y-4">
            <div className="flex items-center justify-end">
                <Button><PlusCircle className='mr-2' /> Add Transaction</Button>
            </div>
            <Card className="hidden md:block">
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead><span className='sr-only'>Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center">Loading transactions...</TableCell>
                        </TableRow>
                    )}
                    {!isLoading && sortedTransactions.map((transaction) => (
                      <TransactionRow key={transaction.id} transaction={transaction} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="md:hidden space-y-4">
                 {isLoading && <p className="text-center text-muted-foreground">Loading transactions...</p>}
                 {!isLoading && sortedTransactions.map((transaction) => (
                    <TransactionCard key={transaction.id} transaction={transaction} />
                ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
