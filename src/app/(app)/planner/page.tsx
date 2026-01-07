'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { appointments, clients, services } from '@/lib/data';
import { format, addDays, subDays, startOfWeek, endOfWeek } from 'date-fns';
import { useState, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel';
import { cn } from '@/lib/utils';
import React from 'react';

const DayCard = ({ date, appointmentsForDay }: { date: Date; appointmentsForDay: any[] }) => {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="text-base font-medium">
          {format(date, 'EEE')}
          <span className="ml-2 font-normal text-muted-foreground">
            {format(date, 'd')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 p-4 pt-0">
        {appointmentsForDay.length > 0 ? (
          appointmentsForDay.map((apt) => {
            const client = clients.find((c) => c.id === apt.clientId);
            const service = services.find((s) => s.id === apt.serviceId);
            if (!client || !service) return null;
            return (
              <div
                key={apt.id}
                className={cn("rounded-lg border p-3 text-sm", {
                    "bg-blue-900/20 border-blue-700/50 text-blue-200": apt.status === 'confirmed',
                    "bg-green-900/20 border-green-700/50 text-green-200": apt.status === 'completed',
                    "bg-red-900/20 border-red-700/50 text-red-200 line-through": apt.status === 'canceled',
                })}
              >
                <p className="font-semibold">{client.name}</p>
                <p className="text-current/80">{service.name}</p>
                <p className="text-xs text-current/60 mt-1">
                  {format(apt.startTime, 'h:mm a')} -{' '}
                  {format(apt.endTime, 'h:mm a')}
                </p>
              </div>
            );
          })
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 text-center py-10">
            <p className="text-sm text-muted-foreground">No appointments</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default function PlannerPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [api, setApi] = React.useState<CarouselApi>()
  const [current, setCurrent] = React.useState(0)

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

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
             <p className='font-medium'>{format(startOfWeek(currentDate), 'MMMM yyyy')}</p>
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
            ).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
            return (
              <DayCard
                key={date.toString()}
                date={date}
                appointmentsForDay={appointmentsForDay}
              />
            );
          })}
        </div>
        <div className="md:hidden h-full">
            <Carousel setApi={setApi} className="h-full">
                <CarouselContent className='h-full'>
                {weekDays.map((date, index) => {
                    const appointmentsForDay = appointments.filter(
                    (apt) => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
                    ).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
                    return (
                      <CarouselItem key={index} className='h-full'>
                         <ScrollArea className='h-full'>
                            <DayCard
                                date={date}
                                appointmentsForDay={appointmentsForDay}
                            />
                         </ScrollArea>
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
