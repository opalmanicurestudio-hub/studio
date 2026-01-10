'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, differenceInMinutes } from 'date-fns';
import {
  ShieldPlus,
  AlertTriangle,
  Ear,
  ImageIcon,
  Award,
  PackageIcon,
  MoreHorizontal,
  ChevronDown,
  DollarSign,
  Clock,
  Briefcase,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { type Appointment, type Client, type Service } from '@/lib/data';

interface AppointmentCardProps {
  appointment: Appointment;
  client: Client;
  service: Service;
  style: React.CSSProperties;
  tmhr: number;
}

export function AppointmentCard({
  appointment,
  client,
  service,
  style,
  tmhr,
}: AppointmentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusStyles: { [key: string]: string } = {
    confirmed: 'bg-blue-100 dark:bg-blue-900/30 border-blue-500',
    completed: 'bg-green-100 dark:bg-green-900/30 border-green-500',
    cancelled: 'bg-red-200/50 dark:bg-red-900/30 border-red-500',
    deposit_pending: 'bg-pink-100 dark:bg-pink-900/30 border-pink-500',
  };

  const { revenue, breakEvenCost, netProfit, timeCost, productCost, equipmentCost } = useMemo(() => {
    const revenue = service.price;
    const totalDuration = differenceInMinutes(appointment.endTime, appointment.startTime);
    const timeCost = (totalDuration / 60) * tmhr;
    const productCost = (service.products || []).reduce((sum, p) => sum + (p.costPerUnit || 0), 0);
    const equipmentCost = (service.equipment || []).reduce((sum, e) => {
        const lifespanInMinutes = (e.lifespanYears || 5) * 365 * 8 * 60;
        const costPerMinute = (e.costPerUnit || 0) / lifespanInMinutes;
        return sum + (costPerMinute * totalDuration);
    }, 0);

    const breakEvenCost = timeCost + productCost + equipmentCost;
    const netProfit = revenue - breakEvenCost;

    return { revenue, breakEvenCost, netProfit, timeCost, productCost, equipmentCost };
  }, [service, appointment, tmhr]);


  return (
    <motion.div
      style={style}
      className={cn(
        'absolute w-full p-2 rounded-lg cursor-pointer border-l-4 transition-all duration-300',
        statusStyles[appointment.status] || 'bg-gray-100 border-gray-500'
      )}
      onClick={() => setIsExpanded(!isExpanded)}
      layout
    >
      <AnimatePresence>
        {isExpanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* Expanded View */}
            <div className="space-y-3">
               {/* Header */}
              <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-sm">{client.name}</p>
                    <p className="text-xs text-muted-foreground">{service.name}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 -mr-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem>Change Status</DropdownMenuItem>
                      <DropdownMenuItem>Edit Details</DropdownMenuItem>
                      <DropdownMenuItem>View Briefing</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
              </div>

               {/* Financials */}
              <div className="bg-background/70 rounded-md p-3 space-y-2">
                <div className="grid grid-cols-3 text-center">
                    <div>
                        <p className="text-xs text-muted-foreground">Revenue</p>
                        <p className="font-semibold text-sm">${revenue.toFixed(2)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Cost</p>
                        <p className="font-semibold text-sm text-destructive">${breakEvenCost.toFixed(2)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Net Profit</p>
                        <p className={cn("font-semibold text-sm", netProfit >= 0 ? 'text-primary' : 'text-destructive')}>
                          ${netProfit.toFixed(2)}
                        </p>
                    </div>
                </div>
              </div>

              <Accordion type="single" collapsible className="w-full" onClick={(e) => e.stopPropagation()}>
                <AccordionItem value="cost-breakdown" className="border-0">
                  <AccordionTrigger className="text-xs p-2 bg-muted/50 rounded-md hover:no-underline">Cost Breakdown</AccordionTrigger>
                  <AccordionContent className="pt-2 text-xs space-y-1">
                     <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3"/>Time Cost</span> <span>${timeCost.toFixed(2)}</span></div>
                     <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><Briefcase className="w-3 h-3"/>Product Cost</span> <span>${productCost.toFixed(2)}</span></div>
                     <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><Briefcase className="w-3 h-3"/>Equipment Cost</span> <span>${equipmentCost.toFixed(2)}</span></div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              
               {/* Intel & Notes */}
                <div className="text-xs space-y-1">
                    <p className="font-medium">Client Intel:</p>
                    {client.medicalNotes && <div className="flex items-center gap-2 text-muted-foreground"><ShieldPlus className="w-3 h-3 text-red-500"/><span>Medical: {client.medicalNotes}</span></div>}
                    {client.allergyNotes && <div className="flex items-center gap-2 text-muted-foreground"><AlertTriangle className="w-3 h-3 text-yellow-500"/><span>Allergies: {client.allergyNotes}</span></div>}
                    {client.sensoryNeeds && <div className="flex items-center gap-2 text-muted-foreground"><Ear className="w-3 h-3 text-blue-500"/><span>Sensory: {client.sensoryNeeds}</span></div>}
                    {client.inspirationPhotoUrl && <div className="flex items-center gap-2 text-muted-foreground"><ImageIcon className="w-3 h-3"/><span>Has inspiration photo</span></div>}
                    {client.isMember && <div className="flex items-center gap-2 text-muted-foreground"><Award className="w-3 h-3"/><span>Member</span></div>}
                </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Collapsed View */}
            <div className="flex flex-col justify-between h-full">
              <div>
                <p className="font-semibold text-xs leading-tight truncate">{client.name}</p>
                <p className="text-xs text-muted-foreground truncate">{service.name}</p>
              </div>
              <div className="flex items-center justify-between mt-1">
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 capitalize">{appointment.status}</Badge>
                <div className="flex items-center gap-1.5">
                  {client.medicalNotes && <ShieldPlus className="w-3 h-3 text-red-500" />}
                  {client.allergyNotes && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                  {client.sensoryNeeds && <Ear className="w-3 h-3 text-blue-500" />}
                  {client.inspirationPhotoUrl && <ImageIcon className="w-3 h-3" />}
                  {client.isMember && <Award className="w-3 h-3" />}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
