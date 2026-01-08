
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
  ArrowUpDown,
  MoreHorizontal,
  PlusCircle,
  CreditCard,
  CalendarDays,
  AlertTriangle,
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
import { transactions } from '@/lib/transactions';
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

const kpiData = {
  monthlyTotal: 4500,
  upcoming: 1800,
  pastDue: 250,
};

const bills = [
  { id: '1', name: 'Studio Rent', amount: 1200, dueDay: 1, context: 'Business' },
  { id: '2', name: 'Booking Software', amount: 49, dueDay: 5, context: 'Business' },
  { id: '3', name: 'Personal Rent', amount: 2000, dueDay: 1, context: 'Personal' },
  { id: '4', name: 'Car Insurance', amount: 150, dueDay: 15, context: 'Personal' },
  { id: '5', name: 'Liability Insurance', amount: 100, dueDay: 20, context: 'Business' },
  { id: '6', name: 'Student Loans', amount: 400, dueDay: 25, context: 'Personal' },
];

const BillFilters = () => {
  return (
    <Card className="h-fit sticky top-20">
      <CardHeader>
        <CardTitle>Filter Bills</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
            <Label>Status</Label>
            <Select>
                <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="due-today">Due Today</SelectItem>
                    <SelectItem value="past-due">Past Due</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
            </Select>
        </div>
         <div className="space-y-2">
            <Label>Context</Label>
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
        </div>
      </CardContent>
    </Card>
  );
};


export default function BillsPage() {
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
          <Button>
            <PlusCircle className="mr-2" /> Add New Bill
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
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
        
        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-8">
            <div className="hidden md:block md:col-span-1 lg:col-span-1">
                <BillFilters />
            </div>
             <div className="md:col-span-2 lg:col-span-3">
                <Card>
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
                            <TableHead>
                                <span className="sr-only">Actions</span>
                            </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {bills.map((bill) => (
                                <TableRow key={bill.id}>
                                    <TableCell className="font-medium">{bill.name}</TableCell>
                                    <TableCell>${bill.amount.toFixed(2)}</TableCell>
                                    <TableCell>The {bill.dueDay} of each month</TableCell>
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
                                        <Button size="sm">Log Payment</Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>

      </main>
    </div>
  );
}

