
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
import { billDefinitions, type BillDefinition } from '@/lib/financial-data';

const kpiData = {
  monthlyTotal: 4500,
  upcoming: 1800,
  pastDue: 250,
};

type StatusFilter = 'all' | 'due-today' | 'past-due' | 'paid';
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
              <SelectItem value="due-today">Due Today</SelectItem>
              <SelectItem value="past-due">Past Due</SelectItem>
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


const BillTableRow = ({ bill }: { bill: BillDefinition }) => {
    const getDueText = () => {
        if (bill.billingCycle === 'monthly') {
            return `The ${bill.dueDay} of each month`;
        }
        return `Recurs ${bill.billingCycle}`;
    }

    return (
    <TableRow>
        <TableCell className="font-medium">{bill.name}</TableCell>
        <TableCell>${bill.amount.toFixed(2)}</TableCell>
        <TableCell>{getDueText()}</TableCell>
        <TableCell>
            <Badge
                variant={bill.context === 'Business' ? 'secondary' : 'outline'}
                className={cn({
                    'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': bill.context === 'Business',
                    'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': bill.context === 'Personal'
                })}
                >
                {bill.context}
            </Badge>
        </TableCell>
        <TableCell className="text-right">
             <Button variant="outline" size="sm">Log Payment</Button>
        </TableCell>
    </TableRow>
    )
};

const BillCard = ({ bill }: { bill: BillDefinition }) => {
    const getDueText = () => {
        if (bill.billingCycle === 'monthly') {
            return `Due on the ${bill.dueDay} of each month`;
        }
        return `Recurs ${bill.billingCycle}`;
    }
    return (
    <Card>
        <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="font-semibold">{bill.name}</p>
                    <p className="text-sm text-muted-foreground">{getDueText()}</p>
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
                <Badge
                    variant={bill.context === 'Business' ? 'secondary' : 'outline'}
                    className={cn({
                        'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300': bill.context === 'Business',
                        'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300': bill.context === 'Personal'
                    })}
                >
                    {bill.context}
                </Badge>
                <span className="font-semibold text-lg">${bill.amount.toFixed(2)}</span>
            </div>
        </CardContent>
        <CardFooter className="p-2 border-t">
            <Button variant="secondary" className="w-full">Log Payment</Button>
        </CardFooter>
    </Card>
    )
};


export default function BillsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [contextFilter, setContextFilter] = useState<ContextFilter>('all');

  const filteredBills = useMemo(() => {
    return billDefinitions.filter(bill => {
      const contextMatch = contextFilter === 'all' || bill.context === contextFilter;
      // Note: Status logic is placeholder as we don't have bill instances yet.
      const statusMatch = statusFilter === 'all' || (statusFilter === 'past-due' && bill.name.includes('Insurance'));
      return contextMatch && statusMatch;
    });
  }, [contextFilter, statusFilter]);

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
              <CardTitle className="text-sm font-medium">Total Monthly Bills</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${kpiData.monthlyTotal.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Sum of all recurring expenses</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Upcoming in 30 Days</CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${kpiData.upcoming.toFixed(2)}</div>
               <p className="text-xs text-muted-foreground">Total amount due soon</p>
            </CardContent>
          </Card>
           <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Past Due</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">${kpiData.pastDue.toFixed(2)}</div>
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
                        <CardTitle>Bill Dashboard</CardTitle>
                        <CardDescription>A list of all your recurring bills from your Financial Foundation.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Due Day</TableHead>
                                <TableHead>Context</TableHead>
                                <TableHead className='text-right'>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredBills.map((bill) => (
                               <BillTableRow key={bill.id} bill={bill} />
                            ))}
                        </TableBody>
                        </Table>
                    </CardContent>
                </Card>
                <div className="space-y-4 md:hidden">
                     {filteredBills.map((bill) => (
                        <BillCard key={bill.id} bill={bill} />
                    ))}
                </div>
            </div>
        </div>

      </main>
    </div>
  );
}
