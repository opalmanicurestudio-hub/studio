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
  Loader,
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
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
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
        return <BookOpen className={cn(iconClass, "text-primary")} />;
    case 'reversal':
      return <RefreshCw className={cn(iconClass, "text-slate-400")} />;
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
    <Card className="h-fit border-2 shadow-sm rounded-3xl overflow-hidden">
      <CardHeader className="hidden md:block border-b bg-muted/5">
        <CardTitle className="text-sm font-black uppercase tracking-widest">Ledger Filters</CardTitle>
        <CardDescription className="text-xs font-bold uppercase tracking-tight opacity-60">Filter studio cash flow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date range</Label>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant='outline' className='w-full h-12 justify-start text-left font-bold rounded-2xl border-2 hover:bg-primary/5 hover:border-primary/30 transition-all'>
                        <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                        {date?.from ? (
                        date.to ? (
                            <>{format(date.from, "LLL dd")} - {format(date.to, "LLL dd, y")}</>
                        ) : (
                            format(date.from, "LLL dd, y")
                        )
                        ) : (
                        "Pick a date"
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-3xl border-2 shadow-2xl" align="start">
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
                    <Input placeholder="Search records..." className="pl-9 h-12 rounded-2xl border-2 focus-visible:ring-primary/20" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
            </div>
            <RadioGroup value={contextFilter} onValueChange={(v: any) => setContextFilter(v)} className="grid grid-cols-3 gap-2">
                <div>
                    <RadioGroupItem value="all" id="all" className="peer sr-only" />
                    <Label htmlFor="all" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">All</Label>
                </div>
                <div>
                    <RadioGroupItem value="Business" id="business" className="peer sr-only" />
                    <Label htmlFor="business" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">Business</Label>
                </div>
                <div>
                    <RadioGroupItem value="Personal" id="personal" className="peer sr-only" />
                    <Label htmlFor="personal" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary transition-all cursor-pointer">Personal</Label>
                </div>
            </RadioGroup>
            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-12 rounded-2xl border-2 focus:ring-primary/20">
                        <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl">
                        <SelectItem value="all" className="font-bold">All Categories</SelectItem>
                        {categories.map(cat => <SelectItem key={cat} value={cat} className="font-bold">{cat}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </div>

        <Separator />

        <div className='p-5 rounded-[2rem] bg-primary/[0.03] border-2 border-primary/10 space-y-4'>
            <p className="text-[10px] font-black uppercase tracking-widest text-primary text-center">Period Performance</p>
            <div className='space-y-2.5 text-xs'>
                <div className='flex justify-between font-bold'><span>Total Revenue:</span><span className='font-mono text-green-600'>${financialSummary.revenue.toFixed(2)}</span></div>
                <div className='flex justify-between font-bold'><span>COGS:</span><span className='font-mono text-destructive'>-${financialSummary.cogs.toFixed(2)}</span></div>
                <div className='flex justify-between border-t border-primary/10 pt-2 font-black'><span>Gross Profit:</span><span className="font-mono text-slate-900">${financialSummary.grossProfit.toFixed(2)}</span></div>
                <div className='flex justify-between font-bold'><span>Op. Expenses:</span><span className='font-mono text-destructive'>-${financialSummary.operatingExpenses.toFixed(2)}</span></div>
                <div className='flex justify-between border-t-4 border-primary/20 pt-3 mt-3'>
                    <span className="font-black uppercase text-[11px] text-primary">Net Income</span>
                    <span className={cn('font-black text-xl tracking-tighter font-mono', financialSummary.net >= 0 ? 'text-primary' : 'text-destructive')}>
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
    <TableRow className="group hover:bg-primary/[0.02]">
      <TableCell>
        <div className="flex items-center gap-4 py-1">
          <div className={cn("p-2 rounded-full", transaction.type === 'income' ? 'bg-green-500/10' : transaction.type === 'expense' ? 'bg-destructive/10' : 'bg-primary/10')}>
            <TransactionIcon type={transaction.type} />
          </div>
          <div className='flex flex-col min-w-0'>
            <span className="font-black uppercase tracking-tight text-xs md:text-sm text-slate-900 truncate">{transaction.description}</span>
            <span className='text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-60 truncate'>{transaction.clientOrVendor}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-[10px] font-black uppercase text-muted-foreground opacity-70">{format(new Date(transaction.date), 'MMM d, p')}</TableCell>
      <TableCell>
        {staffMember ? (
            <div className="flex items-center gap-2">
                <Avatar className="h-7 w-7 border-2 shadow-sm rounded-xl">
                    <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-black uppercase">{staffMember.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="text-[10px] font-black uppercase tracking-tight text-slate-700">{staffMember.name.split(' ')[0]}</span>
            </div>
        ) : <span className="text-[9px] font-black uppercase text-muted-foreground italic opacity-40">System</span>}
      </TableCell>
      <TableCell>
        <Badge
          variant={transaction.context === 'Business' ? 'secondary' : 'outline'}
          className={cn("text-[9px] h-5 px-2 font-black uppercase tracking-widest border-none", {
            'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300': transaction.context === 'Business',
            'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300': transaction.context === 'Personal'
          })}
        >
          {transaction.context}
        </Badge>
      </TableCell>
      <TableCell className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5 opacity-40"/>
            <span>{transaction.paymentMethod}</span>
          </div>
      </TableCell>
      <TableCell className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-60">{transaction.category}</TableCell>
      <TableCell className="text-right">
        <div className='flex items-center justify-end gap-3'>
            {transaction.hasReceipt && <Paperclip className="h-3.5 w-3.5 text-primary/40" />}
            <span className={cn('font-mono text-sm md:text-base font-black tracking-tighter', {
                'text-green-600': transaction.type === 'income',
                'text-destructive': transaction.type === 'expense' || transaction.type === 'payment',
                'text-slate-400': transaction.type === 'reversal',
            })}>
                {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : transaction.type === 'reversal' ? '' : '+'}${transaction.amount.toFixed(2)}
            </span>
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2">
            <DropdownMenuItem onClick={() => onRevertClick(transaction)} disabled={transaction.type === 'reversal'} className="font-bold uppercase text-[10px] tracking-widest">Revert Entry</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const TransactionCard = ({ transaction, staffMember, onRevertClick }: { transaction: Transaction, staffMember?: Staff, onRevertClick: (transaction: Transaction) => void }) => {
    return (
        <Card className="border-2 shadow-sm rounded-3xl overflow-hidden group">
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-4">
                    <div className={cn("p-2.5 rounded-2xl shadow-inner", {
                        'bg-green-500/10': transaction.type === 'income',
                        'bg-destructive/10': transaction.type === 'expense' || transaction.type === 'payment',
                        'bg-muted': transaction.type === 'reversal'
                    })}>
                        <TransactionIcon type={transaction.type} />
                    </div>
                    <div className="flex-1 space-y-1 min-w-0">
                        <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{transaction.description}</p>
                        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-60">{transaction.clientOrVendor} &middot; {format(safeDate(transaction.date), 'MMM d, p')}</p>
                        {staffMember && (
                            <div className="flex items-center gap-2 mt-2">
                                <Avatar className="h-6 w-6 border rounded-xl shadow-sm">
                                    <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
                                    <AvatarFallback className="text-[8px] font-black bg-primary/10 text-primary">{(staffMember.name || 'S').charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <span className="text-[10px] font-black uppercase text-primary tracking-tight">{staffMember.name}</span>
                            </div>
                        )}
                    </div>
                    <div className='text-right'>
                        <p className={cn('font-black font-mono text-lg tracking-tighter', {
                            'text-green-600': transaction.type === 'income',
                            'text-destructive': transaction.type === 'expense' || transaction.type === 'payment',
                            'text-slate-400': transaction.type === 'reversal',
                        })}>
                           {transaction.type === 'expense' || transaction.type === 'payment' ? '-' : transaction.type === 'reversal' ? '' : '+'}${transaction.amount.toFixed(2)}
                        </p>
                        {transaction.hasReceipt && <Paperclip className="h-3.5 w-3.5 text-primary opacity-40 inline-block mt-1" />}
                    </div>
                </div>
                 <div className="flex items-center justify-between pt-4 border-t border-dashed mt-2">
                    <div className='flex items-center gap-2'>
                        <Badge
                            variant="secondary"
                            className={cn("text-[9px] h-5 px-2 font-black uppercase tracking-widest border-none", {
                                'bg-indigo-100 text-indigo-800': transaction.context === 'Business',
                                'bg-purple-100 text-purple-800': transaction.context === 'Personal'
                            })}
                            >
                            {transaction.context}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-5 px-2 uppercase font-black tracking-widest text-muted-foreground/60 border-2">{transaction.category}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="text-[9px] text-muted-foreground font-black uppercase tracking-widest opacity-50 flex items-center gap-1.5">
                            <CreditCard className="w-3 h-3"/> {transaction.paymentMethod}
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button aria-haspopup="true" size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-full group-hover:bg-primary/10">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-2xl shadow-xl border-2">
                                <DropdownMenuItem onClick={() => onRevertClick(transaction)} disabled={transaction.type === 'reversal'} className="font-bold uppercase text-[10px] tracking-widest">Revert Entry</DropdownMenuItem>
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
    <div className="no-print flex min-h-screen w-full flex-col overflow-x-hidden bg-background">
      <AppHeader title="Studio Ledger" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
            <div className="space-y-1">
                <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">The Ledger</h1>
                <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
                    Official financial audit trail
                </p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
                <Button variant="outline" onClick={handlePrint} className="flex-1 md:flex-none h-14 px-8 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] shadow-sm"><Printer className='mr-2 h-4 w-4' /> Print Log</Button>
                <Button onClick={() => setIsAddTxnOpen(true)} className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20"><PlusCircle className='mr-2 h-4 w-4' /> New Entry</Button>
            </div>
        </div>

        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8 items-start">
          <div className="md:col-span-1 lg:col-span-1">
            {isMobile ? (
                <Accordion type="single" collapsible className="w-full mb-6">
                    <AccordionItem value="filters" className="border-none">
                        <AccordionTrigger className="p-5 bg-primary/5 rounded-[2rem] border-2 border-primary/10 hover:no-underline shadow-sm">
                            <div className="flex items-center gap-3">
                                <Filter className="w-5 h-5 text-primary" />
                                <span className="font-black uppercase text-xs tracking-widest text-primary">Summary & Filters</span>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-6">
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
          
          <div className="md:col-span-2 lg:col-span-3 space-y-6 min-w-0">
            <Card className="hidden md:block border-2 shadow-2xl rounded-[2.5rem] overflow-hidden">
              <CardContent className='p-0 overflow-x-auto'>
                <Table>
                  <TableHeader className="bg-muted/30 border-b-2">
                    <TableRow>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em] p-6">Description & Entity</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em]">Timestamp</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em]">Provider</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em]">Context</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em]">Account</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-[0.2em]">Category</TableHead>
                      <TableHead className="text-right font-black text-[10px] uppercase tracking-[0.2em] pr-10">Amount</TableHead>
                      <TableHead><span className='sr-only'>Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                        <TableRow>
                            <TableCell colSpan={8} className="h-64 text-center">
                                <div className="flex flex-col items-center gap-4">
                                    <Loader className="w-10 h-10 animate-spin text-primary" />
                                    <p className="font-black uppercase text-[10px] tracking-widest text-primary opacity-60">Synchronizing Ledger...</p>
                                </div>
                            </TableCell>
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
                            <TableCell colSpan={8} className="h-64 text-center">
                                <div className="space-y-2 opacity-30">
                                    <BookOpen className="w-12 h-12 mx-auto" />
                                    <p className="uppercase font-black tracking-widest text-xs">No records found for this period</p>
                                </div>
                            </TableCell>
                        </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="md:hidden space-y-4">
                 {isLoading && (
                    <div className="flex flex-col items-center justify-center py-24">
                        <Loader className="w-10 h-10 animate-spin text-primary mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary">Syncing Ledger...</p>
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
                    <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                        <BookOpen className="w-16 h-16" />
                        <p className="text-sm font-black uppercase tracking-widest">No entries found</p>
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
        <AlertDialogContent className="rounded-[3rem] border-4 shadow-3xl">
            <AlertDialogHeader className="p-6 pb-0">
            <AlertDialogTitle className="font-black uppercase tracking-tighter text-2xl">Confirm Reversal</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-sm text-slate-600 leading-relaxed">
                You are about to create an audit-trail reversal for &quot;{transactionToRevert?.description}&quot;. This will permanently record an opposite entry to zero-out this balance.
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="p-6 pt-4 flex flex-col gap-3">
                <Button onClick={handleRevertTransaction} className="w-full h-16 rounded-2xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20">Yes, Revert Entry</Button>
                <AlertDialogCancel onClick={() => setTransactionToRevert(null)} className="w-full h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest border-none">Cancel</AlertDialogCancel>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}