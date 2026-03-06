
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
import { isPast, isFuture, parseISO } from 'date-fns';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirebase, useMemoFirebase, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';

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
    <Card className="h-fit sticky top-24">
      <CardHeader>
        <CardTitle>Filter Bills</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(value) => onStatusChange(value as StatusFilter)}>
            <SelectTrigger>
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Context</Label>
          <RadioGroup value={context} onValueChange={(value) => onContextChange(value as ContextFilter)} className="grid grid-cols-3 gap-2">
            <div>
              <RadioGroupItem value="all" id="all" className="peer sr-only" />
              <Label htmlFor="all" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">All</Label>
            </div>
            <div>
              <RadioGroupItem value="Business" id="business" className="peer sr-only" />
              <Label htmlFor="business" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">Business</Label>
            </div>
            <div>
              <RadioGroupItem value="Personal" id="personal" className="peer sr-only" />
              <Label htmlFor="personal" className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-sm hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary transition-all cursor-pointer">Personal</Label>
            </div>
          </RadioGroup>
        </div>
      </CardContent>
    </Card>
  );
};


const BillTableRow = ({ instance, onLogPaymentClick }: { instance: BillInstance & { definition: BillDefinition }, onLogPaymentClick: (instance: BillInstance & { definition: BillDefinition }) => void; }) => {
    const statusConfig = {
        paid: { text: 'Paid', className: 'bg-green-100 dark:bg-green-900/50 text-green-800' },
        unpaid: { text: 'Unpaid', className: 'bg-gray-100 dark:bg-gray-800/50 text-gray-700' },
        'partially-paid': { text: 'Partially Paid', className: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800' },
        overdue: { text: 'Overdue', className: 'bg-red-100 dark:bg-red-900/50 text-red-700' },
    }

    return (
    <TableRow>
        <TableCell className="font-medium">{instance.definition.name}</TableCell>
        <TableCell>${instance.amountDue.toFixed(2)}</TableCell>
        <TableCell>{formatTZ(toZonedTime(parseISO(instance.dueDate), 'UTC'), 'MMM d, yyyy', { timeZone: 'UTC' })}</TableCell>
        <TableCell>
            <Badge variant="secondary" className={statusConfig[instance.status].className}>{statusConfig[instance.status].text}</Badge>
        </TableCell>
        <TableCell>
            <Badge
                variant={instance.definition.context === 'Business' ? 'secondary' : 'outline'}
                className={cn({
                    'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': instance.definition.context === 'Business',
                    'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': instance.definition.context === 'Personal'
                })}
                >
                {instance.definition.context}
            </Badge>
        </TableCell>
        <TableCell className="text-right">
             <Button variant="outline" size="sm" disabled={instance.status === 'paid'} onClick={() => onLogPaymentClick(instance)}>Log Payment</Button>
        </TableCell>
    </TableRow>
    )
};

const BillCard = ({ instance, onLogPaymentClick }: { instance: BillInstance & { definition: BillDefinition }, onLogPaymentClick: (instance: BillInstance & { definition: BillDefinition }) => void; }) => {
     const statusConfig = {
        paid: { text: 'Paid', className: 'bg-green-100 dark:bg-green-900/50 text-green-800' },
        unpaid: { text: 'Unpaid', className: 'bg-gray-100 dark:bg-gray-800/50 text-gray-700' },
        'partially-paid': { text: 'Partially Paid', className: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800' },
        overdue: { text: 'Overdue', className: 'bg-red-100 dark:bg-red-900/50 text-red-700' },
    }

    return (
    <Card>
        <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="font-semibold">{instance.definition.name}</p>
                    <p className="text-sm text-muted-foreground">Due: {formatTZ(toZonedTime(parseISO(instance.dueDate), 'UTC'), 'MMM d, yyyy', { timeZone: 'UTC' })}</p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="-mt-1 h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem>Edit Bill</DropdownMenuItem>
                         <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={statusConfig[instance.status].className}>{statusConfig[instance.status].text}</Badge>
                    <Badge
                        variant={instance.definition.context === 'Business' ? 'secondary' : 'outline'}
                        className={cn({
                            'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': instance.definition.context === 'Business',
                            'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': instance.definition.context === 'Personal'
                        })}
                    >
                        {instance.definition.context}
                    </Badge>
                </div>
                <span className="font-semibold text-lg">${instance.amountDue.toFixed(2)}</span>
            </div>
        </CardContent>
        <CardFooter className="p-2 border-t">
            <Button variant="secondary" className="w-full" disabled={instance.status === 'paid'} onClick={() => onLogPaymentClick(instance)}>Log Payment</Button>
        </CardFooter>
    </Card>
    )
};


export default function BillsPage() {
  const { firestore, user, isUserLoading } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [contextFilter, setContextFilter] = useState<ContextFilter>('all');
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: BillDefinition }) | null>(null);
  const { toast } = useToast();

  const billDefinitionsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !tenantId) return null;
    return collection(firestore, 'tenants', tenantId, 'bills');
  }, [firestore, user, isUserLoading, tenantId]);

  const billInstancesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore || !tenantId) return null;
    return collection(firestore, 'tenants', tenantId, 'billInstances');
  }, [firestore, user, isUserLoading, tenantId]);

  const { data: billDefinitions, isLoading: definitionsLoading } = useCollection<BillDefinition>(billDefinitionsQuery);
  const { data: billInstances, isLoading: instancesLoading } = useCollection<BillInstance>(billInstancesQuery);
  

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

  const handleLogPaymentClick = (instance: BillInstance & { definition: BillDefinition }) => {
    setSelectedBill(instance);
  };
  
  const handleLogPaymentConfirm = (paymentData: { amount: number; date: Date; paymentMethod: string; paymentMethodIdentifier?: string; notes?: string; receiptUrl?: string }) => {
    if (!selectedBill || !firestore || !user || !tenantId) return;
    
    // 1. Determine the BillInstance Reference (Handle virtual vs. real IDs)
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

    // 2. Create a new Transaction in Firestore
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
            title: "Payment Logged",
            description: `A payment of $${paymentData.amount.toFixed(2)} has been logged for ${selectedBill.definition.name}.`
        });
    });

    setSelectedBill(null);
  };


  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Bills" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Bills & Recurring Expenses</h1>
            <p className="text-muted-foreground">
              A dashboard for all your recurring business and personal expenses.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Est. Total Monthly</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${monthlyTotal.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Sum of all monthly bill definitions</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Upcoming in 30 Days</CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${upcomingTotal.toFixed(2)}</div>
               <p className="text-xs text-muted-foreground">Total amount due soon</p>
            </CardContent>
          </Card>
           <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Past Due</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">${pastDueTotal.toFixed(2)}</div>
               <p className="text-xs text-muted-foreground">Total amount overdue</p>
            </CardContent>
          </Card>
        </div>
        
        <div className="md:hidden">
            <Accordion type="single" collapsible>
                <AccordionItem value="filters">
                    <AccordionTrigger>Filter Bills</AccordionTrigger>
                    <AccordionContent>
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

        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8 items-start">
            <div className="hidden md:block md:col-span-1 lg:col-span-1">
                <BillFilters 
                    onStatusChange={setStatusFilter} 
                    onContextChange={setContextFilter}
                    status={statusFilter}
                    context={contextFilter}
                />
            </div>
             <div className="md:col-span-2 lg:col-span-3">
                <Card className="hidden md:block">
                    <CardHeader>
                        <CardTitle>Bill Instances</CardTitle>
                        <CardDescription>A list of all your concrete bill instances, past and present.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Due Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Context</TableHead>
                                <TableHead className='text-right'>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredBills.map((instance) => (
                               <BillTableRow key={instance.id} instance={instance} onLogPaymentClick={handleLogPaymentClick} />
                            ))}
                        </TableBody>
                        </Table>
                    </CardContent>
                </Card>
                <div className="space-y-4 md:hidden">
                     {filteredBills.map((instance) => (
                        <BillCard key={instance.id} instance={instance} onLogPaymentClick={handleLogPaymentClick} />
                    ))}
                </div>
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
