
'use client';

import React, { useState, useMemo } from 'react';
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
import { billDefinitions, billInstances, type BillDefinition, type BillInstance } from '@/lib/financial-data';
import { format as formatTZ, utcToZonedTime } from 'date-fns-tz';
import { isPast, isToday, isFuture, parseISO } from 'date-fns';

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
        </div>
      </CardContent>
    </Card>
  );
};


const BillTableRow = ({ instance }: { instance: BillInstance & { definition: BillDefinition } }) => {
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
        <TableCell>{formatTZ(utcToZonedTime(parseISO(instance.dueDate), 'UTC'), 'MMM d, yyyy', { timeZone: 'UTC' })}</TableCell>
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
             <Button variant="outline" size="sm" disabled={instance.status === 'paid'}>Log Payment</Button>
        </TableCell>
    </TableRow>
    )
};

const BillCard = ({ instance }: { instance: BillInstance & { definition: BillDefinition } }) => {
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
                    <p className="text-sm text-muted-foreground">Due: {formatTZ(utcToZonedTime(parseISO(instance.dueDate), 'UTC'), 'MMM d, yyyy', { timeZone: 'UTC' })}</p>
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
            <Button variant="secondary" className="w-full" disabled={instance.status === 'paid'}>Log Payment</Button>
        </CardFooter>
    </Card>
    )
};


export default function BillsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [contextFilter, setContextFilter] = useState<ContextFilter>('all');

  const instancesWithDefinitions = useMemo(() => {
    return billInstances.map(instance => {
      const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
      return { ...instance, definition: definition! };
    }).filter(item => item.definition);
  }, []);

  const { monthlyTotal, upcomingTotal, pastDueTotal } = useMemo(() => {
    const now = new Date();
    const total = billDefinitions.reduce((acc, def) => def.billingCycle === 'monthly' ? acc + def.amount : acc, 0);
    const upcoming = instancesWithDefinitions.filter(i => i.status !== 'paid' && isFuture(parseISO(i.dueDate))).reduce((acc, i) => acc + i.amountDue, 0);
    const pastDue = instancesWithDefinitions.filter(i => i.status === 'overdue').reduce((acc, i) => acc + i.amountDue, 0);
    return { monthlyTotal: total, upcomingTotal: upcoming, pastDueTotal: pastDue };
  }, [instancesWithDefinitions]);


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

        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8">
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
                               <BillTableRow key={instance.id} instance={instance} />
                            ))}
                        </TableBody>
                        </Table>
                    </CardContent>
                </Card>
                <div className="space-y-4 md:hidden">
                     {filteredBills.map((instance) => (
                        <BillCard key={instance.id} instance={instance} />
                    ))}
                </div>
            </div>
        </div>

      </main>
    </div>
  );
}
