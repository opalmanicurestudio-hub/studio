'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { appointments, clients, services } from '@/lib/data';
import { format } from 'date-fns';

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
          <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 text-center">
            <p className="text-sm text-muted-foreground">No appointments</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default function PlannerPage() {
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today);
    const currentDayOfWeek = today.getDay();
    const daysSinceSunday = currentDayOfWeek;
    day.setDate(today.getDate() - daysSinceSunday + i);
    return day;
  });

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Weekly Planner" />
      <div className="flex justify-end p-4">
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Appointment
        </Button>
      </div>
      <main className="flex-1 overflow-hidden p-4 pt-0">
        <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-7 md:gap-2 lg:gap-4">
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
      </main>
    </div>
  );
}
