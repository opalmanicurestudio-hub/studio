'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Repeat, Users, DollarSign, Trash2, Edit, FileCheck2 } from 'lucide-react';
import { type Package, type Service } from '@/lib/data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';

interface PackageCardProps {
  pack: Package;
  services: Service[];
  onEdit: (pack: Package) => void;
  onViewUsers: (pack: Package) => void;
  onDelete: (id: string) => void;
}

export const PackageCard: React.FC<PackageCardProps> = ({ pack, services, onEdit, onViewUsers, onDelete }) => {
  const activePackages = 8; // Mock data
  const totalRevenue = activePackages * pack.price;
  const primaryService = useMemo(() => services.find(s => s.id === pack.serviceId), [pack.serviceId, services]);

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
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    <div className="flex justify-between"><span>Total Cost of Services:</span> <span className="text-destructive">-${((primaryService?.cost || 0) * pack.sessions).toFixed(2)}</span></div>
                    <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Net Profit:</span> <span className={netProfit > 0 ? 'text-primary' : 'text-destructive'}>${netProfit.toFixed(2)}</span></div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
      <CardFooter className="p-2 border-t">
        <TooltipProvider>
            <div className="flex justify-around w-full">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => onViewUsers(pack)}>
                            <Users className="w-4 h-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>View Holders</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => onEdit(pack)}>
                            <Edit className="w-4 h-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Edit</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onDelete(pack.id)}>
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Delete</p></TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
      </CardFooter>
    </Card>
  );
};
