

'use client';

import React, { useState, useMemo, useCallback } from 'react';
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
  CreditCard,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { format, startOfDay, endOfDay } from 'date-fns';
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
import { useCollection, useFirebase, useMemoFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { AddTransactionDialog } from '@/components/ledger/AddTransactionDialog';
import { useToast } from '@/hooks/use-toast';
import { transactions as mockTransactions } from '@/lib/financial-data';


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

const TransactionFilters = ({ 
    transactions,
    date, 
    setDate,
    searchTerm,
    setSearchTerm,
    contextFilter,
    setContextFilter,
    categoryFilter,
    setCategoryFilter,
    financialSummary,
}: { 
    transactions: Transaction[];
    date: DateRange | undefined;
    setDate: (date: DateRange | undefined) => void;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    contextFilter: 'all' | 'Business' | 'Personal';
    setContextFilter: (context: 'all' | 'Business' | 'Personal') => void;
    categoryFilter: string;
    setCategoryFilter: (category: string) => void;
    financialSummary: { revenue: number, expenses: number, net: number };
 }) => {
    
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

        <Accordion type="single" collapsible defaultValue="summary">
            <AccordionItem value="summary" className='border-0'>
                <AccordionTrigger className='p-3 text-sm font-medium hover:no-underline rounded-md bg-muted/50'>Financial Summary</AccordionTrigger>
                <AccordionContent className='p-4 text-sm'>
                    <div className='space-y-2'>
                        <div className='flex justify-between'><span>Total Revenue:</span><span className='font-medium text-green-500'>${financialSummary.revenue.toFixed(2)}</span></div>
                        <div className='flex justify-between'><span>Operating Expenses:</span><span className='font-medium text-red-500'>${financialSummary.expenses.toFixed(2)}</span></div>
                        <div className='flex justify-between'><span>Net Income:</span><span className='font-bold text-primary'>${financialSummary.net.toFixed(2)}</span></div>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>

        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search description..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <RadioGroup value={contextFilter} onValueChange={(v: any) => setContextFilter(v)} className="grid grid-cols-3 gap-2">
                <div>
                    <RadioGroupItem value="all" id="all" className="peer sr-only" />
                    <Label htmlFor="all" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">All</Label>
                </div>
                <div>
                    <RadioGroupItem value="Business" id="business" className="peer sr-only" />
                    <Label htmlFor="business" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Business</Label>
                </div>
                <div>
                    <RadioGroupItem value="Personal" id="personal" className="peer sr-only" />
                    <Label htmlFor="personal" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">Personal</Label>
                </div>
            </RadioGroup>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                    <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
      </CardContent>
    </Card>
  );
};

const TransactionRow = ({ transaction, onRevertClick }: { transaction: Transaction, onRevertClick: (transaction: Transaction) => void }) => {
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
      <TableCell>
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-muted-foreground"/>
            <span>{transaction.paymentMethod} {transaction.paymentMethodIdentifier && `(${transaction.paymentMethodIdentifier})`}</span>
          </div>
      </TableCell>
      <TableCell>{transaction.category}</TableCell>
      <TableCell className="text-right">
        <div className='flex items-center justify-end gap-2'>
            {transaction.hasReceipt && <Paperclip className="h-4 w-4 text-muted-foreground" />}
            <span className={cn('font-mono', {
                'text-green-600 dark:text-green-400': transaction.type === 'income',
                'text-red-600 dark:text-red-400': transaction.type === 'expense',
                 'text-blue-600 dark:text-blue-400': transaction.type === 'payment',
                 'text-gray-500 dark:text-gray-400': transaction.type === 'reversal',
            })}>
                {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : transaction.type === 'reversal' ? '' : '+'}${transaction.amount.toFixed(2)}
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
            <DropdownMenuItem onClick={() => onRevertClick(transaction)} disabled={transaction.type === 'reversal'}>Revert</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const TransactionCard = ({ transaction, onRevertClick }: { transaction: Transaction, onRevertClick: (transaction: Transaction) => void }) => {
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
                            'text-gray-500 dark:text-gray-400': transaction.type === 'reversal',
                        })}>
                           {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : transaction.type === 'reversal' ? '' : '+'}${transaction.amount.toFixed(2)}
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
                            <DropdownMenuItem onClick={() => onRevertClick(transaction)} disabled={transaction.type === 'reversal'}>Revert</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                 <div className="flex items-center text-sm text-muted-foreground pt-2 border-t mt-4">
                    <CreditCard className="w-4 h-4 mr-2"/> Paid with {transaction.paymentMethod} {transaction.paymentMethodIdentifier && `(${transaction.paymentMethodIdentifier})`}
                </div>
            </CardContent>
        </Card>
    );
};

export default function LedgerPage() {
  const { firestore, user, isUserLoading } = useFirebase();
  const tenantId = 'tenant-abc';
  const { toast } = useToast();

  const [date, setDate] = React.useState<DateRange | undefined>({
      from: new Date(new Date().getFullYear(), 0, 1),
      to: new Date(),
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | 'Business' | 'Personal'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAddTxnOpen, setIsAddTxnOpen] = useState(false);

  const transactionsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) {
      return null;
    }
    return collection(firestore, 'tenants', tenantId, 'transactions');
  }, [firestore, user, isUserLoading, tenantId]);

  const { data: fetchedTransactions, isLoading: areTransactionsLoading } = useCollection<Transaction>(transactionsQuery);

  const transactions = useMemo(() => (fetchedTransactions && fetchedTransactions.length > 0) ? fetchedTransactions : mockTransactions, [fetchedTransactions]);


  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];

    return transactions
        .filter(t => {
            const transactionDate = new Date(t.date);
            const from = date?.from ? startOfDay(date.from) : null;
            const to = date?.to ? endOfDay(date.to) : null;

            if (from && transactionDate < from) return false;
            if (to && transactionDate > to) return false;
            if (searchTerm && !(t.description.toLowerCase().includes(searchTerm.toLowerCase()) || t.clientOrVendor.toLowerCase().includes(searchTerm.toLowerCase()))) return false;
            if (contextFilter !== 'all' && t.context !== contextFilter) return false;
            if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;

            return true;
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, date, searchTerm, contextFilter, categoryFilter]);
  
  const financialSummary = useMemo(() => {
    const revenue = filteredTransactions
      .filter(t => t.type === 'income')
      .reduce((acc, t) => acc + t.amount, 0);
    const expenses = filteredTransactions
      .filter(t => t.type === 'expense' || t.type === 'payment')
      .reduce((acc, t) => acc + t.amount, 0);
    return { revenue, expenses, net: revenue - expenses };
  }, [filteredTransactions]);

  const addTransaction = (data: Omit<Transaction, 'id'>) => {
    if (!firestore) return;
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
    addDocumentNonBlocking(transactionsRef, data);
    toast({
        title: 'Transaction Logged',
        description: `Your transaction for $${data.amount.toFixed(2)} has been recorded.`
    })
  }
  
  const handleAddTransaction = (data: Omit<Transaction, 'id'>) => {
    addTransaction(data);
    setIsAddTxnOpen(false);
  }
  
  const handleRevertTransaction = (transaction: Transaction) => {
    if (transaction.type === 'reversal' || transaction.reversalOf) {
        toast({ variant: 'destructive', title: "Cannot revert a reversal."});
        return;
    }

    const reversalTransaction: Omit<Transaction, 'id'> = {
      ...transaction,
      date: new Date().toISOString(),
      description: `Reversal of: ${transaction.description}`,
      type: 'reversal',
      amount: -transaction.amount,
      reversalOf: transaction.id,
    };
    addTransaction(reversalTransaction);
    toast({ title: 'Transaction Reverted', description: 'A reversal transaction has been created.' });
  }
  
  const isLoading = areTransactionsLoading;

  return (
    <>
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Ledger" />
      <main className="flex-1 p-4 md:p-8">
        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8">
          <div className="md:col-span-1 lg:col-span-1">
            <TransactionFilters 
                transactions={transactions || []}
                date={date}
                setDate={setDate}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                contextFilter={contextFilter}
                setContextFilter={setContextFilter}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                financialSummary={financialSummary}
            />
          </div>
          <div className="md:col-span-2 lg:col-span-3 space-y-4">
            <div className="flex items-center justify-end">
                <Button onClick={() => setIsAddTxnOpen(true)}><PlusCircle className='mr-2' /> Add Transaction</Button>
            </div>
            <Card className="hidden md:block">
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead><span className='sr-only'>Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                        <TableRow>
                            <TableCell colSpan={7} className="h-24 text-center">{isUserLoading ? 'Authenticating user...' : 'Loading transactions...'}</TableCell>
                        </TableRow>
                    )}
                    {!isLoading && filteredTransactions.map((transaction) => (
                      <TransactionRow key={transaction.id} transaction={transaction} onRevertClick={handleRevertTransaction} />
                    ))}
                     {!isLoading && filteredTransactions.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={7} className="h-24 text-center">No transactions found matching your filters.</TableCell>
                        </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="md:hidden space-y-4">
                 {isLoading && <p className="text-center text-muted-foreground">{isUserLoading ? 'Authenticating user...' : 'Loading transactions...'}</p>}
                 {!isLoading && filteredTransactions.length > 0 ? filteredTransactions.map((transaction) => (
                    <TransactionCard key={transaction.id} transaction={transaction} onRevertClick={handleRevertTransaction} />
                 )) : !isLoading && <p className="text-center text-muted-foreground py-10">No transactions found matching your filters.</p>}
            </div>
          </div>
        </div>
      </main>
    </div>

    <AddTransactionDialog 
        open={isAddTxnOpen}
        onOpenChange={setIsAddTxnOpen}
        onConfirm={handleAddTransaction}
    />
    </>
  );
}
