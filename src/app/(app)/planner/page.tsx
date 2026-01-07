'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { appointments, clients, services } from '@/lib/data';
import { format, addDays, subDays } from 'date-fns';
import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

const DayCard = ({ date, appointmentsForDay }: { date: Date; appointmentsForDay: any[] }) => {
  return (
    <Card className="flex flex-col">
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
                className="rounded-lg border bg-card p-3 text-sm"
              >
                <p className="font-semibold">{client.name}</p>
                <p className="text-muted-foreground">{service.name}</p>
                <p className="text-xs text-muted-foreground">
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

  const getWeekDays = (date: Date) => {
    const sunday = new Date(date);
    sunday.setDate(date.getDate() - date.getDay());
    return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(sunday);
        day.setDate(sunday.getDate() + i);
        return day;
    });
  };

  const [weekDays, setWeekDays] = useState(getWeekDays(currentDate));

  const handleNextWeek = () => {
    const nextWeekDate = addDays(currentDate, 7);
    setCurrentDate(nextWeekDate);
    setWeekDays(getWeekDays(nextWeekDate));
  };

  const handlePrevWeek = () => {
    const prevWeekDate = subDays(currentDate, 7);
    setCurrentDate(prevWeekDate);
    setWeekDays(getWeekDays(prevWeekDate));
  };
  
  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setWeekDays(getWeekDays(today));
  }

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Weekly Planner" />
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrevWeek}><ChevronLeft /></Button>
            <Button variant="outline" onClick={handleToday}>Today</Button>
            <Button variant="outline" size="icon" onClick={handleNextWeek}><ChevronRight /></Button>
        </div>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Appointment
        </Button>
      </div>
      <main className="flex-1 overflow-hidden p-4 pt-0">
        <div className="hidden md:grid h-full grid-cols-7 gap-2 lg:gap-4">
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
            <ScrollArea className='h-full'>
                <div className='flex gap-4'>
                {weekDays.map((date) => {
                    const appointmentsForDay = appointments.filter(
                    (apt) => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
                    ).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
                    return (
                      <div key={date.toString()} className='w-4/5 flex-shrink-0'>
                        <DayCard
                            date={date}
                            appointmentsForDay={appointmentsForDay}
                        />
                      </div>
                    );
                })}
                </div>
            </ScrollArea>
        </div>
      </main>
    </div>
  );
}
