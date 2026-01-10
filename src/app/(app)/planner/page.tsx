'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react';
import { appointments as initialAppointments, clients, services, type Appointment } from '@/lib/data';
import { format, addDays, subDays, startOfWeek } from 'date-fns';
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog } from '@/components/planner/CompleteAppointmentDialog';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';


const AppointmentItem = ({ appointment, onCompleteClick }: { appointment: Appointment; onCompleteClick: (apt: Appointment) => void; }) => {
    const client = clients.find(c => c.id === appointment.clientId);
    const service = services.find(s => s.id === appointment.serviceId);

    if (!client || !service) return null;

    const statusStyles = {
        confirmed: 'border-l-4 border-blue-500',
        completed: 'border-l-4 border-green-500',
        canceled: 'border-l-4 border-red-500 opacity-70',
    };
    
    return (
        <div className={cn("p-4 rounded-lg bg-card border flex flex-col gap-3", statusStyles[appointment.status])}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                        <AvatarImage src={client.avatarUrl} alt={client.name} />
                        <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="font-semibold text-sm">{client.name}</p>
                        <p className="text-xs text-muted-foreground">{service.name}</p>
                    </div>
                </div>
                 <Badge variant={appointment.status === 'completed' ? 'default' : 'secondary'} className="capitalize shrink-0">{appointment.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
                {format(appointment.startTime, 'h:mm a')} - {format(appointment.endTime, 'h:mm a')}
            </div>
            {appointment.status === 'confirmed' && (
                <div className="flex gap-2 pt-2 border-t -mb-1 -mx-2 px-2">
                    <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground">Cancel</Button>
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => onCompleteClick(appointment)}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Complete
                    </Button>
                </div>
            )}
        </div>
    );
};

const DayCard = ({ date, appointments, onCompleteClick }: { date: Date; appointments: Appointment[]; onCompleteClick: (apt: Appointment) => void; }) => {
    const dailyTotals = useMemo(() => {
        return appointments
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
    }, [appointments]);

    return (
        <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between p-4 bg-muted/50 border-b">
                 <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold">{format(date, 'd')}</p>
                    <p className="text-sm font-medium text-muted-foreground">{format(date, 'EEEE')}</p>
                </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
                {appointments.length > 0 ? (
                    appointments.map(apt => (
                        <AppointmentItem key={apt.id} appointment={apt} onCompleteClick={onCompleteClick} />
                    ))
                ) : (
                    <div className="text-center py-12 text-muted-foreground text-sm space-y-4">
                        <p>No appointments scheduled for this day.</p>
                        <Button variant="secondary">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add Appointment
                        </Button>
                    </div>
                )}
            </CardContent>
            {appointments.length > 0 && (
                <CardFooter className="p-2 border-t bg-muted/50">
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
            )}
        </Card>
    );
};

export default function PlannerPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState(initialAppointments);
  const { inventory, setInventory, addStockCorrection } = useInventory();

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const { toast } = useToast();

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const handleCompleteClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsCheckoutOpen(true);
  };

  const handleCheckout = (updatedInventory, newCorrections) => {
    if (!selectedAppointment) return;

    setAppointments(prev => prev.map(apt => apt.id === selectedAppointment.id ? { ...apt, status: 'completed' } : apt));
    setInventory(updatedInventory);
    newCorrections.forEach(addStockCorrection);
    
    toast({
        title: "Appointment Completed",
        description: `Inventory levels have been updated and ${newCorrections.length} stock correction(s) logged.`
    });
    setIsCheckoutOpen(false);
    setSelectedAppointment(null);
  };

  const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));
  const handlePrevWeek = () => setCurrentDate(subDays(currentDate, 7));
  const handleToday = () => setCurrentDate(new Date());

  const selectedAppointmentData = useMemo(() => {
    if (!selectedAppointment) return null;
    const client = clients.find(c => c.id === selectedAppointment.clientId);
    const service = services.find(s => s.id === selectedAppointment.serviceId);
    return { appointment: selectedAppointment, client, service };
  }, [selectedAppointment]);

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader title="Planner" />
      <div className="sticky top-16 z-10 bg-background/95 backdrop-blur-sm p-4 border-b">
        <div className="flex items-center justify-between gap-4 max-w-4xl mx-auto">
            <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={handlePrevWeek}><ChevronLeft /></Button>
                <Button variant="outline" size="icon" onClick={handleNextWeek}><ChevronRight /></Button>
                <Button variant="outline" onClick={handleToday}>Today</Button>
            </div>
            <p className='font-semibold text-center'>{format(startOfWeek(currentDate, { weekStartsOn: 0 }), 'MMMM yyyy')}</p>
            <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add
            </Button>
        </div>
      </div>
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
          {weekDays.map((date) => {
            const appointmentsForDay = appointments
                .filter(apt => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
                .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
            return (
              <DayCard
                key={date.toString()}
                date={date}
                appointments={appointmentsForDay}
                onCompleteClick={handleCompleteClick}
              />
            );
          })}
        </div>
      </main>
      {selectedAppointmentData && (
        <CompleteAppointmentDialog
            open={isCheckoutOpen}
            onOpenChange={setIsCheckoutOpen}
            appointmentData={selectedAppointmentData}
            inventory={inventory}
            onConfirmCheckout={handleCheckout}
        />
      )}
    </div>
  );
}
