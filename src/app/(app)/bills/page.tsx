'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CreditCard,
  CalendarDays,
  AlertTriangle,
  MoreHorizontal,
  CheckCircle,
  Filter,
  ArrowRight,
  Clock,
  Landmark,
  TrendingDown,
  Sparkles,
  Activity,
  DollarSign,
  Loader,
  ExternalLink,
  FileText,
  Pencil,
  ChevronRight,
  CalendarClock
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { type BillDefinition, type BillInstance, type Transaction } from '@/lib/financial-data';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { isPast, isFuture, parseISO, addDays, isBefore, startOfDay, endOfDay } from 'date-fns';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirebase, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import Link from 'next/link';

type StatusFilter = 'all' | 'paid' | 'unpaid' | 'overdue';
type ContextFilter = 'all' | 'Business' | 'Personal';

const BillFilters = ({
  onStatusChange,
  onContextChange,
  status,
  context,
}: {
  onStatusChange: (status: StatusFilter) => void;
  onContextChange: (context: ContextFilter) => void;
  status: StatusFilter;
  context: ContextFilter;
}) => {
  return (
    <Card className="h-fit sticky top-24 border-2 shadow-sm rounded-3xl overflow-hidden bg-white">
      <CardHeader className="bg-muted/5 border-b p-6">
        <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-900">Logic Filters</CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="space-y-3">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Archive Status</Label>
          <Select value={status} onValueChange={(value) => onStatusChange(value as StatusFilter)}>
            <SelectTrigger className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest shadow-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-2 shadow-2xl">
              <SelectItem value="all" className="font-bold">ALL ENTRIES</SelectItem>
              <SelectItem value="unpaid" className="font-bold">PENDING SETTLEMENT</SelectItem>
              <SelectItem value="overdue" className="font-bold text-destructive">OVERDUE ARREARS</SelectItem>
              <SelectItem value="paid" className="font-bold text-green-600">CERTIFIED PAID</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-3">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Entity Context</Label>
          <RadioGroup value={context} onValueChange={(value) => onContextChange(value as ContextFilter)} className="grid grid-cols-3 gap-2">
            <div>
              <RadioGroupItem value="all" id="all" className="peer sr-only" />
              <Label htmlFor="all" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer">All</Label>
            </div>
            <div>
              <RadioGroupItem value="Business" id="business" className="peer sr-only" />
              <Label htmlFor="business" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer">Business</Label>
            </div>
            <div>
              <RadioGroupItem value="Personal" id="personal" className="peer sr-only" />
              <Label htmlFor="personal" className="flex items-center justify-center rounded-xl border-2 border-muted bg-popover p-2 h-11 text-[9px] font-black uppercase hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all cursor-pointer">Personal</Label>
            </div>
          </RadioGroup>
        </div>
      </CardContent>
    </Card>
  );
};


const BillTableRow = ({ instance, onLogPaymentClick }: { instance: BillInstance & { definition: BillDefinition }, onLogPaymentClick: (instance: BillInstance & { definition: BillDefinition }) => void; }) => {
    const statusConfig = {
        paid: { text: 'Paid', className: 'bg-green-500 text-white border-none' },
        unpaid: { text: 'Unpaid', className: 'bg-muted text-muted-foreground border-none' },
        'partially-paid': { text: 'Partial', className: 'bg-amber-500 text-white border-none' },
        overdue: { text: 'Overdue', className: 'bg-destructive text-white border-none animate-pulse' },
    }

    const hasLatePenalty = instance.status === 'overdue' && (instance.definition.lateFee || 0) > 0;

    return (
    <TableRow className="group hover:bg-primary/[0.02]">
        <TableCell className="py-5">
            <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-xl border shadow-inner", instance.status === 'overdue' ? 'bg-destructive/5 text-destructive' : 'bg-muted/30 text-slate-400')}>
                    <Landmark className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                    <p className="font-black uppercase tracking-tight text-xs md:text-sm text-slate-900 truncate">{instance.definition.name}</p>
                    {hasLatePenalty && (
                        <p className="text-[8px] font-black text-destructive uppercase tracking-widest mt-0.5 animate-pulse">
                            +${instance.definition.lateFee?.toFixed(2)} Late Penalty
                        </p>
                    )}
                </div>
            </div>
        </TableCell>
        <TableCell>
            <div className="flex flex-col">
                <span className="font-black font-mono text-sm tracking-tighter text-slate-900">${instance.amountDue.toFixed(2)}</span>
                {instance.amountPaid > 0 && <span className="text-[8px] font-bold text-green-600 uppercase">Paid: ${instance.amountPaid.toFixed(2)}</span>}
            </div>
        </TableCell>
        <TableCell className="text-[10px] font-black uppercase text-muted-foreground opacity-60">
            {formatTZ(toZonedTime(parseISO(instance.dueDate), 'UTC'), 'MMM d, yyyy', { timeZone: 'UTC' })}
        </TableCell>
        <TableCell>
            <Badge variant="secondary" className={cn("h-5 px-2 font-black text-[8px] uppercase tracking-widest shadow-sm", statusConfig[instance.status].className)}>{statusConfig[instance.status].text}</Badge>
        </TableCell>
        <TableCell>
            <Badge
                variant={instance.definition.context === 'Business' ? 'secondary' : 'outline'}
                className={cn("h-5 px-2 rounded-lg font-black text-[8px] uppercase tracking-widest border-2", {
                    'bg-indigo-50 border-indigo-100 text-indigo-700': instance.definition.context === 'Business',
                    'bg-purple-50 border-purple-100 text-purple-700': instance.definition.context === 'Personal'
                })}
                >
                {instance.definition.context}
            </Badge>
        </TableCell>
        <TableCell className="text-right">
             <div className="flex items-center justify-end gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                        <DropdownMenuItem asChild className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                            <Link href="/financials">
                                <Pencil className="mr-2 h-3.5 w-3.5 opacity-40" /> Edit Definition
                            </Link>
                        </DropdownMenuItem>
                        {instance.definition.paymentUrl && (
                            <DropdownMenuItem asChild className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                                <a href={instance.definition.paymentUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="mr-2 h-3.5 w-3.5 opacity-40" /> Visit Portal
                                </a>
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button 
                    variant="ghost" 
                    size="sm" 
                    disabled={instance.status === 'paid'} 
                    onClick={() => onLogPaymentClick(instance)}
                    className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest text-primary hover:bg-primary/5 border border-transparent hover:border-primary/20"
                >
                    Log Payment
                </Button>
             </div>
        </TableCell>
    </TableRow>
    )
};

const BillCard = ({ instance, onLogPaymentClick }: { instance: BillInstance & { definition: BillDefinition }, onLogPaymentClick: (instance: BillInstance & { definition: BillDefinition }) => void; }) => {
     const statusConfig = {
        paid: { text: 'Paid', className: 'bg-green-500 text-white' },
        unpaid: { text: 'Unpaid', className: 'bg-muted text-muted-foreground' },
        'partially-paid': { text: 'Partial', className: 'bg-amber-500 text-white' },
        overdue: { text: 'Overdue', className: 'bg-destructive text-white animate-pulse' },
    }

    const hasLatePenalty = instance.status === 'overdue' && (instance.definition.lateFee || 0) > 0;

    return (
    <Card className={cn("overflow-hidden border-2 rounded-3xl shadow-sm transition-all", instance.status === 'overdue' ? 'border-destructive/20 bg-destructive/[0.02]' : 'bg-white')}>
        <CardContent className="p-5 space-y-5 text-left">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{instance.definition.name}</p>
                    <p className="text-[10px] font-black uppercase text-muted-foreground opacity-40 mt-1 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        Due: {formatTZ(toZonedTime(parseISO(instance.dueDate), 'UTC'), 'MMM d, yyyy', { timeZone: 'UTC' })}
                    </p>
                    {hasLatePenalty && (
                        <p className="text-[9px] font-black text-destructive uppercase tracking-widest mt-2 animate-pulse flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3" />
                            +${instance.definition.lateFee?.toFixed(2)} Arrears Penalty
                        </p>
                    )}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-1 rounded-xl">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1">
                        <DropdownMenuItem asChild className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                            <Link href="/financials">
                                <Pencil className="mr-2 h-3.5 w-3.5 opacity-40" /> Edit Definition
                            </Link>
                        </DropdownMenuItem>
                        {instance.definition.paymentUrl && (
                            <DropdownMenuItem asChild className="font-bold text-[10px] uppercase tracking-widest py-2.5">
                                <a href={instance.definition.paymentUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="mr-2 h-3.5 w-3.5 opacity-40" /> Visit Portal
                                </a>
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-dashed">
                <div className="flex items-center gap-2">
                    <Badge className={cn("h-5 px-2 font-black text-[8px] uppercase tracking-widest border-none shadow-sm", statusConfig[instance.status].className)}>{statusConfig[instance.status].text}</Badge>
                    <Badge
                        variant="outline"
                        className={cn("h-5 px-2 rounded-lg font-black text-[8px] uppercase tracking-widest border-2", {
                            'bg-indigo-50 border-indigo-100 text-indigo-700': instance.definition.context === 'Business',
                            'bg-purple-50 border-purple-100 text-purple-700': instance.definition.context === 'Personal'
                        })}
                    >
                        {instance.definition.context}
                    </Badge>
                </div>
                <span className="font-black text-xl tracking-tighter font-mono text-slate-900">${instance.amountDue.toFixed(2)}</span>
            </div>
        </CardContent>
        <div className="p-3 border-t bg-muted/5">
            <Button 
                variant={instance.status === 'overdue' ? 'destructive' : 'outline'} 
                className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-sm" 
                disabled={instance.status === 'paid'} 
                onClick={() => onLogPaymentClick(instance)}
            >
                Log Distribution
            </Button>
        </div>
    </Card>
    )
};


export default function BillsPage() {
  const { firestore, user } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [contextFilter, setContextFilter] = useState<ContextFilter>('all');
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: BillDefinition }) | null>(null);
  const { toast } = useToast();

  const { billDefinitions, billInstances, isLoading } = useInventory();

  const instancesWithDefinitions = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    return billInstances.map(instance => {
      const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
      return { ...instance, definition: definition! };
    }).filter(item => item.definition);
  }, [billInstances, billDefinitions]);

  const { monthlyTotal, upcomingTotal, pastDueTotal } = useMemo(() => {
    if (!billDefinitions || !instancesWithDefinitions) return { monthlyTotal: 0, upcomingTotal: 0, pastDueTotal: 0 };
    const total = billDefinitions.reduce((acc, def) => def.billingCycle === 'monthly' ? acc + def.amount : acc, 0);
    const upcoming = instancesWithDefinitions.filter(i => i.status !== 'paid' && isFuture(parseISO(i.dueDate))).reduce((acc, i) => acc + i.amountDue, 0);
    const pastDue = instancesWithDefinitions.filter(i => i.status === 'overdue').reduce((acc, i) => acc + i.amountDue, 0);
    return { monthlyTotal: total, upcomingTotal: upcoming, pastDueTotal: pastDue };
  }, [instancesWithDefinitions, billDefinitions]);


  const filteredBills = useMemo(() => {
    return instancesWithDefinitions.filter(instance => {
      const contextMatch = contextFilter === 'all' || instance.definition.context === contextFilter;
      
      let statusMatch = true;
      if (statusFilter !== 'all') {
          if (statusFilter === 'overdue') {
              statusMatch = instance.status === 'overdue';
          } else if (statusFilter === 'unpaid') {
              statusMatch = instance.status === 'unpaid' || instance.status === 'partially-paid';
          } else {
              statusMatch = instance.status === statusFilter;
          }
      }

      return contextMatch && statusMatch;
    }).sort((a,b) => parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime());
  }, [contextFilter, statusFilter, instancesWithDefinitions]);

  const { arrears, upcomingSevenDays, futureUnpaid } = useMemo(() => {
    if (statusFilter !== 'all') return { arrears: [], upcomingSevenDays: [], futureUnpaid: [] };
    
    const today = startOfDay(new Date());
    const sevenDaysFromNow = endOfDay(addDays(today, 7));

    return {
        arrears: filteredBills.filter(b => b.status === 'overdue'),
        upcomingSevenDays: filteredBills.filter(b => 
            b.status !== 'paid' && 
            b.status !== 'overdue' && 
            isBefore(parseISO(b.dueDate), sevenDaysFromNow)
        ),
        futureUnpaid: filteredBills.filter(b => 
            b.status !== 'paid' && 
            b.status !== 'overdue' && 
            !isBefore(parseISO(b.dueDate), sevenDaysFromNow)
        )
    };
  }, [filteredBills, statusFilter]);

  const handleLogPaymentClick = (instance: BillInstance & { definition: BillDefinition }) => {
    setSelectedBill(instance);
  };
  
  const handleLogPaymentConfirm = (paymentData: { amount: number; date: Date; paymentMethod: string; paymentMethodIdentifier?: string; notes?: string; receiptUrl?: string }) => {
    if (!selectedBill || !firestore || !user || !tenantId) return;
    
    const isVirtual = selectedBill.id.startsWith('virtual-');
    const billInstanceRef = isVirtual 
        ? doc(collection(firestore, 'tenants', tenantId, 'billInstances'))
        : doc(firestore, 'tenants', tenantId, 'billInstances', selectedBill.id);
    
    const newAmountPaid = selectedBill.amountPaid + paymentData.amount;
    const newAmountDue = selectedBill.amountDue - paymentData.amount;
    const newStatus: BillInstance['status'] = newAmountDue <= 0 ? 'paid' : 'partially-paid';
    
    const batch = writeBatch(firestore);

    let finalInstanceId = selectedBill.id;
    if (isVirtual) {
        finalInstanceId = billInstanceRef.id;
        batch.set(billInstanceRef, {
            id: finalInstanceId,
            billDefinitionId: selectedBill.billDefinitionId,
            dueDate: selectedBill.dueDate,
            amountDue: newAmountDue,
            amountPaid: newAmountPaid,
            status: newStatus
        });
    } else {
        batch.update(billInstanceRef, {
            amountPaid: newAmountPaid,
            amountDue: newAmountDue,
            status: newStatus
        });
    }

    const newTransaction: Omit<Transaction, 'id'> = {
        date: paymentData.date.toISOString(),
        description: `Payment for ${selectedBill.definition.name}`,
        clientOrVendor: selectedBill.definition.name,
        type: 'payment',
        context: selectedBill.definition.context,
        category: selectedBill.definition.category,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentMethod,
        hasReceipt: !!paymentData.receiptUrl,
        receiptUrl: paymentData.receiptUrl,
        relatedBillInstanceId: finalInstanceId,
    };
    
    const transactionsRef = doc(collection(firestore, 'tenants', tenantId, 'transactions'));
    batch.set(transactionsRef, { ...newTransaction, id: transactionsRef.id });
    
    batch.commit().then(() => {
        toast({
            title: "Distribution Logged",
            description: `Payment of $${paymentData.amount.toFixed(2)} recorded for ${selectedBill.definition.name}.`
        });
    });

    setSelectedBill(null);
  };

  const BillSection = ({ title, icon: Icon, items, colorClass }: { title: string, icon: any, items: any[], colorClass?: string }) => {
    if (items.length === 0) return null;
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 px-1">
                <div className={cn("p-2 rounded-xl", colorClass || "bg-muted/50")}>
                    <Icon className={cn("w-4 h-4", colorClass ? "text-white" : "text-muted-foreground")} />
                </div>
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">{title}</h2>
                <Badge variant="secondary" className="h-5 px-1.5 font-black text-[10px] border-none bg-muted-foreground/10 text-muted-foreground">{items.length}</Badge>
            </div>
            <div className="hidden md:block border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
                <Table>
                    <TableHeader className="bg-muted/10 border-b-2">
                        <TableRow>
                            <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900">Description</TableHead>
                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Yield Load</TableHead>
                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Settlement Date</TableHead>
                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Logic State</TableHead>
                            <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Portfolio</TableHead>
                            <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10 text-slate-900">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((instance) => (
                            <BillTableRow key={instance.id} instance={instance} onLogPaymentClick={handleLogPaymentClick} />
                        ))}
                    </TableBody>
                </Table>
            </div>
            <div className="space-y-4 md:hidden">
                {items.map((instance) => (
                    <BillCard key={instance.id} instance={instance} onLogPaymentClick={handleLogPaymentClick} />
                ))}
            </div>
        </div>
    )
  }


  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Command Ledger" />
      <main className="flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-8 md:space-y-10 text-left">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Obligations</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Recurring expense manifest & settlement hub
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
          <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary">Manifest Total</CardTitle>
              <CreditCard className="h-4 w-4 text-primary opacity-40" />
            </CardHeader>
            <CardContent className="p-6 pt-0 text-left">
              <div className="text-3xl md:text-4xl font-black tracking-tighter font-mono text-primary">${monthlyTotal.toFixed(2)}</div>
              <p className="text-[9px] font-bold text-primary/60 uppercase mt-1">Sum of monthly definitions</p>
            </CardContent>
          </Card>
          <Card className="border-2 shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">7-Day Deployment</CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground opacity-40" />
            </CardHeader>
            <CardContent className="p-6 pt-0 text-left">
              <div className="text-3xl md:text-4xl font-black tracking-tighter font-mono text-slate-900">${upcomingTotal.toFixed(2)}</div>
               <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-60">Pending immediate settlement</p>
            </CardContent>
          </Card>
           <Card className="border-2 border-destructive/20 bg-destructive/[0.02] rounded-[2.5rem] shadow-xl shadow-destructive/5 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-widest text-destructive">Arrears Alert</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive opacity-40" />
            </CardHeader>
            <CardContent className="p-6 pt-0 text-left">
              <div className="text-3xl md:text-4xl font-black tracking-tighter font-mono text-destructive">${pastDueTotal.toFixed(2)}</div>
               <p className="text-[9px] font-bold text-destructive/60 uppercase mt-1">Unpaid past due windows</p>
            </CardContent>
          </Card>
        </div>
        
        <div className="md:hidden">
            <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="filters" className="border-none">
                    <AccordionTrigger className="p-5 bg-white rounded-3xl border-2 shadow-sm hover:no-underline">
                        <div className="flex items-center gap-3">
                            <Filter className="w-5 h-5 text-primary" />
                            <span className="font-black uppercase text-xs tracking-widest text-slate-900">Configure Logic Filters</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-6">
                        <BillFilters 
                            onStatusChange={setStatusFilter} 
                            onContextChange={setContextFilter} 
                            status={statusFilter}
                            context={contextFilter}
                        />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>

        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-10 items-start">
            <div className="hidden md:block md:col-span-1 lg:col-span-1">
                <BillFilters 
                    onStatusChange={setStatusFilter} 
                    onContextChange={setContextFilter}
                    status={statusFilter}
                    context={contextFilter}
                />
            </div>
             <div className="md:col-span-2 lg:col-span-3 space-y-12">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center p-24 gap-4">
                        <Loader className="animate-spin h-8 w-8 text-primary" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Archives...</p>
                    </div>
                ) : statusFilter === 'all' ? (
                    <>
                        <BillSection 
                            title="Urgent: Arrears (Past Due)" 
                            icon={AlertTriangle} 
                            items={arrears} 
                            colorClass="bg-destructive shadow-lg shadow-destructive/20"
                        />
                        <BillSection 
                            title="Pending: Next 7 Days" 
                            icon={CalendarClock} 
                            items={upcomingSevenDays} 
                            colorClass="bg-primary shadow-lg shadow-primary/20"
                        />
                        <BillSection 
                            title="Strategic Forecast: Future" 
                            icon={ChevronRight} 
                            items={futureUnpaid} 
                        />
                        {filteredBills.length === 0 && (
                            <div className="text-center py-24 opacity-30 border-4 border-dashed rounded-[3rem] flex flex-col items-center gap-4">
                                <TrendingDown className="w-16 h-16" />
                                <p className="font-black uppercase tracking-widest text-sm">Manifest Clear</p>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 px-1">
                            <div className="p-2 rounded-xl bg-muted/50">
                                <Filter className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Filtered Archive</h2>
                        </div>
                        <div className="hidden md:block border-2 shadow-sm rounded-[2rem] overflow-hidden bg-white">
                            <Table>
                                <TableHeader className="bg-muted/10 border-b-2">
                                    <TableRow>
                                        <TableHead className="font-black text-[10px] uppercase tracking-widest p-6 text-slate-900">Description</TableHead>
                                        <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Yield Load</TableHead>
                                        <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Settlement Date</TableHead>
                                        <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Logic State</TableHead>
                                        <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-900">Portfolio</TableHead>
                                        <TableHead className="text-right font-black text-[10px] uppercase tracking-widest pr-10 text-slate-900">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredBills.length > 0 ? filteredBills.map((instance) => (
                                        <BillTableRow key={instance.id} instance={instance} onLogPaymentClick={handleLogPaymentClick} />
                                    )) : (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-64 text-center">
                                                <div className="space-y-2 opacity-30">
                                                    <TrendingDown className="w-12 h-12 mx-auto" />
                                                    <p className="uppercase font-black tracking-widest text-xs">No matching entries found</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="space-y-4 md:hidden">
                            {filteredBills.map((instance) => (
                                <BillCard key={instance.id} instance={instance} onLogPaymentClick={handleLogPaymentClick} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>

      </main>

       {selectedBill && (
        <LogPaymentDialog
            open={!!selectedBill}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    setSelectedBill(null);
                }
            }}
            billInstance={selectedBill}
            onConfirm={handleLogPaymentConfirm}
        />
      )}
    </div>
  );
}
