'use client';

import React, { useState, useMemo, useRef } from 'react';
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
  Printer,
  Filter,
  X,
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
import { type Staff } from '@/lib/data';
import { Badge } from '@/components/ui/badge';
import { format, startOfDay, endOfDay, parseISO, subDays } from 'date-fns';
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
import { useFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking, useUser } from '@/firebase';
import { AddTransactionDialog } from '@/components/ledger/AddTransactionDialog';
import { useToast } from '@/hooks/use-toast';
import { PrintableReport } from '@/components/ledger/PrintableReport';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { collection, doc } from 'firebase/firestore';
import { Separator } from '@/components/ui/separator';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        try {
            return parseISO(val);
        } catch {
            return new Date(val);
        }
    }
    if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
    }
    return new Date(val);
};

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
    financialSummary: { revenue: number, cogs: number, grossProfit: number, operatingExpenses: number, net: number };
 }) => {
    
    const categories = useMemo(() => {
        if (!transactions) return [];
        const allCategories = transactions.map(t => t.category);
        return [...new Set(allCategories)];
    }, [transactions]);

  return (
    <Card className="h-fit">
      <CardHeader className="hidden md:block">
        <CardTitle>Ledger Filters</CardTitle>
        <CardDescription>Filter your cash flow records.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6 md:pt-0">
        <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date range</Label>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant='outline' className='w-full h-11 justify-start text-left font-normal border-2'>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date?.from ? (
                        date.to ? (
                            <>{format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}</>
                        ) : (
                            format(date.from, "LLL dd, y")
                        )
                        ) : (
                        "Pick a date"
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

        <div className="space-y-4">
            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Search & Context</Label>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search description..." className="pl-9 h-11 border-2" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
            </div>
            <RadioGroup value={contextFilter} onValueChange={(v: any) => setContextFilter(v)} className="grid grid-cols-3 gap-2">
                <div>
                    <RadioGroupItem value="all" id="all" className="peer sr-only" />
                    <Label htmlFor="all" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[10px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">All</Label>
                </div>
                <div>
                    <RadioGroupItem value="Business" id="business" className="peer sr-only" />
                    <Label htmlFor="business" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[10px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">Business</Label>
                </div>
                <div>
                    <RadioGroupItem value="Personal" id="personal" className="peer sr-only" />
                    <Label htmlFor="personal" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 h-11 text-[10px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">Personal</Label>
                </div>
            </RadioGroup>
            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-11 border-2">
                        <SelectValue placeholder="Filter by category" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </div>

        <Separator />

        <div className='p-4 rounded-xl bg-muted/30 border-2 border-dashed space-y-3'>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Period Summary</p>
            <div className='space-y-2 text-xs'>
                <div className='flex justify-between'><span>Total Revenue:</span><span className='font-bold text-green-600'>${financialSummary.revenue.toFixed(2)}</span></div>
                <div className='flex justify-between'><span>COGS:</span><span className='font-bold text-red-600'>-${financialSummary.cogs.toFixed(2)}</span></div>
                <div className='flex justify-between border-t border-muted pt-2'><span>Gross Profit:</span><span className='font-bold'>${financialSummary.grossProfit.toFixed(2)}</span></div>
                <div className='flex justify-between'><span>Op. Expenses:</span><span className='font-bold text-red-600'>-${financialSummary.operatingExpenses.toFixed(2)}</span></div>
                <div className='flex justify-between border-t-2 border-muted pt-2 mt-2'>
                    <span className="font-black uppercase text-[10px]">Net Income</span>
                    <span className={cn('font-black text-sm', financialSummary.net >= 0 ? 'text-primary' : 'text-destructive')}>
                        ${financialSummary.net.toFixed(2)}
                    </span>
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  );
};

const TransactionRow = ({ transaction, staffMember, onRevertClick }: { transaction: Transaction, staffMember?: Staff, onRevertClick: (transaction: Transaction) => void }) => {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <TransactionIcon type={transaction.type} />
          <div className='flex flex-col'>
            <span className="font-medium text-xs md:text-sm">{transaction.description}</span>
            <span className='text-[10px] md:text-xs text-muted-foreground'>{transaction.clientOrVendor}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-xs">{format(new Date(transaction.date), 'MMM d, p')}</TableCell>
      <TableCell>
        {staffMember ? (
            <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6 border shadow-inner">
                    <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                    <AvatarFallback className="text-[8px]">{staffMember.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="text-[10px] md:text-xs font-medium">{staffMember.name.split(' ')[0]}</span>
            </div>
        ) : <span className="text-[10px] text-muted-foreground italic">System</span>}
      </TableCell>
      <TableCell>
        <Badge
          variant={transaction.context === 'Business' ? 'secondary' : 'outline'}
          className={cn("text-[9px] h-4", {
            'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': transaction.context === 'Business',
            'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': transaction.context === 'Personal'
          })}
        >
          {transaction.context}
        </Badge>
      </TableCell>
      <TableCell className="text-[10px] md:text-xs">
          <div className="flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5 text-muted-foreground"/>
            <span>{transaction.paymentMethod}</span>
          </div>
      </TableCell>
      <TableCell className="text-[10px] md:text-xs">{transaction.category}</TableCell>
      <TableCell className="text-right">
        <div className='flex items-center justify-end gap-2'>
            {transaction.hasReceipt && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className={cn('font-mono text-xs md:text-sm font-bold', {
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

const TransactionCard = ({ transaction, staffMember, onRevertClick }: { transaction: Transaction, staffMember?: Staff, onRevertClick: (transaction: Transaction) => void }) => {
    return (
        <Card className="border-2 shadow-sm">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className={cn("p-2 rounded-full", {
                        'bg-green-500/10': transaction.type === 'income',
                        'bg-red-500/10': transaction.type === 'expense',
                        'bg-blue-500/10': transaction.type === 'payment',
                        'bg-muted': transaction.type === 'reversal'
                    })}>
                        <TransactionIcon type={transaction.type} />
                    </div>
                    <div className="flex-1 space-y-1 min-w-0">
                        <p className="font-black text-sm truncate uppercase tracking-tight text-slate-900">{transaction.description}</p>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{transaction.clientOrVendor} &middot; {format(safeDate(transaction.date), 'MMM d, p')}</p>
                        {staffMember && (
                            <div className="flex items-center gap-1.5 mt-2">
                                <Avatar className="h-5 w-5 border shadow-sm">
                                    <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                                    <AvatarFallback>{(staffMember.name || 'S').charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className="text-[9px] font-black uppercase text-primary tracking-tight">{staffMember.name}</span>
                            </div>
                        )}
                    </div>
                    <div className='text-right'>
                        <p className={cn('font-black font-mono text-base tracking-tighter', {
                            'text-green-600': transaction.type === 'income',
                            'text-red-600': transaction.type === 'expense',
                            'text-blue-600': transaction.type === 'payment',
                            'text-slate-400': transaction.type === 'reversal',
                        })}>
                           {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : transaction.type === 'reversal' ? '' : '+'}${transaction.amount.toFixed(2)}
                        </p>
                        {transaction.hasReceipt && <Paperclip className="h-3.5 w-3.5 text-muted-foreground inline-block mt-1" />}
                    </div>
                </div>
                 <div className="flex items-center justify-between pt-3 border-t mt-2">
                    <div className='flex items-center gap-2'>
                        <Badge
                            variant={transaction.context === 'Business' ? 'secondary' : 'outline'}
                            className={cn("text-[9px] h-4 font-black uppercase tracking-widest", {
                                'bg-blue-100 text-blue-800 border-none': transaction.context === 'Business',
                                'bg-purple-100 text-purple-800 border-none': transaction.context === 'Personal'
                            })}
                            >
                            {transaction.context}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-4 uppercase font-bold text-muted-foreground">{transaction.category}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1.5">
                            <CreditCard className="w-3 h-3"/> {transaction.paymentMethod}
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button aria-haspopup="true" size="sm" variant="ghost" className="h-7 w-7 p-0">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onRevertClick(transaction)} disabled={transaction.type === 'reversal'}>Revert</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default function LedgerPage() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement>(null);

  const { transactions, staff, isLoading: areTransactionsLoading } = useInventory();

  const [date, setDate] = React.useState<DateRange | undefined>({
      from: startOfDay(subDays(new Date(), 30)),
      to: endOfDay(new Date()),
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | 'Business' | 'Personal'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAddTxnOpen, setIsAddTxnOpen] = useState(false);
  const [transactionToRevert, setTransactionToRevert] = useState<Transaction | null>(null);

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];

    return transactions
        .filter(t => {
            const transactionDate = safeDate(t.date);
            const from = date?.from ? startOfDay(date.from) : null;
            const to = date?.to ? endOfDay(date.to) : null;

            if (from && transactionDate < from) return false;
            if (to && transactionDate > to) return false;
            if (searchTerm && !(t.description.toLowerCase().includes(searchTerm.toLowerCase()) || t.clientOrVendor.toLowerCase().includes(searchTerm.toLowerCase()))) return false;
            if (contextFilter !== 'all' && t.context !== contextFilter) return false;
            if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;

            return true;
        })
        .sort((a, b) => safeDate(b.date).getTime() - safeDate(a.date).getTime());
  }, [transactions, date, searchTerm, contextFilter, categoryFilter]);
  
  const financialSummary = useMemo(() => {
    const cogsCategories = ['spoilage', 'supplies', 'Cost of Goods Sold', 'Spoilage'];
    
    const revenue = filteredTransactions
      .filter(t => t.type === 'income')
      .reduce((acc, t) => acc + t.amount, 0);

    const cogs = filteredTransactions
      .filter(t => t.type === 'expense' && cogsCategories.some(c => t.category.toLowerCase().includes(c.toLowerCase())))
      .reduce((acc, t) => acc + t.amount, 0);

    const operatingExpenses = filteredTransactions
      .filter(t => t.type === 'expense' && !cogsCategories.some(c => t.category.toLowerCase().includes(c.toLowerCase())))
      .reduce((acc, t) => acc + t.amount, 0);

    const grossProfit = revenue - cogs;
    const net = grossProfit - operatingExpenses;

    return { revenue, cogs, grossProfit, operatingExpenses, net };
  }, [filteredTransactions]);

  const handleAddTransaction = (data: Omit<Transaction, 'id'>) => {
    if (!firestore || !tenantId) return;
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
    addDocumentNonBlocking(transactionsRef, data);
    toast({
        title: 'Transaction Logged',
        description: `Your transaction for $${data.amount.toFixed(2)} has been recorded.`
    })
    setIsAddTxnOpen(false);
  }
  
  const handleRevertTransaction = () => {
    if (!transactionToRevert || !firestore || !tenantId) return;
    
    if (transactionToRevert.type === 'reversal' || transactionToRevert.reversalOf) {
        toast({ variant: 'destructive', title: "Cannot revert a reversal."});
        setTransactionToRevert(null);
        return;
    }

    const reversalTransaction: Omit<Transaction, 'id'> = {
      ...transactionToRevert,
      date: new Date().toISOString(),
      description: `Reversal of: ${transactionToRevert.description}`,
      type: 'reversal',
      reversalOf: transactionToRevert.id,
    };
    handleAddTransaction(reversalTransaction);
    toast({ title: 'Transaction Reverted', description: 'A reversal transaction has been created.' });
    setTransactionToRevert(null);
  }
  
  const handlePrint = () => {
    window.print();
  };
  
  const isLoading = areTransactionsLoading;

  return (
    <>
    <div className="no-print flex min-h-screen w-full flex-col overflow-x-hidden">
      <AppHeader title="Ledger" />
      <main className="flex-1 p-4 md:p-8 w-full max-w-full">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
            <div className="space-y-1">
                <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">Studio Ledger</h1>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-widest opacity-70">
                    Audit trail for all income and expenses
                </p>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
                <Button variant="outline" onClick={handlePrint} className="flex-1 md:flex-none h-11 border-2 font-bold uppercase tracking-tight shadow-sm"><Printer className='mr-2 h-4 w-4' /> Print Report</Button>
                <Button onClick={() => setIsAddTxnOpen(true)} className="flex-1 md:flex-none h-11 shadow-lg font-black uppercase tracking-tighter"><PlusCircle className='mr-2' /> Add Entry</Button>
            </div>
        </div>

        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8 items-start">
          <div className="md:col-span-1 lg:col-span-1">
            {isMobile ? (
                <Accordion type="single" collapsible className="w-full mb-4">
                    <AccordionItem value="filters" className="border-none">
                        <AccordionTrigger className="p-4 bg-muted/30 rounded-xl border-2 hover:no-underline">
                            <div className="flex items-center gap-2">
                                <Filter className="w-4 h-4 text-primary" />
                                <span className="font-black uppercase text-xs tracking-widest">Filter & Summary</span>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-4">
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
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            ) : (
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
            )}
          </div>
          
          <div className="md:col-span-2 lg:col-span-3 space-y-4 min-w-0">
            <Card className="hidden md:block border-2 shadow-sm overflow-hidden">
              <CardContent className='p-0 overflow-x-auto'>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="border-b-2">
                      <TableHead className="font-black text-[10px] uppercase tracking-widest">Description</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest">Date</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest">Staff</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest">Context</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest">Account</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest">Category</TableHead>
                      <TableHead className="text-right font-black text-[10px] uppercase tracking-widest">Amount</TableHead>
                      <TableHead><span className='sr-only'>Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                        <TableRow>
                            <TableCell colSpan={8} className="h-32 text-center"><Loader className="w-6 h-6 animate-spin mx-auto mb-2" />Loading transactions...</TableCell>
                        </TableRow>
                    )}
                    {!isLoading && filteredTransactions.map((transaction) => (
                      <TransactionRow 
                        key={transaction.id} 
                        transaction={transaction} 
                        staffMember={staff.find(s => s.id === transaction.staffId)}
                        onRevertClick={() => setTransactionToRevert(transaction)} 
                      />
                    ))}
                     {!isLoading && filteredTransactions.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={8} className="h-32 text-center opacity-40 uppercase font-black tracking-widest text-xs">No entries found</TableCell>
                        </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="md:hidden space-y-4">
                 {isLoading && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader className="w-8 h-8 animate-spin text-primary mb-4" />
                        <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Syncing Ledger...</p>
                    </div>
                 )}
                 {!isLoading && filteredTransactions.length > 0 ? (
                    <div className="grid gap-4">
                        {filteredTransactions.map((transaction) => (
                            <TransactionCard 
                                key={transaction.id} 
                                transaction={transaction} 
                                staffMember={staff.find(s => s.id === transaction.staffId)}
                                onRevertClick={() => setTransactionToRevert(transaction)} 
                            />
                        ))}
                    </div>
                 ) : !isLoading && (
                    <div className="text-center py-20 opacity-40 border-2 border-dashed rounded-2xl flex flex-col items-center gap-4">
                        <BookOpen className="w-12 h-12" />
                        <p className="text-sm font-black uppercase tracking-widest">No matching records</p>
                    </div>
                 )}
            </div>
          </div>
        </div>
      </main>
    </div>

    <div className="print-only">
        <PrintableReport 
            ref={reportRef} 
            transactions={filteredTransactions} 
            staff={staff || []}
            financialSummary={financialSummary} 
            dateRange={date} 
        />
    </div>

     <style jsx global>{`
      .print-only {
        display: none;
      }
      @media print {
        .no-print {
          display: none;
        }
        .print-only {
          display: block;
        }
      }
    `}</style>

    <AddTransactionDialog 
        open={isAddTxnOpen}
        onOpenChange={setIsAddTxnOpen}
        staff={staff || []}
        onConfirm={handleAddTransaction}
    />
    
    <AlertDialog open={!!transactionToRevert} onOpenChange={() => setTransactionToRevert(null)}>
        <AlertDialogContent className="rounded-3xl border-4">
            <AlertDialogHeader>
            <AlertDialogTitle className="font-black uppercase tracking-tight text-xl">Confirm Reversal</AlertDialogTitle>
            <AlertDialogDescription className="font-medium text-sm">
                This will create a new, opposite transaction to cancel out &quot;{transactionToRevert?.description}&quot;. This action is permanent and creates an audit trail.
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
            <AlertDialogCancel onClick={() => setTransactionToRevert(null)} className="rounded-2xl h-12 font-bold">Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevertTransaction} className="rounded-2xl h-12 font-black uppercase tracking-tight shadow-lg">Yes, Revert Entry</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
