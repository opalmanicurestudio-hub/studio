
'use client';

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
import { ArrowLeft, Edit, DollarSign, Calendar, BarChart, FileText, Clock, Wrench, PlusCircle, Trash2 } from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, differenceInYears, differenceInMonths } from 'date-fns';
import { useMemo } from 'react';

export default function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { inventory } = useInventory();
  
  const equipment = inventory.find((p) => p.id === id && p.type === 'equipment');

  const { purchaseCost, monthlyDepreciation, accumulatedDepreciation, bookValue, serviceMonths } = useMemo(() => {
    if (!equipment) return { purchaseCost: 0, monthlyDepreciation: 0, accumulatedDepreciation: 0, bookValue: 0, serviceMonths: 0 };
    
    const purchaseCost = equipment.costPerUnit || 0;
    const lifespanMonths = (equipment.lifespanYears || 5) * 12;
    const monthlyDepreciation = lifespanMonths > 0 ? purchaseCost / lifespanMonths : 0;
    
    const purchaseDate = equipment.batches[0]?.receivedDate ? new Date(equipment.batches[0].receivedDate) : new Date();
    const monthsInService = differenceInMonths(new Date(), purchaseDate);
    
    const calculatedAccumulatedDepreciation = Math.min(monthlyDepreciation * monthsInService, purchaseCost);
    const calculatedBookValue = purchaseCost - calculatedAccumulatedDepreciation;

    return {
        purchaseCost,
        monthlyDepreciation,
        accumulatedDepreciation: calculatedAccumulatedDepreciation,
        bookValue: calculatedBookValue,
        serviceMonths: monthsInService,
    };
  }, [equipment]);

  if (!equipment) {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <AppHeader title="Equipment Details" />
            <main className="flex-1 p-4 md:p-8 space-y-6">
                <div>Equipment not found.</div>
            </main>
        </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader title="Equipment Details" />
      <main className="flex-1 p-4 md:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-4 w-full">
                <Button variant="outline" size="icon" className="h-7 w-7 flex-shrink-0" asChild>
                    <Link href="/inventory">
                        <ArrowLeft className="h-4 w-4" />
                        <span className="sr-only">Back</span>
                    </Link>
                </Button>
                <div className="w-16 h-16 bg-muted rounded-md flex-shrink-0">
                    <Image src={equipment.imageUrl || `https://picsum.photos/seed/inv${equipment.id}/100/100`} alt={equipment.name} width={64} height={64} className='rounded-md' data-ai-hint="equipment photo"/>
                </div>
                <div className='flex-1'>
                    <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                        {equipment.name}
                    </h1>
                     <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
                        <Badge variant="secondary">{equipment.totalStock > 0 ? "Active" : "Retired"}</Badge>
                    </div>
                </div>
            </div>

            <div className="w-full sm:w-auto sm:ml-auto">
                <Button variant="outline" className="w-full">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Equipment
                </Button>
            </div>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
             <Card className="lg:col-span-2">
                <CardHeader>
                    <CardTitle>Financial Overview</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                        <div className="text-sm font-medium text-muted-foreground">Purchase Cost</div>
                        <div className="text-2xl font-bold">${purchaseCost.toFixed(2)}</div>
                    </div>
                     <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                        <div className="text-sm font-medium text-muted-foreground">Monthly Depreciation</div>
                        <div className="text-2xl font-bold">${monthlyDepreciation.toFixed(2)}</div>
                    </div>
                     <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                        <div className="text-sm font-medium text-muted-foreground">Accumulated Depreciation</div>
                        <div className="text-2xl font-bold">${accumulatedDepreciation.toFixed(2)}</div>
                    </div>
                     <div className="p-4 bg-muted/50 rounded-lg space-y-1 border-2 border-primary/20">
                        <div className="text-sm font-medium text-primary">Book Value</div>
                        <div className="text-2xl font-bold text-primary">${bookValue.toFixed(2)}</div>
                    </div>
                </CardContent>
             </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Lifespan Test</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex justify-between p-3 bg-muted/50 rounded-md">
                        <span className="font-medium">Time in Service:</span>
                        <span className="font-mono">{serviceMonths} months</span>
                    </div>
                    <Button variant="outline" className="w-full">
                        {equipment.isExperimentActive ? 'End Lifespan Test' : 'Start Lifespan Test'}
                    </Button>
                </CardContent>
             </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-1">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Maintenance History</CardTitle>
                        <CardDescription>Log of all repairs and maintenance.</CardDescription>
                    </div>
                    <Button variant="outline"><PlusCircle className="mr-2 h-4 w-4"/>Log Maintenance</Button>
                </CardHeader>
                <CardContent>
                     <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Cost</TableHead>
                                <TableHead className="w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground h-24">
                                No maintenance history logged.
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Usage History</CardTitle>
                    <CardDescription>Track services this equipment was used in.</CardDescription>
                </CardHeader>
                <CardContent>
                     <p className="text-sm text-muted-foreground text-center py-12">Usage tracking is coming soon.</p>
                </CardContent>
            </Card>
        </div>

      </main>
    </div>
  );
}
