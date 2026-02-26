'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Award, Users, BarChart, Trash2, Edit, CheckCircle, Percent } from 'lucide-react';
import { type Membership, type Client } from '@/lib/data';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useInventory } from '@/context/InventoryContext';

interface MembershipCardProps {
  membership: Membership;
  clients: Client[];
  onEdit: (membership: Membership) => void;
  onViewUsers: (membership: Membership) => void;
  onDelete: (id: string) => void;
}

export const MembershipCard: React.FC<MembershipCardProps> = ({ membership, clients, onEdit, onViewUsers, onDelete }) => {
  const { services, inventory } = useInventory();
  
  const activeMembers = useMemo(() => {
    return clients.filter(c => c.activeMembershipId === membership.id).length;
  }, [clients, membership.id]);

  const mrr = activeMembers * membership.price;

  const { costOfPerks, netProfit, profitMargin } = useMemo(() => {
    const servicesCost = (membership.includedServices || []).reduce((acc, perk) => {
        const s = services.find(svc => svc.id === perk.id);
        return acc + (s?.cost || 0) * perk.quantity;
    }, 0);
    const addOnsCost = (membership.includedAddOns || []).reduce((acc, perk) => {
        const s = services.find(svc => svc.id === perk.id);
        return acc + (s?.cost || 0) * perk.quantity;
    }, 0);
    const productsCost = (membership.includedProducts || []).reduce((acc, perk) => {
        const p = inventory.find(inv => inv.id === perk.id);
        return acc + (p?.costPerUnit || 0) * perk.quantity;
    }, 0);
    const totalCost = servicesCost + addOnsCost + productsCost;

    const profit = membership.price - totalCost;
    const margin = membership.price > 0 ? (profit / membership.price) * 100 : 0;
    
    return { costOfPerks: totalCost, netProfit: profit, profitMargin: margin };
  }, [membership, services, inventory]);

  return (
    <Card className="border-indigo-500/20 hover:shadow-indigo-500/10 flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div className='flex items-center gap-3'>
                <div className="p-3 bg-indigo-500/10 rounded-lg">
                    <Award className="w-6 h-6 text-indigo-500" />
                </div>
                 <div>
                    <CardTitle>{membership.name}</CardTitle>
                    <CardDescription>${membership.price}/{membership.interval}</CardDescription>
                </div>
            </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" /> Active Members</div>
                <div className="text-2xl font-bold">{activeMembers}</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2"><BarChart className="w-4 h-4" /> Est. MRR</div>
                <div className="text-2xl font-bold">${mrr.toFixed(2)}</div>
            </div>
        </div>
        <Accordion type="multiple" className="w-full space-y-2">
            <AccordionItem value="perks" className="border rounded-md">
                <AccordionTrigger className="p-3 font-medium text-sm hover:no-underline">View Perks</AccordionTrigger>
                <AccordionContent className="p-3 pt-0 text-xs">
                    <div className="space-y-2">
                        {(membership.includedServices || []).map(p => <div key={p.id} className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-green-500"/>{p.quantity}x {p.name}</div>)}
                        {(membership.includedAddOns || []).map(p => <div key={p.id} className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-green-500"/>{p.quantity}x {p.name}</div>)}
                        {(membership.includedProducts || []).map(p => <div key={p.id} className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-green-500"/>{p.quantity}x {p.name}</div>)}
                        {membership.retailDiscount && <div className="flex items-center gap-2"><Percent className="w-3.5 h-3.5 text-green-500"/>{membership.retailDiscount}% off retail</div>}
                    </div>
                </AccordionContent>
            </AccordionItem>
            <AccordionItem value="profit" className="border rounded-md">
                <AccordionTrigger className="p-3 font-medium text-sm hover:no-underline">Profitability</AccordionTrigger>
                <AccordionContent className="p-3 pt-0 text-xs space-y-1">
                    <div className="flex justify-between"><span>Price:</span> <span>${membership.price.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Est. Cost of Perks:</span> <span className="text-destructive">-${costOfPerks.toFixed(2)}</span></div>
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
                        <Button variant="ghost" size="icon" onClick={() => onViewUsers(membership)}>
                            <Users className="w-4 h-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>View Members</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => onEdit(membership)}>
                            <Edit className="w-4 h-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Edit</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onDelete(membership.id)}>
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
