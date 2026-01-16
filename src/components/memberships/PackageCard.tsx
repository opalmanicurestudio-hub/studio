
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Repeat, MoreHorizontal, Users, DollarSign, Trash2, Edit, FileCheck2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type Package, services } from '@/lib/data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';

interface PackageCardProps {
  pack: Package;
  onEdit: (pack: Package) => void;
  onViewUsers: (pack: Package) => void;
}

export const PackageCard: React.FC<PackageCardProps> = ({ pack, onEdit, onViewUsers }) => {
  const activePackages = 8; // Mock data
  const totalRevenue = activePackages * pack.price;
  const primaryService = useMemo(() => services.find(s => s.id === pack.serviceId), [pack.serviceId]);

  const { netProfit, profitMargin } = useMemo(() => {
    if (!primaryService) return { netProfit: 0, profitMargin: 0 };
    const totalCost = primaryService.cost * pack.sessions;
    const profit = pack.price - totalCost;
    const margin = pack.price > 0 ? (profit / pack.price) * 100 : 0;
    return { netProfit: profit, profitMargin: margin };
  }, [pack, primaryService]);

  return (
    <Card className="border-teal-500/20 hover:shadow-teal-500/10 flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div className='flex items-center gap-3'>
                 <div className="p-3 bg-teal-500/10 rounded-lg">
                    <Repeat className="w-6 h-6 text-teal-500" />
                </div>
                <div>
                    <CardTitle>{pack.name}</CardTitle>
                    <CardDescription>${pack.price}</CardDescription>
                </div>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => onEdit(pack)}><Edit className="mr-2 h-4 w-4"/>Edit</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-4 w-4"/>Delete</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
         <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" /> Active Packages</div>
                <div className="text-2xl font-bold">{activePackages}</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><DollarSign className="w-4 h-4" /> Total Revenue</div>
                <div className="text-2xl font-bold">${totalRevenue.toFixed(2)}</div>
            </div>
        </div>
         <Accordion type="multiple" className="w-full space-y-2">
            <AccordionItem value="contents" className="border rounded-md">
                <AccordionTrigger className="p-3 font-medium text-sm hover:no-underline">Package Contents</AccordionTrigger>
                <AccordionContent className="p-3 pt-0 text-xs">
                   <div className="flex items-center gap-2"><FileCheck2 className="w-3.5 h-3.5 text-green-500"/>{pack.sessions}x {primaryService?.name || 'N/A'}</div>
                </AccordionContent>
            </AccordionItem>
            <AccordionItem value="profit" className="border rounded-md">
                <AccordionTrigger className="p-3 font-medium text-sm hover:no-underline">Profitability</AccordionTrigger>
                <AccordionContent className="p-3 pt-0 text-xs space-y-1">
                    <div className="flex justify-between"><span>Package Price:</span> <span>${pack.price.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Total Cost of Services:</span> <span className="text-destructive">-${(primaryService?.cost || 0 * pack.sessions).toFixed(2)}</span></div>
                    <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Net Profit:</span> <span className={netProfit > 0 ? 'text-primary' : 'text-destructive'}>${netProfit.toFixed(2)}</span></div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={() => onViewUsers(pack)}>View Active Holders</Button>
      </CardFooter>
    </Card>
  );
};
