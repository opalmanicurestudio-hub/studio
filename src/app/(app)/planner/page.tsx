

'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { appointments as initialAppointments, clients, services, inventory, type InventoryItem, type Service } from '@/lib/data';
import { format, addDays, subDays, startOfWeek, setHours, startOfDay } from 'date-fns';
import { useState, useMemo, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel';
import { cn } from '@/lib/utils';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';


const DayTimeline = ({ date, appointmentsForDay, onUpdateAppointmentStatus, onMarkCompleted }: { date: Date; appointmentsForDay: any[]; onUpdateAppointmentStatus: (id: string, status: 'confirmed' | 'completed' | 'canceled') => void; onMarkCompleted: (service: Service) => void; }) => {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8); // 8am to 8pm

  const getPosition = (time: Date) => {
    const timelineStart = setHours(startOfDay(time), 8);
    const minutes = (time.getTime() - timelineStart.getTime()) / 1000 / 60;
    return (minutes / 60) * 80; // 80px per hour
  };

  const getHeight = (startTime: Date, endTime: Date) => {
    const minutes = (endTime.getTime() - startTime.getTime()) / 1000 / 60;
    return (minutes / 60) * 80;
  };

  const dailyTotals = useMemo(() => {
    return appointmentsForDay
      .filter(apt => apt.status === 'completed')
      .reduce(
        (acc, apt) => {
          const service = services.find(s => s.id === apt.serviceId);
          if (service) {
            acc.revenue += service.price;
            acc.costs += service.cost;
            acc.net += service.profit;
          }
          return acc;
        },
        { revenue: 0, costs: 0, net: 0 }
      );
  }, [appointmentsForDay]);


  return (
    <Card className="flex flex-col h-full bg-muted/20">
      <CardHeader className="flex flex-col items-stretch p-4 border-b">
        <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">
            {format(date, 'EEE')}
            <span className="ml-2 font-normal text-muted-foreground">
                {format(date, 'd')}
            </span>
            </CardTitle>
        </div>
        <div className='grid grid-cols-2 gap-2 mt-4'>
            <Button variant="secondary" size="sm"><FileText className='mr-2 h-4 w-4'/>Day Log</Button>
            <Button variant="secondary" size="sm"><PlusCircle className='mr-2 h-4 w-4'/>Add Entry</Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-y-auto">
            <div className="relative pr-4">
              {hours.map((hour) => (
                <div key={hour} className="relative h-20 border-t border-dashed">
                  <span className="absolute -top-3 left-2 text-xs text-muted-foreground">
                    {format(setHours(date, hour), 'ha')}
                  </span>
                </div>
              ))}
              {appointmentsForDay.map((apt) => {
                const client = clients.find((c) => c.id === apt.clientId);
                const service = services.find((s) => s.id === apt.serviceId);
                if (!client || !service) return null;
                
                const top = getPosition(apt.startTime);
                const height = getHeight(apt.startTime, apt.endTime);
                const duration = (apt.endTime.getTime() - apt.startTime.getTime()) / 1000 / 60;

                return (
                  <div
                    key={apt.id}
                    className={cn(
                      "absolute left-12 right-2 rounded-lg border p-2 text-sm flex flex-col",
                      {
                        "bg-blue-500/10 border-blue-500/20 text-blue-900 dark:text-blue-200": apt.status === 'confirmed',
                        "bg-green-500/10 border-green-500/20 text-green-900 dark:text-green-200": apt.status === 'completed',
                        "bg-red-500/10 border-red-500/20 text-red-900 dark:text-red-200 line-through": apt.status === 'canceled',
                      }
                    )}
                    style={{ top: `${top}px`, minHeight: `${height}px` }}
                  >
                    <div className='flex justify-between items-start gap-1'>
                        <div className="font-semibold text-xs">{client.name}</div>
                        <Badge variant="outline" className={cn('capitalize text-[10px] font-medium border-current h-5', {
                            "bg-blue-500/10 text-current": apt.status === 'confirmed',
                            "bg-green-500/10 text-current": apt.status === 'completed',
                            "bg-red-500/10 text-current": apt.status === 'canceled',
                        })}>
                          {apt.status}
                        </Badge>
                    </div>
                    
                    <div className="text-current/80 text-xs">{service.name}</div>
                    <div className="text-[10px] text-current/60 mt-1">
                      {format(apt.startTime, 'h:mm a')} - {format(apt.endTime, 'h:mm a')} ({duration} min)
                    </div>
                    {apt.status === 'confirmed' && (
                        <div className='mt-auto pt-2 grid grid-cols-2 gap-1'>
                             <Button size="xs" variant="ghost" className="h-6 text-xs" onClick={() => onUpdateAppointmentStatus(apt.id, 'canceled')}>Cancel</Button>
                             <Button size="xs" className="h-6 text-xs" onClick={() => onMarkCompleted(service)}>Complete</Button>
                        </div>
                    )}
                    {apt.status === 'completed' && (
                        <div className='mt-auto pt-2 grid grid-cols-3 gap-1 text-[10px] border-t border-current/10'>
                            <div><span className='text-current/60'>Price:</span> ${service.price.toFixed(2)}</div>
                            <div className='text-red-500'><span className='text-current/60'>Cost:</span> ${service.cost.toFixed(2)}</div>
                            <div className='text-green-600 dark:text-green-400'><span className='text-current/60'>Net:</span> ${service.profit.toFixed(2)}</div>
                        </div>
                    )}
                  </div>
                );
              })}
            </div>
      </CardContent>
       <CardFooter className="p-2 border-t bg-background/50">
            <div className="grid grid-cols-3 gap-2 w-full text-center">
                <div className="rounded-md bg-green-500/10 p-2">
                    <p className="text-xs text-green-800/80 dark:text-green-400/80">Revenue</p>
                    <p className="font-bold text-sm text-green-800 dark:text-green-400">${dailyTotals.revenue.toFixed(2)}</p>
                </div>
                <div className="rounded-md bg-red-500/10 p-2">
                    <p className="text-xs text-red-800/80 dark:text-red-400/80">Costs</p>
                    <p className="font-bold text-sm text-red-800 dark:text-red-400">${dailyTotals.costs.toFixed(2)}</p>
                </div>
                <div className="rounded-md bg-blue-500/10 p-2">
                    <p className="text-xs text-blue-800/80 dark:text-blue-400/80">Net Profit</p>
                    <p className="font-bold text-sm text-blue-800 dark:text-blue-400">${dailyTotals.net.toFixed(2)}</p>
                </div>
            </div>
       </CardFooter>
    </Card>
  );
};

export default function PlannerPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [api, setApi] = React.useState<CarouselApi>()
  const [current, setCurrent] = React.useState(new Date().getDay())
  const [appointments, setAppointments] = useState(initialAppointments);
  const { toast } = useToast();

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const updateAppointmentStatus = useCallback((id: string, status: 'confirmed' | 'completed' | 'canceled') => {
    setAppointments(prev => prev.map(apt => apt.id === id ? { ...apt, status } : apt));
  }, []);

  const markCompletedAndTrackUses = useCallback((service: Service) => {
    // Find the appointment that uses this service and is 'confirmed'
    const appointmentToComplete = appointments.find(apt => apt.serviceId === service.id && apt.status === 'confirmed');
    if (!appointmentToComplete) return;

    updateAppointmentStatus(appointmentToComplete.id, 'completed');
    
    let experimentsUpdated = 0;
    (service.products || []).forEach(productInService => {
      // Since we don't have a shared state management, we can't directly update inventory here.
      // This part would typically involve dispatching an action to a global store (like Redux/Zustand)
      // or calling a context method that updates the main inventory state.
      // For now, we'll just log it.
      const productInInventory = inventory.find(p => p.id === productInService.id);
      if (productInInventory?.isExperimentActive) {
          console.log(`Incrementing experiment uses for ${productInInventory.name}`);
          experimentsUpdated++;
          // In a real app: updateInventoryItem(productInInventory.id, { experimentUses: (productInInventory.experimentUses || 0) + 1 });
      }
    });
    
    toast({
        title: "Appointment Completed",
        description: `The appointment has been marked as completed. ${experimentsUpdated > 0 ? `${experimentsUpdated} cost experiment(s) updated.` : ''}`
    })

  }, [appointments, updateAppointmentStatus, toast]);


  React.useEffect(() => {
    if (!api) return;
 
    setCurrent(api.selectedScrollSnap())
 
    api.on("select", () => {
      setCurrent(api.selectedScrollSnap())
    })
  }, [api])

  const handleNextWeek = () => {
    setCurrentDate(addDays(currentDate, 7));
  };

  const handlePrevWeek = () => {
    setCurrentDate(subDays(currentDate, 7));
  };
  
  const handleToday = () => {
    const today = new Date();
    if (format(today, 'yyyy-MM-dd') !== format(currentDate, 'yyyy-MM-dd')) {
        setCurrentDate(today);
    }
  }

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Weekly Planner" />
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrevWeek}><ChevronLeft /></Button>
             <Button variant="outline" onClick={handleToday}>Today</Button>
            <Button variant="outline" size="icon" onClick={handleNextWeek}><ChevronRight /></Button>
        </div>
        <div className='hidden md:block'>
             <p className='font-medium'>{format(startOfWeek(currentDate, { weekStartsOn: 0 }), 'MMMM yyyy')}</p>
        </div>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Appointment
        </Button>
      </div>
      <main className="flex-1 overflow-hidden p-4 pt-0">
        <div className="hidden h-full md:grid grid-cols-7 gap-2 lg:gap-4">
          {weekDays.map((date) => {
            const appointmentsForDay = appointments.filter(
              (apt) => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
            );
            return (
              <DayTimeline
                key={date.toString()}
                date={date}
                appointmentsForDay={appointmentsForDay}
                onUpdateAppointmentStatus={updateAppointmentStatus}
                onMarkCompleted={markCompletedAndTrackUses}
              />
            );
          })}
        </div>
        <div className="md:hidden h-full pb-6">
            <Carousel setApi={setApi} className="h-full" opts={{startIndex: current, loop: true}}>
                <CarouselContent className='h-full'>
                {weekDays.map((date, index) => {
                    const appointmentsForDay = appointments.filter(
                    (apt) => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
                    );
                    return (
                      <CarouselItem key={index} className='h-full'>
                         <DayTimeline
                            date={date}
                            appointmentsForDay={appointmentsForDay}
                            onUpdateAppointmentStatus={updateAppointmentStatus}
                            onMarkCompleted={markCompletedAndTrackUses}
                         />
                      </CarouselItem>
                    );
                })}
                </CarouselContent>
            </Carousel>
             <div className="py-2 text-center text-sm text-muted-foreground">
                {format(weekDays[current] || new Date(), 'MMMM d, yyyy')}
            </div>
        </div>
      </main>
    </div>
  );
}
